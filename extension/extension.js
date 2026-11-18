const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const CONFIG_DIR = path.join(require("os").homedir(), ".copilot-smart");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const USAGE_FILE = path.join(CONFIG_DIR, "local-usage.jsonl");
let statusBarItem;
let settingsPanel;
let statusTimer;

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function defaults() {
  return {
    enabled: true,
    mode: "strict-local",
    provider: "auto",
    host: "127.0.0.1",
    port: 11434,
    basePath: "/v1",
    model: "",
    apiKey: "",
    timeoutMs: 120000,
    maxOutputTokens: 4096,
    autoDetect: true,
    ollamaPort: 11434,
    lmStudioPort: 1234,
    llamaCppPort: 8080,
    smartTaskMaxAgents: 12,
    smartTaskAutoApply: true
  };
}

function loadConfig() {
  ensureDir();
  const d = defaults();
  try {
    if (fs.existsSync(CONFIG_FILE)) Object.assign(d, JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
  } catch (_) {}
  const ws = vscode.workspace.getConfiguration("copilot-smart");
  // Only let explicit VS Code user/workspace settings override the persistent
  // Copilot Smart config file. `get()` returns the extension default even when
  // the user has never configured the setting, which previously caused
  // copilot-smart.model (default: "") to overwrite a selected local model.
  for (const k of ["mode","provider","host","port","basePath","model","apiKey","timeoutMs","maxOutputTokens","autoDetect","ollamaPort","lmStudioPort","llamaCppPort","smartTaskMaxAgents","smartTaskAutoApply"]) {
    const inspected = ws.inspect(k);
    const explicitlyConfigured = inspected && (
      inspected.globalValue !== undefined ||
      inspected.workspaceValue !== undefined ||
      inspected.workspaceFolderValue !== undefined
    );
    if (explicitlyConfigured) {
      const v = ws.get(k);
      if (v !== undefined) d[k] = v;
    }
  }
  return d;
}

function saveConfig(cfg) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function requestJson(urlString, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: Object.assign({"Accept": "application/json"}, options.headers || {}),
      timeout: options.timeout || 120000
    }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", c => data += c);
      res.on("end", () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else {
          const err = new Error(`HTTP ${res.statusCode}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
          err.statusCode = res.statusCode;
          err.response = parsed;
          reject(err);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function endpoint(cfg) {
  let base = cfg.basePath || "/v1";
  if (!base.startsWith("/")) base = "/" + base;
  base = base.replace(/\/+$/, "");
  return `http://${cfg.host}:${cfg.port}${base}`;
}

async function probe(url, timeout = 2500) {
  try {
    const data = await requestJson(url, {timeout});
    return {ok: true, data};
  } catch (e) {
    return {ok: false, error: e.message};
  }
}

async function detect(cfg) {
  const results = [];
  const ollama = await probe(`http://${cfg.host}:${cfg.ollamaPort}/api/tags`);
  results.push({provider: "ollama", port: cfg.ollamaPort, ok: ollama.ok, models: ollama.ok && Array.isArray(ollama.data.models) ? ollama.data.models.map(x => x.name) : [], error: ollama.error});
  const lm = await probe(`http://${cfg.host}:${cfg.lmStudioPort}/v1/models`);
  results.push({provider: "lm-studio", port: cfg.lmStudioPort, ok: lm.ok, models: lm.ok && Array.isArray(lm.data.data) ? lm.data.data.map(x => x.id) : [], error: lm.error});
  const llama = await probe(`http://${cfg.host}:${cfg.llamaCppPort}/v1/models`);
  results.push({provider: "llama.cpp", port: cfg.llamaCppPort, ok: llama.ok, models: llama.ok && Array.isArray(llama.data.data) ? llama.data.data.map(x => x.id) : [], error: llama.error});
  return results;
}

async function discoverModels(cfg) {
  const all = [];
  const seen = new Set();
  const add = (provider, port, model) => {
    if (!model) return;
    const key = `${provider}|${port}|${model}`;
    if (!seen.has(key)) {
      seen.add(key);
      all.push({provider, port, model});
    }
  };

  const ollama = await probe(`http://${cfg.host}:${cfg.ollamaPort}/api/tags`, Math.min(cfg.timeoutMs, 5000));
  if (ollama.ok && Array.isArray(ollama.data.models)) {
    for (const m of ollama.data.models) add("ollama", cfg.ollamaPort, m.name);
  }

  for (const [provider, port] of [["lm-studio", cfg.lmStudioPort], ["llama.cpp", cfg.llamaCppPort]]) {
    const r = await probe(`http://${cfg.host}:${port}/v1/models`, Math.min(cfg.timeoutMs, 5000));
    if (r.ok && Array.isArray(r.data.data)) {
      for (const m of r.data.data) add(provider, port, m.id);
    }
  }

  // Also query the configured endpoint. This supports custom ports and
  // arbitrary OpenAI-compatible local servers.
  const configured = await probe(endpoint(cfg) + "/models", Math.min(cfg.timeoutMs, 5000));
  if (configured.ok && Array.isArray(configured.data.data)) {
    for (const m of configured.data.data) add(providerName(cfg), cfg.port, m.id);
  }

  return {models: all};
}

async function testConnection(cfg) {
  if (providerName(cfg) === "ollama") {
    const native = await probe(`http://${cfg.host}:${cfg.port}/api/tags`, Math.min(cfg.timeoutMs, 10000));
    if (native.ok) return native;
  }
  return await probe(endpoint(cfg) + "/models", Math.min(cfg.timeoutMs, 10000));
}

function providerName(cfg) {
  if (cfg.provider !== "auto") return cfg.provider;
  if (cfg.port === cfg.ollamaPort) return "ollama";
  if (cfg.port === cfg.lmStudioPort) return "lm-studio";
  if (cfg.port === cfg.llamaCppPort) return "llama.cpp";
  return "openai-compatible";
}

function providerJsonPath() {
  return process.env.COPILOT_PROVIDERS_CONFIG ||
         path.join(require("os").homedir(), ".copilot", "providers.json");
}

function generateProvider(cfg, models) {
  const file = providerJsonPath();
  fs.mkdirSync(path.dirname(file), {recursive: true});
  let doc = {providers: [], models: []};
  try { if (fs.existsSync(file)) doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
  if (!Array.isArray(doc.providers)) doc.providers = [];
  if (!Array.isArray(doc.models)) doc.models = [];

  const pName = `${providerName(cfg)}-local`;
  const p = {
    name: pName,
    type: "openai",
    baseUrl: endpoint(cfg),
    modelProvider: providerName(cfg)
  };
  doc.providers = doc.providers.filter(x => x.name !== pName);
  doc.providers.push(p);

  for (const m of models) {
    doc.models = doc.models.filter(x => !(x.provider === pName && x.id === m.model));
    doc.models.push({
      id: m.model,
      provider: pName,
      name: m.model,
      maxPromptTokens: 8192,
      maxOutputTokens: cfg.maxOutputTokens,
      capabilities: {supports: {toolCalls: true, vision: false}}
    });
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

function logUsage(entry) {
  ensureDir();
  fs.appendFileSync(USAGE_FILE, JSON.stringify({time: new Date().toISOString(), ...entry}) + "\n");
}

async function localChat(cfg, messages) {
  if (cfg.mode === "strict-local") {
    const test = await testConnection(cfg);
    if (!test.ok) throw new Error(`Strict-local mode: local LLM unavailable at ${endpoint(cfg)}. ${test.error || ""}`);
  }
  if (!cfg.model) throw new Error("No local model selected. Use Copilot Smart: Discover Models or set copilot-smart.model.");
  const headers = {"Content-Type": "application/json"};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const body = {
    model: cfg.model,
    messages,
    temperature: 0.2,
    max_tokens: cfg.maxOutputTokens
  };
  const result = await requestJson(endpoint(cfg) + "/chat/completions", {method: "POST", headers, timeout: cfg.timeoutMs}, body);
  const content = result?.choices?.[0]?.message?.content || "";
  logUsage({provider: providerName(cfg), model: cfg.model, promptMessages: messages.length, outputChars: content.length});
  return content;
}

async function openSettingsPanel(context) {
  // Keep exactly one settings panel alive. If it already exists, reveal it
  // instead of opening another tab, and refresh its contents from disk.
  if (settingsPanel) {
    settingsPanel.reveal(vscode.ViewColumn.One, false);
    await refreshSettingsPanel(settingsPanel);
    return settingsPanel;
  }

  const panel = vscode.window.createWebviewPanel(
    "copilotSmartSettings",
    "Copilot Smart Settings",
    vscode.ViewColumn.One,
    {enableScripts: true}
  );
  // Initialize the webview only once.
  panel.webview.html = settingsHtml(loadConfig());
  settingsPanel = panel;
  panel.onDidDispose(() => {
    if (settingsPanel === panel) settingsPanel = undefined;
  }, undefined, context.subscriptions);

  await refreshSettingsPanel(panel);

  panel.webview.onDidReceiveMessage(async msg => {
    try {
      if (msg.type === "save") {
        // Always use the latest persisted config so stale panel state cannot
        // overwrite a newer setting.
        const next = Object.assign({}, loadConfig(), msg.data || {});
        saveConfig(next);
        vscode.window.showInformationMessage("Copilot Smart settings saved.");
        panel.webview.postMessage({type:"saved"});
        updateStatusBar();
        await refreshSettingsPanel(panel);
      } else if (msg.type === "detect") {
        const result = await detect(loadConfig());
        panel.webview.postMessage({type:"detectResult", result});
        await refreshSettingsPanel(panel);
      } else if (msg.type === "models") {
        const result = await discoverModels(loadConfig());
        panel.webview.postMessage({type:"modelsResult", result});
        await refreshSettingsPanel(panel, result);
      } else if (msg.type === "test") {
        const result = await testConnection(loadConfig());
        panel.webview.postMessage({type:"testResult", result});
        updateStatusBar();
      } else if (msg.type === "provider") {
        const r = await discoverModels(loadConfig());
        const file = generateProvider(loadConfig(), r.models);
        panel.webview.postMessage({type:"providerResult", file});
      }
    } catch (e) {
      panel.webview.postMessage({type:"error", error:e.message});
    }
  }, undefined, context.subscriptions);

  return panel;
}

async function refreshSettingsPanel(panel, modelResult) {
  if (!panel || panel !== settingsPanel) return;

  try {
    const cfg = loadConfig();
    const result = modelResult || await discoverModels(cfg);

    // Update the existing webview instead of reloading its HTML.
    panel.webview.postMessage({
      type: "modelsResult",
      result
    });
  } catch (e) {
    panel.webview.postMessage({
      type: "error",
      error: e.message
    });
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function settingsHtml(cfg) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;max-width:1000px;margin:auto}
h1{font-size:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.card{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:18px;margin-bottom:16px}
label{display:block;font-size:12px;opacity:.85;margin-bottom:5px}
input,select{width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground)}
button{padding:8px 14px;border:0;border-radius:6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;margin-right:8px}
button:hover{background:var(--vscode-button-hoverBackground)}
pre{white-space:pre-wrap;background:var(--vscode-textCodeBlock-background);padding:12px;border-radius:7px}
.ok{color:var(--vscode-testing-iconPassed)}.bad{color:var(--vscode-testing-iconFailed)}
</style></head><body>
<h1>Copilot Smart</h1>
<p>Local LLM routing for Ollama, LM Studio, llama.cpp and OpenAI-compatible servers.</p>
<div class="card"><h2>Connection</h2><div class="grid">
<div><label>Mode</label><select id="mode"><option value="strict-local">strict-local</option><option value="local-preferred">local-preferred</option></select></div>
<div><label>Provider</label><select id="provider"><option>auto</option><option>ollama</option><option>lm-studio</option><option>llama.cpp</option><option>openai-compatible</option></select></div>
<div><label>Host</label><input id="host"></div><div><label>Port</label><input id="port" type="number"></div>
<div><label>Base path</label><input id="basePath"></div>
<div><label>Model</label><select id="model"><option value="">Select a model...</option></select></div>
<div><label>API key</label><input id="apiKey" type="password"></div><div><label>Timeout (ms)</label><input id="timeoutMs" type="number"></div>
<div><label>Max output tokens</label><input id="maxOutputTokens" type="number"></div>
</div></div>
<div class="card"><h2>Auto-detection ports</h2><div class="grid">
<div><label>Ollama</label><input id="ollamaPort" type="number"></div>
<div><label>LM Studio</label><input id="lmStudioPort" type="number"></div>
<div><label>llama.cpp</label><input id="llamaCppPort" type="number"></div>
<div><label>Auto detect</label><select id="autoDetect"><option value="true">true</option><option value="false">false</option></select></div>
</div></div>
<div class="card"><button onclick="save()">Save</button><button onclick="detect()">Detect</button><button onclick="models()">Discover Models</button><button onclick="test()">Test Connection</button><button onclick="provider()">Generate provider.json</button></div>
<div class="card"><h2>Result</h2><pre id="result">Ready.</pre></div>
<script>
const vscode=acquireVsCodeApi();
const cfg=${JSON.stringify(cfg)};
for(const k of Object.keys(cfg)){const e=document.getElementById(k);if(e)e.value=String(cfg[k]);}
function val(id){return document.getElementById(id).value;}
function data(){return {mode:val("mode"),provider:val("provider"),host:val("host"),port:Number(val("port")),basePath:val("basePath"),model:val("model"),apiKey:val("apiKey"),timeoutMs:Number(val("timeoutMs")),maxOutputTokens:Number(val("maxOutputTokens")),ollamaPort:Number(val("ollamaPort")),lmStudioPort:Number(val("lmStudioPort")),llamaCppPort:Number(val("llamaCppPort")),autoDetect:val("autoDetect")==="true"};}
function save(){vscode.postMessage({type:"save",data:data()});}
document.getElementById("model").addEventListener("change",()=>{vscode.postMessage({type:"save",data:data()});});
function detect(){vscode.postMessage({type:"detect"});}
function models(){vscode.postMessage({type:"models"});}
function test(){vscode.postMessage({type:"test"});}
function provider(){vscode.postMessage({type:"provider"});}
window.addEventListener("message",e=>{
  const m=e.data;
  const result=document.getElementById("result");
  if(m.type==="modelsResult"){
    const select=document.getElementById("model");
    const current=select.value || cfg.model || "";
    select.innerHTML="";
    if(!m.result.models.length){
      const o=document.createElement("option");
      o.value=""; o.textContent="No models found";
      select.appendChild(o);
      result.textContent="No local models found. Start your local LLM server and click Discover Models.";
      return;
    }
    for(const x of m.result.models){
      const o=document.createElement("option");
      o.value=x.model;
      o.textContent=x.model+"  ["+x.provider+":"+x.port+"]";
      select.appendChild(o);
    }
    if([...select.options].some(o=>o.value===current) && current) {
      select.value=current;
    } else if (select.options.length) {
      select.selectedIndex=0;
      vscode.postMessage({type:"save",data:data()});
    }
    result.textContent=JSON.stringify(m.result.models,null,2);
    return;
  }
  result.textContent=typeof m.result==="object"?JSON.stringify(m.result,null,2):(m.file||m.error||"Saved.");
});
</script></body></html>`;
}


function projectRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : null;
}

const AGENT_SKIP_DIRS = new Set([
  ".git", ".svn", ".hg", "node_modules", "__pycache__", ".venv", "venv",
  "dist", "build", "out", "coverage", ".next", ".nuxt", "target", "bin",
  "obj", ".idea", ".vscode-test", "DerivedData", "Pods", "vendor"
]);
const AGENT_TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".pyw", ".pyi",
  ".cpp", ".cc", ".cxx", ".h", ".hpp", ".c", ".cs", ".java", ".go", ".rs",
  ".rb", ".php", ".swift", ".kt", ".kts", ".sh", ".bash", ".zsh", ".fish",
  ".ps1", ".bat", ".cmd", ".lua", ".pl", ".r", ".sql", ".html", ".css",
  ".scss", ".less", ".vue", ".svelte", ".json", ".json5", ".yaml", ".yml",
  ".toml", ".ini", ".cfg", ".conf", ".xml", ".md", ".rst", ".txt", ".env.example"
]);
const AGENT_SPECIAL_FILES = new Set([
  "README", "README.md", "README.rst", "package.json", "pyproject.toml", "requirements.txt",
  "requirements-dev.txt", "setup.py", "setup.cfg", "Makefile", "CMakeLists.txt", "Cargo.toml",
  "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Dockerfile", "docker-compose.yml",
  ".editorconfig", ".gitignore", "tsconfig.json", "vite.config.ts", "webpack.config.js"
]);

function isTextCandidate(file) {
  const base = path.basename(file);
  if (AGENT_SPECIAL_FILES.has(base)) return true;
  return AGENT_TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function walkProject(root, out = [], dir = root) {
  let entries = [];
  try { entries = fs.readdirSync(dir, {withFileTypes:true}); } catch (_) { return out; }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && [".gitignore", ".env.example", ".editorconfig"].indexOf(entry.name) < 0) {
      if (entry.isDirectory()) continue;
    }
    if (entry.isDirectory() && AGENT_SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkProject(root, out, full);
    else if (entry.isFile() && isTextCandidate(full)) out.push(full);
  }
  return out;
}

function readProjectFile(root, file, maxBytes = 120000) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > maxBytes) return {path:path.relative(root,file).replace(/\\/g,"/"), size:stat.size, skipped:"file too large"};
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return {path:path.relative(root,file).replace(/\\/g,"/"), size:stat.size, skipped:"binary"};
    return {path:path.relative(root,file).replace(/\\/g,"/"), size:stat.size, content:buf.toString("utf8")};
  } catch (_) { return null; }
}

function buildProjectIndex(root) {
  const files = walkProject(root);
  const entries = [];
  const byPath = {};
  for (const file of files) {
    const item = readProjectFile(root, file);
    if (!item) continue;
    entries.push({path:item.path, size:item.size, skipped:item.skipped || undefined});
    if (item.content !== undefined) byPath[item.path] = item.content;
  }
  entries.sort((a,b)=>a.path.localeCompare(b.path));
  const dirs = new Set(entries.map(x => path.posix.dirname(x.path)));
  const languages = {};
  for (const e of entries) {
    const ext = path.posix.extname(e.path).toLowerCase() || "[no extension]";
    languages[ext] = (languages[ext] || 0) + 1;
  }
  return {root, files:entries, contents:byPath, directories:[...dirs].sort(), languages};
}

function projectMap(index) {
  return [
    `PROJECT ROOT: ${index.root}`,
    `FILES: ${index.files.length}`,
    `LANGUAGES: ${JSON.stringify(index.languages)}`,
    `DIRECTORIES: ${index.directories.join(", ")}`,
    "FILE TREE:",
    index.files.map(f => `- ${f.path}${f.skipped ? ` [${f.skipped}]` : ""}`).join("\\n")
  ].join("\\n");
}

function relevantFiles(index, paths, maxTotal = 240000) {
  const wanted = new Set(paths || []);
  const selected = [];
  let total = 0;
  const candidates = Object.keys(index.contents).sort((a,b) => {
    const aa = wanted.has(a) ? 0 : 1, bb = wanted.has(b) ? 0 : 1;
    return aa - bb || a.length - b.length;
  });
  for (const p of candidates) {
    const content = index.contents[p];
    if (!wanted.has(p) && selected.length >= 80) continue;
    const chunk = content.length > 40000 ? content.slice(0,40000) + "\\n/* truncated */" : content;
    if (total + chunk.length > maxTotal) continue;
    selected.push(`\\n===== ${p} =====\\n${chunk}`);
    total += chunk.length;
  }
  return selected.join("\\n");
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[\\[{]/);
  if (start < 0) return null;
  for (let end = raw.length; end > start; end--) {
    try { return JSON.parse(raw.slice(start,end)); } catch (_) {}
  }
  return null;
}

function projectContentChunks(index, maxChars = 60000) {
  const chunks = [];
  let current = "";
  for (const p of Object.keys(index.contents).sort()) {
    const content = index.contents[p];
    const piece = `\n===== ${p} =====\n${content}\n`;
    if (current && current.length + piece.length > maxChars) { chunks.push(current); current = ""; }
    if (piece.length > maxChars) {
      for (let i=0; i<piece.length; i+=maxChars) chunks.push(piece.slice(i,i+maxChars));
    } else current += piece;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function runAgent(cfg, agent, task, context) {
  const system = [
    "You are an autonomous local coding agent inside VS Code.",
    "Work only from the supplied project context. Do not invent files or APIs when the project evidence is available.",
    "Be precise, production-oriented, and minimize unnecessary changes.",
    `AGENT ROLE: ${agent.role}`,
    `AGENT OBJECTIVE: ${agent.objective}`,
    "Return the requested structured output."
  ].join("\\n");
  return localChat(cfg, [
    {role:"system", content:system},
    {role:"user", content:`CODING TASK:\n${task}\n\nPROJECT CONTEXT:\n${context}`}
  ]);
}

function writeAgentRun(root, runId, data) {
  const dir = path.join(root, ".copilot-smart", "agent-runs", runId);
  fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(data, null, 2));
  return dir;
}

function backupBeforeChange(root, runId, rel) {
  const source = path.resolve(root, rel);
  if (!fs.existsSync(source)) return;
  const backupRoot = path.join(root, ".copilot-smart", "agent-runs", runId, "backup");
  const target = path.join(backupRoot, rel);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  if (!fs.existsSync(target)) fs.copyFileSync(source, target);
}

function applyChanges(root, changes, runId) {
  const applied = [];
  for (const change of (changes || [])) {
    if (!change || !change.path || typeof change.content !== "string") continue;
    const rel = change.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) continue;
    if (runId) backupBeforeChange(root, runId, rel);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, change.content, "utf8");
    applied.push(rel);
  }
  return applied;
}

async function runCommand(root, command, timeoutMs = 120000) {
  const cp = require("child_process");
  return new Promise(resolve => {
    cp.exec(command, {cwd:root, timeout:timeoutMs, maxBuffer:2*1024*1024, windowsHide:true}, (error, stdout, stderr) => {
      resolve({ok:!error, code:error && typeof error.code === "number" ? error.code : 0, stdout:String(stdout||""), stderr:String(stderr||"")});
    });
  });
}

async function startSmartLocalTask() {
  const root = projectRoot();
  if (!root) {
    vscode.window.showErrorMessage("Copilot Smart: Open a project folder/workspace first.");
    return;
  }
  const task = await vscode.window.showInputBox({
    prompt:"Smart Local Task — describe what you want built",
    placeHolder:"Example: Add OAuth login, tests, error handling, and update the documentation",
    ignoreFocusOut:true
  });
  if (!task) return;

  const cfg = loadConfig();
  if (!cfg.model) {
    vscode.window.showErrorMessage("Copilot Smart: Select a local model first.");
    return;
  }

  const runId = new Date().toISOString().replace(/[:.]/g,"-");
  const output = await vscode.window.withProgress({
    location:vscode.ProgressLocation.Notification,
    title:"Copilot Smart: building autonomous coding team",
    cancellable:false
  }, async progress => {
    progress.report({message:"Reading the full project..."});
    const index = buildProjectIndex(root);
    const originalContents = {...index.contents};
    const map = projectMap(index);

    progress.report({message:`Reading ${index.files.length} project files in analysis passes...`});
    const chunks = projectContentChunks(index, 60000);
    const analysisNotes = [];
    for (let i = 0; i < chunks.length; i++) {
      progress.report({message:`Analyzing project context ${i + 1}/${chunks.length}...`});
      const note = await runAgent(cfg, {
        role:"Repository Analyst",
        objective:"Understand this portion of the codebase: architecture, dependencies, conventions, public APIs, tests, risks, and relationships between files. Produce concise factual notes for the orchestrator."
      }, task, map + "\n\nPROJECT CONTENT CHUNK " + (i+1) + "/" + chunks.length + ":\n" + chunks[i]);
      analysisNotes.push(note);
    }

    progress.report({message:"Generating project-specific agents..."});
    const planRaw = await runAgent(cfg, {
      role:"Lead Architect / Agent Orchestrator",
      objective:"Study the project and generate the smallest complete team of specialist agents needed to execute the coding task. Include implementation, testing, review, debugging, and documentation where relevant. Add project-specific specialists when justified."
    }, task, map + "\n\nREPOSITORY ANALYSIS NOTES:\n" + analysisNotes.join("\n\n--- ANALYSIS PASS ---\n"));
    const plan = extractJson(planRaw) || {};
    let agents = Array.isArray(plan.agents) ? plan.agents : [];
    if (!agents.length) agents = [
      {name:"architect",role:"Software Architect",objective:"Design the safest project-native implementation and identify affected files."},
      {name:"implementer",role:"Senior Implementer",objective:"Implement the requested change and return complete file contents for modified files."},
      {name:"tester",role:"Test Engineer",objective:"Design and run the most relevant tests and identify failures."},
      {name:"reviewer",role:"Code Reviewer",objective:"Review the implementation for correctness, regressions, security, and maintainability."}
    ];
    agents = agents.slice(0, Number(cfg.smartTaskMaxAgents || 12)).map((a,i)=>({name:a.name || `agent-${i+1}`,role:a.role || "Coding Specialist",objective:a.objective || "Contribute to the task."}));

    const run = {version:1, id:runId, task, root, model:cfg.model, provider:providerName(cfg), createdAt:new Date().toISOString(), project:{files:index.files.length,languages:index.languages}, agents, plan:planRaw};
    const runDir = writeAgentRun(root, runId, run);
    const results = [];

    // Architect agents first. They receive the complete project map plus source/config content.
    for (const agent of agents.filter(a => /architect|analysis|analyst|explorer|planner/i.test(`${a.name} ${a.role}`)).slice(0,3)) {
      progress.report({message:`Running ${agent.name}...`});
      const r = await runAgent(cfg, agent, task, map + "\\n\\nPROJECT FILE CONTENT:\\n" + relevantFiles(index, [], 220000));
      results.push({agent:agent.name, role:agent.role, output:r});
    }

    progress.report({message:"Running implementation team..."});
    const implementationAgents = agents.filter(a => !/architect|analysis|analyst|explorer|planner/i.test(`${a.name} ${a.role}`));
    for (const agent of implementationAgents.slice(0,8)) {
      const context = map + "\\n\\nSOURCE FILES:\\n" + relevantFiles(index, [], 220000);
      const r = await runAgent(cfg, agent, task, context + "\\n\\nIMPLEMENTATION CONTRACT: If you modify code, return JSON {\\\"changes\\\":[{\\\"path\\\":\\\"relative/path\\\",\\\"content\\\":\\\"complete file content\\\",\\\"reason\\\":\\\"...\\\"}]}.");
      results.push({agent:agent.name, role:agent.role, output:r});

      const data = extractJson(r);
      const canEdit = cfg.smartTaskAutoApply && /implement|developer|coder|fixer|engineer/i.test(`${agent.name} ${agent.role}`);
      if (canEdit && data && Array.isArray(data.changes)) {
        const applied = applyChanges(root, data.changes, runId);
        if (applied.length) {
          results.push({agent:agent.name, applied});
          // Refresh the index after each modifying agent so later agents see the latest code.
          Object.assign(index, buildProjectIndex(root));
        }
      }
    }

    progress.report({message:"Running verification and final review..."});
    const currentIndex = buildProjectIndex(root);
    const reviewContext = projectMap(currentIndex) + "\\n\\nCURRENT SOURCE:\\n" + relevantFiles(currentIndex, [], 240000);
    const reviewRaw = await runAgent(cfg, {
      role:"Principal Code Reviewer and Release Engineer",
      objective:"Review the final working tree, identify regressions, missing tests, and concrete fixes. Return JSON with review findings and optional file changes."
    }, task, reviewContext + "\\n\\nReturn JSON {\\\"findings\\\":[...],\\\"changes\\\":[...]}. Do not claim tests passed unless evidence is provided.");
    results.push({agent:"final-review", role:"Principal Code Reviewer", output:reviewRaw});
    const review = extractJson(reviewRaw);
    if (review && Array.isArray(review.changes)) applyChanges(root, review.changes, runId);

    // Run project-native verification when it is unambiguous.
    let testResult = null;
    const files = buildProjectIndex(root).contents;
    if (files["package.json"]) {
      try {
        const pkg = JSON.parse(files["package.json"]);
        const scripts = pkg.scripts || {};
        const command = scripts.test ? "npm test" : (scripts.lint ? "npm run lint" : (scripts.check ? "npm run check" : null));
        if (command) {
          progress.report({message:`Running ${command}...`});
          testResult = await runCommand(root, command, 180000);
        }
      } catch (_) {}
    }
    if (!testResult && files["pyproject.toml"] && files["tests/test_main.py"]) {
      progress.report({message:"Running Python tests..."});
      testResult = await runCommand(root, "python -m pytest", 180000);
    }

    const finalRun = { ...run, finishedAt:new Date().toISOString(), results, testResult, changedFiles:[] };
    const finalIndex = buildProjectIndex(root);
    finalRun.changedFiles = Object.keys(finalIndex.contents).filter(p => originalContents[p] !== finalIndex.contents[p]);
    fs.writeFileSync(path.join(runDir,"run.json"), JSON.stringify(finalRun,null,2));
    return {runDir, agents, results, testResult};
  });

  const changed = output.changedFiles.length;
  const testText = output.testResult ? (output.testResult.ok ? "verification passed" : `verification failed (exit ${output.testResult.code})`) : "no unambiguous project test command found";
  vscode.window.showInformationMessage(`Copilot Smart: Smart Local Task complete — ${output.agents.length} agents, ${changed} changed files, ${testText}.`);
  const doc = await vscode.workspace.openTextDocument({
    content:`# Copilot Smart — Smart Local Task\\n\\nTask: ${task}\\n\\nAgents: ${output.agents.map(a=>a.name).join(", ")}\\n\\nChanged files: ${changed}\\n\\nRun data: ${output.runDir}\\n\\n${output.testResult ? `## Verification\\n\\n${output.testResult.stdout}\\n${output.testResult.stderr}` : "No unambiguous test command was detected."}`,
    language:"markdown"
  });
  await vscode.window.showTextDocument(doc,{preview:false});
}

function status() {
  const cfg = loadConfig();
  vscode.window.showInformationMessage(`Copilot Smart: ${cfg.mode}, ${providerName(cfg)}, ${cfg.host}:${cfg.port}, model=${cfg.model || "(not selected)"}`);
}



function setStatusAppearance(state, text, tooltip) {
  if (!statusBarItem) return;

  statusBarItem.text = text;
  statusBarItem.tooltip = tooltip;

  // Use VS Code's semantic testing colors so the indicator remains visible
  // across light/dark themes without hard-coding a background color.
  if (state === "ready") {
    statusBarItem.color = new vscode.ThemeColor("testing.iconPassed");
    statusBarItem.backgroundColor = undefined;
  } else if (state === "waiting") {
    statusBarItem.color = new vscode.ThemeColor("testing.iconQueued");
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.color = new vscode.ThemeColor("testing.iconFailed");
    statusBarItem.backgroundColor = undefined;
  }
}

async function getLocalStatus(cfg) {
  try {
    const r = await testConnection(cfg);

    if (r.ok) {
      if (!cfg.model) {
        return {
          state: "waiting",
          text: "$(debug-pause)",
          tooltip: `Local ${providerName(cfg)} server is connected, but no model is selected.\n${endpoint(cfg)}\nChoose a model from Copilot Smart → Discover Models.`
        };
      }

      return {
        state: "ready",
        text: "$(rocket)",
        tooltip: `Local LLM connected and ready.\nProvider: ${providerName(cfg)}\nModel: ${cfg.model}\nEndpoint: ${endpoint(cfg)}`
      };
    }

    if (r.statusCode === 401 || r.statusCode === 403) {
      return {
        state: "waiting",
        text: "$(key)",
        tooltip: `Local server is reachable but authentication is required.\n${endpoint(cfg)}\nConfigure the API key in Copilot Smart Settings.`
      };
    }

    return {
      state: "offline",
      text: "$(error)",
      tooltip: `Local LLM is not reachable.\n${endpoint(cfg)}\n${r.error || "Connection failed."}`
    };
  } catch (e) {
    if (e.statusCode === 401 || e.statusCode === 403) {
      return {
        state: "waiting",
        text: "$(key)",
        tooltip: `Local server is reachable but authentication is required.\n${endpoint(cfg)}\nConfigure the API key in Copilot Smart Settings.`
      };
    }

    return {
      state: "offline",
      text: "$(error)",
      tooltip: `Local LLM is not reachable.\n${endpoint(cfg)}\n${e.message || "Connection failed."}`
    };
  }
}

function getCloudStatus() {
  const copilot = vscode.extensions.getExtension("GitHub.copilot");
  const copilotChat = vscode.extensions.getExtension("GitHub.copilot-chat");

  if (copilot || copilotChat) {
    const active = Boolean((copilot && copilot.isActive) || (copilotChat && copilotChat.isActive));
    return active
      ? {state: "cloud", text: "$(cloud)", tooltip: "GitHub Copilot extension is installed and active."}
      : {state: "waiting", text: "$(key)", tooltip: "GitHub Copilot is installed but may still be waiting for authentication or activation."};
  }

  return {state: "none", text: "$(cloud)", tooltip: "GitHub Copilot extension was not detected."};
}

let statusCheckRunning = false;

async function updateStatusBar() {
  if (!statusBarItem || statusCheckRunning) return;

  const cfg = loadConfig();
  statusCheckRunning = true;

  // Immediately show yellow while the network probe is running.
  setStatusAppearance(
    "waiting",
    "$(sync~spin)",
    `Checking local ${providerName(cfg)} server...\n${endpoint(cfg)}`
  );

  try {
    const local = await getLocalStatus(cfg);
    const cloud = getCloudStatus();

    if (local.state === "ready") {
      setStatusAppearance("ready", local.text, `${local.tooltip}\n\nMode: ${cfg.mode}`);
    } else if (local.state === "waiting") {
      setStatusAppearance("waiting", local.text, `${local.tooltip}\n\nMode: ${cfg.mode}`);
    } else if (cfg.mode === "local-preferred" && cloud.state === "cloud") {
      setStatusAppearance(
        "ready",
        "$(cloud) Copilot Smart: CLOUD READY",
        `${cloud.tooltip}\n\nLocal LLM: not connected\nMode: LOCAL PREFERRED`
      );
    } else if (cfg.mode === "local-preferred" && cloud.state === "waiting") {
      setStatusAppearance(
        "waiting",
        "$(key)",
        `${cloud.tooltip}\n\nLocal LLM: not connected\nMode: LOCAL PREFERRED`
      );
    } else {
      setStatusAppearance(
        "offline",
        "$(error)",
        `${local.tooltip}\n\nMode: ${cfg.mode}\nCloud fallback: ${cfg.mode === "strict-local" ? "DISABLED" : "UNAVAILABLE"}`
      );
    }
  } finally {
    statusCheckRunning = false;
  }
}


function createStatusBar(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    1000
  );

  statusBarItem.name = "Copilot Smart Connection";
  statusBarItem.command = "copilot-smart.openSettings";
  statusBarItem.tooltip = "Copilot Smart connection status";
  statusBarItem.text = "$(sync~spin)";
  statusBarItem.color = new vscode.ThemeColor("testing.iconQueued");

  // High priority keeps the indicator visible near the right side.
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);

  updateStatusBar();

  statusTimer = setInterval(() => {
    updateStatusBar().catch(() => {});
  }, 10000);

  context.subscriptions.push({
    dispose: () => {
      if (statusTimer) clearInterval(statusTimer);
      statusTimer = undefined;
    }
  });
}


class CopilotSmartSidebarProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {enableScripts: true};
    webviewView.webview.html = this.html();

    webviewView.webview.onDidReceiveMessage(async msg => {
      try {
        if (msg.command === "settings") {
          await vscode.commands.executeCommand("copilot-smart.openSettings");
        } else if (msg.command === "detect") {
          await vscode.commands.executeCommand("copilot-smart.detect");
        } else if (msg.command === "models") {
          await vscode.commands.executeCommand("copilot-smart.models");
        } else if (msg.command === "test") {
          await vscode.commands.executeCommand("copilot-smart.testConnection");
        } else if (msg.command === "provider") {
          await vscode.commands.executeCommand("copilot-smart.generateProvider");
        } else if (msg.command === "status") {
          await vscode.commands.executeCommand("copilot-smart.status");
        } else if (msg.command === "task") {
          await vscode.commands.executeCommand("copilot-smart.startTask");
        } else if (msg.command === "refresh") {
          await vscode.commands.executeCommand("copilot-smart.refreshStatus");
          this.refresh();
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Copilot Smart: ${e.message}`);
      }
    });
  }

  refresh() {
    if (!this.view) return;

    // Do not recreate the webview document.
    this.view.webview.postMessage({
      command: "refreshDisplay"
    });
  }
  html() {
    const cfg = loadConfig();
    const p = providerName(cfg);
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    padding: 12px;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    font-size: 12px;
  }
  h2 { font-size: 15px; margin: 0 0 5px; }
  .sub { opacity: .7; margin-bottom: 14px; line-height: 1.4; }
  .status {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 7px;
    padding: 10px;
    margin-bottom: 12px;
  }
  .row { margin: 4px 0; }
  .label { opacity: .65; }
  button {
    width: 100%;
    text-align: left;
    padding: 7px 9px;
    margin: 3px 0;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 5px;
    color: var(--vscode-foreground);
    background: var(--vscode-button-secondaryBackground);
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .section {
    font-size: 10px;
    text-transform: uppercase;
    opacity: .55;
    margin: 14px 2px 5px;
  }
</style>
</head>
<body>
  <h2>Copilot Smart</h2>
  <div class="sub">Local LLM control center</div>

  <div class="status">
    <div class="row"><span class="label">Mode:</span> ${esc(cfg.mode)}</div>
    <div class="row"><span class="label">Provider:</span> ${esc(p)}</div>
    <div class="row"><span class="label">Server:</span> ${esc(cfg.host)}:${esc(cfg.port)}</div>
    <div class="row"><span class="label">Model:</span> ${esc(cfg.model || "(not selected)")}</div>
  </div>

  <div class="section">Connection</div>
  <button class="primary" onclick="send('test')">$(pulse) Test Connection</button>
  <button onclick="send('detect')">$(search) Detect Local LLMs</button>
  <button onclick="send('models')">$(list-tree) Discover Models</button>
  <button onclick="send('refresh')">$(refresh) Refresh Status</button>

  <div class="section">Actions</div>
  <button onclick="send('task')">$(sparkle) Smart Local Task</button>
  <button onclick="send('provider')">$(json) Generate provider.json</button>
  <button onclick="send('status')">$(info) Show Status</button>

  <div class="section">Configuration</div>
  <button onclick="send('settings')">$(settings-gear) Open Settings</button>

<script>
  const vscode = acquireVsCodeApi();
  function send(command) { vscode.postMessage({command}); }
</script>
</body>
</html>`;
  }
}


class ControlCenterProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.command) {
          case "settings":
            await vscode.commands.executeCommand("copilot-smart.openSettings");
            break;
          case "detect":
            await vscode.commands.executeCommand("copilot-smart.detect");
            break;
          case "models":
            {
              const r = await discoverModels(loadConfig());
              if (this.view) this.view.webview.postMessage({type:"modelsResult", result:r, selectedModel:loadConfig().model});
              if (!r.models.length) vscode.window.showWarningMessage("Copilot Smart: No local models found.");
            }
            break;
          case "test":
            await vscode.commands.executeCommand("copilot-smart.testConnection");
            break;
          case "provider":
            await vscode.commands.executeCommand("copilot-smart.generateProvider");
            break;
          case "status":
            await vscode.commands.executeCommand("copilot-smart.status");
            break;
          case "task":
            await vscode.commands.executeCommand("copilot-smart.startTask");
            break;
          case "refresh":
            await vscode.commands.executeCommand("copilot-smart.refreshStatus");
            await this.sendStatus();
            break;
          case "discoverModels":
            await this.sendStatus();
            break;
          case "selectModel":
            if (msg.model) {
              const cfg = loadConfig();
              cfg.model = msg.model;
              if (msg.provider) cfg.provider = msg.provider;
              if (msg.port) cfg.port = Number(msg.port);
              saveConfig(cfg);
              vscode.window.showInformationMessage(`Copilot Smart: selected ${msg.model}`);
              await this.sendStatus();
              updateStatusBar();
            }
            break;
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Copilot Smart: ${e.message}`);
      }
    }, undefined, this.context.subscriptions);

    this.sendStatus();
  }

  async sendStatus() {
    if (!this.view) return;
    const cfg = loadConfig();
    try {
      const local = await getLocalStatus(cfg);
      const cloud = getCloudStatus();
      this.view.webview.postMessage({
        type: "status",
        local,
        cloud,
        mode: cfg.mode,
        provider: providerName(cfg),
        model: cfg.model || "(not selected)",
        endpoint: endpoint(cfg)
      });

      // Always refresh the model list when the Control Center is opened/refreshed.
      const result = await discoverModels(cfg);
      this.view.webview.postMessage({
        type: "models",
        models: result.models || [],
        selected: cfg.model || ""
      });
    } catch (e) {
      this.view.webview.postMessage({type: "models", models: [], selected: cfg.model || "", error: e.message});
    }
  }

  html() {
    return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
:root { color-scheme: dark; }
body {
  margin: 0; padding: 12px;
  font-family: var(--vscode-font-family);
  color: var(--vscode-sideBar-foreground);
  background: var(--vscode-sideBar-background);
}
.header {
  display:flex; align-items:center; gap:8px; margin-bottom:12px;
}
.logo {
  width:28px; height:28px; border-radius:7px;
  background: linear-gradient(135deg,#08d9ff,#7c4dff);
  display:flex; align-items:center; justify-content:center;
  font-size:16px;
}
.title { font-weight:700; font-size:14px; }
.sub { opacity:.65; font-size:10px; }
.card {
  border:1px solid var(--vscode-sideBarSectionHeader-border);
  border-radius:8px; padding:10px; margin-bottom:10px;
  background: var(--vscode-sideBar-background);
}
.status { display:flex; align-items:center; gap:7px; font-weight:600; }
.dot { width:9px; height:9px; border-radius:50%; background:#888; }
.dot.local { background:#39e58c; box-shadow:0 0 7px #39e58c; }
.dot.cloud { background:#4da6ff; box-shadow:0 0 7px #4da6ff; }
.dot.offline { background:#ff5f56; }
.meta { margin-top:7px; font-size:10px; opacity:.65; line-height:1.5; word-break:break-word; }
button {
  width:100%; border:0; border-radius:6px; padding:7px 8px;
  margin:3px 0; text-align:left; cursor:pointer;
  color:var(--vscode-button-foreground);
  background:var(--vscode-button-background);
}
button:hover { background:var(--vscode-button-hoverBackground); }
.secondary {
  color:var(--vscode-foreground);
  background:var(--vscode-editor-inactiveSelectionBackground);
}
.section { font-size:10px; opacity:.6; text-transform:uppercase; margin:10px 2px 4px; }
</style>
</head>
<body>
<div class="header">
  <div class="logo">✦</div>
  <div><div class="title">Copilot Smart</div><div class="sub">Local LLM Control Center</div></div>
</div>

<div class="card">
  <div class="status"><span id="dot" class="dot"></span><span id="state">Checking...</span></div>
  <div id="meta" class="meta">Checking local and cloud connection...</div>
</div>
<div class="section">Models</div>
<div class="card">
  <select id="modelSelect" style="width:100%;padding:7px;border-radius:6px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);">
    <option>Loading models...</option>
  </select>
  <div id="modelInfo" class="meta">Discovering local models...</div>
  <button onclick="cmd('discoverModels')" class="secondary">↻ Refresh Models</button>
</div>

<div class="section">Connection</div>
<button onclick="cmd('settings')">⚙ Open Settings</button>
<button onclick="cmd('detect')">⌁ Detect Local LLMs</button>
<button onclick="cmd('test')">✓ Test Connection</button>
<button onclick="cmd('refresh')" class="secondary">↻ Refresh Status</button>

<div class="section">Tools</div>
<button onclick="cmd('provider')">⇄ Generate provider.json</button>
<button onclick="cmd('task')">✦ Smart Local Task</button>
<button onclick="cmd('status')" class="secondary">ⓘ Show Status</button>

<script>
const vscode = acquireVsCodeApi();
function cmd(command){ vscode.postMessage({command}); }
document.getElementById("modelSelect").addEventListener("change", function(){
  const opt=this.options[this.selectedIndex];
  if(opt && opt.dataset.model){
    vscode.postMessage({command:"selectModel", model:opt.dataset.model, provider:opt.dataset.provider, port:opt.dataset.port});
  }
});
window.addEventListener('message', e => {
  const m=e.data;
  if(m.type==="models"){
    const select=document.getElementById("modelSelect");
    const info=document.getElementById("modelInfo");
    select.innerHTML="";
    if(!m.models || !m.models.length){
      const opt=document.createElement("option");
      opt.textContent="No local models found";
      select.appendChild(opt);
      info.textContent=m.error || "Start Ollama/LM Studio/llama.cpp and click Refresh Models.";
      return;
    }
    for(const x of m.models){
      const opt=document.createElement("option");
      opt.textContent=x.model;
      opt.dataset.model=x.model;
      opt.dataset.provider=x.provider;
      opt.dataset.port=x.port;
      if(x.model===m.selected) opt.selected=true;
      select.appendChild(opt);
    }
    if (!m.selected && select.options.length) {
      select.selectedIndex = 0;
      const opt = select.options[0];
      vscode.postMessage({command:"selectModel", model:opt.dataset.model, provider:opt.dataset.provider, port:opt.dataset.port});
    }
    info.textContent=m.models.length+" model(s) detected";
    return;
  }
  if(m.type!=="status") return;
  const dot=document.getElementById("dot");
  const state=document.getElementById("state");
  const meta=document.getElementById("meta");
  dot.className="dot";
  if(m.local.state==="local"){
    dot.classList.add("local");
    state.textContent="LOCAL • "+m.provider;
    meta.textContent=m.model+" • "+m.endpoint+" • "+m.mode;
  } else if(m.cloud.state==="cloud" && m.mode!=="strict-local"){
    dot.classList.add("cloud");
    state.textContent="CLOUD • GitHub Copilot";
    meta.textContent="Local LLM unavailable • "+m.mode;
  } else {
    dot.classList.add("offline");
    state.textContent=m.mode==="strict-local" ? "OFFLINE • Local only" : "NO LLM";
    meta.textContent=m.endpoint+" • "+m.mode;
  }
});
</script>
</body>
</html>`;
  }
}


function activate(context) {
  createStatusBar(context);

  const controlCenter = new ControlCenterProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("copilot-smart.controlCenter", controlCenter)
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "copilotSmartPanel",
      new CopilotSmartSidebarProvider(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-smart.openSettings", () => openSettingsPanel(context)),
    vscode.commands.registerCommand("copilot-smart.detect", async () => {
      const r = await detect(loadConfig());
      vscode.window.showInformationMessage(r.filter(x=>x.ok).map(x=>`${x.provider}:${x.port}`).join(", ") || "No local LLM detected.");
    }),
    vscode.commands.registerCommand("copilot-smart.models", async () => {
      try {
        const r = await discoverModels(loadConfig());
        const pick = await vscode.window.showQuickPick(r.models.map(x=>({label:x.model, description:`${x.provider}:${x.port}`, detail:x.model})), {placeHolder:"Select a local model"});
        if (pick) {
          const cfg=loadConfig(); cfg.model=pick.label; cfg.provider=pick.description.split(":")[0]; cfg.port=Number(pick.description.split(":")[1]); saveConfig(cfg);
          vscode.window.showInformationMessage(`Selected ${pick.label}`);
          updateStatusBar();
        }
      } catch(e) { vscode.window.showErrorMessage(e.message); }
    }),
    vscode.commands.registerCommand("copilot-smart.testConnection", async () => {
      const r = await testConnection(loadConfig());
      if (r.ok) vscode.window.showInformationMessage("Local LLM connection successful.");
      else if (r.statusCode === 401 || r.statusCode === 403) vscode.window.showWarningMessage("Local LLM requires authentication.");
      else vscode.window.showErrorMessage(`Local LLM connection failed: ${r.error}`);
      updateStatusBar();
    }),
    vscode.commands.registerCommand("copilot-smart.generateProvider", async () => {
      try {
        const cfg=loadConfig(), r=await discoverModels(cfg), file=generateProvider(cfg,r.models);
        vscode.window.showInformationMessage(`provider.json generated: ${file}`);
      } catch(e) { vscode.window.showErrorMessage(e.message); }
    }),
    vscode.commands.registerCommand("copilot-smart.status", status),
    vscode.commands.registerCommand("copilot-smart.refreshStatus", updateStatusBar),
    vscode.commands.registerCommand("copilot-smart.refreshModels", async () => {
      const r = await discoverModels(loadConfig());
      vscode.window.showInformationMessage(r.models.length
        ? `Found ${r.models.length} local model(s).`
        : "No local models found.");
    }),
    vscode.commands.registerCommand("copilot-smart.startTask", startSmartLocalTask)
  );
  if (loadConfig().autoDetect) {
    detect(loadConfig()).then(r => {
      const active=r.filter(x=>x.ok);
      if(active.length) vscode.window.setStatusBarMessage(`Copilot Smart: ${active.map(x=>x.provider).join(", ")} detected`, 5000);
    }).catch(()=>{});
  }
}
function deactivate() {}
module.exports = {activate, deactivate};
