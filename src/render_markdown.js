function renderSourceRefs(ids, sourceById) {
  if (!ids || ids.length === 0) return '';
  return ' ' + ids.map((id) => `[^${id}]`).join('');
}

function renderFailureMarkdown(meta) {
  const { company_name: companyName } = meta.input;
  return `# ${companyName} 商談準備レポート（生成失敗）

生成日時: ${meta.generated_at}

## 結果

OpenAIによる分析の生成に失敗しました。架空の情報で補うことは行っていません。

- 状態: \`${meta.llm.status}\`
- 詳細: ${meta.llm.detail ?? '(詳細不明)'}

Tavilyの調査結果自体は取得できています（下記参照）。再実行するか、
入力・出典の内容を確認してください。

- Search: ${meta.tavily.search?.status ?? '不明'}
- Extract: ${meta.tavily.extract?.status ?? '不明'}
`;
}

/**
 * assembleReport()の出力（{meta, report}）から人が読むMarkdownレポートを決定的に生成する。
 * LLMは使わない。report が null（生成失敗）の場合は失敗内容のみを簡潔に記載する。
 */
export function renderMarkdown({ meta, report }) {
  if (!report) {
    return renderFailureMarkdown(meta);
  }

  const sourceById = new Map(report.sources.map((s) => [s.id, s]));
  const { company_profile: profile } = report;

  const recentNewsSection =
    profile.recent_news.length > 0
      ? profile.recent_news.map((n) => `- ${n.summary}${renderSourceRefs(n.source_ids, sourceById)}`).join('\n')
      : '（出典から裏付けが取れる最近の動きは見つかりませんでした。下記「注意事項」を参照）';

  const orgSignalsSection =
    profile.org_signals.length > 0
      ? profile.org_signals.map((s) => `- ${s.signal}${renderSourceRefs(s.source_ids, sourceById)}`).join('\n')
      : '（該当情報なし）';

  const hypothesesSection = report.proposal_hypotheses
    .map(
      (h, i) =>
        `${i + 1}. **${h.hypothesis}**${renderSourceRefs(h.evidence_source_ids, sourceById)}\n   ${h.rationale}`
    )
    .join('\n');

  const questionsSection = report.discovery_questions.map((q) => `- ${q}`).join('\n');

  const uncertaintiesSection =
    report.uncertainties.length > 0
      ? report.uncertainties.map((u) => `- ${u.note}（理由: ${u.reason}）`).join('\n')
      : '（特になし）';

  const footnotes = report.sources
    .map((s) => `[^${s.id}]: [${s.title ?? s.url}](${s.url})`)
    .join('\n');

  return `# ${profile.company_name} 商談準備レポート

生成日時: ${meta.generated_at}
調査目的: ${meta.input.research_purpose}
提案する商品・サービス: ${meta.input.offering}

## 企業概要

${profile.business_overview.text}${renderSourceRefs(profile.business_overview.source_ids, sourceById)}

## 最近の動き

${recentNewsSection}

## 組織シグナル

${orgSignalsSection}

## 導入・提案仮説

${hypothesesSection}

## 商談で確認すべき質問

${questionsSection}

## 注意事項・不足情報

${uncertaintiesSection}

## 出典

${footnotes}
`;
}
