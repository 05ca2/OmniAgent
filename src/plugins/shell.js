// Shell 插件：在工作区内执行命令（带超时）。注意：下载的第三方插件也可能调用它，存在风险。
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execP = promisify(exec);

export default {
  name: 'shell',
  description: '在工作区内执行 shell 命令（编译、测试、git 等），默认 30s 超时',
  tools: [
    {
      name: 'run_command',
      description: '执行一条 shell 命令，返回 stdout/stderr',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
          timeout: { type: 'number', description: '超时毫秒，默认 30000' },
        },
        required: ['command'],
      },
      execute: async (args, ctx) => {
        try {
          const { stdout, stderr } = await execP(args.command, {
            cwd: ctx.cwd,
            timeout: args.timeout || 30000,
            maxBuffer: 1024 * 1024,
          });
          const body = (stdout || '') + (stderr ? '\n[stderr]\n' + stderr : '');
          return body.slice(0, 8000) || '(无输出)';
        } catch (e) {
          return '命令失败(' + (e.code ?? '') + '): ' + (e.stdout || '') + (e.stderr || e.message || '');
        }
      },
    },
  ],
};
