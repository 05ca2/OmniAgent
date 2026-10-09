#!/usr/bin/env node
// OmniAgent CLI 入口：init / run / chat / config / roles / models / plugin / preset / help
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OMNI_DIR, PLUGIN_DIR, CONFIG_PATH, RUNS_DIR, configExists, loadConfig, saveConfig, ensureDirs } from '../src/config.js';
import { PRESETS, buildConfigFromPreset, listPresets } from '../src/presets.js';
import { loadPlugins } from '../src/plugins/index.js';
import { runPipeline } from '../src/orchestrator.js';
import { chatCompletion } from '../src/llm.js';
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
                               进入双栏终端界面（左对话流 + 右工作树）。
                               默认：单个模型直接对话（无需 skill）。
                               输入 /hoa-loop <任务> 启动多模型协作流水线（规划/执行/检验各自在
                               独立子会话运行，主会话只显示指挥的思考与下达命令；需先装 skill）。
                               实时展示推理进度；模型工作时仍可输入（自动排队）；滚轮/↑↓ 翻看历史；
                               连按两次 esc 中断；命令弹层可直接点击；右下角 ⚙ 设置可添加模型
                               会话命令：/hoa-loop /model /settings /open /agents /models /mock /plugins /reload /status /clear /help /exit
  window                       在独立的终端窗口中打开 OmniAgent 界面
  serve [--port 3000]          启动本地 Web 服务，浏览器打开 http://localhost:3000 使用
  site [--port 8080]           启动官方官网（含插件中心 / 反馈），默认 http://localhost:8080
  config                       查看当前配置（密钥脱敏）
  roles                        列出已配置的岗位
  models                       列出已配置的模型
  plugin add <url>             从 URL 下载一个插件(.js)到 .omni/plugins
  preset list                  列出可用预设
  preset apply <name>          套用某预设的岗位与流水线（保留你的 models）
  help                         显示本帮助

提示：直接运行  omniagent  会在独立窗口打开交互界面；omniagent chat 在当前终端内打开。
会话内 /models 查看模型（供应商/显示名），/models add 可批量添加 OpenAI 兼容模型。

示例：
  node bin/omni.js init
  node bin/omni.js run "用 Python 写一个贪吃蛇游戏并跑通" --mock
  node bin/omni.js run "调研 RAG 的主流方案" --preset research
