/* rclone-web — dashboard table (jobs overview with run / dry-run actions). */
'use strict';

import { state } from './state.js';
import { esc, runStatusBadge } from './util.js';
import { formatRoute } from './remotes.js';
import { startRunFlow } from './runs.js';
import { showScreen } from './screens.js';
import { lastRunCell } from './jobs.js';

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
    return;
  }

  state.jobs.forEach(job => {
    const route = formatRoute(job);
    // Prefer in-session lastRun for badge (has exit code); fall back to persisted status
    const lastRun = job.lastRun;
    let statusBadge;
    if (lastRun) {
      statusBadge = runStatusBadge(lastRun.status, lastRun.exitCode);
    } else if (job.last_run_status) {
      statusBadge = runStatusBadge(job.last_run_status, 0);
    } else {
      statusBadge = '<span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">never run</span>';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-5 py-4 font-medium">${esc(job.name)}</td>
      <td class="px-5 py-4 font-mono text-xs text-slate-500">${esc(route)}</td>
      <td class="px-5 py-4">${statusBadge} <span class="text-xs text-slate-400 ml-1">${job.last_run_at ? new Date(job.last_run_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : ''}</span></td>
      <td class="px-5 py-4 text-right space-x-2">
        <button class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 run-btn" data-job-id="${job.id}" data-dry="false">Run</button>
        <button class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 run-btn" data-job-id="${job.id}" data-dry="true">Dry-run</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.run-btn').forEach(btn => {
    btn.addEventListener('click', () => startRunFlow(btn.dataset.jobId, btn.dataset.dry === 'true'));
  });
}
