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

    // Re-filter provider-scoped suggestions now that pf-provider holds the
    // saved value (assigning .value above doesn't fire a change event).
    refreshProviderScopedFields();

    // For crypt, split the stored "provider:path" into the composite widget parts.
    if (prov.type === 'crypt' && prov.remote) {
      const colon = prov.remote.indexOf(':');
      const provPart = colon !== -1 ? prov.remote.slice(0, colon) : '';
      const pathPart = colon !== -1 ? prov.remote.slice(colon + 1) : prov.remote;
      const provSel = document.getElementById('crypt-remote-prov');
      const pathInput = document.getElementById('crypt-remote-path');
      const hidden = document.getElementById('pf-remote');
      if (provSel) provSel.value = provPart;
      if (pathInput) pathInput.value = pathPart;
      if (hidden) hidden.value = prov.remote;
    }
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

  // Google Drive: surface both auth options in Details (both are Hide=2 so filtered
  // out above). OAuth token and service account are mutually exclusive — leave the
  // other blank. Demote the plaintext service_account_file path to Advanced.
  if (type === 'drive') {
    const fileIdx = required.findIndex(o => o.Name === 'service_account_file');
    if (fileIdx !== -1) advanced.unshift(...required.splice(fileIdx, 1));

    const token = options.find(o => o.Name === 'token');
    if (token && !required.includes(token)) required.unshift(token);

    const blob = options.find(o => o.Name === 'service_account_credentials');
    if (blob && !required.includes(blob)) required.unshift(blob);
  }

  // crypt: replace the schema-driven "remote" text field with a composite
  // provider-dropdown + path-input widget backed by a hidden pf-remote input.
  let cryptRemoteHTML = '';
  if (type === 'crypt') {
    const remoteIdx = required.findIndex(o => o.Name === 'remote');
    if (remoteIdx !== -1) required.splice(remoteIdx, 1);
    const editingName = document.getElementById('p-name').value;
    const providerOpts = state.providers
      .filter(p => p.type !== 'crypt' && p.name !== editingName)
      .map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`)
      .join('');
    const envKey = prefix + 'REMOTE';
    const tooltip = `<span class="tt" style="vertical-align:middle"><span style="font-size:0.7rem;color:#94a3b8;cursor:help;font-weight:400">ⓘ</span><span class="tt-tip wide">The provider whose storage will hold the encrypted files.<br><span style="opacity:0.65;font-style:italic">${esc(envKey)}</span></span></span>`;
    cryptRemoteHTML = `<div>
      <label class="mb-1 block text-sm font-semibold">Remote to encrypt/decrypt${tooltip}</label>
      <div class="flex items-center gap-2">
        <select id="crypt-remote-prov" class="rounded-lg border border-slate-300 px-3 py-2 text-sm">${providerOpts || '<option value="">— no providers —</option>'}</select>
        <span class="font-mono text-slate-400">:</span>
        <input type="text" id="crypt-remote-path" placeholder="bucket/encrypted-folder" class="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">
      </div>
      <input type="hidden" id="pf-remote">
    </div>`;
  }

  const fieldsEl = document.getElementById('p-fields');
  const advEl = document.getElementById('p-fields-advanced');

  const schemaHTML = required.length
    ? required.map(o => backendFieldHTML(o, prefix)).join('')
    : '<p class="text-sm text-slate-400">This backend has no required fields. Check the Advanced tab for options or add custom keys there.</p>';

  fieldsEl.innerHTML = cryptRemoteHTML + schemaHTML;
  wirePasswordFields(fieldsEl);

  if (type === 'crypt') {
    const provSel = fieldsEl.querySelector('#crypt-remote-prov');
    const pathInput = fieldsEl.querySelector('#crypt-remote-path');
    const hidden = fieldsEl.querySelector('#pf-remote');
    const sync = () => { if (hidden) hidden.value = provSel && provSel.value ? `${provSel.value}:${pathInput.value}` : pathInput.value; };
    provSel && provSel.addEventListener('change', sync);
    pathInput && pathInput.addEventListener('input', sync);
    sync();
  }

  if (advanced.length) {
    advEl.innerHTML = advanced.map(o => backendFieldHTML(o, prefix)).join('');
  } else {
    advEl.innerHTML = '<p class="text-sm text-slate-400">No advanced options for this backend.</p>';
  }
  wirePasswordFields(advEl);

  // Provider-scoped example fields (S3 endpoint/region) re-filter whenever the
  // chosen S3 provider changes. Fill them once for the default provider too.
  const provEl = document.getElementById('pf-provider');
  if (provEl) provEl.addEventListener('change', refreshProviderScopedFields);
  refreshProviderScopedFields();
}

// True when an example with no Provider tag, or whose tag matches the selected
// provider, should be offered. Mirrors rclone's matcher: a Provider tag is a
// comma-separated list, optionally negated with a leading "!".
function exampleMatchesProvider(exampleProvider, selected) {
  if (!exampleProvider || !selected) return true;
  let list = exampleProvider, negate = false;
  if (list[0] === '!') { negate = true; list = list.slice(1); }
  const names = list.split(',').map(s => s.trim());
  const inList = names.includes(selected);
  return negate ? !inList : inList;
}

// Repopulate the <datalist> behind each provider-scoped combobox so it only
// suggests endpoints/regions for the currently selected S3 provider.
export function refreshProviderScopedFields() {
  const type = document.getElementById('p-type').value;
  const backend = state.backends && state.backends.find(b => b.Name === type);
  const options = (backend && backend.Options) || [];
  const provEl = document.getElementById('pf-provider');
  const selected = provEl ? provEl.value : '';

  options.forEach(o => {
    if (!Array.isArray(o.Examples) || !o.Examples.some(ex => ex.Provider)) return;
    const list = document.getElementById(`pf-${o.Name}-list`);
    if (!list) return;
    list.innerHTML = o.Examples
      .filter(ex => exampleMatchesProvider(ex.Provider, selected))
      .map(ex => `<option value="${esc(ex.Value)}">${esc(ex.Help || '')}</option>`)
      .join('');
  });
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
  if (isServiceAccount) tipParts.unshift('Alternative to OAuth token - use for service accounts. Leave blank if using an OAuth token. Prefer a file on disk? Use the &quot;Service Account Credentials JSON file path&quot; field under Advanced.');
  if (isToken) tipParts.unshift('OAuth token JSON blob obtained from rclone config. Leave blank if using a service account instead.');
  const tooltipHtml = ` <span class="tt" style="vertical-align:middle"><span style="font-size:0.7rem;color:#94a3b8;cursor:help;font-weight:400">ⓘ</span><span class="tt-tip wide">${tipParts.join('<br>')}</span></span>`;
  let input;

  if (isBlob) {
    const ph = isServiceAccount
      ? '{ "type": "service_account", "project_id": "...", ... }'
      : '{"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}';
    input = `<textarea id="pf-${esc(key)}" rows="3" placeholder='${ph}' class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"></textarea>`;
  } else if (isPassword) {
    const eyeShow = `<svg class="eye-show" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const eyeHide = `<svg class="eye-hide hidden" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    input = `<div class="relative">
      <input type="password" id="pf-${esc(key)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm pr-10">
      <button type="button" class="pw-eye absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600" data-target="pf-${esc(key)}" title="Show/hide password">${eyeShow}${eyeHide}</button>
    </div>`;
  } else if (opt.Examples && opt.Examples.some(ex => ex.Provider)) {
    // Provider-scoped suggestions (S3 endpoint/region): rclone tags each example
    // with the S3 provider it belongs to. A flat list of all 300+ endpoints is
    // useless because you can't tell which one is for which provider, so render
    // an editable combobox whose datalist is filtered to the selected provider
    // (refreshProviderScopedFields). Free-text keeps custom/"Other" endpoints valid.
    const listId = `pf-${esc(key)}-list`;
    input = `<input type="text" id="pf-${esc(key)}" list="${listId}" autocomplete="off" placeholder="leave blank for the provider default" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">
      <datalist id="${listId}"></datalist>`;
  } else if (opt.Examples && opt.Examples.length > 1) {
    const opts = opt.Examples.map(ex => `<option value="${esc(ex.Value)}">${esc(ex.Help || ex.Value)}</option>`).join('');
    input = `<select id="pf-${esc(key)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">${opts}</select>`;
  } else if (opt.Type === 'bool') {
    const def = opt.DefaultStr !== undefined ? opt.DefaultStr : (opt.Default !== undefined ? String(opt.Default) : '');
    const checked = def === 'true' ? ' checked' : '';
    return `<div class="flex items-center gap-3 py-1">
      <label class="toggle shrink-0"><input type="checkbox" id="pf-${esc(key)}" class="toggle-cb"${checked}><span class="toggle-track"></span></label>
      <label for="pf-${esc(key)}" class="text-sm font-semibold cursor-pointer">${esc(label)}${tooltipHtml}</label>
    </div>`;
  } else {
    const t = opt.Type === 'int' ? 'number' : 'text';
    const def = opt.DefaultStr !== undefined ? opt.DefaultStr : (opt.Default !== undefined ? String(opt.Default) : '');
    input = `<input type="${t}" id="pf-${esc(key)}" value="${esc(def)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">`;
  }

  return `<div>
    <label class="mb-1 block text-sm font-semibold">${esc(label)}${tooltipHtml}</label>${input}</div>`;
}

function wirePasswordFields(container) {
  container.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      if (!inp) return;
      const showing = inp.type === 'text';
      inp.type = showing ? 'password' : 'text';
      btn.querySelector('.eye-show').classList.toggle('hidden', !showing);
      btn.querySelector('.eye-hide').classList.toggle('hidden', showing);
    });
  });
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

  if (type === 'crypt') {
    const pwEl = document.getElementById('pf-password');
    if (!pwEl || !pwEl.value.trim()) {
      showError('provform-error', 'Password is required for crypt providers (minimum 1 character)');
      pwEl && pwEl.focus();
      return;
    }
  }

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
