#!/usr/bin/env node
// PNG -> braille ASCII art（纯 Node：zlib + 手写 PNG 解码，零依赖）
// 用法: node tools/logo2ascii.js <logo.png> [cols] > art.txt
import fs from 'node:fs';
import zlib from 'node:zlib';

const [, , file, colsArg] = process.argv;
const COLS = Math.max(20, Math.min(90, Number(colsArg) || 44));
const ROWS = Math.round(COLS / 2.2);

const buf = fs.readFileSync(file);
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
let off = 8, ihdr = null; const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], ctype: data[9] };
  else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  off += 12 + len;
}
const { w, h, depth, ctype } = ihdr;
if (depth !== 8) throw new Error('bit depth ' + depth + ' unsupported');
const CH = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
if (!CH) throw new Error('color type ' + ctype + ' unsupported');

const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = w * CH;
const px = Buffer.alloc(w * h * CH);
for (let y = 0; y < h; y++) {
  const f = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const out = y * stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= CH ? px[out + x - CH] : 0;
    const b = y > 0 ? px[out - stride + x] : 0;
    const c = x >= CH && y > 0 ? px[out - stride + x - CH] : 0;
    let v = line[x];
    if (f === 1) v += a;
    else if (f === 2) v += b;
    else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    px[out + x] = v & 0xff;
  }
}

// 亮度 0-255
const lum = (x, y) => {
  const i = (y * w + x) * CH;
  if (ctype === 0) return px[i];
  return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
};

// braille: 每格 2x4 采样点
const BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
const THRESH = 96; // 黑底白标：亮度>阈值算亮点
const lines = [];
for (let ry = 0; ry < ROWS; ry++) {
  let line = '';
  for (let rx = 0; rx < COLS; rx++) {
    let bits = 0;
    for (let dy = 0; dy < 4; dy++) {
      const sy = Math.floor(((ry * 4 + dy + 0.5) / (ROWS * 4)) * h);
      for (let dx = 0; dx < 2; dx++) {
        const sx = Math.floor(((rx * 2 + dx + 0.5) / (COLS * 2)) * w);
        if (lum(sx, sy) > THRESH) bits |= BITS[dy][dx];
      }
    }
    line += bits ? String.fromCharCode(0x2800 + bits) : ' ';
  }
  lines.push(line.replace(/\s+$/, ''));
}
console.log(lines.join('\n'));
