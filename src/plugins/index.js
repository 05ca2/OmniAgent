// 插件注册表：内置插件 + 动态加载用户下载到 .omni/plugins 的插件
import fs from 'node:fs';
import path from 'node:path';
import { fileURL } from '../util.js';
import filePlugin from './file.js';
import shellPlugin from './shell.js';
import webPlugin from './web.js';

const BUILTINS = [filePlugin, shellPlugin, webPlugin];

// 加载所有插件（内置 + 用户插件目录）。userPluginDir 不存在时只返回内置。
export async function loadPlugins(userPluginDir) {
  const plugins = [...BUILTINS];
  if (userPluginDir && fs.existsSync(userPluginDir)) {
    const files = fs.readdirSync(userPluginDir).filter((f) => f.endsWith('.js'));
    for (const f of files) {
      try {
        const mod = await import(fileURL(path.join(userPluginDir, f)));
        if (mod.default && Array.isArray(mod.default.tools)) plugins.push(mod.default);
        else console.warn('  跳过无效插件(缺少 tools): ' + f);
      } catch (e) {
        console.warn('  插件加载失败 ' + f + ': ' + e.message);
      }
    }
  }
  return plugins;
}

// 把岗位配置的插件名列表，解析为具体工具（带 execute）
export function resolveTools(pluginNames, plugins, ctx) {
  const out = [];
  for (const pname of pluginNames || []) {
    const p = plugins.find((x) => x.name === pname);
    if (!p) {
      console.warn('  ⚠ 未找到插件: ' + pname);
      continue;
    }
    for (const t of p.tools) out.push({ ...t, _plugin: pname });
  }
  return out;
}

// 转换为 OpenAI tools 格式（execute 不发给模型）
export function toOpenAI(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} },
    },
  };
}
