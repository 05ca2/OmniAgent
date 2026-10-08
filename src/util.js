// 通用工具函数：JSON 解析、密钥脱敏、截断、并发限制
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 把模型可能返回的「包在 ```json 里的 / 带前后废话的」文本解析成对象
export function parseJSON(text) {
  if (text && typeof text === 'object') return text;
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error('无法解析模型返回的 JSON：' + s.slice(0, 300));
  }
}

// 脱敏显示 api_key，避免泄露
export function maskKey(k) {
  if (!k) return '(空)';
  if (k === 'YOUR_KEY_HERE') return 'YOUR_KEY_HERE(待填)';
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

export function truncate(s, n = 200) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…(' + s.length + '字)' : s;
}

// 限制并发数的 map（limit<=1 时等价于顺序执行）
export async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let i = 0;
  async function worker() {
    while (i < arr.length) {
      const idx = i++;
      out[idx] = await fn(arr[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(limit || 1, arr.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

export function fileURL(p) {
  return pathToFileURL(p).href;
}
