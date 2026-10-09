// 无头综合测试（基于 __OMNI_TEST 状态断言）：
// 单模型默认模式 / /hoa-loop 多模型协作 / 子会话分流 / 澄清问卷 / 详情页 / 鼠标点击 / 最终输出配色
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
process.env.OMNI_TEST = '1';

const fs = await import('node:fs');
const path = await import('node:path');
const os = await import('node:os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-subs-'));
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, '.omni'), { recursive: true });
const R = (id) => ({ id, model: 'ds', tools: [] });
fs.writeFileSync(path.join(tmp, '.omni', 'config.json'), JSON.stringify({
  models: { ds: { base_url: 'mock://', api_key: 'local', model: 'mock-model', provider: 'Mock', display: 'Mock M1' } },
  roles: { director: R('director'), planner: R('planner'), researcher: R('researcher'), coder: R('coder'), verifier: R('verifier') },
  pipeline: { stages: ['director', 'planner', 'workers', 'verifier'], max_workers: 1, verify_rounds: 1 },
}, null, 2));
process.argv = [process.argv[0], 'omni.js', 'chat', '--mock'];

const feed = (s) => dataHandler(Buffer.from(s, 'utf8'));
const type = (t) => feed(t);
const enter = () => feed('\r');
const escKey = () => feed('\x1b'); // 孤 esc（60ms 定时器判定）
const mouse = (col, row) => feed(`\x1b[<0;${col};${row}M`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => globalThis.__OMNI_TEST.getState();

let exitCode = 0;
const fail = (m) => { realWrite('[FAIL] ' + m + '\n'); exitCode = 1; };
const ok = (m) => realWrite('  ✓ ' + m + '\n');

try {
  await import('../bin/omni.js');
  await sleep(300);
  if (!dataHandler || !globalThis.__OMNI_TEST) { realWrite('[FAIL] 初始化失败\n'); process.exit(1); }

  // ===== 0) 单模型默认模式：普通输入不应进入多模型流水线 =====
  type('用一句话介绍你自己'); enter();
  await sleep(300);
  let st = state();
  if (st.subs.length === 0) ok('普通输入 = 单模型（无子会话）'); else fail('普通输入误建子会话');
  if (st.transcript.some((l) => l.includes('━━ 最终输出 ━━')) && st.transcript.some((l) => l.includes('已处理该步骤'))) ok('单模型最终输出块已渲染'); else fail('单模型输出缺失');
  if (!st.transcript.some((l) => l.includes('开启子会话'))) ok('单模型不产生流水线事件'); else fail('单模型产生了流水线事件');

  type('/clear'); enter(); // 隔离：清空单模型对话记录，避免干扰多模型断言
  await sleep(120);

  // ===== 1) /hoa-loop 多模型协作 + 澄清问卷（mock [clarify] 任务）=====
  type('/hoa-loop 做一个多人在线贪吃蛇 [clarify]'); enter();
  await sleep(140);
  st = state();
  if (st.clar && st.transcript.some((l) => l.includes('需要澄清') && l.includes('2 个问题'))) ok('澄清问卷弹出（逐题）'); else fail('澄清问卷未弹出');
  type('Web 浏览器'); enter();
  await sleep(60);
  type('51/51 测试通过'); enter();
  await sleep(320);
  st = state();
  const ans1 = st.transcript.some((l) => l.includes('→ Web 浏览器'));
  const ans2 = st.transcript.some((l) => l.includes('→ 51/51 测试通过'));
  if (ans1 && ans2) ok('逐题回答已记录'); else fail('澄清答案未记录');
  if (st.transcript.some((l) => l.includes('澄清完成，指挥继续拆解'))) ok('回答后流水线继续'); else fail('流水线未继续');
  if (!st.busy && !st.clar) ok('流水线已结束'); else fail('流水线未结束');

  // ===== 2) 子会话分流 =====
  const all = st.transcript.join('\n');
  const titles = st.subs.map((s) => s.title);
  for (const t of ['规划 · Planner', '执行 · researcher', '执行 · coder', '检验 · Verifier']) {
    if (titles.includes(t)) ok('子会话已建立 ' + t); else fail('缺少子会话 ' + t);
  }
  const subsDump = st.subs.map((s) => s.title + '\n' + s.lines.join('\n')).join('\n');
  const finIdx = st.transcript.findIndex((l) => l.includes('最终输出'));
  const preFinal = st.transcript.slice(0, finIdx).join('\n');
  if (subsDump.includes('已处理该步骤') && !preFinal.includes('已处理该步骤')) ok('工作过程只在子会话，主会话干净'); else fail('工作过程分流失败');
  if (titles.includes('规划 · Planner') && st.subs.find((s) => s.title === '规划 · Planner').lines.some((l) => l.includes('调研：'))) ok('规划过程在子会话内'); else fail('规划子会话内容缺失');
  if (all.includes('━━ 最终输出 ━━') && all.includes('核查：✅ 通过')) ok('最终输出块已渲染（含核查结论）'); else fail('缺最终输出块');
  if (all.includes('⇒ 命令 [')) ok('主会话显示指挥下达的命令'); else fail('主会话缺命令行');
  if (st.transcript.some((l) => l.includes('✽ Thought:'))) ok('思考耗时落进会话流'); else fail('缺 Thought 行');

  // ===== 3) /open 打开详情页 + esc 返回 =====
  type('/open 2'); enter();
  await sleep(100);
  st = state();
  if (st.view) ok('/open 2 打开详情页（view=' + st.view + '）'); else fail('详情页未打开');
  escKey();
  await sleep(150);
  st = state();
  if (!st.view) ok('esc 返回主会话'); else fail('esc 未返回');

  // ===== 4) 鼠标点击右栏子会话 → 详情页 =====
  let opened = -1;
  for (let row = 1; row <= 38; row++) {
    mouse(90, row);
    await sleep(8);
    if (state().view) { opened = row; break; }
  }
  if (opened > 0) ok(`点击右栏第 ${opened} 行打开子会话详情`); else fail('点击子会话无效');
  escKey();
  await sleep(150);
  if (!state().view) ok('esc 退出详情页'); else fail('esc 未退出详情页');

  // ===== 5) 右下角设置点击 → 设置页 → 添加模型向导 =====
  mouse(105, 39);
  await sleep(80);
  st = state();
  if (st.settings) ok('右下角设置点击打开设置页'); else fail('设置入口点击无效');
  const addZ = st.zones.filter((z) => z.t === 'set').sort((a, b) => a.y1 - b.y1)[0];
  mouse(2, addZ ? addZ.y1 : 3); // 设置页首行 = ＋ 添加模型
  await sleep(80);
  st = state();
  if (st.mw) ok('设置页点击「添加模型」打开向导'); else fail('添加模型入口无效');
  escKey();
  await sleep(120);
  if (!state().mw) ok('esc 取消向导'); else fail('向导未取消');

  // ===== 6) 命令弹层点击 → 直接执行（/models 现在打开 Select model 小窗，改用 /clear 验证）=====
  type('/'); // 打开命令弹层
  await sleep(60);
  st = state();
  const cz = st.zones.find((z) => z.t === 'cmd' && z.act && z.act.cmd === '/clear');
  mouse(5, cz ? cz.y1 : 30);
  await sleep(80);
  if (!state().transcript.length) ok('点击命令弹层直接执行（/clear 清屏）'); else fail('命令弹层点击无效');
  // 6b) /models 回车 → 打开 Select model 小窗（出现 pick 热区）
  type('/models');
  await sleep(60);
  enter();
  await sleep(120);
  if (state().zones.some((z) => z.t === 'pick')) ok('/models 打开选择模型小窗'); else fail('/models 未打开小窗');
  escKey();
  await sleep(120);

  realWrite(exitCode === 0 ? '\n[SUBS] PASS\n' : '\n[SUBS] FAIL\n');
} catch (e) {
  realWrite('[SUBS] THREW: ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e) + '\n');
  exitCode = 1;
}
process.stdout.write = realWrite;
process.exit(exitCode);
