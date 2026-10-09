import fs from 'node:fs';
const art = fs.readFileSync('tools/logo-art.txt', 'utf8').replace(/\s+$/, '');
let src = fs.readFileSync('bin/omni.js', 'utf8');
const rep = (a, b, tag) => {
  if (!src.includes(a)) { console.error('锚点缺失: ' + tag); process.exit(1); }
  src = src.replace(a, b);
};

// 1) 嵌入标志常量
rep("import { ui } from '../src/ui.js';",
  "import { ui } from '../src/ui.js';\n\n// ---------- 品牌标志（tools/logo2ascii.js 从用户 PNG 生成） ----------\nconst LOGO_ART = " + JSON.stringify(art) + ";\nconst LOGO_LINES = LOGO_ART.split('\n');", 'logo');

// 2) submit() 增加 started 标志
rep("  function submit(raw) {", "  let started = false;\n\n  function submit(raw) {", 'flag');

// 3) 首次输入：清屏 + 顶栏 + 居中暗色标志（仿 Codex 布局）
rep("    if (!t) { render(); return; }\n    push(grey('❯ ') + bold(t));",
`    if (!t) { render(); return; }
    if (!started) {
      started = true;
      transcript.length = 0; // 首次输入：清屏并切换布局（仿 Codex）
      push(bold('> OmniAgent') + grey(' (v' + VERSION + ')'));
      push('  ' + grey(process.cwd()));
      push('  ' + grey('permissions: ') + yellow('YOLO mode'));
      const rows = process.stdout.rows || 30;
      const pad = Math.max(1, Math.floor((rows - LOGO_LINES.length - 8) / 2));
      for (let i = 0; i < pad; i++) push('');
      for (const l of LOGO_LINES) push(grey(l));
      for (let i = 0; i < pad; i++) push('');
    }
    push(grey('❯ ') + bold(t));`, 'submit');

// 4) 启动画面换用新标志（暗色）
rep("out('\x1b[2J\x1b[H\n' + pixelLogo('OMNIAGENT') + '\n');",
  "out('\x1b[2J\x1b[H\n' + LOGO_LINES.map((l) => grey(l)).join('\n') + '\n');", 'startup');

fs.writeFileSync('bin/omni.js', src);
console.log('补丁完成');
