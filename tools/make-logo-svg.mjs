// 生成 ORcode 像素标志 SVG（与 TUI 的 5x5 GLYPHS 字形一致）
// 用法: node tools/make-logo-svg.mjs   → 输出到 stdout
const G = {
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '####.', '#.#..', '#..#.'],
  C: ['.###.', '#...#', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
};
const WORD = 'ORCODE';
const CELL = 6;      // 每个像素格的边长
const GAP = CELL;     // 字母间距
const PAD = CELL;     // 画布留白

const w = PAD * 2 + WORD.length * 5 * CELL + (WORD.length - 1) * GAP;
const h = PAD * 2 + 5 * CELL;
const half = Math.ceil(WORD.length / 2);

// 每个像素格生成一个 <rect>；前半段（ORC）用暗色调，后半段（ODE）用亮色调 → 呼应 TUI 双色
// 用固定色值（不用 CSS 变量），保证 SVG 单独打开/GitHub 预览时也有正确配色
const DIM = '#5c6370';    // ORC：暗（对齐 TUI grey）
const BRIGHT = '#e6edf3'; // ODE：亮（对齐 TUI bold）
let rects = '';
WORD.split('').forEach((ch, ci) => {
  const g = G[ch];
  const ox = PAD + ci * (5 * CELL + GAP);
  const tone = ci < half ? DIM : BRIGHT;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    if (g[y][x] === '#') {
      rects += `    <rect x="${ox + x * CELL}" y="${PAD + y * CELL}" width="${CELL}" height="${CELL}" fill="${tone}"/>\n`;
    }
  }
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="ORcode">
  <title>ORcode</title>
${rects}  </svg>`;

console.log(svg);
console.error(`\n[logo] ${w}x${h}px, ${rects.trim().split('\n').length} rects`);