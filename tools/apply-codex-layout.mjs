import fs from 'node:fs';
const f = 'bin/omni.js';
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b, tag) => {
  if (!s.includes(a)) { console.error('锚点缺失: ' + tag); process.exit(1); }
  s = s.replace(a, b);
};

// 1) 在 render() 之前插入 welcomeLines（Codex 风格欢迎屏：顶栏 + 居中暗色标志 + 输入提示）
rep(
  '\n  function render() {',
  `\n  // Codex 风格欢迎屏：顶栏 + 水平居中暗色标志 + 输入提示（右侧栏目由 render 统一合成）\n  function welcomeLines(MW, H) {\n    const head = [\n      bold('> OmniAgent') + grey('  (v' + VERSION + ')'),\n      '  ' + grey(process.cwd()),\n      '  ' + grey('permissions: ') + yellow('YOLO mode'),\n    ];\n    const logo = LOGO_LINES.map(grey);\n    const bottom = [\n      grey('Ask anything…') + '█',\n      grey('tab agents   ctrl+p commands'),\n    ];\n    const used = head.length + 1 + logo.length + bottom.length;\n    const pad = Math.max(0, Math.floor((H - used) / 2));\n    const m = [];\n    m.push(...head);\n    m.push('');\n    for (let i = 0; i < pad; i++) m.push('');\n    for (const l of logo) {\n      const w = vlen(l);\n      const padL = Math.max(0, Math.floor((MW - w) / 2));\n      m.push(' '.repeat(padL) + l);\n    }\n    for (let i = 0; i < pad; i++) m.push('');\n    while (m.length < H - bottom.length) m.push('');\n    m.push(...bottom);\n    return m.slice(0, H);\n  }\n\n  function render() {`,
  'welcomeLines'
);

// 2) render() 主构建外包 if(!started)/else
rep(
  '    // ---- 主区 ----',
  `    let main;\n    if (!started) {\n      main = welcomeLines(MW, H);\n    } else {\n    // ---- 主区 ----`,
  'branch-open'
);

// 3) 关闭 else（在合成双栏之前）
rep(
  '    // ---- 合成双栏 ----',
  `    }\n\n    // ---- 合成双栏 ----`,
  'branch-close'
);

// 4) 主构建内 const main -> 赋值到外层 main
rep(
  '    const main = [];',
  '    main = [];',
  'main-assign'
);

// 5) 启动画面：去掉裸标志输出，改由 render() 绘制（started=false 即欢迎屏）
rep(
  "  out('\\x1b[2J\\x1b[H\\n' + LOGO_LINES.map((l) => grey(l)).join('\\n') + '\\n');",
  '  // 欢迎屏（与 Codex 一致：顶栏 + 居中标志 + 右侧栏目）由下方 render() 绘制',
  'startup'
);

// 6) submit 首次输入：标志改为水平居中
rep(
  `      for (const l of LOGO_LINES) push(grey(l));`,
  `      const W0 = process.stdout.columns || 100;\n      const SW0 = Math.min(38, Math.max(26, Math.floor(W0 * 0.3)));\n      const MW0 = W0 - SW0 - 1;\n      for (const l of LOGO_LINES) {\n        const w = vlen(l);\n        const padL = Math.max(0, Math.floor((MW0 - w) / 2));\n        push(' '.repeat(padL) + grey(l));\n      }`,
  'submit-logo'
);

fs.writeFileSync(f, s);
console.log('补丁完成');
