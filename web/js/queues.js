/* rclone-web — queues list, queue form, queue run detail, queue logs. */
'use strict';

import dragula from 'dragula';
import { state } from './state.js';
import { api } from './api.js';
import { esc, showError, clearError } from './util.js';
import { showScreen } from './screens.js';

// Dragula mirror/transit styles (no external CSS file needed).
if (!document.getElementById('rw-dragula-style')) {
  const s = document.createElement('style');
  s.id = 'rw-dragula-style';
  s.textContent = [
    '.gu-mirror{position:fixed!important;margin:0!important;z-index:9999!important;opacity:.95;cursor:grabbing!important;',
    'box-shadow:0 6px 20px rgba(0,0,0,.18);border-radius:6px;background:#fff;border:1px solid #e2e8f0}',
    '.gu-hide{display:none!important}',
    '.gu-unselectable{user-select:none!important}',
    '.gu-transit{opacity:.5;border:2px dashed #475569!important;border-radius:4px}',
    '.rw-drag-item{cursor:grab}',
    '.rw-drag-item:active{cursor:grabbing}',
    '.rw-drag-active{background:#f1f5f9;border-radius:6px;transition:background .15s}',
    '.rw-drag-active .rw-drag-item:not(.gu-transit){opacity:.55;transition:opacity .1s}',
  ].join('');
  document.head.appendChild(s);
}

// ---- Queues list ----

export function renderQueuesList() {
  const tbody = document.getElementById('queues-tbody');
  tbody.innerHTML = '';

  if (!state.queues.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center text-sm text-slate-400">No queues yet.</td></tr>';
    return;
  }

  state.queues.forEach(q => {
    const jobCount = (q.job_ids || []).length;
    const onFail = q.on_failure === 'stop' ? 'Stop on first failure' : 'Continue on failure';
    const statusCell = queueStatusCell(q);
    const isRunning = q.lastQueueRun && q.lastQueueRun.status === 'running';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-5 py-4 font-medium">${esc(q.name)}</td>
      <td class="px-5 py-4 font-mono text-xs text-slate-400">${esc(q.id)}</td>
      <td class="px-5 py-4 text-sm text-slate-500">${jobCount}</td>
      <td class="px-5 py-4 text-sm text-slate-500">${esc(onFail)}</td>
      <td class="px-5 py-4">${statusCell}</td>
      <td class="px-5 py-4 text-right space-x-2">
        <button class="edit-queue-btn text-xs font-medium text-brand-600 hover:underline" data-queue-id="${esc(q.id)}">Edit</button>
        <button class="delete-queue-btn text-xs font-medium text-rose-600 hover:underline ml-3" data-queue-id="${esc(q.id)}">Delete</button>
        <button class="run-queue-btn ml-3 rounded-lg px-3 py-1.5 text-xs font-medium text-white ${isRunning ? 'bg-slate-400 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-700'}" data-queue-id="${esc(q.id)}" ${isRunning ? 'disabled' : ''}>Run</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.edit-queue-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      populateQueueJobSelect();
      openQueueForm(btn.dataset.queueId);
    })
  );
  tbody.querySelectorAll('.delete-queue-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteQueue(btn.dataset.queueId))
  );
  tbody.querySelectorAll('.run-queue-btn:not([disabled])').forEach(btn =>
    btn.addEventListener('click', () => startQueueRun(btn.dataset.queueId))
  );
  tbody.querySelectorAll('.queue-status-btn').forEach(btn =>
    btn.addEventListener('click', () => openQueueRun(btn.dataset.queueRunId))
  );
}

function queueStatusCell(q) {
  if (!q.lastQueueRun) return '<span class="text-slate-400">—</span>';
  const { id, status } = q.lastQueueRun;
  const map = {
    running:  ['bg-blue-100 text-blue-700',         '⟳ running'],
    success:  ['bg-emerald-100 text-emerald-700',    '✓ success'],
    failed:   ['bg-rose-100 text-rose-700',          '✗ failed'],
    canceled: ['bg-slate-100 text-slate-500',        '⊘ canceled'],
  };
  const [cls, label] = map[status] || ['bg-slate-100 text-slate-500', status];
  return `<button class="queue-status-btn rounded-full ${cls} px-2.5 py-1 text-xs font-medium" data-queue-run-id="${esc(id)}">${label}</button>`;
}

