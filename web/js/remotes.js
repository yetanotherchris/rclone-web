/* rclone-web — helpers for formatting rclone remotes/routes from job + provider state. */
'use strict';

import { state } from './state.js';

export function isOneSided(cmd) {
  return ['lsf', 'ls', 'lsl', 'lsjson', 'lsd'].includes(cmd);
}

export function isLocalProvider(provName) {
  if (!provName) return true; // "(none / local path)"
  const prov = state.providers.find(p => p.name === provName);
  return !prov || prov.type === 'local';
}

export function formatRemote(provName, path) {
  if (!provName) return path || '';
  const prov = state.providers.find(p => p.name === provName);
  if (prov && prov.type === 'local') return path || '';
  return `${provName}:${path || ''}`;
}

export function formatRoute(job) {
  const src = formatRemote(job.source_provider, job.source_path);
  if (isOneSided(job.command)) return src;
  const dst = formatRemote(job.dest_provider, job.dest_path);
  return `${src} → ${dst}`;
}
