// 无头测试：模型「工作时」仍可输入并排队 + 双击 esc 中断 + 忙碌行思考进度
const chunks = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => { chunks.push(String(s)); return true; };
process.stdout.isTTY = true;
process.stdout.columns = 110;
process.stdout.rows = 40;
process.stdin.isTTY = true;
process.stdin.setRawMode = () => {};
process.stdin.resume = () => {};
process.stdin.pause = () => {};
process.stdin.removeListener = () => {};
process.stdin.once = () => {};
let dataHandler = null;
process.stdin.on = (ev, cb) => { if (ev === 'data') dataHandler = cb; };

const fs = await import('node:fs');
const path = await import('node:path');
const os = await import('node:os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-keys-'));
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, '.omni'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.omni', 'config.json'), JSON.stringify({
  models: { ds: { base_url: 'mock://', api_key: 'local', model: 'm', provider: 'Mock', display: 'Mock' } },
  roles: { director: { id: 'director', model: 'ds', tools: [] }, planner: { id: 'planner', model: 'ds', tools: [] }, worker1: { id: 'worker1', model: 'ds', tools: [] }, verifier: { id: 'verifier', model: 'ds', tools: [] } },
}, null, 2));
process.argv = [process.argv[0], 'omni.js', 'chat', '--mock'];

const feed = (s) => dataHandler(Buffer.from(s, 'utf8'));
const type = (t) => feed(t);
const enter = () => feed('\r');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let exitCode = 0;
const fail = (m) => { realWrite('[FAIL] ' + m + '\n'); exitCode = 1; };
const ok = (m) => realWrite('  ✓ ' + m + '\n');

try {
  await import('../bin/omni.js');
  await sleep(300);
  if (!dataHandler) { realWrite('[FAIL] 未捕获 data 处理器\n'); process.exit(1); }

  // --- 1) 忙碌中输入并排队（同步 tick 内派发，busy 仍为 true）---
  type('写一个贪吃蛇'); enter();
  type('再来一个任务'); enter(); // busy 中回车 → 排队
  esc();          // 第 1 次 esc（孤 esc → 60ms 定时器）
  feed('\x1b\x1b'); // 紧接着再按一次（同步，busy 仍为 true）→ 触发中断
  await sleep(400); // 等定时器 + 流水线收尾
  const o = chunks.join('');
  const q1 = o.includes('已排队');
  const q2 = o.includes('再按一次 esc');
  const q3 = o.includes('正在中断') || o.includes('已中断');
  const q4 = o.includes('推理中') || o.includes('工作中') || o.includes('Thought');
  realWrite(`[KEYS] 排队=${q1} 单击esc提示=${q2} 双击中断=${q3} 思考进度行=${q4}\n`);
  if (!q1) fail('忙碌时回车未排队');
  if (!q2) fail('单击 esc 未提示');
  if (!q3) fail('双击 esc 未中断');
  realWrite(exitCode === 0 ? '[KEYS] PASS\n' : '[KEYS] FAIL\n');
} catch (e) {
  realWrite('[KEYS] THREW: ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e) + '\n');
  exitCode = 1;
}
process.stdout.write = realWrite;
process.exit(exitCode);
function esc() { feed('\x1b'); }
