// 联网插件：抓取网页 + 轻量搜索（DuckDuckGo Instant Answer，无需密钥）
export default {
  name: 'web',
  description: '联网检索与网页抓取',
  tools: [
    {
      name: 'web_fetch',
      description: '抓取一个网页的文本内容',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '目标 URL' } }, required: ['url'] },
      execute: async (args) => {
        const res = await fetch(args.url, { headers: { 'user-agent': 'Mozilla/5.0' } });
        const text = await res.text();
        // 极简清洗：去掉 script/style，压缩空白
        let clean = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
        clean = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return ('[' + res.status + '] ' + args.url + '\n' + clean).slice(0, 6000);
      },
    },
    {
      name: 'web_search',
      description: '用 DuckDuckGo 做一次轻量搜索，返回摘要与来源',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索词' } }, required: ['query'] },
      execute: async (args) => {
        const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(args.query) + '&format=json&no_html=1&skip_disambig=1';
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
        const data = await res.json();
        const parts = [];
        if (data.AbstractText) parts.push('摘要: ' + data.AbstractText);
        if (data.AbstractURL) parts.push('来源: ' + data.AbstractURL);
        (data.RelatedTopics || []).slice(0, 5).forEach((t) => {
          if (t.Text) parts.push('· ' + t.Text + (t.FirstURL ? '  ' + t.FirstURL : ''));
        });
        return parts.length ? parts.join('\n') : '（无结果，可换关键词或改用 web_fetch 直接抓页面）';
      },
    },
  ],
};
