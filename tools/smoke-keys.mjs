// 无头测试：模型「工作时」仍可输入并排队 + 双击 esc 中断。
// 关键：在 submit 之后的同一个同步 tick 内派发按键，此时 busy 仍为 true（await 只是微任务）。
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
process.stdin.removeListener = () => {};
process.stdin.once = () => {};

let keyHandler = null;
process.stdin.on = (ev, cb) => { if (ev === 'keypress') keyHandler = cb; };

const fs = await import('node:fs');
const path = await import('node:path');
const os = await import('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-keys-'));
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, '.omni'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.omni', 'config.json'), JSON.stringify({
  models: { ds: { base_url: 'mock://', api_key: 'local', model: 'm', provider: 'Mock', display: 'Mock' } },
  roles: { director: { model: 'ds', tools: [] }, planner: { model: 'ds', tools: [] }, worker1: { model: 'ds', tools: [] }, verifier: { model: 'ds', tools: [] } },
}, null, 2));

process.argv = [process.argv[0], 'omni.js', 'chat', '--mock'];

function type(t) { for (const ch of t) keyHandler(ch, { name: ch }); }
const enter = () => keyHandler('\r', { name: 'return' });
const esc = () => keyHandler('\x1b', { name: 'escape' });

let exitCode = 0;
try {
  await import('../bin/omni.js');
  await new Promise((r) => setTimeout(r, 300));

  // --- 1) 忙碌中输入并排队 ---
  type('写一个贪吃蛇'); enter();
  type('再来一个任务'); enter();   // busy 中回车 → 排队
  esc();                          // 单击 → 提示
  esc();                          // 双击 → 中断
  await new Promise((r) => setTimeout(r, 500));

  const all = chunks.join('');
  const q1 = all.includes('已排队');
  const q2 = all.includes('再按一次 esc');
  const q3 = all.includes('正在中断') || all.includes('已中断');
  const q4 = all.includes('推理中') || all.includes('工作中') || all.includes('Thought');
  realWrite(`[KEYS] 排队=${q1} 单击esc提示=${q2} 双击中断=${q3} 思考进度行=${q4}\n`);
  if (!q1) { realWrite('[FAIL] 忙碌时回车未排队\n'); exitCode = 1; }
  if (!q2) { realWrite('[FAIL] 单击 esc 未提示\n'); exitCode = 1; }
  if (!q3) { realWrite('[FAIL] 双击 esc 未中断\n'); exitCode = 1; }
  realWrite(exitCode === 0 ? '[KEYS] PASS\n' : '[KEYS] FAIL\n');
} catch (e) {
  realWrite('[KEYS] THREW: ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e) + '\n');
  exitCode = 1;
}
process.stdout.write = realWrite;
process.exit(exitCode);
