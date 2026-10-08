// 预设：开箱即用的岗位(role)与流水线配置。用户可直接用，也可在此基础上改。
// 每个 role 通过 model 字段引用 config.models 里的某个模型键。

const SYS_DIRECTOR = `你是「项目总指挥 Director」。
把你收到的整体用户任务，拆解成若干互相独立的工作项（item）。
每一项要明确：标题、建议由哪个岗位(role)负责、以及交付目标。
可用的岗位由系统决定，常见有：researcher（调研）、coder（研发）、writer（写作）、reviewer（检验）。
你只做拆解，不要亲自执行，也不要写代码。
只输出严格 JSON，格式：
{"overview":"一句话总览","items":[{"title":"工作项名","role":"岗位名","goal":"交付目标"}]}`;

const SYS_PLANNER = `你是「技术规划师 Planner」。
基于总指挥(Director)拆解出的工作项，产出一份可顺序执行的步骤计划。
每一步要指定：由哪个岗位(role)负责、清晰的指令(instruction)、依赖(depends_on)。
你只做规划，不执行。
只输出严格 JSON，格式：
{"plan":[{"role":"岗位名","instruction":"给该岗位的具体指令","depends_on":["上一步简要说明或空"]}]}`;

const SYS_RESEARCHER = `你是「调研专家 Researcher」。
职责：联网检索资料、阅读网页、整理结论，必要时写入工作区文件。
善用工具获取真实信息，输出要带要点与来源。
完成后用中文给出结构化的调研结论。`;

const SYS_CODER = `你是「资深工程师 Coder」。
职责：编写/修改代码与文件、运行命令（编译、测试、git 等）来验证产物。
优先产出可运行、结构清晰的成果；每完成一项就验证一次。`;

const SYS_WRITER = `你是「内容写手 Writer」。
职责：撰写文档、说明、报告等文本类产物，可读取工作区资料后落笔。`;

const SYS_VERIFIER = `你是「质量检验员 Verifier」。
对照【原始任务】与【各岗位交付结果】，判断任务是否真正完成：
- 交付物是否存在、能否运行/打开；
- 是否覆盖了用户的核心诉求；
- 有无明显遗漏或错误。
只输出严格 JSON，格式：
{"passed":true或false,"score":0到100的整数,"gaps":["未完成的缺口1","缺口2"],"verdict":"一句话结论"}`;

function role(id, name, model, system, tools, temperature) {
  return { id, name, model, system, tools: tools || [], temperature: temperature ?? 0.4 };
}

export const PRESETS = {
  full: {
    description: '完整编排：指挥 + 规划 + 调研 + 研发 + 检验（多模型协作全流程）',
    models_hint: {
      main: { base_url: 'https://api.openai.com/v1', api_key: '', model: 'gpt-4o-mini', temperature: 0.7 },
    },
    roles: {
      director: role('director', '指挥 Director', 'main', SYS_DIRECTOR, ['web'], 0.3),
      planner: role('planner', '规划 Planner', 'main', SYS_PLANNER, ['web'], 0.3),
      researcher: role('researcher', '调研 Researcher', 'main', SYS_RESEARCHER, ['web', 'file'], 0.5),
      coder: role('coder', '研发 Coder', 'main', SYS_CODER, ['file', 'shell'], 0.4),
      verifier: role('verifier', '检验 Verifier', 'main', SYS_VERIFIER, ['file', 'shell'], 0.2),
    },
    pipeline: { stages: ['director', 'planner', 'workers', 'verifier'], max_workers: 1, verify_rounds: 2 },
  },

  coding: {
    description: '研发向：规划 + 研发 + 检验（适合写代码/做项目）',
    models_hint: {
      main: { base_url: 'https://api.openai.com/v1', api_key: '', model: 'gpt-4o-mini', temperature: 0.7 },
    },
    roles: {
      planner: role('planner', '规划 Planner', 'main', SYS_PLANNER, ['file'], 0.3),
      coder: role('coder', '研发 Coder', 'main', SYS_CODER, ['file', 'shell'], 0.4),
      verifier: role('verifier', '检验 Verifier', 'main', SYS_VERIFIER, ['file', 'shell'], 0.2),
    },
    pipeline: { stages: ['planner', 'workers', 'verifier'], max_workers: 1, verify_rounds: 2 },
  },

  research: {
    description: '调研向：指挥 + 调研 + 检验（适合资料收集/分析）',
    models_hint: {
      main: { base_url: 'https://api.openai.com/v1', api_key: '', model: 'gpt-4o-mini', temperature: 0.7 },
    },
    roles: {
      director: role('director', '指挥 Director', 'main', SYS_DIRECTOR, ['web'], 0.3),
      researcher: role('researcher', '调研 Researcher', 'main', SYS_RESEARCHER, ['web', 'file'], 0.5),
      verifier: role('verifier', '检验 Verifier', 'main', SYS_VERIFIER, ['file'], 0.2),
    },
    pipeline: { stages: ['director', 'workers', 'verifier'], max_workers: 1, verify_rounds: 1 },
  },
};

// 从预设构造一份完整 config（models 用 hint 占位，用户后续替换密钥）
export function buildConfigFromPreset(name) {
  const p = PRESETS[name] || PRESETS.full;
  return {
    _comment: 'models: 填入你的 base_url / api_key / model；roles: 岗位可增删改，model 字段引用 models 的键；pipeline: 编排顺序。',
    models: structuredClone(p.models_hint),
    roles: structuredClone(p.roles),
    pipeline: structuredClone(p.pipeline),
  };
}

export function listPresets() {
  return Object.entries(PRESETS).map(([k, v]) => ({ name: k, description: v.description }));
}
