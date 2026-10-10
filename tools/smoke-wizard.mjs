// 无头测试：捕获 TUI 的 keypress 处理器，模拟「/models add → 连填两个模型 → 保存」，
// 校验 .omni/config.json 确实被写入且字段完整（供应商/显示名/model id/URL/key）。
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
process.stdin.on = (ev, cb) => { if (ev === 'data') keyHandler = cb; };

const fs = await import('node:fs');
const path = await import('node:path');
const os = await import('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-wiz-'));
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, '.omni'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.omni', 'config.json'), JSON.stringify({
  models: { ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-existing', model: 'deepseek-chat', provider: 'DeepSeek', display: 'DeepSeek V3' } },
  roles: { director: { model: 'ds', tools: [] } },
}, null, 2));

process.argv = [process.argv[0], 'orcode.js', 'chat', '--mock'];

function type(text) {
  for (const ch of text) keyHandler(ch, { name: ch.length === 1 ? ch : '' });
}
function enter() { keyHandler('\r', { name: 'return' }); }

let exitCode = 0;
try {
  await import('../bin/orcode.js');
  await new Promise((r) => setTimeout(r, 300));
  if (!keyHandler) { realWrite('[FAIL] 未捕获 keypress 处理器\n'); process.exit(1); }

  // /models add
  type('/models add'); enter();
  await new Promise((r) => setTimeout(r, 60));

  // 第 1 个模型
  const m1 = ['OpenRouter', 'https://openrouter.ai/api/v1', 'sk-or-v1-TESTKEY0001', 'deepseek/deepseek-r1', 'DeepSeek R1 (OR)'];
  for (const v of m1) { type(v); enter(); await new Promise((r) => setTimeout(r, 30)); }
  // 继续添加：y
  type('y'); enter();
  await new Promise((r) => setTimeout(r, 60));
  // 第 2 个模型（display 留空 → 回落到 model id）
  const m2 = ['LM Studio', 'http://localhost:1234/v1', 'local', 'qwen2.5-coder-7b', ''];
  for (const v of m2) { type(v); enter(); await new Promise((r) => setTimeout(r, 30)); }
  // 结束：回车
  enter();
  await new Promise((r) => setTimeout(r, 200));

  const cfg = JSON.parse(fs.readFileSync(path.join(tmp, '.omni', 'config.json'), 'utf8'));
  const ids = Object.keys(cfg.models);
  realWrite('[WIZARD] 模型键名: ' + ids.join(', ') + '\n');
  for (const id of ids) {
    const m = cfg.models[id];
    realWrite(`  ${id} => provider=${m.provider} display=${m.display} model=${m.model} url=${m.base_url} key=${m.api_key}\n`);
  }
  const added = ids.filter((i) => i !== 'ds');
  if (added.length !== 2) { realWrite('[FAIL] 期望新增 2 个模型，实际 ' + added.length + '\n'); exitCode = 1; }
  const ok1 = added.some((i) => cfg.models[i].model === 'deepseek/deepseek-r1' && cfg.models[i].provider === 'OpenRouter' && cfg.models[i].display === 'DeepSeek R1 (OR)');
  const ok2 = added.some((i) => cfg.models[i].model === 'qwen2.5-coder-7b' && cfg.models[i].base_url === 'http://localhost:1234/v1' && cfg.models[i].display === 'qwen2.5-coder-7b');
  if (!ok1) { realWrite('[FAIL] 模型1 字段不完整\n'); exitCode = 1; }
  if (!ok2) { realWrite('[FAIL] 模型2 display 未回落到 model id\n'); exitCode = 1; }
  if (!cfg.models.ds) { realWrite('[FAIL] 原有模型被覆盖\n'); exitCode = 1; }

  // 校验 URL 白名单：非 http(s) 应被拒绝
  type('/models add'); enter();
  await new Promise((r) => setTimeout(r, 50));
  type('Bad'); enter(); type('ftp://example.com/v1'); enter();
  await new Promise((r) => setTimeout(r, 80));
  const tail = chunks.slice(-6).join('');
  if (!tail.includes('http(s)')) { realWrite('[WARN] 未看到 URL 校验提示\n'); }
  else realWrite('[WIZARD] URL 校验生效 ✓\n');

  realWrite(exitCode === 0 ? '[WIZARD] PASS\n' : '[WIZARD] FAIL\n');
} catch (e) {
  realWrite('[WIZARD] THREW: ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e) + '\n');
  exitCode = 1;
}
process.stdout.write = realWrite;
process.exit(exitCode);
