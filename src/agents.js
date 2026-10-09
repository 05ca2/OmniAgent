// 岗位(role) -> 可调用工具的 agentic 循环：思考 -> 调工具 -> 回填 -> 再思考
import { chatCompletion } from './llm.js';
import { resolveTools, toOpenAI } from './plugins/index.js';

const MAX_ITER = 14;

function safeParse(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

// 运行单个岗位处理一段 userContent，返回最终文本结论
// env.trace 用于把进度事件发给调用方（终端 or Web SSE）
// opts.streamTokens=false 时屏蔽模型原始 token 流（用于 Director/Planner/Verifier 这类
// 产出结构化 JSON 供流水线内部消费的阶段，避免把机器数据刷到终端/网页上）
export async function runAgent(role, userContent, env, opts = {}) {
  const streamTokens = opts.streamTokens !== false;
  const { cfg, plugins, ctx, mock, trace } = env;
  const T = trace || {};
  const model = cfg.models[role.model];
  if (!model) throw new Error(`岗位「${role.name || role.id}」引用的模型「${role.model}」未配置`);
  const tools = resolveTools(role.tools, plugins, ctx);
  const oaTools = tools.map(toOpenAI);

  const messages = [
    { role: 'system', content: role.system || '你是一个助手。' },
    { role: 'user', content: userContent },
  ];

  for (let i = 0; i < MAX_ITER; i++) {
    T.think?.(role, '调用 ' + model.model + (tools.length ? ' · 工具:' + tools.map((t) => t.name).join(',') : ''));
    const r = await chatCompletion(model, messages, oaTools, {
      stream: !mock,
      mock,
      mockRole: role.id,
      onToken: streamTokens ? (t) => T.token?.(t, role.id) : undefined,
      // 推理进度始终透传（即便 token 流被屏蔽的结构化阶段），供界面实时展示思考进度
      onReason: (t) => T.reason?.(t, role.id),
    });
    if (!mock) T.end?.();

    messages.push({
      role: 'assistant',
      content: r.content || '',
      tool_calls: r.tool_calls.map((tc) => ({
        id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    if (!r.tool_calls.length) return r.content;

    for (const tc of r.tool_calls) {
      const tool = tools.find((t) => t.name === tc.name);
      let out;
      try {
        const args = safeParse(tc.arguments);
        out = tool ? await tool.execute(args, ctx) : `未知工具: ${tc.name}`;
      } catch (e) {
        out = `工具执行出错: ${e.message}`;
      }
      T.tool?.(tc.name, safeParse(tc.arguments), out, role.id);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
    }
  }
  return '（达到最大步数，已停止）';
}
