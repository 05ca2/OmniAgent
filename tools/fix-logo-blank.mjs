import fs from 'node:fs';
let s = fs.readFileSync('bin/omni.js', 'utf8');
const needle = "const LOGO_LINES = LOGO_ART.split('\\n');";
const repl = "const LOGO_LINES = LOGO_ART.split('\\n').filter((l) => l.trim());";
if (!s.includes(needle)) { console.error('锚点未找到'); process.exit(1); }
s = s.replace(needle, repl);
fs.writeFileSync('bin/omni.js', s);
console.log('已过滤 LOGO_LINES 空行');
