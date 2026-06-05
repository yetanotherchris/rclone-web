/* rclone-web — shared mutable application state.
 *
 * ES-module `import` bindings are read-only, so cross-module state lives on a
 * single exported object whose fields are mutated in place (e.g. state.jobs = …).
 */
'use strict';

export const state = {
  csrfToken: '',
  providers: [],       // [{name, type, ...extra}]
  jobs: [],            // [{id, name, command, ...}]
  backends: [],        // rclone config providers JSON
  currentRun: null,    // {id, jobId, dryRun, ...}
  pollTimer: null,
  idleTimer: null,
  pendingRunJobId: null,
  pendingRunDryRun: false,
  shortLen: 0,         // 0 = full-passphrase mode; >0 = short-password prefix length
  editingProvName: null,
};
