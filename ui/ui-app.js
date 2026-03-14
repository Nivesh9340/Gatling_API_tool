const scenariosEl = document.getElementById("scenarios");
const globalHeadersBody = document.getElementById("globalHeadersBody");
const envRowsBody = document.getElementById("envRowsBody");
const appRowsBody = document.getElementById("appRowsBody");
const injectRowsBody = document.getElementById("injectRowsBody");
const yamlOut = document.getElementById("yamlOut");
const gatlingScriptOut = document.getElementById("gatlingScriptOut");
const activeAppLabel = document.getElementById("activeAppLabel");
const validationBox = document.getElementById("validationBox");
const flowHint = document.getElementById("flowHint");
let currentFlowPage = 1;

const reportCards = document.getElementById("reportCards");
const reportAppTabs = document.getElementById("reportAppTabs");
const reportEnvTabs = document.getElementById("reportEnvTabs");
const resultsBody = document.getElementById("resultsBody");
const scenarioSummaryBody = document.getElementById("scenarioSummaryBody");
const failureReasonsBody = document.getElementById("failureReasonsBody");
const parityBody = document.getElementById("parityBody");
const detailPanel = document.getElementById("detailPanel");
const realRunStatus = document.getElementById("realRunStatus");
const reportFrame = document.getElementById("reportFrame");
const reportsLiveStatus = document.getElementById("reportsLiveStatus");
const reportTestStatus = document.getElementById("reportTestStatus");
const reportCurrentRunId = document.getElementById("reportCurrentRunId");
const reportJobId = document.getElementById("reportJobId");
const reportAvailability = document.getElementById("reportAvailability");
const savedSuiteName = document.getElementById("savedSuiteName");
const savedSuiteSelect = document.getElementById("savedSuiteSelect");
const savedSuiteMeta = document.getElementById("savedSuiteMeta");

const state = { apps: {}, activeApp: null, reports: {}, uiMode: "basic", rawYamlOverride: false };
let activeReportApp = null;
let activeReportEnv = null;
let activeRunJobId = null;
let runStatusPollTimer = null;
const SAVED_SUITES_KEY = "gatlingApiTool.savedSuites.v1";
const MODE_HINTS = {
  basic: "Basic mode keeps the workflow narrow: essential service fields, simple scenarios, and generated artifacts without advanced flow logic.",
  advanced: "Advanced mode exposes the full structured builder: headers, certificates, request tuning, captures, branching, and richer scenario controls.",
  expert: "Expert / Raw mode keeps the structured builder available and adds a direct YAML override for runs that need full-fidelity control."
};

function q(id) { return document.getElementById(id); }
function esc(v) { return String(v).replace(/"/g, '\\"'); }
function isBlank(s) { return s == null || String(s).trim() === ""; }
function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }
function avg(arr) { return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0; }
function min(arr) { return arr.length ? Math.min(...arr) : 0; }
function max(arr) { return arr.length ? Math.max(...arr) : 0; }
function percentile(arr, p) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]; }

function tab(name) {
  ["Scenarios", "Inject", "Envs", "Headers", "Certs"].forEach((x) => {
    q(`tab${x}Btn`).classList.toggle("active", x.toLowerCase() === name);
    q(`tab${x}`).classList.toggle("active", x.toLowerCase() === name);
  });
}

function renderFlowPage() {
  document.querySelectorAll(".flow-page").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.page) === currentFlowPage);
  });
  document.querySelectorAll(".flow-tab").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.page) === currentFlowPage);
  });
  if (flowHint) {
    const title = currentFlowPage === 1 ? "Apps & Service"
      : currentFlowPage === 2 ? "Load & Scenarios"
      : currentFlowPage === 3 ? "Run Setup"
      : "Reports";
    flowHint.textContent = `Step ${currentFlowPage} of 4: ${title}`;
  }
}
function goToFlowPage(n) {
  currentFlowPage = Math.max(1, Math.min(4, n));
  renderFlowPage();
}
function stopRunStatusPolling() {
  if (runStatusPollTimer) {
    clearInterval(runStatusPollTimer);
    runStatusPollTimer = null;
  }
}
function setRunStatusTiles(status, runId, jobId, availability, message) {
  if (reportTestStatus) reportTestStatus.textContent = status || "Idle";
  if (reportCurrentRunId) reportCurrentRunId.textContent = runId || "-";
  if (reportJobId) reportJobId.textContent = jobId || "-";
  if (reportAvailability) reportAvailability.textContent = availability || "Pending";
  if (reportsLiveStatus) reportsLiveStatus.textContent = message || "No active run.";
}
function applyReportDataset(data, sourceLabel) {
  if (!data) return;
  state.reports = { [sourceLabel || "Real Gatling Run"]: { latest: data } };
  activeReportApp = null;
  activeReportEnv = null;
  renderReportAppTabs();
  renderReportForCurrent();
}
function readSavedSuites() {
  try {
    const raw = window.localStorage.getItem(SAVED_SUITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}
function writeSavedSuites(suites) {
  window.localStorage.setItem(SAVED_SUITES_KEY, JSON.stringify(suites));
}
function getSavedSuiteByName(name) {
  return readSavedSuites().find((suite) => suite.name === name) || null;
}
function updateSavedSuiteMeta() {
  if (!savedSuiteMeta) return;
  const suite = getSavedSuiteByName(savedSuiteSelect ? savedSuiteSelect.value : "");
  if (!suite) {
    savedSuiteMeta.textContent = "No saved regression suite selected.";
    return;
  }
  if (savedSuiteName) savedSuiteName.value = suite.name || "";
  const apps = Object.keys((suite.plan || {}).applications || {}).length;
  const scenarios = Object.values((suite.plan || {}).applications || {}).reduce((count, app) => count + ((app.scenarios || []).length), 0);
  savedSuiteMeta.textContent = `Saved: ${suite.updatedAt || suite.createdAt || "-"} | Apps: ${apps} | Scenarios: ${scenarios} | Mode: ${suite.uiMode || "basic"}`;
}
function renderSavedSuites() {
  if (!savedSuiteSelect) return;
  const suites = readSavedSuites().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const current = savedSuiteSelect.value;
  savedSuiteSelect.innerHTML = `<option value="">No saved suite selected</option>${suites.map((suite) => `<option value="${suite.name}">${suite.name}</option>`).join("")}`;
  if (current && suites.some((suite) => suite.name === current)) savedSuiteSelect.value = current;
  updateSavedSuiteMeta();
}
function buildWorkspaceSnapshot() {
  const plan = collectEnhancedPlan();
  return {
    name: "",
    uiMode: state.uiMode,
    rawYamlOverride: state.rawYamlOverride,
    rawYaml: (q("rawYamlEditor") || {}).value || "",
    activeApp: state.activeApp,
    plan: deepCopy(plan)
  };
}
function applyWorkspaceSnapshot(snapshot) {
  if (!snapshot || !snapshot.plan || !snapshot.plan.applications) {
    alert("Saved suite data is invalid.");
    return false;
  }
  state.apps = deepCopy(snapshot.plan.applications || {});
  const appNames = Object.keys(state.apps);
  if (!appNames.length) {
    alert("Saved suite has no applications.");
    return false;
  }
  state.activeApp = snapshot.activeApp && state.apps[snapshot.activeApp] ? snapshot.activeApp : appNames[0];
  renderAppRows();
  appToUI(state.apps[state.activeApp]);
  applyAdvancedFieldsToUI(state.apps[state.activeApp]);
  setMode(snapshot.uiMode || "basic");
  state.rawYamlOverride = snapshot.rawYamlOverride === true;
  if (q("toggleRawYamlBtn")) q("toggleRawYamlBtn").textContent = `Use Raw YAML: ${state.rawYamlOverride ? "On" : "Off"}`;
  if (q("rawYamlEditor")) q("rawYamlEditor").value = snapshot.rawYaml || "";
  generateYaml();
  return true;
}
function saveCurrentSuite() {
  const name = ((savedSuiteName || {}).value || "").trim();
  if (isBlank(name)) {
    alert("Suite Name is required.");
    return;
  }
  const snapshot = buildWorkspaceSnapshot();
  const suites = readSavedSuites().filter((suite) => suite.name !== name);
  const existing = getSavedSuiteByName(name);
  snapshot.name = name;
  snapshot.createdAt = existing && existing.createdAt ? existing.createdAt : new Date().toISOString();
  snapshot.updatedAt = new Date().toISOString();
  suites.push(snapshot);
  writeSavedSuites(suites);
  if (savedSuiteSelect) savedSuiteSelect.value = name;
  renderSavedSuites();
  if (savedSuiteMeta) savedSuiteMeta.textContent = `Saved suite "${name}" ready for reload or execution.`;
}
function loadSelectedSuite() {
  const name = ((savedSuiteSelect || {}).value || "").trim();
  if (isBlank(name)) {
    alert("Select a saved suite first.");
    return;
  }
  const suite = getSavedSuiteByName(name);
  if (!suite) {
    alert(`Saved suite not found: ${name}`);
    renderSavedSuites();
    return;
  }
  if (savedSuiteName) savedSuiteName.value = suite.name;
  if (applyWorkspaceSnapshot(suite) && savedSuiteMeta) {
    savedSuiteMeta.textContent = `Loaded suite "${suite.name}" into the workspace.`;
  }
}
function deleteSelectedSuite() {
  const name = ((savedSuiteSelect || {}).value || "").trim();
  if (isBlank(name)) {
    alert("Select a saved suite first.");
    return;
  }
  writeSavedSuites(readSavedSuites().filter((suite) => suite.name !== name));
  if (savedSuiteName && savedSuiteName.value === name) savedSuiteName.value = "";
  renderSavedSuites();
}
function getSelectedSavedSuitePlan() {
  const name = ((savedSuiteSelect || {}).value || "").trim();
  if (isBlank(name)) {
    alert("Select a saved suite first.");
    return null;
  }
  const suite = getSavedSuiteByName(name);
  if (!suite || !suite.plan) {
    alert(`Saved suite not found: ${name}`);
    renderSavedSuites();
    return null;
  }
  return deepCopy(suite.plan);
}
function setMode(mode) {
  state.uiMode = mode;
  document.body.dataset.uiMode = mode;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.modeTarget === mode);
  });
  if (q("modeHint")) q("modeHint").textContent = MODE_HINTS[mode] || "";
  if (q("guidedModeBox")) {
    q("guidedModeBox").textContent = mode === "basic"
      ? "Start with one scenario and one API step. Set the path, expected status, and an injection profile. Move to Advanced when you need branching, captures, or request-level tuning."
      : mode === "advanced"
        ? "Advanced mode keeps the structured builder in control. Use it when you need step auth, uploads, checks, captures, request flags, or flow conditions."
        : "Expert mode gives you the full builder plus a raw YAML override. Use the raw editor only when the structured UI is too limiting for the exact Gatling config you need.";
  }
  if (mode === "basic" && q("tabHeaders").classList.contains("active")) tab("scenarios");
  if (mode === "basic" && q("tabCerts").classList.contains("active")) tab("scenarios");
  if (mode === "expert" && q("rawYamlEditor") && !q("rawYamlEditor").value.trim()) {
    q("rawYamlEditor").value = emitYaml(collectEnhancedPlan());
  }
  applyModeToBuilder();
}
function applyModeToBuilder() {
  document.querySelectorAll(".scenario").forEach(applyModeToScenario);
}
function applyModeToScenario(node) {
  if (!node) return;
  node.querySelectorAll(".mode-basic-hide").forEach((el) => {
    el.style.display = state.uiMode === "basic" ? "none" : "";
  });
  node.querySelectorAll(".mode-expert-only").forEach((el) => {
    el.style.display = state.uiMode === "expert" ? "" : "none";
  });
}
function getEffectiveGeneratedYaml() {
  const plan = collectEnhancedPlan();
  const errors = validateEnhancedPlan(plan);
  showValidation(errors);
  if (errors.length) return null;
  return emitYaml(plan);
}
function shouldUseRawYaml() {
  return state.uiMode === "expert" && state.rawYamlOverride;
}
function applyRunnerConfigDefault() {
  const input = q("runnerApiBase");
  const configured = ((window.__RUNNER_CONFIG__ || {}).runnerApiBase || "").trim();
  if (!input || isBlank(configured)) return;
  const current = (input.value || "").trim();
  if (isBlank(current) || current === "http://127.0.0.1:8787") input.value = configured;
}
function getEffectiveYamlForExecution() {
  if (shouldUseRawYaml()) {
    const raw = (q("rawYamlEditor").value || "").trim();
    if (isBlank(raw)) {
      alert("Raw YAML override is enabled but the editor is empty.");
      return null;
    }
    return raw;
  }
  return getEffectiveGeneratedYaml();
}
function syncRawYamlEditor() {
  const yaml = getEffectiveGeneratedYaml();
  if (yaml == null) return;
  q("rawYamlEditor").value = yaml;
}
function toggleRawYamlOverride() {
  state.rawYamlOverride = !state.rawYamlOverride;
  q("toggleRawYamlBtn").textContent = `Use Raw YAML: ${state.rawYamlOverride ? "On" : "Off"}`;
}