// ---- Queue form ----

export function openQueueForm(queueId) {
  const q = queueId ? state.queues.find(q => q.id === queueId) : null;
  state.editingQueueId = queueId || null;

  document.getElementById('queueform-title').textContent = q ? 'Edit queue' : 'New queue';
  document.getElementById('qf-name').value = q ? (q.name || '') : '';
  document.getElementById('qf-on-failure').checked = q ? (q.on_failure !== 'stop') : true;
  clearError('queueform-error');

  renderQueueJobList(q ? (q.job_ids || []) : []);
  showScreen('queueform');
}

let _drake = null;

function renderQueueJobList(jobIds) {
  const list = document.getElementById('qf-jobs-list');
  list.innerHTML = '';

  if (_drake) {
    _drake.destroy();
    _drake = null;
  }

  jobIds.forEach((jid, idx) => {
    const job = state.jobs.find(j => j.id === jid);
    const name = job ? job.name : jid;
    const item = document.createElement('div');
    item.className = 'rw-drag-item flex items-center gap-2 py-1.5 border-b border-slate-100 select-none';
    item.dataset.jobId = jid;
    item.innerHTML = `
      <span class="text-slate-300 text-base leading-none" title="Drag to reorder">⠿</span>
      <span class="flex-1 text-sm">${esc(name)}</span>
      <button type="button" class="qf-remove-btn text-rose-400 hover:text-rose-600 px-1" data-idx="${idx}" title="Remove">×</button>`;
    list.appendChild(item);
  });

  list.querySelectorAll('.qf-remove-btn').forEach(btn =>
    btn.addEventListener('click', () => removeQueueJob(Number(btn.dataset.idx)))
  );

  // Dragula moves the actual DOM elements on drop, so getQueueJobIds() reads the
  // updated order directly — no re-render needed.
  _drake = dragula([list], {
    moves: (el, _src, handle) => !handle.classList.contains('qf-remove-btn'),
  });
  _drake.on('drag', () => list.classList.add('rw-drag-active'));
  _drake.on('dragend', () => list.classList.remove('rw-drag-active'));
}

function getQueueJobIds() {
  return Array.from(document.getElementById('qf-jobs-list').children)
    .map(el => el.dataset.jobId);
}

function removeQueueJob(idx) {
  const ids = getQueueJobIds();
  ids.splice(idx, 1);
  renderQueueJobList(ids);
}

export function addQueueJob() {
  const sel = document.getElementById('qf-add-job-select');
  const jid = sel.value;
  if (!jid) return;
  const ids = getQueueJobIds();
  if (!ids.includes(jid)) {
    ids.push(jid);
    renderQueueJobList(ids);
  }
}

export function populateQueueJobSelect() {
  const sel = document.getElementById('qf-add-job-select');
  sel.innerHTML = '<option value="">— select a job —</option>';
  state.jobs.forEach(j => {
    const opt = document.createElement('option');
    opt.value = j.id;
    opt.textContent = j.name || j.id;
    sel.appendChild(opt);
  });
}

export async function saveQueue() {
  const id = state.editingQueueId;
  const name = document.getElementById('qf-name').value.trim();
  const onFailure = document.getElementById('qf-on-failure').checked ? '' : 'stop';
  const jobIds = getQueueJobIds();

  if (!name) { showError('queueform-error', 'Name is required'); return; }

  const body = { name, on_failure: onFailure, job_ids: jobIds };
  if (id) body.id = id;

  try {
    if (id) {
      await api('PUT', `/api/queues/${id}`, body);
    } else {
      await api('POST', '/api/queues', body);
    }
    state.queues = await api('GET', '/api/queues') || state.queues;
    showScreen('queues');
  } catch (err) {
    showError('queueform-error', err.message);
  }
}

