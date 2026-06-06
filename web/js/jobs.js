/* rclone-web — jobs list, job form, live command preview, save/delete. */
'use strict';

import { state } from './state.js';
import { api } from './api.js';
import { esc, showError, clearError } from './util.js';
import { isOneSided, isLocalProvider, formatRemote } from './remotes.js';
import { showScreen } from './screens.js';

export function renderJobsList() {
  const tbody = document.getElementById('jobs-tbody');
  tbody.innerHTML = '';

  if (!state.jobs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center text-sm text-slate-400">No jobs yet.</td></tr>';
    return;
  }

  state.jobs.forEach(job => {
    const cmdBadge = `<span class="rounded bg-${cmdColor(job.command)}-100 px-2 py-0.5 font-mono text-xs ${cmdColor(job.command) !== 'slate' ? 'text-' + cmdColor(job.command) + '-700' : 'text-slate-600'}">${esc(job.command)}</span>`;
    const srcRemote = formatRemote(job.source_provider, job.source_path);
    const dstRemote = isOneSided(job.command) ? '—' : formatRemote(job.dest_provider, job.dest_path);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-5 py-4 font-medium">${esc(job.name)}</td>
      <td class="px-5 py-4">${cmdBadge}</td>
      <td class="px-5 py-4 font-mono text-xs text-slate-500">${esc(srcRemote)}</td>
      <td class="px-5 py-4 font-mono text-xs text-slate-500">${esc(dstRemote)}</td>
      <td class="px-5 py-4 text-right">
        <button class="edit-job-btn text-xs font-medium text-brand-600 hover:underline" data-job-id="${job.id}">Edit</button>
        <button class="delete-job-btn ml-3 text-xs font-medium text-rose-600 hover:underline" data-job-id="${job.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.edit-job-btn').forEach(btn =>
    btn.addEventListener('click', () => openJobForm(btn.dataset.jobId))
  );
  tbody.querySelectorAll('.delete-job-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteJob(btn.dataset.jobId))
  );
}

function cmdColor(cmd) {
  const colors = { copy: 'slate', sync: 'amber', move: 'rose', check: 'sky', lsf: 'violet' };
  return colors[cmd] || 'slate';
}

export function switchJobTab(tabName) {
  document.querySelectorAll('.job-tab').forEach(t => t.classList.add('hidden'));
  document.getElementById('tab-' + tabName).classList.remove('hidden');
  document.querySelectorAll('.job-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
}

export function openJobForm(jobId) {
  const job = jobId ? state.jobs.find(j => j.id === jobId) : null;
  switchJobTab('details');
  document.getElementById('jobform-title').textContent = job ? 'Edit job' : 'New job';
  document.getElementById('f-id').value = job ? job.id : '';
  document.getElementById('f-name').value = job ? (job.name || '') : '';
  document.getElementById('f-cmd').value = job ? job.command : 'copy';
  document.getElementById('f-spath').value = job ? (job.source_path || '') : '';
  document.getElementById('f-dpath').value = job ? (job.dest_path || '') : '';
  document.getElementById('f-extra').value = job && job.extra_args && job.extra_args !== 'undefined' ? job.extra_args : '';
  clearError('jobform-error');

  // Populate provider dropdowns
  populateProviderSelects();
  if (job) {
    document.getElementById('f-sprov').value = job.source_provider || '';
    document.getElementById('f-dprov').value = job.dest_provider || '';
  }

  toggleDestFields();
  updatePathPlaceholders();
  updateCmdPreview();
  showScreen('jobform');
}

function populateProviderSelects() {
  ['f-sprov', 'f-dprov'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">Local path</option>';
    state.providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = `${p.name} (${p.type})`;
      sel.appendChild(opt);
    });
  });
}

export function toggleDestFields() {
  const cmd = document.getElementById('f-cmd').value;
  const hide = isOneSided(cmd);
  document.getElementById('dest-prov-field').classList.toggle('hidden', hide);
  document.getElementById('dest-path-field').classList.toggle('hidden', hide);
}

export function updatePathPlaceholders() {
  const sLocal = isLocalProvider(document.getElementById('f-sprov').value);
  const dLocal = isLocalProvider(document.getElementById('f-dprov').value);
  document.getElementById('f-spath').placeholder = '';
  document.getElementById('f-dpath').placeholder = '';
}

export function updateCmdPreview() {
  const cmd = document.getElementById('f-cmd').value;
  const sprov = document.getElementById('f-sprov').value;
  const spath = document.getElementById('f-spath').value;
  const dprov = document.getElementById('f-dprov').value;
  const dpath = document.getElementById('f-dpath').value;
  const extra = document.getElementById('f-extra').value;

  const srcRemote = formatRemote(sprov, spath);
  let line = `rclone ${cmd} ${srcRemote}`;
  if (!isOneSided(cmd)) {
    line += ` ${formatRemote(dprov, dpath)}`;
  }
  if (extra) line += ` ${extra}`;
  document.getElementById('cmd-preview').textContent = line.replace(/\s+/g, ' ').trim();
}

export async function saveJob() {
  const id = document.getElementById('f-id').value;
  const job = {
    id,
    name: document.getElementById('f-name').value.trim(),
    command: document.getElementById('f-cmd').value,
    source_provider: document.getElementById('f-sprov').value,
    source_path: document.getElementById('f-spath').value.trim(),
    dest_provider: document.getElementById('f-dprov').value,
    dest_path: document.getElementById('f-dpath').value.trim(),
    extra_args: document.getElementById('f-extra').value.trim(),
  };

  if (!job.name) { showError('jobform-error', 'Name is required'); return; }

  try {
    let saved;
    if (id) {
      saved = await api('PUT', `/api/jobs/${id}`, job);
    } else {
      saved = await api('POST', '/api/jobs', job);
    }
    if (!saved) return;

    // Refresh jobs list
    state.jobs = await api('GET', '/api/jobs') || state.jobs;
    showScreen('jobs');
  } catch (err) {
    showError('jobform-error', err.message);
  }
}

async function deleteJob(id) {
  if (!confirm('Delete this job?')) return;
  try {
    await api('DELETE', `/api/jobs/${id}`);
    state.jobs = await api('GET', '/api/jobs') || state.jobs;
    renderJobsList();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}