function addHeaderRow(target, key = "", val = "") {
  const h = document.createElement("tbody");
  h.innerHTML = `<tr><td><input class="h-key" value="${key}"/></td><td><input class="h-val" value="${val}"/></td><td><button class="danger rm-h">Remove</button></td></tr>`;
  const r = h.firstElementChild;
  r.querySelector(".rm-h").addEventListener("click", () => r.remove());
  target.appendChild(r);
}
function parseHeaders(target) {
  const out = {};
  target.querySelectorAll("tr").forEach((r) => {
    const k = (r.querySelector(".h-key") || {}).value;
    const v = (r.querySelector(".h-val") || {}).value;
    if (!isBlank(k)) out[k.trim()] = (v || "").trim();
  });
  return out;
}
function kvRowTemplate(keyCls, valCls, keyPlaceholder, valPlaceholder, key = "", val = "") {
  return `<tr><td><input class="${keyCls}" value="${key}" placeholder="${keyPlaceholder}"/></td><td><input class="${valCls}" value="${val}" placeholder="${valPlaceholder}"/></td><td><button class="danger rm-kv">Remove</button></td></tr>`;
}
function addKeyValueRow(target, keyCls, valCls, keyPlaceholder, valPlaceholder, key = "", val = "") {
  const h = document.createElement("tbody");
  h.innerHTML = kvRowTemplate(keyCls, valCls, keyPlaceholder, valPlaceholder, key, val);
  const r = h.firstElementChild;
  r.querySelector(".rm-kv").addEventListener("click", () => r.remove());
  target.appendChild(r);
}
function parseKeyValueRows(target, keyCls, valCls) {
  const out = {};
  target.querySelectorAll("tr").forEach((r) => {
    const k = ((r.querySelector(`.${keyCls}`) || {}).value || "").trim();
    const v = ((r.querySelector(`.${valCls}`) || {}).value || "").trim();
    if (!isBlank(k)) out[k] = v;
  });
  return out;
}
function uploadRowTemplate(fieldName = "", filePath = "") {
  return `<tr><td><input class="upload-field" value="${fieldName}" placeholder="file"/></td><td><input class="upload-path" value="${filePath}" placeholder="src/test/resources/data/file.txt"/></td><td><button class="danger rm-upload">Remove</button></td></tr>`;
}
function addUploadRow(target, fieldName = "", filePath = "") {
  const h = document.createElement("tbody");
  h.innerHTML = uploadRowTemplate(fieldName, filePath);
  const r = h.firstElementChild;
  r.querySelector(".rm-upload").addEventListener("click", () => r.remove());
  target.appendChild(r);
}
function parseUploads(target) {
  const out = [];
  target.querySelectorAll("tr").forEach((r) => {
    const fieldName = ((r.querySelector(".upload-field") || {}).value || "").trim();
    const filePath = ((r.querySelector(".upload-path") || {}).value || "").trim();
    if (!isBlank(fieldName) && !isBlank(filePath)) out.push({ fieldName, filePath });
  });
  return out;
}
function buildAuth(type, p1, p2, headerName) {
  const t = (type || "").trim();
  if (isBlank(t)) return null;
  if (t === "bearer") return { type: "bearer", tokenEnv: (p1 || "").trim() || "API_TOKEN" };
  if (t === "basic") return { type: "basic", usernameEnv: (p1 || "").trim() || "API_USER", passwordEnv: (p2 || "").trim() || "API_PASSWORD" };
  if (t === "header") return { type: "header", headerName: (headerName || "").trim() || "x-api-key", headerValueEnv: (p1 || "").trim() || "API_KEY" };
  return null;
}
function branchOperatorOptions(selected = "equals") {
  return ["equals", "notEquals", "contains", "in", "exists", "notExists"]
    .map((op) => `<option value="${op}" ${op === selected ? "selected" : ""}>${op}</option>`)
    .join("");
}
function branchMethodOptions(selected = "") {
  return ["", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    .map((method) => `<option value="${method}" ${method === selected ? "selected" : ""}>${method || "inherit"}</option>`)
    .join("");
}
function branchRowTemplate(branch = {}) {
  const when = branch.when || {};
  const operator = !isBlank(when.operator) ? when.operator : (when.equals != null ? "equals" : "equals");
  const values = Array.isArray(when.values) ? when.values.join(", ") : "";
  return `<tr class="branch-row">
    <td><input class="branch-name" value="${branch.name || ""}" placeholder="Premium"/></td>
    <td><input class="branch-var" value="${when.variable || ""}" placeholder="routeType"/></td>
    <td><select class="branch-op">${branchOperatorOptions(operator)}</select></td>
    <td><input class="branch-value" value="${when.value != null ? when.value : (when.equals != null ? when.equals : "")}" placeholder="premium"/></td>
    <td><input class="branch-values" value="${values}" placeholder="premium, vip"/></td>
    <td><select class="branch-method">${branchMethodOptions(branch.method || "")}</select></td>
    <td><input class="branch-path" value="${branch.path || ""}" placeholder="/premium"/></td>
    <td><input class="branch-url" value="${branch.url || ""}" placeholder="optional absolute url"/></td>
    <td><input class="branch-status" type="number" value="${branch.expectedStatus == null ? "" : branch.expectedStatus}" placeholder="200"/></td>
    <td><button class="danger rm-branch" type="button">Remove</button></td>
  </tr>
  <tr class="branch-row-body">
    <td colspan="10"><label>Branch Body Override</label><textarea class="branch-body" placeholder="optional branch-specific body">${branch.body || ""}</textarea><div class="grid" style="margin-top:8px;"><div><label>Branch Hook Class (Expert)</label><input class="branch-hook-ref" placeholder="com.example.gatling.extensions.MyHook" value="${branch.customHookRef || ""}"/></div><div><label>Branch Hook Name (Generated)</label><input class="branch-hook-name" placeholder="BranchVipHook" value="${branch.customHookName || ""}"/></div></div><label style="margin-top:6px;">Branch Hook Java Code (before step)</label><textarea class="branch-hook-code" placeholder="session = session.set(&quot;branchMode&quot;, &quot;vip&quot;);">${branch.customHookCode || ""}</textarea></td>
  </tr>
  <tr class="branch-row-checks">
    <td colspan="10">
      <div class="row">
        <label>Branch Checks</label>
        <button class="ghost add-branch-check" type="button">Add Check</button>
      </div>
      <table>
        <thead><tr><th>Type</th><th>Path</th><th>Value</th><th>Action</th></tr></thead>
        <tbody class="branch-checks-body"></tbody>
      </table>
    </td>
  </tr>
  <tr class="branch-row-captures">
    <td colspan="10">
      <div class="row">
        <label>Branch Captures</label>
        <button class="ghost add-branch-capture" type="button">Add Capture</button>
      </div>
      <table>
        <thead><tr><th>Type</th><th>Path</th><th>SaveAs</th><th>Action</th></tr></thead>
        <tbody class="branch-captures-body"></tbody>
      </table>
    </td>
  </tr>`;
}
function branchCheckRowTemplate() {
  return `<tr><td><select class="branch-c-type"><option value="bodyContains">bodyContains</option><option value="regex">regex</option><option value="jsonPathExists">jsonPathExists</option><option value="jsonPathEquals">jsonPathEquals</option><option value="headerExists">headerExists</option><option value="headerEquals">headerEquals</option><option value="bodyLengthGt">bodyLengthGt</option><option value="jmesPathExists">jmesPathExists</option><option value="jmesPathEquals">jmesPathEquals</option><option value="statusIn">statusIn</option></select></td><td><input class="branch-c-path" placeholder="$.id or Header-Name"/></td><td><input class="branch-c-value" placeholder="value / regex / 200,201"/></td><td><button class="danger rm-branch-check" type="button">Remove</button></td></tr>`;
}
function branchCaptureRowTemplate() {
  return `<tr><td><select class="branch-cap-type"><option value="jsonPath">jsonPath</option><option value="header">header</option><option value="regex">regex</option></select></td><td><input class="branch-cap-path" placeholder="$.id / Header-Name / regex"/></td><td><input class="branch-cap-save" placeholder="savedId"/></td><td><button class="danger rm-branch-capture" type="button">Remove</button></td></tr>`;
}
function addBranchCheckRow(target, data = {}, onChange = () => {}) {
  const holder = document.createElement("tbody");
  holder.innerHTML = branchCheckRowTemplate();
  const row = holder.firstElementChild;
  row.querySelector(".branch-c-type").value = data.type || "bodyContains";
  row.querySelector(".branch-c-path").value = data.path || "";
  row.querySelector(".branch-c-value").value = data.value || "";
  row.querySelector(".rm-branch-check").addEventListener("click", () => { row.remove(); onChange(); });
  target.appendChild(row);
  onChange();
}
function addBranchCaptureRow(target, data = {}, onChange = () => {}) {
  const holder = document.createElement("tbody");
  holder.innerHTML = branchCaptureRowTemplate();
  const row = holder.firstElementChild;
  row.querySelector(".branch-cap-type").value = data.type || "jsonPath";
  row.querySelector(".branch-cap-path").value = data.path || "";
  row.querySelector(".branch-cap-save").value = data.saveAs || "";
  row.querySelector(".rm-branch-capture").addEventListener("click", () => { row.remove(); onChange(); });
  target.appendChild(row);
  onChange();
}
function parseBranchChecks(target) {
  const out = [];
  (target || document.createElement("tbody")).querySelectorAll("tr").forEach((r) => {
    const type = (r.querySelector(".branch-c-type") || {}).value || "";
    const path = ((r.querySelector(".branch-c-path") || {}).value || "").trim();
    const value = ((r.querySelector(".branch-c-value") || {}).value || "").trim();
    if (!isBlank(type)) {
      const check = { type };
      if (!isBlank(path)) check.path = path;
      if (!isBlank(value)) check.value = value;
      out.push(check);
    }
  });
  return out;
}
function parseBranchCaptures(target) {
  const out = [];
  (target || document.createElement("tbody")).querySelectorAll("tr").forEach((r) => {
    const type = (r.querySelector(".branch-cap-type") || {}).value || "";
    const path = ((r.querySelector(".branch-cap-path") || {}).value || "").trim();
    const saveAs = ((r.querySelector(".branch-cap-save") || {}).value || "").trim();
    if (!isBlank(type) && !isBlank(path) && !isBlank(saveAs)) out.push({ type, path, saveAs });
  });
  return out;
}
function addBranchRow(target, branch = {}, onChange = () => {}) {
  const wrapper = document.createElement("tbody");
  wrapper.innerHTML = branchRowTemplate(branch);
  const rows = [...wrapper.children];
  const checksBody = wrapper.querySelector(".branch-checks-body");
  const capturesBody = wrapper.querySelector(".branch-captures-body");
  rows.forEach((row) => {
    const removeBtn = row.querySelector(".rm-branch");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => { rows.forEach((item) => item.remove()); onChange(); });
    }
    const addCheckBtn = row.querySelector(".add-branch-check");
    if (addCheckBtn && checksBody) addCheckBtn.addEventListener("click", () => addBranchCheckRow(checksBody, {}, onChange));
    const addCaptureBtn = row.querySelector(".add-branch-capture");
    if (addCaptureBtn && capturesBody) addCaptureBtn.addEventListener("click", () => addBranchCaptureRow(capturesBody, {}, onChange));
    target.appendChild(row);
  });
  (branch.checks || []).forEach((check) => addBranchCheckRow(checksBody, check, onChange));
  (branch.captures || []).forEach((capture) => addBranchCaptureRow(capturesBody, capture, onChange));
}
function parseBranches(target) {
  const out = [];
  const rows = [...target.querySelectorAll(".branch-row")];
  rows.forEach((row) => {
    const bodyRow = row.nextElementSibling && row.nextElementSibling.classList.contains("branch-row-body")
      ? row.nextElementSibling
      : null;
    const checksRow = bodyRow && bodyRow.nextElementSibling && bodyRow.nextElementSibling.classList.contains("branch-row-checks")
      ? bodyRow.nextElementSibling
      : null;
    const capturesRow = checksRow && checksRow.nextElementSibling && checksRow.nextElementSibling.classList.contains("branch-row-captures")
      ? checksRow.nextElementSibling
      : null;
    const operator = ((row.querySelector(".branch-op") || {}).value || "equals").trim();
    const value = ((row.querySelector(".branch-value") || {}).value || "").trim();
    const csvValues = ((row.querySelector(".branch-values") || {}).value || "").split(",").map((item) => item.trim()).filter(Boolean);
    const branch = {
      name: ((row.querySelector(".branch-name") || {}).value || "").trim(),
      when: {
        variable: ((row.querySelector(".branch-var") || {}).value || "").trim(),
        operator
      }
    };
    if (!isBlank(value)) branch.when.value = value;
    if (csvValues.length) branch.when.values = csvValues;
    const method = ((row.querySelector(".branch-method") || {}).value || "").trim();
    const path = ((row.querySelector(".branch-path") || {}).value || "").trim();
    const url = ((row.querySelector(".branch-url") || {}).value || "").trim();
    const status = ((row.querySelector(".branch-status") || {}).value || "").trim();
    const body = ((bodyRow && bodyRow.querySelector(".branch-body")) || {}).value || "";
    const hookRef = ((bodyRow && bodyRow.querySelector(".branch-hook-ref")) || {}).value || "";
    const hookName = ((bodyRow && bodyRow.querySelector(".branch-hook-name")) || {}).value || "";
    const hookCode = ((bodyRow && bodyRow.querySelector(".branch-hook-code")) || {}).value || "";
    const checks = parseBranchChecks((checksRow && checksRow.querySelector(".branch-checks-body")) || null);
    const captures = parseBranchCaptures((capturesRow && capturesRow.querySelector(".branch-captures-body")) || null);
    if (!isBlank(method)) branch.method = method;
    if (!isBlank(path)) branch.path = path;
    if (!isBlank(url)) branch.url = url;
    if (!isBlank(status)) branch.expectedStatus = Number(status);
    if (!isBlank(body)) branch.body = body;
    if (!isBlank(hookRef)) branch.customHookRef = hookRef.trim();
    if (!isBlank(hookName)) branch.customHookName = hookName.trim();
    if (!isBlank(hookCode)) branch.customHookCode = hookCode;
    if (checks.length) branch.checks = checks;
    if (captures.length) branch.captures = captures;
    if (!isBlank(branch.when.variable)) out.push(branch);
  });
  return out;
}
function normalizeCondition(condition) {
  if (!condition || isBlank(condition.variable)) return null;
  const normalized = { variable: condition.variable };
  normalized.operator = !isBlank(condition.operator) ? condition.operator : (condition.equals != null ? "equals" : "exists");
  if (condition.value != null && !isBlank(condition.value)) normalized.value = condition.value;
  else if (condition.equals != null && !isBlank(condition.equals)) normalized.value = condition.equals;
  if (Array.isArray(condition.values) && condition.values.length) normalized.values = condition.values.filter((item) => !isBlank(item));
  return normalized;
}
function evaluateCondition(condition, vars) {
  const normalized = normalizeCondition(condition);
  if (!normalized) return false;
  const actual = vars[normalized.variable];
  const actualString = String(actual == null ? "" : actual);
  switch (String(normalized.operator || "equals").toLowerCase()) {
    case "equals":
      return actualString === String(normalized.value == null ? "" : normalized.value);
    case "notequals":
      return actualString !== String(normalized.value == null ? "" : normalized.value);
    case "contains":
      return actualString.includes(String(normalized.value == null ? "" : normalized.value));
    case "in":
      return (normalized.values || [normalized.value == null ? "" : normalized.value]).map(String).includes(actualString);
    case "exists":
      return actual != null && actualString !== "";
    case "notexists":
      return actual == null || actualString === "";
    default:
      return false;
  }
}
function mergeStepOverride(baseStep, override, suffix) {
  const merged = JSON.parse(JSON.stringify(baseStep || {}));
  merged.name = !isBlank((override || {}).name) ? `${baseStep.name} :: ${override.name}` : `${baseStep.name}${suffix ? ` ${suffix}` : ""}`;
  ["method", "path", "url", "customHookRef", "customHookName", "customHookCode", "body", "bodyFile", "bodyType", "auth", "expectedStatus", "retryCount", "pauseMs", "requestTimeoutMs"].forEach((key) => {
    if (override && override[key] != null && !isBlank(override[key])) merged[key] = override[key];
  });
  ["disableFollowRedirect", "disableUrlEncoding", "silent", "ignoreProtocolHeaders"].forEach((key) => {
    if (override && override[key] != null) merged[key] = override[key];
  });
  if (override && override.headers && Object.keys(override.headers).length) merged.headers = Object.assign({}, baseStep.headers || {}, override.headers);
  if (override && override.queryParams && Object.keys(override.queryParams).length) merged.queryParams = Object.assign({}, baseStep.queryParams || {}, override.queryParams);
  if (override && override.formParams && Object.keys(override.formParams).length) merged.formParams = Object.assign({}, baseStep.formParams || {}, override.formParams);
  if (override && override.formUploads && override.formUploads.length) merged.formUploads = override.formUploads;
  if (override && override.checks && override.checks.length) merged.checks = override.checks;
  if (override && override.captures && override.captures.length) merged.captures = override.captures;
  return merged;
}
function ensureEndpointSection(node, sectionName) {
  const section = node.querySelector(`.sec-${sectionName}`);
  if (!section) return null;
  section.classList.remove("is-hidden");
  section.open = true;
  return section;
}
function maybeHideEndpointSection(node, sectionName, shouldShow) {
  const section = node.querySelector(`.sec-${sectionName}`);
  if (!section) return;
  section.classList.toggle("is-hidden", !shouldShow);
  if (!shouldShow) section.open = false;
}
function updateEndpointSummary(node) {
  const name = ((node.querySelector(".name") || {}).value || "").trim() || "Unnamed API";
  const method = ((node.querySelector(".method") || {}).value || "").trim() || "GET";
  const target = ((node.querySelector(".url") || {}).value || "").trim() || ((node.querySelector(".path") || {}).value || "").trim() || "-";
  const counts = [];
  const headers = node.querySelectorAll(".step-h tr").length;
  const query = node.querySelectorAll(".step-q tr").length;
  const form = node.querySelectorAll(".step-f tr").length;
  const uploads = node.querySelectorAll(".step-u tr").length;
  const checks = node.querySelectorAll(".step-c tr").length;
  const captures = node.querySelectorAll(".step-cap tr").length;
  if (headers) counts.push(`headers ${headers}`);
  if (query) counts.push(`query ${query}`);
  if (form) counts.push(`form ${form}`);
  if (uploads) counts.push(`uploads ${uploads}`);
  if (checks) counts.push(`checks ${checks}`);
  if (captures) counts.push(`captures ${captures}`);
  if (!isBlank((node.querySelector(".body") || {}).value) || !isBlank((node.querySelector(".body-file") || {}).value)) counts.push("payload");
  if (!isBlank((node.querySelector(".step-auth-type") || {}).value)) counts.push("auth");
  if (node.querySelectorAll(".step-branches .branch-row").length || !isBlank((node.querySelector(".else-method") || {}).value) || !isBlank((node.querySelector(".cond-var") || {}).value)) counts.push("branching");
  const suffix = counts.length ? ` | ${counts.join(" | ")}` : "";
  const summary = node.querySelector(".endpoint-summary");
  if (summary) summary.textContent = `${name}: ${method} ${target}${suffix}`;
}
function refreshEndpointLayout(node) {
  const h = node.querySelector(".step-h");
  const qParams = node.querySelector(".step-q");
  const formParams = node.querySelector(".step-f");
  const uploads = node.querySelector(".step-u");
  const c = node.querySelector(".step-c");
  const cap = node.querySelector(".step-cap");
  const requestSection = node.querySelector(".sec-request");
  const requestHasContent = !!(
    (node.querySelector(".timeout").value || "").trim()
    || node.querySelector(".disable-follow-redirect").checked
    || node.querySelector(".disable-url-encoding").checked
    || node.querySelector(".silent-step").checked
    || node.querySelector(".ignore-protocol-headers").checked
    || !isBlank((node.querySelector(".custom-hook-ref") || {}).value)
    || !isBlank((node.querySelector(".custom-hook-name") || {}).value)
    || !isBlank((node.querySelector(".custom-hook-code") || {}).value)
  );
  maybeHideEndpointSection(
    node,
    "request",
    requestHasContent || !!(requestSection && requestSection.open)
  );
  maybeHideEndpointSection(node, "auth", !isBlank((node.querySelector(".step-auth-type") || {}).value));
  maybeHideEndpointSection(node, "payload", !isBlank((node.querySelector(".body") || {}).value) || !isBlank((node.querySelector(".body-file") || {}).value) || !isBlank((node.querySelector(".body-type") || {}).value) || !!formParams.querySelector("tr") || !!uploads.querySelector("tr"));
  maybeHideEndpointSection(node, "branching", !!node.querySelector(".step-branches .branch-row") || !isBlank((node.querySelector(".cond-var") || {}).value) || !isBlank((node.querySelector(".else-method") || {}).value) || !isBlank((node.querySelector(".else-body") || {}).value));
  maybeHideEndpointSection(node, "headers", !!h.querySelector("tr"));
  maybeHideEndpointSection(node, "query", !!qParams.querySelector("tr"));
  maybeHideEndpointSection(node, "checks", !!c.querySelector("tr"));
  maybeHideEndpointSection(node, "captures", !!cap.querySelector("tr"));
  updateEndpointSummary(node);
}

function appRowTemplate(name, active, enabled) {
  const app = state.apps[name] || {};
  const baseUrl = app.service ? (app.service.baseUrl || "") : "";
  return `<tr data-app="${name}"><td><input class="app-enabled" type="checkbox" ${enabled ? "checked" : ""}/></td><td><input class="app-active" type="radio" name="activeApp" ${active ? "checked" : ""}/></td><td><input class="app-name" value="${name}"/></td><td><input class="app-base-url" value="${baseUrl}" placeholder="https://api.example.com"/></td><td><button class="danger app-rm">Remove</button></td></tr>`;
}
function defaultAppData() {
  return {
    enabled: true,
    service: { baseUrl: "https://jsonplaceholder.typicode.com", defaultHeaders: { Accept: "application/json", "Content-Type": "application/json" } },
    environments: {},
    activeEnvironment: "",
    injectionProfiles: {
      default_ramp: { injectionType: "rampUsers", users: 10, rampDurationSec: 30 },
      hour_60k: { injectionType: "pacedUsers", users: 10, durationSec: 3600, paceMs: 600 }
    },
    assertions: {
      minSuccessPercent: 99,
      maxResponseTimeMs: 2000,
      p90ResponseTimeMs: null,
      p95ResponseTimeMs: 1200,
      p99ResponseTimeMs: null,
      maxFailedRequests: null,
      minRequestsPerSec: null
    },
    scenarios: [
      {
        name: "Read Posts",
        load: { profileRef: "default_ramp" },
        steps: [
          {
            name: "Get Posts",
            method: "GET",
            path: "/posts",
            expectedStatus: 200,
            queryParams: { _limit: "10" },
            checks: [{ type: "jsonPathExists", path: "$[0].id" }]
          },
          {
            name: "Get Post By Id",
            method: "GET",
            path: "/posts/1",
            expectedStatus: 200,
            checks: [{ type: "jsonPathEquals", path: "$.id", value: "1" }]
          }
        ]
      }
    ]
  };
}

function renderAppRows() {
  appRowsBody.innerHTML = "";
  Object.keys(state.apps).forEach((name) => {
    const t = document.createElement("tbody");
    t.innerHTML = appRowTemplate(name, state.activeApp === name, state.apps[name].enabled !== false);
    const row = t.firstElementChild;
    row.querySelector(".app-active").addEventListener("change", () => switchApp(name));
    row.querySelector(".app-enabled").addEventListener("change", (e) => { state.apps[name].enabled = e.target.checked; });
    row.querySelector(".app-name").addEventListener("change", (e) => renameApp(name, e.target.value.trim()));
    row.querySelector(".app-base-url").addEventListener("change", (e) => {
      if (!state.apps[name].service) state.apps[name].service = {};
      state.apps[name].service.baseUrl = (e.target.value || "").trim();
      if (state.activeApp === name) q("baseUrl").value = state.apps[name].service.baseUrl;
      generateYaml();
    });
    row.querySelector(".app-rm").addEventListener("click", () => removeApp(name));
    appRowsBody.appendChild(row);
  });
}

function saveActiveAppFromUI() { if (state.activeApp) state.apps[state.activeApp] = appFromUIDeep(); }
function appFromUIDeep() {
  const app = appFromUI();
  const scenarioNodes = [...scenariosEl.querySelectorAll(".scenario")];
  scenarioNodes.forEach((scNode, scIdx) => {
    const scenario = app.scenarios && app.scenarios[scIdx];
    if (!scenario) return;
    scenario.flow = scenario.flow || {};
    const asVar = ((scNode.querySelector(".flow-as-var") || {}).value || "").trim();
    const asEq = ((scNode.querySelector(".flow-as-eq") || {}).value || "").trim();
    if (!isBlank(asVar)) scenario.flow.asLongAsVariable = asVar;
    else delete scenario.flow.asLongAsVariable;
    if (!isBlank(asEq)) scenario.flow.asLongAsEquals = asEq;
    else delete scenario.flow.asLongAsEquals;
    if (!Object.keys(scenario.flow).length) delete scenario.flow;

    const stepNodes = [...scNode.querySelectorAll(".endpoint")];
    stepNodes.forEach((stepNode, stepIdx) => {
      const step = scenario.steps && scenario.steps[stepIdx];
      if (!step) return;
      const elseMethod = ((stepNode.querySelector(".else-method") || {}).value || "").trim();
      const elsePath = ((stepNode.querySelector(".else-path") || {}).value || "").trim();
      const elseStatusRaw = ((stepNode.querySelector(".else-status") || {}).value || "").trim();
      const elseBody = ((stepNode.querySelector(".else-body") || {}).value || "");
      if (!isBlank(elseMethod)) step.elseMethod = elseMethod;
      else delete step.elseMethod;
      if (!isBlank(elsePath)) step.elsePath = elsePath;
      else delete step.elsePath;
      if (!isBlank(elseBody)) step.elseBody = elseBody;
      else delete step.elseBody;
      if (!isBlank(elseStatusRaw)) step.elseExpectedStatus = Number(elseStatusRaw);
      else delete step.elseExpectedStatus;
    });
  });
  return app;
}
function applyAdvancedFieldsToUI(app) {
  if (!app || !app.scenarios) return;
  const scenarioNodes = [...scenariosEl.querySelectorAll(".scenario")];
  scenarioNodes.forEach((scNode, scIdx) => {
    const scenario = app.scenarios[scIdx];
    if (!scenario) return;
    const flowVar = scNode.querySelector(".flow-as-var");
    const flowEq = scNode.querySelector(".flow-as-eq");
    if (flowVar) flowVar.value = scenario.flow && scenario.flow.asLongAsVariable ? scenario.flow.asLongAsVariable : "";
    if (flowEq) flowEq.value = scenario.flow && scenario.flow.asLongAsEquals ? scenario.flow.asLongAsEquals : "";
    const stepNodes = [...scNode.querySelectorAll(".endpoint")];
    stepNodes.forEach((stepNode, stepIdx) => {
      const step = scenario.steps && scenario.steps[stepIdx];
      if (!step) return;
      const elseMethod = stepNode.querySelector(".else-method");
      const elsePath = stepNode.querySelector(".else-path");
      const elseStatus = stepNode.querySelector(".else-status");
      const elseBody = stepNode.querySelector(".else-body");
      if (elseMethod) elseMethod.value = step.elseMethod || "";
      if (elsePath) elsePath.value = step.elsePath || "";
      if (elseStatus) elseStatus.value = step.elseExpectedStatus == null ? "" : step.elseExpectedStatus;
      if (elseBody) elseBody.value = step.elseBody || "";
    });
  });
}
function collectEnhancedPlan() {
  saveActiveAppFromUI();
  return collectPlan();
}
function setWorkspaceFromPlan(plan) {
  return applyWorkspaceSnapshot({
    uiMode: state.uiMode,
    rawYamlOverride: state.rawYamlOverride,
    rawYaml: (q("rawYamlEditor") || {}).value || "",
    activeApp: state.activeApp,
    plan
  });
}
function addApp() {
  saveActiveAppFromUI();
  let i = 1; while (state.apps[`app${i}`]) i += 1;
  const name = `app${i}`;
  state.apps[name] = defaultAppData();
  state.activeApp = name;
  renderAppRows();
  appToUI(state.apps[name]);
  applyAdvancedFieldsToUI(state.apps[name]);
  generateYaml();
}
function removeApp(name) {
  delete state.apps[name];
  const names = Object.keys(state.apps);
  if (!names.length) { addApp(); return; }
  if (state.activeApp === name) state.activeApp = names[0];
  renderAppRows();
  appToUI(state.apps[state.activeApp]);
  applyAdvancedFieldsToUI(state.apps[state.activeApp]);
  generateYaml();
}
function renameApp(oldName, newName) {
  if (isBlank(newName) || oldName === newName) { renderAppRows(); return; }
  if (state.apps[newName]) { alert(`Application already exists: ${newName}`); renderAppRows(); return; }
  saveActiveAppFromUI();
  state.apps[newName] = state.apps[oldName];
  delete state.apps[oldName];
  if (state.activeApp === oldName) state.activeApp = newName;
  renderAppRows();
  generateYaml();
}
function switchApp(name) {
  if (!state.apps[name]) return;
  saveActiveAppFromUI();
  state.activeApp = name;
  appToUI(state.apps[name]);
  applyAdvancedFieldsToUI(state.apps[name]);
  renderAppRows();
  generateYaml();
}

