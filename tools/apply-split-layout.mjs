import fs from 'node:fs';
const f = 'bin/omni.js';
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b, tag) => {
  if (!s.includes(a)) { console.error('锚点缺失: ' + tag); process.exit(1); }
  s = s.replace(a, b);
};

// 1) replies 数组 + flushStream 同步写入右栏
rep(
  `  function push(t) { transcript.push(t); }
  function flushStream() {
    if (!streamBuf) return;
    vwrap(streamBuf.trimEnd(), 200).forEach((l) => push('  ' + l));
    streamBuf = '';
  }`,
  `  function push(t) { transcript.push(t); }
  const replies = []; // 右栏：模型回复（流式文本 + 关键结果）
  function pushReply(t) { replies.push(t); }
  function flushStream() {
    if (!streamBuf) return;
    vwrap(streamBuf.trimEnd(), 200).forEach((l) => { push('  ' + l); pushReply('  ' + l); });
    streamBuf = '';
  }`,
  'replies'
);

// 2) result 事件同步到右栏
rep(
  `result: (label, text) => { flushStream(); push('\\n' + yellow('◆ ' + label) + '  ' + String(text).slice(0, 200) + '\\n'); },`,
  `result: (label, text) => { flushStream(); push('\\n' + yellow('◆ ' + label) + '  ' + String(text).slice(0, 200) + '\\n'); pushReply(yellow('◆ ' + label) + '  ' + String(text).slice(0, 200)); },`,
  'result'
);

// 3) welcomeLines 重写为 OpenCode 风格（全屏、无侧栏）
rep(
  `  // Codex 风格欢迎屏：顶栏 + 水平居中暗色标志 + 输入提示（右侧栏目由 render 统一合成）
  function welcomeLines(MW, H) {
    const head = [
      bold('> OmniAgent') + grey('  (v' + VERSION + ')'),
      '  ' + grey(process.cwd()),
      '  ' + grey('permissions: ') + yellow('YOLO mode'),
    ];
    const logo = LOGO_LINES.map(grey);
    const bottom = [
      grey('Ask anything…') + '█',
      grey('tab agents   ctrl+p commands'),
    ];
    const used = head.length + 1 + logo.length + bottom.length;
    const pad = Math.max(0, Math.floor((H - used) / 2));
    const m = [];
    m.push(...head);
    m.push('');
    for (let i = 0; i < pad; i++) m.push('');
    for (const l of logo) {
      const w = vlen(l);
      const padL = Math.max(0, Math.floor((MW - w) / 2));
      m.push(' '.repeat(padL) + l);
    }
    for (let i = 0; i < pad; i++) m.push('');
    while (m.length < H - bottom.length) m.push('');
    m.push(...bottom);
    return m.slice(0, H);
  }`,
  `  // OpenCode 风格欢迎屏：居中大标志 + 带边框输入框 + 模型行 + 提示（全屏，无侧栏）
  function welcomeLines(W, H) {
    const role = currentRole();
    const r0 = role ? cfg.roles[role] : null;
    const m0 = r0 ? cfg.models[r0.model] : null;
    const agentName = chatModel ? grey('统一模型') : (r0 ? cyan(r0.name || role) : yellow('未配置岗位'));
    const modelId = chatModel ? (cfg.models[chatModel]?.model || chatModel) : (m0 ? m0.model : '运行 omniagent init 配置模型');
    const BW = Math.min(64, Math.max(40, W - 8));
    const inText = line ? cutPlain(line + '█', BW - 4) : grey('Ask anything…  ') + grey('“输入任务，回车开始”');
    const box = [
      '┌' + '─'.repeat(BW - 2) + '┐',
      '│ ' + vpad(inText, BW - 4) + ' │',
      '│ ' + vpad(agentName + (modelId ? grey('  ·  ') + modelId : ''), BW - 4) + ' │',
      '└' + '─'.repeat(BW - 2) + '┘',
    ];
    const hints = grey('tab agents   ctrl+p commands');
    const tip = yellow('● Tip ') + grey('运行 /help 查看全部命令 · /mock 免密钥体验');
    const m = [];
    const used = LOGO_LINES.length + 1 + box.length + 2 + 2 + 2;
    const pad = Math.max(1, Math.floor((H - used - 2) / 2));
    for (let i = 0; i < pad; i++) m.push('');
    for (const l of LOGO_LINES) {
      const w = vlen(l);
      const p = Math.max(0, Math.floor((W - w) / 2));
      m.push(' '.repeat(p) + grey(l));
    }
    m.push('');
    const bx = Math.max(0, Math.floor((W - BW) / 2));
    for (const bl of box) m.push(' '.repeat(bx) + bl);
    m.push('');
    m.push(' '.repeat(Math.max(0, W - vlen(hints) - bx - 2)) + hints);
    m.push('');
    m.push(' '.repeat(Math.max(0, Math.floor((W - vlen(tip)) / 2))) + tip);
    while (m.length < H - 1) m.push('');
    const cwd = grey(' ' + process.cwd());
    const ver = grey('OmniAgent v' + VERSION + ' ');
    m.push(cwd + ' '.repeat(Math.max(1, W - vlen(cwd) - vlen(ver))) + ver);
    return m.slice(0, H);
  }`,
  'welcomeLines'
);

