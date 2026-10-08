// OmniAgent 插件：翻译（调用免费 MyMemory 翻译 API，无需密钥）
// 把本文件放到 .omni/plugins/ 即被自动加载（或在本地应用「插件中心」一键安装）。
export default {
  name: 'translator',
  description: '文本翻译插件：把任意文本翻译成目标语言。',
  tools: [
    {
      name: 'translate',
      description: '把文本翻译成目标语言。target 用语言代码，如 en / zh / ja / fr / de。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '待翻译文本' },
          target: { type: 'string', description: '目标语言代码，如 en/zh/ja/fr/de' },
        },
        required: ['text', 'target'],
      },
      async execute({ text, target = 'en' }, ctx) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(target)}`;
        const r = await fetch(url);
        if (!r.ok) return '翻译请求失败 ' + r.status;
        const j = await r.json();
        const out = j?.responseData?.translatedText;
        return out ? `翻译(${target})：${out}` : '翻译失败：' + JSON.stringify(j).slice(0, 200);
      },
    },
  ],
};
