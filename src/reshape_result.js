/**
 * n8n Webhook（Normalize, Dedupe & Structure Outputの出力）の生JSONを、
 * ブラウザへ返してよい最小限のUI向け形状へ変換する。
 * n8nの内部フィールド（_source/_input_error等）・生の検索/抽出レスポンス構造は含めない。
 * バックエンドのみで使用（n8n Codeノードには複製しない）。
 */

const MAX_SNIPPET_LENGTH = 2000;

function displayTitle(source) {
  if (typeof source.title === 'string' && source.title.trim() !== '') return source.title;
  return source.source_type === 'official' ? '公式サイト' : '外部サイト';
}

function toDisplaySource(source) {
  return {
    title: displayTitle(source),
    url: source.url,
    snippet: typeof source.snippet === 'string' ? source.snippet.slice(0, MAX_SNIPPET_LENGTH) : null,
  };
}

/**
 * @param {object} raw n8n Webhookから返ってきた生JSON
 * @returns {object} ブラウザ表示用の整形済み結果
 */
export function reshapeResult(raw) {
  const input = raw?.input ?? {};
  const sources = Array.isArray(raw?.sources) ? raw.sources : [];
  const warnings = Array.isArray(raw?.warnings) ? raw.warnings : [];

  return {
    company_name: typeof input.company_name === 'string' ? input.company_name : '',
    official_url: typeof input.official_url === 'string' ? input.official_url : '',
    official_sources: sources.filter((s) => s.source_type === 'official').map(toDisplaySource),
    external_sources: sources.filter((s) => s.source_type !== 'official').map(toDisplaySource),
    warnings,
    generated_at: typeof raw?.generated_at === 'string' ? raw.generated_at : new Date().toISOString(),
  };
}
