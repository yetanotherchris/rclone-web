/* rclone-web — session lifecycle: status check, unlock, lock, idle countdown. */
'use strict';

import { state } from './state.js';
import { api } from './api.js';
import { showError, clearError } from './util.js';
import { showLock, showApp, showScreen, configureLockUI } from './screens.js';
import { populateBackendTypeSelect } from './providers.js';
import { stopPoll } from './runs.js';

export async function checkStatus() {
  try {
    const data = await fetch('/api/status').then(r => r.json());
    state.shortLen = data.shortLen || 0;
    configureLockUI(state.shortLen);
    if (data.locked) {
      showLock();
    } else {
      // We have a valid session from a cookie; fetch initial data
      await loadInitialData();
      showApp();
      showScreen('dashboard');
    }
  } catch {
    showLock();
  }
}

export async function doUnlock() {
  const btn = document.getElementById('unlock-btn');
  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  clearError('lock-error');

  const prefixMode = !document.getElementById('lock-prefix-mode').classList.contains('hidden');
  const prefix = prefixMode
    ? document.getElementById('prefix-input').value
    : document.getElementById('full-input').value;

  try {
    const data = await fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix }),
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Unlock failed');
      return d;
    });

    state.csrfToken = data.csrfToken;
    await loadInitialData();
    showApp();
    showScreen('dashboard');
  } catch (err) {
    showError('lock-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock & decrypt';
  }
}

export async function doLock() {
  await fetch('/api/lock', { method: 'POST' });
  state.csrfToken = '';
  state.jobs = [];
  state.providers = [];
  state.queues = [];
  stopPoll();
  showLock();
}

async function loadInitialData() {
  [state.jobs, state.providers, state.backends, state.queues] = await Promise.all([
    api('GET', '/api/jobs'),
    api('GET', '/api/providers'),
    api('GET', '/api/backends'),
    api('GET', '/api/queues'),
  ]);
  if (!state.jobs) state.jobs = [];
  if (!state.providers) state.providers = [];
  if (!state.backends) state.backends = [];
  if (!state.queues) state.queues = [];
  populateBackendTypeSelect();
  startIdleCountdown();
}

function startIdleCountdown() {
  if (state.idleTimer) clearInterval(state.idleTimer);
  state.idleTimer = setInterval(async () => {
    try {
      const data = await fetch('/api/status').then(r => r.json());
      if (data.locked) {
        clearInterval(state.idleTimer);
        showLock();
        return;
      }
      const s = data.idleSecondsLeft || 0;
      const m = Math.floor(s / 60);
      const sec = String(s % 60).padStart(2, '0');
      document.getElementById('idle-countdown').textContent = `${m}:${sec}`;
    } catch { /* ignore */ }
  }, 5000);
}