async function deleteQueue(id) {
  if (!confirm('Delete this queue?')) return;
  try {
    await api('DELETE', `/api/queues/${id}`);
    state.queues = await api('GET', '/api/queues') || state.queues;
    renderQueuesList();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// ---- Queue run ----

export async function startQueueRun(queueId) {
  try {
    const data = await api('POST', `/api/queues/${queueId}/run`);
    if (!data) return;
    // Refresh queue list so the Run button disables.
    state.queues = await api('GET', '/api/queues') || state.queues;
    openQueueRun(data.queueRunId);
  } catch (err) {
    alert('Start queue failed: ' + err.message);
  }
}

export async function openQueueRun(queueRunId) {
  stopQueuePoll();
  state.currentQueueRun = null;
  showScreen('queuerun');

  try {
    const qr = await api('GET', `/api/queue-runs/${queueRunId}`);
    if (!qr) return;
    state.currentQueueRun = qr;
    renderQueueRunDetail(qr);
    if (qr.status === 'running') {
      startQueuePoll(queueRunId);
    }
  } catch {
    document.getElementById('queuerun-body').innerHTML =
      '<p class="text-slate-500 text-sm">This queue has not been run since the server started.</p>' +
      `<button class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700" id="queuerun-rerun-btn">Run now</button>`;
    const btn = document.getElementById('queuerun-rerun-btn');
    if (btn) {
      btn.addEventListener('click', async () => {
        const qr = state.currentQueueRun;
        if (qr) await startQueueRun(qr.queueId);
      });
    }
  }
}

function renderQueueRunDetail(qr) {
  document.getElementById('queuerun-title').textContent = qr.queueName;

  const badge = document.getElementById('queuerun-status-badge');
  const badgeMap = {
    running:  ['bg-blue-100 text-blue-700',         '⟳ running'],
    success:  ['bg-emerald-100 text-emerald-700',    '✓ success'],
    failed:   ['bg-rose-100 text-rose-700',          '✗ failed'],
    canceled: ['bg-slate-100 text-slate-500',        '⊘ canceled'],
  };
  const [cls, label] = badgeMap[qr.status] || ['bg-slate-100 text-slate-500', qr.status];
  badge.className = `rounded-full px-3 py-1 text-sm font-medium ${cls}`;
  badge.textContent = label;

  const stopBtn = document.getElementById('queuerun-stop-btn');
  stopBtn.classList.toggle('hidden', qr.status !== 'running');

  // Elapsed / duration
  const started = new Date(qr.startedAt);
  let timeStr = `Started ${started.toLocaleTimeString()}`;
  if (qr.finishedAt) {
    const elapsed = Math.round((new Date(qr.finishedAt) - started) / 1000);
    timeStr += ` · ${elapsed}s`;
  } else if (qr.status === 'running') {
    const elapsed = Math.round((Date.now() - started) / 1000);
    timeStr += ` · ${elapsed}s elapsed`;
  }
  document.getElementById('queuerun-time').textContent = timeStr;

  const tbody = document.getElementById('queuerun-tbody');
  tbody.innerHTML = '';
  (qr.jobs || []).forEach(job => {
    const statusHtml = queueJobStatusBadge(job.status);
    const hasRun = job.status != null && job.status !== null;
    const logsBtn = hasRun
      ? `<button class="view-logs-btn rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
           data-queue-run-id="${esc(qr.id)}" data-run-id="${esc(job.runId || '')}">View logs</button>`
      : '<span class="text-slate-400 text-xs">—</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-5 py-4 text-sm font-medium">${esc(job.jobName)}</td>
      <td class="px-5 py-4">${statusHtml}</td>
      <td class="px-5 py-4 text-right">${logsBtn}</td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.view-logs-btn').forEach(btn => {
    btn.addEventListener('click', () => openQueueLogs(btn.dataset.queueRunId, btn.dataset.runId));
  });
}

function queueJobStatusBadge(status) {
  if (status == null) return '<span class="text-slate-400 text-xs">— pending</span>';
  const map = {
    running:  ['bg-blue-100 text-blue-700',         '⟳ running'],
    success:  ['bg-emerald-100 text-emerald-700',    '✓ success'],
    failed:   ['bg-rose-100 text-rose-700',          '✗ failed'],
    canceled: ['bg-slate-100 text-slate-500',        '⊘ canceled'],
  };
  const [cls, label] = map[status] || ['bg-slate-100 text-slate-500', status];
  return `<span class="rounded-full ${cls} px-2.5 py-1 text-xs font-medium">${label}</span>`;
}

export async function stopQueueRun() {
  if (!state.currentQueueRun) return;
  try {
    await api('POST', `/api/queue-runs/${state.currentQueueRun.id}/stop`);
  } catch { /* ignore */ }
}

function startQueuePoll(queueRunId) {
  stopQueuePoll();
  async function poll() {
    try {
      const qr = await api('GET', `/api/queue-runs/${queueRunId}`);
      if (!qr) return;
      state.currentQueueRun = qr;
      renderQueueRunDetail(qr);
      // Refresh queue list to update status buttons.
      state.queues = await api('GET', '/api/queues') || state.queues;
      if (qr.status !== 'running') {
        stopQueuePoll();
        return;
      }
      state.queuePollTimer = setTimeout(poll, 2000);
    } catch { /* ignore */ }
  }
  poll();
}

export function stopQueuePoll() {
  if (state.queuePollTimer) { clearTimeout(state.queuePollTimer); state.queuePollTimer = null; }
}

// ---- Queue logs ----

export function openQueueLogs(queueRunId, runId) {
  stopQueueLogPoll();
  state.queueLogRunId = runId;
  showScreen('queuelogs');

  const qr = state.currentQueueRun;
  if (!qr || qr.id !== queueRunId) return;

  // Back-link label
  document.getElementById('queuelogs-back-title').textContent = qr.queueName;

  // Populate job dropdown
  const sel = document.getElementById('queuelogs-job-select');
  sel.innerHTML = '';
  (qr.jobs || []).forEach(job => {
    const opt = document.createElement('option');
    opt.value = job.runId || '';
    opt.dataset.status = job.status || '';
    opt.textContent = (statusIcon(job.status) + ' ' + job.jobName).trim();
    opt.disabled = !job.runId;
    if (job.runId === runId) opt.selected = true;
    sel.appendChild(opt);
  });

  if (!runId) {
    document.getElementById('queuelogs-panel').textContent = 'Waiting…';
    return;
  }

  fetchJobLog(runId, 0);
}

function statusIcon(status) {
  const icons = { running: '⟳', success: '✓', failed: '✗', canceled: '⊘' };
  return icons[status] || '';
}

let logPollTimer = null;

export function stopQueueLogPoll() {
  if (logPollTimer) { clearTimeout(logPollTimer); logPollTimer = null; }
}

async function fetchJobLog(runId, since) {
  stopQueueLogPoll();
  if (!runId) {
    document.getElementById('queuelogs-panel').textContent = 'Waiting…';
    return;
  }
  try {
    const data = await api('GET', `/api/runs/${runId}/log?since=${since}`);
    if (!data) return;
    const panel = document.getElementById('queuelogs-panel');
    if (since === 0) panel.textContent = '';
    if (data.lines && data.lines.length) {
      panel.textContent += data.lines.join('\n') + '\n';
      panel.scrollTop = panel.scrollHeight;
    }
    if (data.status === 'running') {
      logPollTimer = setTimeout(() => fetchJobLog(runId, data.next), 1000);
    }
  } catch { /* ignore */ }
}

export function onQueueLogsJobChange() {
  stopQueueLogPoll();
  const sel = document.getElementById('queuelogs-job-select');
  const runId = sel.value;
  state.queueLogRunId = runId;
  fetchJobLog(runId, 0);
}
