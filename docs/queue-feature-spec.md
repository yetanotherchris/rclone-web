# Queue Feature Spec

## Overview

A **Queue** is an ordered list of jobs that run sequentially. Users build queues
in the UI, reorder jobs with up/down arrows, and launch the whole sequence with a
single Run button. Each queue run stores per-job logs in memory (never persisted)
and surfaces them as tabs in a dedicated run view.

---

## Naming

The feature is called **Queue** throughout (sidebar label, API paths, YAML key).
Alternative names considered: *Pipeline*, *Workflow*. Queue was chosen as the
most intuitive term for a sequential job list.

---

## YAML Schema

Queues are stored as an array in the existing encrypted config file alongside
`jobs` and `providers`. Jobs already have IDs (`j0`, `j1`, `r<hex>`, etc.);
no schema change is needed there.

```yaml
rclone-web:
  jobs:
    - id: j0
      name: "Archive Photos"
      ...
    - id: j1
      name: "Sync Music"
      ...

  queues:
    - id: q0
      name: "Nightly Backup"
      job_ids:
        - j0
        - j1
      on_failure: continue  # "continue" (default) | "stop"
```

### Queue fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | auto | Auto-assigned (`q0`, `q1`, …) if absent |
| `name` | string | yes | Human-readable label |
| `job_ids` | []string | yes | Ordered list of job IDs to run |
| `on_failure` | string | no | `continue` (default) or `stop` |

`last_run_at` / `last_run_status` are **not** persisted for queues — the last run
is held in memory only and lost on server restart, matching the design intent.

---

## Go Implementation

### Config model (`internal/config/model.go`)

Add `Queue` struct and `Queues []Queue` field to `RcloneSection`.

```go
type Queue struct {
    ID        string   `yaml:"id"`
    Name      string   `yaml:"name"`
    JobIDs    []string `yaml:"job_ids"`
    OnFailure string   `yaml:"on_failure,omitempty"` // "stop" | "continue"
}
```

`ParseConfig` auto-assigns missing queue IDs (`q0`, `q1`, …) using the same
pattern as job IDs.

### Queue runner (`internal/runner/queue.go`)

A `QueueRun` tracks one execution of a queue definition:

```go
type QueueJobResult struct {
    JobID   string
    JobName string
    RunID   string    // ID of the Run created for this job
    Status  RunStatus // mirrors the underlying Run.Status
}

type QueueRun struct {
    ID        string
    QueueID   string
    QueueName string
    Status    RunStatus          // overall: running/success/failed/canceled
    Jobs      []QueueJobResult   // one entry per job, in order
    StartedAt time.Time
    FinishedAt time.Time

    stop chan struct{}  // closed to request cancellation
}
```

**Execution goroutine** (one per `QueueRun`):

```
for each jobID in queue.JobIDs:
    create Run via runs.Manager.Start(...)
    wait for run to finish (poll Run.Status or use done channel)
    record result in QueueRun.Jobs
    if run failed and onFailure == "stop":
        break
    select { case <-stop: break; default: }
set QueueRun.Status and FinishedAt
```

Cancellation: closing `stop` causes the loop to abort after the current job
finishes its own graceful cancel (the current `Run` is cancelled via
`runs.Manager.Stop()`).

A `QueueManager` mirrors `runner.Manager`:

```go
type QueueManager struct {
    mu       sync.Mutex
    runs     map[string]*QueueRun  // keyed by QueueRun.ID
    jobMgr   *Manager              // shared runs.Manager for individual jobs
}
```

Methods: `Start`, `Get`, `Stop`, `ListRecent`. `Start` returns an error if that
specific queue already has a run in `running` state — different queues may run
concurrently.

### API endpoints (`internal/server/server.go`)

**Queue CRUD (persist to YAML):**

| Method | Path | CSRF | Purpose |
|--------|------|------|---------|
| GET | `/api/queues` | ✓ | List all queue definitions |
| POST | `/api/queues` | ✓ | Create queue |
| GET | `/api/queues/{id}` | ✓ | Get queue definition |
| PUT | `/api/queues/{id}` | ✓ | Update (rename, reorder, on_failure) |
| DELETE | `/api/queues/{id}` | ✓ | Delete queue definition |

**Queue execution:**

| Method | Path | CSRF | Purpose |
|--------|------|------|---------|
| POST | `/api/queues/{id}/run` | ✓ | Start queue run → `{queueRunId}` |
| GET | `/api/queue-runs/{id}` | ✓ | Queue run status + per-job results |
| POST | `/api/queue-runs/{id}/stop` | ✓ | Cancel queue (and current job) |

`GET /api/queue-runs/{id}` response:

```json
{
  "id": "qr_abc123",
  "queueId": "q0",
  "queueName": "Nightly Backup",
  "status": "running",
  "startedAt": "2026-06-06T02:00:00Z",
  "finishedAt": null,
  "jobs": [
    { "jobId": "j0", "jobName": "Archive Photos", "runId": "r_abc", "status": "success" },
    { "jobId": "j1", "jobName": "Sync Music",     "runId": "r_def", "status": "running" },
    { "jobId": "j2", "jobName": "Verify Hashes",  "runId": null,    "status": null }
  ]
}
```

Individual job logs are fetched via the existing `/api/runs/{runId}/log` endpoint.

**In-memory state:**  The `Server` struct gains a `queueRuns *runner.QueueManager`.
The last `QueueRun` per queue ID is accessible via `queueRuns.LatestForQueue(queueId)`.
`GET /api/queues/{id}` includes a `lastQueueRunId` field (null if none in memory).

---

## UI

### Left sidebar

New item **Queues** added between Jobs and Providers.

