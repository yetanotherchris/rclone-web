/* rclone-web — fetch wrapper that attaches CSRF and handles session expiry. */
'use strict';

import { state } from './state.js';
import { showLock } from './screens.js';

export async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (state.csrfToken && method !== 'GET') {
    opts.headers['X-CSRF-Token'] = state.csrfToken;
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    showLock();
    return null;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `HTTP ${res.status}`);
  }
  return data;
}
