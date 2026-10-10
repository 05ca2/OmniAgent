// 生成 ORcode 像素字标 SVG（复刻命令行 TUI 的 ORCODE 标识）
// 特征：圆角像素块 / ORC 深灰 + ODE 浅灰双色 / 底部立体暗带 / 基线小圆点
const GLYPHS = {
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '####.', '#.#..', '#..#.'],
  C: ['.###.', '#...#', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
};
const WORD = 'ORCODE';

// 配色（对齐深色官网背景）
const DARK = '#5a6472';   // ORC
const LIGHT = '#b9c1cd';  // ODE
const SHADE_DARK = '#3d444e';   // ORC 底部立体暗带
const SHADE_LIGHT = '#8b939f';  // ODE 底部立体暗带

const U = 20;          // 每个像素块边长
const GAP = 1;         // 字母间距（像素单位）
const R = 3;           // 圆角半径
const SH = 8;          // 底部暗带高度（紧贴主体下沿）
const DOT_R = 2.6;     // 基线圆点半径
const DOT_GAP = 12;    // 暗带底部到圆点中心的距离

const half = Math.ceil(WORD.length / 2);
const letterW = 5 * U;
const step = letterW + GAP * U;
const totalW = WORD.length * letterW + (WORD.length - 1) * GAP * U;
const bodyH = 5 * U;                 // 像素主体高度
const bandTop = bodyH;               // 暗带紧贴主体下沿
const bandBottom = bandTop + SH;
const dotCY = bandBottom + DOT_GAP;  // 圆点中心
const totalH = Math.ceil(dotCY + DOT_R + 2);

let out = [];
// 底部立体暗带：最后一行的像素向下延伸一段，形成厚度（先画，被主体覆盖的部分自然隐藏）
WORD.split('').forEach((ch, li) => {
  const g = GLYPHS[ch];
  const shade = li < half ? SHADE_DARK : SHADE_LIGHT;
  const ox = li * step;
  for (let x = 0; x < 5; x++) {
    if (g[4][x] === '#') {
      out.push(`  <rect x="${ox + x * U + 2}" y="${bandTop}" width="${U - 4}" height="${SH}" rx="${R}" fill="${shade}"/>`);
    }
  }
});
// 像素主体
WORD.split('').forEach((ch, li) => {
  const g = GLYPHS[ch];
  const fill = li < half ? DARK : LIGHT;
  const ox = li * step;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      if (g[y][x] === '#') {
        out.push(`  <rect x="${ox + x * U}" y="${y * U}" width="${U}" height="${U}" rx="${R}" fill="${fill}"/>`);
      }
    }
  }
});
// 基线小圆点：每个字母下方 3 个（CSS 里用currentColor 随主题变深浅）
WORD.split('').forEach((ch, li) => {
  const ox = li * step;
  for (const dx of [0.5, 2.5, 4.5]) {
    out.push(`  <circle cx="${ox + dx * U}" cy="${dotCY}" r="${DOT_R}" fill="#8b939f" opacity=".9"/>`);
  }
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" role="img" aria-label="ORCODE">
  <title>ORCODE</title>
${out.join('\n')}
</svg>`;

console.log(svg);
console.error(`[wordmark] ${totalW}x${totalH}, ${out.length} shapes`);