function checkRowTemplate() { return `<tr><td><select class="c-type"><option value="bodyContains">bodyContains</option><option value="regex">regex</option><option value="jsonPathExists">jsonPathExists</option><option value="jsonPathEquals">jsonPathEquals</option><option value="headerExists">headerExists</option><option value="headerEquals">headerEquals</option><option value="bodyLengthGt">bodyLengthGt</option><option value="jmesPathExists">jmesPathExists</option><option value="jmesPathEquals">jmesPathEquals</option><option value="statusIn">statusIn</option></select></td><td><input class="c-path" placeholder="$.id or Header-Name"/></td><td><input class="c-value" placeholder="value / regex / 200,201"/></td><td><button class="danger rm-c">Remove</button></td></tr>`; }
function captureRowTemplate() { return `<tr><td><select class="cap-type"><option value="jsonPath">jsonPath</option><option value="header">header</option><option value="regex">regex</option></select></td><td><input class="cap-path" placeholder="$.id / Header-Name / regex"/></td><td><input class="cap-save" placeholder="savedId"/></td><td><button class="danger rm-cap">Remove</button></td></tr>`; }
function parseChecks(t) {
  const out = [];
  t.querySelectorAll("tr").forEach((r) => {
    const type = (r.querySelector(".c-type") || {}).value || "";
    const path = ((r.querySelector(".c-path") || {}).value || "").trim();
    const value = ((r.querySelector(".c-value") || {}).value || "").trim();
    if (!isBlank(type)) { const c = { type }; if (!isBlank(path)) c.path = path; if (!isBlank(value)) c.value = value; out.push(c); }
  });
  return out;
}
function parseCaptures(t) {
  const out = [];
  t.querySelectorAll("tr").forEach((r) => {
    const type = (r.querySelector(".cap-type") || {}).value || "";
    const path = ((r.querySelector(".cap-path") || {}).value || "").trim();
    const saveAs = ((r.querySelector(".cap-save") || {}).value || "").trim();
    if (!isBlank(type) && !isBlank(path) && !isBlank(saveAs)) out.push({ type, path, saveAs });
  });
  return out;
}
function injectRowTemplate(name, p) {
  return `<tr><td><input class="ip-name" value="${name}"/></td><td><select class="ip-type"><option value="rampUsers">rampUsers</option><option value="pacedUsers">pacedUsers</option><option value="atOnceUsers">atOnceUsers</option><option value="constantUsersPerSec">constantUsersPerSec</option><option value="rampUsersPerSec">rampUsersPerSec</option><option value="incrementUsersPerSec">incrementUsersPerSec</option><option value="constantConcurrentUsers">constantConcurrentUsers</option><option value="rampConcurrentUsers">rampConcurrentUsers</option></select></td><td><input class="ip-users" type="number" value="${p.users || ""}"/></td><td><input class="ip-ramp" type="number" value="${p.rampDurationSec || ""}"/></td><td><input class="ip-duration" type="number" value="${p.durationSec || ""}"/></td><td><input class="ip-pace" type="number" value="${p.paceMs || ""}"/></td><td><input class="ip-rate" type="number" step="0.01" value="${p.rate || ""}"/></td><td><input class="ip-from" type="number" step="0.01" value="${p.fromRps || ""}"/></td><td><input class="ip-to" type="number" step="0.01" value="${p.toRps || ""}"/></td><td><input class="ip-start" type="number" step="0.01" value="${p.startRate || ""}"/></td><td><input class="ip-increment" type="number" step="0.01" value="${p.incrementBy || ""}"/></td><td><input class="ip-level-count" type="number" value="${p.levelCount || ""}"/></td><td><input class="ip-level-sec" type="number" value="${p.levelDurationSec || ""}"/></td><td><input class="ip-from-users" type="number" value="${p.fromUsers || ""}"/></td><td><input class="ip-to-users" type="number" value="${p.toUsers || ""}"/></td><td><button class="danger ip-rm">Remove</button></td></tr>`;
}
function addInjectionRow(defaultName, p) {
  const name = defaultName || `profile_${injectRowsBody.querySelectorAll("tr").length + 1}`;
  const profile = p || { injectionType: "rampUsers", users: 10, rampDurationSec: 30 };
  const t = document.createElement("tbody");
  t.innerHTML = injectRowTemplate(name, profile);
  const row = t.firstElementChild;
  row.querySelector(".ip-type").value = profile.injectionType || "rampUsers";
  row.querySelector(".ip-rm").addEventListener("click", () => { row.remove(); refreshScenarioProfileOptions(); });
  row.querySelector(".ip-name").addEventListener("change", refreshScenarioProfileOptions);
  injectRowsBody.appendChild(row);
  refreshScenarioProfileOptions();
}
function parseInjectionProfiles() {
  const out = {};
  const seen = new Set();
  injectRowsBody.querySelectorAll("tr").forEach((r) => {
    const name = (r.querySelector(".ip-name").value || "").trim();
    if (isBlank(name)) return;
    if (seen.has(name)) throw new Error(`Duplicate injection profile name: ${name}`);
    seen.add(name);
    const p = { injectionType: r.querySelector(".ip-type").value };
    const users = Number(r.querySelector(".ip-users").value || 0);
    const ramp = Number(r.querySelector(".ip-ramp").value || 0);
    const duration = Number(r.querySelector(".ip-duration").value || 0);
    const pace = Number(r.querySelector(".ip-pace").value || 0);
    const rate = Number(r.querySelector(".ip-rate").value || 0);
    const from = Number(r.querySelector(".ip-from").value || 0);
    const to = Number(r.querySelector(".ip-to").value || 0);
    const startRaw = (r.querySelector(".ip-start").value || "").trim();
    const start = Number(startRaw || 0);
    const inc = Number(r.querySelector(".ip-increment").value || 0);
    const levelCount = Number(r.querySelector(".ip-level-count").value || 0);
    const levelSec = Number(r.querySelector(".ip-level-sec").value || 0);
    const fromUsers = Number(r.querySelector(".ip-from-users").value || 0);
    const toUsers = Number(r.querySelector(".ip-to-users").value || 0);
    if (users > 0) p.users = users;
    if (ramp > 0) p.rampDurationSec = ramp;
    if (duration > 0) p.durationSec = duration;
    if (pace > 0) p.paceMs = pace;
    if (rate > 0) p.rate = rate;
    if (from > 0) p.fromRps = from;
    if (to > 0) p.toRps = to;
    if (startRaw !== "" && start >= 0) p.startRate = start;
    if (inc > 0) p.incrementBy = inc;
    if (levelCount > 0) p.levelCount = levelCount;
    if (levelSec > 0) p.levelDurationSec = levelSec;
    if (fromUsers > 0) p.fromUsers = fromUsers;
    if (toUsers > 0) p.toUsers = toUsers;
    out[name] = p;
  });
  return out;
}
function listProfileNames() {
  return [...injectRowsBody.querySelectorAll("tr .ip-name")]
    .map((x) => (x.value || "").trim())
    .filter((x) => !isBlank(x));
}
function refreshScenarioProfileOptions() {
  const names = listProfileNames();
  document.querySelectorAll(".profile-ref").forEach((sel) => {
    const curr = sel.value;
    sel.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join("");
    if (curr && names.includes(curr)) sel.value = curr;
    else if (names.length) sel.value = names[0];
  });
}
function endpointTemplate(n) {
  return `<div class="endpoint">
    <div class="row"><h3>API ${n}</h3><button class="danger rm-step">Remove API</button></div>
    <div class="endpoint-summary"></div>
    <div class="grid">
      <div><label>Name</label><input class="name" value="API ${n}"/></div>
      <div><label>Method</label><select class="method"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option><option>OPTIONS</option></select></div>
      <div><label>Path</label><input class="path" value="/posts/${n}"/></div>
      <div class="mode-basic-hide"><label>Absolute URL</label><input class="url" placeholder="optional override"/></div>
      <div><label>Expected Status</label><input class="status" type="number" value="200"/></div>
      <div class="mode-basic-hide"><label>Retry Count</label><input class="retry" type="number" value="0" min="0"/></div>
      <div class="mode-basic-hide"><label>Pause (ms)</label><input class="pause" type="number" value="200"/></div>
    </div>
    <div class="section-chips">
      <button type="button" class="ghost show-payload">Payload</button>
      <button type="button" class="ghost add-q">Query Param</button>
      <button type="button" class="ghost add-h">Header</button>
      <button type="button" class="ghost add-c">Check</button>
      <button type="button" class="ghost show-auth mode-basic-hide">Auth</button>
      <button type="button" class="ghost show-request mode-basic-hide">Request Options</button>
      <button type="button" class="ghost show-branching mode-basic-hide">Branching</button>
      <button type="button" class="ghost add-f mode-basic-hide">Form Param</button>
      <button type="button" class="ghost add-u mode-basic-hide">Upload</button>
      <button type="button" class="ghost add-cap mode-basic-hide">Capture</button>
    </div>
    <details class="ep-section sec-request is-hidden mode-basic-hide"><summary>Request Options</summary><div><div class="grid"><div><label>Request Timeout (ms)</label><input class="timeout" type="number" value="" min="1"/></div><div><label><input class="disable-follow-redirect" type="checkbox"/> Disable Follow Redirect</label></div><div><label><input class="disable-url-encoding" type="checkbox"/> Disable URL Encoding</label></div><div><label><input class="silent-step" type="checkbox"/> Silent Request</label></div><div><label><input class="ignore-protocol-headers" type="checkbox"/> Ignore Protocol Headers</label></div><div class="mode-expert-only"><label>Custom Hook Class</label><input class="custom-hook-ref" placeholder="com.example.gatling.extensions.MyHook"/></div><div class="mode-expert-only"><label>Custom Hook Name (Generated)</label><input class="custom-hook-name" placeholder="StepLoginHook"/></div></div><label class="mode-expert-only">Custom Hook Java Code (before step)</label><textarea class="custom-hook-code mode-expert-only" placeholder="session = session.set(&quot;tokenSeed&quot;, java.util.UUID.randomUUID().toString());"></textarea></div></details>
    <details class="ep-section sec-auth is-hidden mode-basic-hide"><summary>Auth</summary><div><div class="grid"><div><label>Step Auth Type</label><select class="step-auth-type"><option value="">none</option><option value="bearer">bearer</option><option value="basic">basic</option><option value="header">header</option></select></div><div><label>Auth Param 1</label><input class="step-auth-p1" placeholder="token env / username env / header value env"/></div><div><label>Auth Param 2</label><input class="step-auth-p2" placeholder="password env"/></div><div><label>Header Name</label><input class="step-auth-header" placeholder="x-api-key"/></div></div></div></details>
    <details class="ep-section sec-payload is-hidden"><summary>Payload</summary><div><div class="grid"><div class="mode-basic-hide"><label>Body Type</label><select class="body-type"><option value="">auto/json</option><option value="json">json</option><option value="xml">xml</option><option value="text">text</option><option value="form">form</option><option value="multipart">multipart</option></select></div><div class="mode-basic-hide"><label>Body File</label><input class="body-file" placeholder="src/test/resources/bodies/request.json"/></div></div><div><label>Body (supports #{var})</label><textarea class="body"></textarea></div><div class="row mode-basic-hide"><label>Form Params</label><button class="ghost add-f" type="button">Add Form Param</button></div><table class="mode-basic-hide"><thead><tr><th>Name</th><th>Value</th><th>Action</th></tr></thead><tbody class="step-f"></tbody></table><div class="row mode-basic-hide"><label>Multipart Uploads</label><button class="ghost add-u" type="button">Add Upload</button></div><table class="mode-basic-hide"><thead><tr><th>Field Name</th><th>File Path</th><th>Action</th></tr></thead><tbody class="step-u"></tbody></table></div></details>
    <details class="ep-section sec-branching is-hidden mode-basic-hide"><summary>Branching And Fallback</summary><div><div class="small">Use branch rules to override the request when a saved session variable matches custom logic. The fallback request runs when no branch matches.</div><div class="row"><label>Branch Rules</label><button class="ghost add-branch" type="button">Add Branch Rule</button></div><table><thead><tr><th>Name</th><th>Variable</th><th>Operator</th><th>Value</th><th>Values CSV</th><th>Method</th><th>Path</th><th>Absolute URL</th><th>Status</th><th>Action</th></tr></thead><tbody class="step-branches"></tbody></table><div class="grid" style="margin-top:12px;"><div><label>Legacy Condition Variable</label><input class="cond-var" placeholder="savedVar"/></div><div><label>Legacy Condition Equals</label><input class="cond-eq" placeholder="expectedValue"/></div><div><label>Fallback Method</label><select class="else-method"><option value="">inherit/skip</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option><option>OPTIONS</option></select></div><div><label>Fallback Path</label><input class="else-path" placeholder="/fallback/path"/></div><div><label>Fallback Expected Status</label><input class="else-status" type="number" value=""/></div></div><div><label>Fallback Body</label><textarea class="else-body"></textarea></div></div></details>
    <details class="ep-section sec-headers is-hidden"><summary>Headers</summary><div><div class="row"><label>Per API Headers</label><button class="ghost add-h" type="button">Add Header</button></div><table><thead><tr><th>Key</th><th>Value</th><th>Action</th></tr></thead><tbody class="step-h"></tbody></table></div></details>
    <details class="ep-section sec-query is-hidden"><summary>Query Params</summary><div><div class="row"><label>Query Params</label><button class="ghost add-q" type="button">Add Query Param</button></div><table><thead><tr><th>Name</th><th>Value</th><th>Action</th></tr></thead><tbody class="step-q"></tbody></table></div></details>
    <details class="ep-section sec-checks is-hidden"><summary>Checks</summary><div><div class="row"><label>Checks</label><button class="ghost add-c" type="button">Add Check</button></div><table><thead><tr><th>Type</th><th>Path</th><th>Value</th><th>Action</th></tr></thead><tbody class="step-c"></tbody></table></div></details>
    <details class="ep-section sec-captures is-hidden mode-basic-hide"><summary>Captures</summary><div><div class="row"><label>Captures</label><button class="ghost add-cap" type="button">Add Capture</button></div><table><thead><tr><th>Type</th><th>Path</th><th>SaveAs</th><th>Action</th></tr></thead><tbody class="step-cap"></tbody></table></div></details>
  </div>`;
}
function scenarioTemplate(n) {
  return `<div class="scenario"><div class="row"><h3>Scenario ${n}</h3><button class="danger rm-scn">Remove Scenario</button></div><div class="grid"><div><label>Name</label><input class="scn-name" value="Scenario ${n}"/></div><div><label>Injection Profile</label><select class="profile-ref"></select></div><div class="mode-basic-hide"><label>Repeat Count</label><input class="flow-repeat" type="number" min="0" value="0"/></div><div class="mode-basic-hide"><label>During Sec</label><input class="flow-during" type="number" min="0" value="0"/></div><div class="mode-expert-only"><label>AsLongAs Variable</label><input class="flow-as-var" placeholder="savedVar"/></div><div class="mode-expert-only"><label>AsLongAs Equals</label><input class="flow-as-eq" placeholder="continue"/></div><div class="mode-basic-hide"><label>Exit on Fail</label><select class="flow-exit"><option value="false">false</option><option value="true">true</option></select></div><div><label>Feeder Type</label><select class="feeder-type"><option value="">none</option><option value="csv">csv</option></select></div><div><label>Feeder File</label><input class="feeder-file" value="data/users.csv"/></div><div class="mode-basic-hide"><label>Feeder Mode</label><select class="feeder-mode"><option value="queue">queue</option><option value="circular">circular</option><option value="random">random</option></select></div></div><div class="btns"><button class="add-step">Add API In Scenario</button></div><div class="steps"></div></div>`;
}
function addEndpoint(container, data) {
  const n = container.children.length + 1;
  const d = document.createElement("div"); d.innerHTML = endpointTemplate(n); const node = d.firstElementChild;
  node.querySelector(".rm-step").addEventListener("click", () => node.remove());
  const h = node.querySelector(".step-h"), qParams = node.querySelector(".step-q"), formParams = node.querySelector(".step-f"), uploads = node.querySelector(".step-u"), c = node.querySelector(".step-c"), cap = node.querySelector(".step-cap"), branches = node.querySelector(".step-branches");
  node.querySelector(".show-request").addEventListener("click", () => ensureEndpointSection(node, "request"));
  node.querySelector(".show-auth").addEventListener("click", () => ensureEndpointSection(node, "auth"));
  node.querySelector(".show-payload").addEventListener("click", () => ensureEndpointSection(node, "payload"));
  node.querySelector(".show-branching").addEventListener("click", () => ensureEndpointSection(node, "branching"));
  node.querySelectorAll(".add-branch").forEach((btn) => btn.addEventListener("click", () => { ensureEndpointSection(node, "branching"); addBranchRow(branches, {}, () => updateEndpointSummary(node)); updateEndpointSummary(node); }));
  node.querySelectorAll(".add-h").forEach((btn) => btn.addEventListener("click", () => { ensureEndpointSection(node, "headers"); addHeaderRow(h); updateEndpointSummary(node); }));
  node.querySelectorAll(".add-q").forEach((btn) => btn.addEventListener("click", () => { ensureEndpointSection(node, "query"); addKeyValueRow(qParams, "q-key", "q-val", "tenant", "#{tenant}"); updateEndpointSummary(node); }));
  node.querySelectorAll(".add-f").forEach((btn) => btn.addEventListener("click", () => { ensureEndpointSection(node, "payload"); addKeyValueRow(formParams, "f-key", "f-val", "status", "ACTIVE"); updateEndpointSummary(node); }));
  node.querySelectorAll(".add-u").forEach((btn) => btn.addEventListener("click", () => { ensureEndpointSection(node, "payload"); addUploadRow(uploads); updateEndpointSummary(node); }));
  node.querySelectorAll(".add-c").forEach((btn) => btn.addEventListener("click", () => { ensureEndpointSection(node, "checks"); const x = document.createElement("tbody"); x.innerHTML = checkRowTemplate(); const r = x.firstElementChild; r.querySelector(".rm-c").addEventListener("click", () => { r.remove(); updateEndpointSummary(node); }); c.appendChild(r); updateEndpointSummary(node); }));
  node.querySelectorAll(".add-cap").forEach((btn) => btn.addEventListener("click", () => { ensureEndpointSection(node, "captures"); const x = document.createElement("tbody"); x.innerHTML = captureRowTemplate(); const r = x.firstElementChild; r.querySelector(".rm-cap").addEventListener("click", () => { r.remove(); updateEndpointSummary(node); }); cap.appendChild(r); updateEndpointSummary(node); }));
  if (data) {
    node.querySelector(".name").value = data.name || ""; node.querySelector(".method").value = data.method || "GET"; node.querySelector(".path").value = data.path || ""; node.querySelector(".url").value = data.url || ""; node.querySelector(".status").value = data.expectedStatus || 200; node.querySelector(".retry").value = data.retryCount || 0; node.querySelector(".pause").value = data.pauseMs || 0; node.querySelector(".timeout").value = data.requestTimeoutMs || ""; node.querySelector(".custom-hook-ref").value = data.customHookRef || ""; node.querySelector(".custom-hook-name").value = data.customHookName || ""; node.querySelector(".custom-hook-code").value = data.customHookCode || ""; node.querySelector(".body-type").value = data.bodyType || ""; node.querySelector(".body-file").value = data.bodyFile || ""; node.querySelector(".cond-var").value = data.condition ? data.condition.variable || "" : ""; node.querySelector(".cond-eq").value = data.condition ? (data.condition.value || data.condition.equals || "") : ""; node.querySelector(".else-method").value = data.elseMethod || ""; node.querySelector(".else-path").value = data.elsePath || ""; node.querySelector(".else-status").value = data.elseExpectedStatus == null ? "" : data.elseExpectedStatus; node.querySelector(".body").value = data.body || ""; node.querySelector(".else-body").value = data.elseBody || ""; node.querySelector(".step-auth-type").value = data.auth ? data.auth.type || "" : ""; node.querySelector(".step-auth-p1").value = data.auth ? data.auth.tokenEnv || data.auth.usernameEnv || data.auth.headerValueEnv || "" : ""; node.querySelector(".step-auth-p2").value = data.auth ? data.auth.passwordEnv || "" : ""; node.querySelector(".step-auth-header").value = data.auth ? data.auth.headerName || "" : ""; node.querySelector(".disable-follow-redirect").checked = data.disableFollowRedirect === true; node.querySelector(".disable-url-encoding").checked = data.disableUrlEncoding === true; node.querySelector(".silent-step").checked = data.silent === true; node.querySelector(".ignore-protocol-headers").checked = data.ignoreProtocolHeaders === true;
    Object.keys(data.headers || {}).forEach((k) => addHeaderRow(h, k, data.headers[k]));
    Object.keys(data.queryParams || {}).forEach((k) => addKeyValueRow(qParams, "q-key", "q-val", "tenant", "#{tenant}", k, data.queryParams[k]));
    Object.keys(data.formParams || {}).forEach((k) => addKeyValueRow(formParams, "f-key", "f-val", "status", "ACTIVE", k, data.formParams[k]));
    (data.formUploads || []).forEach((x) => addUploadRow(uploads, x.fieldName || "", x.filePath || ""));
    (data.branches || []).forEach((x) => addBranchRow(branches, x, () => updateEndpointSummary(node)));
    (data.checks || []).forEach((x) => { const t = document.createElement("tbody"); t.innerHTML = checkRowTemplate(); const r = t.firstElementChild; r.querySelector(".c-type").value = x.type || "bodyContains"; r.querySelector(".c-path").value = x.path || ""; r.querySelector(".c-value").value = x.value || ""; r.querySelector(".rm-c").addEventListener("click", () => r.remove()); c.appendChild(r); });
    (data.captures || []).forEach((x) => { const t = document.createElement("tbody"); t.innerHTML = captureRowTemplate(); const r = t.firstElementChild; r.querySelector(".cap-type").value = x.type || "jsonPath"; r.querySelector(".cap-path").value = x.path || ""; r.querySelector(".cap-save").value = x.saveAs || ""; r.querySelector(".rm-cap").addEventListener("click", () => r.remove()); cap.appendChild(r); });
  }
  node.addEventListener("input", () => refreshEndpointLayout(node));
  node.addEventListener("change", () => refreshEndpointLayout(node));
  node.addEventListener("click", (e) => {
    if (e.target && e.target.closest(".rm-h, .rm-kv, .rm-upload, .rm-c, .rm-cap")) {
      setTimeout(() => refreshEndpointLayout(node), 0);
    }
  });
  refreshEndpointLayout(node);
  applyModeToScenario(node);
  container.appendChild(node);
}
function addScenario(data) {
  const n = scenariosEl.children.length + 1;
  const d = document.createElement("div"); d.innerHTML = scenarioTemplate(n); const node = d.firstElementChild;
  node.querySelector(".rm-scn").addEventListener("click", () => node.remove());
  const steps = node.querySelector(".steps");
  node.querySelector(".add-step").addEventListener("click", () => addEndpoint(steps));
  const names = listProfileNames();
  node.querySelector(".profile-ref").innerHTML = names.map((x) => `<option value="${x}">${x}</option>`).join("");
  if (data) {
    node.querySelector(".scn-name").value = data.name || "";
    if (data.load && data.load.profileRef) node.querySelector(".profile-ref").value = data.load.profileRef;
    node.querySelector(".flow-repeat").value = data.flow && data.flow.repeatCount ? data.flow.repeatCount : 0;
    node.querySelector(".flow-during").value = data.flow && data.flow.duringSec ? data.flow.duringSec : 0;
    node.querySelector(".flow-exit").value = data.flow && data.flow.exitOnFail ? "true" : "false";
    if (data.feeder) { node.querySelector(".feeder-type").value = "csv"; node.querySelector(".feeder-file").value = data.feeder.file || ""; node.querySelector(".feeder-mode").value = data.feeder.mode || "queue"; }
    (data.steps || []).forEach((s) => addEndpoint(steps, s));
  } else addEndpoint(steps);
  if (!node.querySelector(".profile-ref").value) {
    if (names.length) node.querySelector(".profile-ref").value = names[0];
  }
  applyModeToScenario(node);
  scenariosEl.appendChild(node);
}

function envRowTemplate(name, env, active) {
  const auth = env.auth || {};
  return `<tr><td><input class="env-enabled" type="checkbox" ${env.enabled !== false ? "checked" : ""} /></td><td><input class="env-active" type="radio" name="activeEnv" ${active ? "checked" : ""} /></td><td><input class="env-name" value="${name}" /></td><td><input class="env-base" value="${env.baseUrl || ""}" /></td><td><select class="env-auth-type"><option value="">none</option><option value="bearer">bearer</option><option value="basic">basic</option><option value="header">header</option></select></td><td><input class="env-auth-p1" value="${auth.tokenEnv || auth.usernameEnv || auth.headerValueEnv || "API_TOKEN"}" /></td><td><input class="env-auth-p2" value="${auth.passwordEnv || ""}" /></td><td><input class="env-auth-header" value="${auth.headerName || "x-api-key"}" /></td><td><textarea class="env-headers">${JSON.stringify(env.defaultHeaders || {})}</textarea></td><td><input class="env-tls-enabled" type="checkbox" ${env.tls && env.tls.enabled ? "checked" : ""}/></td><td><input class="env-keystore" value="${env.tls ? env.tls.keyStorePath || "" : ""}" /></td><td><input class="env-truststore" value="${env.tls ? env.tls.trustStorePath || "" : ""}" /></td><td><button class="danger env-rm">Remove</button></td></tr>`;
}
function addEnvironmentRow(defaultName) {
  const name = defaultName || `env${envRowsBody.querySelectorAll("tr").length + 1}`;
  const env = { enabled: true, baseUrl: "", defaultHeaders: {} };
  const h = document.createElement("tbody");
  h.innerHTML = envRowTemplate(name, env, !envRowsBody.querySelector("tr"));
  const row = h.firstElementChild;
  row.querySelector(".env-rm").addEventListener("click", () => row.remove());
  envRowsBody.appendChild(row);
}

function parseEnvHeaders(txt, appName, envName) {
  if (isBlank(txt)) return {};
  try { const o = JSON.parse(txt); return o && typeof o === "object" ? o : {}; }
  catch (_) { throw new Error(`Invalid env headers JSON for ${appName}/${envName}`); }
}

