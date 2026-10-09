// 一次性补丁：把盲文标志嵌入 bin/omni.js 并改造首次输入布局（幂等）
import fs from 'node:fs';

const art = fs.readFileSync('tools/logo-art.txt', 'utf8').replace(/\s+$/, '');
let src = fs.readFileSync('bin/omni.js', 'utf8');
const rep = (anchor, replacement, tag) => {
  if (!src.includes(anchor)) { console.error('锚点缺失: ' + tag); process.exit(1); }
  src = src.replace(anchor, replacement);
  console.log('已应用: ' + tag);
};

// 1) 嵌入标志常量（挂在 pixelLogo 函数前）
rep('function pixelLogo(word) {',
`// ---------- 品牌标志（tools/logo2ascii.js 从用户 PNG 生成，Codex 风格暗色背景） ----------
const LOGO_ART = ${JSON.stringify(art)};
const LOGO_LINES = LOGO_ART.split('\\n');

function pixelLogo(word) {`, 'logo-const');

// 2) started 状态标志
rep('  function submit(raw) {', '  let started = false;\n\n  function submit(raw) {', 'started-flag');

// 3) 首次输入：清屏 → 顶栏 → 居中暗色大标志（仿 Codex 布局）
rep("    push(grey('❯ ') + bold(t));",
`    if (!started) {
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
    push(grey('❯ ') + bold(t));`, 'first-input');

// 4) 启动画面也换用新标志（暗色）
rep("pixelLogo('OMNIAGENT')", "LOGO_LINES.map((l) => grey(l)).join('\\n')", 'startup');

fs.writeFileSync('bin/omni.js', src);
console.log('补丁完成');
