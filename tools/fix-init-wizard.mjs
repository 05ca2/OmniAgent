// 问卷式 init 改造：替换输入辅助函数 + init 交互块
import fs from 'node:fs';

const FILE = 'bin/omni.js';
let src = fs.readFileSync(FILE, 'utf8');

const HELPERS = `// ---- 问卷式输入辅助（全部基于 readline，粘贴/中文/退格均可靠）----
const MUTE_OUT = new Writable({ write(_c, _e, cb) { cb(); } }); // 吞掉回显，用于密钥输入

// 询问一题；no/total 显示 [1/4] 编号；secret=true 不回显
function askQ(no, total, q, { def = '', secret = false } = {}) {
  return new Promise((res) => {
    const prefix = total ? '[' + no + '/' + total + '] ' : '';
    const suffix = def ? ' (' + def + ')' : '';
    process.stdout.write(prefix + q + suffix + (secret ? '（输入不回显）' : '') + ': ');
    const rl = readline.createInterface({ input: process.stdin, output: secret ? MUTE_OUT : process.stdout, terminal: true });
    rl.question('', (a) => {
      rl.close();
      if (secret) process.stdout.write('(已录入)\\n');
      res(a.trim() || def);
    });
  });
}

`;

const INIT_BLOCK = `  if (cmd === 'init') {
    const name = flags.preset || 'full';
    if (configExists() && !flags.force) { ui.warn('.omni/config.json 已存在，用 --force 覆盖'); return; }
    ensureDirs();
    const cfg = buildConfigFromPreset(name);
    cfg.registryUrl = 'http://localhost:8080/plugins.json';

    if (process.stdin.isTTY) {
      ui.header(\`初始化 OmniAgent（预设 \${name}）\`);
      ui.info('请依次回答以下问题（直接回车 = 使用括号中的默认值）：');
      console.log('');
      const base = await askQ(1, 4, 'API base_url', { def: 'https://api.openai.com/v1' });
      const key = await askQ(2, 4, 'API key', { secret: true });
      const model = await askQ(3, 4, '模型名', { def: 'gpt-4o-mini' });
      console.log('');
      ui.info('—— 请确认 ——');
      ui.info(\`base_url: \${base}\`);
      ui.info(\`模型名:   \${model}\`);
      ui.info(\`API key:  \${maskKey(key)}\`);
      console.log('');
      const okc = await askQ(4, 4, '确认写入以上配置？', { def: 'Y' });
      console.log('');
      if (!/^y(es)?$/i.test(okc.trim())) { ui.warn('已取消，未写入任何配置。'); return; }
      if (!key) ui.warn('API key 为空：界面可进入但调用模型会失败，可先 /mock 体验演示模式，或重跑 init 补填。');
      for (const m of Object.values(cfg.models)) { m.base_url = base; m.api_key = key; m.model = model; }
      saveConfig(cfg);
      ui.ok(\`配置已写入：\${CONFIG_PATH}\`);
    } else {
      saveConfig(cfg);
      ui.ok(\`已生成配置（预设 \${name}）→ \${CONFIG_PATH}\`);
      ui.info('请将 models.*.api_key 替换为你的密钥，或在终端中重跑 omniagent init 交互式填写。');
    }
    ui.ok('初始化完成 ✓  直接运行  omniagent  即可进入界面（无需任何参数）。');
    return;
  }
`;

// 1) 替换输入辅助函数区（从标记注释到 parseFlags 之前）
const hStart = src.indexOf('// ---- 交互式输入辅助');
const hEnd = src.indexOf('function parseFlags');
if (hStart < 0 || hEnd < 0 || hEnd < hStart) { console.error('锚点缺失：辅助函数区'); process.exit(1); }
src = src.slice(0, hStart) + HELPERS + src.slice(hEnd);

// 2) 替换 init 块（从 if (cmd === 'init') 到 if (cmd === 'preset') 之前）
const iStart = src.indexOf("  if (cmd === 'init') {");
const iEnd = src.indexOf("  if (cmd === 'preset') {");
if (iStart < 0 || iEnd < 0 || iEnd < iStart) { console.error('锚点缺失：init 块'); process.exit(1); }
src = src.slice(0, iStart) + INIT_BLOCK + '\n' + src.slice(iEnd);

// 3) 确保 Writable 已导入
if (!src.includes("from 'node:stream'")) {
  src = src.replace("import readline from 'node:readline';", "import readline from 'node:readline';\nimport { Writable } from 'node:stream';");
}

fs.writeFileSync(FILE, src);
console.log('补丁完成：askQ 问卷式输入 + init 交互块');
