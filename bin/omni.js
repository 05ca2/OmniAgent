#!/usr/bin/env node
// OmniAgent CLI 入口：init / run / chat / config / roles / models / plugin / preset / help
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { OMNI_DIR, PLUGIN_DIR, CONFIG_PATH, RUNS_DIR, configExists, loadConfig, saveConfig, ensureDirs } from '../src/config.js';
import { PRESETS, buildConfigFromPreset, listPresets } from '../src/presets.js';
import { loadPlugins } from '../src/plugins/index.js';
import { runPipeline } from '../src/orchestrator.js';
import { renderReport } from '../src/report.js';
import { cliTrace } from '../src/trace.js';
import { startServer } from '../src/server.js';
import { startSiteServer } from '../site/server.js';
import { maskKey, truncate } from '../src/util.js';
import { ui } from '../src/ui.js';

const HELP = `
OmniAgent —— 多模型协作智能体开发工具
用法：node bin/omni.js <命令> [参数]

命令：
  init [--preset <name>]       在当前目录初始化 .omni/config.json（含预设岗位）
  run "<任务>" [--mock] [--preset <name>]
                               运行一次多模型编排流水线（指挥→规划→执行→检验）
  chat [--mock] [--preset <name>]
                               进入 opencode 风格双栏终端界面（左对话流+右信息侧栏），
                               输入 / 弹出命令补全；tab 切换岗位 · ctrl+p 命令面板 · esc 中断
                               会话命令：/agents /mock /model /plugins /reload /status /clear /help /exit
  serve [--port 3000]          启动本地 Web 服务，浏览器打开 http://localhost:3000 使用
  site [--port 8080]           启动官方官网（含插件中心 / 反馈），默认 http://localhost:8080
  config                       查看当前配置（密钥脱敏）
  roles                        列出已配置的岗位
  models                       列出已配置的模型
  plugin add <url>             从 URL 下载一个插件(.js)到 .omni/plugins
  preset list                  列出可用预设
  preset apply <name>          套用某预设的岗位与流水线（保留你的 models）
  help                         显示本帮助

示例：
  node bin/omni.js init
  node bin/omni.js run "用 Python 写一个贪吃蛇游戏并跑通" --mock
  node bin/omni.js run "调研 RAG 的主流方案" --preset research
`;

function parseFlags(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mock') flags.mock = true;
    else if (argv[i] === '--preset') flags.preset = argv[++i];
    else if (argv[i] === '--force') flags.force = true;
    else if (argv[i] === '--port') flags.port = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, flags };
}

function checkKeys(cfg, mock) {
  if (mock) return;
  const bad = [];
  for (const [roleId, role] of Object.entries(cfg.roles || {})) {
    const m = cfg.models?.[role.model];
    if (!m || !m.api_key || m.api_key === 'YOUR_KEY_HERE') bad.push(`${roleId} → 模型「${role.model}」缺少有效 api_key`);
  }
  if (bad.length) {
    ui.error('以下岗位引用的模型尚未配置有效密钥：\n  ' + bad.join('\n  ') + '\n请先编辑 .omni/config.json 填入 api_key，或加 --mock 体验演示。');
    process.exit(1);
  }
}

function applyPreset(cfg, name) {
  const p = PRESETS[name];
  if (!p) { ui.error('未知预设: ' + name + '（用 preset list 查看）'); process.exit(1); }
  cfg.roles = structuredClone(p.roles);
  cfg.pipeline = structuredClone(p.pipeline);
  return cfg;
}

// ---------- ANSI 基础（仅在真实终端上色） ----------
const IS_TTY = process.stdout.isTTY && process.stdin.isTTY && !process.env.NO_COLOR;
const dim = (s) => (IS_TTY ? `\x1b[2m${s}\x1b[0m` : String(s));
const bold = (s) => (IS_TTY ? `\x1b[1m${s}\x1b[0m` : String(s));
const cyan = (s) => (IS_TTY ? `\x1b[36m${s}\x1b[0m` : String(s));
const grey = (s) => (IS_TTY ? `\x1b[90m${s}\x1b[0m` : String(s));
const yellow = (s) => (IS_TTY ? `\x1b[33m${s}\x1b[0m` : String(s));
const green = (s) => (IS_TTY ? `\x1b[32m${s}\x1b[0m` : String(s));

