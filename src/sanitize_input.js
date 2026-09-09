/**
 * デモUIのManual/Webhook両経路の入力を、既存Tavily処理（src/normalize.js）へ渡す前に
 * 安全に正規化する。n8n Codeノードのサンドボックスにも同一内容を手動で複製しているため
 * （n8n Codeノードは外部モジュールをimportできず、グローバルの`URL`も存在しない）、
 * ここでも`URL`クラスを使わず正規表現＋文字列操作のみで実装する（src/normalize.js参照）。
 * 変更時はworkflow内のCodeノードと同期させること（test/workflow-sync.test.js参照）。
 */

export const MAX_COMPANY_NAME_LENGTH = 200;
export const MAX_RESEARCH_PURPOSE_LENGTH = 500;

// ホスト名部分は「[IPv6リテラル]」（角括弧＋コロン含む）、または通常のホスト名/IPv4
// （コロンを含まない）のいずれか。
const ABSOLUTE_HTTP_URL_PATTERN = /^(https?):\/\/(\[[0-9a-fA-F:]+\]|[^/?#:]+)(?::(\d+))?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i;

function parseHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const match = ABSOLUTE_HTTP_URL_PATTERN.exec(rawUrl.trim());
  if (!match) return null;
  const [, protocol, hostname] = match;
  return { protocol: protocol.toLowerCase(), hostname: hostname.toLowerCase() };
}

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^\[fe80:/,
  /^\[fc00:/,
  /^\[fd00:/,
];

/** プライベート/ループバック/リンクローカル等の内部向けホスト名かどうかを判定する（SSRF一次防御）。 */
export function isBlockedHostname(hostname) {
  if (!hostname) return true;
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

function sanitizeText(raw, maxLength) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, maxLength);
}

/** 公式URLを検証する。http/https以外、パース不能、内部向けホストは不正として扱う。 */
export function sanitizeOfficialUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, url: '', reason: '公式URLが入力されていません' };
  }
  const trimmed = raw.trim().slice(0, 500);
  const parsed = parseHttpUrl(trimmed);
  if (!parsed) {
    return { valid: false, url: '', reason: '公式URLはhttp(s)から始まる形式で入力してください' };
  }
  if (isBlockedHostname(parsed.hostname)) {
    return { valid: false, url: '', reason: '公式URLに内部向け・ループバックアドレスは指定できません' };
  }
  return { valid: true, url: trimmed, reason: null };
}

/**
 * Manual/Webhook入力（{company_name, official_url, research_purpose}）を正規化する。
 * 不正な場合はvalid:falseとerror_messageを返し、架空の値で補わない。
 */
export function sanitizeResearchInput(raw) {
  const company_name = sanitizeText(raw?.company_name, MAX_COMPANY_NAME_LENGTH);
  const research_purpose = sanitizeText(raw?.research_purpose, MAX_RESEARCH_PURPOSE_LENGTH);
  const urlResult = sanitizeOfficialUrl(raw?.official_url);

  const errors = [];
  if (!company_name) errors.push('会社名が入力されていません');
  if (!urlResult.valid) errors.push(urlResult.reason);

  return {
    valid: errors.length === 0,
    error_message: errors.length > 0 ? errors.join(' / ') : null,
    input: {
      company_name,
      official_url: urlResult.url,
      research_purpose,
    },
  };
}
