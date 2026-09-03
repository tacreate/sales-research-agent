import { OPENAI_MODEL } from './openai_request.js';

// このロジックはn8n Codeノードにも同一内容を手動で複製している（n8n Codeノードは
// 外部モジュール（ajv等）をimportできないため）。変更時は両方を同期させること。
// このため、Phase4のLLM出力Schemaの検証はajv等のライブラリを使わず、手書きの
// 構造チェックのみで行う（Phase3のsrc/normalize.jsと同じ方針）。

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string');
}

function hasExactKeys(obj, keys) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const objKeys = Object.keys(obj);
  if (objKeys.length !== keys.length) return false;
  return keys.every((k) => objKeys.includes(k));
}

/**
 * schema/phase4_llm_analysis_output.schema.jsonと同じ制約
 * （additionalProperties:false相当・必須キー・minItems:1）を手書きで検証する。
 */
function validatePhase4Schema(analysis) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  if (!hasExactKeys(analysis, ['company_profile', 'proposal_hypotheses', 'discovery_questions', 'uncertainties'])) {
    fail('root: company_profile/proposal_hypotheses/discovery_questions/uncertaintiesが過不足なく必要です');
    return { valid: false, errors };
  }

  const cp = analysis.company_profile;
  if (!hasExactKeys(cp, ['business_overview', 'recent_news', 'org_signals'])) {
    fail('company_profile: business_overview/recent_news/org_signalsが過不足なく必要です');
  } else {
    const bo = cp.business_overview;
    if (!hasExactKeys(bo, ['text', 'source_ids']) || typeof bo.text !== 'string' || !isNonEmptyStringArray(bo.source_ids)) {
      fail('company_profile.business_overview: text(string)とsource_ids(1件以上のstring配列)が必要です');
    }

    if (!Array.isArray(cp.recent_news)) {
      fail('company_profile.recent_news: 配列である必要があります');
    } else {
      cp.recent_news.forEach((item, i) => {
        if (
          !hasExactKeys(item, ['summary', 'source_ids']) ||
          typeof item.summary !== 'string' ||
          !isNonEmptyStringArray(item.source_ids)
        ) {
          fail(`company_profile.recent_news[${i}]: summary(string)とsource_ids(1件以上のstring配列)が必要です`);
        }
      });
    }

    if (!Array.isArray(cp.org_signals)) {
      fail('company_profile.org_signals: 配列である必要があります');
    } else {
      cp.org_signals.forEach((item, i) => {
        if (
          !hasExactKeys(item, ['signal', 'source_ids']) ||
          typeof item.signal !== 'string' ||
          !isNonEmptyStringArray(item.source_ids)
        ) {
          fail(`company_profile.org_signals[${i}]: signal(string)とsource_ids(1件以上のstring配列)が必要です`);
        }
      });
    }
  }

  if (!Array.isArray(analysis.proposal_hypotheses)) {
    fail('proposal_hypotheses: 配列である必要があります');
  } else {
    analysis.proposal_hypotheses.forEach((item, i) => {
      if (
        !hasExactKeys(item, ['hypothesis', 'rationale', 'evidence_source_ids']) ||
        typeof item.hypothesis !== 'string' ||
        typeof item.rationale !== 'string' ||
        !isNonEmptyStringArray(item.evidence_source_ids)
      ) {
        fail(`proposal_hypotheses[${i}]: hypothesis/rationale(string)とevidence_source_ids(1件以上のstring配列)が必要です`);
      }
    });
  }

  if (!Array.isArray(analysis.discovery_questions) || !analysis.discovery_questions.every((q) => typeof q === 'string')) {
    fail('discovery_questions: string配列である必要があります');
  }

  if (!Array.isArray(analysis.uncertainties)) {
    fail('uncertainties: 配列である必要があります');
  } else {
    analysis.uncertainties.forEach((item, i) => {
      if (!hasExactKeys(item, ['note', 'reason']) || typeof item.note !== 'string' || typeof item.reason !== 'string') {
        fail(`uncertainties[${i}]: note/reason(string)が必要です`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

function collectSourceIdRefs(analysis) {
  const refs = [];
  const pushRefs = (ids, refPath) => {
    if (!Array.isArray(ids)) return;
    for (const id of ids) refs.push({ id, path: refPath });
  };

  const overview = analysis?.company_profile?.business_overview;
  if (overview) pushRefs(overview.source_ids, 'company_profile.business_overview.source_ids');

  (analysis?.company_profile?.recent_news ?? []).forEach((item, i) => {
    pushRefs(item.source_ids, `company_profile.recent_news[${i}].source_ids`);
  });

  (analysis?.company_profile?.org_signals ?? []).forEach((item, i) => {
    pushRefs(item.source_ids, `company_profile.org_signals[${i}].source_ids`);
  });

  (analysis?.proposal_hypotheses ?? []).forEach((item, i) => {
    pushRefs(item.evidence_source_ids, `proposal_hypotheses[${i}].evidence_source_ids`);
  });

  return refs;
}

function validateAnalysis(analysis, sourceIds) {
  if (typeof analysis !== 'object' || analysis === null || Array.isArray(analysis)) {
    return { valid: false, status: 'invalid_schema', detail: 'LLM出力がオブジェクトではありません' };
  }

  const schemaResult = validatePhase4Schema(analysis);
  if (!schemaResult.valid) {
    return { valid: false, status: 'invalid_schema', detail: schemaResult.errors.join(' / ') };
  }

  const knownIds = new Set(sourceIds);
  const invalidRefs = collectSourceIdRefs(analysis).filter((ref) => !knownIds.has(ref.id));
  if (invalidRefs.length > 0) {
    const detail = invalidRefs.map((r) => `${r.path}: "${r.id}"`).join(', ');
    return { valid: false, status: 'invalid_reference', detail: `存在しないsource idを参照しています: ${detail}` };
  }

  return { valid: true };
}

/**
 * OpenAI Responses APIの生レスポンスボディを分類する。
 * onError: continueRegularOutput のため、HTTPエラー時もbodyがitem.jsonとして渡ってくる想定。
 */
function classifyResponse(response) {
  if (!response || typeof response !== 'object') {
    return { status: 'empty', detail: 'レスポンスが空、または不正な形式です' };
  }

  if (response.error) {
    const message = typeof response.error === 'string' ? response.error : response.error.message;
    return { status: 'error', detail: message ?? 'OpenAI APIがエラーを返しました' };
  }

  if (response.status === 'failed') {
    return { status: 'error', detail: response.error?.message ?? 'OpenAIの応答status=failed' };
  }

  if (response.status === 'incomplete') {
    return {
      status: 'incomplete',
      detail: response.incomplete_details?.reason ?? 'OpenAIの応答が不完全でした（理由不明）',
    };
  }

  if (response.status !== 'completed') {
    return { status: 'empty', detail: `想定外のstatusです: ${response.status}` };
  }

  const messageItem = (response.output ?? []).find((o) => o.type === 'message');
  const contentItems = messageItem?.content ?? [];

  const refusal = contentItems.find((c) => c.type === 'refusal');
  if (refusal) {
    return { status: 'refusal', detail: refusal.refusal ?? 'OpenAIがリクエストを拒否しました' };
  }

  const textItem = contentItems.find((c) => c.type === 'output_text');
  const text = textItem?.text;
  if (!text || text.trim() === '') {
    return { status: 'empty', detail: '出力テキストが空でした' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { status: 'invalid_schema', detail: `JSONとして解析できませんでした: ${e.message}` };
  }

  return { status: 'ok', analysis: parsed };
}

/**
 * OpenAI応答とPhase3の正規化済み出力を統合し、最終レポート（Phase1 Schema準拠のreport ＋
 * 実行メタ情報のmeta）を組み立てる。llm.statusが'ok'以外の場合、reportはnullとし、
 * 架空の分析結果で補わない。
 *
 * 組み立てたreportがschema/sales_research_output.schema.json（Phase1）に準拠することは
 * test/assemble_report.test.jsで確認済み（validatePhase4Schemaの制約がPhase1 Schemaの
 * 対応フィールドを包含するよう設計しているため、実行時の再検証は行わない）。
 */
export function assembleReport({ input, tavilyOutput, openAiResponse }) {
  const sources = tavilyOutput?.sources ?? [];
  const sourceIds = sources.map((s) => s.id);

  const classification = classifyResponse(openAiResponse);

  let llmStatus = classification.status;
  let llmDetail = classification.detail ?? null;
  let report = null;

  if (classification.status === 'ok') {
    const validation = validateAnalysis(classification.analysis, sourceIds);
    if (!validation.valid) {
      llmStatus = validation.status;
      llmDetail = validation.detail;
    } else {
      const analysis = classification.analysis;
      report = {
        sources,
        company_profile: {
          company_name: input.company_name,
          official_url: input.official_url,
          business_overview: analysis.company_profile.business_overview,
          recent_news: analysis.company_profile.recent_news,
          org_signals: analysis.company_profile.org_signals,
        },
        proposal_hypotheses: analysis.proposal_hypotheses,
        discovery_questions: analysis.discovery_questions,
        uncertainties: analysis.uncertainties,
      };
    }
  }

  return {
    meta: {
      input,
      generated_at: new Date().toISOString(),
      tavily: {
        search: tavilyOutput?.search ?? null,
        extract: tavilyOutput?.extract ?? null,
        warnings: tavilyOutput?.warnings ?? [],
      },
      llm: {
        status: llmStatus,
        model: OPENAI_MODEL,
        detail: llmDetail,
      },
    },
    report,
  };
}
