/* rclone-web — entry point. Wires DOM events on load and delegates to modules.
 *
 * This is the esbuild bundle entry: `go generate ./...` bundles this import graph
 * into web/app.js (the file the page actually loads). Edit the modules here, not
 * the generated bundle.
 */
'use strict';

import { showScreen } from './screens.js';
import { checkStatus, doUnlock, doLock } from './session.js';
import {
  saveJob, openJobForm, toggleDestFields, updateCmdPreview, updatePathPlaceholders, switchJobTab,
} from './jobs.js';
import {
  saveProvider, openProvForm, addCustomKey, renderProviderFields, switchProvTab,
} from './providers.js';
import { proceedWithRun, stopRun } from './runs.js';

document.addEventListener('DOMContentLoaded', () => {
  // Nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.nav));
  });

  // Job form tabs
  document.querySelectorAll('.job-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchJobTab(btn.dataset.tab));
  });

  // Provider form tabs
  document.querySelectorAll('.prov-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchProvTab(btn.dataset.tab));
  });

  // Back buttons
  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.back));
  });

  // Lock screen
  document.getElementById('unlock-btn').addEventListener('click', doUnlock);
  document.getElementById('lock-btn').addEventListener('click', doLock);
  ['prefix-input', 'full-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });
  });

  // Job form live preview
  ['f-cmd', 'f-sprov', 'f-spath', 'f-dprov', 'f-dpath', 'f-extra'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCmdPreview);
    if (el) el.addEventListener('change', updateCmdPreview);
  });
  document.getElementById('f-cmd').addEventListener('change', toggleDestFields);
  ['f-sprov', 'f-dprov'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updatePathPlaceholders);
  });

  // Extra-args help: click a flag to append it to the field
  document.getElementById('flag-help').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-flag]');
    if (!btn) return;
    const input = document.getElementById('f-extra');
    const cur = input.value.trim();
    const flag = btn.dataset.flag;
    input.value = (cur ? cur + ' ' : '') + flag;
    input.focus();
    // If the flag carries a {PLACEHOLDER}, select it so the value can be typed over it.
    const ph = flag.match(/\{[^}]*\}/);
    if (ph) {
      const start = input.value.length - flag.length + ph.index;
      input.setSelectionRange(start, start + ph[0].length);
    }
    updateCmdPreview();
  });

  // Save buttons
  document.getElementById('save-job-btn').addEventListener('click', saveJob);
  document.getElementById('save-prov-btn').addEventListener('click', saveProvider);
  document.getElementById('new-job-btn').addEventListener('click', () => openJobForm(null));
  document.getElementById('new-prov-btn').addEventListener('click', () => openProvForm(null));
  document.getElementById('add-custom-key-btn').addEventListener('click', addCustomKey);

  // Run screen
  document.getElementById('stop-btn').addEventListener('click', stopRun);
  document.getElementById('confirm-yes').addEventListener('click', proceedWithRun);
  document.getElementById('confirm-no').addEventListener('click', () => showScreen('dashboard'));

  // Provider form type change
  document.getElementById('p-type').addEventListener('change', renderProviderFields);
  document.getElementById('p-name').addEventListener('input', renderProviderFields);

  // Reset idle timer on form interaction (focusin, input, change on any form element).
  // Debounced to at most one ping per 15 s so we don't flood the server.
  let pingPending = false;
  document.addEventListener('focusin', maybeping);
  document.addEventListener('input', maybeping);
  document.addEventListener('change', maybeping);
  function maybeping(e) {
    if (!e.target.matches('input, textarea, select, button')) return;
    if (pingPending) return;
    pingPending = true;
    setTimeout(() => { pingPending = false; }, 15000);
    fetch('/api/ping').catch(() => {});
  }

  // Check session status on load
  checkStatus();
});
