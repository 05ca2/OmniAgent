// 补丁：① init 问卷改为单一持久 readline（全部明文可见输入）
//       ② 欢迎屏改为极简 Codex 布局（左上标题 + 居中暗标志 + 底部输入行 + 状态行）
//       ③ 对话视图底部输入/状态行同步 Codex 风格
import fs from 'node:fs';

let src = fs.readFileSync('bin/omni.js', 'utf8');
const rep = (a, b, tag) => {
  if (!src.includes(a)) { console.error('锚点缺失: ' + tag); process.exit(1); }
  src = src.replace(a, b);
  console.log('OK: ' + tag);
};
// 区间替换（按唯一起止锚点）
const replaceRange = (startMark, endMark, newText, tag) => {
  const i = src.indexOf(startMark);
  const j = src.indexOf(endMark, i);
  if (i < 0 || j < 0) { console.error('区间锚点缺失: ' + tag); process.exit(1); }
  src = src.slice(0, i) + newText + src.slice(j);
  console.log('OK: ' + tag);
};

// ---- ① 输入辅助：移除 MUTE_OUT/secret，单一持久 readline ----
replaceRange(
  '// ---- 问卷式输入辅助',
  'function parseFlags',
`// ---- 问卷式输入辅助（单一持久 readline 实例；Windows 终端可靠，输入明文可见）----
let _rl = null;
function getRl() {
  if (!_rl) _rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return _rl;
}
function closeRl() { if (_rl) { try { _rl.close(); } catch {} _rl = null; } }

// 询问一题；no/total 显示 [n/4] 编号；直接回车 = 使用默认值
function askQ(no, total, q, { def = '' } = {}) {
  return new Promise((res) => {
    const prefix = total ? '[' + no + '/' + total + '] ' : '';
    const suffix = def ? ' (' + def + ')' : '';
    getRl().question(prefix + q + suffix + ': ', (a) => res(a.trim() || def));
  });
}

`,
  'askq-rewrite'
);

// 移除不再使用的 Writable 导入
rep("import { Writable } from 'node:stream';\n", '', 'drop-writable');

// init：密钥改为明文可见输入；结束/取消时关闭 readline
rep("const key = await askQ(2, 4, 'API key', { secret: true });",
  "const key = await askQ(2, 4, 'API key（明文显示，仅保存在本机）');", 'init-key');
rep("if (!/^y(es)?$/i.test(okc.trim())) { ui.warn('已取消，未写入任何配置。'); return; }",
  "if (!/^y(es)?$/i.test(okc.trim())) { closeRl(); ui.warn('已取消，未写入任何配置。'); return; }", 'init-cancel');
rep("    ui.ok('初始化完成 ✓  直接运行  omniagent  即可进入界面（无需任何参数）。');",
  "    closeRl();\n    ui.ok('初始化完成 ✓  直接运行  omniagent  即可进入界面（无需任何参数）。');", 'init-done');

// ---- ② 欢迎屏：极简 Codex 布局 ----
replaceRange(
  '  // OpenCode 风格欢迎屏',
  '  function render()',
`  // Codex 极简欢迎屏：左上标题 + 居中暗色标志 + 底部输入行 + 状态行
  function welcomeLines(W, H) {
    const magenta = (s) => (IS_TTY ? '\\x1b[35m' + s + '\\x1b[0m' : String(s));
    const head = [
      bold('>⌒ OmniAgent') + grey(' (v' + VERSION + ')'),
      grey('  ' + process.cwd()),
      grey('  permissions: ') + magenta('YOLO mode'),
    ];
    const role = currentRole();
    const r0 = role ? cfg.roles[role] : null;
    const m0 = r0 ? cfg.models[r0.model] : null;
    const modelId = chatModel ? (cfg.models[chatModel]?.model || chatModel) : (m0 ? m0.model : '未配置 · 先运行 omniagent init');
    const inText = line ? cutPlain(line, Math.max(10, W - 4)) + '█' : grey('Ask OmniAgent to do anything');
    const bottom = [
      '❯ ' + inText,
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

`,
  'welcome-codex'
);

// ---- ③ 对话视图底部：Codex 风格输入行 + 状态行 ----
rep("const inputRow = (line ? cutPlain(line, MW - 3) : grey('Ask anything…')) + '█';",
  "const inputRow = '❯ ' + (line ? cutPlain(line, MW - 5) : grey('Ask OmniAgent to do anything')) + '█';", 'chat-input');
replaceRange(
  '    const agName = chatModel',
  "const agRow = agName + (mock ? yellow('  mock') : '');",
`    const agRow = (chatModel
        ? cyan(cfg.models[chatModel]?.model || chatModel)
        : role
        ? cyan(m ? m.model : role)
        : yellow('未配置模型 · 先运行 omniagent init')) + grey(' · ' + process.cwd()) + (mock ? yellow(' · mock') : '');`,
  'chat-status'
);
rep("const hintR = 'tab agents   ctrl+p commands';",
  "const hintR = 'tab for agents · ? for shortcuts';", 'chat-hint');

fs.writeFileSync('bin/omni.js', src);
console.log('补丁全部应用');