function appFromUI() {
  const service = { baseUrl: q("baseUrl").value.trim(), defaultHeaders: parseHeaders(globalHeadersBody) };
  const authType = q("authType").value;
  let serviceAuth = null;
  if (authType === "bearer") serviceAuth = { type: "bearer", tokenEnv: q("tokenEnv").value.trim() || "API_TOKEN" };
  if (authType === "basic") serviceAuth = { type: "basic", usernameEnv: q("authUsernameEnv").value.trim() || "API_USER", passwordEnv: q("authPasswordEnv").value.trim() || "API_PASSWORD" };
  if (authType === "header") serviceAuth = { type: "header", headerName: q("authHeaderName").value.trim() || "x-api-key", headerValueEnv: q("authHeaderValueEnv").value.trim() || "API_KEY" };
  if (serviceAuth) {
    service.auth = serviceAuth;
  }
  if (q("tlsEnabled").value === "true") {
    service.tls = {
      enabled: true,
      keyStorePath: q("keyStorePath").value.trim(),
      keyStoreType: q("keyStoreType").value.trim() || "PKCS12",
      keyStorePasswordEnv: q("keyStorePasswordEnv").value.trim(),
      trustStorePath: q("trustStorePath").value.trim(),
      trustStoreType: q("trustStoreType").value.trim() || "JKS",
      trustStorePasswordEnv: q("trustStorePasswordEnv").value.trim(),
      insecureSkipTlsVerify: q("insecureSkipTlsVerify").value === "true"
    };
  }
  const environments = {};
  let activeEnvironment = "";
  const envNames = new Set();
  [...envRowsBody.querySelectorAll("tr")].forEach((row) => {
    const n = row.querySelector(".env-name").value.trim();
    if (isBlank(n)) return;
    if (envNames.has(n)) throw new Error(`Duplicate environment name: ${n}`);
    envNames.add(n);
    const env = { enabled: row.querySelector(".env-enabled").checked, baseUrl: row.querySelector(".env-base").value.trim(), defaultHeaders: parseEnvHeaders(row.querySelector(".env-headers").value, state.activeApp || "app", n) };
    const envAuth = buildAuth(
      row.querySelector(".env-auth-type").value,
      row.querySelector(".env-auth-p1").value,
      row.querySelector(".env-auth-p2").value,
      row.querySelector(".env-auth-header").value
    );
    if (envAuth) env.auth = envAuth;
    if (row.querySelector(".env-tls-enabled").checked) env.tls = { enabled: true, keyStorePath: row.querySelector(".env-keystore").value.trim(), trustStorePath: row.querySelector(".env-truststore").value.trim() };
    environments[n] = env;
    if (row.querySelector(".env-active").checked) activeEnvironment = n;
  });
  if (isBlank(activeEnvironment) && Object.keys(environments).length) activeEnvironment = Object.keys(environments)[0];
  const injectionProfiles = parseInjectionProfiles();

  const scenarios = [...scenariosEl.querySelectorAll(".scenario")].map((s) => {
    const profileRef = (s.querySelector(".profile-ref").value || "").trim();
    const prof = injectionProfiles[profileRef];
    const sc = { name: s.querySelector(".scn-name").value.trim(), load: { profileRef }, flow: {}, steps: [] };
    if (prof) Object.keys(prof).forEach((k) => { sc.load[k] = prof[k]; });
    const flowRepeat = Number(s.querySelector(".flow-repeat").value || 0);
    const flowDuring = Number(s.querySelector(".flow-during").value || 0);
    const flowExit = s.querySelector(".flow-exit").value === "true";
    if (flowRepeat > 0) sc.flow.repeatCount = flowRepeat;
    if (flowDuring > 0) sc.flow.duringSec = flowDuring;
    if (flowExit) sc.flow.exitOnFail = true;
    if (!Object.keys(sc.flow).length) delete sc.flow;
    if (s.querySelector(".feeder-type").value === "csv") sc.feeder = { type: "csv", file: s.querySelector(".feeder-file").value.trim(), mode: s.querySelector(".feeder-mode").value.trim() || "queue" };
    sc.steps = [...s.querySelectorAll(".endpoint")].map((e) => {
      const st = { name: e.querySelector(".name").value.trim(), method: e.querySelector(".method").value.trim(), path: e.querySelector(".path").value.trim(), headers: parseHeaders(e.querySelector(".step-h")), body: e.querySelector(".body").value.trim(), expectedStatus: Number(e.querySelector(".status").value), retryCount: Number(e.querySelector(".retry").value || 0), pauseMs: Number(e.querySelector(".pause").value || 0) };
      const url = e.querySelector(".url").value.trim();
      const bodyFile = e.querySelector(".body-file").value.trim();
      const bodyType = e.querySelector(".body-type").value.trim();
      const customHookRef = (e.querySelector(".custom-hook-ref").value || "").trim();
      const customHookName = (e.querySelector(".custom-hook-name").value || "").trim();
      const customHookCode = (e.querySelector(".custom-hook-code").value || "");
      const requestTimeoutMs = Number(e.querySelector(".timeout").value || 0);
      const queryParams = parseKeyValueRows(e.querySelector(".step-q"), "q-key", "q-val");
      const formParams = parseKeyValueRows(e.querySelector(".step-f"), "f-key", "f-val");
      const formUploads = parseUploads(e.querySelector(".step-u"));
      if (!isBlank(url)) st.url = url;
      if (!isBlank(bodyFile)) st.bodyFile = bodyFile;
      if (!isBlank(bodyType)) st.bodyType = bodyType;
      if (!isBlank(customHookRef)) st.customHookRef = customHookRef;
      if (!isBlank(customHookName)) st.customHookName = customHookName;
      if (!isBlank(customHookCode)) st.customHookCode = customHookCode;
      if (requestTimeoutMs > 0) st.requestTimeoutMs = requestTimeoutMs;
      if (Object.keys(queryParams).length) st.queryParams = queryParams;
      if (Object.keys(formParams).length) st.formParams = formParams;
      if (formUploads.length) st.formUploads = formUploads;
      if (e.querySelector(".disable-follow-redirect").checked) st.disableFollowRedirect = true;
      if (e.querySelector(".disable-url-encoding").checked) st.disableUrlEncoding = true;
      if (e.querySelector(".silent-step").checked) st.silent = true;
      if (e.querySelector(".ignore-protocol-headers").checked) st.ignoreProtocolHeaders = true;
      const stepAuth = buildAuth(
        e.querySelector(".step-auth-type").value,
        e.querySelector(".step-auth-p1").value,
        e.querySelector(".step-auth-p2").value,
        e.querySelector(".step-auth-header").value
      );
      if (stepAuth) st.auth = stepAuth;
      const cVar = (e.querySelector(".cond-var").value || "").trim();
      const cEq = (e.querySelector(".cond-eq").value || "").trim();
      if (!isBlank(cVar) && !isBlank(cEq)) st.condition = { variable: cVar, equals: cEq };
      const branches = parseBranches(e.querySelector(".step-branches"));
      if (branches.length) st.branches = branches;
      const checks = parseChecks(e.querySelector(".step-c"));
      const caps = parseCaptures(e.querySelector(".step-cap"));
      if (checks.length) st.checks = checks;
      if (caps.length) st.captures = caps;
      return st;
    });
    return sc;
  });
  const p90 = Number(q("p90").value || 0);
  const p99 = Number(q("p99").value || 0);
  const maxFailed = Number(q("maxFailed").value || 0);
  const minRps = Number(q("minRps").value || 0);
  return {
    enabled: state.apps[state.activeApp] ? state.apps[state.activeApp].enabled !== false : true,
    service,
    environments,
    activeEnvironment,
    injectionProfiles,
    assertions: {
      minSuccessPercent: Number(q("minSuccess").value),
      maxResponseTimeMs: Number(q("maxRt").value),
      p90ResponseTimeMs: p90 > 0 ? p90 : null,
      p95ResponseTimeMs: Number(q("p95").value),
      p99ResponseTimeMs: p99 > 0 ? p99 : null,
      maxFailedRequests: maxFailed > 0 ? maxFailed : null,
      minRequestsPerSec: minRps > 0 ? minRps : null
    },
    scenarios
  };
}

function appToUI(app) {
  if (activeAppLabel) activeAppLabel.textContent = `Editing details for: ${state.activeApp || "-"}`;
  q("baseUrl").value = app.service.baseUrl || "";
  q("authType").value = app.service.auth ? app.service.auth.type || "bearer" : "";
  q("tokenEnv").value = app.service.auth ? app.service.auth.tokenEnv || "API_TOKEN" : "API_TOKEN";
  q("authUsernameEnv").value = app.service.auth ? app.service.auth.usernameEnv || "API_USER" : "API_USER";
  q("authPasswordEnv").value = app.service.auth ? app.service.auth.passwordEnv || "API_PASSWORD" : "API_PASSWORD";
  q("authHeaderName").value = app.service.auth ? app.service.auth.headerName || "x-api-key" : "x-api-key";
  q("authHeaderValueEnv").value = app.service.auth ? app.service.auth.headerValueEnv || "API_KEY" : "API_KEY";
  q("tlsEnabled").value = app.service.tls && app.service.tls.enabled ? "true" : "false";
  q("keyStorePath").value = app.service.tls ? app.service.tls.keyStorePath || "" : "";
  q("keyStoreType").value = app.service.tls ? app.service.tls.keyStoreType || "PKCS12" : "PKCS12";
  q("keyStorePasswordEnv").value = app.service.tls ? app.service.tls.keyStorePasswordEnv || "KEYSTORE_PASSWORD" : "KEYSTORE_PASSWORD";
  q("trustStorePath").value = app.service.tls ? app.service.tls.trustStorePath || "" : "";
  q("trustStoreType").value = app.service.tls ? app.service.tls.trustStoreType || "JKS" : "JKS";
  q("trustStorePasswordEnv").value = app.service.tls ? app.service.tls.trustStorePasswordEnv || "TRUSTSTORE_PASSWORD" : "TRUSTSTORE_PASSWORD";
  q("insecureSkipTlsVerify").value = app.service.tls && app.service.tls.insecureSkipTlsVerify ? "true" : "false";
  q("minSuccess").value = app.assertions ? app.assertions.minSuccessPercent : 99;
  q("maxRt").value = app.assertions ? app.assertions.maxResponseTimeMs : 2000;
  q("p90").value = app.assertions && app.assertions.p90ResponseTimeMs ? app.assertions.p90ResponseTimeMs : 0;
  q("p95").value = app.assertions ? app.assertions.p95ResponseTimeMs : 1200;
  q("p99").value = app.assertions && app.assertions.p99ResponseTimeMs ? app.assertions.p99ResponseTimeMs : 0;
  q("maxFailed").value = app.assertions && app.assertions.maxFailedRequests ? app.assertions.maxFailedRequests : 0;
  q("minRps").value = app.assertions && app.assertions.minRequestsPerSec ? app.assertions.minRequestsPerSec : 0;

  globalHeadersBody.innerHTML = "";
  Object.keys(app.service.defaultHeaders || {}).forEach((k) => addHeaderRow(globalHeadersBody, k, app.service.defaultHeaders[k]));
  if (!globalHeadersBody.querySelector("tr")) { addHeaderRow(globalHeadersBody, "Accept", "application/json"); addHeaderRow(globalHeadersBody, "Content-Type", "application/json"); }

  envRowsBody.innerHTML = "";
  const envNames = Object.keys(app.environments || {});
  if (!envNames.length) addEnvironmentRow();
  else envNames.forEach((n, idx) => {
    const h = document.createElement("tbody");
    h.innerHTML = envRowTemplate(n, app.environments[n], n === app.activeEnvironment || (!app.activeEnvironment && idx === 0));
    const row = h.firstElementChild;
    row.querySelector(".env-auth-type").value = app.environments[n].auth ? app.environments[n].auth.type || "bearer" : "";
    row.querySelector(".env-auth-p1").value = app.environments[n].auth ? app.environments[n].auth.tokenEnv || app.environments[n].auth.usernameEnv || app.environments[n].auth.headerValueEnv || "API_TOKEN" : "API_TOKEN";
    row.querySelector(".env-auth-p2").value = app.environments[n].auth ? app.environments[n].auth.passwordEnv || "" : "";
    row.querySelector(".env-auth-header").value = app.environments[n].auth ? app.environments[n].auth.headerName || "x-api-key" : "x-api-key";
    row.querySelector(".env-rm").addEventListener("click", () => row.remove());
    envRowsBody.appendChild(row);
  });

  injectRowsBody.innerHTML = "";
  const profiles = app.injectionProfiles || {};
  const profileNames = Object.keys(profiles);
  if (!profileNames.length) addInjectionRow();
  else profileNames.forEach((name) => addInjectionRow(name, profiles[name]));

  scenariosEl.innerHTML = "";
  (app.scenarios || []).forEach((s) => addScenario(s));
  if (!scenariosEl.querySelector(".scenario")) addScenario();
}

function collectPlan() { saveActiveAppFromUI(); return { applications: state.apps }; }
function validatePlan(plan) {
  const errors = [];
  const apps = plan.applications || {};
  const enabledApps = Object.keys(apps).filter((n) => apps[n].enabled !== false);
  if (!enabledApps.length) errors.push("Enable at least one application.");
  Object.keys(apps).forEach((appName) => {
    const app = apps[appName];
    if (isBlank(((app.service || {}).baseUrl || "")) && !Object.keys(app.environments || {}).length) {
      errors.push(`${appName}: provide a base URL or at least one environment with base URL.`);
    }
    if (!Object.keys(app.injectionProfiles || {}).length) {
      errors.push(`${appName}: add at least one Injection Profile.`);
    }
    if (!(app.scenarios || []).length) {
      errors.push(`${appName}: add at least one scenario.`);
    }
    (app.scenarios || []).forEach((s) => {
      if (isBlank(s.name)) errors.push(`${appName}: scenario name is required.`);
      if (isBlank(((s.load || {}).profileRef || ""))) errors.push(`${appName}/${s.name || "scenario"}: select an Injection Profile.`);
      if (!((s.steps || []).length)) errors.push(`${appName}/${s.name || "scenario"}: add at least one API step.`);
      (s.steps || []).forEach((st) => {
        if (isBlank(st.name) || isBlank(st.method) || (isBlank(st.path) && isBlank(st.url))) {
          errors.push(`${appName}/${s.name || "scenario"}: each API step needs name/method and path or url.`);
        }
      });
    });
  });
  return errors;
}
function showValidation(errors) {
  if (!validationBox) return;
  if (!errors.length) {
    validationBox.style.color = "#166534";
    validationBox.textContent = "Validation passed. Configuration looks ready.";
    return;
  }
  validationBox.style.color = "#9a3412";
  validationBox.textContent = `Validation issues: ${errors.join(" | ")}`;
}

function buildEffectiveService(base, env) {
  const m = JSON.parse(JSON.stringify(base || {}));
  if (!env) return m;
  if (!isBlank(env.baseUrl)) m.baseUrl = env.baseUrl;
  m.defaultHeaders = Object.assign({}, base && base.defaultHeaders ? base.defaultHeaders : {}, env.defaultHeaders || {});
  if (env.auth) m.auth = Object.assign({}, base && base.auth ? base.auth : {}, env.auth);
  if (env.tls) m.tls = Object.assign({}, base && base.tls ? base.tls : {}, env.tls);
  return m;
}

function toYaml(plan) {
  const apps = plan.applications || {};
  let y = "applications:\n";
  Object.keys(apps).forEach((name) => {
    const app = apps[name];
    y += `  ${name}:\n`;
    y += `    enabled: ${app.enabled !== false}\n`;
    y += "    service:\n";
    y += `      baseUrl: "${esc(app.service.baseUrl || "")}"\n`;
    y += "      defaultHeaders:\n";
    const dh = app.service.defaultHeaders || {};
    if (!Object.keys(dh).length) y += '        Accept: "application/json"\n';
    Object.keys(dh).forEach((k) => { y += `        ${k}: "${esc(dh[k])}"\n`; });
    if (app.service.auth) y += `      auth:\n        type: "${esc(app.service.auth.type)}"\n        tokenEnv: "${esc(app.service.auth.tokenEnv)}"\n`;
    if (app.service.tls) {
      const t = app.service.tls;
      y += "      tls:\n";
      y += `        enabled: ${Boolean(t.enabled)}\n`;
      if (!isBlank(t.keyStorePath)) y += `        keyStorePath: "${esc(t.keyStorePath)}"\n`;
      if (!isBlank(t.keyStoreType)) y += `        keyStoreType: "${esc(t.keyStoreType)}"\n`;
      if (!isBlank(t.keyStorePasswordEnv)) y += `        keyStorePasswordEnv: "${esc(t.keyStorePasswordEnv)}"\n`;
      if (!isBlank(t.trustStorePath)) y += `        trustStorePath: "${esc(t.trustStorePath)}"\n`;
      if (!isBlank(t.trustStoreType)) y += `        trustStoreType: "${esc(t.trustStoreType)}"\n`;
      if (!isBlank(t.trustStorePasswordEnv)) y += `        trustStorePasswordEnv: "${esc(t.trustStorePasswordEnv)}"\n`;
      if (t.insecureSkipTlsVerify != null) y += `        insecureSkipTlsVerify: ${Boolean(t.insecureSkipTlsVerify)}\n`;
    }
    if (app.environments && Object.keys(app.environments).length) {
      y += `    activeEnvironment: "${esc(app.activeEnvironment || Object.keys(app.environments)[0])}"\n`;
      y += "    environments:\n";
      Object.keys(app.environments).forEach((en) => {
        const env = app.environments[en];
        y += `      ${en}:\n`;
        y += `        enabled: ${env.enabled !== false}\n`;
        if (!isBlank(env.baseUrl)) y += `        baseUrl: "${esc(env.baseUrl)}"\n`;
        if (env.defaultHeaders && Object.keys(env.defaultHeaders).length) { y += "        defaultHeaders:\n"; Object.keys(env.defaultHeaders).forEach((k) => { y += `          ${k}: "${esc(env.defaultHeaders[k])}"\n`; }); }
        if (env.auth) y += `        auth:\n          type: "${esc(env.auth.type)}"\n          tokenEnv: "${esc(env.auth.tokenEnv)}"\n`;
        if (env.tls) { y += "        tls:\n"; y += `          enabled: ${Boolean(env.tls.enabled)}\n`; if (!isBlank(env.tls.keyStorePath)) y += `          keyStorePath: "${esc(env.tls.keyStorePath)}"\n`; if (!isBlank(env.tls.trustStorePath)) y += `          trustStorePath: "${esc(env.tls.trustStorePath)}"\n`; }
      });
    }
    if (app.injectionProfiles && Object.keys(app.injectionProfiles).length) {
      y += "    injectionProfiles:\n";
      Object.keys(app.injectionProfiles).forEach((name) => {
        const p = app.injectionProfiles[name];
        y += `      ${name}:\n`;
        y += `        injectionType: "${esc(p.injectionType || "rampUsers")}"\n`;
        if (p.users != null) y += `        users: ${p.users}\n`;
        if (p.rampDurationSec != null) y += `        rampDurationSec: ${p.rampDurationSec}\n`;
        if (p.durationSec != null) y += `        durationSec: ${p.durationSec}\n`;
        if (p.paceMs != null) y += `        paceMs: ${p.paceMs}\n`;
        if (p.rate != null) y += `        rate: ${p.rate}\n`;
        if (p.fromRps != null) y += `        fromRps: ${p.fromRps}\n`;
        if (p.toRps != null) y += `        toRps: ${p.toRps}\n`;
        if (p.startRate != null) y += `        startRate: ${p.startRate}\n`;
        if (p.incrementBy != null) y += `        incrementBy: ${p.incrementBy}\n`;
        if (p.levelCount != null) y += `        levelCount: ${p.levelCount}\n`;
        if (p.levelDurationSec != null) y += `        levelDurationSec: ${p.levelDurationSec}\n`;
        if (p.fromUsers != null) y += `        fromUsers: ${p.fromUsers}\n`;
        if (p.toUsers != null) y += `        toUsers: ${p.toUsers}\n`;
      });
    }
    y += "    assertions:\n";
    y += `      minSuccessPercent: ${app.assertions.minSuccessPercent}\n`;
    if (app.assertions.minRequestsPerSec != null) y += `      minRequestsPerSec: ${app.assertions.minRequestsPerSec}\n`;
    y += `      maxResponseTimeMs: ${app.assertions.maxResponseTimeMs}\n`;
    if (app.assertions.p90ResponseTimeMs != null) y += `      p90ResponseTimeMs: ${app.assertions.p90ResponseTimeMs}\n`;
    y += `      p95ResponseTimeMs: ${app.assertions.p95ResponseTimeMs}\n`;
    if (app.assertions.p99ResponseTimeMs != null) y += `      p99ResponseTimeMs: ${app.assertions.p99ResponseTimeMs}\n`;
    if (app.assertions.maxFailedRequests != null) y += `      maxFailedRequests: ${app.assertions.maxFailedRequests}\n`;
    y += "    scenarios:\n";
    (app.scenarios || []).forEach((s) => {
      y += `      - name: "${esc(s.name)}"\n        load:\n`;
      if (!isBlank(s.load.profileRef)) y += `          profileRef: "${esc(s.load.profileRef)}"\n`;
      if (!isBlank(s.load.injectionType)) y += `          injectionType: "${esc(s.load.injectionType)}"\n`;
      if (s.load.users != null) y += `          users: ${s.load.users}\n`;
      if (s.load.rampDurationSec != null) y += `          rampDurationSec: ${s.load.rampDurationSec}\n`;
      if (s.load.durationSec != null) y += `          durationSec: ${s.load.durationSec}\n`;
      if (s.load.paceMs != null) y += `          paceMs: ${s.load.paceMs}\n`;
      if (s.load.rate != null) y += `          rate: ${s.load.rate}\n`;
      if (s.load.fromRps != null) y += `          fromRps: ${s.load.fromRps}\n`;
      if (s.load.toRps != null) y += `          toRps: ${s.load.toRps}\n`;
      if (s.load.startRate != null) y += `          startRate: ${s.load.startRate}\n`;
      if (s.load.incrementBy != null) y += `          incrementBy: ${s.load.incrementBy}\n`;
      if (s.load.levelCount != null) y += `          levelCount: ${s.load.levelCount}\n`;
      if (s.load.levelDurationSec != null) y += `          levelDurationSec: ${s.load.levelDurationSec}\n`;
      if (s.load.fromUsers != null) y += `          fromUsers: ${s.load.fromUsers}\n`;
      if (s.load.toUsers != null) y += `          toUsers: ${s.load.toUsers}\n`;
      if (s.flow && Object.keys(s.flow).length) {
        y += "        flow:\n";
        if (s.flow.repeatCount != null) y += `          repeatCount: ${s.flow.repeatCount}\n`;
        if (s.flow.duringSec != null) y += `          duringSec: ${s.flow.duringSec}\n`;
        if (s.flow.exitOnFail != null) y += `          exitOnFail: ${Boolean(s.flow.exitOnFail)}\n`;
      }
      if (s.feeder) y += `        feeder:\n          type: "csv"\n          file: "${esc(s.feeder.file)}"\n          mode: "${esc(s.feeder.mode)}"\n`;
      y += "        steps:\n";
      (s.steps || []).forEach((st) => {
        y += `          - name: "${esc(st.name)}"\n            method: "${esc(st.method)}"\n            path: "${esc(st.path)}"\n`;
        if (Object.keys(st.headers || {}).length) { y += "            headers:\n"; Object.keys(st.headers).forEach((k) => { y += `              ${k}: "${esc(st.headers[k])}"\n`; }); }
        if (!isBlank(st.body)) y += `            body: '${st.body.replace(/'/g, "''")}'\n`;
        if (st.condition) y += `            condition:\n              variable: "${esc(st.condition.variable)}"\n              equals: "${esc(st.condition.equals)}"\n`;
        if (st.retryCount != null) y += `            retryCount: ${st.retryCount}\n`;
        y += `            expectedStatus: ${st.expectedStatus}\n            pauseMs: ${st.pauseMs}\n`;
        if ((st.checks || []).length) {
          y += "            checks:\n";
          st.checks.forEach((c) => {
            y += `              - type: "${esc(c.type || "")}"\n`;
            if (!isBlank(c.path)) y += `                path: "${esc(c.path)}"\n`;
            if (!isBlank(c.value)) y += `                value: "${esc(c.value)}"\n`;
          });
        }
        if ((st.captures || []).length) {
          y += "            captures:\n";
          st.captures.forEach((c) => {
            y += `              - type: "${esc(c.type || "")}"\n`;
            y += `                path: "${esc(c.path || "")}"\n`;
            y += `                saveAs: "${esc(c.saveAs || "")}"\n`;
          });
        }
      });
    });
  });
  return y;
}

