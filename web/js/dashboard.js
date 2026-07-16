/* rclone-web — dashboard table (jobs overview with run / dry-run actions). */
'use strict';

import { state } from './state.js';
import { api } from './api.js';
import { esc, runStatusBadge } from './util.js';
import { formatRoute } from './remotes.js';
import { startRunFlow } from './runs.js';
import { showScreen } from './screens.js';
import { lastRunCell } from './jobs.js';
import { startQueueRun, openQueueRun } from './queues.js';

export function renderDashboard() {
  const pCount = state.providers.length;
  const jCount = state.jobs.length;
  document.getElementById('dashboard-summary').textContent =
    `${jCount} job${jCount !== 1 ? 's' : ''} · ${pCount} provider${pCount !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('dashboard-tbody');
  tbody.innerHTML = '';

  if (!state.jobs.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-6 text-center text-sm text-slate-400">No jobs yet. <a href="#" class="dash-add-link text-brand-600 hover:underline">Add one</a>.</td></tr>';
    const link = tbody.querySelector('.dash-add-link');
    if (link) link.addEventListener('click', (e) => { e.preventDefault(); showScreen('jobs'); });
  } else {
    state.jobs.sort((a, b) => a.name.localeCompare(b.name)).forEach(job => {
      const route = formatRoute(job);
      const lastRun = job.lastRun;
      let statusBadge;
      if (lastRun) {
        statusBadge = runStatusBadge(lastRun.status, lastRun.exitCode);
      } else if (job.last_run_status) {
        statusBadge = runStatusBadge(job.last_run_status, 0);
      } else {
        statusBadge = '<span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">never run</span>';
      }

      const watchingBadge = job.isWatching
        ? `<span class="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[10px] font-medium text-amber-700"><span class="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span>watching</span>`
        : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-5 py-4 font-medium">${esc(job.name)}${watchingBadge}</td>
        <td class="px-5 py-4 font-mono text-xs text-slate-500">${esc(route)}</td>
        <td class="px-5 py-4">${statusBadge} <span class="text-xs text-slate-400 ml-1">${job.last_run_at ? new Date(job.last_run_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : ''}</span></td>
        <td class="px-5 py-4 text-right space-x-2">
          <button class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 run-btn" data-job-id="${job.id}" data-dry="false">Run</button>
          <button class="kebab-btn rounded-lg border border-slate-300 px-2 py-1.5 text-slate-500 hover:bg-slate-50" data-job-id="${job.id}" aria-label="More actions">⋮</button>
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.run-btn').forEach(btn => {
      btn.addEventListener('click', () => startRunFlow(btn.dataset.jobId, btn.dataset.dry === 'true'));
    });
    tbody.querySelectorAll('.kebab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const job = state.jobs.find(j => j.id === btn.dataset.jobId);
        if (!job) return;
        const menu = ensureKebabMenu();
        const wasOpenForThisJob = !menu.classList.contains('hidden') && menu.dataset.jobId === job.id;
        closeKebabMenu();
        if (!wasOpenForThisJob) openKebabMenu(btn, job);
      });
    });
  }

  // Queues section — only if there are queues.
  const qSection = document.getElementById('dashboard-queues-section');
  if (!state.queues.length) {
    qSection.classList.add('hidden');
    return;
  }
  qSection.classList.remove('hidden');

  const qTbody = document.getElementById('dashboard-queues-tbody');
  qTbody.innerHTML = '';
  state.queues.forEach(q => {
    const jobCount = (q.job_ids || []).length;
    const isRunning = q.lastQueueRun && q.lastQueueRun.status === 'running';
    let statusCell;
    if (!q.lastQueueRun) {
      statusCell = '<span class="text-slate-400 text-xs">—</span>';
    } else {
      const { id, status } = q.lastQueueRun;
      const badgeMap = {
        running:  ['bg-blue-100 text-blue-700',       '⟳ running'],
        success:  ['bg-emerald-100 text-emerald-700',  '✓ success'],
        failed:   ['bg-rose-100 text-rose-700',        '✗ failed'],
        canceled: ['bg-slate-100 text-slate-500',      '⊘ canceled'],
      };
      const [cls, label] = badgeMap[status] || ['bg-slate-100 text-slate-500', status];
      statusCell = `<button class="dash-queue-status-btn rounded-full ${cls} px-2.5 py-1 text-xs font-medium" data-queue-run-id="${esc(id)}">${label}</button>`;
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-5 py-4 font-medium text-sm">${esc(q.name)}</td>
      <td class="px-5 py-4 text-sm text-slate-500">${jobCount}</td>
      <td class="px-5 py-4">${statusCell}</td>
      <td class="px-5 py-4 text-right">
        <button class="dash-queue-run-btn rounded-lg px-3 py-1.5 text-xs font-medium text-white ${isRunning ? 'bg-slate-400 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-700'}" data-queue-id="${esc(q.id)}" ${isRunning ? 'disabled' : ''}>Run</button>
      </td>`;
    qTbody.appendChild(tr);
  });

  qTbody.querySelectorAll('.dash-queue-status-btn').forEach(btn =>
    btn.addEventListener('click', () => openQueueRun(btn.dataset.queueRunId))
  );
  qTbody.querySelectorAll('.dash-queue-run-btn:not([disabled])').forEach(btn =>
    btn.addEventListener('click', () => startQueueRun(btn.dataset.queueId))
  );
}

async function toggleWatch(jobId, isWatching) {
  try {
    await api('POST', `/api/jobs/${jobId}/watch/${isWatching ? 'stop' : 'start'}`);
    state.jobs = await api('GET', '/api/jobs') || state.jobs;
    renderDashboard();
  } catch (err) {
    alert('Watch toggle failed: ' + err.message);
  }
}

// Kebab menu — a single shared popover (fixed-positioned, appended to
// <body>) reused for every job row so it isn't clipped by the dashboard
// table's `overflow-hidden` wrapper.
let kebabMenuEl = null;

function ensureKebabMenu() {
  if (kebabMenuEl) return kebabMenuEl;
  kebabMenuEl = document.createElement('div');
  kebabMenuEl.id = 'job-kebab-menu';
  kebabMenuEl.className = 'fixed z-50 hidden w-40 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg';
  kebabMenuEl.innerHTML = `
    <button class="kebab-dryrun-item block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Dry-run</button>
    <button class="kebab-watch-item block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50"></button>
  `;
  document.body.appendChild(kebabMenuEl);

  kebabMenuEl.querySelector('.kebab-dryrun-item').addEventListener('click', () => {
    const jobId = kebabMenuEl.dataset.jobId;
    closeKebabMenu();
    startRunFlow(jobId, true);
  });
  kebabMenuEl.querySelector('.kebab-watch-item').addEventListener('click', () => {
    const jobId = kebabMenuEl.dataset.jobId;
    const watching = kebabMenuEl.dataset.watching === 'true';
    closeKebabMenu();
    toggleWatch(jobId, watching);
  });

  document.addEventListener('click', (e) => {
    if (kebabMenuEl.classList.contains('hidden')) return;
    if (e.target.closest('#job-kebab-menu') || e.target.closest('.kebab-btn')) return;
    closeKebabMenu();
  });
  window.addEventListener('resize', closeKebabMenu);

  return kebabMenuEl;
}

function closeKebabMenu() {
  if (kebabMenuEl) kebabMenuEl.classList.add('hidden');
}

function openKebabMenu(btn, job) {
  const menu = ensureKebabMenu();
  menu.dataset.jobId = job.id;
  menu.dataset.watching = job.isWatching ? 'true' : 'false';
  menu.querySelector('.kebab-watch-item').textContent = job.isWatching ? '⏹ Stop watch' : 'Watch';

  menu.classList.remove('hidden');
  const rect = btn.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 160;
  const menuHeight = menu.offsetHeight || 80;

  const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
  // Prefer opening below the button; flip above it if there isn't room —
  // it's position:fixed, so once placed off-screen no scroll can reveal it.
  let top = rect.bottom + 4;
  if (top + menuHeight > window.innerHeight - 8) {
    top = rect.top - menuHeight - 4;
  }
  top = Math.max(8, top);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
