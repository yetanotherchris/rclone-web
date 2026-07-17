package session

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

const (
	cookieName = "rclone-web-session"
	csrfHeader = "X-CSRF-Token"
)

type Session struct {
	Token     string
	CSRFToken string
	CreatedAt time.Time
}

// Store holds the single active session and the decrypted in-memory state.
type Store struct {
	mu           sync.RWMutex
	session      *Session
	lastActivity time.Time
	activeRuns   int // count of in-flight job/queue runs; pauses idle timer while > 0

	idleTimeout time.Duration
	onLock      func() // called when the store auto-locks
}

func NewStore(idleTimeout time.Duration, onLock func()) *Store {
	return &Store{
		idleTimeout: idleTimeout,
		onLock:      onLock,
	}
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// Create creates a new session, replacing any existing one.
func (s *Store) Create() *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := &Session{
		Token:     randHex(32),
		CSRFToken: randHex(32),
		CreatedAt: time.Now(),
	}
	s.session = sess
	s.lastActivity = time.Now()
	return sess
}

// Validate checks if the request carries a valid session cookie.
// Returns "" if invalid, or the CSRF token if valid.
func (s *Store) Validate(r *http.Request) (csrfToken string, ok bool) {
	c, err := r.Cookie(cookieName)
	if err != nil || c.Value == "" {
		return "", false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.session == nil || s.session.Token != c.Value {
		return "", false
	}
	return s.session.CSRFToken, true
}

// ValidateCSRF checks both the session cookie and the X-CSRF-Token header.
func (s *Store) ValidateCSRF(r *http.Request) bool {
	csrfToken, ok := s.Validate(r)
	if !ok {
		return false
	}
	return r.Header.Get(csrfHeader) == csrfToken
}

// Touch records activity (excluding polling endpoints).
func (s *Store) Touch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastActivity = time.Now()
}

// SetRunActive increments or decrements the active-run counter, pausing the
// idle timer while at least one run is active. Overlapping runs (e.g. two
// watched jobs mid-run at once) are tracked independently, so the timer only
// resumes once the last one finishes.
func (s *Store) SetRunActive(active bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if active {
		s.activeRuns++
		return
	}
	if s.activeRuns > 0 {
		s.activeRuns--
	}
	if s.activeRuns == 0 {
		// Resume the idle timer from now so a just-completed run doesn't
		// immediately trigger a lock.
		s.lastActivity = time.Now()
	}
}

// Destroy invalidates the current session.
func (s *Store) Destroy() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.session = nil
}

// IsLocked reports whether there is no active session.
func (s *Store) IsLocked() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.session == nil
}

// SetCookie writes the session cookie to the response.
func (s *Store) SetCookie(w http.ResponseWriter, token string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   secure,
	})
}

// ClearCookie clears the session cookie.
func (s *Store) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

// StartIdleWatcher starts a goroutine that locks the session after idle timeout.
func (s *Store) StartIdleWatcher() {
	go func() {
		tick := time.NewTicker(10 * time.Second)
		defer tick.Stop()
		for range tick.C {
			s.mu.RLock()
			if s.session == nil || s.activeRuns > 0 {
				s.mu.RUnlock()
				continue
			}
			idle := time.Since(s.lastActivity)
			s.mu.RUnlock()
			if idle >= s.idleTimeout {
				s.Destroy()
				if s.onLock != nil {
					s.onLock()
				}
			}
		}
	}()
}

// TimeUntilLock returns the approximate time remaining before auto-lock.
func (s *Store) TimeUntilLock() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.session == nil {
		return 0
	}
	remaining := s.idleTimeout - time.Since(s.lastActivity)
	if remaining < 0 {
		return 0
	}
	return remaining
}
