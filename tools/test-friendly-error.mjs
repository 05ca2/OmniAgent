// 单元测试：friendlyError —— API 错误体 → 可读中文提示
import { friendlyError } from '../src/llm.js';

let fails = 0;
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => { fails++; console.log('  ✗ ' + m); };
const has = (s, kw) => s.toLowerCase().includes(kw.toLowerCase());

console.log('\n=== 截图中的真实报错 ===');

// 截图 1：限流
const r1 = friendlyError(429, 'Too Many Requests', '{"error":{"message":"inference exceeds tpm/rpm limit","type":"rate_limit_error","code":"429"}}');
console.log('  → ' + r1);
has(r1, '429') ? ok('保留状态码') : fail('缺状态码');
has(r1, '限流') ? ok('翻译出「限流」') : fail('未翻译限流');
has(r1, '并发') ? ok('给出「并发」相关建议') : fail('缺少并发建议');
!r1.includes('"error"') ? ok('不再暴露原始 JSON 结构') : fail('仍暴露原始 JSON');
// 限流时保留原文是有意的（补充「超的是 tpm 还是 rpm」），但必须短
const rawTail = 'inference exceeds tpm/rpm limit';
r1.includes(rawTail) && r1.length <= 200
  ? ok(`限流时保留简短原文补充（总长 ${r1.length} 字符）`)
  : fail(`原文处理不当（长度 ${r1.length}）`);

// 截图 2：无效 token（Invalid token 出现在 message 里，状态码 401）
const r2 = friendlyError(401, 'Unauthorized', '{"error":{"code":"","message":"Invalid token (request id: 2026101002480061601770828268d9d6hgv01EFh)","type":"new_api_error"}}');
console.log('  → ' + r2);
has(r2, '401') ? ok('保留状态码') : fail('缺状态码');
has(r2, 'API Key') ? ok('识别 Invalid token → 提示更新 Key') : fail('未识别 Invalid token');
has(r2, '设置') ? ok('指明去哪里改（设置）') : fail('未指明修改入口');
r2.length < 160 ? ok(`长度可控（${r2.length} 字符）`) : fail(`过长 ${r2.length} 字符`);

console.log('\n=== 其他常见错误 ===');

const cases = [
  [400, 'Bad Request', '{"error":{"message":"invalid request body"}}', ['400', '参数']],
  [404, 'Not Found', '{"error":{"message":"model not found: xxx"}}', ['模型', '不存在']],
  [403, 'Forbidden', '{"error":{"message":"no permission"}}', ['403', '权限']],
  [500, 'Internal Server Error', 'oops', ['500']],
  [503, 'Service Unavailable', '', ['503', '不可用']],
];
for (const [st, stt, body, kws] of cases) {
  const r = friendlyError(st, stt, body);
  console.log(`  ${st} → ${r}`);
  const good = kws.every((k) => has(r, k));
  good ? ok(`HTTP ${st} 正确处理`) : fail(`HTTP ${st} 缺关键词 ${kws.join('/')}：${r}`);
}

console.log('\n=== 边界情况 ===');
// 非 JSON 响应（如网关返回 HTML 错误页）
const rHtml = friendlyError(502, 'Bad Gateway', '<html><body>502 Bad Gateway</body></html>');
console.log('  → ' + rHtml);
has(rHtml, '502') && has(rHtml, '网关') ? ok('HTML 错误页也能处理') : fail('HTML 错误页处理失败');

// 超长 message 应被截断
const rLong = friendlyError(400, 'Bad Request', JSON.stringify({ error: { message: 'x'.repeat(500) } }));
rLong.length <= 200 ? ok(`超长报错已截断（${rLong.length} 字符）`) : fail(`未截断：${rLong.length}`);

// 嵌套 {error:{message:{error:{...}}}} 这种怪结构
const rNest = friendlyError(400, 'Bad Request', '{"error":{"message":{"error":"nested failure"}}}');
console.log('  → ' + rNest);
rNest.length > 0 ? ok('嵌套 message 对象不崩溃') : fail('嵌套结构崩溃');

// 正常响应体不该被误判
const rOk = friendlyError(200, 'OK', '{"choices":[]}');
has(rOk, '200') ? ok('200 正常返回不报错') : fail('200 处理异常');

console.log(fails ? `\n[ERR] FAIL (${fails})\n` : '\n[ERR] PASS\n');
process.exit(fails ? 1 : 0);