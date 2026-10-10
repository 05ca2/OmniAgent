// ORcode 本地 Web UI 前端逻辑（原生 JS，无框架）
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- 视图切换（顶部栏目 + 侧栏入口） ----------
function gotoView(name) {
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.goto === name));
  $$('.view').forEach((x) => x.classList.toggle('active', x.dataset.view === name));
  $$('.ws-item[data-goto]').forEach((x) => x.classList.toggle('active', x.dataset.goto === name));
  if (name === 'plugins') loadPlugins();
  if (name === 'reports') loadReports();
  if (name === 'config') loadConfig();
}
$$('[data-goto]').forEach((el) => el.addEventListener('click', () => gotoView(el.dataset.goto)));

// 新会话：清空输入与流水线，回到会话视图
$('#newChatBtn').addEventListener('click', () => {
  $('#taskInput').value = '';
  $('#console').innerHTML = '<div class="empty">发送任务后，这里会实时显示流水线的每一步…</div>';
  $('#consoleWrap').hidden = true;
  $('#runHint').textContent = '';
  $('#runStatus').className = 'badge';
  $('#runStatus').textContent = '待命';
  gotoView('run');
});

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (!r.ok && r.status !== 200) { const t = await r.text(); throw new Error(t); }
  return r.json();
}

// ================= 运行 =================
const consoleEl = $('#console');
const statusEl = $('#runStatus');
let viewMode = 'pipeline';   // 'pipeline' | 'terminal'
let mockViaToggle = false;  // ＋ 按钮：快捷演示模式（mock）

