package server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yetanotherchris/rclone-web/internal/bip39"
	"github.com/yetanotherchris/rclone-web/internal/config"
	"github.com/yetanotherchris/rclone-web/internal/remotes"
	"github.com/yetanotherchris/rclone-web/internal/runner"
	"github.com/yetanotherchris/rclone-web/internal/secret"
	"github.com/yetanotherchris/rclone-web/internal/session"
)

type Server struct {
	cfg        *config.AppConfig
	webFS      fs.FS
	sessions   *session.Store
	runs       *runner.Manager
	queueRuns  *runner.QueueManager
	watches    *runner.WatchManager
	src        *remotes.EnvVarSource
	assemblePassphrase func(prefix string) (string, error)

	mu          sync.RWMutex
	rcCfg       *config.RcloneConfig // nil when locked
	passphrase  string               // held for re-encryption
	keyFileMode bool                 // true when started with --key-file (always unlocked, no session required)
	shortLen    int                  // 0 = full passphrase mode; >0 = short-password prefix length

	bindAddr string
	port     int
	listener net.Listener
}

// New creates the server. assemblePassphrase takes the browser-supplied prefix
// and returns the full age passphrase. shortLen is 0 for full-passphrase mode,
// or the number of characters the user types at unlock for short-password mode.
func New(
	cfg *config.AppConfig,
	webFS fs.FS,
	assemblePassphrase func(prefix string) (string, error),
	shortLen int,
) *Server {
	mgr := runner.NewManager()
	s := &Server{
		cfg:                cfg,
		webFS:              webFS,
		src:                &remotes.EnvVarSource{},
		runs:               mgr,
		queueRuns:          runner.NewQueueManager(mgr),
		watches:            runner.NewWatchManager(),
		assemblePassphrase: assemblePassphrase,
		bindAddr:           cfg.BindAddr,
		port:               cfg.Port,
		shortLen:           shortLen,
	}

	// Load backend schema eagerly so password fields are ready before any job runs.
	s.src.PasswordFields = remotes.ParsePasswordFields(s.loadBackends())

	s.sessions = session.NewStore(
		time.Duration(cfg.IdleTimeoutSeconds)*time.Second,
		func() { s.lock() },
	)

	return s
}

func (s *Server) lock() {
	s.watches.StopAll()
	s.mu.Lock()
	defer s.mu.Unlock()
	// zero passphrase
	for i := range s.passphrase {
		_ = i
	}
	s.passphrase = ""
	s.rcCfg = nil
}

// AutoUnlock decrypts the config using the given passphrase and puts the server
// into key-file mode: always unlocked, no session or CSRF checks required.
// Must be called before Start.
func (s *Server) AutoUnlock(passphrase string) error {
	data, err := secret.DecryptAuto(s.cfg.ConfigPath, passphrase)
	if err != nil {
		return fmt.Errorf("decrypt config: %w", err)
	}
	rcCfg, err := config.ParseConfig(data)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}
	s.mu.Lock()
	s.rcCfg = rcCfg
	s.passphrase = passphrase
	s.keyFileMode = true
	s.mu.Unlock()
	return nil
}

// Start binds the listener and starts serving.
func (s *Server) Start() (string, error) {
	addr := fmt.Sprintf("%s:%d", s.bindAddr, s.port)
	ln, err := net.Listen("tcp", addr)
	if err != nil && s.port != 0 {
		// Preferred port is in use; fall back to a random free port.
		log.Printf("port %d unavailable (%v); falling back to a random port", s.port, err)
		ln, err = net.Listen("tcp", fmt.Sprintf("%s:0", s.bindAddr))
	}
	if err != nil {
		return "", fmt.Errorf("listen %s: %w", addr, err)
	}
	s.listener = ln
	if !s.keyFileMode {
		s.sessions.StartIdleWatcher()
	}

	mux := http.NewServeMux()
	s.registerRoutes(mux)

	go func() {
		if err := http.Serve(ln, s.hostGuard(mux)); err != nil && err != http.ErrServerClosed {
			log.Printf("server error: %v", err)
		}
	}()

	return ln.Addr().String(), nil
}

