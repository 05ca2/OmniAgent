// 运行报告渲染为 Markdown
import { truncate } from './util.js';

export function renderReport(task, report, mock) {
  const lines = [];
  lines.push(`# ORcode 运行报告 ${mock ? '(MOCK)' : ''}`);
  lines.push('');
  lines.push(`**任务：** ${task}`);
  lines.push('');
  if (report.dirJson) {
    lines.push('## 指挥拆解');
    lines.push(report.dirJson.overview || '');
    (report.dirJson.items || []).forEach((it) => lines.push(`- [${it.role}] ${it.title}: ${it.goal}`));
    lines.push('');
  }
  if (report.planJson) {
    lines.push('## 执行计划');
    (report.planJson.plan || []).forEach((s, i) => lines.push(`${i + 1}. [${s.role}] ${s.instruction}`));
    lines.push('');
  }
  lines.push('## 各岗位交付');
  report.results.forEach((r, i) => {
    lines.push(`### 步骤${i + 1} [${r.role}] ${r.instruction}`);
    lines.push('');
    lines.push('```');
    lines.push(truncate(r.result, 4000));
    lines.push('```');
    lines.push('');
  });
  if (report.verdict) {
    lines.push('## 检验结论');
    lines.push(`- 通过：${report.verdict.passed ? '是' : '否'}（评分 ${report.verdict.score ?? '-'}）`);
    lines.push(`- 结论：${report.verdict.verdict || ''}`);
    if (report.verdict.gaps?.length) { lines.push('- 缺口：'); report.verdict.gaps.forEach((g) => lines.push('  - ' + g)); }
  }
  return lines.join('\n');
}
