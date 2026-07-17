package runner

import (
	"sync"
	"time"
)

// WatchInterval is how often a watched job is re-run. rclone's copy/sync
// commands already diff before transferring, so re-running on a fixed timer
// is sufficient — no filesystem event watching is needed.
const WatchInterval = 10 * time.Second

// WatchManager tracks in-memory "watch" tickers, one per job ID that has
// watch mode turned on. State is not persisted: watches stop when the
// server locks or restarts.
type WatchManager struct {
	mu      sync.Mutex
	watches map[string]chan struct{}
}

func NewWatchManager() *WatchManager {
	return &WatchManager{watches: make(map[string]chan struct{})}
}

// Start begins watching jobID, invoking tick every WatchInterval until
// Stop(jobID) is called. Returns false if jobID is already being watched.
func (wm *WatchManager) Start(jobID string, tick func()) bool {
	wm.mu.Lock()
	if _, exists := wm.watches[jobID]; exists {
		wm.mu.Unlock()
		return false
	}
	stop := make(chan struct{})
	wm.watches[jobID] = stop
	wm.mu.Unlock()

	go func() {
		ticker := time.NewTicker(WatchInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				tick()
			}
		}
	}()
	return true
}

// Stop ends the watch for jobID, if any. Returns whether a watch was active.
func (wm *WatchManager) Stop(jobID string) bool {
	wm.mu.Lock()
	stop, exists := wm.watches[jobID]
	if exists {
		delete(wm.watches, jobID)
	}
	wm.mu.Unlock()
	if exists {
		close(stop)
	}
	return exists
}

// IsWatching reports whether jobID currently has an active watch.
func (wm *WatchManager) IsWatching(jobID string) bool {
	wm.mu.Lock()
	defer wm.mu.Unlock()
	_, exists := wm.watches[jobID]
	return exists
}

// StopAll ends every active watch.
func (wm *WatchManager) StopAll() {
	wm.mu.Lock()
	stops := make([]chan struct{}, 0, len(wm.watches))
	for id, stop := range wm.watches {
		stops = append(stops, stop)
		delete(wm.watches, id)
	}
	wm.mu.Unlock()
	for _, stop := range stops {
		close(stop)
	}
}
