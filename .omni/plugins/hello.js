export default {
  name: 'hello',
  description: '示例插件：向插件系统注册一个打招呼工具',
  tools: [
    {
      name: 'say_hi',
      description: '向某人打招呼',
      parameters: { type: 'object', properties: { name: { type: 'string', description: '名字' } } },
      execute: async (args) => 'hi ' + (args.name || '?'),
    },
  ],
};