function resolveTemplate(v, vars) { return v ? v.replace(/#\{([^}]+)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k]))) : v; }
function previewAuthWarning(scope, auth) {
  if (!auth || isBlank(auth.type)) return null;
  return `${scope} auth is env-backed and is not applied in UI preview. Backend run may differ.`;
}
function buildPreviewUrl(base, step, vars) {
  const rawTarget = !isBlank(step.url) ? resolveTemplate(step.url, vars) : `${base}${resolveTemplate(step.path, vars)}`;
  try {
    const u = new URL(rawTarget);
    Object.entries(step.queryParams || {}).forEach(([k, v]) => {
      if (!isBlank(k)) u.searchParams.set(k, resolveTemplate(v, vars));
    });
    return u.toString();
  } catch (_) {
    const query = new URLSearchParams();
    Object.entries(step.queryParams || {}).forEach(([k, v]) => {
      if (!isBlank(k)) query.set(k, resolveTemplate(v, vars));
    });
    const suffix = query.toString();
    return suffix ? `${rawTarget}${rawTarget.includes("?") ? "&" : "?"}${suffix}` : rawTarget;
  }
}
async function tryLoadPreviewBodyFile(path) {
  if (isBlank(path)) return null;
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.text();
  } catch (_) {
    return null;
  }
}
function readJsonPath(obj, path) {
  if (obj == null || !path) return undefined;
  let p = path.trim(); if (p.startsWith("$.")) p = p.slice(2); else if (p.startsWith("$")) p = p.slice(1);
  const toks = []; p.split(".").forEach((part) => { const m = part.match(/^([^\[]+)(.*)$/); if (m && m[1]) toks.push(m[1]); const rest = m ? m[2] : ""; const idx = rest.match(/\[\d+\]/g); if (idx) idx.forEach((x) => toks.push(Number(x.slice(1, -1)))); });
  let cur = obj; for (const t of toks) { if (cur == null) return undefined; cur = cur[t]; } return cur;
}
function evaluateChecks(step, response, bodyText, bodyJson) {
  const reasons = [];
  if (step.expectedStatus && response.status !== step.expectedStatus) {
    reasons.push(`Status mismatch: expected ${step.expectedStatus}, got ${response.status}`);
  }
  (step.checks || []).forEach((c) => {
    const t = String(c.type || "").toLowerCase();
    if (t === "bodycontains") {
      if (!String(bodyText || "").includes(String(c.value || ""))) reasons.push(`Check failed bodyContains: ${c.value || ""}`);
      return;
    }
    if (t === "regex") {
      try {
        const rgx = new RegExp(String(c.value || ""));
        if (!rgx.test(String(bodyText || ""))) reasons.push(`Check failed regex: ${c.value || ""}`);
      } catch (_) {
        reasons.push(`Invalid regex: ${c.value || ""}`);
      }
      return;
    }
    if (t === "jsonpathexists") {
      const v = readJsonPath(bodyJson, c.path);
      if (v === undefined || v === null) reasons.push(`Check failed jsonPathExists: ${c.path || ""}`);
      return;
    }
    if (t === "jsonpathequals") {
      const v = readJsonPath(bodyJson, c.path);
      if (String(v) !== String(c.value == null ? "" : c.value)) {
        reasons.push(`Check failed jsonPathEquals ${c.path || ""}: expected ${c.value}, got ${v}`);
      }
      return;
    }
    if (t === "headerexists") {
      const hv = response.headers.get(String(c.path || ""));
      if (hv == null) reasons.push(`Check failed headerExists: ${c.path || ""}`);
      return;
    }
    if (t === "headerequals") {
      const hv = response.headers.get(String(c.path || ""));
      if (String(hv == null ? "" : hv) !== String(c.value == null ? "" : c.value)) {
        reasons.push(`Check failed headerEquals ${c.path || ""}: expected ${c.value}, got ${hv}`);
      }
      return;
    }
    if (t === "bodylengthgt") {
      const n = Number(c.value || 0);
      if (!(String(bodyText || "").length > n)) reasons.push(`Check failed bodyLengthGt: ${n}`);
      return;
    }
    if (t === "jmespathexists") {
      const v = readJsonPath(bodyJson, c.path);
      if (v === undefined || v === null) reasons.push(`Check failed jmesPathExists: ${c.path || ""}`);
      return;
    }
    if (t === "jmespathequals") {
      const v = readJsonPath(bodyJson, c.path);
      if (String(v) !== String(c.value == null ? "" : c.value)) reasons.push(`Check failed jmesPathEquals ${c.path || ""}: expected ${c.value}, got ${v}`);
      return;
    }
    if (t === "statusin") {
      const allowed = String(c.value || "").split(",").map((x) => String(Number(x.trim()))).filter((x) => x !== "0" || String(c.value || "").includes("0"));
      if (!allowed.includes(String(response.status))) reasons.push(`Check failed statusIn: expected one of [${c.value}], got ${response.status}`);
      return;
    }
    reasons.push(`Unsupported check type in UI runner: ${c.type || ""}`);
  });
  return { ok: reasons.length === 0, reasons };
}
function applyCaptures(step, response, bodyText, bodyJson, vars) {
  (step.captures || []).forEach((c) => {
    const t = String(c.type || "").toLowerCase();
    if (t === "jsonpath") {
      const v = readJsonPath(bodyJson, c.path);
      if (v !== undefined) vars[c.saveAs] = v;
      return;
    }
    if (t === "header") {
      const hv = response.headers.get(String(c.path || ""));
      if (hv != null) vars[c.saveAs] = hv;
      return;
    }
    if (t === "regex") {
      try {
        const m = String(bodyText || "").match(new RegExp(String(c.path || "")));
        if (m && m[0] != null) vars[c.saveAs] = m[1] != null ? m[1] : m[0];
      } catch (_) {}
    }
  });
}
function parseCsv(text) { const lines = (text || "").split(/\r?\n/).filter((x) => x.trim()); if (!lines.length) return []; const hdr = lines[0].split(",").map((x) => x.trim()); const rows = []; for (let i = 1; i < lines.length; i++) { const cols = lines[i].split(",").map((x) => x.trim()); const r = {}; hdr.forEach((h, idx) => { r[h] = cols[idx] == null ? "" : cols[idx]; }); rows.push(r); } return rows; }
async function loadScenarioFeederRows(scn) { if (!scn.feeder || scn.feeder.type !== "csv") return { rows: [], warnings: [] }; try { const res = await fetch(scn.feeder.file); if (!res.ok) return { rows: [], warnings: [`Feeder not loaded (${res.status})`] }; const rows = parseCsv(await res.text()); return { rows, warnings: rows.length ? [] : ["Feeder empty"] }; } catch (_) { return { rows: [], warnings: ["Feeder inaccessible in browser"] }; } }
function pickFeederRow(rows, mode, i) { if (!rows.length) return {}; const m = (mode || "queue").toLowerCase(); if (m === "random") return rows[Math.floor(Math.random() * rows.length)]; if (m === "circular") return rows[i % rows.length]; return i < rows.length ? rows[i] : {}; }
function statusText(map) { const e = Object.entries(map || {}); if (!e.length) return "-"; return e.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", "); }
function computeScenarioIterations(scn, fallbackIterations) {
  const load = scn.load || {};
  if (!(load.durationSec && load.paceMs && load.users)) {
    return { count: fallbackIterations, warning: null };
  }
  const perUserHits = Math.max(1, Math.floor((Number(load.durationSec) * 1000) / Number(load.paceMs)));
  const totalHits = Math.max(1, perUserHits * Number(load.users));
  const hardCap = 3000;
  if (totalHits > hardCap) {
    return {
      count: hardCap,
      warning: `UI run capped at ${hardCap} requests (configured ${totalHits}) for browser safety. Gatling backend will run full load.`
    };
  }
  return { count: totalHits, warning: null };
}

async function executeForEnvironment(appName, envName, service, scenarios, iterations) {
  const base = (service.baseUrl || "").replace(/\/$/, "");
  if (isBlank(base)) return { summary: { scenarios: scenarios.length, steps: 0, total: 0, success: 0, successPct: "0.00%", minRt: 0, avgRt: 0, p95Rt: 0, p99Rt: 0, maxRt: 0, parity: 1 }, rows: [], scenarioSummary: [], failReasons: [{ reason: "Skipped: missing baseUrl", count: 1 }], parityRows: [{ key: `${appName}/${envName}`, message: "Missing baseUrl" }], diag: {} };
  const gHeaders = service.defaultHeaders || {};
  let total = 0, success = 0, steps = 0;
  const allRt = []; const failReasonGlobal = {}; const scnAgg = {}; const diag = {}; const rows = []; const parityRows = [];
  for (const scn of scenarios) {
    const feeder = await loadScenarioFeederRows(scn);
    const iterMeta = computeScenarioIterations(scn, iterations);
    const metrics = scn.steps.map((step) => ({ scenario: scn.name, step: step.name, expected: step.expectedStatus, total: 0, success: 0, durations: [], statusCounts: {}, failReasons: {}, parityWarnings: [...(feeder.warnings || []), ...(iterMeta.warning ? [iterMeta.warning] : [])] }));
    const jobs = [];
    for (let i = 0; i < iterMeta.count; i++) {
      jobs.push((async () => {
        const vars = pickFeederRow(feeder.rows || [], scn.feeder ? scn.feeder.mode : "queue", i);
        const repeatCount = scn.flow && scn.flow.repeatCount ? Math.max(1, Number(scn.flow.repeatCount)) : 1;
        let loopGuard = 0;
        let shouldContinue = true;
        while (shouldContinue && loopGuard < repeatCount) {
          loopGuard += 1;
          for (let si = 0; si < scn.steps.length; si++) {
            const sourceStep = scn.steps[si];
            let step = sourceStep;
            let matchedBranch = false;
            if (sourceStep.branches && sourceStep.branches.length) {
              for (const branch of sourceStep.branches) {
                if (evaluateCondition(branch.when, vars)) {
                  step = mergeStepOverride(sourceStep, branch, "(branch)");
                  matchedBranch = true;
                  break;
                }
              }
              if (!matchedBranch) {
                if (!isBlank(sourceStep.elseMethod) && !isBlank(sourceStep.elsePath)) {
                  step = mergeStepOverride(sourceStep, {
                    name: "Fallback",
                    method: sourceStep.elseMethod,
                    path: sourceStep.elsePath,
                    expectedStatus: sourceStep.elseExpectedStatus != null ? sourceStep.elseExpectedStatus : sourceStep.expectedStatus,
                    body: sourceStep.elseBody || ""
                  }, "(fallback)");
                }
              }
            } else if (sourceStep.condition) {
              if (evaluateCondition(sourceStep.condition, vars)) {
                matchedBranch = true;
              } else if (!isBlank(sourceStep.elseMethod) && !isBlank(sourceStep.elsePath)) {
                step = mergeStepOverride(sourceStep, {
                  name: "Fallback",
                  method: sourceStep.elseMethod,
                  path: sourceStep.elsePath,
                  expectedStatus: sourceStep.elseExpectedStatus != null ? sourceStep.elseExpectedStatus : sourceStep.expectedStatus,
                  body: sourceStep.elseBody || ""
                }, "(fallback)");
              } else {
                continue;
              }
            }
          const headers = Object.assign({}, gHeaders);
          Object.keys(step.headers || {}).forEach((k) => { headers[k] = resolveTemplate(step.headers[k], vars); });
          const serviceAuthWarning = previewAuthWarning("Service", service.auth);
          const stepAuthWarning = previewAuthWarning("Step", step.auth);
          if (serviceAuthWarning) metrics[si].parityWarnings.push(serviceAuthWarning);
          if (stepAuthWarning) metrics[si].parityWarnings.push(stepAuthWarning);
          if (!headers.Accept) headers.Accept = "application/json";
          const init = { method: step.method, headers };
          if (step.requestTimeoutMs > 0) metrics[si].parityWarnings.push("UI preview does not enforce requestTimeoutMs exactly like Gatling.");
          if (step.disableFollowRedirect) metrics[si].parityWarnings.push("UI preview cannot disable redirects per request like Gatling.");
          if (step.disableUrlEncoding) metrics[si].parityWarnings.push("UI preview does not mirror disableUrlEncoding.");
          if (step.silent) metrics[si].parityWarnings.push("UI preview does not mirror silent request reporting.");
          if (step.ignoreProtocolHeaders) metrics[si].parityWarnings.push("UI preview does not mirror ignoreProtocolHeaders.");
          let body = resolveTemplate(step.body || "", vars);
          if (isBlank(body) && !isBlank(step.bodyFile)) {
            const loadedBody = await tryLoadPreviewBodyFile(step.bodyFile);
            if (loadedBody != null) body = resolveTemplate(loadedBody, vars);
            else metrics[si].parityWarnings.push(`UI preview could not load bodyFile ${step.bodyFile}. Backend run may differ.`);
          }
          if (step.formUploads && step.formUploads.length) {
            metrics[si].parityWarnings.push("UI preview does not support multipart file uploads. Use backend run for parity.");
          } else if (step.formParams && Object.keys(step.formParams).length) {
            const encoded = new URLSearchParams();
            Object.entries(step.formParams).forEach(([k, v]) => { if (!isBlank(k)) encoded.set(k, resolveTemplate(v, vars)); });
            init.body = encoded.toString();
            if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
          } else if (!isBlank(body)) {
            init.body = body;
          }
          const st = performance.now();
          let ok = false, status = "ERR";
          const maxAttempts = Math.max(1, (step.retryCount || 0) + 1);
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              const res = await fetch(buildPreviewUrl(base, step, vars), init);
              status = String(res.status);
              const text = await res.text();
              let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
              const chk = evaluateChecks(step, res, text, json); ok = chk.ok;
              if (ok) {
                applyCaptures(step, res, text, json, vars);
                break;
              }
              if (attempt === maxAttempts) {
                const r = chk.reasons.join("; ");
                metrics[si].failReasons[r] = (metrics[si].failReasons[r] || 0) + 1; failReasonGlobal[r] = (failReasonGlobal[r] || 0) + 1;
              }
            } catch (e) {
              if (attempt === maxAttempts) {
                const r = `Request error: ${e && e.message ? e.message : "network/CORS/blocked"}`;
                metrics[si].failReasons[r] = (metrics[si].failReasons[r] || 0) + 1; failReasonGlobal[r] = (failReasonGlobal[r] || 0) + 1;
              }
            }
          }
          const rt = Math.round(performance.now() - st);
          const m = metrics[si]; m.total += 1; m.durations.push(rt); m.statusCounts[status] = (m.statusCounts[status] || 0) + 1; if (ok) m.success += 1;
          if (scn.flow && scn.flow.exitOnFail && !ok) break;
          if (step.pauseMs && step.pauseMs > 0) await new Promise((r) => setTimeout(r, step.pauseMs));
        }
          if (scn.flow && !isBlank(scn.flow.asLongAsVariable) && !isBlank(scn.flow.asLongAsEquals)) {
            const actual = vars[scn.flow.asLongAsVariable];
            shouldContinue = String(actual == null ? "" : actual) === String(scn.flow.asLongAsEquals);
          } else {
            shouldContinue = loopGuard < repeatCount;
          }
        }
      })());
    }
    await Promise.all(jobs);
    scnAgg[scn.name] = scnAgg[scn.name] || { total: 0, success: 0, durations: [] };
    for (let si = 0; si < metrics.length; si++) {
      const m = metrics[si];
      steps += 1; total += m.total; success += m.success; allRt.push(...m.durations);
      scnAgg[scn.name].total += m.total; scnAgg[scn.name].success += m.success; scnAgg[scn.name].durations.push(...m.durations);
      const id = `${appName}__${envName}__${m.scenario}__${m.step}__${si}`.replace(/[^a-zA-Z0-9_]/g, "_");
      diag[id] = m;
      if (m.parityWarnings.length) {
        parityRows.push({ key: `${m.scenario} / ${m.step}`, message: m.parityWarnings.join("; ") });
      }
      rows.push({ id, scenario: m.scenario, step: m.step, total: m.total, success: m.success, successPct: m.total ? ((m.success / m.total) * 100).toFixed(2) : "0.00", min: min(m.durations), avg: avg(m.durations), p90: percentile(m.durations, 90), p95: percentile(m.durations, 95), p99: percentile(m.durations, 99), max: max(m.durations), status: statusText(m.statusCounts), parity: m.parityWarnings.length ? `${m.parityWarnings.length} warning(s)` : "Aligned" });
    }
  }
  const scenarioSummary = Object.keys(scnAgg).map((name) => ({ name, total: scnAgg[name].total, success: scnAgg[name].success, successPct: scnAgg[name].total ? ((scnAgg[name].success / scnAgg[name].total) * 100).toFixed(2) : "0.00", avg: avg(scnAgg[name].durations), p95: percentile(scnAgg[name].durations, 95), max: max(scnAgg[name].durations) }));
  const failReasons = Object.entries(failReasonGlobal).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([reason, count]) => ({ reason, count }));
  return { summary: { scenarios: Object.keys(scnAgg).length, steps, total, success, successPct: `${total ? ((success / total) * 100).toFixed(2) : "0.00"}%`, minRt: min(allRt), avgRt: avg(allRt), p95Rt: percentile(allRt, 95), p99Rt: percentile(allRt, 99), maxRt: max(allRt), parity: parityRows.length }, rows, scenarioSummary, failReasons, parityRows, diag };
}

function renderCards(summary) {
  const items = [["Scenarios", summary.scenarios], ["API Steps", summary.steps], ["Total Requests", summary.total], ["Success", summary.success], ["Failure", summary.total - summary.success], ["Success %", summary.successPct], ["Min RT", `${summary.minRt} ms`], ["Avg RT", `${summary.avgRt} ms`], ["P95 RT", `${summary.p95Rt} ms`], ["P99 RT", `${summary.p99Rt} ms`], ["Max RT", `${summary.maxRt} ms`], ["Parity Warnings", summary.parity]];
  reportCards.innerHTML = items.map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
}
function renderReportForCurrent() {
  const data = state.reports[activeReportApp] && state.reports[activeReportApp][activeReportEnv];
  if (!data) return;
  resultsBody.innerHTML = ""; scenarioSummaryBody.innerHTML = ""; failureReasonsBody.innerHTML = ""; parityBody.innerHTML = "";
  detailPanel.textContent = `Application: ${activeReportApp}\nEnvironment: ${activeReportEnv}\nClick Why on any API row for deep diagnostics.`;
  renderCards(data.summary);
  data.rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.scenario}</td><td>${row.step}</td><td>${row.total}</td><td>${row.success}</td><td>${row.successPct}</td><td>${row.min}</td><td>${row.avg}</td><td>${row.p90}</td><td>${row.p95}</td><td>${row.p99}</td><td>${row.max}</td><td>${row.status}</td><td>${row.parity}</td><td><button class="secondary why" data-id="${row.id}">Why</button></td>`;
    const b = tr.querySelector(".why");
    b.addEventListener("click", () => {
      const d = data.diag[row.id];
      if (!d) return;
      const topFailures = Object.entries(d.failReasons || {}).sort((a, b2) => b2[1] - a[1]).slice(0, 10);
      detailPanel.textContent =
        `Application: ${activeReportApp}\n` +
        `Environment: ${activeReportEnv}\n` +
        `Scenario: ${row.scenario}\n` +
        `API: ${row.step}\n` +
        `Expected Status: ${d.expected || "-"}\n` +
        `Total: ${d.total}\n` +
        `Success: ${d.success}\n` +
        `Success%: ${row.successPct}\n` +
        `Statuses: ${row.status}\n` +
        `Latency ms: min=${row.min}, avg=${row.avg}, p90=${row.p90}, p95=${row.p95}, p99=${row.p99}, max=${row.max}\n` +
        `Parity Warnings: ${d.parityWarnings && d.parityWarnings.length ? d.parityWarnings.join("; ") : "None"}\n` +
        `Top Failure Reasons:\n${topFailures.length ? topFailures.map((x) => `- ${x[0]} => ${x[1]}`).join("\n") : "- None"}`;
    });
    resultsBody.appendChild(tr);
  });
  data.scenarioSummary.forEach((s) => { const tr = document.createElement("tr"); tr.innerHTML = `<td>${s.name}</td><td>${s.total}</td><td>${s.success}</td><td>${s.successPct}</td><td>${s.avg}</td><td>${s.p95}</td><td>${s.max}</td>`; scenarioSummaryBody.appendChild(tr); });
  if (!data.failReasons.length) failureReasonsBody.innerHTML = "<tr><td>None</td><td>0</td></tr>";
  else data.failReasons.forEach((x) => { const tr = document.createElement("tr"); tr.innerHTML = `<td>${x.reason}</td><td>${x.count}</td>`; failureReasonsBody.appendChild(tr); });
  if (!data.parityRows.length) parityBody.innerHTML = "<tr><td>None</td><td>0</td></tr>";
  else data.parityRows.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${p.key}</td><td>${p.message}</td>`;
    parityBody.appendChild(tr);
  });
}
function renderReportEnvTabs() {
  reportEnvTabs.innerHTML = "";
  const envs = state.reports[activeReportApp] ? Object.keys(state.reports[activeReportApp]) : [];
  if (!envs.length) return;
  if (!envs.includes(activeReportEnv)) activeReportEnv = envs[0];
  envs.forEach((e) => { const b = document.createElement("button"); b.className = `tab-btn ${e === activeReportEnv ? "active" : ""}`; b.textContent = e; b.addEventListener("click", () => { activeReportEnv = e; renderReportEnvTabs(); renderReportForCurrent(); }); reportEnvTabs.appendChild(b); });
}
function renderReportAppTabs() {
  reportAppTabs.innerHTML = "";
  const apps = Object.keys(state.reports);
  if (!apps.length) return;
  if (!apps.includes(activeReportApp)) activeReportApp = apps[0];
  apps.forEach((a) => { const b = document.createElement("button"); b.className = `tab-btn ${a === activeReportApp ? "active" : ""}`; b.textContent = a; b.addEventListener("click", () => { activeReportApp = a; activeReportEnv = null; renderReportAppTabs(); renderReportEnvTabs(); renderReportForCurrent(); }); reportAppTabs.appendChild(b); });
  renderReportEnvTabs();
}

