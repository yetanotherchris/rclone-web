package runner

import (
	"fmt"
	"sync"
	"time"
)

// QueueJobResult tracks one job's execution slot within a QueueRun.
type QueueJobResult struct {
	JobID   string     `json:"jobId"`
	JobName string     `json:"jobName"`
	RunID   *string    `json:"runId"`  // nil until job starts
	Status  *RunStatus `json:"status"` // nil until job starts
}

// QueueRun tracks one execution of a queue definition.
type QueueRun struct {
	ID         string           `json:"id"`
	QueueID    string           `json:"queueId"`
	QueueName  string           `json:"queueName"`
	Status     RunStatus        `json:"status"`
	Jobs       []QueueJobResult `json:"jobs"`
	StartedAt  time.Time        `json:"startedAt"`
	FinishedAt *time.Time       `json:"finishedAt"`

	mu           sync.Mutex
	stop         chan struct{}
	stopped      bool   // guards against double-close of stop
	currentRunID string // ID of the Run currently executing
}

// Snapshot returns a consistent copy of the QueueRun safe for JSON encoding.
func (qr *QueueRun) Snapshot() QueueRun {
	qr.mu.Lock()
	defer qr.mu.Unlock()
	snap := QueueRun{
		ID:         qr.ID,
		QueueID:    qr.QueueID,
		QueueName:  qr.QueueName,
		Status:     qr.Status,
		StartedAt:  qr.StartedAt,
		FinishedAt: qr.FinishedAt,
	}
	snap.Jobs = make([]QueueJobResult, len(qr.Jobs))
	for i, j := range qr.Jobs {
		snap.Jobs[i] = QueueJobResult{JobID: j.JobID, JobName: j.JobName}
		if j.RunID != nil {
			s := *j.RunID
			snap.Jobs[i].RunID = &s
		}
		if j.Status != nil {
			s := *j.Status
			snap.Jobs[i].Status = &s
		}
	}
	return snap
}

// QueueManager manages in-memory queue runs.
type QueueManager struct {
	mu     sync.Mutex
	runs   map[string]*QueueRun
	jobMgr *Manager
}

func NewQueueManager(jobMgr *Manager) *QueueManager {
	return &QueueManager{
		runs:   make(map[string]*QueueRun),
		jobMgr: jobMgr,
	}
}

// Start launches a new QueueRun. Returns an error if the queue is already running.
// startJob is called for each job in order; it must start the rclone subprocess and
// return the resulting Run.
func (qm *QueueManager) Start(
	queueID, queueName string,
	slots []QueueJobResult,
	onFailure string,
	startJob func(jobID, jobName string) (*Run, error),
	onDone func(),
) (*QueueRun, error) {
	qm.mu.Lock()
	for _, qr := range qm.runs {
		if qr.QueueID == queueID {
			qr.mu.Lock()
			running := qr.Status == StatusRunning
			qr.mu.Unlock()
			if running {
				qm.mu.Unlock()
				return nil, fmt.Errorf("conflict: queue %q is already running", queueID)
			}
		}
	}

	qr := &QueueRun{
		ID:        fmt.Sprintf("qr%x", time.Now().UnixNano()),
		QueueID:   queueID,
		QueueName: queueName,
		Status:    StatusRunning,
		Jobs:      slots,
		StartedAt: time.Now(),
		stop:      make(chan struct{}),
	}
	qm.runs[qr.ID] = qr
	qm.mu.Unlock()

	go qm.execute(qr, onFailure, startJob, onDone)
	return qr, nil
}

// Get returns a queue run by ID.
func (qm *QueueManager) Get(id string) (*QueueRun, bool) {
	qm.mu.Lock()
	defer qm.mu.Unlock()
	qr, ok := qm.runs[id]
	return qr, ok
}

// Stop cancels a running queue run and the job currently executing within it.
func (qm *QueueManager) Stop(queueRunID string) error {
	qm.mu.Lock()
	qr, ok := qm.runs[queueRunID]
	qm.mu.Unlock()
	if !ok {
		return fmt.Errorf("queue run %q not found", queueRunID)
	}

	qr.mu.Lock()
	if qr.stopped || qr.Status != StatusRunning {
		qr.mu.Unlock()
		return nil
	}
	qr.stopped = true
	qr.mu.Unlock()

	close(qr.stop)
	return nil
}

// LatestForQueue returns the most recently started QueueRun for a given queue ID,
// or nil if none exists.
func (qm *QueueManager) LatestForQueue(queueID string) *QueueRun {
	qm.mu.Lock()
	defer qm.mu.Unlock()
	var latest *QueueRun
	for _, qr := range qm.runs {
		if qr.QueueID == queueID {
			if latest == nil || qr.StartedAt.After(latest.StartedAt) {
				latest = qr
			}
		}
	}
	return latest
}

func (qm *QueueManager) execute(
	qr *QueueRun,
	onFailure string,
	startJob func(jobID, jobName string) (*Run, error),
	onDone func(),
) {
	finalStatus := StatusSuccess

	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()

	for i := range qr.Jobs {
		// Check stop before launching next job.
		select {
		case <-qr.stop:
			finalStatus = StatusCanceled
			goto done
		default:
		}

		jobID := qr.Jobs[i].JobID
		jobName := qr.Jobs[i].JobName

		run, err := startJob(jobID, jobName)
		if err != nil {
			failed := StatusFailed
			qr.mu.Lock()
			qr.Jobs[i].Status = &failed
			qr.mu.Unlock()
			if onFailure == "stop" {
				finalStatus = StatusFailed
				goto done
			}
			finalStatus = StatusFailed
			continue
		}

		runID := run.ID
		qr.mu.Lock()
		qr.Jobs[i].RunID = &runID
		running := StatusRunning
		qr.Jobs[i].Status = &running
		qr.currentRunID = runID
		qr.mu.Unlock()

		// Wait for run to complete, honouring stop requests.
	pollLoop:
		for {
			select {
			case <-qr.stop:
				_ = qm.jobMgr.Stop(run.ID)
				// Wait briefly for the run to settle after cancellation.
				for j := 0; j < 30; j++ {
					run.mu.Lock()
					s := run.Status
					run.mu.Unlock()
					if s != StatusRunning {
						break
					}
					time.Sleep(50 * time.Millisecond)
				}
				run.mu.Lock()
				s := run.Status
				run.mu.Unlock()
				qr.mu.Lock()
				qr.Jobs[i].Status = &s
				qr.currentRunID = ""
				qr.mu.Unlock()
				finalStatus = StatusCanceled
				goto done

			case <-tick.C:
				run.mu.Lock()
				s := run.Status
				run.mu.Unlock()
				if s == StatusRunning {
					continue
				}
				qr.mu.Lock()
				qr.Jobs[i].Status = &s
				qr.currentRunID = ""
				qr.mu.Unlock()
				if s == StatusFailed || s == StatusCanceled {
					if onFailure == "stop" {
						if s == StatusFailed {
							finalStatus = StatusFailed
						} else {
							finalStatus = StatusCanceled
						}
						goto done
					}
					if finalStatus != StatusFailed {
						if s == StatusFailed {
							finalStatus = StatusFailed
						} else if finalStatus == StatusSuccess {
							finalStatus = StatusCanceled
						}
					}
				}
				break pollLoop
			}
		}
	}

done:
	t := time.Now()
	qr.mu.Lock()
	qr.Status = finalStatus
	qr.FinishedAt = &t
	qr.mu.Unlock()

	if onDone != nil {
		onDone()
	}
}
