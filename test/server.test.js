import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';

const VALID_NORMALIZE_OUTPUT = {
  input: { company_name: 'Example Corp', official_url: 'https://example.com/', research_purpose: '', _source: 'webhook', _input_error: '' },
  search: { status: 'ok', query: 'x', max_results: 3, returned_count: 1 },
  extract: { status: 'ok', requested_url: 'https://example.com/', failed_urls: [] },
  sources: [
    { id: 'src1', url: 'https://example.com/', title: null, snippet: '会社概要', source_type: 'official', origin: ['extract'] },
  ],
  warnings: [],
  generated_at: '2026-09-06T00:00:00.000Z',
};

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function postResearch(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('POST /api/research: 正常な入力はn8n Webhookを呼び出し、整形済みの結果を返す（n8n内部フィールドは含まれない）', async () => {
  let calledUrl = null;
  let calledHeaders = null;
  const fetchImpl = async (url, init) => {
    calledUrl = url;
    calledHeaders = init.headers;
    return { ok: true, status: 200, text: async () => JSON.stringify(VALID_NORMALIZE_OUTPUT) };
  };

  const server = createServer({
    n8nWebhookUrl: 'http://n8n.internal/webhook/research',
    n8nWebhookSecret: 'test-secret',
    fetchImpl,
  });
  const port = await listen(server);
  try {
    const { status, json } = await postResearch(port, {
      company_name: 'Example Corp',
      official_url: 'https://example.com/',
      research_purpose: '',
    });

    assert.equal(status, 200);
    assert.equal(json.company_name, 'Example Corp');
    assert.equal(json.official_sources.length, 1);
    assert.equal(json.official_sources[0].title, '公式サイト');
    assert.equal('_source' in json, false);
    assert.equal('search' in json, false);
    assert.equal(calledUrl, 'http://n8n.internal/webhook/research');
    assert.equal(calledHeaders['X-Demo-Webhook-Secret'], 'test-secret');
  } finally {
    await closeServer(server);
  }
});

test('POST /api/research: 不正な入力はn8nを呼び出さず400を返す', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const server = createServer({ n8nWebhookUrl: 'http://n8n.internal/webhook/research', n8nWebhookSecret: 's', fetchImpl });
  const port = await listen(server);
  try {
    const { status, json } = await postResearch(port, { official_url: 'https://example.com/' });
    assert.equal(status, 400);
    assert.equal(json.error, 'invalid_input');
    assert.equal(called, false);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/research: 内部向けURL（SSRF対象）は400で拒否されn8nを呼び出さない', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const server = createServer({ n8nWebhookUrl: 'http://n8n.internal/webhook/research', n8nWebhookSecret: 's', fetchImpl });
  const port = await listen(server);
  try {
    const { status } = await postResearch(port, { company_name: 'X', official_url: 'http://169.254.169.254/' });
    assert.equal(status, 400);
    assert.equal(called, false);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/research: レート制限を超えると429になる', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(VALID_NORMALIZE_OUTPUT) });
  const server = createServer({
    n8nWebhookUrl: 'http://n8n.internal/webhook/research',
    n8nWebhookSecret: 's',
    fetchImpl,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 2,
  });
  const port = await listen(server);
  try {
    const body = { company_name: 'X', official_url: 'https://example.com/' };
    const r1 = await postResearch(port, body);
    const r2 = await postResearch(port, body);
    const r3 = await postResearch(port, body);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    assert.ok(r3.json.retry_after_seconds > 0);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/research: n8n呼び出しがタイムアウトすると504を返す', async () => {
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });

  const server = createServer({
    n8nWebhookUrl: 'http://n8n.internal/webhook/research',
    n8nWebhookSecret: 's',
    fetchImpl,
    requestTimeoutMs: 30,
  });
  const port = await listen(server);
  try {
    const { status, json } = await postResearch(port, { company_name: 'X', official_url: 'https://example.com/' });
    assert.equal(status, 504);
    assert.equal(json.error, 'timeout');
  } finally {
    await closeServer(server);
  }
});

test('POST /api/research: n8n接続失敗時は502を返し、詳細を漏らさない', async () => {
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5678');
  };
  const server = createServer({ n8nWebhookUrl: 'http://n8n.internal/webhook/research', n8nWebhookSecret: 's', fetchImpl });
  const port = await listen(server);
  try {
    const { status, json } = await postResearch(port, { company_name: 'X', official_url: 'https://example.com/' });
    assert.equal(status, 502);
    assert.equal(json.error, 'upstream_unavailable');
    assert.equal(JSON.stringify(json).includes('ECONNREFUSED'), false);
    assert.equal(JSON.stringify(json).includes('5678'), false);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/research: n8nが非2xx（webhook未登録・認証失敗等）を返した場合は502を返し、空の成功として扱わない', async () => {
  // n8nの404/403応答もJSONとして解析できてしまうことがあるため、
  // ステータスコードを見ずに解析結果をそのまま返すと「空の成功」に化けてしまう回帰を防ぐ。
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ code: 404, message: 'The requested webhook is not registered.' }),
  });
  const server = createServer({ n8nWebhookUrl: 'http://n8n.internal/webhook/research', n8nWebhookSecret: 's', fetchImpl });
  const port = await listen(server);
  try {
    const { status, json } = await postResearch(port, { company_name: 'X', official_url: 'https://example.com/' });
    assert.equal(status, 502);
    assert.equal(json.error, 'upstream_unavailable');
    assert.equal('company_name' in json, false);
  } finally {
    await closeServer(server);
  }
});

test('GET /: 静的HTMLを返す', async () => {
  const server = createServer({ n8nWebhookUrl: 'http://n8n.internal/webhook/research', n8nWebhookSecret: 's' });
  const port = await listen(server);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(text.includes('企業リサーチアシスタント'));
    assert.ok(!text.includes('N8N_WEBHOOK_SECRET'));
  } finally {
    await closeServer(server);
  }
});

test('POST /api/research: 過大なリクエストボディは413で拒否される', async () => {
  const server = createServer({ n8nWebhookUrl: 'http://n8n.internal/webhook/research', n8nWebhookSecret: 's' });
  const port = await listen(server);
  try {
    const hugeBody = JSON.stringify({ company_name: 'a'.repeat(20_000), official_url: 'https://example.com/' });
    const res = await fetch(`http://127.0.0.1:${port}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hugeBody,
    });
    assert.equal(res.status, 413);
  } finally {
    await closeServer(server);
  }
});
