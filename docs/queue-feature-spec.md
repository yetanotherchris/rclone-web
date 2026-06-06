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

Methods: `Start`, `Get`, `Stop`, `ListRecent`.

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

Table with columns: Name | Jobs (count) | On Failure | Last Run | Actions.

Actions per row: **View** · **Edit** · **Delete** · **Run**.

- **View** → navigates to the queue run screen for the latest in-memory run (or a
  "not yet run" placeholder if none).
- **Run** → `POST /api/queues/{id}/run`, then navigates to the queue run screen.

### Queue form screen (`data-screen="queueform"`)

Fields:
- **Name** (text input)
- **On Failure** (select: Continue on failure (default) / Stop on first failure)
- **Jobs** (ordered list with up ↑ / down ↓ buttons and a remove × button per job)
- **Add job** (dropdown of all defined jobs, "+ Add" button appends to list)

Save → `POST /api/queues` (create) or `PUT /api/queues/{id}` (edit).

### Queue run screen (`data-screen="queuerun"`)

This screen is reached by **View** or after clicking **Run**.

Layout:

```
┌─────────────────────────────────────────────────┐
│  Nightly Backup                [Stop] [● running]│
│                                                   │
│  View logs for: [ Sync Music ✓ ▾ ]               │
│                                                   │
│  [ log output for selected job ]                  │
│  ...                                              │
└─────────────────────────────────────────────────┘
```

**Job selector:** A `<select>` dropdown listing each job in queue order. Each
option shows the job name and its status icon:
- ⟳ running · ✓ success · ✗ failed · — pending · ⊘ canceled

The dropdown auto-advances to the currently running job as the queue progresses.
Selecting a different option immediately switches the log panel to that job's
output.

**Selecting a job** displays the log for that job's `Run` (polling
`/api/runs/{runId}/log?since=N` every 1 s while status is `running`, stopping
when finished). Jobs not yet started show "Waiting…" in the log panel.

**Header:**
- Queue name
- Overall status badge (same states as job runs)
- **Stop** button (visible while running; calls `/api/queue-runs/{id}/stop`)
- Start time + elapsed / finish time

**Polling:** While the queue run is `running`, the screen polls
`GET /api/queue-runs/{id}` every 2 s to update dropdown option labels and detect
completion. On completion, polling stops.

**"Not yet run" state:** If navigated to from View with no in-memory run, show a
message: *"This queue has not been run since the server started. Click Run to
start it."* with a Run button.

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
┌──────────────────────────────────────────────────────────┐
│ Name             Jobs  Last Run         Actions           │
│ Nightly Backup   3     ✓ 2 hours ago    [View] [Run]      │
│ Weekly Archive   5     — never          [View] [Run]      │
└──────────────────────────────────────────────────────────┘
```

Columns: Name | Jobs (count) | Last Run (status badge + relative time, or "—
never") | Actions.

Actions:
- **View** → queue run screen (latest in-memory run, or "not yet run" message)
- **Run** → `POST /api/queues/{id}/run`, then navigate to queue run screen

The Queues section is only rendered if at least one queue is defined.

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
| Queue run already active | `POST /api/queues/{id}/run` returns 409 Conflict |
| Individual job cancel via `/api/runs/{id}/stop` during queue | Queue detects job failed/canceled, applies `on_failure` logic |
| Server restart mid-run | All in-memory run state is lost; queue definition survives in YAML |

---

## Out of scope (future)

- Drag-to-reorder (up/down buttons cover the need for now)
- Scheduled / cron queues
- Parallel job execution within a queue
- Persisted queue run history
- Dry-run mode for full queues (individual jobs support it; queue does not)
- Notifications on queue completion