function validateEnhancedPlan(plan) {
  const errs = validatePlan(plan);
  function validateConditionUi(condition, prefix) {
    if (!condition || isBlank(condition.variable)) return;
    const operator = String(condition.operator || (condition.equals != null ? "equals" : "exists")).toLowerCase();
    const value = condition.value != null ? condition.value : condition.equals;
    const values = Array.isArray(condition.values) ? condition.values.filter((item) => !isBlank(item)) : [];
    if (["equals", "notequals", "contains"].includes(operator) && isBlank(value)) errs.push(`${prefix}: condition operator ${operator} requires a value.`);
    if (operator === "in" && !values.length && isBlank(value)) errs.push(`${prefix}: condition operator in requires Values CSV or Value.`);
    if (!["equals", "notequals", "contains", "in", "exists", "notexists"].includes(operator)) errs.push(`${prefix}: unsupported condition operator ${operator}.`);
  }
  Object.entries(plan.applications || {}).forEach(([appName, app]) => {
    (app.scenarios || []).forEach((sc) => {
      if (sc.flow) {
        if ((!isBlank(sc.flow.asLongAsVariable) && isBlank(sc.flow.asLongAsEquals)) || (isBlank(sc.flow.asLongAsVariable) && !isBlank(sc.flow.asLongAsEquals))) {
          errs.push(`${appName} / ${sc.name}: AsLongAs Variable and Equals must be provided together.`);
        }
      }
      (sc.steps || []).forEach((step) => {
        const hasElse = !isBlank(step.elseMethod) || !isBlank(step.elsePath) || !isBlank(step.elseBody) || step.elseExpectedStatus != null;
        validateConditionUi(step.condition, `${appName} / ${sc.name} / ${step.name}`);
        (step.branches || []).forEach((branch, index) => {
          validateConditionUi(branch.when, `${appName} / ${sc.name} / ${step.name} / Branch ${index + 1}`);
          if (!branch.when || isBlank(branch.when.variable)) errs.push(`${appName} / ${sc.name} / ${step.name}: Branch ${index + 1} requires a variable.`);
          if (isBlank(branch.method) && isBlank(branch.path) && isBlank(branch.url) && isBlank(step.method) && isBlank(step.path) && isBlank(step.url)) errs.push(`${appName} / ${sc.name} / ${step.name}: Branch ${index + 1} must define a request or inherit one.`);
        });
        if (hasElse) {
          if (!step.condition || isBlank(step.condition.variable) || step.condition.equals == null) errs.push(`${appName} / ${sc.name} / ${step.name}: Else branch requires a condition.`);
          if (isBlank(step.elseMethod) || isBlank(step.elsePath)) errs.push(`${appName} / ${sc.name} / ${step.name}: Else Method and Else Path are required together.`);
        }
        if (!isBlank(step.body) && !isBlank(step.bodyFile)) errs.push(`${appName} / ${sc.name} / ${step.name}: Body and Body File cannot both be set.`);
        if ((!isBlank(step.body) || !isBlank(step.bodyFile)) && step.formParams && Object.keys(step.formParams).length) errs.push(`${appName} / ${sc.name} / ${step.name}: Body/Body File cannot be combined with Form Params.`);
        if ((!isBlank(step.body) || !isBlank(step.bodyFile)) && step.formUploads && step.formUploads.length) errs.push(`${appName} / ${sc.name} / ${step.name}: Body/Body File cannot be combined with Multipart Uploads.`);
        if (step.requestTimeoutMs != null && Number(step.requestTimeoutMs) <= 0) errs.push(`${appName} / ${sc.name} / ${step.name}: Request Timeout must be > 0.`);
        if (!isBlank(step.bodyType) && ["json", "xml", "text", "form", "multipart"].indexOf(String(step.bodyType).toLowerCase()) < 0) errs.push(`${appName} / ${sc.name} / ${step.name}: Unsupported bodyType ${step.bodyType}.`);
        if (String(step.bodyType || "").toLowerCase() === "multipart" && !((step.formUploads && step.formUploads.length) || (step.formParams && Object.keys(step.formParams).length))) errs.push(`${appName} / ${sc.name} / ${step.name}: Multipart requires Form Params or Uploads.`);
        const auth = step.auth || {};
        if (auth.type === "bearer" && isBlank(auth.tokenEnv)) errs.push(`${appName} / ${sc.name} / ${step.name}: bearer auth requires token env.`);
        if (auth.type === "basic" && (isBlank(auth.usernameEnv) || isBlank(auth.passwordEnv))) errs.push(`${appName} / ${sc.name} / ${step.name}: basic auth requires username and password env.`);
        if (auth.type === "header" && (isBlank(auth.headerName) || isBlank(auth.headerValueEnv))) errs.push(`${appName} / ${sc.name} / ${step.name}: header auth requires header name and value env.`);
      });
    });
  });
  return errs;
}

function yamlValueLines(indent, key, value, lines) {
  if (value == null || isBlank(value)) return;
  lines.push(`${indent}${key}: |`);
  String(value).split(/\r?\n/).forEach((line) => lines.push(`${indent}  ${line}`));
}

function emitService(indent, service, lines) {
  if (!service) return;
  lines.push(`${indent}service:`);
  if (!isBlank(service.baseUrl)) lines.push(`${indent}  baseUrl: "${esc(service.baseUrl)}"`);
  if (service.defaultHeaders && Object.keys(service.defaultHeaders).length) {
    lines.push(`${indent}  defaultHeaders:`);
    Object.keys(service.defaultHeaders).forEach((k) => lines.push(`${indent}    "${esc(k)}": "${esc(service.defaultHeaders[k])}"`));
  }
  if (service.auth && (!isBlank(service.auth.type) || !isBlank(service.auth.tokenEnv))) {
    lines.push(`${indent}  auth:`);
    if (!isBlank(service.auth.type)) lines.push(`${indent}    type: "${esc(service.auth.type)}"`);
    if (!isBlank(service.auth.tokenEnv)) lines.push(`${indent}    tokenEnv: "${esc(service.auth.tokenEnv)}"`);
    if (!isBlank(service.auth.usernameEnv)) lines.push(`${indent}    usernameEnv: "${esc(service.auth.usernameEnv)}"`);
    if (!isBlank(service.auth.passwordEnv)) lines.push(`${indent}    passwordEnv: "${esc(service.auth.passwordEnv)}"`);
    if (!isBlank(service.auth.headerName)) lines.push(`${indent}    headerName: "${esc(service.auth.headerName)}"`);
    if (!isBlank(service.auth.headerValueEnv)) lines.push(`${indent}    headerValueEnv: "${esc(service.auth.headerValueEnv)}"`);
  }
  if (service.tls) {
    lines.push(`${indent}  tls:`);
    if (service.tls.enabled != null) lines.push(`${indent}    enabled: ${service.tls.enabled}`);
    if (!isBlank(service.tls.keyStorePath)) lines.push(`${indent}    keyStorePath: "${esc(service.tls.keyStorePath)}"`);
    if (!isBlank(service.tls.keyStoreType)) lines.push(`${indent}    keyStoreType: "${esc(service.tls.keyStoreType)}"`);
    if (!isBlank(service.tls.keyStorePasswordEnv)) lines.push(`${indent}    keyStorePasswordEnv: "${esc(service.tls.keyStorePasswordEnv)}"`);
    if (!isBlank(service.tls.trustStorePath)) lines.push(`${indent}    trustStorePath: "${esc(service.tls.trustStorePath)}"`);
    if (!isBlank(service.tls.trustStoreType)) lines.push(`${indent}    trustStoreType: "${esc(service.tls.trustStoreType)}"`);
    if (!isBlank(service.tls.trustStorePasswordEnv)) lines.push(`${indent}    trustStorePasswordEnv: "${esc(service.tls.trustStorePasswordEnv)}"`);
    if (service.tls.insecureSkipTlsVerify != null) lines.push(`${indent}    insecureSkipTlsVerify: ${service.tls.insecureSkipTlsVerify}`);
  }
}

function emitAssertions(indent, assertions, lines) {
  if (!assertions) return;
  lines.push(`${indent}assertions:`);
  if (assertions.minSuccessPercent != null) lines.push(`${indent}  minSuccessPercent: ${assertions.minSuccessPercent}`);
  if (assertions.maxResponseTimeMs != null) lines.push(`${indent}  maxResponseTimeMs: ${assertions.maxResponseTimeMs}`);
  if (assertions.p90ResponseTimeMs != null) lines.push(`${indent}  p90ResponseTimeMs: ${assertions.p90ResponseTimeMs}`);
  if (assertions.p95ResponseTimeMs != null) lines.push(`${indent}  p95ResponseTimeMs: ${assertions.p95ResponseTimeMs}`);
  if (assertions.p99ResponseTimeMs != null) lines.push(`${indent}  p99ResponseTimeMs: ${assertions.p99ResponseTimeMs}`);
  if (assertions.maxFailedRequests != null) lines.push(`${indent}  maxFailedRequests: ${assertions.maxFailedRequests}`);
  if (assertions.minRequestsPerSec != null) lines.push(`${indent}  minRequestsPerSec: ${assertions.minRequestsPerSec}`);
}

function emitLoadProfile(indent, load, lines) {
  lines.push(`${indent}injectionType: "${esc(load.injectionType || "")}"`);
  ["profileRef", "users", "rampDurationSec", "durationSec", "paceMs", "rate", "fromRps", "toRps", "startRate", "incrementBy", "levelCount", "levelDurationSec", "fromUsers", "toUsers"].forEach((k) => {
    if (load[k] != null && !isBlank(load[k])) lines.push(`${indent}${k}: ${typeof load[k] === "string" ? `"${esc(load[k])}"` : load[k]}`);
  });
}
function emitConditionYaml(indent, condition, lines) {
  const normalized = normalizeCondition(condition);
  if (!normalized) return;
  lines.push(`${indent}variable: "${esc(normalized.variable)}"`);
  lines.push(`${indent}operator: "${esc(normalized.operator || "equals")}"`);
  if (!isBlank(normalized.value)) lines.push(`${indent}value: "${esc(normalized.value)}"`);
  if (normalized.values && normalized.values.length) {
    lines.push(`${indent}values:`);
    normalized.values.forEach((item) => lines.push(`${indent}  - "${esc(item)}"`));
  }
}
function emitBranchYaml(indent, branch, lines) {
  lines.push(`${indent}-`);
  if (!isBlank(branch.name)) lines.push(`${indent}  name: "${esc(branch.name)}"`);
  if (branch.when) {
    lines.push(`${indent}  when:`);
    emitConditionYaml(`${indent}    `, branch.when, lines);
  }
  if (!isBlank(branch.method)) lines.push(`${indent}  method: "${esc(branch.method)}"`);
  if (!isBlank(branch.path)) lines.push(`${indent}  path: "${esc(branch.path)}"`);
  if (!isBlank(branch.url)) lines.push(`${indent}  url: "${esc(branch.url)}"`);
  if (!isBlank(branch.customHookRef)) lines.push(`${indent}  customHookRef: "${esc(branch.customHookRef)}"`);
  if (!isBlank(branch.customHookName)) lines.push(`${indent}  customHookName: "${esc(branch.customHookName)}"`);
  yamlValueLines(`${indent}  `, "customHookCode", branch.customHookCode, lines);
  if (branch.expectedStatus != null) lines.push(`${indent}  expectedStatus: ${branch.expectedStatus}`);
  yamlValueLines(`${indent}  `, "body", branch.body, lines);
  if (branch.checks && branch.checks.length) {
    lines.push(`${indent}  checks:`);
    branch.checks.forEach((check) => {
      lines.push(`${indent}    - type: "${esc(check.type || "")}"`);
      if (!isBlank(check.path)) lines.push(`${indent}      path: "${esc(check.path)}"`);
      if (check.value != null && !isBlank(check.value)) lines.push(`${indent}      value: "${esc(check.value)}"`);
    });
  }
  if (branch.captures && branch.captures.length) {
    lines.push(`${indent}  captures:`);
    branch.captures.forEach((capture) => {
      lines.push(`${indent}    - type: "${esc(capture.type || "")}"`);
      if (!isBlank(capture.path)) lines.push(`${indent}      path: "${esc(capture.path)}"`);
      if (!isBlank(capture.saveAs)) lines.push(`${indent}      saveAs: "${esc(capture.saveAs)}"`);
    });
  }
}

function emitYaml(plan) {
  if (!plan.applications || !Object.keys(plan.applications).length) return toYaml(plan);
  const lines = ["applications:"];
  Object.entries(plan.applications).forEach(([appName, app]) => {
    lines.push(`  "${esc(appName)}":`);
    if (app.enabled != null) lines.push(`    enabled: ${app.enabled}`);
    emitService("    ", app.service || {}, lines);
    if (!isBlank(app.activeEnvironment)) lines.push(`    activeEnvironment: "${esc(app.activeEnvironment)}"`);
    if (app.environments && Object.keys(app.environments).length) {
      lines.push(`    environments:`);
      Object.entries(app.environments).forEach(([envName, env]) => {
        lines.push(`      "${esc(envName)}":`);
        if (env.enabled != null) lines.push(`        enabled: ${env.enabled}`);
        if (!isBlank(env.baseUrl)) lines.push(`        baseUrl: "${esc(env.baseUrl)}"`);
        if (env.auth) {
          lines.push(`        auth:`);
          if (!isBlank(env.auth.type)) lines.push(`          type: "${esc(env.auth.type)}"`);
          if (!isBlank(env.auth.tokenEnv)) lines.push(`          tokenEnv: "${esc(env.auth.tokenEnv)}"`);
          if (!isBlank(env.auth.usernameEnv)) lines.push(`          usernameEnv: "${esc(env.auth.usernameEnv)}"`);
          if (!isBlank(env.auth.passwordEnv)) lines.push(`          passwordEnv: "${esc(env.auth.passwordEnv)}"`);
          if (!isBlank(env.auth.headerName)) lines.push(`          headerName: "${esc(env.auth.headerName)}"`);
          if (!isBlank(env.auth.headerValueEnv)) lines.push(`          headerValueEnv: "${esc(env.auth.headerValueEnv)}"`);
        }
        if (env.defaultHeaders && Object.keys(env.defaultHeaders).length) {
          lines.push(`        defaultHeaders:`);
          Object.keys(env.defaultHeaders).forEach((k) => lines.push(`          "${esc(k)}": "${esc(env.defaultHeaders[k])}"`));
        }
      });
    }
    if (app.injectionProfiles && Object.keys(app.injectionProfiles).length) {
      lines.push(`    injectionProfiles:`);
      Object.entries(app.injectionProfiles).forEach(([name, profile]) => {
        lines.push(`      "${esc(name)}":`);
        emitLoadProfile("        ", profile, lines);
      });
    }
    emitAssertions("    ", app.assertions, lines);
    lines.push(`    scenarios:`);
    (app.scenarios || []).forEach((sc) => {
      lines.push(`      - name: "${esc(sc.name || "")}"`);
      if (sc.load) {
        lines.push(`        load:`);
        emitLoadProfile("          ", sc.load, lines);
      }
      if (sc.flow && Object.keys(sc.flow).length) {
        lines.push(`        flow:`);
        if (sc.flow.repeatCount != null) lines.push(`          repeatCount: ${sc.flow.repeatCount}`);
        if (sc.flow.duringSec != null) lines.push(`          duringSec: ${sc.flow.duringSec}`);
        if (!isBlank(sc.flow.asLongAsVariable)) lines.push(`          asLongAsVariable: "${esc(sc.flow.asLongAsVariable)}"`);
        if (!isBlank(sc.flow.asLongAsEquals)) lines.push(`          asLongAsEquals: "${esc(sc.flow.asLongAsEquals)}"`);
        if (sc.flow.exitOnFail != null) lines.push(`          exitOnFail: ${sc.flow.exitOnFail}`);
      }
      if (sc.feeder && (!isBlank(sc.feeder.type) || !isBlank(sc.feeder.file))) {
        lines.push(`        feeder:`);
        if (!isBlank(sc.feeder.type)) lines.push(`          type: "${esc(sc.feeder.type)}"`);
        if (!isBlank(sc.feeder.file)) lines.push(`          file: "${esc(sc.feeder.file)}"`);
        if (!isBlank(sc.feeder.mode)) lines.push(`          mode: "${esc(sc.feeder.mode)}"`);
      }
      lines.push(`        steps:`);
      (sc.steps || []).forEach((step) => {
        lines.push(`          - name: "${esc(step.name || "")}"`);
        lines.push(`            method: "${esc(step.method || "")}"`);
        if (!isBlank(step.path)) lines.push(`            path: "${esc(step.path || "")}"`);
        if (!isBlank(step.url)) lines.push(`            url: "${esc(step.url || "")}"`);
        if (!isBlank(step.customHookRef)) lines.push(`            customHookRef: "${esc(step.customHookRef)}"`);
        if (!isBlank(step.customHookName)) lines.push(`            customHookName: "${esc(step.customHookName)}"`);
        yamlValueLines("            ", "customHookCode", step.customHookCode, lines);
        if (step.expectedStatus != null) lines.push(`            expectedStatus: ${step.expectedStatus}`);
        if (step.retryCount != null) lines.push(`            retryCount: ${step.retryCount}`);
        if (step.pauseMs != null) lines.push(`            pauseMs: ${step.pauseMs}`);
        if (step.requestTimeoutMs != null) lines.push(`            requestTimeoutMs: ${step.requestTimeoutMs}`);
        if (step.disableFollowRedirect != null) lines.push(`            disableFollowRedirect: ${step.disableFollowRedirect}`);
        if (step.disableUrlEncoding != null) lines.push(`            disableUrlEncoding: ${step.disableUrlEncoding}`);
        if (step.silent != null) lines.push(`            silent: ${step.silent}`);
        if (step.ignoreProtocolHeaders != null) lines.push(`            ignoreProtocolHeaders: ${step.ignoreProtocolHeaders}`);
        if (!isBlank(step.bodyType)) lines.push(`            bodyType: "${esc(step.bodyType)}"`);
        if (!isBlank(step.bodyFile)) lines.push(`            bodyFile: "${esc(step.bodyFile)}"`);
        if (step.condition && (!isBlank(step.condition.variable) || step.condition.equals != null || !isBlank(step.condition.operator) || (step.condition.values && step.condition.values.length))) {
          lines.push(`            condition:`);
          emitConditionYaml("              ", step.condition, lines);
        }
        if (!isBlank(step.elseMethod)) lines.push(`            elseMethod: "${esc(step.elseMethod)}"`);
        if (!isBlank(step.elsePath)) lines.push(`            elsePath: "${esc(step.elsePath)}"`);
        if (step.elseExpectedStatus != null) lines.push(`            elseExpectedStatus: ${step.elseExpectedStatus}`);
        yamlValueLines("            ", "body", step.body, lines);
        yamlValueLines("            ", "elseBody", step.elseBody, lines);
        if (step.branches && step.branches.length) {
          lines.push(`            branches:`);
          step.branches.forEach((branch) => emitBranchYaml("              ", branch, lines));
        }
        if (step.headers && Object.keys(step.headers).length) {
          lines.push(`            headers:`);
          Object.keys(step.headers).forEach((k) => lines.push(`              "${esc(k)}": "${esc(step.headers[k])}"`));
        }
        if (step.auth) {
          lines.push(`            auth:`);
          if (!isBlank(step.auth.type)) lines.push(`              type: "${esc(step.auth.type)}"`);
          if (!isBlank(step.auth.tokenEnv)) lines.push(`              tokenEnv: "${esc(step.auth.tokenEnv)}"`);
          if (!isBlank(step.auth.usernameEnv)) lines.push(`              usernameEnv: "${esc(step.auth.usernameEnv)}"`);
          if (!isBlank(step.auth.passwordEnv)) lines.push(`              passwordEnv: "${esc(step.auth.passwordEnv)}"`);
          if (!isBlank(step.auth.headerName)) lines.push(`              headerName: "${esc(step.auth.headerName)}"`);
          if (!isBlank(step.auth.headerValueEnv)) lines.push(`              headerValueEnv: "${esc(step.auth.headerValueEnv)}"`);
        }
        if (step.queryParams && Object.keys(step.queryParams).length) {
          lines.push(`            queryParams:`);
          Object.keys(step.queryParams).forEach((k) => lines.push(`              "${esc(k)}": "${esc(step.queryParams[k])}"`));
        }
        if (step.formParams && Object.keys(step.formParams).length) {
          lines.push(`            formParams:`);
          Object.keys(step.formParams).forEach((k) => lines.push(`              "${esc(k)}": "${esc(step.formParams[k])}"`));
        }
        if (step.formUploads && step.formUploads.length) {
          lines.push(`            formUploads:`);
          step.formUploads.forEach((upload) => {
            lines.push(`              - fieldName: "${esc(upload.fieldName || "")}"`);
            lines.push(`                filePath: "${esc(upload.filePath || "")}"`);
          });
        }
        if (step.checks && step.checks.length) {
          lines.push(`            checks:`);
          step.checks.forEach((check) => {
            lines.push(`              - type: "${esc(check.type || "")}"`);
            if (!isBlank(check.path)) lines.push(`                path: "${esc(check.path)}"`);
            if (check.value != null && !isBlank(check.value)) lines.push(`                value: "${esc(check.value)}"`);
          });
        }
        if (step.captures && step.captures.length) {
          lines.push(`            captures:`);
          step.captures.forEach((capture) => {
            lines.push(`              - type: "${esc(capture.type || "")}"`);
            if (!isBlank(capture.path)) lines.push(`                path: "${esc(capture.path)}"`);
            if (!isBlank(capture.saveAs)) lines.push(`                saveAs: "${esc(capture.saveAs)}"`);
          });
        }
      });
    });
  });
  return `${lines.join("\n")}\n`;
}

function javaEsc(v) {
  return String(v == null ? "" : v)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}
