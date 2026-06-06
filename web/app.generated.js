/* GENERATED from web/js/*.js by `go generate ./...` — do not edit by hand. */
"use strict";
(() => {
  // web/js/state.js
  var state = {
    csrfToken: "",
    providers: [],
    // [{name, type, ...extra}]
    jobs: [],
    // [{id, name, command, ...}]
    backends: [],
    // rclone config providers JSON
    currentRun: null,
    // {id, jobId, dryRun, ...}
    pollTimer: null,
    idleTimer: null,
    pendingRunJobId: null,
    pendingRunDryRun: false,
    shortLen: 0,
    // 0 = full-passphrase mode; >0 = short-password prefix length
    editingProvName: null
  };

  // web/js/util.js
  function esc(str) {
    return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function showError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
  }
  function clearError(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }
  function runStatusBadge(status, exitCode) {
    const map = {
      success: "bg-emerald-100 text-emerald-700",
      failed: "bg-rose-100 text-rose-700",
      canceled: "bg-slate-100 text-slate-500",
      running: "bg-blue-100 text-blue-700"
    };
    const cls = map[status] || "bg-slate-100 text-slate-500";
    const label = status === "failed" ? `failed (exit ${exitCode})` : status;
    return `<span class="rounded-full ${cls} px-2.5 py-1 text-xs font-medium">${esc(label)}</span>`;
  }

  // web/js/remotes.js
  function isOneSided(cmd) {
    return ["lsf", "ls", "lsl", "lsjson", "lsd"].includes(cmd);
  }
  function isLocalProvider(provName) {
    if (!provName) return true;
    const prov = state.providers.find((p) => p.name === provName);
    return !prov || prov.type === "local";
  }
  function formatRemote(provName, path) {
    if (!provName) return path || "";
    const prov = state.providers.find((p) => p.name === provName);
    if (prov && prov.type === "local") return path || "";
    return `${provName}:${path || ""}`;
  }
  function formatRoute(job) {
    const src = formatRemote(job.source_provider, job.source_path);
    if (isOneSided(job.command)) return src;
    const dst = formatRemote(job.dest_provider, job.dest_path);
    return `${src} → ${dst}`;
  }

  // web/js/api.js
  async function api(method, path, body) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" }
    };
    if (state.csrfToken && method !== "GET") {
      opts.headers["X-CSRF-Token"] = state.csrfToken;
    }
    if (body !== void 0) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (res.status === 401) {
      showLock();
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data && data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  // web/js/runs.js
  var DESTRUCTIVE = ["sync", "move"];
  function startRunFlow(jobId, dryRun) {
    state.pendingRunJobId = jobId;
    state.pendingRunDryRun = dryRun;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    document.getElementById("run-title").textContent = `Run · ${job.name}${dryRun ? " (dry-run)" : ""}`;
    document.getElementById("run-started").textContent = "";
    document.getElementById("run-cmdline").textContent = "";
    document.getElementById("run-log").textContent = "";
    document.getElementById("run-log-panel").classList.add("hidden");
    document.getElementById("run-status-badge").textContent = "preparing…";
    document.getElementById("run-status-badge").className = "rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700";
    document.getElementById("stop-btn").classList.remove("hidden");
    if (!dryRun && DESTRUCTIVE.includes(job.command)) {
      document.getElementById("confirm-cmd").textContent = job.command;
      document.getElementById("confirm-box").classList.remove("hidden");
      showScreen("run");
    } else {
      document.getElementById("confirm-box").classList.add("hidden");
      showScreen("run");
      proceedWithRun();
    }
  }
  async function proceedWithRun() {
    document.getElementById("confirm-box").classList.add("hidden");
    try {
      const qs = state.pendingRunDryRun ? "?dryRun=true" : "";
      const data = await api("POST", `/api/jobs/${state.pendingRunJobId}/run${qs}`);
      if (!data) return;
      state.currentRun = { id: data.runId, jobId: state.pendingRunJobId };
      const run = await api("GET", `/api/runs/${data.runId}`);
      if (!run) return;
      document.getElementById("run-started").textContent = `Started ${new Date(run.startedAt).toLocaleTimeString()}`;
      document.getElementById("run-cmdline").textContent = run.cmdline || "";
      document.getElementById("run-log-panel").classList.remove("hidden");
      startPoll(data.runId);
    } catch (err) {
      document.getElementById("run-status-badge").textContent = "error";
      document.getElementById("run-status-badge").className = "rounded-full bg-rose-100 px-3 py-1 text-sm font-medium text-rose-700";
      alert("Start run failed: " + err.message);
    }
  }
  function startPoll(runId) {
    stopPoll();
    let since = 0;
    async function poll() {
      try {
        const data = await api("GET", `/api/runs/${runId}/log?since=${since}`);
        if (!data) return;
        if (data.lines && data.lines.length) {
          const pre = document.getElementById("run-log");
          pre.textContent += data.lines.join("\n") + "\n";
          pre.scrollTop = pre.scrollHeight;
        }
        since = data.next;
        document.getElementById("poll-tick").textContent = `since=${since}`;
        updateRunStatusBadge(data.status);
        if (data.status !== "running") {
          stopPoll();
          document.getElementById("stop-btn").classList.add("hidden");
          state.jobs = await api("GET", "/api/jobs") || state.jobs;
          return;
        }
        state.pollTimer = setTimeout(poll, 1e3);
      } catch {
      }
    }
    poll();
  }
  function stopPoll() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }
  function updateRunStatusBadge(status) {
    const el = document.getElementById("run-status-badge");
    const map = {
      running: ["bg-blue-100 text-blue-700", "running…"],
      success: ["bg-emerald-100 text-emerald-700", "success · exit 0"],
      failed: ["bg-rose-100 text-rose-700", "failed"],
      canceled: ["bg-slate-200 text-slate-600", "canceled"]
    };
    const [cls, text] = map[status] || ["bg-slate-200 text-slate-600", status];
    el.className = `rounded-full px-3 py-1 text-sm font-medium ${cls}`;
    el.textContent = text;
  }
  async function stopRun() {
    if (!state.currentRun) return;
    try {
      await api("POST", `/api/runs/${state.currentRun.id}/stop`);
    } catch {
    }
  }

  // web/js/dashboard.js
  function renderDashboard() {
    const pCount = state.providers.length;
    const jCount = state.jobs.length;
    document.getElementById("dashboard-summary").textContent = `${jCount} job${jCount !== 1 ? "s" : ""} · ${pCount} provider${pCount !== 1 ? "s" : ""}`;
    const tbody = document.getElementById("dashboard-tbody");
    tbody.innerHTML = "";
    if (!state.jobs.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-6 text-center text-sm text-slate-400">No jobs yet. <a href="#" class="dash-add-link text-brand-600 hover:underline">Add one</a>.</td></tr>';
      const link = tbody.querySelector(".dash-add-link");
      if (link) link.addEventListener("click", (e) => {
        e.preventDefault();
        showScreen("jobs");
      });
      return;
    }
    state.jobs.forEach((job) => {
      const route = formatRoute(job);
      const lastRun = job.lastRun;
      let statusBadge = '<span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">never run</span>';
      if (lastRun) {
        statusBadge = runStatusBadge(lastRun.status, lastRun.exitCode);
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td class="px-5 py-4 font-medium">${esc(job.name)}</td>
      <td class="px-5 py-4 font-mono text-xs text-slate-500">${esc(route)}</td>
      <td class="px-5 py-4">${statusBadge}</td>
      <td class="px-5 py-4 text-right space-x-2">
        <button class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 run-btn" data-job-id="${job.id}" data-dry="false">Run</button>
        <button class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 run-btn" data-job-id="${job.id}" data-dry="true">Dry-run</button>
      </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".run-btn").forEach((btn) => {
      btn.addEventListener("click", () => startRunFlow(btn.dataset.jobId, btn.dataset.dry === "true"));
    });
  }

  // web/js/jobs.js
  function renderJobsList() {
    const tbody = document.getElementById("jobs-tbody");
    tbody.innerHTML = "";
    if (!state.jobs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center text-sm text-slate-400">No jobs yet.</td></tr>';
      return;
    }
    state.jobs.forEach((job) => {
      const cmdBadge = `<span class="rounded bg-${cmdColor(job.command)}-100 px-2 py-0.5 font-mono text-xs ${cmdColor(job.command) !== "slate" ? "text-" + cmdColor(job.command) + "-700" : "text-slate-600"}">${esc(job.command)}</span>`;
      const srcRemote = formatRemote(job.source_provider, job.source_path);
      const dstRemote = isOneSided(job.command) ? "—" : formatRemote(job.dest_provider, job.dest_path);
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td class="px-5 py-4 font-medium">${esc(job.name)}</td>
      <td class="px-5 py-4">${cmdBadge}</td>
      <td class="px-5 py-4 font-mono text-xs text-slate-500">${esc(srcRemote)}</td>
      <td class="px-5 py-4 font-mono text-xs text-slate-500">${esc(dstRemote)}</td>
      <td class="px-5 py-4 text-right">
        <button class="edit-job-btn text-xs font-medium text-brand-600 hover:underline" data-job-id="${job.id}">Edit</button>
        <button class="delete-job-btn ml-3 text-xs font-medium text-rose-600 hover:underline" data-job-id="${job.id}">Delete</button>
      </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".edit-job-btn").forEach(
      (btn) => btn.addEventListener("click", () => openJobForm(btn.dataset.jobId))
    );
    tbody.querySelectorAll(".delete-job-btn").forEach(
      (btn) => btn.addEventListener("click", () => deleteJob(btn.dataset.jobId))
    );
  }
  function cmdColor(cmd) {
    const colors = { copy: "slate", sync: "amber", move: "rose", check: "sky", lsf: "violet" };
    return colors[cmd] || "slate";
  }
  function switchJobTab(tabName) {
    document.querySelectorAll(".job-tab").forEach((t) => t.classList.add("hidden"));
    document.getElementById("tab-" + tabName).classList.remove("hidden");
    document.querySelectorAll(".job-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
  }
  function openJobForm(jobId) {
    const job = jobId ? state.jobs.find((j) => j.id === jobId) : null;
    switchJobTab("details");
    document.getElementById("jobform-title").textContent = job ? "Edit job" : "New job";
    document.getElementById("f-id").value = job ? job.id : "";
    document.getElementById("f-name").value = job ? job.name || "" : "";
    document.getElementById("f-cmd").value = job ? job.command : "copy";
    document.getElementById("f-spath").value = job ? job.source_path || "" : "";
    document.getElementById("f-dpath").value = job ? job.dest_path || "" : "";
    document.getElementById("f-extra").value = job && job.extra_args && job.extra_args !== "undefined" ? job.extra_args : "";
    clearError("jobform-error");
    populateProviderSelects();
    if (job) {
      document.getElementById("f-sprov").value = job.source_provider || "";
      document.getElementById("f-dprov").value = job.dest_provider || "";
    }
    toggleDestFields();
    updatePathPlaceholders();
    updateCmdPreview();
    showScreen("jobform");
  }
  function populateProviderSelects() {
    ["f-sprov", "f-dprov"].forEach((id) => {
      const sel = document.getElementById(id);
      sel.innerHTML = '<option value="">Local path</option>';
      state.providers.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = `${p.name} (${p.type})`;
        sel.appendChild(opt);
      });
    });
  }
  function toggleDestFields() {
    const cmd = document.getElementById("f-cmd").value;
    const hide = isOneSided(cmd);
    document.getElementById("dest-prov-field").classList.toggle("hidden", hide);
    document.getElementById("dest-path-field").classList.toggle("hidden", hide);
  }
  function updatePathPlaceholders() {
    const sLocal = isLocalProvider(document.getElementById("f-sprov").value);
    const dLocal = isLocalProvider(document.getElementById("f-dprov").value);
    document.getElementById("f-spath").placeholder = sLocal ? "D:/folder/  or  D:/folder/file.txt" : "bucketname/folder/  or  bucketname/folder/file.txt";
    document.getElementById("f-dpath").placeholder = dLocal ? "D:/backups/" : "bucketname/  or  bucketname/folder1/folder2/";
  }
  function updateCmdPreview() {
    const cmd = document.getElementById("f-cmd").value;
    const sprov = document.getElementById("f-sprov").value;
    const spath = document.getElementById("f-spath").value;
    const dprov = document.getElementById("f-dprov").value;
    const dpath = document.getElementById("f-dpath").value;
    const extra = document.getElementById("f-extra").value;
    const srcRemote = formatRemote(sprov, spath);
    let line = `rclone ${cmd} ${srcRemote}`;
    if (!isOneSided(cmd)) {
      line += ` ${formatRemote(dprov, dpath)}`;
    }
    if (extra) line += ` ${extra}`;
    document.getElementById("cmd-preview").textContent = line.replace(/\s+/g, " ").trim();
  }
  async function saveJob() {
    const id = document.getElementById("f-id").value;
    const job = {
      id,
      name: document.getElementById("f-name").value.trim(),
      command: document.getElementById("f-cmd").value,
      source_provider: document.getElementById("f-sprov").value,
      source_path: document.getElementById("f-spath").value.trim(),
      dest_provider: document.getElementById("f-dprov").value,
      dest_path: document.getElementById("f-dpath").value.trim(),
      extra_args: document.getElementById("f-extra").value.trim()
    };
    if (!job.name) {
      showError("jobform-error", "Name is required");
      return;
    }
    try {
      let saved;
      if (id) {
        saved = await api("PUT", `/api/jobs/${id}`, job);
      } else {
        saved = await api("POST", "/api/jobs", job);
      }
      if (!saved) return;
      state.jobs = await api("GET", "/api/jobs") || state.jobs;
      showScreen("jobs");
    } catch (err) {
      showError("jobform-error", err.message);
    }
  }
  async function deleteJob(id) {
    if (!confirm("Delete this job?")) return;
    try {
      await api("DELETE", `/api/jobs/${id}`);
      state.jobs = await api("GET", "/api/jobs") || state.jobs;
      renderJobsList();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  }

  // web/js/providers.js
  function renderProvidersList() {
    const grid = document.getElementById("providers-grid");
    grid.innerHTML = "";
    if (!state.providers.length) {
      grid.innerHTML = '<p class="col-span-2 text-center text-sm text-slate-400 py-8">No providers yet.</p>';
      return;
    }
    state.providers.forEach((p) => {
      const keys = Object.entries(p).filter(([k]) => k !== "name" && k !== "type").slice(0, 3);
      const keyRows = keys.map(([k, v]) => `
      <div class="flex justify-between">
        <dt class="text-slate-500">${esc(k)}</dt>
        <dd class="font-mono">${isSensitiveKey(k) ? "••••••••" : esc(String(v))}</dd>
      </div>`).join("");
      const card = document.createElement("div");
      card.className = "rounded-xl border border-slate-200 bg-white p-5";
      card.innerHTML = `
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 font-bold text-xs">${esc(p.type ? p.type.toUpperCase().slice(0, 2) : "??")}</span>
          <span class="font-medium">${esc(p.name)}</span>
        </div>
        <span class="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">type: ${esc(p.type || "")}</span>
      </div>
      <dl class="space-y-1 text-sm">${keyRows || '<div class="text-slate-400">(no extra keys)</div>'}</dl>
      <div class="mt-4 flex gap-3 text-xs">
        <button class="edit-prov-btn font-medium text-brand-600 hover:underline" data-prov-name="${esc(p.name)}">Edit</button>
        <button class="delete-prov-btn font-medium text-rose-600 hover:underline" data-prov-name="${esc(p.name)}">Delete</button>
      </div>`;
      grid.appendChild(card);
    });
    grid.querySelectorAll(".edit-prov-btn").forEach(
      (btn) => btn.addEventListener("click", () => openProvForm(btn.dataset.provName))
    );
    grid.querySelectorAll(".delete-prov-btn").forEach(
      (btn) => btn.addEventListener("click", () => deleteProvider(btn.dataset.provName))
    );
  }
  function isSensitiveKey(k) {
    const lower = k.toLowerCase();
    return lower.includes("key") || lower.includes("secret") || lower.includes("password") || lower.includes("pass") || lower.includes("token");
  }
  function switchProvTab(tabName) {
    document.querySelectorAll(".prov-tab").forEach((t) => t.classList.add("hidden"));
    document.getElementById("ptab-" + tabName).classList.remove("hidden");
    document.querySelectorAll(".prov-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
  }
  function openProvForm(name) {
    state.editingProvName = name;
    switchProvTab("details");
    const prov = name ? state.providers.find((p) => p.name === name) : null;
    document.getElementById("provform-title").textContent = prov ? "Edit provider" : "New provider";
    document.getElementById("p-name").value = prov ? prov.name : "";
    document.getElementById("p-name").disabled = !!prov;
    clearError("provform-error");
    populateBackendTypeSelect();
    if (prov) document.getElementById("p-type").value = prov.type || "";
    renderProviderFields();
    showScreen("provform");
    if (prov) {
      Object.entries(prov).forEach(([k, v]) => {
        if (k === "name" || k === "type") return;
        const el = document.getElementById("pf-" + k);
        if (el) el.value = v;
      });
    }
  }
  function populateBackendTypeSelect() {
    const sel = document.getElementById("p-type");
    const current = sel.value;
    sel.innerHTML = "";
    const common = ["b2", "local", "s3", "sftp", "crypt", "drive", "onedrive", "azureblob", "dropbox", "ftp", "webdav"];
    const set = new Set(common);
    if (state.backends && state.backends.length) {
      state.backends.forEach((b) => {
        if (b.Name) set.add(b.Name);
      });
    }
    [...set].sort().forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }
  function renderProviderFields() {
    const type = document.getElementById("p-type").value;
    const name = (document.getElementById("p-name").value || "remote").toUpperCase();
    const prefix = `RCLONE_CONFIG_${name}_`;
    const backend = state.backends && state.backends.find((b) => b.Name === type);
    const options = backend && backend.Options || [];
    const required = options.filter((o) => !o.Advanced && !o.Hide);
    const advanced = options.filter((o) => o.Advanced && !o.Hide);
    if (type === "drive") {
      const fileIdx = required.findIndex((o) => o.Name === "service_account_file");
      if (fileIdx !== -1) advanced.unshift(...required.splice(fileIdx, 1));
      const blob = options.find((o) => o.Name === "service_account_credentials");
      if (blob && !required.includes(blob)) required.unshift(blob);
    }
    const fieldsEl = document.getElementById("p-fields");
    const advEl = document.getElementById("p-fields-advanced");
    if (required.length) {
      fieldsEl.innerHTML = required.map((o) => backendFieldHTML(o, prefix)).join("");
    } else {
      fieldsEl.innerHTML = '<p class="text-sm text-slate-400">This backend has no required fields. Check the Advanced tab for options or add custom keys there.</p>';
    }
    if (advanced.length) {
      advEl.innerHTML = advanced.map((o) => backendFieldHTML(o, prefix)).join("");
    } else {
      advEl.innerHTML = '<p class="text-sm text-slate-400">No advanced options for this backend.</p>';
    }
  }
  function backendFieldHTML(opt, prefix) {
    const key = opt.Name || "";
    const helpLines = opt.Help ? opt.Help.trim().split("\n").map((l) => l.trim()).filter(Boolean) : [];
    const label = helpLines[0] || key;
    const extraHelp = helpLines.slice(1).join(" ");
    const envKey = prefix + key.toUpperCase();
    const tipParts = [];
    if (extraHelp) tipParts.push(esc(extraHelp));
    tipParts.push(`<span style="opacity:0.65;font-style:italic">${esc(envKey)}</span>`);
    const isPassword = opt.IsPassword || opt.Sensitive;
    const isServiceAccount = key === "service_account_credentials";
    const isToken = key === "token";
    const isBlob = isServiceAccount || isToken;
    if (isServiceAccount) tipParts.unshift("Paste the JSON itself to keep credentials inside the encrypted config - no plaintext key file left on disk. Prefer a file on disk? Use the &quot;Service Account Credentials JSON file path&quot; field under Advanced.");
    if (isToken) tipParts.unshift('Paste the OAuth token JSON blob ({"access_token":"...","refresh_token":"...",...}) obtained from rclone config.');
    const tooltipHtml = ` <span class="tt" style="vertical-align:middle"><span style="font-size:0.7rem;color:#94a3b8;cursor:help;font-weight:400">ⓘ</span><span class="tt-tip wide">${tipParts.join("<br>")}</span></span>`;
    let input;
    if (isBlob) {
      const ph = isServiceAccount ? '{ "type": "service_account", "project_id": "...", ... }' : '{"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}';
      input = `<textarea id="pf-${esc(key)}" rows="3" placeholder='${ph}' class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"></textarea>`;
    } else if (opt.Examples && opt.Examples.length > 1) {
      const opts = opt.Examples.map((ex) => `<option value="${esc(ex.Value)}">${esc(ex.Help || ex.Value)}</option>`).join("");
      input = `<select id="pf-${esc(key)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">${opts}</select>`;
    } else if (opt.Type === "bool") {
      const def = opt.DefaultStr !== void 0 ? opt.DefaultStr : opt.Default !== void 0 ? String(opt.Default) : "";
      const checked = def === "true" ? " checked" : "";
      return `<div class="flex items-center gap-3 py-1">
      <label class="toggle shrink-0"><input type="checkbox" id="pf-${esc(key)}" class="toggle-cb"${checked}><span class="toggle-track"></span></label>
      <label for="pf-${esc(key)}" class="text-sm font-semibold cursor-pointer">${esc(label)}${tooltipHtml}</label>
    </div>`;
    } else {
      const t = opt.Type === "int" ? "number" : "text";
      const def = opt.DefaultStr !== void 0 ? opt.DefaultStr : opt.Default !== void 0 ? String(opt.Default) : "";
      input = `<input type="${t}" id="pf-${esc(key)}" value="${esc(def)}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">`;
    }
    return `<div>
    <label class="mb-1 block text-sm font-semibold">${esc(label)}${tooltipHtml}</label>${input}</div>`;
  }
  function addCustomKey() {
    const row = document.createElement("div");
    row.className = "flex gap-2 custom-key-row";
    row.innerHTML = `
    <input placeholder="key" class="custom-key w-1/3 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">
    <input placeholder="value" class="custom-val flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm">
    <button class="rounded-lg border border-slate-300 px-3 text-slate-400 hover:bg-slate-50">✕</button>`;
    row.querySelector("button").addEventListener("click", () => row.remove());
    document.getElementById("p-fields").appendChild(row);
  }
  async function saveProvider() {
    const name = document.getElementById("p-name").value.trim();
    const type = document.getElementById("p-type").value;
    if (!name) {
      showError("provform-error", "Name is required");
      return;
    }
    const extra = {};
    document.querySelectorAll('#p-fields [id^="pf-"], #p-fields-advanced [id^="pf-"]').forEach((el) => {
      const key = el.id.replace("pf-", "");
      if (el.type === "checkbox") {
        extra[key] = el.checked ? "true" : "false";
      } else if (el.value && el.value !== el.getAttribute("placeholder")) {
        extra[key] = el.value;
      }
    });
    document.querySelectorAll(".custom-key-row").forEach((row) => {
      const k = row.querySelector(".custom-key").value.trim();
      const v = row.querySelector(".custom-val").value;
      if (k) extra[k] = v;
    });
    const body = { name, type, ...extra };
    try {
      if (state.editingProvName) {
        await api("PUT", `/api/providers/${state.editingProvName}`, { type, ...extra });
      } else {
        await api("POST", "/api/providers", body);
      }
      state.providers = await api("GET", "/api/providers") || state.providers;
      showScreen("providers");
    } catch (err) {
      showError("provform-error", err.message);
    }
  }
  async function deleteProvider(name) {
    if (!confirm(`Delete provider "${name}"?`)) return;
    try {
      await api("DELETE", `/api/providers/${name}`);
      state.providers = await api("GET", "/api/providers") || state.providers;
      renderProvidersList();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  }

  // web/js/screens.js
  function configureLockUI(n) {
    const prefixMode = n > 0;
    document.getElementById("lock-prefix-mode").classList.toggle("hidden", !prefixMode);
    document.getElementById("lock-full-mode").classList.toggle("hidden", prefixMode);
    if (prefixMode) {
      document.getElementById("prefix-len").textContent = n;
      document.getElementById("prefix-input").maxLength = n;
    }
  }
  function showLock() {
    configureLockUI(state.shortLen);
    document.getElementById("prefix-input").value = "";
    document.getElementById("full-input").value = "";
    document.getElementById("lock-error").classList.add("hidden");
    document.getElementById("lock").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
    document.getElementById(state.shortLen > 0 ? "prefix-input" : "full-input").focus();
  }
  function showApp() {
    document.getElementById("lock").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
  }
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(
      (s) => s.classList.toggle("hidden", s.dataset.screen !== name)
    );
    const navTarget = { jobform: "jobs", provform: "providers", run: "dashboard" }[name] || name;
    document.querySelectorAll(".nav-btn").forEach((b) => {
      const active = b.dataset.nav === navTarget;
      b.classList.toggle("bg-brand-50", active);
      b.classList.toggle("text-brand-700", active);
      b.classList.toggle("text-slate-600", !active);
    });
    if (name === "dashboard") renderDashboard();
    if (name === "jobs") renderJobsList();
    if (name === "providers") renderProvidersList();
  }

  // web/js/session.js
  async function checkStatus() {
    try {
      const data = await fetch("/api/status").then((r) => r.json());
      state.shortLen = data.shortLen || 0;
      configureLockUI(state.shortLen);
      if (data.locked) {
        showLock();
      } else {
        await loadInitialData();
        showApp();
        showScreen("dashboard");
      }
    } catch {
      showLock();
    }
  }
  async function doUnlock() {
    const btn = document.getElementById("unlock-btn");
    btn.disabled = true;
    btn.textContent = "Unlocking…";
    clearError("lock-error");
    const prefixMode = !document.getElementById("lock-prefix-mode").classList.contains("hidden");
    const prefix = prefixMode ? document.getElementById("prefix-input").value : document.getElementById("full-input").value;
    try {
      const data = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix })
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unlock failed");
        return d;
      });
      state.csrfToken = data.csrfToken;
      await loadInitialData();
      showApp();
      showScreen("dashboard");
    } catch (err) {
      showError("lock-error", err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Unlock & decrypt";
    }
  }
  async function doLock() {
    await fetch("/api/lock", { method: "POST" });
    state.csrfToken = "";
    state.jobs = [];
    state.providers = [];
    stopPoll();
    showLock();
  }
  async function loadInitialData() {
    [state.jobs, state.providers, state.backends] = await Promise.all([
      api("GET", "/api/jobs"),
      api("GET", "/api/providers"),
      api("GET", "/api/backends")
    ]);
    if (!state.jobs) state.jobs = [];
    if (!state.providers) state.providers = [];
    if (!state.backends) state.backends = [];
    populateBackendTypeSelect();
    startIdleCountdown();
  }
  function startIdleCountdown() {
    if (state.idleTimer) clearInterval(state.idleTimer);
    state.idleTimer = setInterval(async () => {
      try {
        const data = await fetch("/api/status").then((r) => r.json());
        if (data.locked) {
          clearInterval(state.idleTimer);
          showLock();
          return;
        }
        const s = data.idleSecondsLeft || 0;
        const m = Math.floor(s / 60);
        const sec = String(s % 60).padStart(2, "0");
        document.getElementById("idle-countdown").textContent = `${m}:${sec}`;
      } catch {
      }
    }, 5e3);
  }

  // web/js/main.js
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => showScreen(btn.dataset.nav));
    });
    document.querySelectorAll(".job-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchJobTab(btn.dataset.tab));
    });
    document.querySelectorAll(".prov-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchProvTab(btn.dataset.tab));
    });
    document.querySelectorAll(".back-btn").forEach((btn) => {
      btn.addEventListener("click", () => showScreen(btn.dataset.back));
    });
    document.getElementById("unlock-btn").addEventListener("click", doUnlock);
    document.getElementById("lock-btn").addEventListener("click", doLock);
    ["prefix-input", "full-input"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doUnlock();
      });
    });
    ["f-cmd", "f-sprov", "f-spath", "f-dprov", "f-dpath", "f-extra"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", updateCmdPreview);
      if (el) el.addEventListener("change", updateCmdPreview);
    });
    document.getElementById("f-cmd").addEventListener("change", toggleDestFields);
    ["f-sprov", "f-dprov"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", updatePathPlaceholders);
    });
    document.getElementById("flag-help").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-flag]");
      if (!btn) return;
      const input = document.getElementById("f-extra");
      const cur = input.value.trim();
      const flag = btn.dataset.flag;
      input.value = (cur ? cur + " " : "") + flag;
      input.focus();
      const ph = flag.match(/\{[^}]*\}/);
      if (ph) {
        const start = input.value.length - flag.length + ph.index;
        input.setSelectionRange(start, start + ph[0].length);
      }
      updateCmdPreview();
    });
    document.getElementById("save-job-btn").addEventListener("click", saveJob);
    document.getElementById("save-prov-btn").addEventListener("click", saveProvider);
    document.getElementById("new-job-btn").addEventListener("click", () => openJobForm(null));
    document.getElementById("new-prov-btn").addEventListener("click", () => openProvForm(null));
    document.getElementById("add-custom-key-btn").addEventListener("click", addCustomKey);
    document.getElementById("stop-btn").addEventListener("click", stopRun);
    document.getElementById("confirm-yes").addEventListener("click", proceedWithRun);
    document.getElementById("confirm-no").addEventListener("click", () => showScreen("dashboard"));
    document.getElementById("p-type").addEventListener("change", renderProviderFields);
    document.getElementById("p-name").addEventListener("input", renderProviderFields);
    let pingPending = false;
    document.addEventListener("focusin", maybeping);
    document.addEventListener("input", maybeping);
    document.addEventListener("change", maybeping);
    function maybeping(e) {
      if (!e.target.matches("input, textarea, select, button")) return;
      if (pingPending) return;
      pingPending = true;
      setTimeout(() => {
        pingPending = false;
      }, 15e3);
      fetch("/api/ping").catch(() => {
      });
    }
    checkStatus();
  });
})();
