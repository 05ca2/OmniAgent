// 文件插件：读/写/列目录/搜索。所有路径限制在工作区内，防止越权访问。
import fs from 'node:fs';
import path from 'node:path';

function safePath(p, cwd) {
  const abs = path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith('..')) throw new Error('禁止访问工作区外的路径: ' + p);
  return abs;
}

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
      walk(full, files);
    } else files.push(full);
  }
  return files;
}

const TEXT_EXT = new Set(['.txt', '.md', '.js', '.ts', '.json', '.py', '.html', '.css', '.csv', '.log', '.yml', '.yaml', '.go', '.rs', '.java', '.c', '.cpp', '.sh', '.bat']);

export default {
  name: 'file',
  description: '文件读写与搜索（限制在本次工作区内）',
  tools: [
    {
      name: 'read_file',
      description: '读取文本文件内容',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '相对工作区的路径' } }, required: ['path'] },
      execute: async (args, ctx) => {
        const abs = safePath(args.path, ctx.cwd);
        if (!fs.existsSync(abs)) return '文件不存在: ' + args.path;
        const stat = fs.statSync(abs);
        if (stat.size > 200000) return '文件过大(' + stat.size + '字节)，已跳过';
        return fs.readFileSync(abs, 'utf8');
      },
    },
    {
      name: 'write_file',
      description: '写入/覆盖文本文件（自动建目录）',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '相对工作区的路径' }, content: { type: 'string', description: '要写入的内容' } }, required: ['path', 'content'] },
      execute: async (args, ctx) => {
        const abs = safePath(args.path, ctx.cwd);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, args.content, 'utf8');
        return '已写入 ' + args.path + ' (' + args.content.length + ' 字)';
      },
    },
    {
      name: 'list_dir',
      description: '列出目录内容（默认工作区根）',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，默认 "."' } }, required: [] },
      execute: async (args, ctx) => {
        const abs = safePath(args.path || '.', ctx.cwd);
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? '[dir] ' : '[file] ') + e.name).join('\n');
      },
    },
    {
      name: 'grep_files',
      description: '在工作区内递归搜索包含某关键词的文本行',
      parameters: { type: 'object', properties: { pattern: { type: 'string', description: '要搜索的关键词或正则' }, path: { type: 'string', description: '起始路径，默认 "."' } }, required: ['pattern'] },
      execute: async (args, ctx) => {
        const abs = safePath(args.path || '.', ctx.cwd);
        const re = new RegExp(args.pattern, 'i');
        const out = [];
        const files = fs.statSync(abs).isDirectory() ? walk(abs) : [abs];
        for (const f of files) {
          if (!TEXT_EXT.has(path.extname(f))) continue;
          try {
            const text = fs.readFileSync(f, 'utf8');
            text.split('\n').forEach((line, i) => {
              if (re.test(line)) out.push(path.relative(ctx.cwd, f) + ':' + (i + 1) + ': ' + line.trim().slice(0, 160));
            });
          } catch { /* 跳过无法读取的文件 */ }
          if (out.length > 200) break;
        }
        return out.length ? out.slice(0, 200).join('\n') : '未找到匹配行';
      },
    },
  ],
};
