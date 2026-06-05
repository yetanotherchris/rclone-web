/* rclone-web — run flow: trigger a job, confirm destructive commands, poll the log. */
'use strict';

import { state } from './state.js';
import { api } from './api.js';
import { showScreen } from './screens.js';

const DESTRUCTIVE = ['sync', 'move'];

export function startRunFlow(jobId, dryRun) {
  state.pendingRunJobId = jobId;
  state.pendingRunDryRun = dryRun;

  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;

  // Show run screen
  document.getElementById('run-title').textContent = `Run · ${job.name}${dryRun ? ' (dry-run)' : ''}`;
  document.getElementById('run-started').textContent = '';
  document.getElementById('run-cmdline').textContent = '';
  document.getElementById('run-log').textContent = '';
  document.getElementById('run-log-panel').classList.add('hidden');
  document.getElementById('run-status-badge').textContent = 'preparing…';
  document.getElementById('run-status-badge').className = 'rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700';
  document.getElementById('stop-btn').classList.remove('hidden');

  if (!dryRun && DESTRUCTIVE.includes(job.command)) {
    document.getElementById('confirm-cmd').textContent = job.command;
    document.getElementById('confirm-box').classList.remove('hidden');
    showScreen('run');
  } else {
    document.getElementById('confirm-box').classList.add('hidden');
    showScreen('run');
    proceedWithRun();
  }
}

export async function proceedWithRun() {
  document.getElementById('confirm-box').classList.add('hidden');

  try {
    const qs = state.pendingRunDryRun ? '?dryRun=true' : '';
    const data = await api('POST', `/api/jobs/${state.pendingRunJobId}/run${qs}`);
    if (!data) return;
    state.currentRun = { id: data.runId, jobId: state.pendingRunJobId };

    // Fetch initial run state
    const run = await api('GET', `/api/runs/${data.runId}`);
    if (!run) return;

    document.getElementById('run-started').textContent = `Started ${new Date(run.startedAt).toLocaleTimeString()}`;
    document.getElementById('run-cmdline').textContent = run.cmdline || '';
    document.getElementById('run-log-panel').classList.remove('hidden');

    startPoll(data.runId);
  } catch (err) {
    document.getElementById('run-status-badge').textContent = 'error';
    document.getElementById('run-status-badge').className = 'rounded-full bg-rose-100 px-3 py-1 text-sm font-medium text-rose-700';
    alert('Start run failed: ' + err.message);
  }
}

function startPoll(runId) {
  stopPoll();
  let since = 0;

  async function poll() {
    try {
      const data = await api('GET', `/api/runs/${runId}/log?since=${since}`);
      if (!data) return;

      if (data.lines && data.lines.length) {
        const pre = document.getElementById('run-log');
        pre.textContent += data.lines.join('\n') + '\n';
        pre.scrollTop = pre.scrollHeight;
      }
      since = data.next;
      document.getElementById('poll-tick').textContent = `since=${since}`;

      updateRunStatusBadge(data.status);

      if (data.status !== 'running') {
        stopPoll();
        document.getElementById('stop-btn').classList.add('hidden');
        // Refresh jobs to update last-run status
        state.jobs = await api('GET', '/api/jobs') || state.jobs;
        return;
      }

      state.pollTimer = setTimeout(poll, 1000);
    } catch { /* ignore */ }
  }

  poll();
}

export function stopPoll() {
  if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
}

function updateRunStatusBadge(status) {
  const el = document.getElementById('run-status-badge');
  const map = {
    running:  ['bg-blue-100 text-blue-700',    'running…'],
    success:  ['bg-emerald-100 text-emerald-700', 'success · exit 0'],
    failed:   ['bg-rose-100 text-rose-700',     'failed'],
    canceled: ['bg-slate-200 text-slate-600',   'canceled'],
  };
  const [cls, text] = map[status] || ['bg-slate-200 text-slate-600', status];
  el.className = `rounded-full px-3 py-1 text-sm font-medium ${cls}`;
  el.textContent = text;
}

export async function stopRun() {
  if (!state.currentRun) return;
  try {
    await api('POST', `/api/runs/${state.currentRun.id}/stop`);
  } catch { /* ignore */ }
}