function ev(cls, html) {
  const d = document.createElement('div');
  d.className = 'ev-' + cls;
  d.innerHTML = html;
  consoleEl.appendChild(d);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// 加载模型列表到会话输入框的下拉（整条流水线统一选模型）
async function loadModelsSelect() {
  const sel = $('#modelSel');
  const { models } = await api('/api/config').catch(() => ({ models: null })) || {};
  const ids = models ? Object.keys(models) : [];
  if (!ids.length) {
    sel.innerHTML = '<option value="">未配置模型（去「配置」页添加）</option>';
    return;
  }
  sel.innerHTML = ids.map((id) => `<option value="${esc(id)}">${esc(id)}${models[id].model ? ' · ' + esc(models[id].model) : ''}</option>`).join('');
}

function renderEvent(e) {
  if (viewMode === 'terminal') { renderTerminal(e); return; }
  switch (e.type) {
    case 'stage': ev('stage', esc(e.name) + (e.sub ? ` <span style="color:var(--muted)">· ${esc(e.sub)}</span>` : '')); break;
    case 'step': ev('step', `${esc(e.role)}] ${esc(e.instruction)}`); break;
    case 'think': ev('think', `· ${esc(e.role)} · ${esc(e.note || '')}`); break;
    case 'token': ev('token', esc(e.text)); break;
    case 'end': ev('token', '\n'); break;
    case 'info': ev('info', esc(e.text)); break;
    case 'tool': ev('tool', `⚙ ${esc(e.name)}(${esc(JSON.stringify(e.args || {}))})<div class="out">↳ ${esc((e.out || '').slice(0, 400))}</div>`); break;
    case 'result': ev('result', `◆ ${esc(e.label)}：${esc(e.text)}`); break;
    case 'gaps': (e.items || []).forEach((g) => ev('gaps', '✗ ' + esc(g))); break;
    case 'saved': ev('saved', '— 报告已保存：' + esc(e.path)); break;
    case 'error': ev('error', '✗ ' + esc(e.message)); statusEl.className = 'badge err'; statusEl.textContent = '出错'; break;
    case 'done': break;
  }
}

// ---------- 终端模式渲染（类 claude code / codex 的实时终端流） ----------
let termBuf = null; // 当前正在累加 token 的行
function termLine(cls, html) {
  const d = document.createElement('div');
  d.className = 'term-line ' + (cls || '');
  d.innerHTML = html;
  consoleEl.appendChild(d);
  consoleEl.scrollTop = consoleEl.scrollHeight;
  return d;
}
function renderTerminal(e) {
  switch (e.type) {
    case 'stage': termBuf = null; termLine('term-role', `<span class="term-prompt">◆</span> ${esc(e.name)} <span class="term-dim">${esc(e.sub || '')}</span>`); break;
    case 'step': termBuf = null; termLine('', `<span class="term-prompt">└─</span> <span class="term-role">[${esc(e.role)}]</span> ${esc(e.instruction)}`); break;
    case 'think': termLine('term-dim', `· ${esc(e.role)} 思考中…`); break;
    case 'token':
      if (!termBuf) termBuf = termLine('', '');
      termBuf.innerHTML += esc(e.text);
      consoleEl.scrollTop = consoleEl.scrollHeight;
      break;
    case 'end': termBuf = null; break;
    case 'info': termLine('term-dim', esc(e.text)); break;
    case 'tool':
      termBuf = null;
      termLine('term-tool', `⚙ ${esc(e.name)}(${esc(JSON.stringify(e.args || {}))})`);
      if (e.out) termLine('term-dim', `↳ ${esc(String(e.out).slice(0, 400))}`);
      break;
    case 'result': termBuf = null; termLine('term-ok', `✓ ${esc(e.label)}：${esc(e.text)}`); break;
    case 'gaps': (e.items || []).forEach((g) => { termBuf = null; termLine('term-err', '✗ ' + esc(g)); }); break;
    case 'saved': termBuf = null; termLine('term-dim', '— 报告已保存：' + esc(e.path)); break;
    case 'error': termBuf = null; termLine('term-err', '✗ ' + esc(e.message)); statusEl.className = 'badge err'; statusEl.textContent = '出错'; break;
    case 'done': termBuf = null; termLine('', `<span class="term-prompt">omni@agent</span>:~$ <span class="term-cursor"></span>`); break;
  }
}

async function runTask() {
  const task = $('#taskInput').value.trim();
  if (!task) { $('#runHint').textContent = '请先描述你的任务'; return; }
  const sel = $('#modeSel').value;
  const mock = sel === 'mock' || mockViaToggle;
  const terminal = sel === 'terminal';
  viewMode = terminal ? 'terminal' : 'pipeline';
  const modelOverride = $('#modelSel').value || null;
  $('#runBtn').disabled = true;
  // 收起 hero，展开流水线面板
  $('section[data-view="run"]').classList.add('busy');
  $('#consoleWrap').hidden = false;
  consoleEl.className = 'console' + (terminal ? ' terminal-mode' : '');
  $('#termBar').hidden = !terminal;
  $('#consoleHeadText').textContent = terminal ? '终端模式 · 实时输出（各岗位协作）' : '实时流水线 · 各岗位的思考 / 工具 / 产出';
  termBuf = null;
  consoleEl.innerHTML = '';
  statusEl.className = 'badge running';
  statusEl.textContent = '运行中…';
  $('#runHint').textContent = '';

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task, mock, model: modelOverride }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload) continue;
        let e; try { e = JSON.parse(payload); } catch { continue; }
        renderEvent(e);
      }
    }
    statusEl.className = 'badge ok';
    statusEl.textContent = '完成';
    loadRecentRuns();
  } catch (e) {
    ev('error', '请求失败：' + e.message);
    statusEl.className = 'badge err';
    statusEl.textContent = '出错';
  } finally {
    $('#runBtn').disabled = false;
  }
}
$('#runBtn').addEventListener('click', runTask);
$('#taskInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runTask(); }
});

// 模式切换标签
function updateModeTag() {
  const sel = $('#modeSel');
  let label = sel.selectedOptions[0].textContent.split('（')[0];
  if (mockViaToggle || sel.value === 'mock') label = '演示模式';
  $('#modeTag').textContent = label;
}
$('#modeSel').addEventListener('change', updateModeTag);
// ＋ 按钮：快捷切换演示模式（mock），无需密钥即可看全流程
$('#mockToggle').addEventListener('click', () => {
  mockViaToggle = !mockViaToggle;
  $('#mockToggle').classList.toggle('active', mockViaToggle);
  updateModeTag();
});

// 侧栏「最近会话」
async function loadRecentRuns() {
  const wrap = $('#recentRuns');
  const { runs } = await api('/api/runs').catch(() => ({ runs: [] }));
  if (!runs.length) return;
  wrap.innerHTML = '';
  runs.slice(0, 8).forEach((name) => {
    const d = document.createElement('div');
    d.className = 'ws-item'; d.title = name;
    d.innerHTML = '<span class="ic">🗒</span> ' + esc(name.replace(/^run-|\.md$/g, ''));
    d.addEventListener('click', () => openReport(name));
    wrap.appendChild(d);
  });
}
async function openReport(name) {
  gotoView('reports');
  await loadReports();
  const items = $$('.report-item');
  const target = items.find((x) => x.dataset.name === name) || items[0];
  if (target) target.click();
}

