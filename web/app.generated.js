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
    queues: [],
    // [{id, name, job_ids, on_failure, lastQueueRun}]
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
    editingProvName: null,
    currentQueueRun: null,
    // full queue run object from API
    queuePollTimer: null,
    queueLogRunId: null,
    // runId of job currently shown in queuelogs screen
    editingQueueId: null
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

  // web/js/jobs.js
  function renderJobsList() {
    const tbody = document.getElementById("jobs-tbody");
    tbody.innerHTML = "";
    if (!state.jobs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-6 text-center text-sm text-slate-400">No jobs yet.</td></tr>';
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
      <td class="px-5 py-4 text-xs">${lastRunCell(job)}</td>
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
  function lastRunCell(job) {
    if (!job.last_run_at) return '<span class="text-slate-400">Never</span>';
    const d = new Date(job.last_run_at);
    const date = d.toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" });
    const s = job.last_run_status;
    const dot = s === "success" ? '<span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"></span>' : s === "failed" ? '<span class="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1"></span>' : s === "canceled" ? '<span class="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1"></span>' : "";
    return `${dot}<span class="text-slate-700">${date}</span> <span class="text-slate-400">${time}</span>`;
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
    document.getElementById("f-spath").placeholder = "";
    document.getElementById("f-dpath").placeholder = "";
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

  // node_modules/sortablejs/modular/sortable.esm.js
  function _defineProperty(e, r, t) {
    return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
      value: t,
      enumerable: true,
      configurable: true,
      writable: true
    }) : e[r] = t, e;
  }
  function _extends() {
    return _extends = Object.assign ? Object.assign.bind() : function(n) {
      for (var e = 1; e < arguments.length; e++) {
        var t = arguments[e];
        for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);
      }
      return n;
    }, _extends.apply(null, arguments);
  }
  function ownKeys(e, r) {
    var t = Object.keys(e);
    if (Object.getOwnPropertySymbols) {
      var o = Object.getOwnPropertySymbols(e);
      r && (o = o.filter(function(r2) {
        return Object.getOwnPropertyDescriptor(e, r2).enumerable;
      })), t.push.apply(t, o);
    }
    return t;
  }
  function _objectSpread2(e) {
    for (var r = 1; r < arguments.length; r++) {
      var t = null != arguments[r] ? arguments[r] : {};
      r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
        _defineProperty(e, r2, t[r2]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
        Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
      });
    }
    return e;
  }
  function _objectWithoutProperties(e, t) {
    if (null == e) return {};
    var o, r, i = _objectWithoutPropertiesLoose(e, t);
    if (Object.getOwnPropertySymbols) {
      var n = Object.getOwnPropertySymbols(e);
      for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]);
    }
    return i;
  }
  function _objectWithoutPropertiesLoose(r, e) {
    if (null == r) return {};
    var t = {};
    for (var n in r) if ({}.hasOwnProperty.call(r, n)) {
      if (-1 !== e.indexOf(n)) continue;
      t[n] = r[n];
    }
    return t;
  }
  function _toPrimitive(t, r) {
    if ("object" != typeof t || !t) return t;
    var e = t[Symbol.toPrimitive];
    if (void 0 !== e) {
      var i = e.call(t, r || "default");
      if ("object" != typeof i) return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return ("string" === r ? String : Number)(t);
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return "symbol" == typeof i ? i : i + "";
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  var version = "1.15.7";
  function userAgent(pattern) {
    if (typeof window !== "undefined" && window.navigator) {
      return !!/* @__PURE__ */ navigator.userAgent.match(pattern);
    }
  }
  var IE11OrLess = userAgent(/(?:Trident.*rv[ :]?11\.|msie|iemobile|Windows Phone)/i);
  var Edge = userAgent(/Edge/i);
  var FireFox = userAgent(/firefox/i);
  var Safari = userAgent(/safari/i) && !userAgent(/chrome/i) && !userAgent(/android/i);
  var IOS = userAgent(/iP(ad|od|hone)/i);
  var ChromeForAndroid = userAgent(/chrome/i) && userAgent(/android/i);
  var captureMode = {
    capture: false,
    passive: false
  };
  function on(el, event, fn) {
    el.addEventListener(event, fn, !IE11OrLess && captureMode);
  }
  function off(el, event, fn) {
    el.removeEventListener(event, fn, !IE11OrLess && captureMode);
  }
  function matches(el, selector) {
    if (!selector) return;
    selector[0] === ">" && (selector = selector.substring(1));
    if (el) {
      try {
        if (el.matches) {
          return el.matches(selector);
        } else if (el.msMatchesSelector) {
          return el.msMatchesSelector(selector);
        } else if (el.webkitMatchesSelector) {
          return el.webkitMatchesSelector(selector);
        }
      } catch (_) {
        return false;
      }
    }
    return false;
  }
  function getParentOrHost(el) {
    return el.host && el !== document && el.host.nodeType && el.host !== el ? el.host : el.parentNode;
  }
  function closest(el, selector, ctx, includeCTX) {
    if (el) {
      ctx = ctx || document;
      do {
        if (selector != null && (selector[0] === ">" ? el.parentNode === ctx && matches(el, selector) : matches(el, selector)) || includeCTX && el === ctx) {
          return el;
        }
        if (el === ctx) break;
      } while (el = getParentOrHost(el));
    }
    return null;
  }
  var R_SPACE = /\s+/g;
  function toggleClass(el, name, state2) {
    if (el && name) {
      if (el.classList) {
        el.classList[state2 ? "add" : "remove"](name);
      } else {
        var className = (" " + el.className + " ").replace(R_SPACE, " ").replace(" " + name + " ", " ");
        el.className = (className + (state2 ? " " + name : "")).replace(R_SPACE, " ");
      }
    }
  }
  function css(el, prop, val) {
    var style = el && el.style;
    if (style) {
      if (val === void 0) {
        if (document.defaultView && document.defaultView.getComputedStyle) {
          val = document.defaultView.getComputedStyle(el, "");
        } else if (el.currentStyle) {
          val = el.currentStyle;
        }
        return prop === void 0 ? val : val[prop];
      } else {
        if (!(prop in style) && prop.indexOf("webkit") === -1) {
          prop = "-webkit-" + prop;
        }
        style[prop] = val + (typeof val === "string" ? "" : "px");
      }
    }
  }
  function matrix(el, selfOnly) {
    var appliedTransforms = "";
    if (typeof el === "string") {
      appliedTransforms = el;
    } else {
      do {
        var transform = css(el, "transform");
        if (transform && transform !== "none") {
          appliedTransforms = transform + " " + appliedTransforms;
        }
      } while (!selfOnly && (el = el.parentNode));
    }
    var matrixFn = window.DOMMatrix || window.WebKitCSSMatrix || window.CSSMatrix || window.MSCSSMatrix;
    return matrixFn && new matrixFn(appliedTransforms);
  }
  function find(ctx, tagName, iterator) {
    if (ctx) {
      var list = ctx.getElementsByTagName(tagName), i = 0, n = list.length;
      if (iterator) {
        for (; i < n; i++) {
          iterator(list[i], i);
        }
      }
      return list;
    }
    return [];
  }
  function getWindowScrollingElement() {
    var scrollingElement = document.scrollingElement;
    if (scrollingElement) {
      return scrollingElement;
    } else {
      return document.documentElement;
    }
  }
  function getRect(el, relativeToContainingBlock, relativeToNonStaticParent, undoScale, container) {
    if (!el.getBoundingClientRect && el !== window) return;
    var elRect, top, left, bottom, right, height, width;
    if (el !== window && el.parentNode && el !== getWindowScrollingElement()) {
      elRect = el.getBoundingClientRect();
      top = elRect.top;
      left = elRect.left;
      bottom = elRect.bottom;
      right = elRect.right;
      height = elRect.height;
      width = elRect.width;
    } else {
      top = 0;
      left = 0;
      bottom = window.innerHeight;
      right = window.innerWidth;
      height = window.innerHeight;
      width = window.innerWidth;
    }
    if ((relativeToContainingBlock || relativeToNonStaticParent) && el !== window) {
      container = container || el.parentNode;
      if (!IE11OrLess) {
        do {
          if (container && container.getBoundingClientRect && (css(container, "transform") !== "none" || relativeToNonStaticParent && css(container, "position") !== "static")) {
            var containerRect = container.getBoundingClientRect();
            top -= containerRect.top + parseInt(css(container, "border-top-width"));
            left -= containerRect.left + parseInt(css(container, "border-left-width"));
            bottom = top + elRect.height;
            right = left + elRect.width;
            break;
          }
        } while (container = container.parentNode);
      }
    }
    if (undoScale && el !== window) {
      var elMatrix = matrix(container || el), scaleX = elMatrix && elMatrix.a, scaleY = elMatrix && elMatrix.d;
      if (elMatrix) {
        top /= scaleY;
        left /= scaleX;
        width /= scaleX;
        height /= scaleY;
        bottom = top + height;
        right = left + width;
      }
    }
    return {
      top,
      left,
      bottom,
      right,
      width,
      height
    };
  }
  function isScrolledPast(el, elSide, parentSide) {
    var parent = getParentAutoScrollElement(el, true), elSideVal = getRect(el)[elSide];
    while (parent) {
      var parentSideVal = getRect(parent)[parentSide], visible = void 0;
      if (parentSide === "top" || parentSide === "left") {
        visible = elSideVal >= parentSideVal;
      } else {
        visible = elSideVal <= parentSideVal;
      }
      if (!visible) return parent;
      if (parent === getWindowScrollingElement()) break;
      parent = getParentAutoScrollElement(parent, false);
    }
    return false;
  }
  function getChild(el, childNum, options, includeDragEl) {
    var currentChild = 0, i = 0, children = el.children;
    while (i < children.length) {
      if (children[i].style.display !== "none" && children[i] !== Sortable.ghost && (includeDragEl || children[i] !== Sortable.dragged) && closest(children[i], options.draggable, el, false)) {
        if (currentChild === childNum) {
          return children[i];
        }
        currentChild++;
      }
      i++;
    }
    return null;
  }
  function lastChild(el, selector) {
    var last = el.lastElementChild;
    while (last && (last === Sortable.ghost || css(last, "display") === "none" || selector && !matches(last, selector))) {
      last = last.previousElementSibling;
    }
    return last || null;
  }
  function index(el, selector) {
    var index2 = 0;
    if (!el || !el.parentNode) {
      return -1;
    }
    while (el = el.previousElementSibling) {
      if (el.nodeName.toUpperCase() !== "TEMPLATE" && el !== Sortable.clone && (!selector || matches(el, selector))) {
        index2++;
      }
    }
    return index2;
  }
  function getRelativeScrollOffset(el) {
    var offsetLeft = 0, offsetTop = 0, winScroller = getWindowScrollingElement();
    if (el) {
      do {
        var elMatrix = matrix(el), scaleX = elMatrix.a, scaleY = elMatrix.d;
        offsetLeft += el.scrollLeft * scaleX;
        offsetTop += el.scrollTop * scaleY;
      } while (el !== winScroller && (el = el.parentNode));
    }
    return [offsetLeft, offsetTop];
  }
  function indexOfObject(arr, obj) {
    for (var i in arr) {
      if (!arr.hasOwnProperty(i)) continue;
      for (var key in obj) {
        if (obj.hasOwnProperty(key) && obj[key] === arr[i][key]) return Number(i);
      }
    }
    return -1;
  }
  function getParentAutoScrollElement(el, includeSelf) {
    if (!el || !el.getBoundingClientRect) return getWindowScrollingElement();
    var elem = el;
    var gotSelf = false;
    do {
      if (elem.clientWidth < elem.scrollWidth || elem.clientHeight < elem.scrollHeight) {
        var elemCSS = css(elem);
        if (elem.clientWidth < elem.scrollWidth && (elemCSS.overflowX == "auto" || elemCSS.overflowX == "scroll") || elem.clientHeight < elem.scrollHeight && (elemCSS.overflowY == "auto" || elemCSS.overflowY == "scroll")) {
          if (!elem.getBoundingClientRect || elem === document.body) return getWindowScrollingElement();
          if (gotSelf || includeSelf) return elem;
          gotSelf = true;
        }
      }
    } while (elem = elem.parentNode);
    return getWindowScrollingElement();
  }
  function extend(dst, src) {
    if (dst && src) {
      for (var key in src) {
        if (src.hasOwnProperty(key)) {
          dst[key] = src[key];
        }
      }
    }
    return dst;
  }
  function isRectEqual(rect1, rect2) {
    return Math.round(rect1.top) === Math.round(rect2.top) && Math.round(rect1.left) === Math.round(rect2.left) && Math.round(rect1.height) === Math.round(rect2.height) && Math.round(rect1.width) === Math.round(rect2.width);
  }
  var _throttleTimeout;
  function throttle(callback, ms) {
    return function() {
      if (!_throttleTimeout) {
        var args = arguments, _this = this;
        if (args.length === 1) {
          callback.call(_this, args[0]);
        } else {
          callback.apply(_this, args);
        }
        _throttleTimeout = setTimeout(function() {
          _throttleTimeout = void 0;
        }, ms);
      }
    };
  }
  function cancelThrottle() {
    clearTimeout(_throttleTimeout);
    _throttleTimeout = void 0;
  }
  function scrollBy(el, x, y) {
    el.scrollLeft += x;
    el.scrollTop += y;
  }
  function clone(el) {
    var Polymer = window.Polymer;
    var $ = window.jQuery || window.Zepto;
    if (Polymer && Polymer.dom) {
      return Polymer.dom(el).cloneNode(true);
    } else if ($) {
      return $(el).clone(true)[0];
    } else {
      return el.cloneNode(true);
    }
  }
  function getChildContainingRectFromElement(container, options, ghostEl2) {
    var rect = {};
    Array.from(container.children).forEach(function(child) {
      var _rect$left, _rect$top, _rect$right, _rect$bottom;
      if (!closest(child, options.draggable, container, false) || child.animated || child === ghostEl2) return;
      var childRect = getRect(child);
      rect.left = Math.min((_rect$left = rect.left) !== null && _rect$left !== void 0 ? _rect$left : Infinity, childRect.left);
      rect.top = Math.min((_rect$top = rect.top) !== null && _rect$top !== void 0 ? _rect$top : Infinity, childRect.top);
      rect.right = Math.max((_rect$right = rect.right) !== null && _rect$right !== void 0 ? _rect$right : -Infinity, childRect.right);
      rect.bottom = Math.max((_rect$bottom = rect.bottom) !== null && _rect$bottom !== void 0 ? _rect$bottom : -Infinity, childRect.bottom);
    });
    rect.width = rect.right - rect.left;
    rect.height = rect.bottom - rect.top;
    rect.x = rect.left;
    rect.y = rect.top;
    return rect;
  }
  var expando = "Sortable" + (/* @__PURE__ */ new Date()).getTime();
  function AnimationStateManager() {
    var animationStates = [], animationCallbackId;
    return {
      captureAnimationState: function captureAnimationState() {
        animationStates = [];
        if (!this.options.animation) return;
        var children = [].slice.call(this.el.children);
        children.forEach(function(child) {
          if (css(child, "display") === "none" || child === Sortable.ghost) return;
          animationStates.push({
            target: child,
            rect: getRect(child)
          });
          var fromRect = _objectSpread2({}, animationStates[animationStates.length - 1].rect);
          if (child.thisAnimationDuration) {
            var childMatrix = matrix(child, true);
            if (childMatrix) {
              fromRect.top -= childMatrix.f;
              fromRect.left -= childMatrix.e;
            }
          }
          child.fromRect = fromRect;
        });
      },
      addAnimationState: function addAnimationState(state2) {
        animationStates.push(state2);
      },
      removeAnimationState: function removeAnimationState(target) {
        animationStates.splice(indexOfObject(animationStates, {
          target
        }), 1);
      },
      animateAll: function animateAll(callback) {
        var _this = this;
        if (!this.options.animation) {
          clearTimeout(animationCallbackId);
          if (typeof callback === "function") callback();
          return;
        }
        var animating = false, animationTime = 0;
        animationStates.forEach(function(state2) {
          var time = 0, target = state2.target, fromRect = target.fromRect, toRect = getRect(target), prevFromRect = target.prevFromRect, prevToRect = target.prevToRect, animatingRect = state2.rect, targetMatrix = matrix(target, true);
          if (targetMatrix) {
            toRect.top -= targetMatrix.f;
            toRect.left -= targetMatrix.e;
          }
          target.toRect = toRect;
          if (target.thisAnimationDuration) {
            if (isRectEqual(prevFromRect, toRect) && !isRectEqual(fromRect, toRect) && // Make sure animatingRect is on line between toRect & fromRect
            (animatingRect.top - toRect.top) / (animatingRect.left - toRect.left) === (fromRect.top - toRect.top) / (fromRect.left - toRect.left)) {
              time = calculateRealTime(animatingRect, prevFromRect, prevToRect, _this.options);
            }
          }
          if (!isRectEqual(toRect, fromRect)) {
            target.prevFromRect = fromRect;
            target.prevToRect = toRect;
            if (!time) {
              time = _this.options.animation;
            }
            _this.animate(target, animatingRect, toRect, time);
          }
          if (time) {
            animating = true;
            animationTime = Math.max(animationTime, time);
            clearTimeout(target.animationResetTimer);
            target.animationResetTimer = setTimeout(function() {
              target.animationTime = 0;
              target.prevFromRect = null;
              target.fromRect = null;
              target.prevToRect = null;
              target.thisAnimationDuration = null;
            }, time);
            target.thisAnimationDuration = time;
          }
        });
        clearTimeout(animationCallbackId);
        if (!animating) {
          if (typeof callback === "function") callback();
        } else {
          animationCallbackId = setTimeout(function() {
            if (typeof callback === "function") callback();
          }, animationTime);
        }
        animationStates = [];
      },
      animate: function animate(target, currentRect, toRect, duration) {
        if (duration) {
          css(target, "transition", "");
          css(target, "transform", "");
          var elMatrix = matrix(this.el), scaleX = elMatrix && elMatrix.a, scaleY = elMatrix && elMatrix.d, translateX = (currentRect.left - toRect.left) / (scaleX || 1), translateY = (currentRect.top - toRect.top) / (scaleY || 1);
          target.animatingX = !!translateX;
          target.animatingY = !!translateY;
          css(target, "transform", "translate3d(" + translateX + "px," + translateY + "px,0)");
          this.forRepaintDummy = repaint(target);
          css(target, "transition", "transform " + duration + "ms" + (this.options.easing ? " " + this.options.easing : ""));
          css(target, "transform", "translate3d(0,0,0)");
          typeof target.animated === "number" && clearTimeout(target.animated);
          target.animated = setTimeout(function() {
            css(target, "transition", "");
            css(target, "transform", "");
            target.animated = false;
            target.animatingX = false;
            target.animatingY = false;
          }, duration);
        }
      }
    };
  }
  function repaint(target) {
    return target.offsetWidth;
  }
  function calculateRealTime(animatingRect, fromRect, toRect, options) {
    return Math.sqrt(Math.pow(fromRect.top - animatingRect.top, 2) + Math.pow(fromRect.left - animatingRect.left, 2)) / Math.sqrt(Math.pow(fromRect.top - toRect.top, 2) + Math.pow(fromRect.left - toRect.left, 2)) * options.animation;
  }
  var plugins = [];
  var defaults = {
    initializeByDefault: true
  };
  var PluginManager = {
    mount: function mount(plugin) {
      for (var option2 in defaults) {
        if (defaults.hasOwnProperty(option2) && !(option2 in plugin)) {
          plugin[option2] = defaults[option2];
        }
      }
      plugins.forEach(function(p) {
        if (p.pluginName === plugin.pluginName) {
          throw "Sortable: Cannot mount plugin ".concat(plugin.pluginName, " more than once");
        }
      });
      plugins.push(plugin);
    },
    pluginEvent: function pluginEvent(eventName, sortable, evt) {
      var _this = this;
      this.eventCanceled = false;
      evt.cancel = function() {
        _this.eventCanceled = true;
      };
      var eventNameGlobal = eventName + "Global";
      plugins.forEach(function(plugin) {
        if (!sortable[plugin.pluginName]) return;
        if (sortable[plugin.pluginName][eventNameGlobal]) {
          sortable[plugin.pluginName][eventNameGlobal](_objectSpread2({
            sortable
          }, evt));
        }
        if (sortable.options[plugin.pluginName] && sortable[plugin.pluginName][eventName]) {
          sortable[plugin.pluginName][eventName](_objectSpread2({
            sortable
          }, evt));
        }
      });
    },
    initializePlugins: function initializePlugins(sortable, el, defaults2, options) {
      plugins.forEach(function(plugin) {
        var pluginName = plugin.pluginName;
        if (!sortable.options[pluginName] && !plugin.initializeByDefault) return;
        var initialized = new plugin(sortable, el, sortable.options);
        initialized.sortable = sortable;
        initialized.options = sortable.options;
        sortable[pluginName] = initialized;
        _extends(defaults2, initialized.defaults);
      });
      for (var option2 in sortable.options) {
        if (!sortable.options.hasOwnProperty(option2)) continue;
        var modified = this.modifyOption(sortable, option2, sortable.options[option2]);
        if (typeof modified !== "undefined") {
          sortable.options[option2] = modified;
        }
      }
    },
    getEventProperties: function getEventProperties(name, sortable) {
      var eventProperties = {};
      plugins.forEach(function(plugin) {
        if (typeof plugin.eventProperties !== "function") return;
        _extends(eventProperties, plugin.eventProperties.call(sortable[plugin.pluginName], name));
      });
      return eventProperties;
    },
    modifyOption: function modifyOption(sortable, name, value) {
      var modifiedValue;
      plugins.forEach(function(plugin) {
        if (!sortable[plugin.pluginName]) return;
        if (plugin.optionListeners && typeof plugin.optionListeners[name] === "function") {
          modifiedValue = plugin.optionListeners[name].call(sortable[plugin.pluginName], value);
        }
      });
      return modifiedValue;
    }
  };
  function dispatchEvent(_ref) {
    var sortable = _ref.sortable, rootEl2 = _ref.rootEl, name = _ref.name, targetEl = _ref.targetEl, cloneEl2 = _ref.cloneEl, toEl = _ref.toEl, fromEl = _ref.fromEl, oldIndex2 = _ref.oldIndex, newIndex2 = _ref.newIndex, oldDraggableIndex2 = _ref.oldDraggableIndex, newDraggableIndex2 = _ref.newDraggableIndex, originalEvent = _ref.originalEvent, putSortable2 = _ref.putSortable, extraEventProperties = _ref.extraEventProperties;
    sortable = sortable || rootEl2 && rootEl2[expando];
    if (!sortable) return;
    var evt, options = sortable.options, onName = "on" + name.charAt(0).toUpperCase() + name.substr(1);
    if (window.CustomEvent && !IE11OrLess && !Edge) {
      evt = new CustomEvent(name, {
        bubbles: true,
        cancelable: true
      });
    } else {
      evt = document.createEvent("Event");
      evt.initEvent(name, true, true);
    }
    evt.to = toEl || rootEl2;
    evt.from = fromEl || rootEl2;
    evt.item = targetEl || rootEl2;
    evt.clone = cloneEl2;
    evt.oldIndex = oldIndex2;
    evt.newIndex = newIndex2;
    evt.oldDraggableIndex = oldDraggableIndex2;
    evt.newDraggableIndex = newDraggableIndex2;
    evt.originalEvent = originalEvent;
    evt.pullMode = putSortable2 ? putSortable2.lastPutMode : void 0;
    var allEventProperties = _objectSpread2(_objectSpread2({}, extraEventProperties), PluginManager.getEventProperties(name, sortable));
    for (var option2 in allEventProperties) {
      evt[option2] = allEventProperties[option2];
    }
    if (rootEl2) {
      rootEl2.dispatchEvent(evt);
    }
    if (options[onName]) {
      options[onName].call(sortable, evt);
    }
  }
  var _excluded = ["evt"];
  var pluginEvent2 = function pluginEvent3(eventName, sortable) {
    var _ref = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {}, originalEvent = _ref.evt, data = _objectWithoutProperties(_ref, _excluded);
    PluginManager.pluginEvent.bind(Sortable)(eventName, sortable, _objectSpread2({
      dragEl,
      parentEl,
      ghostEl,
      rootEl,
      nextEl,
      lastDownEl,
      cloneEl,
      cloneHidden,
      dragStarted: moved,
      putSortable,
      activeSortable: Sortable.active,
      originalEvent,
      oldIndex,
      oldDraggableIndex,
      newIndex,
      newDraggableIndex,
      hideGhostForTarget: _hideGhostForTarget,
      unhideGhostForTarget: _unhideGhostForTarget,
      cloneNowHidden: function cloneNowHidden() {
        cloneHidden = true;
      },
      cloneNowShown: function cloneNowShown() {
        cloneHidden = false;
      },
      dispatchSortableEvent: function dispatchSortableEvent(name) {
        _dispatchEvent({
          sortable,
          name,
          originalEvent
        });
      }
    }, data));
  };
  function _dispatchEvent(info) {
    dispatchEvent(_objectSpread2({
      putSortable,
      cloneEl,
      targetEl: dragEl,
      rootEl,
      oldIndex,
      oldDraggableIndex,
      newIndex,
      newDraggableIndex
    }, info));
  }
  var dragEl;
  var parentEl;
  var ghostEl;
  var rootEl;
  var nextEl;
  var lastDownEl;
  var cloneEl;
  var cloneHidden;
  var oldIndex;
  var newIndex;
  var oldDraggableIndex;
  var newDraggableIndex;
  var activeGroup;
  var putSortable;
  var awaitingDragStarted = false;
  var ignoreNextClick = false;
  var sortables = [];
  var tapEvt;
  var touchEvt;
  var lastDx;
  var lastDy;
  var tapDistanceLeft;
  var tapDistanceTop;
  var moved;
  var lastTarget;
  var lastDirection;
  var pastFirstInvertThresh = false;
  var isCircumstantialInvert = false;
  var targetMoveDistance;
  var ghostRelativeParent;
  var ghostRelativeParentInitialScroll = [];
  var _silent = false;
  var savedInputChecked = [];
  var documentExists = typeof document !== "undefined";
  var PositionGhostAbsolutely = IOS;
  var CSSFloatProperty = Edge || IE11OrLess ? "cssFloat" : "float";
  var supportDraggable = documentExists && !ChromeForAndroid && !IOS && "draggable" in document.createElement("div");
  var supportCssPointerEvents = (function() {
    if (!documentExists) return;
    if (IE11OrLess) {
      return false;
    }
    var el = document.createElement("x");
    el.style.cssText = "pointer-events:auto";
    return el.style.pointerEvents === "auto";
  })();
  var _detectDirection = function _detectDirection2(el, options) {
    var elCSS = css(el), elWidth = parseInt(elCSS.width) - parseInt(elCSS.paddingLeft) - parseInt(elCSS.paddingRight) - parseInt(elCSS.borderLeftWidth) - parseInt(elCSS.borderRightWidth), child1 = getChild(el, 0, options), child2 = getChild(el, 1, options), firstChildCSS = child1 && css(child1), secondChildCSS = child2 && css(child2), firstChildWidth = firstChildCSS && parseInt(firstChildCSS.marginLeft) + parseInt(firstChildCSS.marginRight) + getRect(child1).width, secondChildWidth = secondChildCSS && parseInt(secondChildCSS.marginLeft) + parseInt(secondChildCSS.marginRight) + getRect(child2).width;
    if (elCSS.display === "flex") {
      return elCSS.flexDirection === "column" || elCSS.flexDirection === "column-reverse" ? "vertical" : "horizontal";
    }
    if (elCSS.display === "grid") {
      return elCSS.gridTemplateColumns.split(" ").length <= 1 ? "vertical" : "horizontal";
    }
    if (child1 && firstChildCSS["float"] && firstChildCSS["float"] !== "none") {
      var touchingSideChild2 = firstChildCSS["float"] === "left" ? "left" : "right";
      return child2 && (secondChildCSS.clear === "both" || secondChildCSS.clear === touchingSideChild2) ? "vertical" : "horizontal";
    }
    return child1 && (firstChildCSS.display === "block" || firstChildCSS.display === "flex" || firstChildCSS.display === "table" || firstChildCSS.display === "grid" || firstChildWidth >= elWidth && elCSS[CSSFloatProperty] === "none" || child2 && elCSS[CSSFloatProperty] === "none" && firstChildWidth + secondChildWidth > elWidth) ? "vertical" : "horizontal";
  };
  var _dragElInRowColumn = function _dragElInRowColumn2(dragRect, targetRect, vertical) {
    var dragElS1Opp = vertical ? dragRect.left : dragRect.top, dragElS2Opp = vertical ? dragRect.right : dragRect.bottom, dragElOppLength = vertical ? dragRect.width : dragRect.height, targetS1Opp = vertical ? targetRect.left : targetRect.top, targetS2Opp = vertical ? targetRect.right : targetRect.bottom, targetOppLength = vertical ? targetRect.width : targetRect.height;
    return dragElS1Opp === targetS1Opp || dragElS2Opp === targetS2Opp || dragElS1Opp + dragElOppLength / 2 === targetS1Opp + targetOppLength / 2;
  };
  var _detectNearestEmptySortable = function _detectNearestEmptySortable2(x, y) {
    var ret;
    sortables.some(function(sortable) {
      var threshold = sortable[expando].options.emptyInsertThreshold;
      if (!threshold || lastChild(sortable)) return;
      var rect = getRect(sortable), insideHorizontally = x >= rect.left - threshold && x <= rect.right + threshold, insideVertically = y >= rect.top - threshold && y <= rect.bottom + threshold;
      if (insideHorizontally && insideVertically) {
        return ret = sortable;
      }
    });
    return ret;
  };
  var _prepareGroup = function _prepareGroup2(options) {
    function toFn(value, pull) {
      return function(to, from, dragEl2, evt) {
        var sameGroup = to.options.group.name && from.options.group.name && to.options.group.name === from.options.group.name;
        if (value == null && (pull || sameGroup)) {
          return true;
        } else if (value == null || value === false) {
          return false;
        } else if (pull && value === "clone") {
          return value;
        } else if (typeof value === "function") {
          return toFn(value(to, from, dragEl2, evt), pull)(to, from, dragEl2, evt);
        } else {
          var otherGroup = (pull ? to : from).options.group.name;
          return value === true || typeof value === "string" && value === otherGroup || value.join && value.indexOf(otherGroup) > -1;
        }
      };
    }
    var group = {};
    var originalGroup = options.group;
    if (!originalGroup || _typeof(originalGroup) != "object") {
      originalGroup = {
        name: originalGroup
      };
    }
    group.name = originalGroup.name;
    group.checkPull = toFn(originalGroup.pull, true);
    group.checkPut = toFn(originalGroup.put);
    group.revertClone = originalGroup.revertClone;
    options.group = group;
  };
  var _hideGhostForTarget = function _hideGhostForTarget2() {
    if (!supportCssPointerEvents && ghostEl) {
      css(ghostEl, "display", "none");
    }
  };
  var _unhideGhostForTarget = function _unhideGhostForTarget2() {
    if (!supportCssPointerEvents && ghostEl) {
      css(ghostEl, "display", "");
    }
  };
  if (documentExists && !ChromeForAndroid) {
    document.addEventListener("click", function(evt) {
      if (ignoreNextClick) {
        evt.preventDefault();
        evt.stopPropagation && evt.stopPropagation();
        evt.stopImmediatePropagation && evt.stopImmediatePropagation();
        ignoreNextClick = false;
        return false;
      }
    }, true);
  }
  var nearestEmptyInsertDetectEvent = function nearestEmptyInsertDetectEvent2(evt) {
    if (dragEl) {
      evt = evt.touches ? evt.touches[0] : evt;
      var nearest = _detectNearestEmptySortable(evt.clientX, evt.clientY);
      if (nearest) {
        var event = {};
        for (var i in evt) {
          if (evt.hasOwnProperty(i)) {
            event[i] = evt[i];
          }
        }
        event.target = event.rootEl = nearest;
        event.preventDefault = void 0;
        event.stopPropagation = void 0;
        nearest[expando]._onDragOver(event);
      }
    }
  };
  var _checkOutsideTargetEl = function _checkOutsideTargetEl2(evt) {
    if (dragEl) {
      dragEl.parentNode[expando]._isOutsideThisEl(evt.target);
    }
  };
  function Sortable(el, options) {
    if (!(el && el.nodeType && el.nodeType === 1)) {
      throw "Sortable: `el` must be an HTMLElement, not ".concat({}.toString.call(el));
    }
    this.el = el;
    this.options = options = _extends({}, options);
    el[expando] = this;
    var defaults2 = {
      group: null,
      sort: true,
      disabled: false,
      store: null,
      handle: null,
      draggable: /^[uo]l$/i.test(el.nodeName) ? ">li" : ">*",
      swapThreshold: 1,
      // percentage; 0 <= x <= 1
      invertSwap: false,
      // invert always
      invertedSwapThreshold: null,
      // will be set to same as swapThreshold if default
      removeCloneOnHide: true,
      direction: function direction() {
        return _detectDirection(el, this.options);
      },
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",
      ignore: "a, img",
      filter: null,
      preventOnFilter: true,
      animation: 0,
      easing: null,
      setData: function setData(dataTransfer, dragEl2) {
        dataTransfer.setData("Text", dragEl2.textContent);
      },
      dropBubble: false,
      dragoverBubble: false,
      dataIdAttr: "data-id",
      delay: 0,
      delayOnTouchOnly: false,
      touchStartThreshold: (Number.parseInt ? Number : window).parseInt(window.devicePixelRatio, 10) || 1,
      forceFallback: false,
      fallbackClass: "sortable-fallback",
      fallbackOnBody: false,
      fallbackTolerance: 0,
      fallbackOffset: {
        x: 0,
        y: 0
      },
      // Disabled on Safari: #1571; Enabled on Safari IOS: #2244
      supportPointer: Sortable.supportPointer !== false && "PointerEvent" in window && (!Safari || IOS),
      emptyInsertThreshold: 5
    };
    PluginManager.initializePlugins(this, el, defaults2);
    for (var name in defaults2) {
      !(name in options) && (options[name] = defaults2[name]);
    }
    _prepareGroup(options);
    for (var fn in this) {
      if (fn.charAt(0) === "_" && typeof this[fn] === "function") {
        this[fn] = this[fn].bind(this);
      }
    }
    this.nativeDraggable = options.forceFallback ? false : supportDraggable;
    if (this.nativeDraggable) {
      this.options.touchStartThreshold = 1;
    }
    if (options.supportPointer) {
      on(el, "pointerdown", this._onTapStart);
    } else {
      on(el, "mousedown", this._onTapStart);
      on(el, "touchstart", this._onTapStart);
    }
    if (this.nativeDraggable) {
      on(el, "dragover", this);
      on(el, "dragenter", this);
    }
    sortables.push(this.el);
    options.store && options.store.get && this.sort(options.store.get(this) || []);
    _extends(this, AnimationStateManager());
  }
  Sortable.prototype = /** @lends Sortable.prototype */
  {
    constructor: Sortable,
    _isOutsideThisEl: function _isOutsideThisEl(target) {
      if (!this.el.contains(target) && target !== this.el) {
        lastTarget = null;
      }
    },
    _getDirection: function _getDirection(evt, target) {
      return typeof this.options.direction === "function" ? this.options.direction.call(this, evt, target, dragEl) : this.options.direction;
    },
    _onTapStart: function _onTapStart(evt) {
      if (!evt.cancelable) return;
      var _this = this, el = this.el, options = this.options, preventOnFilter = options.preventOnFilter, type = evt.type, touch = evt.touches && evt.touches[0] || evt.pointerType && evt.pointerType === "touch" && evt, target = (touch || evt).target, originalTarget = evt.target.shadowRoot && (evt.path && evt.path[0] || evt.composedPath && evt.composedPath()[0]) || target, filter = options.filter;
      _saveInputCheckedState(el);
      if (dragEl) {
        return;
      }
      if (/mousedown|pointerdown/.test(type) && evt.button !== 0 || options.disabled) {
        return;
      }
      if (originalTarget.isContentEditable) {
        return;
      }
      if (!this.nativeDraggable && Safari && target && target.tagName.toUpperCase() === "SELECT") {
        return;
      }
      target = closest(target, options.draggable, el, false);
      if (target && target.animated) {
        return;
      }
      if (lastDownEl === target) {
        return;
      }
      oldIndex = index(target);
      oldDraggableIndex = index(target, options.draggable);
      if (typeof filter === "function") {
        if (filter.call(this, evt, target, this)) {
          _dispatchEvent({
            sortable: _this,
            rootEl: originalTarget,
            name: "filter",
            targetEl: target,
            toEl: el,
            fromEl: el
          });
          pluginEvent2("filter", _this, {
            evt
          });
          preventOnFilter && evt.preventDefault();
          return;
        }
      } else if (filter) {
        filter = filter.split(",").some(function(criteria) {
          criteria = closest(originalTarget, criteria.trim(), el, false);
          if (criteria) {
            _dispatchEvent({
              sortable: _this,
              rootEl: criteria,
              name: "filter",
              targetEl: target,
              fromEl: el,
              toEl: el
            });
            pluginEvent2("filter", _this, {
              evt
            });
            return true;
          }
        });
        if (filter) {
          preventOnFilter && evt.preventDefault();
          return;
        }
      }
      if (options.handle && !closest(originalTarget, options.handle, el, false)) {
        return;
      }
      this._prepareDragStart(evt, touch, target);
    },
    _prepareDragStart: function _prepareDragStart(evt, touch, target) {
      var _this = this, el = _this.el, options = _this.options, ownerDocument = el.ownerDocument, dragStartFn;
      if (target && !dragEl && target.parentNode === el) {
        var dragRect = getRect(target);
        rootEl = el;
        dragEl = target;
        parentEl = dragEl.parentNode;
        nextEl = dragEl.nextSibling;
        lastDownEl = target;
        activeGroup = options.group;
        Sortable.dragged = dragEl;
        tapEvt = {
          target: dragEl,
          clientX: (touch || evt).clientX,
          clientY: (touch || evt).clientY
        };
        tapDistanceLeft = tapEvt.clientX - dragRect.left;
        tapDistanceTop = tapEvt.clientY - dragRect.top;
        this._lastX = (touch || evt).clientX;
        this._lastY = (touch || evt).clientY;
        dragEl.style["will-change"] = "all";
        dragStartFn = function dragStartFn2() {
          pluginEvent2("delayEnded", _this, {
            evt
          });
          if (Sortable.eventCanceled) {
            _this._onDrop();
            return;
          }
          _this._disableDelayedDragEvents();
          if (!FireFox && _this.nativeDraggable) {
            dragEl.draggable = true;
          }
          _this._triggerDragStart(evt, touch);
          _dispatchEvent({
            sortable: _this,
            name: "choose",
            originalEvent: evt
          });
          toggleClass(dragEl, options.chosenClass, true);
        };
        options.ignore.split(",").forEach(function(criteria) {
          find(dragEl, criteria.trim(), _disableDraggable);
        });
        on(ownerDocument, "dragover", nearestEmptyInsertDetectEvent);
        on(ownerDocument, "mousemove", nearestEmptyInsertDetectEvent);
        on(ownerDocument, "touchmove", nearestEmptyInsertDetectEvent);
        if (options.supportPointer) {
          on(ownerDocument, "pointerup", _this._onDrop);
          !this.nativeDraggable && on(ownerDocument, "pointercancel", _this._onDrop);
        } else {
          on(ownerDocument, "mouseup", _this._onDrop);
          on(ownerDocument, "touchend", _this._onDrop);
          on(ownerDocument, "touchcancel", _this._onDrop);
        }
        if (FireFox && this.nativeDraggable) {
          this.options.touchStartThreshold = 4;
          dragEl.draggable = true;
        }
        pluginEvent2("delayStart", this, {
          evt
        });
        if (options.delay && (!options.delayOnTouchOnly || touch) && (!this.nativeDraggable || !(Edge || IE11OrLess))) {
          if (Sortable.eventCanceled) {
            this._onDrop();
            return;
          }
          if (options.supportPointer) {
            on(ownerDocument, "pointerup", _this._disableDelayedDrag);
            on(ownerDocument, "pointercancel", _this._disableDelayedDrag);
          } else {
            on(ownerDocument, "mouseup", _this._disableDelayedDrag);
            on(ownerDocument, "touchend", _this._disableDelayedDrag);
            on(ownerDocument, "touchcancel", _this._disableDelayedDrag);
          }
          on(ownerDocument, "mousemove", _this._delayedDragTouchMoveHandler);
          on(ownerDocument, "touchmove", _this._delayedDragTouchMoveHandler);
          options.supportPointer && on(ownerDocument, "pointermove", _this._delayedDragTouchMoveHandler);
          _this._dragStartTimer = setTimeout(dragStartFn, options.delay);
        } else {
          dragStartFn();
        }
      }
    },
    _delayedDragTouchMoveHandler: function _delayedDragTouchMoveHandler(e) {
      var touch = e.touches ? e.touches[0] : e;
      if (Math.max(Math.abs(touch.clientX - this._lastX), Math.abs(touch.clientY - this._lastY)) >= Math.floor(this.options.touchStartThreshold / (this.nativeDraggable && window.devicePixelRatio || 1))) {
        this._disableDelayedDrag();
      }
    },
    _disableDelayedDrag: function _disableDelayedDrag() {
      dragEl && _disableDraggable(dragEl);
      clearTimeout(this._dragStartTimer);
      this._disableDelayedDragEvents();
    },
    _disableDelayedDragEvents: function _disableDelayedDragEvents() {
      var ownerDocument = this.el.ownerDocument;
      off(ownerDocument, "mouseup", this._disableDelayedDrag);
      off(ownerDocument, "touchend", this._disableDelayedDrag);
      off(ownerDocument, "touchcancel", this._disableDelayedDrag);
      off(ownerDocument, "pointerup", this._disableDelayedDrag);
      off(ownerDocument, "pointercancel", this._disableDelayedDrag);
      off(ownerDocument, "mousemove", this._delayedDragTouchMoveHandler);
      off(ownerDocument, "touchmove", this._delayedDragTouchMoveHandler);
      off(ownerDocument, "pointermove", this._delayedDragTouchMoveHandler);
    },
    _triggerDragStart: function _triggerDragStart(evt, touch) {
      touch = touch || evt.pointerType == "touch" && evt;
      if (!this.nativeDraggable || touch) {
        if (this.options.supportPointer) {
          on(document, "pointermove", this._onTouchMove);
        } else if (touch) {
          on(document, "touchmove", this._onTouchMove);
        } else {
          on(document, "mousemove", this._onTouchMove);
        }
      } else {
        on(dragEl, "dragend", this);
        on(rootEl, "dragstart", this._onDragStart);
      }
      try {
        if (document.selection) {
          _nextTick(function() {
            document.selection.empty();
          });
        } else {
          window.getSelection().removeAllRanges();
        }
      } catch (err) {
      }
    },
    _dragStarted: function _dragStarted(fallback, evt) {
      awaitingDragStarted = false;
      if (rootEl && dragEl) {
        pluginEvent2("dragStarted", this, {
          evt
        });
        if (this.nativeDraggable) {
          on(document, "dragover", _checkOutsideTargetEl);
        }
        var options = this.options;
        !fallback && toggleClass(dragEl, options.dragClass, false);
        toggleClass(dragEl, options.ghostClass, true);
        Sortable.active = this;
        fallback && this._appendGhost();
        _dispatchEvent({
          sortable: this,
          name: "start",
          originalEvent: evt
        });
      } else {
        this._nulling();
      }
    },
    _emulateDragOver: function _emulateDragOver() {
      if (touchEvt) {
        this._lastX = touchEvt.clientX;
        this._lastY = touchEvt.clientY;
        _hideGhostForTarget();
        var target = document.elementFromPoint(touchEvt.clientX, touchEvt.clientY);
        var parent = target;
        while (target && target.shadowRoot) {
          target = target.shadowRoot.elementFromPoint(touchEvt.clientX, touchEvt.clientY);
          if (target === parent) break;
          parent = target;
        }
        dragEl.parentNode[expando]._isOutsideThisEl(target);
        if (parent) {
          do {
            if (parent[expando]) {
              var inserted = void 0;
              inserted = parent[expando]._onDragOver({
                clientX: touchEvt.clientX,
                clientY: touchEvt.clientY,
                target,
                rootEl: parent
              });
              if (inserted && !this.options.dragoverBubble) {
                break;
              }
            }
            target = parent;
          } while (parent = getParentOrHost(parent));
        }
        _unhideGhostForTarget();
      }
    },
    _onTouchMove: function _onTouchMove(evt) {
      if (tapEvt) {
        var options = this.options, fallbackTolerance = options.fallbackTolerance, fallbackOffset = options.fallbackOffset, touch = evt.touches ? evt.touches[0] : evt, ghostMatrix = ghostEl && matrix(ghostEl, true), scaleX = ghostEl && ghostMatrix && ghostMatrix.a, scaleY = ghostEl && ghostMatrix && ghostMatrix.d, relativeScrollOffset = PositionGhostAbsolutely && ghostRelativeParent && getRelativeScrollOffset(ghostRelativeParent), dx = (touch.clientX - tapEvt.clientX + fallbackOffset.x) / (scaleX || 1) + (relativeScrollOffset ? relativeScrollOffset[0] - ghostRelativeParentInitialScroll[0] : 0) / (scaleX || 1), dy = (touch.clientY - tapEvt.clientY + fallbackOffset.y) / (scaleY || 1) + (relativeScrollOffset ? relativeScrollOffset[1] - ghostRelativeParentInitialScroll[1] : 0) / (scaleY || 1);
        if (!Sortable.active && !awaitingDragStarted) {
          if (fallbackTolerance && Math.max(Math.abs(touch.clientX - this._lastX), Math.abs(touch.clientY - this._lastY)) < fallbackTolerance) {
            return;
          }
          this._onDragStart(evt, true);
        }
        if (ghostEl) {
          if (ghostMatrix) {
            ghostMatrix.e += dx - (lastDx || 0);
            ghostMatrix.f += dy - (lastDy || 0);
          } else {
            ghostMatrix = {
              a: 1,
              b: 0,
              c: 0,
              d: 1,
              e: dx,
              f: dy
            };
          }
          var cssMatrix = "matrix(".concat(ghostMatrix.a, ",").concat(ghostMatrix.b, ",").concat(ghostMatrix.c, ",").concat(ghostMatrix.d, ",").concat(ghostMatrix.e, ",").concat(ghostMatrix.f, ")");
          css(ghostEl, "webkitTransform", cssMatrix);
          css(ghostEl, "mozTransform", cssMatrix);
          css(ghostEl, "msTransform", cssMatrix);
          css(ghostEl, "transform", cssMatrix);
          lastDx = dx;
          lastDy = dy;
          touchEvt = touch;
        }
        evt.cancelable && evt.preventDefault();
      }
    },
    _appendGhost: function _appendGhost() {
      if (!ghostEl) {
        var container = this.options.fallbackOnBody ? document.body : rootEl, rect = getRect(dragEl, true, PositionGhostAbsolutely, true, container), options = this.options;
        if (PositionGhostAbsolutely) {
          ghostRelativeParent = container;
          while (css(ghostRelativeParent, "position") === "static" && css(ghostRelativeParent, "transform") === "none" && ghostRelativeParent !== document) {
            ghostRelativeParent = ghostRelativeParent.parentNode;
          }
          if (ghostRelativeParent !== document.body && ghostRelativeParent !== document.documentElement) {
            if (ghostRelativeParent === document) ghostRelativeParent = getWindowScrollingElement();
            rect.top += ghostRelativeParent.scrollTop;
            rect.left += ghostRelativeParent.scrollLeft;
          } else {
            ghostRelativeParent = getWindowScrollingElement();
          }
          ghostRelativeParentInitialScroll = getRelativeScrollOffset(ghostRelativeParent);
        }
        ghostEl = dragEl.cloneNode(true);
        toggleClass(ghostEl, options.ghostClass, false);
        toggleClass(ghostEl, options.fallbackClass, true);
        toggleClass(ghostEl, options.dragClass, true);
        css(ghostEl, "transition", "");
        css(ghostEl, "transform", "");
        css(ghostEl, "box-sizing", "border-box");
        css(ghostEl, "margin", 0);
        css(ghostEl, "top", rect.top);
        css(ghostEl, "left", rect.left);
        css(ghostEl, "width", rect.width);
        css(ghostEl, "height", rect.height);
        css(ghostEl, "opacity", "0.8");
        css(ghostEl, "position", PositionGhostAbsolutely ? "absolute" : "fixed");
        css(ghostEl, "zIndex", "100000");
        css(ghostEl, "pointerEvents", "none");
        Sortable.ghost = ghostEl;
        container.appendChild(ghostEl);
        css(ghostEl, "transform-origin", tapDistanceLeft / parseInt(ghostEl.style.width) * 100 + "% " + tapDistanceTop / parseInt(ghostEl.style.height) * 100 + "%");
      }
    },
    _onDragStart: function _onDragStart(evt, fallback) {
      var _this = this;
      var dataTransfer = evt.dataTransfer;
      var options = _this.options;
      pluginEvent2("dragStart", this, {
        evt
      });
      if (Sortable.eventCanceled) {
        this._onDrop();
        return;
      }
      pluginEvent2("setupClone", this);
      if (!Sortable.eventCanceled) {
        cloneEl = clone(dragEl);
        cloneEl.removeAttribute("id");
        cloneEl.draggable = false;
        cloneEl.style["will-change"] = "";
        this._hideClone();
        toggleClass(cloneEl, this.options.chosenClass, false);
        Sortable.clone = cloneEl;
      }
      _this.cloneId = _nextTick(function() {
        pluginEvent2("clone", _this);
        if (Sortable.eventCanceled) return;
        if (!_this.options.removeCloneOnHide) {
          rootEl.insertBefore(cloneEl, dragEl);
        }
        _this._hideClone();
        _dispatchEvent({
          sortable: _this,
          name: "clone"
        });
      });
      !fallback && toggleClass(dragEl, options.dragClass, true);
      if (fallback) {
        ignoreNextClick = true;
        _this._loopId = setInterval(_this._emulateDragOver, 50);
      } else {
        off(document, "mouseup", _this._onDrop);
        off(document, "touchend", _this._onDrop);
        off(document, "touchcancel", _this._onDrop);
        if (dataTransfer) {
          dataTransfer.effectAllowed = "move";
          options.setData && options.setData.call(_this, dataTransfer, dragEl);
        }
        on(document, "drop", _this);
        css(dragEl, "transform", "translateZ(0)");
      }
      awaitingDragStarted = true;
      _this._dragStartId = _nextTick(_this._dragStarted.bind(_this, fallback, evt));
      on(document, "selectstart", _this);
      moved = true;
      window.getSelection().removeAllRanges();
      if (Safari) {
        css(document.body, "user-select", "none");
      }
    },
    // Returns true - if no further action is needed (either inserted or another condition)
    _onDragOver: function _onDragOver(evt) {
      var el = this.el, target = evt.target, dragRect, targetRect, revert, options = this.options, group = options.group, activeSortable = Sortable.active, isOwner = activeGroup === group, canSort = options.sort, fromSortable = putSortable || activeSortable, vertical, _this = this, completedFired = false;
      if (_silent) return;
      function dragOverEvent(name, extra) {
        pluginEvent2(name, _this, _objectSpread2({
          evt,
          isOwner,
          axis: vertical ? "vertical" : "horizontal",
          revert,
          dragRect,
          targetRect,
          canSort,
          fromSortable,
          target,
          completed,
          onMove: function onMove(target2, after2) {
            return _onMove(rootEl, el, dragEl, dragRect, target2, getRect(target2), evt, after2);
          },
          changed
        }, extra));
      }
      function capture() {
        dragOverEvent("dragOverAnimationCapture");
        _this.captureAnimationState();
        if (_this !== fromSortable) {
          fromSortable.captureAnimationState();
        }
      }
      function completed(insertion) {
        dragOverEvent("dragOverCompleted", {
          insertion
        });
        if (insertion) {
          if (isOwner) {
            activeSortable._hideClone();
          } else {
            activeSortable._showClone(_this);
          }
          if (_this !== fromSortable) {
            toggleClass(dragEl, putSortable ? putSortable.options.ghostClass : activeSortable.options.ghostClass, false);
            toggleClass(dragEl, options.ghostClass, true);
          }
          if (putSortable !== _this && _this !== Sortable.active) {
            putSortable = _this;
          } else if (_this === Sortable.active && putSortable) {
            putSortable = null;
          }
          if (fromSortable === _this) {
            _this._ignoreWhileAnimating = target;
          }
          _this.animateAll(function() {
            dragOverEvent("dragOverAnimationComplete");
            _this._ignoreWhileAnimating = null;
          });
          if (_this !== fromSortable) {
            fromSortable.animateAll();
            fromSortable._ignoreWhileAnimating = null;
          }
        }
        if (target === dragEl && !dragEl.animated || target === el && !target.animated) {
          lastTarget = null;
        }
        if (!options.dragoverBubble && !evt.rootEl && target !== document) {
          dragEl.parentNode[expando]._isOutsideThisEl(evt.target);
          !insertion && nearestEmptyInsertDetectEvent(evt);
        }
        !options.dragoverBubble && evt.stopPropagation && evt.stopPropagation();
        return completedFired = true;
      }
      function changed() {
        newIndex = index(dragEl);
        newDraggableIndex = index(dragEl, options.draggable);
        _dispatchEvent({
          sortable: _this,
          name: "change",
          toEl: el,
          newIndex,
          newDraggableIndex,
          originalEvent: evt
        });
      }
      if (evt.preventDefault !== void 0) {
        evt.cancelable && evt.preventDefault();
      }
      target = closest(target, options.draggable, el, true);
      dragOverEvent("dragOver");
      if (Sortable.eventCanceled) return completedFired;
      if (dragEl.contains(evt.target) || target.animated && target.animatingX && target.animatingY || _this._ignoreWhileAnimating === target) {
        return completed(false);
      }
      ignoreNextClick = false;
      if (activeSortable && !options.disabled && (isOwner ? canSort || (revert = parentEl !== rootEl) : putSortable === this || (this.lastPutMode = activeGroup.checkPull(this, activeSortable, dragEl, evt)) && group.checkPut(this, activeSortable, dragEl, evt))) {
        vertical = this._getDirection(evt, target) === "vertical";
        dragRect = getRect(dragEl);
        dragOverEvent("dragOverValid");
        if (Sortable.eventCanceled) return completedFired;
        if (revert) {
          parentEl = rootEl;
          capture();
          this._hideClone();
          dragOverEvent("revert");
          if (!Sortable.eventCanceled) {
            if (nextEl) {
              rootEl.insertBefore(dragEl, nextEl);
            } else {
              rootEl.appendChild(dragEl);
            }
          }
          return completed(true);
        }
        var elLastChild = lastChild(el, options.draggable);
        if (!elLastChild || _ghostIsLast(evt, vertical, this) && !elLastChild.animated) {
          if (elLastChild === dragEl) {
            return completed(false);
          }
          if (elLastChild && el === evt.target) {
            target = elLastChild;
          }
          if (target) {
            targetRect = getRect(target);
          }
          if (_onMove(rootEl, el, dragEl, dragRect, target, targetRect, evt, !!target) !== false) {
            capture();
            if (elLastChild && elLastChild.nextSibling) {
              el.insertBefore(dragEl, elLastChild.nextSibling);
            } else {
              el.appendChild(dragEl);
            }
            parentEl = el;
            changed();
            return completed(true);
          }
        } else if (elLastChild && _ghostIsFirst(evt, vertical, this)) {
          var firstChild = getChild(el, 0, options, true);
          if (firstChild === dragEl) {
            return completed(false);
          }
          target = firstChild;
          targetRect = getRect(target);
          if (_onMove(rootEl, el, dragEl, dragRect, target, targetRect, evt, false) !== false) {
            capture();
            el.insertBefore(dragEl, firstChild);
            parentEl = el;
            changed();
            return completed(true);
          }
        } else if (target.parentNode === el) {
          targetRect = getRect(target);
          var direction = 0, targetBeforeFirstSwap, differentLevel = dragEl.parentNode !== el, differentRowCol = !_dragElInRowColumn(dragEl.animated && dragEl.toRect || dragRect, target.animated && target.toRect || targetRect, vertical), side1 = vertical ? "top" : "left", scrolledPastTop = isScrolledPast(target, "top", "top") || isScrolledPast(dragEl, "top", "top"), scrollBefore = scrolledPastTop ? scrolledPastTop.scrollTop : void 0;
          if (lastTarget !== target) {
            targetBeforeFirstSwap = targetRect[side1];
            pastFirstInvertThresh = false;
            isCircumstantialInvert = !differentRowCol && options.invertSwap || differentLevel;
          }
          direction = _getSwapDirection(evt, target, targetRect, vertical, differentRowCol ? 1 : options.swapThreshold, options.invertedSwapThreshold == null ? options.swapThreshold : options.invertedSwapThreshold, isCircumstantialInvert, lastTarget === target);
          var sibling;
          if (direction !== 0) {
            var dragIndex = index(dragEl);
            do {
              dragIndex -= direction;
              sibling = parentEl.children[dragIndex];
            } while (sibling && (css(sibling, "display") === "none" || sibling === ghostEl));
          }
          if (direction === 0 || sibling === target) {
            return completed(false);
          }
          lastTarget = target;
          lastDirection = direction;
          var nextSibling = target.nextElementSibling, after = false;
          after = direction === 1;
          var moveVector = _onMove(rootEl, el, dragEl, dragRect, target, targetRect, evt, after);
          if (moveVector !== false) {
            if (moveVector === 1 || moveVector === -1) {
              after = moveVector === 1;
            }
            _silent = true;
            setTimeout(_unsilent, 30);
            capture();
            if (after && !nextSibling) {
              el.appendChild(dragEl);
            } else {
              target.parentNode.insertBefore(dragEl, after ? nextSibling : target);
            }
            if (scrolledPastTop) {
              scrollBy(scrolledPastTop, 0, scrollBefore - scrolledPastTop.scrollTop);
            }
            parentEl = dragEl.parentNode;
            if (targetBeforeFirstSwap !== void 0 && !isCircumstantialInvert) {
              targetMoveDistance = Math.abs(targetBeforeFirstSwap - getRect(target)[side1]);
            }
            changed();
            return completed(true);
          }
        }
        if (el.contains(dragEl)) {
          return completed(false);
        }
      }
      return false;
    },
    _ignoreWhileAnimating: null,
    _offMoveEvents: function _offMoveEvents() {
      off(document, "mousemove", this._onTouchMove);
      off(document, "touchmove", this._onTouchMove);
      off(document, "pointermove", this._onTouchMove);
      off(document, "dragover", nearestEmptyInsertDetectEvent);
      off(document, "mousemove", nearestEmptyInsertDetectEvent);
      off(document, "touchmove", nearestEmptyInsertDetectEvent);
    },
    _offUpEvents: function _offUpEvents() {
      var ownerDocument = this.el.ownerDocument;
      off(ownerDocument, "mouseup", this._onDrop);
      off(ownerDocument, "touchend", this._onDrop);
      off(ownerDocument, "pointerup", this._onDrop);
      off(ownerDocument, "pointercancel", this._onDrop);
      off(ownerDocument, "touchcancel", this._onDrop);
      off(document, "selectstart", this);
    },
    _onDrop: function _onDrop(evt) {
      var el = this.el, options = this.options;
      newIndex = index(dragEl);
      newDraggableIndex = index(dragEl, options.draggable);
      pluginEvent2("drop", this, {
        evt
      });
      parentEl = dragEl && dragEl.parentNode;
      newIndex = index(dragEl);
      newDraggableIndex = index(dragEl, options.draggable);
      if (Sortable.eventCanceled) {
        this._nulling();
        return;
      }
      awaitingDragStarted = false;
      isCircumstantialInvert = false;
      pastFirstInvertThresh = false;
      clearInterval(this._loopId);
      clearTimeout(this._dragStartTimer);
      _cancelNextTick(this.cloneId);
      _cancelNextTick(this._dragStartId);
      if (this.nativeDraggable) {
        off(document, "drop", this);
        off(el, "dragstart", this._onDragStart);
      }
      this._offMoveEvents();
      this._offUpEvents();
      if (Safari) {
        css(document.body, "user-select", "");
      }
      css(dragEl, "transform", "");
      if (evt) {
        if (moved) {
          evt.cancelable && evt.preventDefault();
          !options.dropBubble && evt.stopPropagation();
        }
        ghostEl && ghostEl.parentNode && ghostEl.parentNode.removeChild(ghostEl);
        if (rootEl === parentEl || putSortable && putSortable.lastPutMode !== "clone") {
          cloneEl && cloneEl.parentNode && cloneEl.parentNode.removeChild(cloneEl);
        }
        if (dragEl) {
          if (this.nativeDraggable) {
            off(dragEl, "dragend", this);
          }
          _disableDraggable(dragEl);
          dragEl.style["will-change"] = "";
          if (moved && !awaitingDragStarted) {
            toggleClass(dragEl, putSortable ? putSortable.options.ghostClass : this.options.ghostClass, false);
          }
          toggleClass(dragEl, this.options.chosenClass, false);
          _dispatchEvent({
            sortable: this,
            name: "unchoose",
            toEl: parentEl,
            newIndex: null,
            newDraggableIndex: null,
            originalEvent: evt
          });
          if (rootEl !== parentEl) {
            if (newIndex >= 0) {
              _dispatchEvent({
                rootEl: parentEl,
                name: "add",
                toEl: parentEl,
                fromEl: rootEl,
                originalEvent: evt
              });
              _dispatchEvent({
                sortable: this,
                name: "remove",
                toEl: parentEl,
                originalEvent: evt
              });
              _dispatchEvent({
                rootEl: parentEl,
                name: "sort",
                toEl: parentEl,
                fromEl: rootEl,
                originalEvent: evt
              });
              _dispatchEvent({
                sortable: this,
                name: "sort",
                toEl: parentEl,
                originalEvent: evt
              });
            }
            putSortable && putSortable.save();
          } else {
            if (newIndex !== oldIndex) {
              if (newIndex >= 0) {
                _dispatchEvent({
                  sortable: this,
                  name: "update",
                  toEl: parentEl,
                  originalEvent: evt
                });
                _dispatchEvent({
                  sortable: this,
                  name: "sort",
                  toEl: parentEl,
                  originalEvent: evt
                });
              }
            }
          }
          if (Sortable.active) {
            if (newIndex == null || newIndex === -1) {
              newIndex = oldIndex;
              newDraggableIndex = oldDraggableIndex;
            }
            _dispatchEvent({
              sortable: this,
              name: "end",
              toEl: parentEl,
              originalEvent: evt
            });
            this.save();
          }
        }
      }
      this._nulling();
    },
    _nulling: function _nulling() {
      pluginEvent2("nulling", this);
      rootEl = dragEl = parentEl = ghostEl = nextEl = cloneEl = lastDownEl = cloneHidden = tapEvt = touchEvt = moved = newIndex = newDraggableIndex = oldIndex = oldDraggableIndex = lastTarget = lastDirection = putSortable = activeGroup = Sortable.dragged = Sortable.ghost = Sortable.clone = Sortable.active = null;
      var el = this.el;
      savedInputChecked.forEach(function(checkEl) {
        if (el.contains(checkEl)) {
          checkEl.checked = true;
        }
      });
      savedInputChecked.length = lastDx = lastDy = 0;
    },
    handleEvent: function handleEvent(evt) {
      switch (evt.type) {
        case "drop":
        case "dragend":
          this._onDrop(evt);
          break;
        case "dragenter":
        case "dragover":
          if (dragEl) {
            this._onDragOver(evt);
            _globalDragOver(evt);
          }
          break;
        case "selectstart":
          evt.preventDefault();
          break;
      }
    },
    /**
     * Serializes the item into an array of string.
     * @returns {String[]}
     */
    toArray: function toArray() {
      var order = [], el, children = this.el.children, i = 0, n = children.length, options = this.options;
      for (; i < n; i++) {
        el = children[i];
        if (closest(el, options.draggable, this.el, false)) {
          order.push(el.getAttribute(options.dataIdAttr) || _generateId(el));
        }
      }
      return order;
    },
    /**
     * Sorts the elements according to the array.
     * @param  {String[]}  order  order of the items
     */
    sort: function sort(order, useAnimation) {
      var items = {}, rootEl2 = this.el;
      this.toArray().forEach(function(id, i) {
        var el = rootEl2.children[i];
        if (closest(el, this.options.draggable, rootEl2, false)) {
          items[id] = el;
        }
      }, this);
      useAnimation && this.captureAnimationState();
      order.forEach(function(id) {
        if (items[id]) {
          rootEl2.removeChild(items[id]);
          rootEl2.appendChild(items[id]);
        }
      });
      useAnimation && this.animateAll();
    },
    /**
     * Save the current sorting
     */
    save: function save() {
      var store = this.options.store;
      store && store.set && store.set(this);
    },
    /**
     * For each element in the set, get the first element that matches the selector by testing the element itself and traversing up through its ancestors in the DOM tree.
     * @param   {HTMLElement}  el
     * @param   {String}       [selector]  default: `options.draggable`
     * @returns {HTMLElement|null}
     */
    closest: function closest$1(el, selector) {
      return closest(el, selector || this.options.draggable, this.el, false);
    },
    /**
     * Set/get option
     * @param   {string} name
     * @param   {*}      [value]
     * @returns {*}
     */
    option: function option(name, value) {
      var options = this.options;
      if (value === void 0) {
        return options[name];
      } else {
        var modifiedValue = PluginManager.modifyOption(this, name, value);
        if (typeof modifiedValue !== "undefined") {
          options[name] = modifiedValue;
        } else {
          options[name] = value;
        }
        if (name === "group") {
          _prepareGroup(options);
        }
      }
    },
    /**
     * Destroy
     */
    destroy: function destroy() {
      pluginEvent2("destroy", this);
      var el = this.el;
      el[expando] = null;
      off(el, "mousedown", this._onTapStart);
      off(el, "touchstart", this._onTapStart);
      off(el, "pointerdown", this._onTapStart);
      if (this.nativeDraggable) {
        off(el, "dragover", this);
        off(el, "dragenter", this);
      }
      Array.prototype.forEach.call(el.querySelectorAll("[draggable]"), function(el2) {
        el2.removeAttribute("draggable");
      });
      this._onDrop();
      this._disableDelayedDragEvents();
      sortables.splice(sortables.indexOf(this.el), 1);
      this.el = el = null;
    },
    _hideClone: function _hideClone() {
      if (!cloneHidden) {
        pluginEvent2("hideClone", this);
        if (Sortable.eventCanceled) return;
        css(cloneEl, "display", "none");
        if (this.options.removeCloneOnHide && cloneEl.parentNode) {
          cloneEl.parentNode.removeChild(cloneEl);
        }
        cloneHidden = true;
      }
    },
    _showClone: function _showClone(putSortable2) {
      if (putSortable2.lastPutMode !== "clone") {
        this._hideClone();
        return;
      }
      if (cloneHidden) {
        pluginEvent2("showClone", this);
        if (Sortable.eventCanceled) return;
        if (dragEl.parentNode == rootEl && !this.options.group.revertClone) {
          rootEl.insertBefore(cloneEl, dragEl);
        } else if (nextEl) {
          rootEl.insertBefore(cloneEl, nextEl);
        } else {
          rootEl.appendChild(cloneEl);
        }
        if (this.options.group.revertClone) {
          this.animate(dragEl, cloneEl);
        }
        css(cloneEl, "display", "");
        cloneHidden = false;
      }
    }
  };
  function _globalDragOver(evt) {
    if (evt.dataTransfer) {
      evt.dataTransfer.dropEffect = "move";
    }
    evt.cancelable && evt.preventDefault();
  }
  function _onMove(fromEl, toEl, dragEl2, dragRect, targetEl, targetRect, originalEvent, willInsertAfter) {
    var evt, sortable = fromEl[expando], onMoveFn = sortable.options.onMove, retVal;
    if (window.CustomEvent && !IE11OrLess && !Edge) {
      evt = new CustomEvent("move", {
        bubbles: true,
        cancelable: true
      });
    } else {
      evt = document.createEvent("Event");
      evt.initEvent("move", true, true);
    }
    evt.to = toEl;
    evt.from = fromEl;
    evt.dragged = dragEl2;
    evt.draggedRect = dragRect;
    evt.related = targetEl || toEl;
    evt.relatedRect = targetRect || getRect(toEl);
    evt.willInsertAfter = willInsertAfter;
    evt.originalEvent = originalEvent;
    fromEl.dispatchEvent(evt);
    if (onMoveFn) {
      retVal = onMoveFn.call(sortable, evt, originalEvent);
    }
    return retVal;
  }
  function _disableDraggable(el) {
    el.draggable = false;
  }
  function _unsilent() {
    _silent = false;
  }
  function _ghostIsFirst(evt, vertical, sortable) {
    var firstElRect = getRect(getChild(sortable.el, 0, sortable.options, true));
    var childContainingRect = getChildContainingRectFromElement(sortable.el, sortable.options, ghostEl);
    var spacer = 10;
    return vertical ? evt.clientX < childContainingRect.left - spacer || evt.clientY < firstElRect.top && evt.clientX < firstElRect.right : evt.clientY < childContainingRect.top - spacer || evt.clientY < firstElRect.bottom && evt.clientX < firstElRect.left;
  }
  function _ghostIsLast(evt, vertical, sortable) {
    var lastElRect = getRect(lastChild(sortable.el, sortable.options.draggable));
    var childContainingRect = getChildContainingRectFromElement(sortable.el, sortable.options, ghostEl);
    var spacer = 10;
    return vertical ? evt.clientX > childContainingRect.right + spacer || evt.clientY > lastElRect.bottom && evt.clientX > lastElRect.left : evt.clientY > childContainingRect.bottom + spacer || evt.clientX > lastElRect.right && evt.clientY > lastElRect.top;
  }
  function _getSwapDirection(evt, target, targetRect, vertical, swapThreshold, invertedSwapThreshold, invertSwap, isLastTarget) {
    var mouseOnAxis = vertical ? evt.clientY : evt.clientX, targetLength = vertical ? targetRect.height : targetRect.width, targetS1 = vertical ? targetRect.top : targetRect.left, targetS2 = vertical ? targetRect.bottom : targetRect.right, invert = false;
    if (!invertSwap) {
      if (isLastTarget && targetMoveDistance < targetLength * swapThreshold) {
        if (!pastFirstInvertThresh && (lastDirection === 1 ? mouseOnAxis > targetS1 + targetLength * invertedSwapThreshold / 2 : mouseOnAxis < targetS2 - targetLength * invertedSwapThreshold / 2)) {
          pastFirstInvertThresh = true;
        }
        if (!pastFirstInvertThresh) {
          if (lastDirection === 1 ? mouseOnAxis < targetS1 + targetMoveDistance : mouseOnAxis > targetS2 - targetMoveDistance) {
            return -lastDirection;
          }
        } else {
          invert = true;
        }
      } else {
        if (mouseOnAxis > targetS1 + targetLength * (1 - swapThreshold) / 2 && mouseOnAxis < targetS2 - targetLength * (1 - swapThreshold) / 2) {
          return _getInsertDirection(target);
        }
      }
    }
    invert = invert || invertSwap;
    if (invert) {
      if (mouseOnAxis < targetS1 + targetLength * invertedSwapThreshold / 2 || mouseOnAxis > targetS2 - targetLength * invertedSwapThreshold / 2) {
        return mouseOnAxis > targetS1 + targetLength / 2 ? 1 : -1;
      }
    }
    return 0;
  }
  function _getInsertDirection(target) {
    if (index(dragEl) < index(target)) {
      return 1;
    } else {
      return -1;
    }
  }
  function _generateId(el) {
    var str = el.tagName + el.className + el.src + el.href + el.textContent, i = str.length, sum = 0;
    while (i--) {
      sum += str.charCodeAt(i);
    }
    return sum.toString(36);
  }
  function _saveInputCheckedState(root) {
    savedInputChecked.length = 0;
    var inputs = root.getElementsByTagName("input");
    var idx = inputs.length;
    while (idx--) {
      var el = inputs[idx];
      el.checked && savedInputChecked.push(el);
    }
  }
  function _nextTick(fn) {
    return setTimeout(fn, 0);
  }
  function _cancelNextTick(id) {
    return clearTimeout(id);
  }
  if (documentExists) {
    on(document, "touchmove", function(evt) {
      if ((Sortable.active || awaitingDragStarted) && evt.cancelable) {
        evt.preventDefault();
      }
    });
  }
  Sortable.utils = {
    on,
    off,
    css,
    find,
    is: function is(el, selector) {
      return !!closest(el, selector, el, false);
    },
    extend,
    throttle,
    closest,
    toggleClass,
    clone,
    index,
    nextTick: _nextTick,
    cancelNextTick: _cancelNextTick,
    detectDirection: _detectDirection,
    getChild,
    expando
  };
  Sortable.get = function(element) {
    return element[expando];
  };
  Sortable.mount = function() {
    for (var _len = arguments.length, plugins2 = new Array(_len), _key = 0; _key < _len; _key++) {
      plugins2[_key] = arguments[_key];
    }
    if (plugins2[0].constructor === Array) plugins2 = plugins2[0];
    plugins2.forEach(function(plugin) {
      if (!plugin.prototype || !plugin.prototype.constructor) {
        throw "Sortable: Mounted plugin must be a constructor function, not ".concat({}.toString.call(plugin));
      }
      if (plugin.utils) Sortable.utils = _objectSpread2(_objectSpread2({}, Sortable.utils), plugin.utils);
      PluginManager.mount(plugin);
    });
  };
  Sortable.create = function(el, options) {
    return new Sortable(el, options);
  };
  Sortable.version = version;
  var autoScrolls = [];
  var scrollEl;
  var scrollRootEl;
  var scrolling = false;
  var lastAutoScrollX;
  var lastAutoScrollY;
  var touchEvt$1;
  var pointerElemChangedInterval;
  function AutoScrollPlugin() {
    function AutoScroll() {
      this.defaults = {
        scroll: true,
        forceAutoScrollFallback: false,
        scrollSensitivity: 30,
        scrollSpeed: 10,
        bubbleScroll: true
      };
      for (var fn in this) {
        if (fn.charAt(0) === "_" && typeof this[fn] === "function") {
          this[fn] = this[fn].bind(this);
        }
      }
    }
    AutoScroll.prototype = {
      dragStarted: function dragStarted(_ref) {
        var originalEvent = _ref.originalEvent;
        if (this.sortable.nativeDraggable) {
          on(document, "dragover", this._handleAutoScroll);
        } else {
          if (this.options.supportPointer) {
            on(document, "pointermove", this._handleFallbackAutoScroll);
          } else if (originalEvent.touches) {
            on(document, "touchmove", this._handleFallbackAutoScroll);
          } else {
            on(document, "mousemove", this._handleFallbackAutoScroll);
          }
        }
      },
      dragOverCompleted: function dragOverCompleted(_ref2) {
        var originalEvent = _ref2.originalEvent;
        if (!this.options.dragOverBubble && !originalEvent.rootEl) {
          this._handleAutoScroll(originalEvent);
        }
      },
      drop: function drop3() {
        if (this.sortable.nativeDraggable) {
          off(document, "dragover", this._handleAutoScroll);
        } else {
          off(document, "pointermove", this._handleFallbackAutoScroll);
          off(document, "touchmove", this._handleFallbackAutoScroll);
          off(document, "mousemove", this._handleFallbackAutoScroll);
        }
        clearPointerElemChangedInterval();
        clearAutoScrolls();
        cancelThrottle();
      },
      nulling: function nulling() {
        touchEvt$1 = scrollRootEl = scrollEl = scrolling = pointerElemChangedInterval = lastAutoScrollX = lastAutoScrollY = null;
        autoScrolls.length = 0;
      },
      _handleFallbackAutoScroll: function _handleFallbackAutoScroll(evt) {
        this._handleAutoScroll(evt, true);
      },
      _handleAutoScroll: function _handleAutoScroll(evt, fallback) {
        var _this = this;
        var x = (evt.touches ? evt.touches[0] : evt).clientX, y = (evt.touches ? evt.touches[0] : evt).clientY, elem = document.elementFromPoint(x, y);
        touchEvt$1 = evt;
        if (fallback || this.options.forceAutoScrollFallback || Edge || IE11OrLess || Safari) {
          autoScroll(evt, this.options, elem, fallback);
          var ogElemScroller = getParentAutoScrollElement(elem, true);
          if (scrolling && (!pointerElemChangedInterval || x !== lastAutoScrollX || y !== lastAutoScrollY)) {
            pointerElemChangedInterval && clearPointerElemChangedInterval();
            pointerElemChangedInterval = setInterval(function() {
              var newElem = getParentAutoScrollElement(document.elementFromPoint(x, y), true);
              if (newElem !== ogElemScroller) {
                ogElemScroller = newElem;
                clearAutoScrolls();
              }
              autoScroll(evt, _this.options, newElem, fallback);
            }, 10);
            lastAutoScrollX = x;
            lastAutoScrollY = y;
          }
        } else {
          if (!this.options.bubbleScroll || getParentAutoScrollElement(elem, true) === getWindowScrollingElement()) {
            clearAutoScrolls();
            return;
          }
          autoScroll(evt, this.options, getParentAutoScrollElement(elem, false), false);
        }
      }
    };
    return _extends(AutoScroll, {
      pluginName: "scroll",
      initializeByDefault: true
    });
  }
  function clearAutoScrolls() {
    autoScrolls.forEach(function(autoScroll2) {
      clearInterval(autoScroll2.pid);
    });
    autoScrolls = [];
  }
  function clearPointerElemChangedInterval() {
    clearInterval(pointerElemChangedInterval);
  }
  var autoScroll = throttle(function(evt, options, rootEl2, isFallback) {
    if (!options.scroll) return;
    var x = (evt.touches ? evt.touches[0] : evt).clientX, y = (evt.touches ? evt.touches[0] : evt).clientY, sens = options.scrollSensitivity, speed = options.scrollSpeed, winScroller = getWindowScrollingElement();
    var scrollThisInstance = false, scrollCustomFn;
    if (scrollRootEl !== rootEl2) {
      scrollRootEl = rootEl2;
      clearAutoScrolls();
      scrollEl = options.scroll;
      scrollCustomFn = options.scrollFn;
      if (scrollEl === true) {
        scrollEl = getParentAutoScrollElement(rootEl2, true);
      }
    }
    var layersOut = 0;
    var currentParent = scrollEl;
    do {
      var el = currentParent, rect = getRect(el), top = rect.top, bottom = rect.bottom, left = rect.left, right = rect.right, width = rect.width, height = rect.height, canScrollX = void 0, canScrollY = void 0, scrollWidth = el.scrollWidth, scrollHeight = el.scrollHeight, elCSS = css(el), scrollPosX = el.scrollLeft, scrollPosY = el.scrollTop;
      if (el === winScroller) {
        canScrollX = width < scrollWidth && (elCSS.overflowX === "auto" || elCSS.overflowX === "scroll" || elCSS.overflowX === "visible");
        canScrollY = height < scrollHeight && (elCSS.overflowY === "auto" || elCSS.overflowY === "scroll" || elCSS.overflowY === "visible");
      } else {
        canScrollX = width < scrollWidth && (elCSS.overflowX === "auto" || elCSS.overflowX === "scroll");
        canScrollY = height < scrollHeight && (elCSS.overflowY === "auto" || elCSS.overflowY === "scroll");
      }
      var vx = canScrollX && (Math.abs(right - x) <= sens && scrollPosX + width < scrollWidth) - (Math.abs(left - x) <= sens && !!scrollPosX);
      var vy = canScrollY && (Math.abs(bottom - y) <= sens && scrollPosY + height < scrollHeight) - (Math.abs(top - y) <= sens && !!scrollPosY);
      if (!autoScrolls[layersOut]) {
        for (var i = 0; i <= layersOut; i++) {
          if (!autoScrolls[i]) {
            autoScrolls[i] = {};
          }
        }
      }
      if (autoScrolls[layersOut].vx != vx || autoScrolls[layersOut].vy != vy || autoScrolls[layersOut].el !== el) {
        autoScrolls[layersOut].el = el;
        autoScrolls[layersOut].vx = vx;
        autoScrolls[layersOut].vy = vy;
        clearInterval(autoScrolls[layersOut].pid);
        if (vx != 0 || vy != 0) {
          scrollThisInstance = true;
          autoScrolls[layersOut].pid = setInterval(function() {
            if (isFallback && this.layer === 0) {
              Sortable.active._onTouchMove(touchEvt$1);
            }
            var scrollOffsetY = autoScrolls[this.layer].vy ? autoScrolls[this.layer].vy * speed : 0;
            var scrollOffsetX = autoScrolls[this.layer].vx ? autoScrolls[this.layer].vx * speed : 0;
            if (typeof scrollCustomFn === "function") {
              if (scrollCustomFn.call(Sortable.dragged.parentNode[expando], scrollOffsetX, scrollOffsetY, evt, touchEvt$1, autoScrolls[this.layer].el) !== "continue") {
                return;
              }
            }
            scrollBy(autoScrolls[this.layer].el, scrollOffsetX, scrollOffsetY);
          }.bind({
            layer: layersOut
          }), 24);
        }
      }
      layersOut++;
    } while (options.bubbleScroll && currentParent !== winScroller && (currentParent = getParentAutoScrollElement(currentParent, false)));
    scrolling = scrollThisInstance;
  }, 30);
  var drop = function drop2(_ref) {
    var originalEvent = _ref.originalEvent, putSortable2 = _ref.putSortable, dragEl2 = _ref.dragEl, activeSortable = _ref.activeSortable, dispatchSortableEvent = _ref.dispatchSortableEvent, hideGhostForTarget = _ref.hideGhostForTarget, unhideGhostForTarget = _ref.unhideGhostForTarget;
    if (!originalEvent) return;
    var toSortable = putSortable2 || activeSortable;
    hideGhostForTarget();
    var touch = originalEvent.changedTouches && originalEvent.changedTouches.length ? originalEvent.changedTouches[0] : originalEvent;
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    unhideGhostForTarget();
    if (toSortable && !toSortable.el.contains(target)) {
      dispatchSortableEvent("spill");
      this.onSpill({
        dragEl: dragEl2,
        putSortable: putSortable2
      });
    }
  };
  function Revert() {
  }
  Revert.prototype = {
    startIndex: null,
    dragStart: function dragStart(_ref2) {
      var oldDraggableIndex2 = _ref2.oldDraggableIndex;
      this.startIndex = oldDraggableIndex2;
    },
    onSpill: function onSpill(_ref3) {
      var dragEl2 = _ref3.dragEl, putSortable2 = _ref3.putSortable;
      this.sortable.captureAnimationState();
      if (putSortable2) {
        putSortable2.captureAnimationState();
      }
      var nextSibling = getChild(this.sortable.el, this.startIndex, this.options);
      if (nextSibling) {
        this.sortable.el.insertBefore(dragEl2, nextSibling);
      } else {
        this.sortable.el.appendChild(dragEl2);
      }
      this.sortable.animateAll();
      if (putSortable2) {
        putSortable2.animateAll();
      }
    },
    drop
  };
  _extends(Revert, {
    pluginName: "revertOnSpill"
  });
  function Remove() {
  }
  Remove.prototype = {
    onSpill: function onSpill2(_ref4) {
      var dragEl2 = _ref4.dragEl, putSortable2 = _ref4.putSortable;
      var parentSortable = putSortable2 || this.sortable;
      parentSortable.captureAnimationState();
      dragEl2.parentNode && dragEl2.parentNode.removeChild(dragEl2);
      parentSortable.animateAll();
    },
    drop
  };
  _extends(Remove, {
    pluginName: "removeOnSpill"
  });
  Sortable.mount(new AutoScrollPlugin());
  Sortable.mount(Remove, Revert);
  var sortable_esm_default = Sortable;

  // web/js/queues.js
  function renderQueuesList() {
    const tbody = document.getElementById("queues-tbody");
    tbody.innerHTML = "";
    if (!state.queues.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center text-sm text-slate-400">No queues yet.</td></tr>';
      return;
    }
    state.queues.forEach((q) => {
      const jobCount = (q.job_ids || []).length;
      const onFail = q.on_failure === "stop" ? "Stop on first failure" : "Continue on failure";
      const statusCell = queueStatusCell(q);
      const isRunning = q.lastQueueRun && q.lastQueueRun.status === "running";
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td class="px-5 py-4 font-medium">${esc(q.name)}</td>
      <td class="px-5 py-4 text-sm text-slate-500">${jobCount}</td>
      <td class="px-5 py-4 text-sm text-slate-500">${esc(onFail)}</td>
      <td class="px-5 py-4">${statusCell}</td>
      <td class="px-5 py-4 text-right space-x-2">
        <button class="edit-queue-btn text-xs font-medium text-brand-600 hover:underline" data-queue-id="${esc(q.id)}">Edit</button>
        <button class="delete-queue-btn text-xs font-medium text-rose-600 hover:underline ml-3" data-queue-id="${esc(q.id)}">Delete</button>
        <button class="run-queue-btn ml-3 rounded-lg px-3 py-1.5 text-xs font-medium text-white ${isRunning ? "bg-slate-400 cursor-not-allowed" : "bg-brand-600 hover:bg-brand-700"}" data-queue-id="${esc(q.id)}" ${isRunning ? "disabled" : ""}>Run</button>
      </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".edit-queue-btn").forEach(
      (btn) => btn.addEventListener("click", () => {
        populateQueueJobSelect();
        openQueueForm(btn.dataset.queueId);
      })
    );
    tbody.querySelectorAll(".delete-queue-btn").forEach(
      (btn) => btn.addEventListener("click", () => deleteQueue(btn.dataset.queueId))
    );
    tbody.querySelectorAll(".run-queue-btn:not([disabled])").forEach(
      (btn) => btn.addEventListener("click", () => startQueueRun(btn.dataset.queueId))
    );
    tbody.querySelectorAll(".queue-status-btn").forEach(
      (btn) => btn.addEventListener("click", () => openQueueRun(btn.dataset.queueRunId))
    );
  }
  function queueStatusCell(q) {
    if (!q.lastQueueRun) return '<span class="text-slate-400">—</span>';
    const { id, status } = q.lastQueueRun;
    const map = {
      running: ["bg-blue-100 text-blue-700", "⟳ running"],
      success: ["bg-emerald-100 text-emerald-700", "✓ success"],
      failed: ["bg-rose-100 text-rose-700", "✗ failed"],
      canceled: ["bg-slate-100 text-slate-500", "⊘ canceled"]
    };
    const [cls, label] = map[status] || ["bg-slate-100 text-slate-500", status];
    return `<button class="queue-status-btn rounded-full ${cls} px-2.5 py-1 text-xs font-medium" data-queue-run-id="${esc(id)}">${label}</button>`;
  }
  function openQueueForm(queueId) {
    const q = queueId ? state.queues.find((q2) => q2.id === queueId) : null;
    state.editingQueueId = queueId || null;
    document.getElementById("queueform-title").textContent = q ? "Edit queue" : "New queue";
    document.getElementById("qf-name").value = q ? q.name || "" : "";
    document.getElementById("qf-on-failure").checked = q ? q.on_failure !== "stop" : true;
    clearError("queueform-error");
    renderQueueJobList(q ? q.job_ids || [] : []);
    showScreen("queueform");
  }
  var _jobListSortable = null;
  function renderQueueJobList(jobIds) {
    const list = document.getElementById("qf-jobs-list");
    list.innerHTML = "";
    if (_jobListSortable) {
      _jobListSortable.destroy();
      _jobListSortable = null;
    }
    jobIds.forEach((jid, idx) => {
      const job = state.jobs.find((j) => j.id === jid);
      const name = job ? job.name : jid;
      const item = document.createElement("div");
      item.className = "flex items-center gap-2 py-1.5 border-b border-slate-100 cursor-move select-none";
      item.dataset.jobId = jid;
      item.innerHTML = `
      <span class="text-slate-300 text-base leading-none" title="Drag to reorder">⠿</span>
      <span class="flex-1 text-sm">${esc(name)}</span>
      <button type="button" class="qf-remove-btn text-rose-400 hover:text-rose-600 px-1" data-idx="${idx}" title="Remove">×</button>`;
      list.appendChild(item);
    });
    list.querySelectorAll(".qf-remove-btn").forEach(
      (btn) => btn.addEventListener("click", () => removeQueueJob(Number(btn.dataset.idx)))
    );
    _jobListSortable = new sortable_esm_default(list, {
      animation: 150,
      ghostClass: "bg-slate-200",
      chosenClass: "opacity-50"
    });
  }
  function getQueueJobIds() {
    return Array.from(document.getElementById("qf-jobs-list").children).map((el) => el.dataset.jobId);
  }
  function removeQueueJob(idx) {
    const ids = getQueueJobIds();
    ids.splice(idx, 1);
    renderQueueJobList(ids);
  }
  function addQueueJob() {
    const sel = document.getElementById("qf-add-job-select");
    const jid = sel.value;
    if (!jid) return;
    const ids = getQueueJobIds();
    if (!ids.includes(jid)) {
      ids.push(jid);
      renderQueueJobList(ids);
    }
  }
  function populateQueueJobSelect() {
    const sel = document.getElementById("qf-add-job-select");
    sel.innerHTML = '<option value="">— select a job —</option>';
    state.jobs.forEach((j) => {
      const opt = document.createElement("option");
      opt.value = j.id;
      opt.textContent = j.name || j.id;
      sel.appendChild(opt);
    });
  }
  async function saveQueue() {
    const id = state.editingQueueId;
    const name = document.getElementById("qf-name").value.trim();
    const onFailure = document.getElementById("qf-on-failure").checked ? "" : "stop";
    const jobIds = getQueueJobIds();
    if (!name) {
      showError("queueform-error", "Name is required");
      return;
    }
    const body = { name, on_failure: onFailure, job_ids: jobIds };
    if (id) body.id = id;
    try {
      if (id) {
        await api("PUT", `/api/queues/${id}`, body);
      } else {
        await api("POST", "/api/queues", body);
      }
      state.queues = await api("GET", "/api/queues") || state.queues;
      showScreen("queues");
    } catch (err) {
      showError("queueform-error", err.message);
    }
  }
  async function deleteQueue(id) {
    if (!confirm("Delete this queue?")) return;
    try {
      await api("DELETE", `/api/queues/${id}`);
      state.queues = await api("GET", "/api/queues") || state.queues;
      renderQueuesList();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  }
  async function startQueueRun(queueId) {
    try {
      const data = await api("POST", `/api/queues/${queueId}/run`);
      if (!data) return;
      state.queues = await api("GET", "/api/queues") || state.queues;
      openQueueRun(data.queueRunId);
    } catch (err) {
      alert("Start queue failed: " + err.message);
    }
  }
  async function openQueueRun(queueRunId) {
    stopQueuePoll();
    state.currentQueueRun = null;
    showScreen("queuerun");
    try {
      const qr = await api("GET", `/api/queue-runs/${queueRunId}`);
      if (!qr) return;
      state.currentQueueRun = qr;
      renderQueueRunDetail(qr);
      if (qr.status === "running") {
        startQueuePoll(queueRunId);
      }
    } catch {
      document.getElementById("queuerun-body").innerHTML = `<p class="text-slate-500 text-sm">This queue has not been run since the server started.</p><button class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700" id="queuerun-rerun-btn">Run now</button>`;
      const btn = document.getElementById("queuerun-rerun-btn");
      if (btn) {
        btn.addEventListener("click", async () => {
          const qr = state.currentQueueRun;
          if (qr) await startQueueRun(qr.queueId);
        });
      }
    }
  }
  function renderQueueRunDetail(qr) {
    document.getElementById("queuerun-title").textContent = qr.queueName;
    const badge = document.getElementById("queuerun-status-badge");
    const badgeMap = {
      running: ["bg-blue-100 text-blue-700", "⟳ running"],
      success: ["bg-emerald-100 text-emerald-700", "✓ success"],
      failed: ["bg-rose-100 text-rose-700", "✗ failed"],
      canceled: ["bg-slate-100 text-slate-500", "⊘ canceled"]
    };
    const [cls, label] = badgeMap[qr.status] || ["bg-slate-100 text-slate-500", qr.status];
    badge.className = `rounded-full px-3 py-1 text-sm font-medium ${cls}`;
    badge.textContent = label;
    const stopBtn = document.getElementById("queuerun-stop-btn");
    stopBtn.classList.toggle("hidden", qr.status !== "running");
    const started = new Date(qr.startedAt);
    let timeStr = `Started ${started.toLocaleTimeString()}`;
    if (qr.finishedAt) {
      const elapsed = Math.round((new Date(qr.finishedAt) - started) / 1e3);
      timeStr += ` · ${elapsed}s`;
    } else if (qr.status === "running") {
      const elapsed = Math.round((Date.now() - started) / 1e3);
      timeStr += ` · ${elapsed}s elapsed`;
    }
    document.getElementById("queuerun-time").textContent = timeStr;
    const tbody = document.getElementById("queuerun-tbody");
    tbody.innerHTML = "";
    (qr.jobs || []).forEach((job) => {
      const statusHtml = queueJobStatusBadge(job.status);
      const hasRun = job.status != null && job.status !== null;
      const logsBtn = hasRun ? `<button class="view-logs-btn rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
           data-queue-run-id="${esc(qr.id)}" data-run-id="${esc(job.runId || "")}">View logs</button>` : '<span class="text-slate-400 text-xs">—</span>';
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td class="px-5 py-4 text-sm font-medium">${esc(job.jobName)}</td>
      <td class="px-5 py-4">${statusHtml}</td>
      <td class="px-5 py-4 text-right">${logsBtn}</td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".view-logs-btn").forEach((btn) => {
      btn.addEventListener("click", () => openQueueLogs(btn.dataset.queueRunId, btn.dataset.runId));
    });
  }
  function queueJobStatusBadge(status) {
    if (status == null) return '<span class="text-slate-400 text-xs">— pending</span>';
    const map = {
      running: ["bg-blue-100 text-blue-700", "⟳ running"],
      success: ["bg-emerald-100 text-emerald-700", "✓ success"],
      failed: ["bg-rose-100 text-rose-700", "✗ failed"],
      canceled: ["bg-slate-100 text-slate-500", "⊘ canceled"]
    };
    const [cls, label] = map[status] || ["bg-slate-100 text-slate-500", status];
    return `<span class="rounded-full ${cls} px-2.5 py-1 text-xs font-medium">${label}</span>`;
  }
  async function stopQueueRun() {
    if (!state.currentQueueRun) return;
    try {
      await api("POST", `/api/queue-runs/${state.currentQueueRun.id}/stop`);
    } catch {
    }
  }
  function startQueuePoll(queueRunId) {
    stopQueuePoll();
    async function poll() {
      try {
        const qr = await api("GET", `/api/queue-runs/${queueRunId}`);
        if (!qr) return;
        state.currentQueueRun = qr;
        renderQueueRunDetail(qr);
        state.queues = await api("GET", "/api/queues") || state.queues;
        if (qr.status !== "running") {
          stopQueuePoll();
          return;
        }
        state.queuePollTimer = setTimeout(poll, 2e3);
      } catch {
      }
    }
    poll();
  }
  function stopQueuePoll() {
    if (state.queuePollTimer) {
      clearTimeout(state.queuePollTimer);
      state.queuePollTimer = null;
    }
  }
  function openQueueLogs(queueRunId, runId) {
    stopQueueLogPoll();
    state.queueLogRunId = runId;
    showScreen("queuelogs");
    const qr = state.currentQueueRun;
    if (!qr || qr.id !== queueRunId) return;
    document.getElementById("queuelogs-back-title").textContent = qr.queueName;
    const sel = document.getElementById("queuelogs-job-select");
    sel.innerHTML = "";
    (qr.jobs || []).forEach((job) => {
      const opt = document.createElement("option");
      opt.value = job.runId || "";
      opt.dataset.status = job.status || "";
      opt.textContent = (statusIcon(job.status) + " " + job.jobName).trim();
      opt.disabled = !job.runId;
      if (job.runId === runId) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!runId) {
      document.getElementById("queuelogs-panel").textContent = "Waiting…";
      return;
    }
    fetchJobLog(runId, 0);
  }
  function statusIcon(status) {
    const icons = { running: "⟳", success: "✓", failed: "✗", canceled: "⊘" };
    return icons[status] || "";
  }
  var logPollTimer = null;
  function stopQueueLogPoll() {
    if (logPollTimer) {
      clearTimeout(logPollTimer);
      logPollTimer = null;
    }
  }
  async function fetchJobLog(runId, since) {
    stopQueueLogPoll();
    if (!runId) {
      document.getElementById("queuelogs-panel").textContent = "Waiting…";
      return;
    }
    try {
      const data = await api("GET", `/api/runs/${runId}/log?since=${since}`);
      if (!data) return;
      const panel = document.getElementById("queuelogs-panel");
      if (since === 0) panel.textContent = "";
      if (data.lines && data.lines.length) {
        panel.textContent += data.lines.join("\n") + "\n";
        panel.scrollTop = panel.scrollHeight;
      }
      if (data.status === "running") {
        logPollTimer = setTimeout(() => fetchJobLog(runId, data.next), 1e3);
      }
    } catch {
    }
  }
  function onQueueLogsJobChange() {
    stopQueueLogPoll();
    const sel = document.getElementById("queuelogs-job-select");
    const runId = sel.value;
    state.queueLogRunId = runId;
    fetchJobLog(runId, 0);
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
    } else {
      state.jobs.forEach((job) => {
        const route = formatRoute(job);
        const lastRun = job.lastRun;
        let statusBadge;
        if (lastRun) {
          statusBadge = runStatusBadge(lastRun.status, lastRun.exitCode);
        } else if (job.last_run_status) {
          statusBadge = runStatusBadge(job.last_run_status, 0);
        } else {
          statusBadge = '<span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">never run</span>';
        }
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td class="px-5 py-4 font-medium">${esc(job.name)}</td>
        <td class="px-5 py-4 font-mono text-xs text-slate-500">${esc(route)}</td>
        <td class="px-5 py-4">${statusBadge} <span class="text-xs text-slate-400 ml-1">${job.last_run_at ? new Date(job.last_run_at).toLocaleDateString(void 0, { month: "short", day: "numeric" }) : ""}</span></td>
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
    const qSection = document.getElementById("dashboard-queues-section");
    if (!state.queues.length) {
      qSection.classList.add("hidden");
      return;
    }
    qSection.classList.remove("hidden");
    const qTbody = document.getElementById("dashboard-queues-tbody");
    qTbody.innerHTML = "";
    state.queues.forEach((q) => {
      const jobCount = (q.job_ids || []).length;
      const isRunning = q.lastQueueRun && q.lastQueueRun.status === "running";
      let statusCell;
      if (!q.lastQueueRun) {
        statusCell = '<span class="text-slate-400 text-xs">—</span>';
      } else {
        const { id, status } = q.lastQueueRun;
        const badgeMap = {
          running: ["bg-blue-100 text-blue-700", "⟳ running"],
          success: ["bg-emerald-100 text-emerald-700", "✓ success"],
          failed: ["bg-rose-100 text-rose-700", "✗ failed"],
          canceled: ["bg-slate-100 text-slate-500", "⊘ canceled"]
        };
        const [cls, label] = badgeMap[status] || ["bg-slate-100 text-slate-500", status];
        statusCell = `<button class="dash-queue-status-btn rounded-full ${cls} px-2.5 py-1 text-xs font-medium" data-queue-run-id="${esc(id)}">${label}</button>`;
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td class="px-5 py-4 font-medium text-sm">${esc(q.name)}</td>
      <td class="px-5 py-4 text-sm text-slate-500">${jobCount}</td>
      <td class="px-5 py-4">${statusCell}</td>
      <td class="px-5 py-4 text-right">
        <button class="dash-queue-run-btn rounded-lg px-3 py-1.5 text-xs font-medium text-white ${isRunning ? "bg-slate-400 cursor-not-allowed" : "bg-brand-600 hover:bg-brand-700"}" data-queue-id="${esc(q.id)}" ${isRunning ? "disabled" : ""}>Run</button>
      </td>`;
      qTbody.appendChild(tr);
    });
    qTbody.querySelectorAll(".dash-queue-status-btn").forEach(
      (btn) => btn.addEventListener("click", () => openQueueRun(btn.dataset.queueRunId))
    );
    qTbody.querySelectorAll(".dash-queue-run-btn:not([disabled])").forEach(
      (btn) => btn.addEventListener("click", () => startQueueRun(btn.dataset.queueId))
    );
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
      const token = options.find((o) => o.Name === "token");
      if (token && !required.includes(token)) required.unshift(token);
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
    if (isServiceAccount) tipParts.unshift("Alternative to OAuth token - use for service accounts. Leave blank if using an OAuth token. Prefer a file on disk? Use the &quot;Service Account Credentials JSON file path&quot; field under Advanced.");
    if (isToken) tipParts.unshift("OAuth token JSON blob obtained from rclone config. Leave blank if using a service account instead.");
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
    const navTarget = {
      jobform: "jobs",
      provform: "providers",
      run: "dashboard",
      queueform: "queues",
      queuerun: "queues",
      queuelogs: "queues"
    }[name] || name;
    document.querySelectorAll(".nav-btn").forEach((b) => {
      const active = b.dataset.nav === navTarget;
      b.classList.toggle("bg-brand-50", active);
      b.classList.toggle("text-brand-700", active);
      b.classList.toggle("text-slate-600", !active);
    });
    if (name === "dashboard") renderDashboard();
    if (name === "jobs") renderJobsList();
    if (name === "providers") renderProvidersList();
    if (name === "queues") renderQueuesList();
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
    state.queues = [];
    stopPoll();
    showLock();
  }
  async function loadInitialData() {
    [state.jobs, state.providers, state.backends, state.queues] = await Promise.all([
      api("GET", "/api/jobs"),
      api("GET", "/api/providers"),
      api("GET", "/api/backends"),
      api("GET", "/api/queues")
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
    document.getElementById("new-queue-btn").addEventListener("click", () => {
      populateQueueJobSelect();
      openQueueForm(null);
    });
    document.getElementById("save-queue-btn").addEventListener("click", saveQueue);
    document.getElementById("qf-add-job-btn").addEventListener("click", addQueueJob);
    document.getElementById("queuerun-stop-btn").addEventListener("click", stopQueueRun);
    document.getElementById("queuelogs-job-select").addEventListener("change", onQueueLogsJobChange);
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
/*! Bundled license information:

sortablejs/modular/sortable.esm.js:
  (**!
   * Sortable 1.15.7
   * @author	RubaXa   <trash@rubaxa.org>
   * @author	owenm    <owen23355@gmail.com>
   * @license MIT
   *)
*/
