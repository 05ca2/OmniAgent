// OpenAI 兼容大模型客户端：支持流式输出 + tool calling，并内置 mock 模式
// 兼容：OpenAI / DeepSeek / OpenRouter / Ollama / vLLM / 通义 / 智谱 / 月之暗面 等

// 把各家 API 的错误体翻译成人话：优先读 error.message，其次解析嵌套结构，最后退回原文摘要
export function friendlyError(status, statusText, rawText) {
  const raw = String(rawText || '').trim();
  let msg = '';
  let code = '';
  let type = '';
  try {
    const j = JSON.parse(raw);
    const e = j.error || j;
    msg = e.message || e.msg || e.detail || (typeof e === 'string' ? e : '');
    code = e.code != null ? String(e.code) : (j.code != null ? String(j.code) : '');
    type = e.type || j.type || '';
    // 部分网关把错误包成 {errors:[...]}，或 message 本身还是对象
    if (!msg && Array.isArray(j.errors) && j.errors.length) msg = j.errors[0]?.message || j.errors[0]?.detail || '';
    if (!msg && e.message && typeof e.message === 'object') msg = e.message.error || '';
  } catch { /* 非 JSON，走原文处理 */ }

  const s = status || 0;
  const hint = {
    400: '请求格式或参数不被该接口接受',
    401: 'API Key 无效或已过期 —— 请在设置里重新填写该模型的密钥',
    403: '没有访问该模型的权限 —— 密钥所属账号未被授权，或模型名写错',
    404: '接口地址或模型名不存在 —— 检查 base_url 是否完整（通常需含 /v1）与 model 拼写',
    413: '请求内容过长 —— 上下文超出该模型限制',
    422: '参数校验失败 —— 常见于 tool schema 不被该服务商支持',
    429: '触发限流 —— 每分钟请求数或 token 数超限；多模型并发时尤其容易触发，可减少并发数或换额度更高的 Key',
    500: '服务商内部错误 —— 可稍后重试',
    502: '网关错误 —— 服务商暂时不可用，稍后重试',
    503: '服务暂不可用 —— 模型过载或维护中，稍后重试',
  }[s] || '';

  // 关键词命中优先（比状态码更精准）
  const low = `${msg} ${raw}`.toLowerCase();
  let extra = '';
  if (/invalid token|unauthorized|authentication_error|invalid api key|incorrect api key|invalid_api_key/.test(low)) {
    extra = 'API Key 无效或已过期 —— 点右下角「设置」更新该模型的密钥';
  } else if (/tpm\/rpm|rate_limit|too many requests|rate limit exceeded/.test(low)) {
    extra = '触发限流 —— 每分钟请求数或 token 数超限；多模型并发时尤其容易触发，可 /settings 调低并发数或换额度更高的 Key';
  } else if (/context length|maximum context|too many tokens|context_length_exceeded/.test(low)) {
    extra = '上下文超长 —— 减少对话历史或把任务拆小';
  } else if (/model_not_found|does not exist|model not found|no such model/.test(low)) {
    extra = '该模型名在当前服务商下不存在 —— 检查 model 拼写';
  } else if (/insufficient|quota|billing|余额|欠费|arrear/.test(low)) {
    extra = '账户余额或额度不足';
  }

  const parts = [`HTTP ${s}${statusText ? ' ' + statusText : ''}`];
  if (extra) parts.push(extra);
  else if (hint) parts.push(hint);
  if (msg && msg !== extra && msg.length <= 120) parts.push(msg);
  else if (msg && msg.length > 120) parts.push(msg.slice(0, 120) + '…');
  else if (!msg && raw && raw.length <= 160) parts.push(raw);
  if (code && code !== String(s)) parts.push(`code=${code}`);
  if (type && !extra) parts.push(`type=${type}`);
  return parts.join(' · ');
}

export async function chatCompletion(model, messages, tools = [], opts = {}) {
  if (opts.mock || model.base_url === 'mock://') {
    return mockChat(model, messages, tools, opts);
  }
  const base = (model.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model: model.model,
    messages,
    stream: !!opts.stream,
  };
  if (model.temperature != null) body.temperature = model.temperature;
  if (model.max_tokens != null) body.max_tokens = model.max_tokens;
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const headers = { 'content-type': 'application/json' };
  if (model.api_key) headers['authorization'] = `Bearer ${model.api_key}`;

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(friendlyError(res.status, res.statusText, txt));
  }

  if (!opts.stream) {
    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    const rc = msg.reasoning_content || msg.reasoning;
    if (rc && opts.onReason) opts.onReason(rc);
    return { content: msg.content || '', tool_calls: normalizeToolCalls(msg.tool_calls) };
  }
  return consumeStream(res, opts.onToken, opts);
}

function normalizeToolCalls(tcs) {
  if (!tcs) return [];
  return tcs.map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tc.function?.arguments || '{}',
  }));
}

async function consumeStream(res, onToken, opts = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolAcc = new Map();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json.choices?.[0]?.delta || {};
      // 推理内容流（DeepSeek R1 / OpenRouter 等推理模型通过 reasoning_content / reasoning 下发）
      const rc = delta.reasoning_content || delta.reasoning;
      if (rc && opts.onReason) opts.onReason(rc);
      if (delta.content) {
        content += delta.content;
        if (onToken) onToken(delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const id = tc.id || 'call_' + toolAcc.size;
          if (!toolAcc.has(id)) toolAcc.set(id, { name: '', args: '' });
          const cur = toolAcc.get(id);
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
        }
      }
    }
  }
  const tool_calls = [...toolAcc.entries()].map(([id, v]) => ({
    id, name: v.name, arguments: v.args || '{}',
  }));
  return { content, tool_calls };
}

// ---------- mock 模式：无需真实密钥即可演示整条编排流水线 ----------
// 用 opts.mockRole（岗位 id）判定角色，避免关键词误判
function mockChat(model, messages, tools, opts) {
  const last = messages[messages.length - 1]?.content || '';
  const kind = opts.mockRole;
  let content;
  if (kind === 'director') {
    // mock 澄清演示：任务带 [clarify] 标记且尚未回答时，先返回澄清问卷
    if (last.includes('[clarify]') && !last.includes('用户补充说明')) {
      content = JSON.stringify({
        need_clarification: true,
        questions: ['这个任务的目标平台是什么？（Web / 桌面 / 移动）', '期望的完成标准是什么？'],
      });
    } else {
      content = JSON.stringify({
        overview: '（mock）将任务拆为「调研」与「实现」两步',
        items: [
          { title: '调研资料', role: 'researcher', goal: '收集完成任务所需的资料' },
          { title: '编写产物', role: 'coder', goal: '编写并验证最终产物' },
        ],
      });
    }
  } else if (kind === 'planner') {
    content = JSON.stringify({
      plan: [
        { role: 'researcher', instruction: `调研：${last.slice(0, 80)}`, depends_on: [] },
        { role: 'coder', instruction: `实现：${last.slice(0, 80)}`, depends_on: ['researcher'] },
      ],
    });
  } else if (kind === 'verifier') {
    content = JSON.stringify({ passed: true, score: 88, gaps: [], verdict: '（mock）经核查，任务已完成' });
  } else {
    content = `（mock 模型 ${model.model}）已处理该步骤：\n${last.slice(0, 220)}\n[工具调用与执行过程已略]`;
  }
  if (opts.onToken) opts.onToken(content);
  return { content, tool_calls: [] };
}
