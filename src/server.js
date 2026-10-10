// 本地 HTTP 服务：把 ORcode 变成一个在浏览器里用的本地应用（默认 http://localhost:3000）
// 纯 node:http 实现，无第三方依赖。提供静态 UI + JSON API + SSE 流式运行。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OMNI_DIR, PLUGIN_DIR, CONFIG_PATH, RUNS_DIR,
  configExists, loadConfig, saveConfig, ensureDirs,
} from './config.js';
import { PRESETS, buildConfigFromPreset, listPresets } from './presets.js';
import { loadPlugins } from './plugins/index.js';
import { runPipeline } from './orchestrator.js';
import { renderReport } from './report.js';
import { maskKey } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_REGISTRY = 'http://localhost:8080/plugins.json';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// 把 config 的 api_key 脱敏后返回给前端
function maskConfig(cfg) {
  if (!cfg) return null;
  const c = structuredClone(cfg);
  for (const m of Object.values(c.models || {})) if (m.api_key) m.api_key = maskKey(m.api_key);
  return c;
}

// ---------------- SSE 运行 ----------------
function sseTrace(res, send) {
  const roleId = (r) => (r && (r.id || r.name)) || 'agent';
  return {
    stage: (name, sub) => send({ type: 'stage', name, sub }),
    step: (r, instruction) => send({ type: 'step', role: r, instruction }),
    think: (role, note) => send({ type: 'think', role: roleId(role), note }),
    token: (t) => send({ type: 'token', text: t }),
    end: () => send({ type: 'end' }),
    tool: (name, args, out) => send({ type: 'tool', name, args, out: String(out) }),
    result: (label, text) => send({ type: 'result', label, text }),
    gaps: (items) => send({ type: 'gaps', items: items || [] }),
    info: (m) => send({ type: 'info', text: m }),
    done: (report) => send({ type: 'done', report }),
  };
}

async function handleRun(req, res, cwd) {
  const { task, mock, model: modelOverride } = await readBody(req);
  if (!task || !task.trim()) return sendJSON(res, 400, { error: '任务不能为空' });

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  });
  const send = (ev) => res.write('data: ' + JSON.stringify(ev) + '\n\n');
  const trace = sseTrace(res, send);

  let cfg = loadConfig();
  if (!cfg) {
    cfg = buildConfigFromPreset('full');
    cfg.registryUrl = DEFAULT_REGISTRY;
    saveConfig(cfg);
  }
  const isMock = !!mock || Object.values(cfg.models || {}).every((m) => !m.api_key || m.api_key === 'YOUR_KEY_HERE');
  // 会话里选了某个模型 → 让所有岗位都指向它（一键统配）
  if (modelOverride && cfg.models?.[modelOverride]) {
    for (const role of Object.values(cfg.roles || {})) role.model = modelOverride;
  }
  if (!isMock) {
    const bad = [];
    for (const [rid, role] of Object.entries(cfg.roles || {})) {
      const m = cfg.models?.[role.model];
      if (!m || !m.api_key || m.api_key === 'YOUR_KEY_HERE') bad.push(`${rid} → ${role.model}`);
    }
    if (bad.length) {
      send({ type: 'error', message: '以下岗位引用的模型缺少有效 api_key：' + bad.join(', ') + '（可在「配置」页填写，或勾选演示模式）' });
      return res.end();
    }
  }
  const plugins = await loadPlugins(PLUGIN_DIR);
  const ctx = { cwd };
  try {
    const report = await runPipeline(task, cfg, plugins, ctx, isMock, trace);
    ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rp = path.join(RUNS_DIR, `run-${stamp}.md`);
    fs.writeFileSync(rp, renderReport(task, report, isMock), 'utf8');
    send({ type: 'saved', path: rp });
  } catch (e) {
    send({ type: 'error', message: e.message || String(e) });
  } finally {
    res.end();
  }
}

