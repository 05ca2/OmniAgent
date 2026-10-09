// 编排器：Director 拆解 -> Planner 规划 -> Workers 多岗位执行 -> Verifier 检验（含补做回路）
import { runAgent } from './agents.js';
import { parseJSON, truncate, mapLimit } from './util.js';

function buildEnv(cfg, plugins, ctx, mock, trace) {
  return { cfg, plugins, ctx, mock, trace };
}

function buildVerifyPrompt(task, results, round) {
  const summary = results.map((r, i) =>
    `步骤${i + 1} [${r.role}] ${r.instruction}\n结论:\n${truncate(r.result, 800)}`
  ).join('\n\n');
  return `【原始用户任务】\n${task}\n\n【各岗位交付结果】\n${summary}\n\n这是第 ${round + 1} 轮核查，请判断是否真正完成。`;
}

export async function runPipeline(task, cfg, plugins, ctx, mock = false, trace) {
  const T = trace || {};
  const env = buildEnv(cfg, plugins, ctx, mock, trace);
  const stages = cfg.pipeline?.stages || ['director', 'planner', 'workers', 'verifier'];
  const maxWorkers = cfg.pipeline?.max_workers || 1;
  const verifyRounds = cfg.pipeline?.verify_rounds || 2;

  let dirJson = null;
  let planJson = null;
  const results = [];

  // 1) Director 拆解（发现关键不确定点时，可先发澄清问卷）
  if (stages.includes('director') && cfg.roles.director) {
    const CLARIFY_RULE = '\n\n【重要】若任务存在影响拆解的关键不确定点（目标/范围/技术栈/平台/优先级等），先不要拆解，改为输出：\n{"need_clarification": true, "questions": ["问题1", "问题2", ...]}\n（问题不超过 5 个，只问真正影响方案的；没有不确定点就直接输出拆解 JSON）';
    T.stage?.('指挥 Director', '把任务拆成工作项');
    let out = await runAgent(cfg.roles.director, `用户任务：\n${task}${CLARIFY_RULE}`, env, { streamTokens: false });
    dirJson = parseJSON(out);
    // 澄清回路：把用户逐题回答的答案拼回任务，重新拆解
    if (dirJson?.need_clarification && Array.isArray(dirJson.questions) && dirJson.questions.length && typeof T.clarify === 'function') {
      T.stage?.('澄清 Clarify', `${dirJson.questions.length} 个问题需要确认`);
      const answers = await T.clarify(dirJson.questions);
      const supplement = dirJson.questions.map((q, i) => `问：${q}\n答：${answers?.[i] ?? '（未回答）'}`).join('\n');
      T.info?.('已收到补充说明，重新拆解任务');
      out = await runAgent(cfg.roles.director, `用户任务：\n${task}\n\n用户补充说明：\n${supplement}\n\n请基于以上信息完成拆解（若已足够清晰，直接输出拆解 JSON）。`, env, { streamTokens: false });
      dirJson = parseJSON(out);
    }
    T.result?.('总览', dirJson.overview || '(无)');
    (dirJson.items || []).forEach((it) => T.info?.(`· [${it.role}] ${it.title} —— ${it.goal}`));
  }

  // 2) Planner 规划
  if (stages.includes('planner') && cfg.roles.planner) {
    T.stage?.('规划 Planner', '制定顺序执行计划');
    const ctx2 = dirJson ? `原始任务：\n${task}\n\n指挥拆解：\n${JSON.stringify(dirJson)}\n请产出顺序执行计划。` : `原始任务：\n${task}\n请直接产出执行计划。`;
    const out = await runAgent(cfg.roles.planner, ctx2, env, { streamTokens: false });
    planJson = parseJSON(out);
    (planJson.plan || []).forEach((s, i) => T.info?.(`${i + 1}. [${s.role}] ${s.instruction}`));
  }

  // 3) Workers 多岗位并行/顺序执行
  if (stages.includes('workers')) {
    const steps = (planJson?.plan) || [{ role: 'coder', instruction: task }];
    if (!planJson) T.stage?.('执行 Workers', '无规划，直接执行主任务');
    else T.stage?.('执行 Workers', `多岗位协作（并发=${maxWorkers}）`);
    const execOne = async (step) => {
      const role = cfg.roles[step.role] || cfg.roles.coder || Object.values(cfg.roles)[0];
      if (!role) throw new Error('找不到岗位: ' + step.role);
      T.step?.(step.role, step.instruction);
      const r = await runAgent(role, `整体任务：${task}\n你的步骤指令：${step.instruction}`, env);
      return { role: step.role, instruction: step.instruction, result: r };
    };
    const done = await mapLimit(steps, maxWorkers, execOne);
    results.push(...done);
  }

  // 4) Verifier 检验 + 补做回路
  let verdict = null;
  if (stages.includes('verifier') && cfg.roles.verifier) {
    for (let round = 0; round < verifyRounds; round++) {
      T.stage?.('检验 Verifier', `第 ${round + 1}/${verifyRounds} 轮核查`);
      const out = await runAgent(cfg.roles.verifier, buildVerifyPrompt(task, results, round), env, { streamTokens: false });
      verdict = parseJSON(out);
      T.result?.('结论', `${verdict.passed ? '通过' : '未通过'} · 评分 ${verdict.score ?? '-'} · ${verdict.verdict || ''}`);
      if (verdict.passed) break;
      T.gaps?.(verdict.gaps);
      if (round < verifyRounds - 1) {
        const fixRole = cfg.roles.coder || cfg.roles[results[results.length - 1]?.role];
        T.info?.('→ 派发补做任务给研发岗位');
        const fix = await runAgent(fixRole, `对照原始任务发现的未完成项，请补齐：\n${(verdict.gaps || []).join('\n')}\n\n原始任务：${task}`, env);
        results.push({ role: fixRole.id || 'coder', instruction: '补齐缺口', result: fix });
      }
    }
  }

  T.done?.({ dirJson, planJson, results, verdict });
  return { dirJson, planJson, results, verdict };
}
