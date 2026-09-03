/**
 * Tavily Search/Extractの結果を正規化・重複排除し、後続LLM向けの構造化JSONへ整形する。
 *
 * 注意：このファイルのロジックは、n8nワークフロー
 * （workflows/sales-research-agent.json の "Normalize, Dedupe & Structure Output"
 * Codeノード）にも同一内容を手動で複製している。n8n Codeノードは外部モジュールを
 * importできないため、変更時は両方を同期させること（docs/ASSUMPTIONS.md参照）。
 */

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];

// http(s) URLのみを対象とする単純なパーサー。
// 注意：n8nのCodeノードのサンドボックス（JS Task Runner）にはグローバルの`URL`/
// `URLSearchParams`が存在せず（`new URL(...)`は"URL is not defined"で例外になる）、
// `require('url')`も許可されていないため、標準の`URL`クラスを一切使わずに
// 正規表現と文字列操作のみで実装している（詳細はdocs/ASSUMPTIONS.md）。
const ABSOLUTE_HTTP_URL_PATTERN = /^(https?):\/\/([^/?#:]+)(?::(\d+))?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i;

function parseHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const match = ABSOLUTE_HTTP_URL_PATTERN.exec(rawUrl.trim());
  if (!match) return null;
  const [, protocol, hostname, port, path, query] = match;
  return { protocol: protocol.toLowerCase(), hostname, port: port || '', pathname: path || '', query: query || '' };
}

function decodeQueryKey(rawKey) {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    return rawKey;
  }
}

/** URLを正規化する。不正なURLはnullを返す（架空の値で補わない）。 */
export function normalizeUrl(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) return null;

  const hostname = parsed.hostname.toLowerCase();
  const port = (parsed.protocol === 'http' && parsed.port === '80') || (parsed.protocol === 'https' && parsed.port === '443')
    ? ''
    : parsed.port;

  let pathname = parsed.pathname || '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  const params = [];
  for (const pair of parsed.query ? parsed.query.split('&') : []) {
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const rawValue = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
    if (TRACKING_PARAMS.includes(decodeQueryKey(rawKey))) continue;
    params.push([rawKey, rawValue]);
  }
  params.sort((a, b) => {
    const ka = decodeQueryKey(a[0]);
    const kb = decodeQueryKey(b[0]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const query = params.map(([k, v]) => (v ? `${k}=${v}` : k)).join('&');

  return `${parsed.protocol}://${hostname}${port ? `:${port}` : ''}${pathname}${query ? `?${query}` : ''}`;
}

function getHostname(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  return parsed ? parsed.hostname.toLowerCase() : null;
}

/** URLが公式URLと同一ホストかどうかで official/external を判定する。 */
export function classifySourceType(url, officialUrl) {
  const h1 = getHostname(url);
  const h2 = getHostname(officialUrl);
  if (!h1 || !h2) return 'external';
  return h1 === h2 ? 'official' : 'external';
}

/**
 * 正規化後URLをキーに重複排除する。同一URLが複数由来（search/extract）から来た場合は
 * title/snippetの欠落を補い合い、originを配列にまとめる。不正なURLは除外する。
 */
export function dedupeSources(rawSources) {
  const map = new Map();
  const order = [];
  let counter = 0;

  for (const s of rawSources) {
    const normalized = normalizeUrl(s.url);
    if (!normalized) continue;

    if (!map.has(normalized)) {
      counter += 1;
      map.set(normalized, {
        id: `src${counter}`,
        url: s.url,
        normalized_url: normalized,
        title: s.title || null,
        snippet: s.snippet || null,
        source_type: s.source_type,
        origin: [s.origin],
      });
      order.push(normalized);
    } else {
      const entry = map.get(normalized);
      if (!entry.title && s.title) entry.title = s.title;
      if (!entry.snippet && s.snippet) entry.snippet = s.snippet;
      if (!entry.origin.includes(s.origin)) entry.origin.push(s.origin);
    }
  }

  return order.map((k) => map.get(k));
}

function extractErrorMessage(err) {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') return err.message || JSON.stringify(err);
  return 'unknown error';
}

/** Tavily Searchレスポンス（またはエラーitem）から状態を判定する。架空の結果で補わない。 */
export function buildSearchSummary(searchItem, query, maxResults) {
  if (searchItem && searchItem.error) {
    return { status: 'error', query, max_results: maxResults, returned_count: 0, error_message: extractErrorMessage(searchItem.error) };
  }
  const results = Array.isArray(searchItem?.results) ? searchItem.results : [];
  if (results.length === 0) {
    return { status: 'empty', query, max_results: maxResults, returned_count: 0 };
  }
  return { status: 'ok', query, max_results: maxResults, returned_count: results.length };
}

/** Tavily Extractレスポンス（またはエラーitem）から状態を判定する。架空の本文で補わない。 */
export function buildExtractSummary(extractItem, requestedUrl) {
  if (extractItem && extractItem.error) {
    return { status: 'error', requested_url: requestedUrl, error_message: extractErrorMessage(extractItem.error), failed_urls: [] };
  }
  const failed = Array.isArray(extractItem?.failed_results) ? extractItem.failed_results : [];
  if (failed.length > 0) {
    return {
      status: 'error',
      requested_url: requestedUrl,
      error_message: failed.map((f) => `${f.url}: ${f.error}`).join('; '),
      failed_urls: failed.map((f) => f.url),
    };
  }
  const results = Array.isArray(extractItem?.results) ? extractItem.results : [];
  if (results.length === 0) {
    return { status: 'empty', requested_url: requestedUrl, failed_urls: [] };
  }
  return { status: 'ok', requested_url: requestedUrl, failed_urls: [] };
}

/**
 * Search/Extractの生レスポンスから、後続LLM向けの構造化JSONを組み立てる。
 * input: { company_name, official_url, research_purpose }
 * searchItem: Tavily Search APIレスポンス、またはn8nのエラーitem（{error: ...}）
 * extractItem: Tavily Extract APIレスポンス、またはn8nのエラーitem（{error: ...}）
 */
export function buildResearchOutput({ input, searchItem, extractItem }) {
  const query = `${input.company_name} 会社概要 最新ニュース`;
  const maxResults = 3;
  const search = buildSearchSummary(searchItem, query, maxResults);
  const extract = buildExtractSummary(extractItem, input.official_url);

  const rawSources = [];

  if (extract.status === 'ok') {
    for (const r of extractItem.results) {
      rawSources.push({
        url: r.url,
        title: null,
        snippet: r.raw_content ? String(r.raw_content).slice(0, 500) : null,
        source_type: classifySourceType(r.url, input.official_url),
        origin: 'extract',
      });
    }
  }

  if (search.status === 'ok') {
    for (const r of searchItem.results) {
      rawSources.push({
        url: r.url,
        title: r.title || null,
        snippet: r.content || null,
        source_type: classifySourceType(r.url, input.official_url),
        origin: 'search',
      });
    }
  }

  const sources = dedupeSources(rawSources);

  const warnings = [];
  if (search.status === 'error') warnings.push(`Tavily Search呼び出しに失敗しました: ${search.error_message}`);
  if (search.status === 'empty') warnings.push('Tavily Searchの結果が0件でした。');
  if (extract.status === 'error') warnings.push(`Tavily Extractに失敗しました: ${extract.error_message}`);
  if (sources.length === 0) warnings.push('有効な出典が1件も取得できませんでした。');

  return {
    input,
    search,
    extract,
    sources,
    warnings,
    generated_at: new Date().toISOString(),
  };
}