// 4) render() 顶部：改为 左宽/右宽，去掉侧栏
rep(
  `    const SW = Math.min(38, Math.max(26, Math.floor(W * 0.3)));
    const MW = W - SW - 1;

    // ---- 侧栏 ----
    const sb = sidebarLines(H, SW);

    let main;
    if (!started) {
      main = welcomeLines(MW, H);
    } else {`,
  `    const MW = Math.max(40, Math.floor(W * 0.55));
    const RW = Math.max(10, W - MW - 3);

    let main, right;
    if (!started) {
      main = welcomeLines(W, H);
      right = [];
    } else {`,
  'render-top'
);

// 5) else 分支末尾构建右栏
rep(
  `    main.push(...popRows, inputRow, agRow, hintRow);

    }`,
  `    main.push(...popRows, inputRow, agRow, hintRow);

    // ---- 右栏：模型回复 ----
    right = [];
    for (const t of replies) {
      if (t === '\\n') { right.push(''); continue; }
      for (const l of vwrap(t.replace(/\\n/g, ''), RW)) right.push(l);
    }
    while (right.length < showN) right.push('');
    right.splice(0, Math.max(0, right.length - showN));
    for (let i = 0; i < fixedRows; i++) right.push('');
    }`,
  'right-col'
);

// 6) 合成：欢迎屏全屏直出；对话布局 = 左对话 + 右回复 + 标志水印背景
rep(
  `    // ---- 合成双栏 ----
    const rows = [];
    for (let i = 0; i < H; i++) rows.push(vpad(main[i] || '', MW) + grey(' │ ') + (sb[i] || ''));
    out('\\x1b[H\\x1b[2J' + rows.join('\\n') + '\\n');`,
  `    // 欢迎屏：全屏单栏直接输出
    if (!started) { out('\\x1b[H\\x1b[2J' + main.join('\\n') + '\\n'); return; }

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
      const bl = l ? '' : bg[i].slice(0, MW);
      const br = r ? '' : bg[i].slice(MW + 3).padEnd(RW);
      rows.push((l ? vpad(l, MW) : grey(bl)) + grey(' │ ') + (r ? vpad(r, RW) : grey(br)));
    }
    out('\\x1b[H\\x1b[2J' + rows.join('\\n') + '\\n');`,
  'compose'
);

// 7) submit 首次输入：清空后切换布局（去掉旧顶栏+标志推入）
rep(
  `    if (!started) {
      started = true;
      transcript.length = 0; // 首次输入：清屏并切换布局
      push(bold('> OmniAgent') + grey('  (v' + VERSION + ')'));
      push('  ' + grey(process.cwd()));
      push('  ' + grey('permissions: ') + yellow('YOLO mode'));
      const rows = process.stdout.rows || 30;
      const pad = Math.max(1, Math.floor((rows - LOGO_LINES.length - 8) / 2));
      for (let i = 0; i < pad; i++) push('');
      const W0 = process.stdout.columns || 100;
      const SW0 = Math.min(38, Math.max(26, Math.floor(W0 * 0.3)));
      const MW0 = W0 - SW0 - 1;
      for (const l of LOGO_LINES) {
        const w = vlen(l);
        const padL = Math.max(0, Math.floor((MW0 - w) / 2));
        push(' '.repeat(padL) + grey(l));
      }
      for (let i = 0; i < pad; i++) push('');
    }`,
  `    if (!started) {
      started = true;
      transcript.length = 0; // 首次输入：切换到 左对话/右回复 布局（标志作背景水印）
      replies.length = 0;
    }`,
  'submit-start'
);

// 8) /clear 同时清右栏
rep(
  `else if (t === '/clear') { transcript.length = 0; }`,
  `else if (t === '/clear') { transcript.length = 0; replies.length = 0; }`,
  'clear'
);

fs.writeFileSync(f, s);

// 9) package.json：添加 omniagent 全局命令入口，并同步版本号
const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.bin = { omniagent: 'bin/omni.js', omni: 'bin/omni.js' };
const vm = /const VERSION *= *'([^']+)'/.exec(s);
if (vm && pkg.version !== vm[1]) pkg.version = vm[1];
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log('补丁完成', JSON.stringify({ version: pkg.version, bin: pkg.bin }));