`;

// ---- 问卷式输入辅助（单一持久 readline；line 事件队列保证管道/粘贴多行也不丢输入）----
let _rl = null;
const _queued = [];
let _askWaiter = null;
function getRl() {
  if (!_rl) {
    _rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    _rl.on('line', (l) => {
      if (_askWaiter) { const r = _askWaiter; _askWaiter = null; r(l); }
      else _queued.push(l);
    });
    _rl.on('close', () => { if (_askWaiter) { const r = _askWaiter; _askWaiter = null; r(''); } });
  }
  return _rl;
}
function closeRl() { if (_rl) { try { _rl.close(); } catch {} _rl = null; } }

// 询问一题；no/total 显示 [n/4] 编号；直接回车 = 使用默认值
function askQ(no, total, q, { def = '' } = {}) {
  return new Promise((res) => {
    const prefix = total ? '[' + no + '/' + total + '] ' : '';
    const suffix = def ? ' (' + def + ')' : '';
    const early = _queued.shift();
    if (early !== undefined) { res(early.trim() || def); return; }
    process.stdout.write(prefix + q + suffix + ': ');
    _askWaiter = (l) => res(l.trim() || def);
    getRl();
  });
}

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
const magenta = (s) => (IS_TTY ? `\x1b[95m${s}\x1b[0m` : String(s)); // 最终输出专用色
const red = (s) => (IS_TTY ? `\x1b[31m${s}\x1b[0m` : String(s)); // 错误提示
// 深色输入条背景（内置 fg 重置不吞背景色）
const barBg = (s) => (IS_TTY ? `\x1b[48;5;236m${s}\x1b[0m` : String(s));
const fgDim = (s) => (IS_TTY ? `\x1b[90m${s}\x1b[39m` : String(s));
const INPUT_PH = 'Ask OmniAgent to do anything';

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
const LOGO_LINES = LOGO_ART.split('\n').filter((l) => l.trim());

function pixelLogo(word) {
  const rows = ['', '', '', '', ''];
  word.split('').forEach((ch, i) => {
    const g = GLYPHS[ch] || GLYPHS.O;
    const paint = i < 4 ? grey : bold; // 前半段灰、后半段亮，仿 opencode 双色调
    for (let r = 0; r < 5; r++) rows[r] += paint(g[r].replace(/#/g, '█').replace(/\./g, ' ')) + ' ';
  });
  return rows.join('\n');
}

// 大字 OMNIAGENT 标识：像素字形用 ▀▄█ 半块压缩成 3 行（OMNI 灰 / AGENT 亮白，仿用户设计图）
function bigLogoLines() {
  const rows = ['', '', ''];
  'OMNIAGENT'.split('').forEach((ch, i) => {
    const g = GLYPHS[ch] || GLYPHS.O;
    const paint = i < 4 ? grey : bold;
    for (let k = 0; k < 3; k++) {
      const top = g[2 * k] || '.....';
      const bot = g[2 * k + 1] || '.....';
      let s = '';
      for (let c = 0; c < 5; c++) {
        const t = top[c] === '#', b = bot[c] === '#';
        s += t && b ? '█' : t ? '▀' : b ? '▄' : ' ';
      }
      rows[k] += paint(s) + ' ';
    }
  });
  return rows.map((r) => r.replace(/\s+$/, ''));
}
const BIG_LOGO = bigLogoLines(); // 宽 9*6-1 = 53 列

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.2.0'; } catch { return '0.2.0'; } })();

// ---------- 会话命令表（输入 / 时弹出补全，仿 opencode） ----------
const COMMANDS = [
  ['/agents',  'Switch agent · 切换岗位'],
  ['/open',    'Open sub-session · 打开子会话详情（规划/执行/检验）'],
  ['/models',  'List models · 模型列表（供应商/显示名）'],
  ['/models add', 'Add models · 批量添加 OpenAI 兼容模型'],
  ['/mock',    'Toggle mock mode · 演示模式（无需密钥）'],
  ['/hoa-loop', 'Multi-model loop · 多模型协作流水线（/hoa-loop <任务>）'],
  ['/settings', 'Settings · 设置（岗位模型/并发/核查轮数/添加模型）'],
  ['/model',   'Select model · 选择/切换模型（界面）'],
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

// 从 base_url 反推供应商显示名（仅在配置里没写 provider 时兜底）
function guessProvider(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('openrouter')) return 'OpenRouter';
  if (u.includes('deepseek')) return 'DeepSeek';
  if (u.includes('api.openai.com')) return 'OpenAI';
  if (u.includes('dashscope') || u.includes('aliyun')) return '通义千问';
  if (u.includes('bigmodel') || u.includes('zhipu')) return '智谱 GLM';
  if (u.includes('moonshot') || u.includes('kimi')) return '月之暗面';
  if (u.includes('anthropic')) return 'Anthropic';
  if (u.includes('siliconflow')) return '硅基流动';
  if (u.includes('localhost') || u.includes('127.0.0.1') || u.includes(':1234') || u.includes(':11434')) return '本地（LM Studio / Ollama）';
  if (u.includes('groq')) return 'Groq';
  if (u.includes('together')) return 'Together';
  return '自定义（OpenAI 兼容）';
}

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
  let streamBuf = ''; // 主会话流式缓冲（director 的输出）
  let think = null; // 实时思考进度：{ startedAt, route, reasonBuf }
  let lastEscAt = 0; // 双击 esc 中断检测
  let busyTick = null; // 忙碌期间的定时重绘（刷新思考秒数/工作树进度）
  let taskStart = 0; // 本轮任务开始时间
  const pendingQueue = []; // 模型工作时用户继续输入的排队消息
  let mw = null; // 添加模型向导状态（null=未激活）
  let clar = null; // 澄清问卷状态 { questions, idx, answers, resolve }
  let view = null; // 当前打开的子会话详情页（子会话 key，null=主会话）
  let viewOffset = 0; // 详情页向上滚动的行数（0=跟随末尾）
  let scrollOffset = 0; // 主会话向上翻看历史记录的行数（0=跟随末尾，滚轮/↑↓ 控制）
  let picker = null; // 选择模型界面 { q, sel }（null=关闭）
  let settings = null; // 设置页 { sel }（null=关闭）
  let curStageKey = null;
  let curRoute = 'main'; // 当前 trace 路由：'main' 或子会话 key
  let curActivity = ''; // 主界面忙碌行显示的当前动作
  let mainReasonBuf = ''; // 主会话推理流缓冲（指挥的思考原文）
  let chatHistory = []; // 单模型对话历史（仅单模型模式累积，多模型协作时清空）
  const subs = new Map(); // 子会话：key -> { key, idx, title, sub, lines, sbuf, reasonBuf, status, stage }
  const clickZones = []; // 每次渲染重建的鼠标点击热区 {x1,y1,x2,y2,act}
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
  const replies = []; // 保留：最终结果同步写入（兼容导出）
  // 工作树状态：跟踪流水线阶段（director → planner → workers → verifier）
  let stageCurKey = null;
  const stagesDone = new Set();
  function markStage(n) {
    const s = String(n);
    const key = s.includes('指挥') ? 'director' : s.includes('规划') ? 'planner' : s.includes('执行') ? 'workers' : (s.includes('检') || s.includes('验')) ? 'verifier' : null;
    if (key) { stageCurKey = key; curStageKey = key; stagesDone.add(key); }
  }
  function pushReply(t) { replies.push(t); }

  // ---------- 子会话：规划/执行/检验各自独立窗口，主会话只留指挥的过程 ----------
  const STAGE_TITLES = { planner: '规划 · Planner', verifier: '检验 · Verifier' };
  function ensureSub(key, title, sub, stage) {
    if (!subs.has(key)) {
      subs.set(key, { key, idx: subs.size + 1, title, sub: sub || '', lines: [], sbuf: '', reasonBuf: '', status: 'run', stage: stage || curStageKey || '' });
      const s = subs.get(key);
      push(grey('  ↳ 开启子会话 ') + cyan(`[${s.idx}] ${title}`) + grey('（点右栏或 /open ' + s.idx + ' 查看详情）'));
    }
    return subs.get(key);
  }
  function flushSub(s) {
    if (!s.sbuf) return;
    vwrap(s.sbuf.trimEnd(), 200).forEach((l) => s.lines.push('  ' + l));
    s.sbuf = '';
  }
  function flushStreamMain() {
    if (!streamBuf) return;
    vwrap(streamBuf.trimEnd(), 200).forEach((l) => { push('  ' + l); pushReply('  ' + l); });
    streamBuf = '';
  }
  function flushAll() { flushStreamMain(); for (const s of subs.values()) flushSub(s); }
  // 结束一段思考：把耗时以 "✽ Thought: 9.0s" 落进对应会话
  function endThink() {
    if (!think) return;
    const secs = ((Date.now() - think.startedAt) / 1000).toFixed(1);
    const l = dim(`  ✽ Thought: ${secs}s`);
    const target = think.route && think.route !== 'main' ? subs.get(think.route) : null;
    if (target) { flushSub(target); target.lines.push(l); } else { flushStreamMain(); push(l); }
    think = null;
  }
  // 事件路由：director → 主会话；planner/verifier → 各自子会话；workers → 按岗位子会话
  function routeOf(roleId) {
    if (curStageKey === 'director') return 'main';
    if (curStageKey === 'planner') return subs.has('planner') ? 'planner' : 'main';
    if (curStageKey === 'verifier') return subs.has('verifier') ? 'verifier' : 'main';
    if (curStageKey === 'workers') {
      if (roleId && subs.has('w:' + roleId)) return 'w:' + roleId;
      return subs.has(curRoute) ? curRoute : 'main';
    }
    return subs.has(curRoute) ? curRoute : 'main';
  }
  function lineTo(route, t) {
    if (route === 'main') { push(t); return; }
    const s = subs.get(route);
    if (s) { flushSub(s); s.lines.push(t); } else push(t);
  }
  const roleIdOf = (role) => (typeof role === 'string' ? role : (role?.id || role?.name || ''));

  // 流水线 trace：主会话只放指挥的思考与命令，其余全部进子会话
  const tuiTrace = () => ({
    stage: (n, s) => {
      if (interrupted) throw new Error('__INTERRUPT__');
      flushAll(); endThink();
      const prev = curStageKey;
      markStage(n);
      // 上一阶段的子会话标记完成
      for (const x of subs.values()) if (x.status === 'run' && x.stage && x.stage !== curStageKey) x.status = 'done';
      if (!curStageKey || curStageKey === 'director') {
        curRoute = 'main';
        push('\n' + bold(cyan('◆ ' + n)) + (s ? grey('  ' + s) : '') + '\n');
      } else {
        let sub2 = null;
        if (curStageKey !== 'workers') sub2 = ensureSub(curStageKey, STAGE_TITLES[curStageKey] || n, s || '', curStageKey);
        curRoute = curStageKey === 'workers' ? 'main' : curStageKey;
        push('\n' + bold(cyan('◆ ' + n)) + (s ? grey('  ' + s) : '') + (sub2 ? grey(`  → 子会话 [${sub2.idx}]`) : ''));
      }
      curActivity = String(n);
      scheduleRender();
    },
    step: (role, ins) => {
      if (interrupted) throw new Error('__INTERRUPT__');
      flushAll(); endThink();
      const s0 = String(ins).replace(/\s+/g, ' ').trim();
      const s = s0.length > 60 ? s0.slice(0, 60) + '…' : s0;
      if (curStageKey === 'workers') {
        const key = 'w:' + role;
        const sub = ensureSub(key, '执行 · ' + role, s, 'workers');
        curRoute = key;
        push(grey('  ⇒ 命令 [') + bold(role) + grey('] ') + bold(s)); // 主会话：指挥下达的命令
        sub.lines.push(grey('── 任务：') + bold(s));
      } else {
        lineTo(routeOf(roleIdOf(role)), grey('└─ ') + bold(role) + grey(' · ' + s));
      }
      curActivity = role + ' · ' + s;
      scheduleRender();
    },
    think: (role, note) => {
      if (interrupted) throw new Error('__INTERRUPT__');
      flushAll(); endThink();
      const r = routeOf(roleIdOf(role));
      think = { startedAt: Date.now(), route: r, reasonBuf: '' };
      curActivity = (r === 'main' ? '' : (subs.get(r)?.title + ' · ') || '') + String(note || '思考中');
      scheduleRender();
    },
    // 推理流（reasoning_content）：进入对应会话实时展示
    reason: (t, roleId) => {
      if (interrupted) throw new Error('__INTERRUPT__');
      const r = routeOf(roleId);
      if (r === 'main') { if (think && think.route === 'main') think.reasonBuf += t; mainReasonBuf = (mainReasonBuf + t).slice(-4000); }
      else { const s = subs.get(r); if (s) s.reasonBuf = (s.reasonBuf + t).slice(-4000); }
      scheduleRender();
    },
    token: (t, roleId) => {
      if (interrupted) throw new Error('__INTERRUPT__');
      endThink();
      const r = routeOf(roleId);
      if (r === 'main') streamBuf += t;
      else { const s = subs.get(r); if (s) s.sbuf += t; }
      tokens += Math.max(1, Math.round(t.length / 3));
      scheduleRender();
    },
    end: () => flushAll(),
    tool: (name, args, o, roleId) => {
      flushAll(); endThink();
      const r = routeOf(roleId);
      lineTo(r, grey('  ⚙ ') + cyan(name) + grey('(' + JSON.stringify(args || {}).slice(0, 60) + ')'));
      if (o) vwrap('    ↳ ' + String(o).slice(0, 160), 200).forEach((l) => lineTo(r, grey(l)));
      scheduleRender();
    },
    result: (label, text) => {
      flushAll(); endThink();
      push('\n' + yellow('◆ ' + label) + '  ' + String(text).slice(0, 200) + '\n');
      pushReply(yellow('◆ ' + label) + '  ' + String(text).slice(0, 200));
      scheduleRender();
    },
    gaps: (items) => { flushAll(); endThink(); (items || []).forEach((g) => push(yellow('✗ ' + g))); },
    info: (m) => {
      if (interrupted) throw new Error('__INTERRUPT__');
      flushAll(); endThink();
      const s0 = String(m).replace(/\s+/g, ' ').trim();
      lineTo(routeOf(), grey(s0.length > 70 ? s0.slice(0, 70) + '…' : s0));
      scheduleRender();
    },
    done: () => { flushAll(); for (const x of subs.values()) if (x.status === 'run') x.status = 'done'; },
    // 澄清问卷：指挥发现关键不确定点时，逐题询问用户
    clarify: (questions) => runClarify(questions),
  });

  // ---------- 澄清问卷：逐题问答（esc 跳过剩余） ----------
  function runClarify(questions) {
    return new Promise((resolve) => {
      clar = { questions: (questions || []).map(String), idx: 0, answers: [], resolve };
      push('\n' + bold(yellow(`◆ 需要澄清 · ${clar.questions.length} 个问题`)) + grey('（逐题回答 · esc 跳过剩余）'));
      pushClarQ();
      render();
    });
  }
  function pushClarQ() {
    push(yellow(`[澄清 ${clar.idx + 1}/${clar.questions.length}] `) + bold(clar.questions[clar.idx]));
  }
  function handleClar(raw) {
    const a = raw.trim() || '（未回答）';
    clar.answers.push(a);
    push(grey('  → ' + a));
    clar.idx++;
    if (clar.idx < clar.questions.length) { pushClarQ(); render(); return; }
    const c = clar; clar = null;
    push(green('✓ 澄清完成，指挥继续拆解…') + '\n');
    c.resolve(c.answers);
  }
  function skipClar() {
    const c = clar; clar = null;
    while (c.answers.length < c.questions.length) c.answers.push('（未回答）');
    push(yellow('⏭ 已跳过剩余问题'));
    c.resolve(c.answers);
  }

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

  // 右栏：工作树 —— 流水线进度 + 子会话列表（可点击打开详情页）+ 右下角设置入口
  function workTreeLines(H, RW, MW) {
    const w = Math.max(12, RW - 1);
    const cut = (s) => cutPlain(s, w);
    const names = { director: '指挥 Director', planner: '规划 Planner', workers: '执行 Workers', verifier: '检验 Verifier' };
    const desc = { director: '拆解任务、分派岗位', planner: '制定顺序执行计划', workers: '多岗位并发协作执行', verifier: '核查结果并驱动修复' };
    const stageKeys = cfg.pipeline?.stages || ['director', 'planner', 'workers', 'verifier'];
    const curIdx = stageCurKey ? stageKeys.indexOf(stageCurKey) : -1;
    const L = [];
    L.push(cut(bold('▾ 工作树 · 多模型协作')));
    L.push('');
    stageKeys.forEach((k, i) => {
      const role = cfg.roles?.[k];
      const mid = role?.model;
      const mm = mid ? cfg.models?.[mid] : null;
      const modelId = mm ? mm.model : mid || '—';
      let icon, col;
      if (busy && i === curIdx) { icon = '●'; col = yellow; }
      else if (stagesDone.has(k) && (i < curIdx || !busy)) { icon = '✓'; col = green; }
      else { icon = '○'; col = grey; }
      const branch = i === 0 ? '    ' : i === stageKeys.length - 1 ? '└─▶ ' : '├─▶ ';
      L.push(cut(grey('  ' + branch)) + col(icon + ' ' + names[k]) + grey('  ' + modelId));
      L.push(cut(grey(i === stageKeys.length - 1 ? '        ' : '  │     ') + col(desc[k])));
    });
    L.push('');
    const nRoles = Object.keys(cfg.roles || {}).length;
    const nModels = new Set(Object.values(cfg.roles || {}).map((r) => r.model)).size;
    if (busy) L.push(cut(yellow('  ● 进行中 · ') + grey('阶段 ' + Math.max(1, curIdx + 1) + '/' + stageKeys.length)));
    else if (stageCurKey) L.push(cut(green('  ✓ 流程完成') + grey(' · ' + nModels + ' 个模型协作')));
    else L.push(cut(grey('  待命 · 输入任务后按此流程协作')));
    L.push(cut(grey('  ' + nRoles + ' 个岗位 · ' + nModels + ' 个模型 · ' + tokens + ' tokens')));
    // 子会话列表：点击或 /open <n> 打开独立详情页
    if (subs.size) {
      L.push('');
      L.push(cut(bold('▾ 子会话') + grey('（点击查看）')));
      for (const s of subs.values()) {
        if (L.length >= H - 2) break;
        const icon = s.status === 'run' ? yellow('●') : green('✓');
        const y = L.length + 1; // 当前行在屏幕上的 1-based 行号
        clickZones.push({ x1: MW + 4, y1: y, y2: y, x2: 9999, act: { t: 'sub', key: s.key } });
        L.push(cut(grey(`  [${s.idx}] `) + icon + ' ' + cyan(s.title) + grey(` · ${s.lines.length} 行`)));
      }
    }
    while (L.length < H) L.push('');
    // 右下角设置入口：点击打开「添加模型」向导
    const setLabel = '⚙ 设置·添加模型';
    const setPad = Math.max(0, w - vlen(setLabel));
    clickZones.push({ x1: MW + 4 + setPad, y1: H, y2: H, x2: 9999, act: { t: 'settings' } });
    L[H - 1] = cut(' '.repeat(setPad) + cyan(setLabel));
    return L.slice(0, H);
  }

  // 主区左上角品牌标识（单行）：OmniAgent 名称 + 版本 + 模式
  function brandLine(MW) {
    const tag = mock ? yellow('  [演示模式]') : '';
    const s = bold('>⌒ OmniAgent') + grey(' v' + VERSION) + grey(' · 多模型协作') + tag;
    return cutPlain(s, MW);
  }

  // Codex 极简欢迎屏：左上标题 + 居中暗色标志 + 底部输入行 + 状态行
  function welcomeLines(W, H) {
    const magenta = (s) => (IS_TTY ? '\x1b[35m' + s + '\x1b[0m' : String(s));
    const head = [
      bold('>⌒ OmniAgent') + grey(' (v' + VERSION + ')'),
      grey('  ' + process.cwd()),
      grey('  permissions: ') + magenta('YOLO mode'),
    ];
    const role = currentRole();
    const r0 = role ? cfg.roles[role] : null;
    const m0 = r0 ? cfg.models[r0.model] : null;
    const modelId = chatModel ? (cfg.models[chatModel]?.model || chatModel) : (m0 ? m0.model : '未配置 · 先运行 omniagent init');
    const typed = line ? cutPlain(line, Math.max(10, W - 8)) : '';
    const padN = Math.max(0, (W - 2) - 4 - vlen(typed) - (typed ? 0 : INPUT_PH.length));
    const bottom = [
      barBg(' ❯ ' + (typed || fgDim(INPUT_PH)) + ' '.repeat(padN)),
      (mock ? yellow('mock') : cyan(modelId)) + grey(' · ' + process.cwd()),
      grey('tab for agents · ? for shortcuts'),
    ];
    const m = [];
    m.push(...head);
    const mid = H - head.length - bottom.length - 1;
    const padTop = Math.max(1, Math.floor((mid - LOGO_LINES.length) / 2));
    for (let i = 0; i < padTop; i++) m.push('');
    for (const l of LOGO_LINES) {
      const p = Math.max(0, Math.floor((W - vlen(l)) / 2));
      m.push(' '.repeat(p) + dim(l));
    }
    while (m.length < H - bottom.length - 1) m.push('');
    m.push('');
    m.push(...bottom);
    return m.slice(0, H);
  }

  function render() {
    clickZones.length = 0; // 每帧重建鼠标热区
    const W = process.stdout.columns || 100;
    const H = Math.max(12, (process.stdout.rows || 30) - 1);
    const MW = Math.max(40, Math.floor(W * 0.68));
    const RW = Math.max(10, W - MW - 3);

    let main, right;
    if (!started) {
      main = welcomeLines(W, H);
      right = [];
    } else {
    // ---- 主区 ----
    const brand = brandLine(MW);
    const pop = popupEntries();
    let popRows = [];
    let popShow = [];
    if (pop) {
      const maxShow = Math.min(pop.length, Math.max(3, H - 10));
      const start = Math.max(0, Math.min(popupSel - maxShow + 1, pop.length - maxShow));
      const show = pop.slice(start, start + maxShow);
      popShow = show;
      popRows.push('');
      show.forEach(([c, d], i) => {
        const sel = start + i === popupSel;
        const name = c.padEnd(11);
        const row = ' ' + name + d;
        popRows.push(sel ? '\x1b[48;5;208m\x1b[38;5;16m' + cutPlain(row, MW - 1) + '\x1b[0m' : grey(cutPlain(row, MW - 1)));
      });
    }

    const typedC = line ? cutPlain(line, Math.max(8, MW - 8)) : '';
    const padC = Math.max(0, MW - 4 - vlen(typedC) - (typedC ? 0 : INPUT_PH.length));
    const inputRow = barBg(' ❯ ' + (typedC || fgDim(INPUT_PH)) + ' '.repeat(padC));
    const role = currentRole();
    const r = role ? cfg.roles[role] : null;
    const m = r ? cfg.models[r.model] : null;
    const agRow = (chatModel
        ? cyan(cfg.models[chatModel]?.model || chatModel)
        : role
        ? cyan(m ? m.model : role)
        : yellow('未配置模型 · 先运行 omniagent init')) + grey(' · ' + process.cwd()) + (mock ? yellow(' · mock') : '');
    // 忙碌时的实时进度行（转轮 + 当前动作 + 主会话推理原文）
    const busyRows = [];
    if (busy) {
      const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      const spin = SPIN[Math.floor(Date.now() / 120) % SPIN.length];
      const secs = ((Date.now() - (taskStart || Date.now())) / 1000).toFixed(0);
      const act = curActivity ? grey(' · ' + (curActivity.length > 34 ? curActivity.slice(0, 34) + '…' : curActivity)) : '';
      busyRows.push(cutPlain(yellow(`${spin} 工作中 ${secs}s`) + act + grey('   esc×2 中断'), MW));
      if (clar) busyRows.push(cutPlain(yellow(`  ✽ 回答澄清问题 ${clar.idx + 1}/${clar.questions.length}（在下方输入）`), MW));
      else if (think && think.route === 'main' && think.reasonBuf) {
        const last = think.reasonBuf.replace(/\s+/g, ' ').trim().slice(-Math.max(20, MW - 8));
        busyRows.push(cutPlain(dim('  └ ' + last), MW));
      }
    }
    const hintL = busy ? (pendingQueue.length ? grey(`✉ 已排队 ${pendingQueue.length} 条 · `) : '') + grey('esc×2 中断') : '';
    const hintR = 'tab for agents · ? for shortcuts';
    const hintPad = Math.max(1, MW - vlen(hintL) - vlen(hintR) - 2);
    const hintRow = hintL + ' '.repeat(hintPad) + hintR;

    // 左上角大字标识：OMNIAGENT 像素字（3 行，OMNI 灰 / AGENT 亮白）；窄终端退化为单行
    const logoRows = MW >= 54 ? BIG_LOGO : [brandLine(MW)];
    const logoN = logoRows.length + 1; // +1 空行

    // 把全部会话记录折叠成显示行，再按 scrollOffset 取尾部窗口（滚轮/↑↓ 翻历史）
    const allLines = [];
    for (const t of transcript) {
      if (t === '\n') { allLines.push(''); continue; }
      for (const l of vwrap(t.replace(/\n/g, ''), MW)) allLines.push(l);
    }
    if (streamBuf) allLines.push(...vwrap('  ' + streamBuf.replace(/\n/g, ' ').slice(-400), MW));

    const foot = [...busyRows, ...popRows, inputRow, agRow, hintRow];
    const headroom = Math.max(2, H - logoN - foot.length); // 正文可用行数
    scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, allLines.length - 1)));
    const end = allLines.length - scrollOffset;
    const start = Math.max(0, end - headroom);
    const body = allLines.slice(start, end);
    // 硬钳制正文行数：即使 emoji/宽度误判导致折行误差，也不会把左上角标识顶出屏幕
    while (body.length < headroom) body.push('');
    body.length = headroom;
    main = [...logoRows, '']; // 标识永远固定在左上角，不随会话滚动
    if (start > 0) main.push(grey(`…（↑ 还有 ${start} 行历史 · 滚轮/↑↓ 翻看）`));
    const tail = start > 0 ? headroom - 1 : headroom;
    const vis = body.slice(-tail);
    while (vis.length < tail) vis.push('');
    main.push(...vis);
    main.push(...foot);
    if (main.length > H) main.length = H; // 双保险：绝不超屏（防止整屏上滚顶掉标识）
    // 命令弹层点击热区：点击即直接执行该命令（主屏行号 = main 下标 + 1）
    if (popShow.length) {
      const popBase = H - 3 - popRows.length; // popRows 第一行（空行）所在 1-based 行
      popShow.forEach(([c], i) => {
        clickZones.push({ x1: 1, y1: popBase + i + 2, y2: popBase + i + 2, x2: MW, act: { t: 'cmd', cmd: c } });
      });
    }

    // ---- 右栏：工作树（多模型协作流水线实时进度 + 子会话列表 + 设置入口）----
    right = workTreeLines(H, RW, MW);
    }

    // ---- 子会话详情页：独立窗口，所有思考/工作过程都在这里 ----
    if (view) {
      clickZones.length = 0; // 覆盖层：丢弃主区热区，重建本页热区
      const s = subs.get(view);
      if (!s) { view = null; }
      else {
        const head = bold(cyan('← OmniAgent')) + grey(' · 子会话 ') + cyan(`[${s.idx}] ${s.title}`)
          + (s.status === 'run' ? yellow('  ● 运行中') : green('  ✓ 已完成'))
          + (s.sub ? grey('  ' + (s.sub.length > 30 ? s.sub.slice(0, 30) + '…' : s.sub)) : '');
        const body = [];
        for (const l of s.lines) for (const w2 of vwrap(l.replace(/\n/g, ''), W - 2)) body.push(w2);
        if (s.sbuf) for (const w2 of vwrap('  ' + s.sbuf.replace(/\n/g, ' ').slice(-600), W - 2)) body.push(w2);
        if (s.reasonBuf) body.push(dim('  ✽ … ' + s.reasonBuf.replace(/\s+/g, ' ').trim().slice(-140)));
        const showN = Math.max(1, H - 3);
        viewOffset = Math.max(0, Math.min(viewOffset, Math.max(0, body.length - showN)));
        const end = body.length - viewOffset;
        const start = Math.max(0, end - showN);
        const rows2 = [head, grey('─'.repeat(Math.max(10, W - 2)))];
        if (start > 0) rows2.push(grey(`…（上方还有 ${start} 行 · ↑ 滚动查看）`));
        rows2.push(...body.slice(start, end));
        rows2.length = H - 1;
        while (rows2.length < H - 1) rows2.push('');
        const backLabel = ' ← 返回主会话 (esc) ';
        rows2.push(grey('─'.repeat(Math.max(0, W - 6 - backLabel.length))) + cyan(backLabel));
        clickZones.push({ x1: W - backLabel.length, y1: H, y2: H, x2: 9999, act: { t: 'back' } });
        out('\x1b[H\x1b[2J' + rows2.join('\n') + '\x1b[?25l'); // 详情页无输入框，隐藏光标
        return;
      }
    }

    // ---- 选择模型界面：居中弹窗，搜索 + 按供应商分组 ----
    if (picker) {
      clickZones.length = 0;
      const rows = pickerRows();
      picker.sel = Math.max(0, Math.min(picker.sel, rows.length - 1));
      const BW = Math.min(58, Math.max(40, W - 8));
      const modelIdxs = rows.map((r, i) => (r.kind === 'model' ? i : -1)).filter((i) => i >= 0);
      const lines = [];
      const title = ' Select model ';
      lines.push(cyan('┌' + title + '─'.repeat(Math.max(2, BW - title.length - 2)) + '┐') + grey('  esc 关闭'));
      const q = ' │ Search: ' + (picker.q || fgDim('输入即搜索…'));
      lines.push(cutPlain(q + ' '.repeat(Math.max(1, BW + 2 - vlen(q))), BW + 4) + cyan(' │'));
      lines.push(cyan(' │' + '─'.repeat(BW) + '│'));
      if (!rows.length) lines.push(cutPlain(cyan(' │ ') + grey('没有匹配的模型'), BW + 4) + cyan(' │'));
      rows.forEach((r, i) => {
        const sel = i === picker.sel;
        let inner;
        if (r.kind === 'provider') inner = magenta(' │ ' + r.name);
        else {
          const cur = r.id === chatModel ? green('● ') : '  ';
          const name = cur + (sel ? bold(r.label) : r.label);
          const right = grey(r.m.model.length > 18 ? r.m.model.slice(0, 18) : r.m.model);
          const pad = Math.max(1, BW - 2 - vlen(name) - vlen(right));
          inner = cyan(' │ ') + name + ' '.repeat(pad) + right;
        }
        const rowStr = sel
          ? '\x1b[48;5;208m\x1b[38;5;16m' + cutPlain(inner + ' ', BW + 4) + '\x1b[0m'
          : cutPlain(inner, BW + 4) + (r.kind === 'provider' ? '' : cyan(' │'));
        lines.push(rowStr);
        if (r.kind === 'model') {
          const y = lines.length + 1; // 该行在屏幕上的 1-based 行号
          clickZones.push({ x1: 2, y1: y, y2: y, x2: W - 12, act: { t: 'pick', id: r.id } });
        }
      });
      lines.push(cyan(' └' + '─'.repeat(BW) + '┘'));
      lines.push(grey('   ↵ 选择 · ↑↓ 移动 · 输入即搜索 · 点击可选 · esc 关闭'));
      const padTop = Math.max(0, Math.floor((H - lines.length) / 3));
      const page = [];
      for (let i = 0; i < padTop; i++) page.push('');
      page.push(...lines);
      page.length = H;
      while (page.length < H) page.push('');
      out('\x1b[?25h\x1b[H\x1b[2J' + page.join('\n') + '\x1b[?25l');
      return;
    }

    // ---- 设置页：岗位模型映射 + hoa-loop 个性化 + 添加模型 ----
    if (settings) {
      clickZones.length = 0;
      const items = settingsItems();
      settings.sel = Math.max(0, Math.min(settings.sel, items.length - 1));
      const lines = [];
      lines.push(bold(cyan('← OmniAgent')) + grey(' · 设置') + grey('（修改即保存到 .omni/config.json）'));
      lines.push(grey('─'.repeat(Math.max(10, W - 2))));
      items.forEach((it, i) => {
        const sel = i === settings.sel;
        let text;
        if (it.t === 'addModel') text = cyan(it.label);
        else if (it.t === 'role') {
          const m = cfg.models[it.model];
          const disp = m ? (m.display || m.model) : (it.model || '—');
          const nm = '  ' + it.role;
          const val = cyan('◀ ' + disp + ' ▶');
          const pad = Math.max(1, W - 6 - vlen(nm) - vlen(val) - 8);
          text = nm + ' '.repeat(pad) + grey('模型: ') + val;
        } else if (it.t === 'num') {
          const val = cyan('◀ ' + (cfg.pipeline?.[it.key] ?? 1) + ' ▶');
          const pad = Math.max(1, W - 6 - vlen(it.label) - vlen(val));
          text = '  ' + it.label + ' '.repeat(pad) + val;
        } else text = grey('  ' + it.label);
        const rowStr = sel ? '\x1b[48;5;236m' + cutPlain(text + ' ', W - 2) + '\x1b[0m' : cutPlain(text, W - 2);
        lines.push(rowStr);
        const y = lines.length + 1;
        if (it.t !== 'info') clickZones.push({ x1: 1, y1: y, y2: y, x2: W, act: { t: 'set', i } });
      });
      while (lines.length < H - 2) lines.push('');
      lines.length = H - 2;
      lines.push(grey('─'.repeat(Math.max(0, W - 4))));
      lines.push(grey('  ↑↓ 选择 · ↵/◀▶ 或点击 修改 · esc 返回'));
      out('\x1b[?25h\x1b[H\x1b[2J' + lines.join('\n') + '\x1b[?25l');
      return;
    }

    // 欢迎屏：全屏单栏直接输出；光标定位到输入行内（第 H-2 行，「 ❯ 」后）
    if (!started) {
      const typedW = line ? cutPlain(line, Math.max(10, W - 8)) : '';
      out('\x1b[?25h\x1b[H\x1b[2J' + main.join('\n') + '\n' + `\x1b[${H - 2};${4 + vlen(typedW)}H`);
      return;
    }

    // ---- 对话布局：左栏对话 + 右栏回复，标志作整屏水印背景 ----
    const bg = Array(H).fill('');
    {
      const top = Math.max(0, Math.floor((H - LOGO_LINES.length) / 2));
      LOGO_LINES.forEach((l, k) => {
        const w = vlen(l);
        const p = Math.max(0, Math.floor((W - w) / 2));
        bg[top + k] = ' '.repeat(p) + l;
      });
    }
    const rows = [];
    for (let i = 0; i < H; i++) {
      const l = main[i] || '';
      const r = right[i] || '';
      const bl = l ? '' : bg[i].slice(0, MW).padEnd(MW);
      const br = r ? '' : bg[i].slice(MW + 3).padEnd(RW);
      rows.push((l ? vpad(l, MW) : grey(bl)) + cyan(' ┃ ') + (r ? vpad(r, RW) : grey(br)));
    }
    // 光标定位回输入行内（main 倒数第 3 行 = inputRow，「 ❯ 」后）
    const typedO = line ? cutPlain(line, Math.max(8, MW - 8)) : '';
    out('\x1b[?25h\x1b[H\x1b[2J' + rows.join('\n') + '\n' + `\x1b[${Math.max(1, main.length - 2)};${4 + vlen(typedO)}H`);
  }

  // ---------- 选择模型界面：搜索 + 按供应商分组，↵ 选择 ----------
  function openPicker() {
    if (!Object.keys(cfg.models || {}).length) { push(yellow('还没有模型——先 /models add 添加')); render(); return; }
    picker = { q: '', sel: 0 };
    render();
  }
  function pickerRows() { // 展示行：{kind:'provider'|'model', ...}
    const q = (picker.q || '').toLowerCase();
    const flat = Object.entries(cfg.models || {}).filter(([id, m]) =>
      !q || (id + ' ' + (m.display || '') + ' ' + (m.provider || guessProvider(m.base_url)) + ' ' + m.model).toLowerCase().includes(q));
    const rows = [];
    let prov = null;
    for (const [id, m] of flat) {
      const p = m.provider || guessProvider(m.base_url);
      if (p !== prov) { prov = p; rows.push({ kind: 'provider', name: p }); }
      rows.push({ kind: 'model', id, m, label: m.display || m.model });
    }
    return rows;
  }
  function pickerMove(dir) {
    const rows = pickerRows();
    const modelIdx = rows.map((r, i) => (r.kind === 'model' ? i : -1)).filter((i) => i >= 0);
    if (!modelIdx.length) return;
    let pos = modelIdx.indexOf(picker.sel);
    pos = pos < 0 ? 0 : (pos + dir + modelIdx.length) % modelIdx.length;
    picker.sel = modelIdx[pos];
    render();
  }
  function pickerConfirm(id) {
    chatModel = id;
    picker = null;
    push(green('✓ 当前对话模型：') + cyan(cfg.models[id]?.display || id) + grey('（/model 可再切换 · /hoa-loop <任务> 多模型协作）'));
    render();
  }

  // ---------- 设置页：岗位模型映射 + hoa-loop 个性化 + 添加模型 ----------
  function openSettings() { settings = { sel: 0 }; render(); }
  function settingsItems() {
    const items = [{ t: 'addModel', label: '＋ 添加模型（OpenAI 兼容向导）' }];
    for (const [rid, rr] of Object.entries(cfg.roles || {})) items.push({ t: 'role', role: rid, model: rr.model });
    items.push({ t: 'num', key: 'max_workers', label: 'hoa-loop 并发数（workers 同时执行）', min: 1, max: 8 });
    items.push({ t: 'num', key: 'verify_rounds', label: 'hoa-loop 核查轮数（verifier 修复回路）', min: 1, max: 5 });
    items.push({ t: 'info', label: '提示：/hoa-loop <任务> 才会启动多模型协作；普通输入=单模型直接对话' });
    return items;
  }
  function adjustSetting(item, dir) {
    if (item.t === 'addModel') { settings = null; startModelWizard(); render(); return; }
    if (item.t === 'role') {
      const ids = Object.keys(cfg.models || {});
      if (!ids.length || !cfg.roles[item.role]) return;
      const cur = Math.max(0, ids.indexOf(item.model));
      cfg.roles[item.role].model = ids[(cur + (dir || 1) + ids.length) % ids.length];
    } else if (item.t === 'num') {
      cfg.pipeline = cfg.pipeline || {};
      const cur = cfg.pipeline[item.key] || item.min;
      cfg.pipeline[item.key] = Math.min(item.max, Math.max(item.min, cur + (dir || 1)));
    } else return;
    saveConfig(cfg); // 修改即保存
    render();
  }

  // ---------- /models add 向导：批量添加 OpenAI 兼容模型（逐项问答，esc 取消） ----------
  const MW_STEPS = [
    ['provider', '供应商显示名称', '界面上展示的供应商名，如 OpenRouter / DeepSeek / LM Studio', ''],
    ['base_url', '接口地址 URL（OpenAI 兼容）', '以 http(s):// 开头，如 https://openrouter.ai/api/v1', 'https://api.openai.com/v1'],
    ['api_key',  'API Key', '仅保存在本机 .omni/config.json；本地服务（如 LM Studio）可填 local', ''],
    ['model',    '模型 ID', '供应商的 model 标识，如 deepseek/deepseek-chat 或 gpt-4o-mini', ''],
    ['display',  '模型显示名称', '界面上展示的名字，如 DeepSeek V3（回车 = 同模型 ID）', ''],
  ];
  function pushWizardQ() {
    const [, q, hint, def] = MW_STEPS[mw.step];
    push(yellow(`[添加模型 · ${mw.step + 1}/5] `) + bold(q) + grey(' — ' + hint) + (def ? grey(`（回车 = ${def}）`) : ''));
  }
  function startModelWizard() {
    mw = { step: 0, entries: [], cur: {}, confirming: false };
    push(bold('—— 添加模型（仅支持 OpenAI 兼容接口，可连续添加多个）——') + grey('  esc 取消'));
    pushWizardQ();
  }
  function saveModelEntries() {
    for (const e of mw.entries) {
      let id = (e.model || 'model').replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/^-+/, '') || 'model';
      const base = id; let n = 2;
      while (cfg.models[id]) id = base + '-' + n++;
      cfg.models[id] = { base_url: e.base_url, api_key: e.api_key, model: e.model, provider: e.provider, display: e.display || e.model };
      push(green('  ✓ 已保存 ') + cyan(e.display || id) + grey(`  → 键名 ${id} · ${e.provider} · ${e.model}`));
    }
    saveConfig(cfg);
    push(green(`共添加 ${mw.entries.length} 个模型，已写入 .omni/config.json`) + grey('。/models 查看；/model <键名> 可临时统一模型。'));
    mw = null;
  }
  function handleModelWizard(raw) {
    if (mw.confirming) {
      const v = raw.trim().toLowerCase();
      if (!v || v === 'n' || v === 'no') { saveModelEntries(); return; }
      if (v === 'y' || v === 'yes') { mw.confirming = false; mw.step = 0; mw.cur = {}; pushWizardQ(); return; }
      push(grey('（y 继续添加 / 回车保存并结束）')); return;
    }
    const [field, , , def] = MW_STEPS[mw.step];
    const v = raw.trim() || def;
    if (mw.step === 0 && !v) { push(yellow('供应商名称不能为空')); pushWizardQ(); return; }
    if (mw.step === 1 && !/^https?:\/\//i.test(v)) { push(yellow('URL 需以 http(s):// 开头（只接受 OpenAI 兼容接口）')); pushWizardQ(); return; }
    if (mw.step === 2 && !v) { push(yellow('API Key 不能为空（本地服务可填 local）')); pushWizardQ(); return; }
    if (mw.step === 3 && !v) { push(yellow('模型 ID 不能为空')); pushWizardQ(); return; }
    mw.cur[field] = v;
    push(grey('  → ' + (field === 'api_key' ? maskKey(v) : v)));
    if (mw.step < 4) { mw.step++; pushWizardQ(); return; }
    mw.entries.push(mw.cur);
    push(green(`  ✓ 已暂存「${mw.cur.display || mw.cur.model}」（本次共 ${mw.entries.length} 个）`));
    mw.confirming = true;
    push(bold('继续添加下一个模型？') + grey('（y = 继续 / 回车 = 保存并结束）'));
  }

  // 提炼最终输出：核查结论 + 最后一个岗位的交付文本（压缩空白、截断，保持简洁）
  function finalAnswerText(report) {
    const v = report?.verdict;
    const last = (report?.results || []).slice(-1)[0];
    const parts = [];
    if (v) parts.push(`核查：${v.passed ? '✅ 通过' : '⚠️ 未通过'}${v.score != null ? ' · 评分 ' + v.score : ''}${v.verdict ? ' · ' + v.verdict : ''}`);
    const txt = String(last?.result || '').trim();
    if (txt) parts.push(txt);
    const s = parts.join('\n\n').replace(/\n{3,}/g, '\n\n');
    if (!s) return '（无输出）';
    return s.length > 900 ? s.slice(0, 900) + ' …（完整内容见运行报告）' : s;
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
    } else if (t === '/clear') { transcript.length = 0; replies.length = 0; chatHistory.length = 0; scrollOffset = 0; }
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
    } else if (t === '/models' || t === '/models add') {
      if (t === '/models add') {
        if (mw) push(yellow('添加模型向导已在进行中，请继续回答（esc 取消）'));
        else startModelWizard();
        return true;
      }
      const list = Object.entries(cfg.models || {});
      if (!list.length) { push(yellow('尚未配置任何模型。') + grey('输入 /models add 批量添加 OpenAI 兼容模型')); return true; }
      push(bold(`已配置模型 ${list.length} 个`) + grey('（/models add 添加 · /model <键名> 统一切换）'));
      for (const [id, m] of list) {
        const prov = m.provider || guessProvider(m.base_url);
        const disp = m.display || m.model;
        push('  ' + cyan(disp));
        push(grey(`      键名 ${id} · 供应商 ${prov}`));
        push(grey(`      model ${m.model} @ ${m.base_url} · key ${maskKey(m.api_key)}`));
      }
      return true;
    } else if (t.startsWith('/open')) {
      const arg = t.slice(5).trim();
      if (!subs.size) { push(grey('还没有子会话 —— 运行任务后，规划/执行/检验的过程会分别存进子会话。')); return true; }
      if (!arg) {
        push(bold(`子会话 ${subs.size} 个：`));
        for (const s of subs.values()) push(`  [${s.idx}] ` + cyan(s.title) + ' ' + (s.status === 'run' ? yellow('● 运行中') : green('✓ ' + s.lines.length + ' 行')) + grey('  → /open ' + s.idx));
        return true;
      }
      const s2 = [...subs.values()].find((x) => String(x.idx) === arg || x.key === arg);
      if (s2) { view = s2.key; viewOffset = 0; }
      else push(yellow('没有编号为 ' + arg + ' 的子会话（/open 查看列表）'));
      return true;
    } else if (t === '/model' || t.startsWith('/model ')) {
      if (t === '/model') { openPicker(); return true; }
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
    if (view) { view = null; viewOffset = 0; render(); return; }
    if (clar) { handleClar(raw); return; } // 澄清问卷接管输入
    if (mw) { handleModelWizard(raw); render(); return; } // 添加模型向导接管输入
    if (!t) { render(); return; }
    if (!started) {
      started = true;
      transcript.length = 0; // 首次输入：切换到 左对话/右回复 布局（标志作背景水印）
      replies.length = 0;
    }
    push(grey('❯ ') + bold(t));
    // 路由：/hoa-loop = 多模型协作流水线；普通输入 = 单个模型直接对话；其它 / 命令走 execCommand
    if (t.startsWith('/hoa-loop')) { runMultiModel(t.slice(9).trim()); return; }
    if (t.startsWith('/')) { execCommand(t); render(); return; }
    runSingleModel(t);
  }

  // ---------- 单模型模式：一个模型直接对话（默认），不进入多模型流水线 ----------
  function runSingleModel(task) {
    const modelId = chatModel || Object.values(cfg.roles || {})[0]?.model;
    const model = cfg.models?.[modelId];
    if (!modelId || !model) { push(yellow('尚未配置任何模型——先 /models add 添加，或 /model 选择一个')); render(); return; }
    if (!mock && (!model.api_key || model.api_key === 'YOUR_KEY_HERE')) {
      push(yellow(`模型「${modelId}」缺少有效 API Key——去「设置」或 /models add 填写后重试`)); render(); return;
    }
    chatHistory.push({ role: 'user', content: task });
    busy = true; interrupted = false; lastEscAt = 0; tokens = 0; stageCurKey = null; curStageKey = null; stagesDone.clear();
    taskStart = Date.now(); curActivity = '与 ' + (model.display || model.model) + ' 对话'; curRoute = 'main';
    subs.clear(); view = null; viewOffset = 0;
    think = { startedAt: Date.now(), note: '调用 ' + model.model, route: 'main', reasonBuf: '' };
    streamBuf = '';
    if (busyTick) clearInterval(busyTick);
    busyTick = setInterval(() => { if (busy) render(); }, 200);
    render();
    (async () => {
      try {
        const r = await chatCompletion(model, chatHistory.slice(-12), [], {
          stream: !mock, mock, mockRole: modelId,
          onToken: (tk) => { if (interrupted) throw new Error('__INTERRUPT__'); streamBuf += tk; tokens += Math.max(1, Math.round(tk.length / 3)); },
          onReason: (tk) => { if (interrupted) throw new Error('__INTERRUPT__'); if (think) think.reasonBuf += tk; },
        });
        flushStreamMain();
        think = null;
        const answer = (r.content || streamBuf || '').trim();
        if (answer) {
          chatHistory.push({ role: 'assistant', content: answer });
          // 最终输出：品红色块单独呈现，保持简洁
          push('\n' + bold(magenta('━━ 最终输出 ━━')));
          vwrap(answer.replace(/\n{3,}/g, '\n\n'), Math.max(20, Math.floor((process.stdout.columns || 100) * 0.68) - 4)).slice(0, 14).forEach((l) => push('  ' + magenta(l)));
          push('');
        }
      } catch (e) {
        if (String(e?.message).includes('__INTERRUPT__')) push(yellow('⏹ 已中断（esc interrupt）'));
        else push('\n' + red(String(e?.message || e)) + '\n');
      }
      const wasInt = interrupted;
      busy = false; interrupted = false; streamBuf = ''; think = null;
      if (busyTick) { clearInterval(busyTick); busyTick = null; }
      render();
      if (!wasInt && pendingQueue.length) { const nx = pendingQueue.shift(); submit(nx); } // 模型工作时排队的指令，自动续跑
    })();
  }

  // ---------- 多模型协作流水线（仅 /hoa-loop 触发，且需已安装 skill/插件） ----------
  function runMultiModel(task) {
    if (!task) { push(yellow('用法：/hoa-loop <任务>') + grey('（仅安装 skill 后可用多模型协作；普通输入=单模型对话）')); render(); return; }
    if (!mock && pluginNames.length === 0) {
      push(yellow('多模型协作需要先在「设置」或 /plugins 安装一个 skill（插件）。')
        + grey('  普通输入（不带 /hoa-loop）会直接用单个模型对话。'));
      render(); return;
    }
    const bad = mock ? [] : missingKeys();
    if (bad.length) { push(yellow('以下模型缺少有效密钥：' + bad.join(', ')) + grey('（输入 /mock 体验演示，或去配置页填 key）')); render(); return; }
    let runCfg = cfg;
    if (chatModel) { runCfg = structuredClone(cfg); for (const rr of Object.values(runCfg.roles)) rr.model = chatModel; }
    busy = true; interrupted = false; lastEscAt = 0; tokens = 0; stageCurKey = null; curStageKey = null; stagesDone.clear();
    taskStart = Date.now(); curActivity = ''; mainReasonBuf = ''; curRoute = 'main';
    chatHistory = []; // 进入多模型协作，清空单模型对话历史
    subs.clear(); view = null; viewOffset = 0; // 新任务：重建子会话
    if (busyTick) clearInterval(busyTick);
    busyTick = setInterval(() => { if (busy) render(); }, 200);
    render();
    (async () => {
      try {
        const report = await runPipeline(task, runCfg, plugins, { cwd: process.cwd() }, mock, tuiTrace());
        ensureDirs();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rp = path.join(RUNS_DIR, `run-${stamp}.md`);
        fs.writeFileSync(rp, renderReport(task, report, mock), 'utf8');
        push('\n' + dim('运行报告已保存：' + rp));
        // 最终输出：品红色块单独呈现（区别于过程信息，保持简洁）
        push('\n' + bold(magenta('━━ 最终输出 ━━')));
        const finW = Math.max(20, Math.floor((process.stdout.columns || 100) * 0.68) - 4);
        vwrap(finalAnswerText(report), finW).slice(0, 14).forEach((l) => push('  ' + magenta(l)));
        push('');
      } catch (e) {
        if (String(e?.message).includes('__INTERRUPT__')) push(yellow('⏹ 已中断（esc interrupt）'));
        else push('\n' + String(e?.message || e) + '\n');
      }
      const wasInt = interrupted;
      busy = false; interrupted = false; streamBuf = ''; think = null;
      if (busyTick) { clearInterval(busyTick); busyTick = null; }
      render();
      if (!wasInt && pendingQueue.length) { const nx = pendingQueue.shift(); submit(nx); }
    })();
  }

  function onKey(str, key) {
    if (!key) return;
    if (key.ctrl && key.name === 'c') { exitTui(); return; }
    // 子会话详情页：esc/回车/q 返回主会话，↑↓ 滚动
    if (view) {
      if (key.name === 'escape' || key.name === 'return' || key.name === 'enter' || str === 'q') { view = null; viewOffset = 0; render(); return; }
      if (key.name === 'up') { viewOffset += 3; render(); return; }
      if (key.name === 'down') { viewOffset = Math.max(0, viewOffset - 3); render(); return; }
      return;
    }
    if (key.ctrl && key.name === 'p') {
      // ctrl+p：展开/收起命令面板（有输入时以输入为前缀过滤；空输入时列出全部）
      if (popupOpen) { popupOpen = false; }
      else { if (!line.startsWith('/')) line = '/'; popupSel = 0; popupOpen = popupEntries() != null; if (!popupOpen) { line = ''; push(yellow('没有匹配的命令')); } }
      render(); return;
    }
    // 模型工作时：仍可继续打字（回车即排队），esc 需连按两次才中断
    if (busy) {
      if (key.name === 'escape') {
        // 澄清问卷进行中：esc = 跳过剩余问题（不打断流水线）
        if (clar) { skipClar(); render(); return; }
        const now = Date.now();
        if (now - lastEscAt < 900) { // 双击：中断
          lastEscAt = 0; interrupted = true;
          push(yellow('⏹ 正在中断当前任务…'));
          render();
        } else { // 单击：提示再按一次
          lastEscAt = now;
          push(grey('· 再按一次 esc 中断当前任务'));
          render();
        }
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        if (clar) { submit(line); return; } // 回答澄清问题（逐题）
        if (line.trim()) { pendingQueue.push(line.trim()); push(grey('✉ 已排队 ') + bold(line.trim())); line = ''; popupOpen = false; }
        render(); return;
      }
      if (key.name === 'backspace') { line = [...line].slice(0, -1).join(''); render(); return; }
      if (str && !key.ctrl && !key.meta) { const clean = str.replace(/[\r\n]/g, ''); if (clean) { line += clean; render(); } }
      return;
    }
    if (key.name === 'escape') {
      lastEscAt = 0;
      if (mw) { push(yellow('✕ 已取消添加模型')); mw = null; render(); return; }
      if (popupOpen) { popupOpen = false; render(); } else if (line) { line = ''; render(); } return;
    }
    if (key.name === 'up') {
      if (popupOpen) { const n = popupEntries()?.length || 1; popupSel = (popupSel - 1 + n) % n; render(); return; }
      if (started && !picker && !settings && !view) { scrollOffset += 3; render(); return; }
      return;
    }
    if (key.name === 'down') {
      if (popupOpen) { const n = popupEntries()?.length || 1; popupSel = (popupSel + 1) % n; render(); return; }
      if (started && !picker && !settings && !view) { scrollOffset = Math.max(0, scrollOffset - 3); render(); return; }
      return;
    }
    if (key.name === 'tab') {
      if (popupOpen) { const e = popupEntries(); if (e?.[popupSel]) { line = e[popupSel][0] + ' '; popupOpen = false; render(); } return; }
      agentIdx++; chatModel = null; const nr = currentRole(); if (nr) push(grey('岗位切换 → ') + cyan(nr)); render(); return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      if (popupOpen) {
        // 若已输入完整命令（首 token 即已知命令），直接提交该行，而非接受补全建议
        const firstTok = line.trim().split(/\s+/)[0];
        const known = COMMANDS.some(([c]) => c === firstTok || c.split(' ')[0] === firstTok);
        if (known) { popupOpen = false; submit(line); return; }
        const e = popupEntries(); if (e?.[popupSel]) { line = e[popupSel][0] + ' '; popupOpen = false; render(); return; }
      }
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

  // ---------- 输入解析：键盘 + 鼠标（点击命令/子会话/设置） ----------
  let kb = '';
  let escTimer = null;
  function onData(chunk) {
    kb += chunk.toString('utf8');
    processKb();
  }
  function processKb() {
    while (kb.length) {
      let m;
      // SGR 鼠标（ kitty/xterm ）: ESC [ < b ; col ; row M/m
      if ((m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(kb))) { kb = kb.slice(m[0].length); onMouse(+m[2], +m[3], m[4] === 'M', +m[1]); continue; }
      if (kb.startsWith('\x1b[M')) { kb = kb.slice(6); continue; } // 传统 X10 鼠标：忽略
      if ((m = /^\x1b\[([ABCD])/.exec(kb))) { kb = kb.slice(m[0].length); onKey('', { name: { A: 'up', B: 'down', C: 'right', D: 'left' }[m[1]] }); continue; }
      if ((m = /^\x1b\[\d*~/.exec(kb))) { kb = kb.slice(m[0].length); continue; }
      if (kb[0] === '\x1b') {
        if (kb.length === 1) { // 可能是孤按 esc，也可能是序列还没到齐 → 短暂等待
          if (!escTimer) escTimer = setTimeout(() => { escTimer = null; if (kb === '\x1b') { kb = ''; onKey('', { name: 'escape' }); } }, 60);
          return;
        }
        if (kb[1] === '\x1b') { kb = kb.slice(1); onKey('', { name: 'escape' }); continue; } // 连按 esc：逐个派发
        if (kb[1] === '[') {
          const j = kb.slice(2).search(/[\x40-\x7E]/);
          if (j < 0) { if (kb.length < 48) return; kb = ''; continue; } // 序列未完整，等下一段
          kb = kb.slice(j + 3); continue; // 未知 CSI：丢弃
        }
        kb = kb.slice(2); continue; // alt+char：忽略
      }
      const ch = kb[0]; kb = kb.slice(1);
      const code = ch.codePointAt(0);
      if (ch === '\r' || ch === '\n') { onKey('', { name: 'return' }); continue; }
      if (ch === '\t') { onKey('', { name: 'tab' }); continue; }
      if (ch === '\x7f' || ch === '\b') { onKey('', { name: 'backspace' }); continue; }
      if (code === 3) { onKey('', { name: 'c', ctrl: true }); continue; }
      if (code === 16) { onKey('', { name: 'p', ctrl: true }); continue; }
      if (code < 32) { onKey('', { name: String.fromCharCode(96 + code), ctrl: true }); continue; }
      onKey(ch, { name: ch });
    }
  }
  function onMouse(col, row, press, btn) {
    if (!press) return;
    // 滚轮：主会话里翻看历史记录（64=上滚 65=下滚）
    if (btn === 64 || btn === 65) {
      if (view || settings || picker) return;
      scrollOffset += btn === 64 ? 4 : -4;
      scrollOffset = Math.max(0, scrollOffset);
      render();
      return;
    }
    for (const z of clickZones) {
      if (row >= z.y1 && row <= z.y2 && col >= z.x1 && col <= z.x2) { handleZone(z); return; }
    }
  }
  function handleZone(z) {
    if (z.act.t === 'cmd') { scrollOffset = 0; submit(z.act.cmd); } // 点命令弹层 → 直接执行
    else if (z.act.t === 'sub') { view = z.act.key; viewOffset = 0; render(); } // 点子会话 → 详情页
    else if (z.act.t === 'settings') { openSettings(); } // 右下角设置 → 设置页
    else if (z.act.t === 'back') { view = null; viewOffset = 0; render(); }
    else if (z.act.t === 'pick') { pickerConfirm(z.act.id); } // 点模型行 → 选用
    else if (z.act.t === 'set') { settings.sel = z.act.i; adjustSetting(settingsItems()[z.act.i], 1); } // 点设置行 → 修改
  }

  let altOn = false; // 是否已进入独立窗口（alternate screen buffer）
  function enterAltScreen() {
    if (altOn) return;
    altOn = true;
    out('\x1b[?1049h\x1b[?1h\x1b[2J\x1b[H' + (IS_TTY ? '\x1b[?1000h\x1b[?1006h' : '')); // 独立窗口 + 开启鼠标点击上报
  }
  function leaveAltScreen() {
    if (!altOn) return;
    altOn = false;
    out((IS_TTY ? '\x1b[?1006l\x1b[?1000l' : '') + '\x1b[?1l\x1b[?1049l'); // 关鼠标 + 还原原终端内容
  }
  function exitTui() {
    if (busyTick) { clearInterval(busyTick); busyTick = null; }
    if (escTimer) { clearTimeout(escTimer); escTimer = null; }
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.removeListener('data', onData);
    process.stdin.pause();
    leaveAltScreen();
    out(grey('再见。') + '\n');
    process.exit(0);
  }
  // 异常退出（ctrl+c 信号 / 崩溃）也要还回原终端画面
  process.on('SIGINT', () => exitTui());
  process.on('SIGTERM', () => exitTui());
  process.on('exit', () => leaveAltScreen());

  // 启动画面
  // 欢迎屏（与 Codex 一致：顶栏 + 居中标志 + 右侧栏目）由下方 render() 绘制
  push(dim('欢迎使用 OmniAgent 终端模式 —— 直接输入任务，或输入 / 查看命令。tab 切换岗位，ctrl+p 命令面板。'));
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onData);
  enterAltScreen();
  render();
  // 终端尺寸变化：自动重排两栏布局
  process.stdout.on?.('resize', () => render());

  // 仅供无头测试读取内部状态（OMNI_TEST=1 时才挂载，正常使用零开销）
  if (process.env.OMNI_TEST) {
    globalThis.__OMNI_TEST = {
      getState: () => ({
        busy, clar: !!clar, mw: !!mw, view, settings: !!settings,
        transcript: transcript.map(String),
        subs: [...subs.values()].map((x) => ({ idx: x.idx, key: x.key, title: x.title, status: x.status, lines: x.lines.map(String) })),
        zones: clickZones.map((z) => ({ t: z.act && z.act.t, y1: z.y1, y2: z.y2, x1: z.x1, x2: z.x2, act: z.act })),
      }),
    };
  }
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

    if (process.stdin.isTTY) {
      ui.header(`初始化 OmniAgent（预设 ${name}）`);
      ui.info('请依次回答以下问题（直接回车 = 使用括号中的默认值）：');
      console.log('');
      const base = await askQ(1, 4, 'API base_url', { def: 'https://api.openai.com/v1' });
      const key = await askQ(2, 4, 'API key（明文显示，仅保存在本机）');
      const model = await askQ(3, 4, '模型名', { def: 'gpt-4o-mini' });
      console.log('');
      ui.info('—— 请确认 ——');
      ui.info(`base_url: ${base}`);
      ui.info(`模型名:   ${model}`);
      ui.info(`API key:  ${maskKey(key)}`);
      console.log('');
      const okc = await askQ(4, 4, '确认写入以上配置？', { def: 'Y' });
      console.log('');
      if (!/^y(es)?$/i.test(okc.trim())) { closeRl(); ui.warn('已取消，未写入任何配置。'); return; }
      if (!key) ui.warn('API key 为空：界面可进入但调用模型会失败，可先 /mock 体验演示模式，或重跑 init 补填。');
      for (const m of Object.values(cfg.models)) { m.base_url = base; m.api_key = key; m.model = model; }
      saveConfig(cfg);
      ui.ok(`配置已写入：${CONFIG_PATH}`);
    } else {
      saveConfig(cfg);
      ui.ok(`已生成配置（预设 ${name}）→ ${CONFIG_PATH}`);
      ui.info('请将 models.*.api_key 替换为你的密钥，或在终端中重跑 omniagent init 交互式填写。');
    }
    closeRl();
    ui.ok('初始化完成 ✓  直接运行  omniagent  即可进入界面（无需任何参数）。');
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
    const ms = Object.entries(cfg.models || {});
    if (!ms.length) ui.info('（暂无模型。在交互界面里输入 /models add 可批量添加 OpenAI 兼容模型）');
    for (const [id, m] of ms) {
      const prov = m.provider || guessProvider(m.base_url);
      ui.info(`· ${m.display || m.model}  [键名 ${id}]`);
      ui.info(`    供应商 ${prov} · model ${m.model}`);
      ui.info(`    ${m.base_url}  (key:${maskKey(m.api_key)})`);
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
