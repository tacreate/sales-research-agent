/**
 * デモUI用の最小バックエンド。Node.js標準ライブラリのみで実装し、新規npm依存を追加しない。
 *
 * 役割：
 * - 静的UI（web/index.html）の配信
 * - POST /api/research：入力検証・レート制限・タイムアウトを行った上でn8n Webhookを呼び出し、
 *   n8nの生JSON・内部ノード情報・APIキー・Credential・Webhook共有シークレットを一切含まない
 *   形へ整形してブラウザへ返す
 *
 * ブラウザはこのサーバーとのみ通信する。n8n・Tavily・共有シークレットの存在はブラウザ側からは
 * 一切見えない。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeResearchInput } from '../src/sanitize_input.js';
import { reshapeResult } from '../src/reshape_result.js';
import { createRateLimiter } from '../src/rate_limiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INDEX_HTML_PATH = path.join(__dirname, '..', 'web', 'index.html');
const MAX_BODY_BYTES = 10 * 1024; // 10KB。過大なリクエストボディを早期に拒否する。

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        // レスポンスを正常に返せるよう、ここではソケットを破棄しない
        // （req.destroy()すると同一ソケット上のレスポンス送信前に接続が切れてしまう）。
        reject(new Error('body_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {object} options
 * @param {string} options.n8nWebhookUrl
 * @param {string} options.n8nWebhookSecret
 * @param {number} [options.requestTimeoutMs=60000]
 * @param {number} [options.rateLimitWindowMs=3600000]
 * @param {number} [options.rateLimitMaxRequests=5]
 * @param {string} [options.indexHtmlPath]
 * @param {(url: string, init: object) => Promise<Response>} [options.fetchImpl] テスト差し替え用
 */
export function createServer(options) {
  const {
    n8nWebhookUrl,
    n8nWebhookSecret,
    requestTimeoutMs = 60_000,
    rateLimitWindowMs = 60 * 60 * 1000,
    rateLimitMaxRequests = 5,
    indexHtmlPath = DEFAULT_INDEX_HTML_PATH,
    fetchImpl = fetch,
  } = options;

  const rateLimiter = createRateLimiter({ windowMs: rateLimitWindowMs, maxRequests: rateLimitMaxRequests });
  let indexHtmlCache = null;
  function loadIndexHtml() {
    if (indexHtmlCache === null) indexHtmlCache = fs.readFileSync(indexHtmlPath, 'utf-8');
    return indexHtmlCache;
  }

  function getClientKey(req) {
    // ローカルデモ運用のみを想定し、単純にソケットのリモートアドレスをレート制限キーとする。
    // リバースプロキシ経由で公開する場合はX-Forwarded-Forの扱いを別途検討する必要がある。
    return req.socket.remoteAddress || 'unknown';
  }

  async function callN8nWebhook(input) {
    if (!n8nWebhookUrl || !n8nWebhookSecret) {
      const err = new Error('server_misconfigured');
      err.code = 'server_misconfigured';
      throw err;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Demo-Webhook-Secret': n8nWebhookSecret,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const text = await response.text();
      // n8n自体がエラー（webhook未登録・認証失敗等）を返した場合、そのボディも
      // JSONとして解析できてしまうことがあるため、ステータスコードで明確に区別する。
      // ここを見ずに解析結果をそのまま返すと、n8n側の失敗が「空の成功」として
      // ブラウザに伝わってしまう。
      if (!response.ok) {
        const err = new Error(`n8n_error_status_${response.status}`);
        err.code = 'n8n_error_status';
        throw err;
      }
      try {
        return JSON.parse(text);
      } catch {
        const err = new Error('n8n_invalid_response');
        err.code = 'n8n_invalid_response';
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async function handleResearch(req, res) {
    const clientKey = getClientKey(req);
    const rateLimitResult = rateLimiter.check(clientKey);
    if (!rateLimitResult.allowed) {
      sendJson(res, 429, {
        error: 'rate_limited',
        message: 'しばらく待ってから再試行してください。',
        retry_after_seconds: Math.ceil(rateLimitResult.retryAfterMs / 1000),
      });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      const status = e.message === 'body_too_large' ? 413 : 400;
      sendJson(res, status, { error: 'invalid_request', message: '入力の形式が正しくありません。' });
      return;
    }

    const sanitized = sanitizeResearchInput(body);
    if (!sanitized.valid) {
      sendJson(res, 400, { error: 'invalid_input', message: sanitized.error_message });
      return;
    }

    try {
      const raw = await callN8nWebhook(sanitized.input);
      sendJson(res, 200, reshapeResult(raw));
    } catch (e) {
      if (e.name === 'AbortError') {
        sendJson(res, 504, { error: 'timeout', message: '調査に時間がかかりすぎたため中断しました。もう一度お試しください。' });
        return;
      }
      if (e.code === 'server_misconfigured') {
        console.error('N8N_WEBHOOK_URL/N8N_WEBHOOK_SECRETが設定されていません');
        sendJson(res, 500, { error: 'server_misconfigured', message: 'サーバー設定エラーです。管理者へ連絡してください。' });
        return;
      }
      console.error('n8n Webhook呼び出しに失敗しました:', e.message);
      sendJson(res, 502, { error: 'upstream_unavailable', message: '調査サービスに接続できませんでした。しばらくしてから再試行してください。' });
    }
  }

  function handleStatic(req, res) {
    if (req.method !== 'GET' || (req.url !== '/' && req.url !== '/index.html')) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const html = loadIndexHtml();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
  }

  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/research') {
      handleResearch(req, res).catch((e) => {
        console.error('予期しないエラー:', e);
        sendJson(res, 500, { error: 'internal_error', message: '予期しないエラーが発生しました。' });
      });
      return;
    }
    handleStatic(req, res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createServer({
    n8nWebhookUrl: process.env.N8N_WEBHOOK_URL,
    n8nWebhookSecret: process.env.N8N_WEBHOOK_SECRET,
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 60_000),
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 5),
  });
  server.listen(port, () => {
    console.log(`demo UI server listening on http://127.0.0.1:${port}`);
  });
}
