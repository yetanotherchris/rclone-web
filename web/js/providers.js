/* rclone-web — providers grid, provider form (schema-driven fields), save/delete. */
'use strict';

import { state } from './state.js';
import { api } from './api.js';
import { esc, showError, clearError } from './util.js';
import { showScreen } from './screens.js';

export function renderProvidersList() {
  const grid = document.getElementById('providers-grid');
  grid.innerHTML = '';

  if (!state.providers.length) {
    grid.innerHTML = '<p class="col-span-2 text-center text-sm text-slate-400 py-8">No providers yet.</p>';
    return;
  }

  state.providers.forEach(p => {
    const keys = Object.entries(p)
      .filter(([k]) => k !== 'name' && k !== 'type')
      .slice(0, 3);

    const keyRows = keys.map(([k, v]) => `
      <div class="flex justify-between">
        <dt class="text-slate-500">${esc(k)}</dt>
        <dd class="font-mono">${isSensitiveKey(k) ? '••••••••' : esc(String(v))}</dd>
      </div>`).join('');

    const card = document.createElement('div');
    card.className = 'rounded-xl border border-slate-200 bg-white p-5';
    card.innerHTML = `
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 font-bold text-xs">${esc(p.type ? p.type.toUpperCase().slice(0,2) : '??')}</span>
          <span class="font-medium">${esc(p.name)}</span>
        </div>
        <span class="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">type: ${esc(p.type || '')}</span>
      </div>
      <dl class="space-y-1 text-sm">${keyRows || '<div class="text-slate-400">(no extra keys)</div>'}</dl>
      <div class="mt-4 flex gap-3 text-xs">
        <button class="edit-prov-btn font-medium text-brand-600 hover:underline" data-prov-name="${esc(p.name)}">Edit</button>
        <button class="delete-prov-btn font-medium text-rose-600 hover:underline" data-prov-name="${esc(p.name)}">Delete</button>
      </div>`;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.edit-prov-btn').forEach(btn =>
    btn.addEventListener('click', () => openProvForm(btn.dataset.provName))
  );
  grid.querySelectorAll('.delete-prov-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteProvider(btn.dataset.provName))
  );
}

function isSensitiveKey(k) {
  const lower = k.toLowerCase();
  return lower.includes('key') || lower.includes('secret') || lower.includes('password') ||
         lower.includes('pass') || lower.includes('token');
}

export function openProvForm(name) {
  state.editingProvName = name;
  const prov = name ? state.providers.find(p => p.name === name) : null;
  document.getElementById('provform-title').textContent = prov ? 'Edit provider' : 'New provider';
  document.getElementById('p-name').value = prov ? prov.name : '';
  document.getElementById('p-name').disabled = !!prov; // can't rename
  clearError('provform-error');

  // Populate type dropdown from backends
  populateBackendTypeSelect();
  if (prov) document.getElementById('p-type').value = prov.type || '';

  renderProviderFields();
  showScreen('provform');

  // Pre-fill existing values
  if (prov) {
    Object.entries(prov).forEach(([k, v]) => {
      if (k === 'name' || k === 'type') return;
      const el = document.getElementById('pf-' + k);
      if (el) el.value = v;
    });
  }
}

export function populateBackendTypeSelect() {
  const sel = document.getElementById('p-type');
  const current = sel.value;
  sel.innerHTML = '';

  // Always include common ones
  const common = ['b2', 'local', 's3', 'sftp', 'crypt', 'drive', 'onedrive', 'azureblob', 'dropbox', 'ftp', 'webdav'];
  const set = new Set(common);

  if (state.backends && state.backends.length) {
    state.backends.forEach(b => {
      if (b.Name) set.add(b.Name);
    });
  }

  [...set].sort().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  if (current) sel.value = current;
}

export function renderProviderFields() {
  const type = document.getElementById('p-type').value;
  const name = (document.getElementById('p-name').value || 'remote').toUpperCase();
  const prefix = `RCLONE_CONFIG_${name}_`;
  document.getElementById('p-prefix').textContent = `→ ${prefix}<KEY>`;

  // Try to get fields from the backends schema
  const backend = state.backends && state.backends.find(b => b.Name === type);
  const options = (backend && backend.Options) || [];

  const required = options.filter(o => !o.Advanced && !o.Hide);
  const advanced = options.filter(o => o.Advanced && !o.Hide);

  const fieldsEl = document.getElementById('p-fields');
  const advEl = document.getElementById('p-fields-advanced');

  if (required.length) {
    fieldsEl.innerHTML = required.map(o => backendFieldHTML(o, prefix)).join('');
  } else {
    fieldsEl.innerHTML = '<p class="text-sm text-slate-400">This backend needs no required fields. Use custom keys below.</p>';
  }

  if (advanced.length) {
    advEl.innerHTML = advanced.map(o => backendFieldHTML(o, prefix)).join('');
    document.getElementById('p-advanced').classList.remove('hidden');
  } else {
    advEl.innerHTML = '<p class="text-sm text-slate-400">No advanced options.</p>';
    document.getElementById('p-advanced').classList.add('hidden');
  }
}

function backendFieldHTML(opt, prefix) {
  const key = opt.Name || '';
  const label = opt.Help ? opt.Help.split('\n')[0] : key;
  const isPassword = opt.IsPassword || opt.Sensitive;
  const envKey = prefix + key.toUpperCase();
  let input;

  if (opt.Examples && opt.Examples.length) {
    const opts = opt.Examples.map(ex => `<option value="${esc(ex.Value)}">${esc(ex.Help || ex.Value)}</option>`).join('');
    input = `<select id="pf-${esc(key)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">${opts}</select>`;
  } else if (opt.Type === 'bool') {
    input = `<label class="flex items-center gap-2 py-2 text-sm"><input type="checkbox" id="pf-${esc(key)}" class="rounded"> Enabled</label>`;
  } else {
    const t = isPassword ? 'password' : (opt.Type === 'int' ? 'number' : 'text');
    const def = opt.DefaultStr !== undefined ? opt.DefaultStr : (opt.Default !== undefined ? String(opt.Default) : '');
    input = `<input type="${t}" id="pf-${esc(key)}" value="${esc(def)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">`;
  }

  return `<div>
    <label class="mb-1 block text-sm font-medium">${esc(label)}
      <span class="ml-1 font-mono text-xs text-slate-400">${esc(envKey)}</span>
    </label>${input}</div>`;
}

export function addCustomKey() {
  const row = document.createElement('div');
  row.className = 'flex gap-2 custom-key-row';
  row.innerHTML = `
    <input placeholder="key" class="custom-key w-1/3 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">
    <input placeholder="value" class="custom-val flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">
    <button class="rounded-lg border border-slate-300 px-3 text-slate-400 hover:bg-slate-50">✕</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  document.getElementById('p-fields').appendChild(row);
}

export async function saveProvider() {
  const name = document.getElementById('p-name').value.trim();
  const type = document.getElementById('p-type').value;
  if (!name) { showError('provform-error', 'Name is required'); return; }

  // Collect fields from the generated form
  const extra = {};
  document.querySelectorAll('#p-fields [id^="pf-"], #p-fields-advanced [id^="pf-"]').forEach(el => {
    const key = el.id.replace('pf-', '');
    if (el.type === 'checkbox') {
      extra[key] = el.checked ? 'true' : 'false';
    } else if (el.value && el.value !== el.getAttribute('placeholder')) {
      extra[key] = el.value;
    }
  });

  // Custom keys
  document.querySelectorAll('.custom-key-row').forEach(row => {
    const k = row.querySelector('.custom-key').value.trim();
    const v = row.querySelector('.custom-val').value;
    if (k) extra[k] = v;
  });

  const body = { name, type, ...extra };

  try {
    if (state.editingProvName) {
      await api('PUT', `/api/providers/${state.editingProvName}`, { type, ...extra });
    } else {
      await api('POST', '/api/providers', body);
    }
    state.providers = await api('GET', '/api/providers') || state.providers;
    // refresh provider selects
    showScreen('providers');
  } catch (err) {
    showError('provform-error', err.message);
  }
}

async function deleteProvider(name) {
  if (!confirm(`Delete provider "${name}"?`)) return;
  try {
    await api('DELETE', `/api/providers/${name}`);
    state.providers = await api('GET', '/api/providers') || state.providers;
    renderProvidersList();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}