// hostGuard rejects requests whose Host header doesn't match the bound address.
func (s *Server) hostGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		// strip port from host if present
		h, _, err := net.SplitHostPort(host)
		if err != nil {
			h = host
		}
		_, lport, _ := net.SplitHostPort(s.listener.Addr().String())
		_, rport, _ := net.SplitHostPort(r.Host)
		if rport == "" {
			rport = "80"
		}
		if lport != rport || (h != s.bindAddr && h != "localhost" && h != "127.0.0.1") {
			// Only enforce on non-loopback binds to avoid breaking dev workflows
			if s.bindAddr != "127.0.0.1" && s.bindAddr != "localhost" {
				http.Error(w, "forbidden host", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) registerRoutes(mux *http.ServeMux) {
	// Static files — index.html at "/" plus app.generated.js / app.css at "/assets/*"
	fileServer := http.FileServer(http.FS(s.webFS))
	mux.HandleFunc("GET /assets/", func(w http.ResponseWriter, r *http.Request) {
		// Rewrite /assets/foo → /foo so the embedded FS root matches
		r2 := r.Clone(r.Context())
		r2.URL.Path = strings.TrimPrefix(r.URL.Path, "/assets")
		fileServer.ServeHTTP(w, r2)
	})
	mux.HandleFunc("GET /", s.handleIndex)

	// Auth endpoints
	mux.HandleFunc("POST /api/unlock", s.handleUnlock)
	mux.HandleFunc("POST /api/lock", s.handleLock)
	mux.HandleFunc("GET /api/status", s.handleStatus)

	// Protected API
	mux.HandleFunc("GET /api/ping", s.auth(func(w http.ResponseWriter, r *http.Request) { jsonOK(w, nil) }))
	mux.HandleFunc("GET /api/jobs", s.auth(s.handleListJobs))
	mux.HandleFunc("POST /api/jobs", s.csrf(s.handleCreateJob))
	mux.HandleFunc("GET /api/jobs/{id}", s.auth(s.handleGetJob))
	mux.HandleFunc("PUT /api/jobs/{id}", s.csrf(s.handleUpdateJob))
	mux.HandleFunc("DELETE /api/jobs/{id}", s.csrf(s.handleDeleteJob))
	mux.HandleFunc("POST /api/jobs/{id}/run", s.csrf(s.handleRunJob))
	mux.HandleFunc("POST /api/jobs/{id}/watch/start", s.csrf(s.handleStartWatch))
	mux.HandleFunc("POST /api/jobs/{id}/watch/stop", s.csrf(s.handleStopWatch))

	mux.HandleFunc("GET /api/runs/{id}", s.auth(s.handleGetRun))
	mux.HandleFunc("GET /api/runs/{id}/log", s.auth(s.handleRunLog))
	mux.HandleFunc("POST /api/runs/{id}/stop", s.csrf(s.handleStopRun))

	mux.HandleFunc("GET /api/providers", s.auth(s.handleListProviders))
	mux.HandleFunc("POST /api/providers", s.csrf(s.handleCreateProvider))
	mux.HandleFunc("GET /api/providers/{name}", s.auth(s.handleGetProvider))
	mux.HandleFunc("PUT /api/providers/{name}", s.csrf(s.handleUpdateProvider))
	mux.HandleFunc("DELETE /api/providers/{name}", s.csrf(s.handleDeleteProvider))

	mux.HandleFunc("GET /api/queues", s.auth(s.handleListQueues))
	mux.HandleFunc("POST /api/queues", s.csrf(s.handleCreateQueue))
	mux.HandleFunc("GET /api/queues/{id}", s.auth(s.handleGetQueue))
	mux.HandleFunc("PUT /api/queues/{id}", s.csrf(s.handleUpdateQueue))
	mux.HandleFunc("DELETE /api/queues/{id}", s.csrf(s.handleDeleteQueue))
	mux.HandleFunc("POST /api/queues/{id}/run", s.csrf(s.handleRunQueue))

	mux.HandleFunc("GET /api/queue-runs/{id}", s.auth(s.handleGetQueueRun))
	mux.HandleFunc("POST /api/queue-runs/{id}/stop", s.csrf(s.handleStopQueueRun))

	mux.HandleFunc("GET /api/backends", s.auth(s.handleBackends))
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	http.FileServer(http.FS(s.webFS)).ServeHTTP(w, r)
}

// auth middleware — requires a valid session cookie (bypassed in key-file mode).
func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.keyFileMode {
			if _, ok := s.sessions.Validate(r); !ok {
				jsonErr(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			s.sessions.Touch()
		}
		next(w, r)
	}
}

// csrf middleware — requires a valid session + CSRF token (bypassed in key-file mode).
func (s *Server) csrf(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.keyFileMode {
			if !s.sessions.ValidateCSRF(r) {
				jsonErr(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			s.sessions.Touch()
		}
		next(w, r)
	}
}

// ---- Auth handlers ----

func (s *Server) handleUnlock(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Prefix string `json:"prefix"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest)
		return
	}

	passphrase, err := s.assemblePassphrase(body.Prefix)
	if err != nil {
		jsonErr(w, "credential store unavailable: "+err.Error(), http.StatusInternalServerError)
		return
	}

	data, err := secret.Decrypt(s.cfg.ConfigPath, passphrase)
	if err != nil {
		jsonErr(w, "invalid password or corrupted config", http.StatusUnauthorized)
		return
	}

	rcCfg, err := config.ParseConfig(data)
	if err != nil {
		jsonErr(w, "config parse error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	s.mu.Lock()
	s.rcCfg = rcCfg
	s.passphrase = passphrase
	s.mu.Unlock()

	sess := s.sessions.Create()
	secure := s.bindAddr != "127.0.0.1" && s.bindAddr != "localhost"
	s.sessions.SetCookie(w, sess.Token, secure)

	jsonOK(w, map[string]string{"csrfToken": sess.CSRFToken})
}

func (s *Server) handleLock(w http.ResponseWriter, r *http.Request) {
	if s.keyFileMode {
		jsonOK(w, map[string]string{"status": "locked"})
		return
	}
	s.sessions.Destroy()
	s.lock()
	s.sessions.ClearCookie(w)
	jsonOK(w, map[string]string{"status": "locked"})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if s.keyFileMode {
		jsonOK(w, map[string]interface{}{
			"locked":          false,
			"idleSecondsLeft": -1,
			"shortLen":        s.shortLen,
		})
		return
	}
	csrfToken, ok := s.sessions.Validate(r)
	remaining := s.sessions.TimeUntilLock()
	resp := map[string]interface{}{
		"locked":          !ok,
		"idleSecondsLeft": int(remaining.Seconds()),
		"shortLen":        s.shortLen,
	}
	if ok {
		resp["csrfToken"] = csrfToken
	}
	jsonOK(w, resp)
}

// ---- Jobs ----

func (s *Server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	// Attach last run status for dashboard
	type jobWithStatus struct {
		config.Job
		LastRun    *runSummary `json:"lastRun,omitempty"`
		IsWatching bool        `json:"isWatching"`
	}
	jobs := make([]jobWithStatus, 0, len(cfg.Rclone.Jobs))
	for _, j := range cfg.Rclone.Jobs {
		jws := jobWithStatus{Job: j, IsWatching: s.watches.IsWatching(j.ID)}
		// find most recent run for this job
		for _, run := range s.runs.ListRecent() {
			if run.JobID == j.ID {
				jws.LastRun = toRunSummary(run)
				break
			}
		}
		jobs = append(jobs, jws)
	}
	jsonOK(w, jobs)
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	for _, j := range cfg.Rclone.Jobs {
		if j.ID == id {
			jsonOK(w, j)
			return
		}
	}
	jsonErr(w, "job not found", http.StatusNotFound)
}

func (s *Server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var job config.Job
	if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	if job.ID == "" {
		taken := make(map[string]bool, len(s.rcCfg.Rclone.Jobs))
		for _, j := range s.rcCfg.Rclone.Jobs {
			taken[j.ID] = true
		}
		job.ID = bip39.Generate(taken)
	}
	s.rcCfg.Rclone.Jobs = append(s.rcCfg.Rclone.Jobs, job)
	if err := s.saveConfig(); err != nil {
		jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	jsonOK(w, job)
}

func (s *Server) handleUpdateJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var updated config.Job
	if err := json.NewDecoder(r.Body).Decode(&updated); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest)
		return
	}
	updated.ID = id

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	for i, j := range s.rcCfg.Rclone.Jobs {
		if j.ID == id {
			s.rcCfg.Rclone.Jobs[i] = updated
			if err := s.saveConfig(); err != nil {
				jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
				return
			}
			jsonOK(w, updated)
			return
		}
	}
	jsonErr(w, "job not found", http.StatusNotFound)
}

func (s *Server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	jobs := s.rcCfg.Rclone.Jobs
	for i, j := range jobs {
		if j.ID == id {
			s.rcCfg.Rclone.Jobs = append(jobs[:i], jobs[i+1:]...)
			if err := s.saveConfig(); err != nil {
				jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
				return
			}
			s.watches.Stop(id)
			jsonOK(w, map[string]string{"deleted": id})
			return
		}
	}
	jsonErr(w, "job not found", http.StatusNotFound)
}

func (s *Server) handleRunJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	dryRun := r.URL.Query().Get("dryRun") == "true" || r.URL.Query().Get("dryRun") == "1"
	resync := r.URL.Query().Get("resync") == "true" || r.URL.Query().Get("resync") == "1"

	s.mu.RLock()
	cfg := s.rcCfg
	passphrase := s.passphrase
	s.mu.RUnlock()

	if cfg == nil || passphrase == "" {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}

	var job *config.Job
	for i := range cfg.Rclone.Jobs {
		if cfg.Rclone.Jobs[i].ID == id {
			job = &cfg.Rclone.Jobs[i]
			break
		}
	}
	if job == nil {
		jsonErr(w, "job not found", http.StatusNotFound)
		return
	}

	run, err := s.startJob(cfg, job, dryRun, resync)
	if err != nil {
		jsonErr(w, "start run: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"runId": run.ID})
}

// startJob assembles argv for job and launches it via the run manager.
// Shared by the manual run endpoint and the watch ticker.
func (s *Server) startJob(cfg *config.RcloneConfig, job *config.Job, dryRun, resync bool) (*runner.Run, error) {
	argv, err := remotes.AssembleArgv(s.src, cfg, job, dryRun, resync)
	if err != nil {
		return nil, fmt.Errorf("assemble argv: %w", err)
	}

	cmdline := remotes.RedactedCmdline(s.cfg.RclonePath, argv)
	extraEnv := s.src.Env(cfg.Rclone.Providers)

	run, err := s.runs.Start(
		s.cfg.RclonePath,
		argv,
		cmdline,
		job.ID,
		job.DisplayName(),
		extraEnv,
		os.Environ(),
		func(r *runner.Run) {
			s.sessions.SetRunActive(false)
			s.mu.Lock()
			if s.rcCfg != nil && !r.FinishedAt.IsZero() {
				for i := range s.rcCfg.Rclone.Jobs {
					if s.rcCfg.Rclone.Jobs[i].ID == r.JobID {
						t := r.FinishedAt
						s.rcCfg.Rclone.Jobs[i].LastRunAt = &t
						s.rcCfg.Rclone.Jobs[i].LastRunStatus = string(r.Status)
						_ = s.saveConfig()
						break
					}
				}
			}
			s.mu.Unlock()
		},
	)
	if err != nil {
		return nil, err
	}
	s.sessions.SetRunActive(true)
	return run, nil
}

// ---- Watch mode ----
//
// Watch mode re-runs a job on a fixed timer (runner.WatchInterval) instead of
// waiting for a manual trigger. rclone's copy/sync commands already diff
// before transferring, so periodic re-runs are enough — no filesystem event
// watching is needed. Watch state is in-memory only: it stops on lock/restart.

func (s *Server) handleStartWatch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}

	found := false
	for _, j := range cfg.Rclone.Jobs {
		if j.ID == id {
			found = true
			break
		}
	}
	if !found {
		jsonErr(w, "job not found", http.StatusNotFound)
		return
	}

	started := s.watches.Start(id, func() { s.watchTick(id) })
	if !started {
		jsonErr(w, "already watching", http.StatusConflict)
		return
	}
	jsonOK(w, map[string]string{"status": "watching"})
}

func (s *Server) handleStopWatch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.watches.Stop(id)
	jsonOK(w, map[string]string{"status": "stopped"})
}

// watchTick runs the watched job, skipping the tick if it's already running,
// the server is locked, or the job was deleted since the watch started.
func (s *Server) watchTick(jobID string) {
	if s.runs.IsRunning(jobID) {
		return
	}
	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		return
	}
	var job *config.Job
	for i := range cfg.Rclone.Jobs {
		if cfg.Rclone.Jobs[i].ID == jobID {
			job = &cfg.Rclone.Jobs[i]
			break
		}
	}
	if job == nil {
		s.watches.Stop(jobID)
		return
	}
	_, _ = s.startJob(cfg, job, false, false)
}

// ---- Runs ----

type runSummary struct {
	ID         string           `json:"id"`
	JobID      string           `json:"jobId"`
	JobName    string           `json:"jobName"`
	Cmdline    string           `json:"cmdline"`
	Status     runner.RunStatus `json:"status"`
	ExitCode   int              `json:"exitCode"`
	StartedAt  time.Time        `json:"startedAt"`
	FinishedAt *time.Time       `json:"finishedAt,omitempty"`
	PID        int              `json:"pid"`
}

func toRunSummary(r *runner.Run) *runSummary {
	rs := &runSummary{
		ID:        r.ID,
		JobID:     r.JobID,
		JobName:   r.JobName,
		Cmdline:   r.Cmdline,
		Status:    r.Status,
		ExitCode:  r.ExitCode,
		StartedAt: r.StartedAt,
		PID:       r.PID,
	}
	if !r.FinishedAt.IsZero() {
		rs.FinishedAt = &r.FinishedAt
	}
	return rs
}

func (s *Server) handleGetRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	run, ok := s.runs.Get(id)
	if !ok {
		jsonErr(w, "run not found", http.StatusNotFound)
		return
	}
	jsonOK(w, toRunSummary(run))
}

func (s *Server) handleRunLog(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	since := 0
	if sv := r.URL.Query().Get("since"); sv != "" {
		since, _ = strconv.Atoi(sv)
	}
	run, ok := s.runs.Get(id)
	if !ok {
		jsonErr(w, "run not found", http.StatusNotFound)
		return
	}
	lines, next := run.LogSince(since)
	jsonOK(w, map[string]interface{}{
		"lines":  lines,
		"next":   next,
		"status": run.Status,
	})
}

func (s *Server) handleStopRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.runs.Stop(id); err != nil {
		jsonErr(w, err.Error(), http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]string{"status": "canceling"})
}

// ---- Providers ----

func (s *Server) handleListProviders(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	result := make([]map[string]interface{}, 0, len(cfg.Rclone.Providers))
	for name, p := range cfg.Rclone.Providers {
		result = append(result, providerToFlat(name, p))
	}
	jsonOK(w, result)
}

func (s *Server) handleGetProvider(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	p, ok := cfg.Rclone.Providers[name]
	if !ok {
		jsonErr(w, "provider not found", http.StatusNotFound)
		return
	}
	jsonOK(w, providerToFlat(name, p))
}

func (s *Server) handleCreateProvider(w http.ResponseWriter, r *http.Request) {
	var flat map[string]string
	if err := json.NewDecoder(r.Body).Decode(&flat); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(flat["name"])
	if name == "" {
		jsonErr(w, "name is required", http.StatusBadRequest)
		return
	}
	p := providerFromFlat(flat)

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	s.rcCfg.Rclone.Providers[name] = p
	if err := s.saveConfig(); err != nil {
		jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	jsonOK(w, providerToFlat(name, p))
}

func (s *Server) handleUpdateProvider(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var flat map[string]string
	if err := json.NewDecoder(r.Body).Decode(&flat); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest)
		return
	}
	p := providerFromFlat(flat)

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	if _, ok := s.rcCfg.Rclone.Providers[name]; !ok {
		jsonErr(w, "provider not found", http.StatusNotFound)
		return
	}
	s.rcCfg.Rclone.Providers[name] = p
	if err := s.saveConfig(); err != nil {
		jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, providerToFlat(name, p))
}

func (s *Server) handleDeleteProvider(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	if _, ok := s.rcCfg.Rclone.Providers[name]; !ok {
		jsonErr(w, "provider not found", http.StatusNotFound)
		return
	}
	delete(s.rcCfg.Rclone.Providers, name)
	if err := s.saveConfig(); err != nil {
		jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"deleted": name})
}

// ---- Queues ----

type queueWithRun struct {
	config.Queue
	LastQueueRun *queueRunSummary `json:"lastQueueRun,omitempty"`
}

type queueRunSummary struct {
	ID     string           `json:"id"`
	Status runner.RunStatus `json:"status"`
}

func (s *Server) queueWithLastRun(q config.Queue) queueWithRun {
	qwr := queueWithRun{Queue: q}
	if latest := s.queueRuns.LatestForQueue(q.ID); latest != nil {
		snap := latest.Snapshot()
		qwr.LastQueueRun = &queueRunSummary{ID: snap.ID, Status: snap.Status}
	}
	return qwr
}

func (s *Server) handleListQueues(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	result := make([]queueWithRun, 0, len(cfg.Rclone.Queues))
	for _, q := range cfg.Rclone.Queues {
		result = append(result, s.queueWithLastRun(q))
	}
	jsonOK(w, result)
}

func (s *Server) handleGetQueue(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	for _, q := range cfg.Rclone.Queues {
		if q.ID == id {
			jsonOK(w, s.queueWithLastRun(q))
			return
		}
	}
	jsonErr(w, "queue not found", http.StatusNotFound)
}

func (s *Server) handleCreateQueue(w http.ResponseWriter, r *http.Request) {
	var q config.Queue
	if err := json.NewDecoder(r.Body).Decode(&q); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest)
		return
	}
	if q.Name == "" {
		jsonErr(w, "name is required", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	if q.ID == "" {
		taken := make(map[string]bool, len(s.rcCfg.Rclone.Queues))
		for _, existing := range s.rcCfg.Rclone.Queues {
			taken[existing.ID] = true
		}
		q.ID = bip39.Generate(taken)
	}
	s.rcCfg.Rclone.Queues = append(s.rcCfg.Rclone.Queues, q)
	if err := s.saveConfig(); err != nil {
		jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	jsonOK(w, q)
}

func (s *Server) handleUpdateQueue(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var updated config.Queue
	if err := json.NewDecoder(r.Body).Decode(&updated); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest)
		return
	}
	updated.ID = id

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	for i, q := range s.rcCfg.Rclone.Queues {
		if q.ID == id {
			s.rcCfg.Rclone.Queues[i] = updated
			if err := s.saveConfig(); err != nil {
				jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
				return
			}
			jsonOK(w, updated)
			return
		}
	}
	jsonErr(w, "queue not found", http.StatusNotFound)
}

func (s *Server) handleDeleteQueue(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rcCfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}
	queues := s.rcCfg.Rclone.Queues
	for i, q := range queues {
		if q.ID == id {
			s.rcCfg.Rclone.Queues = append(queues[:i], queues[i+1:]...)
			if err := s.saveConfig(); err != nil {
				jsonErr(w, "save error: "+err.Error(), http.StatusInternalServerError)
				return
			}
			jsonOK(w, map[string]string{"deleted": id})
			return
		}
	}
	jsonErr(w, "queue not found", http.StatusNotFound)
}

func (s *Server) handleRunQueue(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	s.mu.RLock()
	cfg := s.rcCfg
	s.mu.RUnlock()
	if cfg == nil {
		jsonErr(w, "locked", http.StatusUnauthorized)
		return
	}

	var queue *config.Queue
	for i := range cfg.Rclone.Queues {
		if cfg.Rclone.Queues[i].ID == id {
			queue = &cfg.Rclone.Queues[i]
			break
		}
	}
	if queue == nil {
		jsonErr(w, "queue not found", http.StatusNotFound)
		return
	}

	// Validate all referenced jobs exist.
	jobMap := make(map[string]*config.Job, len(cfg.Rclone.Jobs))
	for i := range cfg.Rclone.Jobs {
		jobMap[cfg.Rclone.Jobs[i].ID] = &cfg.Rclone.Jobs[i]
	}
	var missing []string
	for _, jid := range queue.JobIDs {
		if _, ok := jobMap[jid]; !ok {
			missing = append(missing, jid)
		}
	}
	if len(missing) > 0 {
		jsonErr(w, fmt.Sprintf("missing job IDs: %v", missing), http.StatusUnprocessableEntity)
		return
	}

	// Build job slots with names.
	slots := make([]runner.QueueJobResult, len(queue.JobIDs))
	for i, jid := range queue.JobIDs {
		slots[i] = runner.QueueJobResult{
			JobID:   jid,
			JobName: jobMap[jid].DisplayName(),
		}
	}

	cfgSnapshot := cfg
	onFailure := queue.OnFailure
	queueID := queue.ID
	queueName := queue.Name

	startJobFn := func(jobID, jobName string) (*runner.Run, error) {
		var job *config.Job
		for i := range cfgSnapshot.Rclone.Jobs {
			if cfgSnapshot.Rclone.Jobs[i].ID == jobID {
				job = &cfgSnapshot.Rclone.Jobs[i]
				break
			}
		}
		if job == nil {
			return nil, fmt.Errorf("job %q not found", jobID)
		}

		argv, err := remotes.AssembleArgv(s.src, cfgSnapshot, job, false, false)
		if err != nil {
			return nil, fmt.Errorf("assemble argv: %w", err)
		}
		cmdline := remotes.RedactedCmdline(s.cfg.RclonePath, argv)
		extraEnv := s.src.Env(cfgSnapshot.Rclone.Providers)

		return s.runs.Start(
			s.cfg.RclonePath,
			argv,
			cmdline,
			jobID,
			jobName,
			extraEnv,
			os.Environ(),
			func(run *runner.Run) {
				s.mu.Lock()
				if s.rcCfg != nil && !run.FinishedAt.IsZero() {
					for i := range s.rcCfg.Rclone.Jobs {
						if s.rcCfg.Rclone.Jobs[i].ID == run.JobID {
							t := run.FinishedAt
							s.rcCfg.Rclone.Jobs[i].LastRunAt = &t
							s.rcCfg.Rclone.Jobs[i].LastRunStatus = string(run.Status)
							_ = s.saveConfig()
							break
						}
					}
				}
				s.mu.Unlock()
			},
		)
	}

	queueRun, err := s.queueRuns.Start(
		queueID,
		queueName,
		slots,
		onFailure,
		startJobFn,
		func() { s.sessions.SetRunActive(false) },
	)
	if err != nil {
		if strings.Contains(err.Error(), "conflict") {
			jsonErr(w, "queue is already running", http.StatusConflict)
			return
		}
		jsonErr(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.sessions.SetRunActive(true)

	jsonOK(w, map[string]string{"queueRunId": queueRun.ID})
}

func (s *Server) handleGetQueueRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	qr, ok := s.queueRuns.Get(id)
	if !ok {
		jsonErr(w, "queue run not found", http.StatusNotFound)
		return
	}
	snap := qr.Snapshot()
	jsonOK(w, snap)
}

func (s *Server) handleStopQueueRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.queueRuns.Stop(id); err != nil {
		jsonErr(w, err.Error(), http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]string{"status": "canceling"})
}

// ---- Backends (rclone config providers) ----

var (
	backendsCache     []map[string]interface{}
	backendsCacheOnce sync.Once
)

func (s *Server) handleBackends(w http.ResponseWriter, r *http.Request) {
	backendsCacheOnce.Do(func() {
		backendsCache = s.loadBackends()
	})
	jsonOK(w, backendsCache)
}

func (s *Server) loadBackends() []map[string]interface{} {
	parts := strings.Fields(s.cfg.RclonePath)
	parts = append(parts, "config", "providers")
	out, err := execCommand(parts[0], parts[1:]...).Output()
	if err != nil {
		log.Printf("rclone config providers: %v (degraded to empty list)", err)
		return nil
	}
	var result []map[string]interface{}
	if err := json.Unmarshal(out, &result); err != nil {
		log.Printf("parse rclone backends: %v", err)
		return nil
	}
	return result
}

// ---- Config persistence ----

// saveConfig re-encrypts the YAML and writes it atomically. Must be called
// with s.mu held for writing.
func (s *Server) saveConfig() error {
	data, err := config.MarshalConfig(s.rcCfg)
	if err != nil {
		return err
	}
	return secret.EncryptAuto(s.cfg.ConfigPath, s.passphrase, data)
}

// execCommand wraps exec.Command so the import is used.
var execCommand = exec.Command

// ---- Helpers ----

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// providerToFlat returns a flat JSON-friendly map with "name", "type", and all
// Extra fields at the top level — matching the shape the JS UI expects.
func providerToFlat(name string, p config.Provider) map[string]interface{} {
	m := make(map[string]interface{}, len(p.Extra)+2)
	m["name"] = name
	m["type"] = p.Type
	for k, v := range p.Extra {
		m[k] = v
	}
	return m
}

// providerFromFlat builds a Provider from the flat JSON map the JS UI sends.
// Keys "name" and "type" are reserved; everything else goes into Extra.
func providerFromFlat(flat map[string]string) config.Provider {
	p := config.Provider{
		Type:  flat["type"],
		Extra: make(map[string]string),
	}
	for k, v := range flat {
		if k == "name" || k == "type" {
			continue
		}
		p.Extra[k] = v
	}
	return p
}
