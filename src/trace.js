// 可替换的事件槽（trace sink）：编排/agent 把进度以结构化事件发出，
// CLI 映射回终端(ui)，Web 服务映射成 SSE 流。
import { ui } from './ui.js';

// 终端版 trace：把事件转发给 ui
export function cliTrace() {
  return {
    stage: (n, s) => ui.stage(n, s),
    step: (role, instruction) => ui.stepStart(role, instruction),
    think: (role, note) => ui.agentThink(role, note),
    token: (t) => ui.stream(t),
    end: () => ui.streamEnd(),
    tool: (name, args, out) => ui.toolCall(name, args, out),
    result: (label, text) => ui.result(label, text),
    gaps: (items) => ui.gaps(items),
    info: (m) => ui.info(m),
    done: () => {},
  };
}
