// 官网服务：托管本站静态文件 + 接收反馈（POST /api/feedback 落地到 feedback.json）
// 纯 node:http，无第三方依赖。同时作为「插件市场」的数据源（/plugins.json 与 /plugins/*.js 由静态托管提供）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = __dirname;
const FEEDBACK_PATH = path.join(SITE_DIR, 'feedback.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 2e6) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const fp = path.join(SITE_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(SITE_DIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
}

export function startSiteServer({ port = 8080 } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    res.setHeader('access-control-allow-origin', '*');

    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const arr = fs.existsSync(FEEDBACK_PATH) ? JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf8')) : [];
        arr.push({ ...body, at: new Date().toISOString() });
        fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(arr, null, 2), 'utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }

    return serveStatic(req, res, url);
  });
  server.listen(port, () => {
    console.log(`\n◆ ORcode 官网已启动：${'\x1b[36m'}http://localhost:${port}${'\x1b[0m'}`);
    console.log('  含插件中心与反馈；插件文件由 /plugins/*.js 提供，反馈落地到 feedback.json。\n');
  });
  return server;
}
