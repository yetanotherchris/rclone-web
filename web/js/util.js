/* rclone-web — small DOM/string utilities shared across modules. */
'use strict';

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

export function clearError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

export function runStatusBadge(status, exitCode) {
  const map = {
    success:  'bg-emerald-100 text-emerald-700',
    failed:   'bg-rose-100 text-rose-700',
    canceled: 'bg-slate-100 text-slate-500',
    running:  'bg-blue-100 text-blue-700',
  };
  const cls = map[status] || 'bg-slate-100 text-slate-500';
  const label = status === 'failed' ? `failed (exit ${exitCode})` : status;
  return `<span class="rounded-full ${cls} px-2.5 py-1 text-xs font-medium">${esc(label)}</span>`;
}
