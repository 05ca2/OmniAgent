// OpenAI 兼容大模型客户端：支持流式输出 + tool calling，并内置 mock 模式
// 兼容：OpenAI / DeepSeek / OpenRouter / Ollama / vLLM / 通义 / 智谱 / 月之暗面 等

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

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`LLM 请求失败 ${res.status} ${res.statusText}: ${txt.slice(0, 600)}`);
  }

  if (!opts.stream) {
    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    return { content: msg.content || '', tool_calls: normalizeToolCalls(msg.tool_calls) };
  }
  return consumeStream(res, opts.onToken);
}

function normalizeToolCalls(tcs) {
  if (!tcs) return [];
  return tcs.map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tc.function?.arguments || '{}',
  }));
}

async function consumeStream(res, onToken) {
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
    content = JSON.stringify({
      overview: '（mock）将任务拆为「调研」与「实现」两步',
      items: [
        { title: '调研资料', role: 'researcher', goal: '收集完成任务所需的资料' },
        { title: '编写产物', role: 'coder', goal: '编写并验证最终产物' },
      ],
    });
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