// ================= 配置 =================
const ALL_TOOLS = ['file', 'shell', 'web'];
let cfgCache = null;

// 经典模型供应商（OpenAI 兼容端点）——选供应商自动填 base_url 与推荐模型
const PROVIDERS = [
  { name: 'DeepSeek 深度求索', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'OpenRouter（聚合）', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { name: 'Ollama（本地）', url: 'http://localhost:11434/v1', model: 'llama3.1' },
  { name: 'vLLM（本地）', url: 'http://localhost:8000/v1', model: '' },
  { name: '通义千问 DashScope', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4' },
  { name: '月之暗面 Kimi', url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '硅基流动 SiliconFlow', url: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
];

// 展示用的密钥：占位符一律显示为空，避免"示例值"误导
function keyShown(v) { return v && v !== 'YOUR_KEY_HERE' ? v : ''; }

async function loadConfig() {
  try { cfgCache = await api('/api/config'); } catch { cfgCache = null; }
  if (!cfgCache) { $('#cfgHint').textContent = '尚未初始化，点「重新生成默认配置」。'; return; }
  renderModels(); renderRoles(); renderPipeline();
}

function renderModels() {
  const wrap = $('#modelsList'); wrap.innerHTML = '';
  Object.entries(cfgCache.models || {}).forEach(([id, m]) => {
    const c = document.createElement('div'); c.className = 'card';
    const provOpts = PROVIDERS.map((p) =>
      `<option value="${esc(p.name)}" ${m.base_url === p.url ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const custom = PROVIDERS.some((p) => p.url === m.base_url) ? '' : 'selected';
    c.innerHTML = `
      <div class="card-top"><span class="card-title">${esc(id)}</span><button class="del" data-del-model="${id}">删除</button></div>
      <label>供应商（选择后自动填地址与推荐模型，也可留空自定义）</label>
      <select class="mini" data-p="${id}">
        <option value="" ${custom}>— 自定义 / 未选择 —</option>
        ${provOpts}
      </select>
      <div class="row3" style="margin-top:8px">
        <div><label>base_url</label><input class="mini" data-m="${id}" data-k="base_url" value="${esc(m.base_url || '')}" placeholder="https://api.deepseek.com/v1"></div>
        <div><label>api_key</label><input class="mini" data-m="${id}" data-k="api_key" type="password" value="${esc(keyShown(m.api_key))}" placeholder="在此粘贴你的 API Key" autocomplete="off"></div>
        <div><label>model</label><input class="mini" data-m="${id}" data-k="model" value="${esc(m.model || '')}" placeholder="模型名，如 deepseek-chat"></div>
      </div>
      <div class="row2" style="margin-top:8px">
        <div><label>temperature</label><input class="mini" data-m="${id}" data-k="temperature" value="${esc(m.temperature ?? '')}"></div>
        <div><label>max_tokens</label><input class="mini" data-m="${id}" data-k="max_tokens" value="${esc(m.max_tokens ?? '')}"></div>
      </div>`;
    wrap.appendChild(c);
  });
  $$('[data-m]', wrap).forEach((el) => el.addEventListener('input', () => {
    const id = el.dataset.m, k = el.dataset.k, v = el.value;
    cfgCache.models[id][k] = (k === 'temperature' || k === 'max_tokens') && v !== '' ? Number(v) : v;
  }));
  $$('[data-p]', wrap).forEach((sel) => sel.addEventListener('change', () => {
    const p = PROVIDERS.find((x) => x.name === sel.value);
    if (!p) return;
    const m = cfgCache.models[sel.dataset.p];
    m.base_url = p.url;
    if (p.model) m.model = p.model;
    renderModels();
  }));
  $$('[data-del-model]', wrap).forEach((b) => b.addEventListener('click', () => {
    delete cfgCache.models[b.dataset.delModel]; renderModels();
  }));
}

function renderRoles() {
  const wrap = $('#rolesList'); wrap.innerHTML = '';
  const modelIds = Object.keys(cfgCache.models || {});
  Object.entries(cfgCache.roles || {}).forEach(([id, r]) => {
    const c = document.createElement('div'); c.className = 'card';
    const toolChips = ALL_TOOLS.map((t) =>
      `<span class="chip ${ (r.tools || []).includes(t) ? 'on' : '' }" data-role="${id}" data-tool="${t}">${t}</span>`).join('');
    const modelOpts = modelIds.map((m) => `<option ${m === r.model ? 'selected' : ''}>${m}</option>`).join('');
    c.innerHTML = `
      <div class="card-top"><span class="card-title">${esc(r.name || id)} <span style="color:var(--muted);font-size:11px">(${esc(id)})</span></span><button class="del" data-del-role="${id}">删除</button></div>
      <div class="row2">
        <div><label>名称</label><input class="mini" data-r="${id}" data-k="name" value="${esc(r.name || '')}"></div>
        <div><label>模型</label><select class="mini" data-r="${id}" data-k="model">${modelOpts}</select></div>
      </div>
      <label style="margin-top:8px;display:block">system 提示词</label>
      <textarea class="mini" rows="3" data-r="${id}" data-k="system">${esc(r.system || '')}</textarea>
      <label style="margin-top:8px;display:block">工具（点击切换）</label>
      <div class="tools-chips">${toolChips}</div>`;
    wrap.appendChild(c);
  });
  $$('[data-r]', wrap).forEach((el) => {
    const on = () => { cfgCache.roles[el.dataset.r][el.dataset.k] = el.value; };
    el.addEventListener('input', on);
    el.addEventListener('change', on);
  });
  $$('[data-role]', wrap).forEach((chip) => chip.addEventListener('click', () => {
    const id = chip.dataset.role, t = chip.dataset.tool;
    const arr = cfgCache.roles[id].tools || (cfgCache.roles[id].tools = []);
    const i = arr.indexOf(t);
    if (i >= 0) arr.splice(i, 1); else arr.push(t);
    chip.classList.toggle('on');
  }));
  $$('[data-del-role]', wrap).forEach((b) => b.addEventListener('click', () => {
    delete cfgCache.roles[b.dataset.delRole]; renderRoles();
  }));
}

function renderPipeline() {
  const p = cfgCache.pipeline || { stages: ['director', 'planner', 'workers', 'verifier'], max_workers: 1, verify_rounds: 2 };
  const stages = ['director', 'planner', 'workers', 'verifier'];
  const wrap = $('#pipelineCfg');
  wrap.innerHTML = `
    <label>编排阶段（按顺序执行）</label>
    <div class="tools-chips" id="stageChips">
      ${stages.map((s) => `<span class="chip ${p.stages.includes(s) ? 'on' : ''}" data-stage="${s}">${s}</span>`).join('')}
    </div>
    <div class="row2" style="margin-top:10px">
      <div><label>max_workers（并发岗位数）</label><input class="mini" id="maxw" type="number" min="1" value="${p.max_workers || 1}"></div>
      <div><label>verify_rounds（检验轮数）</label><input class="mini" id="vr" type="number" min="1" value="${p.verify_rounds || 1}"></div>
    </div>`;
  $$('#stageChips .chip', wrap).forEach((chip) => chip.addEventListener('click', () => {
    const s = chip.dataset.stage;
    const arr = cfgCache.pipeline.stages;
    const i = arr.indexOf(s);
    if (i >= 0) arr.splice(i, 1); else arr.push(s);
    chip.classList.toggle('on');
  }));
  $('#maxw', wrap).addEventListener('input', (e) => cfgCache.pipeline.max_workers = Number(e.target.value));
  $('#vr', wrap).addEventListener('input', (e) => cfgCache.pipeline.verify_rounds = Number(e.target.value));
}

$('#saveCfgBtn').addEventListener('click', async () => {
  try { await api('/api/config', { method: 'POST', body: JSON.stringify(cfgCache) }); $('#cfgHint').textContent = '已保存 ✓'; loadModelsSelect(); }
  catch (e) { $('#cfgHint').textContent = '保存失败：' + e.message; }
});
$('#reinitBtn').addEventListener('click', async () => {
  await api('/api/init', { method: 'POST', body: JSON.stringify({ preset: 'full' }) });
  $('#cfgHint').textContent = '已重新生成默认配置'; loadConfig();
});
$('#addModelBtn').addEventListener('click', () => {
  const id = 'm' + (Object.keys(cfgCache.models).length + 1);
  // 不预填任何示例值：base_url/key/model 留空，由用户选供应商或手填
  cfgCache.models[id] = { base_url: '', api_key: '', model: '', temperature: 0.7 };
  renderModels();
});
$('#addRoleBtn').addEventListener('click', () => {
  const id = 'role' + (Object.keys(cfgCache.roles).length + 1);
  const firstModel = Object.keys(cfgCache.models)[0] || 'main';
  cfgCache.roles[id] = { id, name: '新岗位', model: firstModel, system: '你是一个助手。', tools: [], temperature: 0.4 };
  renderRoles();
});

async function loadPresets() {
  try {
    const { presets } = await api('/api/state');
    const sel = $('#presetSel');
    presets.forEach((p) => { const o = document.createElement('option'); o.value = p.name; o.textContent = `${p.name} — ${p.description}`; sel.appendChild(o); });
  } catch {}
}
$('#applyPresetBtn').addEventListener('click', async () => {
  const name = $('#presetSel').value;
  if (!name) return;
  await api('/api/preset/apply', { method: 'POST', body: JSON.stringify({ name }) });
  $('#cfgHint').textContent = `已套用预设「${name}」（models 保留）`; loadConfig();
});

// ================= 插件中心 =================
async function loadPlugins() {
  const reg = (await api('/api/state').catch(() => ({})))?.registryUrl || '';
  $('#registrySrc').textContent = reg ? '· ' + reg : '';
  const { plugins } = await api('/api/plugins');
  const wrap = $('#installedPlugins'); wrap.innerHTML = '';
  plugins.forEach((p) => {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<div class="card-top"><span class="plugin-name">${esc(p.name)}</span>${p.builtin ? '<span class="tag">内置</span>' : '<span class="tag" style="background:rgba(176,125,255,.12);color:var(--accent-2);border-color:rgba(176,125,255,.3)">已下载</span>'}</div>
      <div class="plugin-desc">${esc(p.description || '')}</div>
      <div class="tool-tags">${(p.tools || []).map((t) => `<span class="tag">${esc(t.name)}</span>`).join('')}</div>`;
    wrap.appendChild(c);
  });

  const mwrap = $('#marketPlugins'); mwrap.innerHTML = '';
  if (!reg) return;
  try {
    const list = await (await fetch(reg)).json();
    list.forEach((pl) => {
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = `<div class="card-top"><span class="plugin-name">${esc(pl.name)}</span><span class="muted sm">v${esc(pl.version || '1.0')}</span></div>
        <div class="plugin-desc">${esc(pl.description || '')}</div>
        <div class="tool-tags">${(pl.tools || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="plugin-actions"><button class="btn small primary" data-install="${esc(pl.download)}">一键安装</button></div>`;
      mwrap.appendChild(c);
    });
    $$('[data-install]', mwrap).forEach((b) => b.addEventListener('click', () => installFromUrl(b.dataset.install)));
  } catch (e) {
    mwrap.innerHTML = `<div class="muted sm">无法加载插件市场（请确认官网服务已启动：${esc(reg)}）</div>`;
  }
}

async function installFromUrl(url) {
  $('#pluginHint').textContent = '安装中…';
  try {
    await api('/api/plugins/install', { method: 'POST', body: JSON.stringify({ url }) });
    $('#pluginHint').textContent = '安装成功 ✓ 已在「已安装插件」中';
    loadPlugins();
  } catch (e) { $('#pluginHint').textContent = '安装失败：' + e.message; }
}
$('#installUrlBtn').addEventListener('click', () => {
  const url = $('#pluginUrl').value.trim();
  if (url) installFromUrl(url);
});

// ================= 报告 =================
async function loadReports() {
  const { runs } = await api('/api/runs').catch(() => ({ runs: [] }));
  const wrap = $('#reportsList'); wrap.innerHTML = '';
  runs.forEach((name) => {
    const d = document.createElement('div'); d.className = 'report-item'; d.dataset.name = name; d.textContent = name;
    d.addEventListener('click', async () => {
      $$('.report-item').forEach((x) => x.classList.remove('active'));
      d.classList.add('active');
      const { content } = await api('/api/runs/' + encodeURIComponent(name));
      $('#reportView').textContent = content;
    });
    wrap.appendChild(d);
  });
}

// 初始化
loadPresets();
loadRecentRuns();
loadModelsSelect();
updateModeTag();
