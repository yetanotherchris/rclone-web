/* rclone-web — lock/app visibility and top-level screen routing. */
'use strict';

import { state } from './state.js';
import { renderDashboard } from './dashboard.js';
import { renderJobsList } from './jobs.js';
import { renderProvidersList } from './providers.js';

export function configureLockUI(n) {
  const prefixMode = n > 0;
  document.getElementById('lock-prefix-mode').classList.toggle('hidden', !prefixMode);
  document.getElementById('lock-full-mode').classList.toggle('hidden', prefixMode);
  if (prefixMode) {
    document.getElementById('prefix-len').textContent = n;
    document.getElementById('prefix-input').maxLength = n;
  }
}

export function showLock() {
  configureLockUI(state.shortLen);
  document.getElementById('prefix-input').value = '';
  document.getElementById('full-input').value = '';
  document.getElementById('lock-error').classList.add('hidden');
  document.getElementById('lock').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  // Autofocus the active passphrase field so the user can type immediately —
  // covers first load, idle-lock, and manual lock. Focus whichever input the
  // current mode shows (short-password prefix vs. full passphrase).
  document.getElementById(state.shortLen > 0 ? 'prefix-input' : 'full-input').focus();
}

export function showApp() {
  document.getElementById('lock').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('hidden', s.dataset.screen !== name)
  );
  const navTarget = { jobform: 'jobs', provform: 'providers', run: 'dashboard' }[name] || name;
  document.querySelectorAll('.nav-btn').forEach(b => {
    const active = b.dataset.nav === navTarget;
    b.classList.toggle('bg-brand-50', active);
    b.classList.toggle('text-brand-700', active);
    b.classList.toggle('text-slate-600', !active);
  });

  if (name === 'dashboard') renderDashboard();
  if (name === 'jobs') renderJobsList();
  if (name === 'providers') renderProvidersList();
}
