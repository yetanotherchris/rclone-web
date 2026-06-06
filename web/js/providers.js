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

export function switchProvTab(tabName) {
  document.querySelectorAll('.prov-tab').forEach(t => t.classList.add('hidden'));
  document.getElementById('ptab-' + tabName).classList.remove('hidden');
  document.querySelectorAll('.prov-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
}

export function openProvForm(name) {
  state.editingProvName = name;
  switchProvTab('details');
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

  // Try to get fields from the backends schema
  const backend = state.backends && state.backends.find(b => b.Name === type);
  const options = (backend && backend.Options) || [];

  const required = options.filter(o => !o.Advanced && !o.Hide);
  const advanced = options.filter(o => o.Advanced && !o.Hide);

  // Google Drive: prefer pasting the service-account JSON *blob* (stored inside the
  // encrypted config) over referencing a plaintext key file on disk. rclone marks
  // the blob option Hide=2 (so it's filtered out above) and surfaces
  // service_account_file as a normal field — so swap their prominence: show the
  // blob up top in the main section, and demote the file-path option to Advanced.
  if (type === 'drive') {
    const fileIdx = required.findIndex(o => o.Name === 'service_account_file');
    if (fileIdx !== -1) advanced.unshift(...required.splice(fileIdx, 1));

    const blob = options.find(o => o.Name === 'service_account_credentials');
    if (blob && !required.includes(blob)) required.unshift(blob);
  }

  const fieldsEl = document.getElementById('p-fields');
  const advEl = document.getElementById('p-fields-advanced');

  if (required.length) {
    fieldsEl.innerHTML = required.map(o => backendFieldHTML(o, prefix)).join('');
  } else {
    fieldsEl.innerHTML = '<p class="text-sm text-slate-400">This backend needs no required fields. Use custom keys below.</p>';
  }

  if (advanced.length) {
    advEl.innerHTML = advanced.map(o => backendFieldHTML(o, prefix)).join('');
  } else {
    advEl.innerHTML = '<p class="text-sm text-slate-400">No advanced options for this backend.</p>';
  }
}

function backendFieldHTML(opt, prefix) {
  const key = opt.Name || '';
  const helpLines = opt.Help ? opt.Help.trim().split('\n').map(l => l.trim()).filter(Boolean) : [];
  const label = helpLines[0] || key;
  const extraHelp = helpLines.slice(1).join(' ');
  const envKey = prefix + key.toUpperCase();
  const tipParts = [];
  if (extraHelp) tipParts.push(esc(extraHelp));
  tipParts.push(`<span style="opacity:0.65;font-style:italic">${esc(envKey)}</span>`);
  const isPassword = opt.IsPassword || opt.Sensitive;
  const isServiceAccount = key === 'service_account_credentials';
  const isToken = key === 'token';
  const isBlob = isServiceAccount || isToken;
  if (isServiceAccount) tipParts.unshift('Paste the JSON itself to keep credentials inside the encrypted config - no plaintext key file left on disk. Prefer a file on disk? Use the &quot;Service Account Credentials JSON file path&quot; field under Advanced.');
  if (isToken) tipParts.unshift('Paste the OAuth token JSON blob ({"access_token":"...","refresh_token":"...",...}) obtained from rclone config.');
  const tooltipHtml = ` <span class="tt" style="vertical-align:middle"><span style="font-size:0.7rem;color:#94a3b8;cursor:help;font-weight:400">ⓘ</span><span class="tt-tip wide">${tipParts.join('<br>')}</span></span>`;
  let input;

  if (isBlob) {
    const ph = isServiceAccount
      ? '{ "type": "service_account", "project_id": "...", ... }'
      : '{"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}';
    input = `<textarea id="pf-${esc(key)}" rows="3" placeholder='${ph}' class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"></textarea>`;
  } else if (opt.Examples && opt.Examples.length) {
    const opts = opt.Examples.map(ex => `<option value="${esc(ex.Value)}">${esc(ex.Help || ex.Value)}</option>`).join('');
    input = `<select id="pf-${esc(key)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">${opts}</select>`;
  } else if (opt.Type === 'bool') {
    input = `<label class="toggle py-1"><input type="checkbox" id="pf-${esc(key)}" class="toggle-cb"><span class="toggle-track"></span></label>`;
  } else {
    const t = opt.Type === 'int' ? 'number' : 'text';
    const def = opt.DefaultStr !== undefined ? opt.DefaultStr : (opt.Default !== undefined ? String(opt.Default) : '');
    input = `<input type="${t}" id="pf-${esc(key)}" value="${esc(def)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">`;
  }

  return `<div>
    <label class="mb-1 block text-sm font-semibold">${esc(label)}${tooltipHtml}</label>${input}</div>`;
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