### Queues list screen (`data-screen="queues"`)

Table with columns: Name | Jobs (count) | On Failure | Status | Actions.

**Status cell** is the primary navigation affordance for run history:
- No run yet → plain "—" (not interactive)
- Currently running → **[⟳ running]** button → navigates to the active run screen
- Completed → **[✓ success]** / **[✗ failed]** / **[⊘ canceled]** button → navigates to the last run screen

Actions per row: **Edit** · **Delete** · **Run**. No dry-run for queues.
The **Run** button is disabled (greyed out) while that queue has an active run;
it re-enables when the run finishes or is stopped. Status is checked on page load
and after each poll cycle.

- **Run** → `POST /api/queues/{id}/run`, then navigates to the queue run screen.

### Queue form screen (`data-screen="queueform"`)

Fields:
- **Name** (text input)
- **On Failure** (select: Continue on failure (default) / Stop on first failure)
- **Jobs** (ordered list with up ↑ / down ↓ buttons and a remove × button per job)
- **Add job** (dropdown of all defined jobs, "+ Add" button appends to list)

Save → `POST /api/queues` (create) or `PUT /api/queues/{id}` (edit).

### Queue run detail screen (`data-screen="queuerun"`)

Reached by clicking the status button in the queues list or dashboard, or
immediately after clicking **Run**.

Shows a summary table of all jobs in the queue run and their outcome. From here
the user drills into per-job logs.

Layout:

```
┌──────────────────────────────────────────────────────┐
│  Nightly Backup          [Stop]        [⟳ running]   │
│  Started 14:02 · 1m 23s elapsed                      │
│                                                       │
│  Job               Status       Actions               │
│  ─────────────────────────────────────────────       │
│  Archive Photos    ✓ success    [View logs]           │
│  Sync Music        ⟳ running   [View logs]           │
│  Verify Hashes     — pending    —                     │
└──────────────────────────────────────────────────────┘
```

**Table columns:** Job name | Status | Actions.

Status values: ⟳ running · ✓ success · ✗ failed · — pending · ⊘ canceled.

**View logs** button appears for any job that has started (status is not
pending). Clicking it navigates to the queue logs screen, opening directly on
that job.

**Header:**
- Queue name
- Overall status badge
- **Stop** button (visible while running; calls `/api/queue-runs/{id}/stop`)
- Start time + elapsed (while running) or total duration (when finished)

**Polling:** While `running`, polls `GET /api/queue-runs/{id}` every 2 s to
refresh job statuses. Stops when the overall status leaves `running`.

---

### Queue logs screen (`data-screen="queuelogs"`)

Reached from the **View logs** button on the queue run detail screen.

Shows the raw log output for one job, with a dropdown to switch to any other
job's log without leaving the screen.

Layout:

```
┌──────────────────────────────────────────────────────┐
│  ← Nightly Backup                                    │
│                                                       │
│  Job: [ Sync Music ⟳ running ▾ ]                     │
│                                                       │
│  [ log output ]                                       │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

**Job dropdown:** Lists all jobs in queue order with their current status icon.
Selecting a different job immediately switches the log panel to that job's
output. Only jobs that have started appear as selectable options; pending jobs
are shown as disabled options.

**Log panel:** Polls `/api/runs/{runId}/log?since=N` every 1 s while the
selected job is `running`. Stops polling when the job finishes. Jobs not yet
started show "Waiting…".

**Back link** (← Nightly Backup) returns to the queue run detail screen.

**"Not yet run" state:** If the status button is clicked with no in-memory run,
show a message: *"This queue has not been run since the server started."* with a
**Run** button.

### Dashboard changes

The dashboard gains a **Queues** section below the existing Jobs table, rendered
as its own titled block:

```
Jobs
┌──────────────────────────────────────────────────────────┐
│ Name            Command  Last Run         Actions         │
│ Archive Photos  copy     ✓ 2 hours ago    [Run] [Dry-run] │
│ Sync Music      sync     ✗ 1 day ago      [Run] [Dry-run] │
└──────────────────────────────────────────────────────────┘

Queues
┌────────────────────────────────────────────────────────────┐
│ Name             Jobs  Status              Actions          │
│ Nightly Backup   3     [⟳ running]         [Run (disabled)] │
│ Weekly Archive   5     [✓ success]         [Run]            │
│ Monthly Purge    2     —                   [Run]            │
└────────────────────────────────────────────────────────────┘
```

Columns: Name | Jobs (count) | Status | Actions.

- **Status button** → navigates to the run screen for that queue's last (or active) run. Plain "—" when never run.
- **Run** → `POST /api/queues/{id}/run`, then navigate to queue run screen. Disabled while that queue is actively running.

No dry-run button for queues. The Queues section is only rendered if at least
one queue is defined.

---

## Idle timer

While a queue run is active, `sessions.SetRunActive(true)` is called (same as
individual job runs). It is set back to `false` when the last job in the queue
finishes or the queue is stopped.

---

## Error / edge cases

| Case | Behaviour |
|------|-----------|
| Job deleted after being added to queue | `POST /api/queues/{id}/run` returns 422 listing missing job IDs |
| Same queue already running | `POST /api/queues/{id}/run` returns 409 Conflict — a queue cannot run twice simultaneously; different queues may run concurrently |
| Individual job cancel via `/api/runs/{id}/stop` during queue | Queue detects job failed/canceled, applies `on_failure` logic |
| Server restart mid-run | All in-memory run state is lost; queue definition survives in YAML |

---

## Out of scope (future)

- Drag-to-reorder (up/down buttons cover the need for now)
- Scheduled / cron queues
- Parallel job execution within a queue
- Persisted queue run history
- Notifications on queue completion
