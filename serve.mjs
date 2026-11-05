// 一个零依赖的小服务：把 web/ 里的页面发出去，顺手转发真实测试请求。
//
// 为什么需要它：opencode.ai 的网关没有 CORS 头，浏览器里直接 fetch 会被拦下来。
// 这里替页面发请求，页面只跟自己人说话，就绕过去了。
//
// 用法：node serve.mjs   然后打开 http://127.0.0.1:8787
// 换端口：$env:PORT=9000; node serve.mjs

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, 'web');
const PORT = Number(process.env.PORT) || 8787;
const UPSTREAM = 'https://opencode.ai/inference/go/openai/v1/chat/completions';
const MAX_BODY = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

async function proxyTest(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch (e) {
    return sendJson(res, 400, { error: '请求体不是合法 JSON' });
  }

  const apiKey = String(payload.apiKey || '').trim();
  const model = String(payload.model || '').trim();
  if (!apiKey) return sendJson(res, 400, { error: '缺少 apiKey' });
  if (!model) return sendJson(res, 400, { error: '缺少 model' });
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return sendJson(res, 400, { error: '缺少 messages' });
  }

  const started = Date.now();
  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + apiKey,
        'x-opencode-session': String(payload.sessionId || 'ses_ocsgo_web'),
        'user-agent': 'ocs-answerer-web/1.0'
      },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: Number(payload.maxTokens) || 512,
        messages: payload.messages
      }),
      signal: AbortSignal.timeout(55000)
    });
    const text = await upstream.text();
    console.log(`[test] ${model} → HTTP ${upstream.status}  ${Date.now() - started}ms`);
    sendJson(res, 200, { status: upstream.status, ms: Date.now() - started, text });
  } catch (e) {
    const msg = e && e.name === 'TimeoutError' ? '上游 55 秒没响应' : String((e && e.message) || e);
    console.log('[test] 失败：' + msg);
    sendJson(res, 200, { status: 0, ms: Date.now() - started, text: '', error: msg });
  }
}

/* ------------------------------------------------------------------ *
 * /v1/chat/completions —— 给 OCS 用的转发口。
 * OCS 软件里如果直连 opencode.ai 报「连接超时 / 连接失败」，通常是跨域被拦，
 * 把题库配置的 url 指到这里就行：OCS 只跟 127.0.0.1 说话，不跨域。
 * 这里带上了 CORS 头，浏览器里也能直连。
 * ------------------------------------------------------------------ */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-opencode-session',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '600'
};

async function proxyChat(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: '请用 POST' }));
  }

  const started = Date.now();
  const auth = req.headers.authorization || '';
  let body;
  let model = '(未知)';
  try {
    body = await readBody(req);
    const parsed = JSON.parse(body);
    model = parsed.model || model;
  } catch (e) {
    res.writeHead(400, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: { type: 'bad_request', message: '请求体不是合法 JSON' } }));
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: auth,
        'x-opencode-session': String(req.headers['x-opencode-session'] || 'ses_ocsgo_proxy'),
        'user-agent': 'ocs-answerer-proxy/1.0'
      },
      body,
      signal: AbortSignal.timeout(55000)
    });
    const text = await upstream.text();
    console.log(`[proxy] ${model} → HTTP ${upstream.status}  ${Date.now() - started}ms`);
    res.writeHead(upstream.status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(text);
  } catch (e) {
    const msg = e && e.name === 'TimeoutError' ? '上游 55 秒没响应' : String((e && e.message) || e);
    console.log('[proxy] 失败：' + msg);
    res.writeHead(502, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { type: 'proxy_error', message: msg } }));
  }
}

async function serveStatic(pathname, res) {  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(WEB, '.' + decodeURIComponent(rel));
  if (!filePath.startsWith(resolve(WEB))) return sendJson(res, 403, { error: '越界了' });

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 - 没这个文件：' + rel);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (url.pathname === '/v1/chat/completions') return await proxyChat(req, res);
    if (url.pathname === '/api/test') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '请用 POST' });
      return await proxyTest(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: '只支持 GET' });
    return await serveStatic(url.pathname, res);
  } catch (e) {
    sendJson(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  题库配置生成器已启动： http://127.0.0.1:' + PORT);
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