// ---------- opencode 风格像素 Logo ----------
const GLYPHS = {
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  G: ['.####', '#....', '#..##', '#...#', '.###.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
};
// ---------- 品牌标志（tools/logo2ascii.js 从用户 PNG 生成，Codex 风格暗色背景） ----------
const LOGO_ART = "\n\n\n\n                          ⣀⡀\n                        ⢀⣾⠟⢿⣆\n                       ⢀⣾⠏ ⠈⢿⡄\n             ⢀⣀⣀⣀     ⢀⣾⠏   ⠘⣿⡄\n          ⣠⣶⠿⠛⠛⠛⠛⠻⢷⣦⡀⢀⣾⠏     ⠘⣿⡀\n        ⢠⣾⠏        ⠈⢿⣾⠋       ⠹⣷⡀\n        ⣿⠇           ⣿⡆  ⢀⣀⣀⣀⣀⣰⣿⣿⡆\n        ⣿⡄           ⣿⣇⣴⠿⠛⠋⠉⠉⠉⠉⠙⢿⣆\n        ⠹⣷⡀         ⣰⡿⠟⠁        ⠈⢿⣆\n         ⠘⠿⣦⣄⣀  ⢀⣀⣤⡾⠛            ⠈⣿⡄\n           ⠈⠉⠛⠛⠛⠛⠋⠉               ⠘⠛\n\n\n\n\n                                    ⠈⠐⠂⠃⠈⠃⠂";
const LOGO_LINES = LOGO_ART.split('\n');

function pixelLogo(word) {
  const rows = ['', '', '', '', ''];
  word.split('').forEach((ch, i) => {
    const g = GLYPHS[ch] || GLYPHS.O;
    const paint = i < 4 ? grey : bold; // 前半段灰、后半段亮，仿 opencode 双色调
    for (let r = 0; r < 5; r++) rows[r] += paint(g[r].replace(/#/g, '█').replace(/\./g, ' ')) + ' ';
  });
  return rows.join('\n');
}

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.2.0'; } catch { return '0.2.0'; } })();

// ---------- 会话命令表（输入 / 时弹出补全，仿 opencode） ----------
const COMMANDS = [
  ['/agents',  'Switch agent · 切换岗位'],
  ['/mock',    'Toggle mock mode · 演示模式（无需密钥）'],
  ['/model',   'Use one model for all roles · 统一模型'],
  ['/plugins', 'List installed plugins · 插件列表'],
  ['/reload',  'Reload config · 重载配置'],
  ['/status',  'Session status · 会话状态'],
  ['/clear',   'Clear the screen · 清屏'],
  ['/help',    'Show help · 帮助'],
  ['/exit',    'Exit the app · 退出'],
];

const ANSI_RE = /\x1b\[[0-9;]*m/g;
// CJK 感知字符宽度：中日韩全角字符在终端占 2 列
function charWidth(c) {
  const x = c.codePointAt(0);
  if (x < 0x1100) return 1;
  if ((x >= 0x1100 && x <= 0x115F) || (x >= 0x2E80 && x <= 0xA4CF) || (x >= 0xAC00 && x <= 0xD7A3) ||
      (x >= 0xF900 && x <= 0xFAFF) || (x >= 0xFE30 && x <= 0xFE6F) || (x >= 0xFF00 && x <= 0xFF60) ||
      (x >= 0xFFE0 && x <= 0xFFE6) || (x >= 0x20000 && x <= 0x3FFFD)) return 2;
  return 1;
}
const vlen = (s) => { let n = 0; for (const ch of s.replace(ANSI_RE, '')) n += charWidth(ch); return n; };
const vpad = (s, w) => { const n = vlen(s); return n > w ? cutPlain(s, w) : s + ' '.repeat(w - n); };
function cutPlain(s, w) { // 按显示宽度截断（保留 ANSI 颜色码）
  let out = '', n = 0, i = 0;
  while (i < s.length && n < w) {
    if (s[i] === '\x1b') { const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i)); if (m) { out += m[0]; i += m[0].length; continue; } }
    const ch = String.fromCodePoint(s.codePointAt(i));
    const cw = charWidth(ch);
    if (n + cw > w) break;
    out += ch; n += cw; i += ch.length;
  }
  return out + '\x1b[0m';
}
const vwrap = (s, w) => { // 纯文本按显示宽度折叠成多行
  const lines = [];
  for (const raw of String(s).split('\n')) {
    let cur = '', n = 0;
    for (const ch of raw) {
      const cw = charWidth(ch);
      if (n + cw > w) { lines.push(cur); cur = ''; n = 0; }
      cur += ch; n += cw;
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
};

// 终端交互模式（opencode 风格双栏 TUI）：左=对话流+输入框，右=会话信息侧栏
async function runInteractive(baseCfg, flags, plugins) {
  if (!IS_TTY) return legacyLoop(baseCfg, flags, plugins); // 管道/重定向：走简单逐行模式

  const out = (s) => process.stdout.write(s);
  let cfg = baseCfg;
  let mock = !!flags.mock;
  let chatModel = null;
  let agentIdx = 0;
  let busy = false;
  let line = '';
  let tokens = 0;
  let interrupted = false;
  let streamBuf = ''; // 正在流式输出的模型文本
  const transcript = []; // 主区对话行（已带 ANSI）
  const sessionStart = new Date();
  const pluginNames = plugins.map((p) => ({ name: p.name, n: (p.tools || []).length }));

  let popupOpen = false;
  let popupSel = 0;

  let resolveInput = null;
  const waitInput = () => new Promise((res) => { resolveInput = res; });

  const roleIds = () => Object.keys(cfg.roles || {});
  function currentRole() {
    const ids = roleIds();
    if (!ids.length) return null;
    return ids[agentIdx % ids.length];
  }

  function push(t) { transcript.push(t); }
  function flushStream() {
    if (!streamBuf) return;
    vwrap(streamBuf.trimEnd(), 200).forEach((l) => push('  ' + l));
    streamBuf = '';
  }

  // 流水线 trace：把事件写进对话区（而非 ui 直写终端）
  const tuiTrace = () => ({
    stage: (n, s) => { if (interrupted) throw new Error('__INTERRUPT__'); flushStream(); push('\n' + bold(cyan('◆ ' + n)) + (s ? grey('  ' + s) : '') + '\n'); },
    step: (role, ins) => { if (interrupted) throw new Error('__INTERRUPT__'); flushStream(); const s0 = String(ins).replace(/\s+/g, ' ').trim(); const s = s0.length > 40 ? s0.slice(0, 40) + '…' : s0; push(grey('└─ ') + bold(role) + grey(' · ' + s)); },
    think: (role, note) => { if (interrupted) throw new Error('__INTERRUPT__'); },
    token: (t) => { if (interrupted) throw new Error('__INTERRUPT__'); streamBuf += t; tokens += Math.max(1, Math.round(t.length / 3)); },
    end: () => flushStream(),
    tool: (name, args, o) => { flushStream(); push(grey('  ⚙ ') + cyan(name) + grey('(' + JSON.stringify(args || {}).slice(0, 60) + ')')); if (o) vwrap('    ↳ ' + String(o).slice(0, 160), 200).forEach((l) => push(grey(l))); },
    result: (label, text) => { flushStream(); push('\n' + yellow('◆ ' + label) + '  ' + String(text).slice(0, 200) + '\n'); },
    gaps: (items) => { flushStream(); (items || []).forEach((g) => push(yellow('✗ ' + g))); },
    info: (m) => { flushStream(); const s = String(m).replace(/\s+/g, ' ').trim(); push(grey(s.length > 60 ? s.slice(0, 60) + '…' : s)); },
    done: () => flushStream(),
  });

  // ---------- 渲染 ----------
  let renderTimer = null;
  function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 40); }

  function popupEntries() {
    if (!line.startsWith('/')) return null;
    const q = line.split(' ')[0].toLowerCase();
    const list = COMMANDS.filter(([c]) => c.startsWith(q));
    return list.length ? list : null;
  }

  function sidebarLines(H, SW) {
    const w = SW - 1;
    const cut = (s) => cutPlain(s, w);
    const L = [];
    L.push(cut(bold('New session — ' + sessionStart.toISOString())));
    L.push('');
    L.push(cut(bold('Context')));
    L.push(cut(grey(`  ${tokens} tokens`)));
    L.push(cut(grey('  0% used')));
    L.push(cut(grey('  $0.00 spent')));
    L.push('');
    L.push(cut(bold('▾ MCP')));
    if (pluginNames.length) for (const p of pluginNames) L.push(cut(cyan('● ') + p.name + grey(' Connected')));
    else L.push(cut(grey('  no plugins loaded')));
    L.push('');
    L.push(cut(bold('LSP')));
    L.push(cut(grey('LSPs are disabled')));
    L.push('');
    const role = currentRole();
    const r = role ? cfg.roles[role] : null;
    const m = r ? cfg.models[r.model] : null;
    const bw = SW - 2;
    L.push(cut('┌' + '─'.repeat(bw) + '┐'));
    L.push(cut('│ ' + cyan('Agents') + ' '.repeat(Math.max(0, bw - 1 - vlen('Agents'))) + '│'));
    const agLine = role ? `${role} · ${busy ? 'busy' : 'idle'}` : 'no roles';
    L.push(cut('│ ' + agLine + ' '.repeat(Math.max(0, bw - 1 - agLine.length)) + '│'));
    L.push(cut('└' + '─'.repeat(bw) + '┘'));
    while (L.length < H - 2) L.push('');
    L.length = Math.max(L.length, H - 2);
    L[H - 2] = cut(grey('/~ ') + path.basename(process.cwd()));
    L[H - 1] = cut(cyan('● ') + 'OmniAgent ' + grey('v' + VERSION) + (mock ? yellow('  mock') : ''));
    return L.slice(0, H);
  }

  function render() {
    const W = process.stdout.columns || 100;
    const H = Math.max(12, (process.stdout.rows || 30) - 1);
    const SW = Math.min(38, Math.max(26, Math.floor(W * 0.3)));
    const MW = W - SW - 1;

    // ---- 侧栏 ----
    const sb = sidebarLines(H, SW);

    // ---- 主区 ----
    const pop = popupEntries();
    let popRows = [];
    if (pop) {
      const maxShow = Math.min(pop.length, Math.max(3, H - 10));
      const start = Math.max(0, Math.min(popupSel - maxShow + 1, pop.length - maxShow));
      const show = pop.slice(start, start + maxShow);
      popRows.push('');
      show.forEach(([c, d], i) => {
        const sel = start + i === popupSel;
        const name = c.padEnd(11);
        const row = ' ' + name + d;
        popRows.push(sel ? '\x1b[48;5;208m\x1b[38;5;16m' + cutPlain(row, MW - 1) + '\x1b[0m' : grey(cutPlain(row, MW - 1)));
      });
    }

    const inputRow = (line ? cutPlain(line, MW - 3) : grey('Ask anything…')) + '█';
    const role = currentRole();
    const r = role ? cfg.roles[role] : null;
    const m = r ? cfg.models[r.model] : null;
    const agName = chatModel
        ? bold(cyan('◆ 统一模型 · ' + (cfg.models[chatModel]?.model || chatModel)))
        : role
        ? bold(cyan(role)) + grey(' — ' + (r?.name || '')) + grey('  ·  ' + (m ? m.model : ''))
        : yellow('⚠ 未配置岗位');
    const agRow = agName + (mock ? yellow('  mock') : '');
    const hintL = busy ? grey('·········') + ' esc interrupt' : '';
    const hintR = 'tab agents   ctrl+p commands';
    const hintPad = Math.max(1, MW - vlen(hintL) - vlen(hintR) - 2);
    const hintRow = hintL + ' '.repeat(hintPad) + hintR;

    const fixedRows = 1 + popRows.length + 1 + 1 + 1; // input+popup+agent+hints
    const showN = Math.max(1, H - fixedRows);
    const head = transcript.length > showN ? grey('… （上方还有 ' + (transcript.length - showN) + ' 行）') : '';
    const body = transcript.slice(-showN);
    const main = [];
    if (head) main.push(cutPlain(head, MW));
    for (const t of body) {
      if (t === '\n') { main.push(''); continue; }
      for (const l of vwrap(t.replace(/\n/g, ''), MW)) main.push(l);
    }
    // 流式中的文本占一行
    if (streamBuf) main.push(...vwrap('  ' + streamBuf.replace(/\n/g, ' ').slice(-400), MW));

    while (main.length < showN) main.push('');
    main.splice(0, Math.max(0, main.length - showN));
    main.push(...popRows, inputRow, agRow, hintRow);

    // ---- 合成双栏 ----
    const rows = [];
    for (let i = 0; i < H; i++) rows.push(vpad(main[i] || '', MW) + grey(' │ ') + (sb[i] || ''));
    out('\x1b[H\x1b[2J' + rows.join('\n') + '\n');
  }

  function missingKeys() {
    const roles = chatModel ? [{ model: chatModel }] : Object.values(cfg.roles || {});
    const bad = [];
    for (const r of roles) {
      const m = cfg.models?.[r.model];
      if (!m || !m.api_key || m.api_key === 'YOUR_KEY_HERE') bad.push(r.model);
    }
    return [...new Set(bad)];
  }

  function execCommand(t) {
    if (t === '/exit' || t === '/quit') exitTui();
    else if (t === '/help') {
      push(bold('会话命令：'));
      COMMANDS.forEach(([c, d]) => push('  ' + cyan(c.padEnd(11)) + grey(d)));
    } else if (t === '/clear') { transcript.length = 0; }
    else if (t === '/mock') { mock = !mock; push(yellow('演示模式：' + (mock ? '开（无需密钥）' : '关'))); }
    else if (t === '/agents') { agentIdx++; chatModel = null; const nr = currentRole(); push(grey('岗位切换 → ') + cyan(nr || '（无）')); }
    else if (t === '/reload') {
      const c = loadConfig();
      if (c) { cfg = c; agentIdx = 0; chatModel = null; push(green('配置已重载')); } else push(yellow('未找到配置'));
    } else if (t === '/status') {
      push(bold('OmniAgent') + grey(` v${VERSION}`) + (mock ? yellow('  [演示模式]') : ''));
      for (const [id, mm] of Object.entries(cfg.models || {})) push(`  模型 ${id}: ${mm.model} @ ${mm.base_url} (${maskKey(mm.api_key)})`);
      for (const [id, rr] of Object.entries(cfg.roles || {})) push(`  岗位 ${id} → ${rr.model} · 工具:${rr.tools.join(',') || '无'}`);
      push(`  插件 ${pluginNames.length} 个：${pluginNames.map((p) => p.name).join(', ') || '无'}`);
      push(`  会话 tokens ≈ ${tokens} · 报告目录 .omni/runs`);
    } else if (t === '/plugins') {
      push(bold(`已装插件 ${pluginNames.length} 个：`));
      pluginNames.forEach((p) => push('  ' + cyan('● ' + p.name) + grey(` · ${p.n} 个工具 · 已加载`)));
    } else if (t.startsWith('/model ')) {
      const id = t.slice(7).trim();
      if (cfg.models?.[id]) { chatModel = id; push(green('本次会话统一模型：' + id)); }
      else push(yellow('无此模型：' + id + '（/status 查看可用模型）'));
    } else if (t.startsWith('/')) {
      push(yellow('未知命令：' + t) + grey('（输入 / 查看全部命令）'));
    } else return false;
    return true;
  }

  let started = false;

  function submit(raw) {
    const t = raw.trim();
    line = '';
    popupOpen = false;
    if (!t) { render(); return; }
    if (!started) {
      started = true;
      transcript.length = 0; // 首次输入：清屏并切换布局
      push(bold('> OmniAgent') + grey('  (v' + VERSION + ')'));
      push('  ' + grey(process.cwd()));
      push('  ' + grey('permissions: ') + yellow('YOLO mode'));
      const rows = process.stdout.rows || 30;
      const pad = Math.max(1, Math.floor((rows - LOGO_LINES.length - 8) / 2));
      for (let i = 0; i < pad; i++) push('');
      for (const l of LOGO_LINES) push(grey(l));
      for (let i = 0; i < pad; i++) push('');
    }
    push(grey('❯ ') + bold(t));
    if (t.startsWith('/')) { execCommand(t); render(); return; }
    const bad = mock ? [] : missingKeys();
    if (bad.length) { push(yellow('以下模型缺少有效密钥：' + bad.join(', ')) + grey('（输入 /mock 体验演示，或去配置页填 key）')); render(); return; }
    let runCfg = cfg;
    if (chatModel) { runCfg = structuredClone(cfg); for (const rr of Object.values(runCfg.roles)) rr.model = chatModel; }
    busy = true; interrupted = false; tokens = 0;
    render();
    (async () => {
      try {
        const report = await runPipeline(t, runCfg, plugins, { cwd: process.cwd() }, mock, tuiTrace());
        ensureDirs();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rp = path.join(RUNS_DIR, `run-${stamp}.md`);
        fs.writeFileSync(rp, renderReport(t, report, mock), 'utf8');
        push('\n' + dim('运行报告已保存：' + rp) + '\n');
      } catch (e) {
        if (String(e?.message).includes('__INTERRUPT__')) push(yellow('⏹ 已中断（esc interrupt）'));
        else push('\n' + String(e?.message || e) + '\n');
      }
      busy = false; interrupted = false; streamBuf = '';
      render();
    })();
  }

  function onKey(str, key) {
    if (!key) return;
    if (key.ctrl && key.name === 'c') { exitTui(); return; }
    if (key.ctrl && key.name === 'p') {
      // ctrl+p：展开/收起命令面板（有输入时以输入为前缀过滤；空输入时列出全部）
      if (popupOpen) { popupOpen = false; }
      else { if (!line.startsWith('/')) line = '/'; popupSel = 0; popupOpen = popupEntries() != null; if (!popupOpen) { line = ''; push(yellow('没有匹配的命令')); } }
      render(); return;
    }
    if (busy) {
      if (key.name === 'escape') { interrupted = true; }
      return;
    }
    if (key.name === 'escape') { if (popupOpen) { popupOpen = false; render(); } else if (line) { line = ''; render(); } return; }
    if (key.name === 'up') { if (popupOpen) { const n = popupEntries()?.length || 1; popupSel = (popupSel - 1 + n) % n; render(); } return; }
    if (key.name === 'down') { if (popupOpen) { const n = popupEntries()?.length || 1; popupSel = (popupSel + 1) % n; render(); } return; }
    if (key.name === 'tab') {
      if (popupOpen) { const e = popupEntries(); if (e?.[popupSel]) { line = e[popupSel][0] + ' '; popupOpen = false; render(); } return; }
      agentIdx++; chatModel = null; const nr = currentRole(); if (nr) push(grey('岗位切换 → ') + cyan(nr)); render(); return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      if (popupOpen) { const e = popupEntries(); if (e?.[popupSel]) { line = e[popupSel][0] + ' '; popupOpen = false; render(); return; } }
      submit(line);
      return;
    }
    if (key.name === 'backspace') { line = [...line].slice(0, -1).join(''); popupOpen = popupEntries() != null; if (popupOpen) popupSel = 0; render(); return; }
    if (str && !key.ctrl && !key.meta) {
      const clean = str.replace(/[\r\n]/g, '');
      if (clean) {
        const wasCmd = line.startsWith('/');
        line += clean;
        if (line.startsWith('/') && !line.includes(' ')) { if (!wasCmd) popupSel = 0; popupOpen = popupEntries() != null; }
        else popupOpen = false;
        render();
      }
    }
  }

  function exitTui() {
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.removeListener('keypress', onKey);
    process.stdin.pause();
    out('\n' + grey('再见。') + '\n');
    process.exit(0);
  }

  // 启动画面
  out('\x1b[2J\x1b[H\n' + LOGO_LINES.map((l) => grey(l)).join('\n') + '\n');
  push(dim('欢迎使用 OmniAgent 终端模式 —— 直接输入任务，或输入 / 查看命令。tab 切换岗位，ctrl+p 命令面板。'));
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('keypress', onKey);
  render();

  while (true) await waitInput();
}

// 非 TTY（管道/脚本）：简单逐行模式
async function legacyLoop(baseCfg, flags, plugins) {
  let cfg = baseCfg;
  let mock = !!flags.mock;
  let chatModel = null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => process.stdout.write((IS_TTY ? '\x1b[36m' : '') + 'omni ❯ ' + (IS_TTY ? '\x1b[0m' : ''));
  ui.info('交互模式（管道）。会话命令：/mock /model <id> /reload /status /exit');
  prompt();
  for await (const l of rl) {
    const t = l.trim();
    if (!t) { prompt(); continue; }
    if (t === '/exit' || t === '/quit') break;
    if (t === '/mock') { mock = !mock; ui.info('演示模式：' + (mock ? '开' : '关')); prompt(); continue; }
    if (t === '/reload') { const c = loadConfig(); if (c) { cfg = c; ui.ok('配置已重载'); } prompt(); continue; }
    if (t === '/status') { ui.info('模型：' + Object.keys(cfg.models || {}).join(', ') + ' | 岗位：' + Object.keys(cfg.roles || {}).join(', ')); prompt(); continue; }
    if (t.startsWith('/model ')) {
      const id = t.slice(7).trim();
      if (cfg.models?.[id]) { chatModel = id; ui.info('会话统一模型：' + id); } else ui.warn('无此模型：' + id);
      prompt(); continue;
    }
    if (t.startsWith('/')) { ui.warn('未知命令：' + t); prompt(); continue; }
    try {
      let runCfg = cfg;
      if (chatModel) { runCfg = structuredClone(cfg); for (const r of Object.values(runCfg.roles)) r.model = chatModel; }
      const report = await runPipeline(t, runCfg, plugins, { cwd: process.cwd() }, mock, cliTrace());
      ensureDirs();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(RUNS_DIR, `run-${stamp}.md`), renderReport(t, report, mock), 'utf8');
      ui.ok('运行报告已保存');
    } catch (e) { ui.error(e); }
    prompt();
  }
  rl.close();
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseFlags(rest);

  if (!cmd || cmd === 'help' || cmd === '-h') {
    // 终端里直接敲 `node bin/omni.js`（无参数）即进入交互模式；管道/重定向时显示帮助
    if (!cmd && process.stdin.isTTY) {
      let cfg = loadConfig();
      if (!cfg) { ui.error('尚未初始化，请先运行 init 生成配置'); ui.info('生成后直接运行 node bin/omni.js 即可进入交互模式'); return; }
      const plugins = await loadPlugins(PLUGIN_DIR);
      await runInteractive(cfg, flags, plugins);
      return;
    }
    console.log(HELP); return;
  }

  if (cmd === 'init') {
    const name = flags.preset || 'full';
    if (configExists() && !flags.force) { ui.warn('.omni/config.json 已存在，用 --force 覆盖'); return; }
    ensureDirs();
    const cfg = buildConfigFromPreset(name);
    cfg.registryUrl = 'http://localhost:8080/plugins.json';
    saveConfig(cfg);
    ui.ok(`已生成配置（预设 ${name}）→ ${CONFIG_PATH}`);
    ui.info('下一步：编辑该文件，把 models.main.api_key 换成你的密钥；可增删 roles、改成不同模型实现多模型协作。');
    ui.info('然后运行：node bin/omni.js run "你的任务"');
    return;
  }

  if (cmd === 'preset') {
    if (pos[0] === 'list') {
      ui.header('可用预设');
      listPresets().forEach((p) => ui.info(`· ${p.name} —— ${p.description}`));
      return;
    }
    if (pos[0] === 'apply') {
      const name = pos[1];
      const cfg = loadConfig() || buildConfigFromPreset('full');
      applyPreset(cfg, name);
      saveConfig(cfg);
      ui.ok(`已套用预设「${name}」（models 保持不变）`);
      return;
    }
    ui.error('用法：preset list | preset apply <name>');
    return;
  }

  if (cmd === 'plugin') {
    if (pos[0] === 'add' && pos[1]) {
      ensureDirs();
      const url = pos[1];
      const fname = (url.split('?')[0].split('/').pop() || 'plugin.js').replace(/[^a-zA-Z0-9_.-]/g, '_');
      const dest = path.join(PLUGIN_DIR, fname.endsWith('.js') ? fname : fname + '.js');
      ui.warn('正在下载插件（第三方插件可能执行任意命令，请只装可信来源）：' + url);
      const res = await fetch(url);
      if (!res.ok) { ui.error('下载失败 ' + res.status); process.exit(1); }
      fs.writeFileSync(dest, await res.text(), 'utf8');
      ui.ok('插件已保存：' + dest + '（重启/下次 run 自动加载）');
      return;
    }
    ui.error('用法：plugin add <url>');
    return;
  }

  if (cmd === 'config') {
    const cfg = loadConfig();
    if (!cfg) { ui.error('尚未初始化，请先运行 init'); return; }
    const show = structuredClone(cfg);
    for (const m of Object.values(show.models || {})) m.api_key = maskKey(m.api_key);
    ui.header('当前配置');
    console.log(JSON.stringify(show, null, 2));
    return;
  }

  if (cmd === 'roles') {
    const cfg = loadConfig();
    if (!cfg) { ui.error('尚未初始化，请先运行 init'); return; }
    ui.header('岗位列表');
    for (const [id, r] of Object.entries(cfg.roles || {})) {
      ui.info(`· ${id} → 模型:${r.model} | 工具:${r.tools.join(',') || '无'} | ${r.name || ''}`);
    }
    return;
  }

  if (cmd === 'models') {
    const cfg = loadConfig();
    if (!cfg) { ui.error('尚未初始化，请先运行 init'); return; }
    ui.header('模型列表');
    for (const [id, m] of Object.entries(cfg.models || {})) {
      ui.info(`· ${id}: ${m.model} @ ${m.base_url} (key:${maskKey(m.api_key)})`);
    }
    return;
  }

  if (cmd === 'run') {
    const task = pos.join(' ').trim();
    if (!task) { ui.error('请带上任务，例如：run "用 Python 写贪吃蛇"'); return; }
    let cfg = loadConfig();
    if (!cfg && !flags.preset) { ui.error('尚未初始化，请先运行 init（或加 --preset）'); return; }
    if (flags.preset) {
      cfg = cfg || buildConfigFromPreset(flags.preset);
      applyPreset(cfg, flags.preset);
    }
    checkKeys(cfg, flags.mock);
    const plugins = await loadPlugins(PLUGIN_DIR);
    const ctx = { cwd: process.cwd() };
    ui.header('OmniAgent 开始执行');
    ui.info('任务：' + task + (flags.mock ? '  [MOCK 模式]' : ''));
    const report = await runPipeline(task, cfg, plugins, ctx, flags.mock, cliTrace());

    // 导出运行报告
    ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const md = renderReport(task, report, flags.mock);
    const rp = path.join(RUNS_DIR, `run-${stamp}.md`);
    fs.writeFileSync(rp, md, 'utf8');
    ui.ok('运行报告已保存：' + rp);
    if (!report.verdict?.passed && !flags.mock) ui.warn('检验未通过，可查看报告中的 gaps 并再次 run。');
    return;
  }

  if (cmd === 'chat') {
    let cfg = loadConfig();
    if (!cfg && !flags.preset) { ui.error('尚未初始化，请先运行 init（或加 --preset）'); return; }
    if (flags.preset) { cfg = cfg || buildConfigFromPreset(flags.preset); applyPreset(cfg, flags.preset); }
    const plugins = await loadPlugins(PLUGIN_DIR);
    await runInteractive(cfg, flags, plugins);
    return;
  }

  if (cmd === 'serve') {
    const port = Number(flags.port) || 3000;
    startServer({ port, cwd: process.cwd() });
    return;
  }

  if (cmd === 'site') {
    const port = Number(flags.port) || 8080;
    startSiteServer({ port });
    return;
  }

  ui.error('未知命令：' + cmd);
  console.log(HELP);
}

main().catch((e) => { ui.error(e); process.exit(1); });
