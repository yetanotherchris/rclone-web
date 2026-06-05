package runner

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"sync"
	"time"
)

// RunStatus represents the current state of a run.
type RunStatus string

const (
	StatusRunning  RunStatus = "running"
	StatusSuccess  RunStatus = "success"
	StatusFailed   RunStatus = "failed"
	StatusCanceled RunStatus = "canceled"
)

const ringBufferCap = 2000

// Run holds state for a single job execution.
type Run struct {
	ID         string
	JobID      string
	JobName    string
	Cmdline    string
	Status     RunStatus
	ExitCode   int
	StartedAt  time.Time
	FinishedAt time.Time
	PID        int

	mu     sync.Mutex
	log    []string
	logOff int // total lines appended (monotonic cursor)
	cancel context.CancelFunc
}

// AppendLog adds a line to the ring buffer.
func (r *Run) AppendLog(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	idx := r.logOff % ringBufferCap
	if len(r.log) < ringBufferCap {
		r.log = append(r.log, line)
	} else {
		r.log[idx] = line
	}
	r.logOff++
}

// LogSince returns all log lines with index >= since, and the new cursor.
func (r *Run) LogSince(since int) (lines []string, next int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if since >= r.logOff {
		return nil, r.logOff
	}
	start := since
	if start < r.logOff-ringBufferCap {
		start = r.logOff - ringBufferCap
	}
	lines = make([]string, 0, r.logOff-start)
	for i := start; i < r.logOff; i++ {
		lines = append(lines, r.log[i%ringBufferCap])
	}
	return lines, r.logOff
}

// Manager owns all in-memory runs.
type Manager struct {
	mu   sync.Mutex
	runs map[string]*Run
}

func NewManager() *Manager {
	return &Manager{runs: make(map[string]*Run)}
}

// Start launches rclone as a subprocess and returns the Run.
func (m *Manager) Start(
	rclonePath string,
	argv []string,
	cmdline string,
	jobID, jobName string,
	extraEnv []string,
	baseEnv []string,
	onDone func(r *Run),
) (*Run, error) {
	ctx, cancel := context.WithCancel(context.Background())

	run := &Run{
		ID:        fmt.Sprintf("r%x", time.Now().UnixNano()),
		JobID:     jobID,
		JobName:   jobName,
		Cmdline:   cmdline,
		Status:    StatusRunning,
		StartedAt: time.Now(),
		cancel:    cancel,
	}

	cmd := exec.CommandContext(ctx, rclonePath, argv...)
	cmd.Env = append(baseEnv, extraEnv...)

	// Combine stdout+stderr via a single pipe.
	pr, pw, err := pipeWithClose()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("pipe: %w", err)
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		cancel()
		return nil, fmt.Errorf("start rclone: %w", err)
	}
	run.PID = cmd.Process.Pid
	pw.Close() // parent closes write end

	m.mu.Lock()
	m.runs[run.ID] = run
	m.mu.Unlock()

	// Drain combined output.
	go func() {
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			run.AppendLog(sc.Text())
		}
		pr.Close()
	}()

	go func() {
		waitErr := cmd.Wait()
		cancel()
		run.mu.Lock()
		run.FinishedAt = time.Now()
		if ctx.Err() != nil && run.Status == StatusRunning {
			run.Status = StatusCanceled
			run.ExitCode = -1
		} else if waitErr != nil {
			run.Status = StatusFailed
			if exitErr, ok := waitErr.(*exec.ExitError); ok {
				run.ExitCode = exitErr.ExitCode()
			} else {
				run.ExitCode = 1
			}
		} else {
			run.Status = StatusSuccess
			run.ExitCode = 0
		}
		run.mu.Unlock()
		if onDone != nil {
			onDone(run)
		}
	}()

	return run, nil
}

// Get returns a run by ID.
func (m *Manager) Get(id string) (*Run, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	return r, ok
}

// Stop cancels a running job.
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	r, ok := m.runs[id]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("run %q not found", id)
	}
	r.mu.Lock()
	if r.Status != StatusRunning {
		r.mu.Unlock()
		return nil
	}
	r.Status = StatusCanceled
	r.mu.Unlock()
	r.cancel()
	return nil
}

// ListRecent returns all known runs, most recent first.
func (m *Manager) ListRecent() []*Run {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]*Run, 0, len(m.runs))
	for _, r := range m.runs {
		result = append(result, r)
	}
	for i := 1; i < len(result); i++ {
		for j := i; j > 0 && result[j].StartedAt.After(result[j-1].StartedAt); j-- {
			result[j], result[j-1] = result[j-1], result[j]
		}
	}
	return result
}