// ---------------- API ----------------
async function handleApi(req, res, url, cwd) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/state' && method === 'GET') {
    return sendJSON(res, 200, {
      hasConfig: configExists(),
      presets: listPresets(),
      registryUrl: loadConfig()?.registryUrl || DEFAULT_REGISTRY,
      port: (globalThis.__omniPort) || 3000,
    });
  }

  if (p === '/api/config' && method === 'GET') {
    return sendJSON(res, 200, maskConfig(loadConfig()));
  }

  if (p === '/api/config' && method === 'POST') {
    const body = await readBody(req);
    ensureDirs();
    const prev = loadConfig() || {};
    const cfg = {
      _comment: prev._comment || 'models: base_url/api_key/model；roles: model 引用 models 键；pipeline: 编排顺序。',
      models: body.models || prev.models || {},
      roles: body.roles || prev.roles || {},
      pipeline: body.pipeline || prev.pipeline || { stages: ['director', 'planner', 'workers', 'verifier'], max_workers: 1, verify_rounds: 2 },
      registryUrl: body.registryUrl || prev.registryUrl || DEFAULT_REGISTRY,
    };
    saveConfig(cfg);
    return sendJSON(res, 200, { ok: true, config: maskConfig(cfg) });
  }

  if (p === '/api/init' && method === 'POST') {
    const { preset } = await readBody(req);
    ensureDirs();
    const cfg = buildConfigFromPreset(preset || 'full');
    cfg.registryUrl = DEFAULT_REGISTRY;
    saveConfig(cfg);
    return sendJSON(res, 200, { ok: true, config: maskConfig(cfg) });
  }

  if (p === '/api/preset/apply' && method === 'POST') {
    const { name } = await readBody(req);
    const p2 = PRESETS[name];
    if (!p2) return sendJSON(res, 400, { error: '未知预设: ' + name });
    const cfg = loadConfig() || buildConfigFromPreset('full');
    cfg.roles = structuredClone(p2.roles);
    cfg.pipeline = structuredClone(p2.pipeline);
    cfg.registryUrl = cfg.registryUrl || DEFAULT_REGISTRY;
    saveConfig(cfg);
    return sendJSON(res, 200, { ok: true, config: maskConfig(cfg) });
  }

  if (p === '/api/plugins' && method === 'GET') {
    const plugins = await loadPlugins(PLUGIN_DIR);
    return sendJSON(res, 200, { plugins: plugins.map((pl) => ({
      name: pl.name, description: pl.description,
      tools: pl.tools.map((t) => ({ name: t.name, description: t.description })),
      builtin: !pl.__user,
    })) });
  }

  if (p === '/api/plugins/install' && method === 'POST') {
    const { url } = await readBody(req);
    if (!url) return sendJSON(res, 400, { error: 'url 不能为空' });
    ensureDirs();
    const fname = (url.split('?')[0].split('/').pop() || 'plugin.js').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const dest = path.join(PLUGIN_DIR, fname.endsWith('.js') ? fname : fname + '.js');
    const r = await fetch(url);
    if (!r.ok) return sendJSON(res, 502, { error: '下载失败 ' + r.status });
    fs.writeFileSync(dest, await r.text(), 'utf8');
    return sendJSON(res, 200, { ok: true, path: dest });
  }

  if (p === '/api/runs' && method === 'GET') {
    ensureDirs();
    const files = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.md')).sort().reverse() : [];
    return sendJSON(res, 200, { runs: files });
  }

  if (p.startsWith('/api/runs/') && method === 'GET') {
    const name = path.basename(p.slice('/api/runs/'.length));
    const fp = path.join(RUNS_DIR, name);
    if (!fs.existsSync(fp)) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, { name, content: fs.readFileSync(fp, 'utf8') });
  }

  if (p === '/api/run' && method === 'POST') {
    return handleRun(req, res, cwd);
  }

  return sendJSON(res, 404, { error: 'unknown api: ' + p });
}

// ---------------- 静态托管 ----------------
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const fp = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(PUBLIC_DIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    // SPA 回退到 index.html
    const idx = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(idx)) {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      return res.end(fs.readFileSync(idx));
    }
    return sendJSON(res, 404, { error: 'not found' });
  }
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
}

export function startServer({ port = 3000, cwd = process.cwd() } = {}) {
  globalThis.__omniPort = port;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url, cwd);
    return serveStatic(req, res, url);
  });
  server.listen(port, () => {
    console.log(`\n◆ ORcode 本地服务已启动：${'\x1b[36m'}http://localhost:${port}${'\x1b[0m'}`);
    console.log('  按 Ctrl+C 停止。首次使用会生成 .omni/config.json，去「配置」页填模型密钥。\n');
  });
  return server;
}