function javaId(v) {
  const raw = String(v == null ? "" : v).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const base = raw || "item";
  return /^[0-9]/.test(base) ? `n_${base}` : base;
}
function scalaConditionExpr(condition) {
  const normalized = normalizeCondition(condition);
  if (!normalized) return null;
  const variable = javaEsc(normalized.variable);
  const value = javaEsc(normalized.value == null ? "" : normalized.value);
  const values = (normalized.values || []).map((item) => javaEsc(item));
  switch (String(normalized.operator || "equals").toLowerCase()) {
    case "equals":
      return `#{${variable}.string() == '${value}'}`;
    case "notequals":
      return `#{${variable}.string() != '${value}'}`;
    case "contains":
      return `#{${variable}.string().contains('${value}')}`;
    case "in":
      return `#{${(values.length ? values : [value]).map((item) => `${variable}.string() == '${item}'`).join(" || ")}}`;
    case "exists":
      return `#{${variable}.exists()}`;
    case "notexists":
      return `#{!${variable}.exists()}`;
    default:
      return null;
  }
}
function generatedStepBranches(step) {
  if (step.branches && step.branches.length) return step.branches;
  if (step.condition && !isBlank(step.condition.variable) && (step.condition.equals != null || !isBlank(step.condition.operator) || !isBlank(step.condition.value) || (step.condition.values || []).length)) {
    return [{ name: "Primary", when: step.condition }];
  }
  return [];
}
function emitJavaAuthLines(lines, targetVar, auth, indent) {
  if (!auth || isBlank(auth.type)) return;
  const type = String(auth.type).toLowerCase();
  if (type === "bearer" && !isBlank(auth.tokenEnv)) {
    lines.push(`${indent}${targetVar} = ${targetVar}.header("Authorization", "Bearer " + requireEnv("${javaEsc(auth.tokenEnv)}"));`);
    return;
  }
  if (type === "basic" && !isBlank(auth.usernameEnv) && !isBlank(auth.passwordEnv)) {
    lines.push(`${indent}${targetVar} = ${targetVar}.header("Authorization", basicAuthHeader("${javaEsc(auth.usernameEnv)}", "${javaEsc(auth.passwordEnv)}"));`);
    return;
  }
  if (type === "header" && !isBlank(auth.headerName) && !isBlank(auth.headerValueEnv)) {
    lines.push(`${indent}${targetVar} = ${targetVar}.header("${javaEsc(auth.headerName)}", requireEnv("${javaEsc(auth.headerValueEnv)}"));`);
  }
}
function emitJavaCheckExpression(check) {
  const type = String((check || {}).type || "").toLowerCase();
  if (type === "bodycontains") return `substring("${javaEsc(check.value || "")}").exists()`;
  if (type === "regex") return `regex("${javaEsc(check.value || "")}").exists()`;
  if (type === "jsonpathexists") return `jsonPath("${javaEsc(check.path || "")}").exists()`;
  if (type === "jsonpathequals") return `jsonPath("${javaEsc(check.path || "")}").is("${javaEsc(check.value || "")}")`;
  if (type === "headerexists") return `header("${javaEsc(check.path || "")}").exists()`;
  if (type === "headerequals") return `header("${javaEsc(check.path || "")}").is("${javaEsc(check.value || "")}")`;
  if (type === "bodylengthgt") return `bodyLength().gt(${Number(check.value || 0)})`;
  if (type === "jmespathexists") return `jmesPath("${javaEsc(check.path || "")}").exists()`;
  if (type === "jmespathequals") return `jmesPath("${javaEsc(check.path || "")}").is("${javaEsc(check.value || "")}")`;
  if (type === "statusin") {
    const vals = String(check.value || "").split(",").map((x) => x.trim()).filter(Boolean).join(", ");
    return `status().in(${vals})`;
  }
  return null;
}
function emitJavaCaptureExpression(capture) {
  const type = String((capture || {}).type || "").toLowerCase();
  if (type === "jsonpath") return `jsonPath("${javaEsc(capture.path || "")}").saveAs("${javaEsc(capture.saveAs || "")}")`;
  if (type === "header") return `header("${javaEsc(capture.path || "")}").saveAs("${javaEsc(capture.saveAs || "")}")`;
  if (type === "regex") return `regex("${javaEsc(capture.path || "")}").saveAs("${javaEsc(capture.saveAs || "")}")`;
  return null;
}
function emitJavaRequestMethod(step) {
  const method = String((step || {}).method || "GET").toUpperCase();
  const target = !isBlank(step.url) ? step.url : step.path;
  return `${method.toLowerCase()}("${javaEsc(target || "")}")`;
}
function emitJavaRequestMethodElse(step) {
  const method = String((step || {}).elseMethod || "GET").toUpperCase();
  const target = step.elsePath || "";
  return `${method.toLowerCase()}("${javaEsc(target)}")`;
}
function emitJavaRequestMethodFromParts(method, target) {
  return `${String(method || "GET").toLowerCase()}("${javaEsc(target || "")}")`;
}
function emitJavaRequestBuilder(lines, methodName, step, useElseBranch) {
  const indent = "    ";
  const reqExpr = useElseBranch
    ? emitJavaRequestMethodFromParts(step.elseMethod, step.elsePath)
    : emitJavaRequestMethod(step);
  const bodyValue = useElseBranch ? (step.elseBody || "") : (step.body || "");
  const reqName = useElseBranch ? `${step.name} (else)` : step.name;
  lines.push(`${indent}private HttpRequestActionBuilder ${methodName}() {`);
  lines.push(`${indent}    HttpRequestActionBuilder req = http("${javaEsc(reqName || "Request")}").${reqExpr};`);
  Object.entries(useElseBranch ? (step.queryParams || {}) : (step.queryParams || {})).forEach(([k, v]) => {
    lines.push(`${indent}    req = req.queryParam("${javaEsc(k)}", "${javaEsc(v)}");`);
  });
  Object.entries(useElseBranch ? (step.headers || {}) : (step.headers || {})).forEach(([k, v]) => {
    lines.push(`${indent}    req = req.header("${javaEsc(k)}", "${javaEsc(v)}");`);
  });
  emitJavaAuthLines(lines, "req", step.auth, `${indent}    `);
  if (step.requestTimeoutMs != null) lines.push(`${indent}    req = req.requestTimeout(Duration.ofMillis(${Number(step.requestTimeoutMs)}));`);
  if (step.disableFollowRedirect) lines.push(`${indent}    req = req.disableFollowRedirect();`);
  if (step.disableUrlEncoding) lines.push(`${indent}    req = req.disableUrlEncoding();`);
  if (step.silent) lines.push(`${indent}    req = req.silent();`);
  if (step.ignoreProtocolHeaders) lines.push(`${indent}    req = req.ignoreProtocolHeaders();`);
  if ((step.formParams && Object.keys(step.formParams).length) || String(step.bodyType || "").toLowerCase() === "form") {
    Object.entries(step.formParams || {}).forEach(([k, v]) => {
      lines.push(`${indent}    req = req.formParam("${javaEsc(k)}", "${javaEsc(v)}");`);
    });
    lines.push(`${indent}    req = req.asFormUrlEncoded();`);
  } else if ((step.formUploads && step.formUploads.length) || String(step.bodyType || "").toLowerCase() === "multipart") {
    Object.entries(step.formParams || {}).forEach(([k, v]) => {
      lines.push(`${indent}    req = req.formParam("${javaEsc(k)}", "${javaEsc(v)}");`);
    });
    (step.formUploads || []).forEach((upload) => {
      lines.push(`${indent}    req = req.formUpload("${javaEsc(upload.fieldName || "")}", "${javaEsc(upload.filePath || "")}");`);
    });
    lines.push(`${indent}    req = req.asMultipartForm();`);
  } else if (!isBlank(useElseBranch ? (step.elseBody || "") : (step.bodyFile || "")) || !isBlank(bodyValue)) {
    if (!isBlank(step.bodyFile) && !useElseBranch) {
      lines.push(`${indent}    req = req.body(StringBody(session -> readFile("${javaEsc(step.bodyFile)}")));`);
    } else {
      lines.push(`${indent}    req = req.body(StringBody("${javaEsc(bodyValue)}"));`);
    }
    const bodyType = String(step.bodyType || "").toLowerCase();
    if (bodyType === "xml") lines.push(`${indent}    req = req.header("Content-Type", "application/xml");`);
    else if (bodyType === "text") lines.push(`${indent}    req = req.header("Content-Type", "text/plain");`);
    else lines.push(`${indent}    req = req.header("Content-Type", "application/json");`);
  }
  if (useElseBranch) {
    if (step.elseExpectedStatus != null) lines.push(`${indent}    req = req.check(status().is(${Number(step.elseExpectedStatus)}));`);
    else if (step.expectedStatus != null) lines.push(`${indent}    req = req.check(status().is(${Number(step.expectedStatus)}));`);
  } else if (step.expectedStatus != null) {
    lines.push(`${indent}    req = req.check(status().is(${Number(step.expectedStatus)}));`);
  }
  (step.checks || []).forEach((check) => {
    const expr = emitJavaCheckExpression(check);
    if (expr) lines.push(`${indent}    req = req.check(${expr});`);
  });
  (step.captures || []).forEach((capture) => {
    const expr = emitJavaCaptureExpression(capture);
    if (expr) lines.push(`${indent}    req = req.check(${expr});`);
  });
  lines.push(`${indent}    return req;`);
  lines.push(`${indent}}`);
  lines.push("");
}
function emitJavaInjection(lines, scenarioVar, load, indent) {
  const type = String(load.injectionType || "").toLowerCase();
  if (type === "pacedusers") {
    lines.push(`${indent}return ${scenarioVar}.injectOpen(atOnceUsers(${Number(load.users || 1)}));`);
    return;
  }
  if (type === "atonceusers") {
    lines.push(`${indent}return ${scenarioVar}.injectOpen(atOnceUsers(${Number(load.users || 1)}));`);
    return;
  }
  if (type === "constantuserspersec") {
    lines.push(`${indent}return ${scenarioVar}.injectOpen(constantUsersPerSec(${Number(load.rate || 1)}).during(Duration.ofSeconds(${Number(load.durationSec || 1)})));`);
    return;
  }
  if (type === "rampuserspersec") {
    lines.push(`${indent}return ${scenarioVar}.injectOpen(rampUsersPerSec(${Number(load.fromRps || 1)}).to(${Number(load.toRps || 1)}).during(Duration.ofSeconds(${Number(load.durationSec || 1)})));`);
    return;
  }
  if (type === "incrementuserspersec") {
    const start = load.startRate != null ? `.startingFrom(${Number(load.startRate)})` : "";
    lines.push(`${indent}return ${scenarioVar}.injectOpen(incrementUsersPerSec(${Number(load.incrementBy || 1)}).times(${Number(load.levelCount || 1)}).eachLevelLasting(Duration.ofSeconds(${Number(load.levelDurationSec || 1)}))${start});`);
    return;
  }
  if (type === "constantconcurrentusers") {
    lines.push(`${indent}return ${scenarioVar}.injectClosed(constantConcurrentUsers(${Number(load.users || 1)}).during(Duration.ofSeconds(${Number(load.durationSec || 1)})));`);
    return;
  }
  if (type === "rampconcurrentusers") {
    lines.push(`${indent}return ${scenarioVar}.injectClosed(rampConcurrentUsers(${Number(load.fromUsers || 1)}).to(${Number(load.toUsers || 1)}).during(Duration.ofSeconds(${Number(load.durationSec || 1)})));`);
    return;
  }
  lines.push(`${indent}return ${scenarioVar}.injectOpen(rampUsers(${Number(load.users || 1)}).during(Duration.ofSeconds(${Number(load.rampDurationSec || 1)})));`);
}
function emitGeneratedGatlingScript(plan) {
  function scalaCheckExpression(check) {
    const type = String((check || {}).type || "").toLowerCase();
    if (type === "bodycontains") return `substring("${javaEsc(check.value || "")}").exists`;
    if (type === "regex") return `regex("${javaEsc(check.value || "")}").exists`;
    if (type === "jsonpathexists") return `jsonPath("${javaEsc(check.path || "")}").exists`;
    if (type === "jsonpathequals") return `jsonPath("${javaEsc(check.path || "")}").is("${javaEsc(check.value || "")}")`;
    if (type === "headerexists") return `header("${javaEsc(check.path || "")}").exists`;
    if (type === "headerequals") return `header("${javaEsc(check.path || "")}").is("${javaEsc(check.value || "")}")`;
    if (type === "bodylengthgt") return `bodyLength.gt(${Number(check.value || 0)})`;
    if (type === "jmespathexists") return `jmesPath("${javaEsc(check.path || "")}").exists`;
    if (type === "jmespathequals") return `jmesPath("${javaEsc(check.path || "")}").is("${javaEsc(check.value || "")}")`;
    if (type === "statusin") return `status.in(${String(check.value || "").split(",").map((x) => x.trim()).filter(Boolean).join(", ")})`;
    return null;
  }
  function scalaCaptureExpression(capture) {
    const type = String((capture || {}).type || "").toLowerCase();
    if (type === "jsonpath") return `jsonPath("${javaEsc(capture.path || "")}").saveAs("${javaEsc(capture.saveAs || "")}")`;
    if (type === "header") return `header("${javaEsc(capture.path || "")}").saveAs("${javaEsc(capture.saveAs || "")}")`;
    if (type === "regex") return `regex("${javaEsc(capture.path || "")}").saveAs("${javaEsc(capture.saveAs || "")}")`;
    return null;
  }
  function scalaRequestMethod(method, target) {
    return `.${String(method || "GET").toLowerCase()}("${javaEsc(target || "")}")`;
  }
  function emitScalaAuth(lines, targetVar, auth, indent) {
    if (!auth || isBlank(auth.type)) return;
    const type = String(auth.type).toLowerCase();
    if (type === "bearer" && !isBlank(auth.tokenEnv)) lines.push(`${indent}${targetVar} = ${targetVar}.header("Authorization", "Bearer " + requireEnv("${javaEsc(auth.tokenEnv)}"))`);
    if (type === "basic" && !isBlank(auth.usernameEnv) && !isBlank(auth.passwordEnv)) lines.push(`${indent}${targetVar} = ${targetVar}.header("Authorization", basicAuthHeader("${javaEsc(auth.usernameEnv)}", "${javaEsc(auth.passwordEnv)}"))`);
    if (type === "header" && !isBlank(auth.headerName) && !isBlank(auth.headerValueEnv)) lines.push(`${indent}${targetVar} = ${targetVar}.header("${javaEsc(auth.headerName)}", requireEnv("${javaEsc(auth.headerValueEnv)}"))`);
  }
  function emitScalaRequest(lines, name, step, useElse) {
    const indent = "  ";
    const method = useElse ? (step.elseMethod || "GET") : (step.method || "GET");
    const target = useElse ? (step.elsePath || "") : (!isBlank(step.url) ? step.url : step.path);
    const reqName = useElse ? `${step.name} (else)` : step.name;
    const body = useElse ? (step.elseBody || "") : (step.body || "");
    lines.push(`${indent}private def ${name}: HttpRequestBuilder = {`);
    lines.push(`${indent}  var req = http("${javaEsc(reqName || "Request")}")${scalaRequestMethod(method, target)}`);
    Object.entries(step.queryParams || {}).forEach(([k, v]) => {
      lines.push(`${indent}  req = req.queryParam("${javaEsc(k)}", "${javaEsc(v)}")`);
    });
    Object.entries(step.headers || {}).forEach(([k, v]) => {
      lines.push(`${indent}  req = req.header("${javaEsc(k)}", "${javaEsc(v)}")`);
    });
    emitScalaAuth(lines, "req", step.auth, `${indent}  `);
    if (step.requestTimeoutMs != null) lines.push(`${indent}  req = req.requestTimeout(${Number(step.requestTimeoutMs)}.milliseconds)`);
    if (step.disableFollowRedirect) lines.push(`${indent}  req = req.disableFollowRedirect`);
    if (step.disableUrlEncoding) lines.push(`${indent}  req = req.disableUrlEncoding`);
    if (step.silent) lines.push(`${indent}  req = req.silent`);
    if (step.ignoreProtocolHeaders) lines.push(`${indent}  req = req.ignoreProtocolHeaders`);
    if ((step.formUploads && step.formUploads.length) || String(step.bodyType || "").toLowerCase() === "multipart") {
      Object.entries(step.formParams || {}).forEach(([k, v]) => {
        lines.push(`${indent}  req = req.formParam("${javaEsc(k)}", "${javaEsc(v)}")`);
      });
      (step.formUploads || []).forEach((upload) => {
        lines.push(`${indent}  req = req.formUpload("${javaEsc(upload.fieldName || "")}", "${javaEsc(upload.filePath || "")}")`);
      });
      lines.push(`${indent}  req = req.asMultipartForm`);
    } else if ((step.formParams && Object.keys(step.formParams).length) || String(step.bodyType || "").toLowerCase() === "form") {
      Object.entries(step.formParams || {}).forEach(([k, v]) => {
        lines.push(`${indent}  req = req.formParam("${javaEsc(k)}", "${javaEsc(v)}")`);
      });
      lines.push(`${indent}  req = req.asFormUrlEncoded`);
    } else if (!isBlank(useElse ? step.elseBody : step.bodyFile) || !isBlank(body)) {
      if (!useElse && !isBlank(step.bodyFile)) lines.push(`${indent}  req = req.body(StringBody(readFile("${javaEsc(step.bodyFile)}")))`);
      else lines.push(`${indent}  req = req.body(StringBody("${javaEsc(body)}"))`);
      const bodyType = String(step.bodyType || "").toLowerCase();
      if (bodyType === "xml") lines.push(`${indent}  req = req.header("Content-Type", "application/xml")`);
      else if (bodyType === "text") lines.push(`${indent}  req = req.header("Content-Type", "text/plain")`);
      else lines.push(`${indent}  req = req.header("Content-Type", "application/json")`);
    }
    if (useElse) {
      if (step.elseExpectedStatus != null) lines.push(`${indent}  req = req.check(status.is(${Number(step.elseExpectedStatus)}))`);
      else if (step.expectedStatus != null) lines.push(`${indent}  req = req.check(status.is(${Number(step.expectedStatus)}))`);
    } else if (step.expectedStatus != null) {
      lines.push(`${indent}  req = req.check(status.is(${Number(step.expectedStatus)}))`);
    }
    (step.checks || []).forEach((check) => {
      const expr = scalaCheckExpression(check);
      if (expr) lines.push(`${indent}  req = req.check(${expr})`);
    });
    (step.captures || []).forEach((capture) => {
      const expr = scalaCaptureExpression(capture);
      if (expr) lines.push(`${indent}  req = req.check(${expr})`);
    });
    lines.push(`${indent}  req`);
    lines.push(`${indent}}`);
    lines.push("");
  }
  function buildBaseChain(sc, baseId) {
    const chainLines = ["exec(session => session)"];
    (sc.steps || []).forEach((step, idx) => {
      const stepId = `${baseId}_step_${idx + 1}`;
      const branchRules = generatedStepBranches(step);
      if (branchRules.length) {
        branchRules.forEach((branch, branchIdx) => {
          const expr = scalaConditionExpr(branch.when);
          const branchVar = `${stepId}_branch_${branchIdx + 1}`;
          if (branchIdx === 0) {
            chainLines.push(`  .doIfOrElse("${javaEsc(expr)}") {`);
            chainLines.push(`    exec(${branchVar})`);
            chainLines.push("  } {");
          } else {
            chainLines.push(`    doIfOrElse("${javaEsc(expr)}") {`);
            chainLines.push(`      exec(${branchVar})`);
            chainLines.push("    } {");
          }
        });
        if (!isBlank(step.elseMethod) && !isBlank(step.elsePath)) {
          chainLines.push(`    exec(${stepId}_else)`);
        } else if (branchRules.some((branch) => branch.name === "Primary")) {
          chainLines.push(`    exec(${stepId})`);
        } else {
          chainLines.push("    exec(session => session)");
        }
        for (let branchIdx = 0; branchIdx < branchRules.length; branchIdx += 1) {
          chainLines.push(branchIdx === 0 ? "  }" : "    }");
        }
      } else {
        chainLines.push(`  .exec(${stepId})`);
      }
      if (step.pauseMs != null && Number(step.pauseMs) > 0) chainLines.push(`  .pause(${Number(step.pauseMs)}.milliseconds)`);
    });
    return chainLines;
  }
  function buildWrappedChain(sc, baseName) {
    const wrappers = [];
    if (sc.flow && sc.flow.repeatCount != null) wrappers.push({ type: "repeat", value: Number(sc.flow.repeatCount) });
    if (sc.flow && sc.flow.duringSec != null) wrappers.push({ type: "during", value: Number(sc.flow.duringSec) });
    if (sc.flow && !isBlank(sc.flow.asLongAsVariable) && !isBlank(sc.flow.asLongAsEquals)) wrappers.push({ type: "asLongAs", variable: sc.flow.asLongAsVariable, value: sc.flow.asLongAsEquals });
    return wrappers;
  }
  function emitScalaInjection(lines, scnVar, load, indent) {
    const type = String(load.injectionType || "").toLowerCase();
    if (type === "pacedusers") {
      lines.push(`${indent}${scnVar}.injectOpen(atOnceUsers(${Number(load.users || 1)}))`);
      return;
    }
    if (type === "atonceusers") {
      lines.push(`${indent}${scnVar}.injectOpen(atOnceUsers(${Number(load.users || 1)}))`);
      return;
    }
    if (type === "constantuserspersec") {
      lines.push(`${indent}${scnVar}.injectOpen(constantUsersPerSec(${Number(load.rate || 1)}) during (${Number(load.durationSec || 1)}.seconds))`);
      return;
    }
    if (type === "rampuserspersec") {
      lines.push(`${indent}${scnVar}.injectOpen(rampUsersPerSec(${Number(load.fromRps || 1)}) to ${Number(load.toRps || 1)} during (${Number(load.durationSec || 1)}.seconds))`);
      return;
    }
    if (type === "incrementuserspersec") {
      const start = load.startRate != null ? ` startingFrom ${Number(load.startRate)}` : "";
      lines.push(`${indent}${scnVar}.injectOpen(incrementUsersPerSec(${Number(load.incrementBy || 1)}) times ${Number(load.levelCount || 1)} eachLevelLasting (${Number(load.levelDurationSec || 1)}.seconds)${start})`);
      return;
    }
    if (type === "constantconcurrentusers") {
      lines.push(`${indent}${scnVar}.injectClosed(constantConcurrentUsers(${Number(load.users || 1)}) during (${Number(load.durationSec || 1)}.seconds))`);
      return;
    }
    if (type === "rampconcurrentusers") {
      lines.push(`${indent}${scnVar}.injectClosed(rampConcurrentUsers(${Number(load.fromUsers || 1)}) to ${Number(load.toUsers || 1)} during (${Number(load.durationSec || 1)}.seconds))`);
      return;
    }
    lines.push(`${indent}${scnVar}.injectOpen(rampUsers(${Number(load.users || 1)}) during (${Number(load.rampDurationSec || 1)}.seconds))`);
  }
  const lines = [];
  lines.push("import io.gatling.core.Predef._");
  lines.push("import io.gatling.http.Predef._");
  lines.push("import scala.concurrent.duration._");
  lines.push("import java.nio.charset.StandardCharsets");
  lines.push("import java.nio.file.{Files, Paths}");
  lines.push("import java.util.Base64");
  lines.push("");
  lines.push("class GeneratedScenarioSimulation extends Simulation {");
  lines.push("");
  Object.entries(plan.applications || {}).forEach(([appName, app]) => {
    if (app.enabled === false) return;
    const appId = javaId(appName);
    const effectiveService = buildEffectiveService(app.service || {}, app.activeEnvironment && app.environments ? app.environments[app.activeEnvironment] : null);
    lines.push(`  private val http_${appId} = {`);
    lines.push(`    var protocol = http.baseUrl("${javaEsc((effectiveService || {}).baseUrl || "")}")`);
    Object.entries((effectiveService || {}).defaultHeaders || {}).forEach(([k, v]) => {
      lines.push(`    protocol = protocol.header("${javaEsc(k)}", "${javaEsc(v)}")`);
    });
    emitScalaAuth(lines, "protocol", (effectiveService || {}).auth, "    ");
    lines.push("    protocol");
    lines.push("  }");
    lines.push("");
      (app.scenarios || []).forEach((sc) => {
      const baseId = `${appId}_${javaId(sc.name)}`;
      (sc.steps || []).forEach((step, idx) => {
        const stepId = `${baseId}_step_${idx + 1}`;
        emitScalaRequest(lines, stepId, step, false);
        generatedStepBranches(step).forEach((branch, branchIdx) => {
          emitScalaRequest(lines, `${stepId}_branch_${branchIdx + 1}`, mergeStepOverride(step, branch, "(branch)"), false);
        });
        if (!isBlank(step.elseMethod) && !isBlank(step.elsePath)) emitScalaRequest(lines, `${stepId}_else`, step, true);
      });
      lines.push(`  private val ${baseId}_baseChain = {`);
      buildBaseChain(sc, baseId).forEach((line) => lines.push(`    ${line}`));
      lines.push("  }");
      lines.push("");
      const wrappers = buildWrappedChain(sc, `${baseId}_baseChain`);
      let current = `${baseId}_baseChain`;
      wrappers.forEach((wrapper, idx) => {
        const next = `${baseId}_chain_${idx + 1}`;
        if (wrapper.type === "repeat") {
          lines.push(`  private val ${next} = repeat(${wrapper.value}) { ${current} }`);
        } else if (wrapper.type === "during") {
          lines.push(`  private val ${next} = during(${wrapper.value}.seconds) { ${current} }`);
        } else if (wrapper.type === "asLongAs") {
          lines.push(`  private val ${next} = asLongAs("#{${javaEsc(wrapper.variable)}.string() == '${javaEsc(wrapper.value)}'}") { ${current} }`);
        }
        current = next;
      });
      if (sc.flow && sc.flow.exitOnFail) {
        lines.push(`  private val ${baseId}_chain = ${current}.exitHereIfFailed`)
      } else {
        lines.push(`  private val ${baseId}_chain = ${current}`)
      }
      lines.push("");
      lines.push(`  private val ${baseId}_scenario = {`);
      lines.push(`    var scn = scenario("${javaEsc(appName)} :: ${javaEsc(sc.name)}")`);
      if (sc.feeder && sc.feeder.type === "csv" && !isBlank(sc.feeder.file)) {
        const mode = String(sc.feeder.mode || "queue").toLowerCase();
        if (mode === "circular") lines.push(`    scn = scn.feed(csv("${javaEsc(sc.feeder.file)}").circular)`);
        else if (mode === "random") lines.push(`    scn = scn.feed(csv("${javaEsc(sc.feeder.file)}").random)`);
        else lines.push(`    scn = scn.feed(csv("${javaEsc(sc.feeder.file)}"))`);
      }
      const load = (sc.load && sc.load.profileRef && app.injectionProfiles && app.injectionProfiles[sc.load.profileRef]) ? app.injectionProfiles[sc.load.profileRef] : (sc.load || {});
      if (String(load.injectionType || "").toLowerCase() === "pacedusers") {
        lines.push(`    scn = scn.exec(during(${Number(load.durationSec || 1)}.seconds) { pace(${Number(load.paceMs || 1000)}.milliseconds).exec(${baseId}_chain) })`);
      } else {
        lines.push(`    scn = scn.exec(${baseId}_chain)`);
      }
      lines.push("    scn");
      lines.push("  }");
      lines.push("");
    });
  });
  lines.push("  setUp(");
  const setupLines = [];
  Object.entries(plan.applications || {}).forEach(([appName, app]) => {
    if (app.enabled === false) return;
    const appId = javaId(appName);
    (app.scenarios || []).forEach((sc) => {
      const baseId = `${appId}_${javaId(sc.name)}`;
      const load = (sc.load && sc.load.profileRef && app.injectionProfiles && app.injectionProfiles[sc.load.profileRef]) ? app.injectionProfiles[sc.load.profileRef] : (sc.load || {});
      const injection = [];
      emitScalaInjection(injection, `${baseId}_scenario`, load, "    ");
      setupLines.push(`${injection[0]}.protocols(http_${appId})`);
    });
  });
  lines.push(`    ${setupLines.join(",\n    ")}`);
  lines.push("  )");
  const assertionLines = [];
  Object.entries(plan.applications || {}).forEach(([appName, app]) => {
    if (app.enabled === false) return;
    const asr = app.assertions || null;
    (app.scenarios || []).forEach((sc) => {
      if (asr && asr.minSuccessPercent != null) assertionLines.push(`details("${javaEsc(appName)} :: ${javaEsc(sc.name)}").successfulRequests.percent.gte(${Number(asr.minSuccessPercent)})`);
      if (asr && asr.maxResponseTimeMs != null) assertionLines.push(`details("${javaEsc(appName)} :: ${javaEsc(sc.name)}").responseTime.max.lte(${Number(asr.maxResponseTimeMs)})`);
      if (asr && asr.p90ResponseTimeMs != null) assertionLines.push(`details("${javaEsc(appName)} :: ${javaEsc(sc.name)}").responseTime.percentile(90).lte(${Number(asr.p90ResponseTimeMs)})`);
      if (asr && asr.p95ResponseTimeMs != null) assertionLines.push(`details("${javaEsc(appName)} :: ${javaEsc(sc.name)}").responseTime.percentile3.lte(${Number(asr.p95ResponseTimeMs)})`);
      if (asr && asr.p99ResponseTimeMs != null) assertionLines.push(`details("${javaEsc(appName)} :: ${javaEsc(sc.name)}").responseTime.percentile(99).lte(${Number(asr.p99ResponseTimeMs)})`);
    });
  });
  if (assertionLines.length) {
    lines.push("    .assertions(");
    lines.push(`      ${assertionLines.join(",\n      ")}`);
    lines.push("    )");
  }
  lines.push("");
  lines.push('  private def requireEnv(name: String): String = {');
  lines.push("    val value = sys.env.getOrElse(name, \"\")");
  lines.push('    require(value.nonEmpty, s"Missing env var: $name")');
  lines.push("    value");
  lines.push("  }");
  lines.push("");
  lines.push("  private def basicAuthHeader(userEnv: String, passEnv: String): String = {");
  lines.push('    val raw = s"${requireEnv(userEnv)}:${requireEnv(passEnv)}"');
  lines.push('    "Basic " + Base64.getEncoder.encodeToString(raw.getBytes(StandardCharsets.UTF_8))');
  lines.push("  }");
  lines.push("");
  lines.push("  private def readFile(path: String): String = Files.readString(Paths.get(path))");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

async function runConcurrentPlan(plan, sourceLabel) {
  const errors = validateEnhancedPlan(plan);
  showValidation(errors);
  if (errors.length) {
    alert("Please fix validation issues before running preview.");
    return;
  }
  const iterations = Number(q("iterations").value);
  state.reports = {};
  const appNames = Object.keys(plan.applications).filter((n) => plan.applications[n].enabled !== false);
  if (!appNames.length) { alert("No enabled applications. Enable at least one application."); return; }
  for (const appName of appNames) {
    const app = plan.applications[appName];
    state.reports[appName] = {};
    const envNames = Object.keys(app.environments || {}).filter((e) => app.environments[e].enabled !== false);
    if (!envNames.length) state.reports[appName].default = await executeForEnvironment(appName, "default", app.service, app.scenarios || [], iterations);
    else for (const envName of envNames) state.reports[appName][envName] = await executeForEnvironment(appName, envName, buildEffectiveService(app.service, app.environments[envName]), app.scenarios || [], iterations);
  }
  activeReportApp = null; activeReportEnv = null;
  renderReportAppTabs();
  renderReportForCurrent();
  setRunStatusTiles("Preview Complete", "preview", "-", "Preview Data", `${sourceLabel || "Browser"} preview run completed. The dashboard below reflects preview execution, not backend Gatling output.`);
  goToFlowPage(4);
}
async function runConcurrent() {
  return runConcurrentPlan(collectEnhancedPlan(), "Browser");
}

function generateYaml() {
  const yaml = getEffectiveGeneratedYaml();
  if (yaml == null) return;
  yamlOut.textContent = yaml;
  if (state.uiMode === "expert" && q("rawYamlEditor") && !q("rawYamlEditor").value.trim()) q("rawYamlEditor").value = yaml;
  if (gatlingScriptOut) gatlingScriptOut.textContent = emitGeneratedGatlingScript(collectEnhancedPlan());
}
function downloadYaml() {
  const content = getEffectiveYamlForExecution();
  if (content == null) return;
  yamlOut.textContent = content;
  const blob = new Blob([content], { type: "text/yaml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-api-config.yaml";
  a.click();
  URL.revokeObjectURL(a.href);
}
function downloadGatlingScript() {
  const plan = collectEnhancedPlan();
  const errors = validateEnhancedPlan(plan);
  showValidation(errors);
  if (errors.length) {
    alert("Please fix validation issues before downloading the Gatling script.");
    return;
  }
  const content = emitGeneratedGatlingScript(plan);
  if (gatlingScriptOut) gatlingScriptOut.textContent = content;
  const blob = new Blob([content], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "GeneratedScenarioSimulation.scala";
  a.click();
  URL.revokeObjectURL(a.href);
}
function sanitizeHookClassName(raw, fallbackName) {
  const cleaned = String(raw || "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = cleaned || fallbackName || "GeneratedHook";
  return /^[0-9]/.test(base) ? `H_${base}` : base;
}
function buildGeneratedHookSource(className, codeSnippet) {
  const body = String(codeSnippet || "").trim();
  const safeBody = body || "session = session;";
  return `package com.example.gatling.generated.hooks;

import com.example.gatling.config.ConfigModels;
import com.example.gatling.extensions.StepHookExtension;
import io.gatling.javaapi.core.Session;

public class ${className} implements StepHookExtension {
    @Override
    public Session before(Session session, ConfigModels.RequestStep step) {
${safeBody.split("\n").map((line) => `        ${line}`).join("\n")}
        return session;
    }
}
`;
}
function encodeHookSourcesPayload(hookSources) {
  if (!hookSources || !hookSources.length) return "";
  return hookSources.map((item) => {
    const b64 = btoa(unescape(encodeURIComponent(item.source || "")));
    return `${item.className}|${b64}`;
  }).join("\n");
}
function preparePlanForBackend(planInput) {
  const plan = JSON.parse(JSON.stringify(planInput || {}));
  const hookSources = [];
  const used = new Set();
  let counter = 1;
  Object.entries(plan.applications || {}).forEach(([appName, app]) => {
    (app.scenarios || []).forEach((scenario, scenarioIdx) => {
      (scenario.steps || []).forEach((step, stepIdx) => {
        if (!isBlank(step.customHookCode)) {
          const fallback = `StepHook_${sanitizeHookClassName(appName)}_${scenarioIdx + 1}_${stepIdx + 1}_${counter++}`;
          const className = sanitizeHookClassName(step.customHookName, fallback);
          const unique = used.has(className) ? `${className}_${counter++}` : className;
          used.add(unique);
          const fqcn = `com.example.gatling.generated.hooks.${unique}`;
          step.customHookRef = fqcn;
          hookSources.push({ className: unique, source: buildGeneratedHookSource(unique, step.customHookCode) });
        }
        (step.branches || []).forEach((branch, branchIdx) => {
          if (!isBlank(branch.customHookCode)) {
            const fallback = `BranchHook_${sanitizeHookClassName(appName)}_${scenarioIdx + 1}_${stepIdx + 1}_${branchIdx + 1}_${counter++}`;
            const className = sanitizeHookClassName(branch.customHookName, fallback);
            const unique = used.has(className) ? `${className}_${counter++}` : className;
            used.add(unique);
            const fqcn = `com.example.gatling.generated.hooks.${unique}`;
            branch.customHookRef = fqcn;
            hookSources.push({ className: unique, source: buildGeneratedHookSource(unique, branch.customHookCode) });
          }
        });
      });
    });
  });
  return { plan, hookSources, hookSourcesPayload: encodeHookSourcesPayload(hookSources) };
}
async function compileCustomHooks(planInput) {
  const apiBase = (q("runnerApiBase").value || "").replace(/\/$/, "");
  if (!apiBase) {
    alert("Runner API base URL is required.");
    return;
  }
  const prep = preparePlanForBackend(planInput);
  if (!prep.hookSources.length) {
    realRunStatus.textContent = "No custom hook code found to compile.";
    return;
  }
  const ok = await checkRunnerConnection();
  if (!ok) return;
  realRunStatus.textContent = "Compiling custom hooks...";
  try {
    const res = await fetch(`${apiBase}/api/hooks/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hookSourcesPayload: prep.hookSourcesPayload })
    });
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (_) { data = { ok: false, error: raw }; }
    if (!res.ok || !data.ok) {
      realRunStatus.textContent = data.error || "Hook compile failed.";
      detailPanel.textContent = data.output || data.error || raw;
      return;
    }
    realRunStatus.textContent = data.message || "Custom hooks compiled successfully.";
    detailPanel.textContent = data.output || "Hooks compiled.";
  } catch (e) {
    realRunStatus.textContent = "Failed to compile hooks.";
    detailPanel.textContent = `Hook compile error: ${e && e.message ? e.message : "unknown"}`;
  }
}
function loadHookExampleIntoCurrentStep() {
  const firstStep = document.querySelector(".scenario .endpoint");
  if (!firstStep) {
    alert("Add at least one scenario and one API step first.");
    return;
  }
  const hookName = firstStep.querySelector(".custom-hook-name");
  const hookCode = firstStep.querySelector(".custom-hook-code");
  const reqSection = firstStep.querySelector(".sec-request");
  if (reqSection) {
    reqSection.classList.remove("is-hidden");
    reqSection.open = true;
  }
  if (hookName && !hookName.value.trim()) hookName.value = "DemoTraceHook";
  if (hookCode && !hookCode.value.trim()) {
    hookCode.value = [
      "session = session.set(\"traceId\", java.util.UUID.randomUUID().toString());",
      "session = session.set(\"demoFlag\", \"phase1\");"
    ].join("\n");
  }
  updateEndpointSummary(firstStep);
  realRunStatus.textContent = "Demo custom hook code loaded into first API step.";
}
async function runSavedPreviewSuite() {
  const plan = getSelectedSavedSuitePlan();
  if (!plan) return;
  return runConcurrentPlan(plan, "Saved suite");
}
async function runSavedRealSuite() {
  if (shouldUseRawYaml()) {
    alert("Turn off Raw YAML override before executing a saved suite directly.");
    return;
  }
  const plan = getSelectedSavedSuitePlan();
  if (!plan) return;
  return runRealLoadPlan(plan, "saved suite");
}
function normalizeReportLink(raw) { const v = (raw || "").trim(); if (!v) return ""; if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("file:///")) return v; if (/^[a-zA-Z]:\\/.test(v)) return "file:///" + v.replace(/\\/g, "/"); return v; }
function openGatlingReport() { const link = normalizeReportLink(q("gatlingReportLink").value); if (!link) { alert("Please provide a Gatling report URL/path first."); return; } window.open(link, "_blank"); }
async function checkRunnerConnection() {
  const apiBase = (q("runnerApiBase").value || "").replace(/\/$/, "");
  if (!apiBase) {
    realRunStatus.textContent = "Runner API base URL is required.";
    return false;
  }
  realRunStatus.textContent = "Checking runner health...";
  try {
    const res = await fetch(`${apiBase}/api/health`);
    if (!res.ok) {
      realRunStatus.textContent = `Runner responded with HTTP ${res.status}.`;
      return false;
    }
    realRunStatus.textContent = "Runner is reachable.";
    return true;
  } catch (e) {
    realRunStatus.textContent =
      "Runner unreachable. Start `run-ui-backend.bat` and keep it running, then click Check Runner again.";
    detailPanel.textContent = `Runner connectivity error: ${e && e.message ? e.message : "Failed to fetch"}`;
    return false;
  }
}
async function startRunnerFromUi() {
  const apiBase = (q("runnerApiBase").value || "").replace(/\/$/, "");
  if (!apiBase) {
    realRunStatus.textContent = "Runner API base URL is required.";
    return false;
  }
  realRunStatus.textContent = "Checking runner status before start...";
  const healthy = await checkRunnerConnection();
  if (healthy) {
    detailPanel.textContent = "Runner is already active and reachable.";
    return true;
  }
  const command = "run-ui-backend.bat";
  realRunStatus.textContent = "Runner is not reachable. Start command added to diagnostics.";
  detailPanel.textContent = `Runner could not be started directly from the browser.\nStart it in a terminal from the gatling-api-tool folder:\n${command}\n\nAfter it starts, click Check Runner.`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(command);
      detailPanel.textContent += "\n\nStart command copied to clipboard.";
    } catch (_) {
      // Clipboard write can fail when browser blocks permission.
    }
  }
  return false;
}
async function runRealLoadPlan(plan, sourceLabel) {
  const apiBase = (q("runnerApiBase").value || "").replace(/\/$/, "");
  if (!apiBase) {
    alert("Runner API base URL is required.");
    return;
  }
  const errors = validateEnhancedPlan(plan);
  showValidation(errors);
  if (errors.length) {
    alert("Please fix validation issues before running the real load.");
    return;
  }
  const prepared = preparePlanForBackend(plan);
  const configYaml = emitYaml(prepared.plan);
  if (configYaml == null) return;
  const ok = await checkRunnerConnection();
  if (!ok) return;
  realRunStatus.textContent = "Submitting real load run to backend...";
  setRunStatusTiles("Submitting", "-", "-", "Pending", `Submitting ${sourceLabel || "current"} run to backend...`);
  try {
    const res = await fetch(`${apiBase}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ configYaml, hookSourcesPayload: prepared.hookSourcesPayload })
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = { ok: false, error: "Runner returned non-JSON response", output: raw };
    }
    if (!res.ok) {
      realRunStatus.textContent = data.error || "Failed to submit run to backend.";
      detailPanel.textContent = data.output || data.error || "Unknown error";
      setRunStatusTiles("Submission Failed", "-", "-", "Unavailable", data.error || "Backend did not accept the run request.");
      goToFlowPage(4);
      return;
    }
    activeRunJobId = data.jobId || null;
    realRunStatus.textContent = `Run accepted by backend${data.jobId ? ` (job ${data.jobId})` : ""}.`;
    detailPanel.textContent = "Waiting for live backend output...";
    setRunStatusTiles("Queued", data.runId || "-", data.jobId || "-", "Pending", data.message || "Run accepted by backend.");
    goToFlowPage(4);
    stopRunStatusPolling();
    await pollRunStatus();
    runStatusPollTimer = setInterval(pollRunStatus, 2000);
  } catch (e) {
    realRunStatus.textContent = "Unable to reach runner backend. Use Check Runner first.";
    detailPanel.textContent = `Runner error: ${e && e.message ? e.message : "unknown"}`;
    setRunStatusTiles("Runner Error", "-", "-", "Unavailable", `Runner error: ${e && e.message ? e.message : "unknown"}`);
  }
}
async function runRealLoad() {
  if (shouldUseRawYaml()) {
    const apiBase = (q("runnerApiBase").value || "").replace(/\/$/, "");
    if (!apiBase) {
      alert("Runner API base URL is required.");
      return;
    }
    const configYaml = getEffectiveYamlForExecution();
    if (configYaml == null) return;
    const ok = await checkRunnerConnection();
    if (!ok) return;
    realRunStatus.textContent = "Submitting real load run to backend...";
    setRunStatusTiles("Submitting", "-", "-", "Pending", "Submitting current run to backend...");
    try {
      const res = await fetch(`${apiBase}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configYaml })
      });
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { ok: false, error: "Runner returned non-JSON response", output: raw };
      }
      if (!res.ok) {
        realRunStatus.textContent = data.error || "Failed to submit run to backend.";
        detailPanel.textContent = data.output || data.error || "Unknown error";
        setRunStatusTiles("Submission Failed", "-", "-", "Unavailable", data.error || "Backend did not accept the run request.");
        goToFlowPage(4);
        return;
      }
      activeRunJobId = data.jobId || null;
      realRunStatus.textContent = `Run accepted by backend${data.jobId ? ` (job ${data.jobId})` : ""}.`;
      detailPanel.textContent = "Waiting for live backend output...";
      setRunStatusTiles("Queued", data.runId || "-", data.jobId || "-", "Pending", data.message || "Run accepted by backend.");
      goToFlowPage(4);
      stopRunStatusPolling();
      await pollRunStatus();
      runStatusPollTimer = setInterval(pollRunStatus, 2000);
    } catch (e) {
      realRunStatus.textContent = "Unable to reach runner backend. Use Check Runner first.";
      detailPanel.textContent = `Runner error: ${e && e.message ? e.message : "unknown"}`;
      setRunStatusTiles("Runner Error", "-", "-", "Unavailable", `Runner error: ${e && e.message ? e.message : "unknown"}`);
    }
    return;
  }
  return runRealLoadPlan(collectEnhancedPlan(), "current");
}
async function pollRunStatus() {
  if (!activeRunJobId) return;
  const apiBase = (q("runnerApiBase").value || "").replace(/\/$/, "");
  if (!apiBase) return;
  try {
    const res = await fetch(`${apiBase}/api/run/status?jobId=${encodeURIComponent(activeRunJobId)}`);
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = null;
    }
    if (!res.ok || !data) {
      return;
    }
    const stateLabel = data.state || "running";
    const availability = data.reportData ? "Final Report Ready" : data.liveData ? "Live Metrics" : "Pending";
    setRunStatusTiles(stateLabel, data.runId || "-", data.jobId || activeRunJobId, availability, data.message || "Run in progress.");
    realRunStatus.textContent = data.message || realRunStatus.textContent;
    if (data.outputTail) detailPanel.textContent = data.outputTail;
    const link = normalizeReportLink(data.reportHttpUrl || data.reportPath || "");
    if (link) {
      q("gatlingReportLink").value = link;
      reportFrame.src = link;
    }
    if (data.reportData) {
      applyReportDataset(data.reportData, "Real Gatling Run");
    } else if (data.liveData) {
      applyReportDataset(data.liveData, "Live Gatling Status");
    }
    if (data.reportParseError) {
      detailPanel.textContent += `\n\nReport parse error: ${data.reportParseError}`;
    }
    if (stateLabel === "completed" || stateLabel === "failed" || stateLabel === "error") {
      stopRunStatusPolling();
      if (stateLabel === "completed") {
        realRunStatus.textContent = `Run completed successfully${data.exitCode != null ? ` (exit=${data.exitCode})` : ""}.`;
      } else if (stateLabel === "failed") {
        realRunStatus.textContent = `Run completed with failed assertions${data.exitCode != null ? ` (exit=${data.exitCode})` : ""}.`;
      } else {
        realRunStatus.textContent = "Run ended with backend error.";
      }
    }
  } catch (_) {
    // keep polling on transient fetch issues
  }
}

q("tabScenariosBtn").addEventListener("click", () => tab("scenarios"));
q("tabInjectBtn").addEventListener("click", () => tab("inject"));
q("tabEnvsBtn").addEventListener("click", () => tab("envs"));
q("tabHeadersBtn").addEventListener("click", () => tab("headers"));
q("tabCertsBtn").addEventListener("click", () => tab("certs"));
q("addScenario").addEventListener("click", () => addScenario());
q("addEnvBtn").addEventListener("click", () => addEnvironmentRow());
q("addInjectBtn").addEventListener("click", () => addInjectionRow());
q("addGlobalHeader").addEventListener("click", () => addHeaderRow(globalHeadersBody));
q("runBtn").addEventListener("click", runConcurrent);
q("yamlBtn").addEventListener("click", generateYaml);
q("downloadBtn").addEventListener("click", downloadYaml);
q("downloadScriptBtn").addEventListener("click", downloadGatlingScript);
q("validateBtn").addEventListener("click", () => showValidation(validateEnhancedPlan(collectEnhancedPlan())));
q("startRunnerBtn").addEventListener("click", startRunnerFromUi);
q("checkRunnerBtn").addEventListener("click", checkRunnerConnection);
q("loadHookExampleBtn").addEventListener("click", loadHookExampleIntoCurrentStep);
q("compileHooksBtn").addEventListener("click", () => compileCustomHooks(collectEnhancedPlan()));
q("runRealBtn").addEventListener("click", runRealLoad);
q("openGatlingReportBtn").addEventListener("click", openGatlingReport);
q("saveSuiteBtn").addEventListener("click", saveCurrentSuite);
q("loadSuiteBtn").addEventListener("click", loadSelectedSuite);
q("deleteSuiteBtn").addEventListener("click", deleteSelectedSuite);
q("runSavedPreviewBtn").addEventListener("click", runSavedPreviewSuite);
q("runSavedRealBtn").addEventListener("click", runSavedRealSuite);
q("addAppBtn").addEventListener("click", addApp);
q("modeBasicBtn").addEventListener("click", () => setMode("basic"));
q("modeAdvancedBtn").addEventListener("click", () => setMode("advanced"));
q("modeExpertBtn").addEventListener("click", () => setMode("expert"));
q("syncRawYamlBtn").addEventListener("click", syncRawYamlEditor);
q("toggleRawYamlBtn").addEventListener("click", toggleRawYamlOverride);
if (savedSuiteSelect) savedSuiteSelect.addEventListener("change", updateSavedSuiteMeta);
q("flowPrevBtn").addEventListener("click", () => goToFlowPage(currentFlowPage - 1));
q("flowNextBtn").addEventListener("click", () => goToFlowPage(currentFlowPage + 1));
document.querySelectorAll(".flow-tab").forEach((btn) => {
  btn.addEventListener("click", () => goToFlowPage(Number(btn.dataset.page)));
});

addApp();
renderSavedSuites();
applyRunnerConfigDefault();
setMode("basic");
renderFlowPage();
renderCards({ scenarios: 0, steps: 0, total: 0, success: 0, successPct: "0.00%", minRt: 0, avgRt: 0, p95Rt: 0, p99Rt: 0, maxRt: 0, parity: 0 });
setRunStatusTiles("Idle", "-", "-", "Pending", "No active run. Start a test to see live execution status and report updates here.");
