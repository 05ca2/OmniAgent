// ORcode 插件：获取当前时间与日期（支持时区）
export default {
  name: 'clock',
  description: '时间插件：获取当前本地/指定时区的日期时间。',
  tools: [
    {
      name: 'now',
      description: '返回当前时间。timezone 可选，如 Asia/Shanghai、America/New_York、UTC。',
      parameters: {
        type: 'object',
        properties: { timezone: { type: 'string', description: 'IANA 时区名，如 Asia/Shanghai' } },
        required: [],
      },
      async execute({ timezone } = {}, ctx) {
        const tz = timezone || 'Asia/Shanghai';
        const iso = new Date().toLocaleString('zh-CN', { timeZone: tz });
        return `当前时间（${tz}）：${iso}  ·  ISO: ${new Date().toISOString()}`;
      },
    },
  ],
};
