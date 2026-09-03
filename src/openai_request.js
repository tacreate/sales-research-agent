import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'schema', 'phase4_llm_analysis_output.schema.json');

export const OPENAI_MODEL = 'gpt-5.6-terra';
export const OPENAI_REASONING_EFFORT = 'low';
export const OPENAI_MAX_OUTPUT_TOKENS = 4000;

let cachedSchema = null;

function loadPhase4Schema() {
  if (cachedSchema) return cachedSchema;
  cachedSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  return cachedSchema;
}

function formatSourceLine(source) {
  const title = source.title ? source.title : '(タイトルなし)';
  const snippet = source.snippet ? source.snippet : '(本文なし)';
  return `[${source.id}] (${source.source_type}) ${title}\nURL: ${source.url}\n${snippet}`;
}

/**
 * Phase3の正規化済み出力（input/sources）からOpenAI Responses APIへのプロンプト文字列を組み立てる。
 * 出典に無い情報を推測で補わないこと、根拠のない最近の動きはuncertaintiesへ回すことを明示する。
 */
export function buildPromptText({ input, sources }) {
  const groundingLines = (sources ?? []).map(formatSourceLine).join('\n\n');

  return `あなたは営業担当者の商談準備を支援するリサーチアシスタントです。
以下の出典（Tavilyの検索・抽出結果）のみを根拠に、企業情報の分析を行ってください。
出典に無い情報を推測や一般知識で補ってはいけません。

# 調査対象
企業名: ${input.company_name}
公式URL: ${input.official_url}
調査目的: ${input.research_purpose}

# 提案する商品・サービス（offering）
${input.offering}

# 出典一覧
${groundingLines || '(出典なし)'}

# 指示
- business_overview / recent_news / org_signals の各項目には、根拠となった出典のidを source_ids に必ず1件以上含めてください。
- 出典から裏付けが取れない「最近の動き」は recent_news に含めず、uncertainties に理由とともに記録してください。
- proposal_hypotheses は、上記offeringとの適合理由を rationale に含め、evidence_source_ids に根拠となる出典idを1件以上含めてください。
- discovery_questions は、offeringを前提に、商談で確認すべき質問にしてください。出典は不要です。
- 出典が無い、または情報が不足している場合は uncertainties に記録してください。`;
}

/**
 * OpenAI Responses API（POST https://api.openai.com/v1/responses）へのリクエストボディを組み立てる。
 * 呼び出しは1実行あたりこのリクエスト1回のみ。
 */
export function buildOpenAiRequestBody({ input, sources }) {
  const schema = loadPhase4Schema();
  return {
    model: OPENAI_MODEL,
    reasoning: { effort: OPENAI_REASONING_EFFORT },
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    input: buildPromptText({ input, sources }),
    text: {
      format: {
        type: 'json_schema',
        name: 'phase4_llm_analysis_output',
        strict: true,
        schema,
      },
    },
  };
}
