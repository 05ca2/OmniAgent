// 终端输出（纯 ANSI，无第三方依赖）
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

// 仅当输出到真实终端且未设 NO_COLOR 时才上色；管道/重定向/文件保持纯文本
const COLOR_ON = process.stdout.isTTY === true && !process.env.NO_COLOR;
function paint(color, s) { return COLOR_ON ? C[color] + s + C.reset : s; }

export const ui = {
  header(title) {
    console.log('\n' + paint('bold', paint('cyan', '◆ ' + title)));
  },
  stage(name, sub) {
    console.log('\n' + paint('bold', paint('magenta', '▶ ' + name)) + paint('dim', '  ' + (sub || '')));
  },
  stepStart(role, instruction) {
    console.log(paint('yellow', '  └─ [' + role + '] ') + instruction);
  },
  agentThink(role, note) {
    console.log(paint('dim', '     · ' + (role.name || role.id || role) + ' · ' + note));
  },
  stream(t) {
    process.stdout.write(t);
  },
  streamEnd() {
    process.stdout.write('\n');
  },
  toolCall(name, args, out) {
    console.log(paint('cyan', '     ⚙ ' + name) + paint('dim', '(' + JSON.stringify(args).slice(0, 120) + ')'));
    const lines = String(out || '').split('\n');
    for (const l of lines.slice(0, 8)) console.log(paint('dim', '       ↳ ' + l.slice(0, 200)));
    if (lines.length > 8) console.log(paint('dim', '       … 共 ' + lines.length + ' 行'));
  },
  gaps(arr) {
    if (!arr || !arr.length) return;
    console.log(paint('red', '     ✗ 未完成项：'));
    for (const g of arr) console.log(paint('red', '       - ' + g));
  },
  result(label, text) {
    console.log(paint('green', '◆ ' + label + '：') + truncateSafe(text, 600));
  },
  error(e) {
    console.log(paint('red', '✗ 错误：' + (e && e.message ? e.message : e)));
  },
  ok(msg) {
    console.log(paint('green', '✓ ' + msg));
  },
  info(msg) {
    console.log(paint('dim', '  ' + msg));
  },
  warn(msg) {
    console.log(paint('yellow', '⚠ ' + msg));
  },
};

function truncateSafe(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
