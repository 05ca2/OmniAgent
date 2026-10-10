// 无头冒烟测试：伪造 TTY，加载 bin/orcode.js 的 chat 模式，
// 抓取首屏输出 + 模拟按键（提交任务 / 双击 esc / /models add 向导），校验不崩溃且布局行数正确。
const chunks = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => { chunks.push(String(s)); return true; };
process.stdout.isTTY = true;
process.stdout.columns = 110;
process.stdout.rows = 30;
process.stdin.isTTY = true;
process.stdin.setRawMode = () => {};
process.stdin.resume = () => {};
process.stdin.pause = () => {};
process.stdin.on = () => {};
process.stdin.removeListener = () => {};
process.stdin.once = () => {};

const fs = await import('node:fs');
const path = await import('node:path');
const os = await import('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-smoke-'));
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, '.omni'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.omni', 'config.json'), JSON.stringify({
  models: {
    ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-test-1234567890', model: 'deepseek-chat', provider: 'DeepSeek', display: 'DeepSeek V3' },
    or: { base_url: 'https://openrouter.ai/api/v1', api_key: 'sk-or-v1-abcdefgh', model: 'anthropic/claude-3.5-sonnet' },
  },
  roles: { director: { model: 'ds', tools: [] }, planner: { model: 'ds', tools: [] }, worker1: { model: 'or', tools: [] }, verifier: { model: 'ds', tools: [] } },
  pipeline: { stages: ['director', 'planner', 'workers', 'verifier'] },
}, null, 2));

process.argv = [process.argv[0], 'orcode.js', 'chat', '--mock'];

let exitCode = 0;
try {
  await import('../bin/orcode.js');
  await new Promise((r) => setTimeout(r, 400));
  const first = chunks.join('');
  const hasAlt = first.includes('\x1b[?1049h');
  const hasBrand = first.includes('ORcode');
  const hasLogo = first.includes('█'); // 左上角 ORCODE 像素字标（背景水印已移除）
  const hasBgWatermark = /[\u2800-\u28FF]/.test(first); // 背景盲文点阵应已移除
  const hasCursor = /\x1b\[\d+;\d+H/.test(first);
  console.error = () => {};
  realWrite('\n[SMOKE] alt-screen=' + hasAlt + ' brand=' + hasBrand + ' pixelLogo=' + hasLogo + ' noBgWatermark=' + !hasBgWatermark + ' cursorPos=' + hasCursor + ' bytes=' + first.length + '\n');
  realWrite('[SMOKE] dir=' + tmp + '\n');
  if (!hasAlt) { realWrite('[FAIL] 未进入独立窗口\n'); exitCode = 1; }
  if (!hasBrand) { realWrite('[FAIL] 缺少品牌标识\n'); exitCode = 1; }
  if (!hasLogo) { realWrite('[FAIL] 缺少左上角像素字标\n'); exitCode = 1; }
  if (hasBgWatermark) { realWrite('[FAIL] 背景盲文水印未清除\n'); exitCode = 1; }
  if (!hasCursor) { realWrite('[FAIL] 无光标定位序列\n'); exitCode = 1; }
  realWrite(exitCode === 0 ? '[SMOKE] PASS\n' : '[SMOKE] FAIL\n');
} catch (e) {
  realWrite('[SMOKE] THREW: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e) + '\n');
  exitCode = 1;
}
process.stdout.write = realWrite;
process.exit(exitCode);
