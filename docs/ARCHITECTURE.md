# アーキテクチャ設計

Phase 0で設計案として書き起こした内容を出発点に、Phase 1〜4で実装しながら更新している。
Phase 4時点でMVPの中核（調査→LLM分析→構造化JSON＋Markdown出力）は完成している。
Wait/HITL（承認・修正・却下フロー）はPhase 5として意図的に未着手（CLAUDE.mdのMission
に基づき、デモ完成・案件応募を優先するため）。

## 全体構成

```
[Manual Trigger] → [Fixed Test Input]  ── 企業名/公式URL/調査目的/offering（Phase 4で追加）
      ▼
[Tavily Search]      [Tavily Extract]  ── Phase 3で実装済み（並列実行、詳細は下記）
      └────────┬────────┘
               ▼
            [Merge]  ── 両分岐の完了を待ち合わせる（Phase 3で実装済み）
               ▼
[Normalize, Dedupe & Structure Output]  ── 検索・抽出結果を構造化JSONにまとめる
      ▼
[Build OpenAI Request]  ── Phase3出力+offeringからOpenAIリクエストを組み立てる（Phase 4）
      ▼
[OpenAI Responses API]  ── Structured Output (json_schema, strict=true)。1実行1回（Phase 4）
      ▼
[Validate & Assemble Report]  ── refusal/incomplete/空/エラー/schema不正/不正参照を判定し、
      │                          Phase3のsourcesと統合してJSON+Markdownを組み立てる（Phase 4）
      ▼
[出力: JSON（meta+report）＋ Markdown]
```

単一ワークフロー内でこれらのノードを直列に接続する。DB・外部ストレージ・
サブワークフロー分割（マルチエージェント化）は行わない。
Form Trigger・Wait（承認・修正・却下）はPhase 5以降の検討事項として、あえて追加していない
（`docs/ROADMAP.md`参照）。

## ノード設計

### 1. Manual Trigger / Fixed Test Input（入力）

- フィールド：`company_name`（企業名）、`official_url`（公式URL）、
  `research_purpose`（調査目的）、`offering`（提案する商品・サービス、Phase 4で追加）
- 固定テスト入力（Set）として実装。Form Trigger（フォームUI）は追加しない
  （デモにはManual Trigger＋固定入力で十分と判断、`docs/ASSUMPTIONS.md`参照）

### 2. Tavily Search（Phase 3で実装済み）

- クエリ：`"{企業名} 会社概要"`（`search_depth: basic`、`max_results: 3`）
- 目的：企業の事業内容に関する情報を最小限のクレジット消費で取得する
- 検索結果はURL・タイトル・スニペットを保持し、後段の出典情報に使う
- 詳細仕様は[docs/TAVILY.md](TAVILY.md)を参照

### 3. Tavily Extract（Phase 3で実装済み）

- 対象：公式URLのみ（`extract_depth: basic`）。Phase 1設計案にあった
  「検索結果上位N件へのExtract拡大」はクレジット消費抑制のためPhase 3では見送った
  （docs/ASSUMPTIONS.md参照）
- 目的：公式サイト本文を取得し、要約・引用の元データとする
- 抽出結果に元URLを保持し、出典として引き継ぐ

### 3.5 Merge（Phase 3で実装済み）

- Tavily Search（入力0）とTavily Extract（入力1）を`mode: combine`
  （`combineBy: combineByPosition`）で受け、両方の完了を待ち合わせる
- n8n 2.36.9では、並列分岐を同一ノードの同一入力へ直接接続すると、
  両分岐の完了を待たずに後続ノードが実行され得ることを実機検証で確認したため、
  明示的な同期点として追加した（詳細はdocs/TAVILY.md、docs/ASSUMPTIONS.md）
- Merge自体の出力内容（フィールド統合結果）は使用せず、後続のCodeノードは
  `$('Tavily Search')`／`$('Tavily Extract')`で個別に参照する

### 4. Normalize, Dedupe & Structure Output（Phase 3で実装済み、旧称Aggregate/Set）

- n8nのCodeノードとして実装（`workflows/sales-research-agent.json`）。
  ロジックは`src/normalize.js`と同一内容を手動で複製している
- URL正規化（ホスト小文字化、末尾スラッシュ・トラッキングパラメータ・フラグメント除去）
  により、同一ページを指す異なるURL表記を統合する
- 正規化後URLで重複排除し、`sources[]`（`id`／`url`／`normalized_url`／`title`／
  `snippet`／`source_type`／`origin`）を構築する
- `source_type`は公式URLとホストが一致すれば`official`、異なれば`external`
- Search/Extractが失敗・空だった場合は、その旨を`search.status`／`extract.status`に
  明示し、架空の情報で補完しない（詳細はdocs/TAVILY.md）

### 5. Build OpenAI Request → OpenAI Responses API → Validate & Assemble Report（Phase 4で実装済み）

- **Build OpenAI Request**（Code）：Phase3の`sources`と`Fixed Test Input`（offering含む）から
  プロンプト文字列とOpenAIリクエストボディを組み立てる。ロジックは`src/openai_request.js`と同一
- **OpenAI Responses API**（HTTP Request）：`POST https://api.openai.com/v1/responses`。
  Structured Output（`text.format`に`type: "json_schema"`, `strict: true`）を使用。
  1実行あたり**1回のみ**呼び出す。詳細は[docs/OPENAI.md](OPENAI.md)を参照
- **Validate & Assemble Report**（Code）：OpenAI応答を検証・分類（`ok`／`refusal`／
  `incomplete`／`empty`／`error`／`invalid_schema`／`invalid_reference`）し、`ok`の場合のみ
  Phase3の`sources`と統合して最終JSON（`{meta, report}`）とMarkdownを組み立てる。
  ロジックは`src/assemble_report.js`・`src/render_markdown.js`と同一。
  LLMに生成させるのは分析部分のみ（`company_profile`のうち`business_overview`/
  `recent_news`/`org_signals`、`proposal_hypotheses`、`discovery_questions`、
  `uncertainties`）とし、`sources`／`company_name`／`official_url`はPhase3の確定値を
  そのまま採用する（URL・社名のハルシネーションを構造的に排除するため）

## データ契約

Phase 4でSchemaを2ファイルに分割した。

- [`schema/sales_research_output.schema.json`](../schema/sales_research_output.schema.json)
  （Phase 1作成）：**最終的に組み立てる`report`**（`sources`＋`company_profile`
  （`company_name`/`official_url`含む）＋`proposal_hypotheses`＋`discovery_questions`＋
  `uncertainties`）の契約。`sources[].title`は`["string","null"]`（Extract由来など
  タイトルを持たない出典を許容）、`sources[]`には`normalized_url`/`snippet`/
  `source_type`/`origin`も定義（Phase3の実データ形状と一致させるため、Phase 4で追加）。
- [`schema/phase4_llm_analysis_output.schema.json`](../schema/phase4_llm_analysis_output.schema.json)
  （Phase 4作成）：**OpenAIに実際に送信するSchema**。上記から`sources`／`company_name`／
  `official_url`を除いた分析部分のみのサブセット。

共通の設計方針：

- **事実**（`company_profile.business_overview`／`recent_news[]`／`org_signals[]`）は
  出典参照として `source_ids`（`sources[].id`の配列）を必須とし、`minItems: 1`とする
- **仮説**（`proposal_hypotheses[]`）は根拠として `evidence_source_ids`を必須とし、
  同じく`minItems: 1`とする。Phase 1では「OpenAI strictモードでの`minItems`対応が
  不明」という理由で見送っていたが、Phase 4でユーザーの判断により採用した。
  実際にOpenAI側で強制されるかは未検証だが、受信側の手書き構造チェック
  （`validatePhase4Schema`、ajv等のライブラリは使わずn8n Codeノードでも動く実装）で
  必ず同じ制約を検証するため、空配列がすり抜けることはない（詳細は
  `docs/ASSUMPTIONS.md`、`docs/OPENAI.md`）
- **商談質問**（`discovery_questions[]`）は出典を持たない、単純な文字列配列とする
  （質問自体は情報の主張ではないため出典の対象外）
- 出典が確認できない事実は `company_profile`／`proposal_hypotheses` に含めず、
  `uncertainties[]`（`note`／`reason`）に分離する
- 出典参照（`source_ids`／`evidence_source_ids`）が実在する`sources[].id`を
  指しているかは、JSON Schemaの検証範囲外のため、`src/assemble_report.js`
  （およびPhase1の`src/validate.js`）のカスタムバリデーションで検証する

### 最終出力

`Validate & Assemble Report`ノードが以下の形を出力する（Wait/承認フローは未実装のため、
生成された時点のものがそのまま最終出力になる）。

```json
{
  "meta": {
    "input": { "company_name": "...", "official_url": "...", "research_purpose": "...", "offering": "..." },
    "generated_at": "...",
    "tavily": { "search": {...}, "extract": {...}, "warnings": [] },
    "llm": { "status": "ok|refusal|incomplete|empty|error|invalid_schema|invalid_reference", "model": "gpt-5.6-terra", "detail": "..." }
  },
  "report": { "...": "llm.status=ok の場合のみ。schema/sales_research_output.schema.json準拠。ok以外はnull" }
}
```

- **JSON**：上記構造。`report`は`sales_research_output.schema.json`準拠、`meta`は
  実行メタ情報（入力の再掲・Tavily/LLMの状態）でSchema制約の対象外
- **Markdown**：`report`が`null`でない場合は企業概要・最近の動き・組織シグナル・
  提案仮説・商談質問・注意事項・出典を見出し付きで整形し、出典を脚注で併記する。
  `report`が`null`の場合は失敗理由のみを簡潔に記載し、架空の内容で補わない

## Waitノードによる承認フロー（Phase 5、未着手）

CLAUDE.mdのMission（デモ完成・案件応募を優先し、必須でない追加開発は停止する）に基づき、
Phase 4完了時点では意図的に着手していない。将来実装する場合の設計案：

- LLM出力後、Waitノードで一時停止する
- 承認者は以下のいずれかを選択する
  1. **承認**：生成内容をそのまま最終出力に採用
  2. **修正**：承認者が内容を編集し、編集後の内容を最終出力に採用
  3. **却下**：最終出力を生成しない（却下ログのみ残す想定）
- 再開方法（Webhook resume／n8n標準のWait機能のどちらを使うか）は着手時に決定する

## 秘密情報の扱い

- OpenAI APIキー、Tavily APIキーは、いずれもn8nのCredential機能（Generic Credential Type
  「HTTP Header Auth」）で管理し、ワークフロー本体・`.env`には値を書かない
  （Tavily・OpenAIとも同じ方式に統一。許可ドメインをそれぞれ`api.tavily.com`／
  `api.openai.com`に限定する）
- `N8N_ENCRYPTION_KEY`等、n8n自体の設定値は`.env`（Git管理対象外）で管理する
- n8nワークフローのエクスポートJSONに認証情報が埋め込まれないよう、
  Credentialsはn8nのCredential機能を使い、ワークフロー本体には値を書かない

## OpenAI Structured Output（strict=true）との構造整合性チェック（Phase 4更新）

`schema/phase4_llm_analysis_output.schema.json`（実際にOpenAIへ送信するSchema）について、
Structured Output strictモードで一般に要求される構造要件を目視で確認した。

**確認できた点（スキーマファイル内で自己完結的に検証可能な事項）**：

- ルート、および`company_profile`／`business_overview`／`recent_news`の要素／
  `org_signals`の要素／`proposal_hypotheses`の要素／`uncertainties`の要素の
  すべてのobject型ノードに`"additionalProperties": false`が設定されている
- 上記すべてのobject型ノードで、`properties`に定義した全キーが`required`にも
  含まれている
- リクエストボディは`{"name": "...", "strict": true, "schema": {...}}`という
  実際のAPIリクエストに必要な外側のラップ構造（`text.format`）を含んでいる
  （`src/openai_request.js`／`docs/OPENAI.md`参照）

**断定しないこと（Phase 4でも未検証）**：

- `source_ids`／`evidence_source_ids`の`minItems: 1`が実際にOpenAI側で
  強制されるかは**未検証**（Phase 4はn8n/OpenAI/Tavilyへの実通信を行わない方針のため）。
  仮に強制されなくても、受信側の手書き構造チェック（`validatePhase4Schema`）で
  同じ制約を必ず検証するため、空配列がすり抜けることはない
- `$schema: draft-07`という宣言がOpenAI側でそのまま許容されるかも未確認

→ 実際の互換性確認は、ユーザーがCredentialを割り当てて実行するまで行われない。

## 未確定事項

- Wait再開の具体的な実装方式（Webhook／フォーム、Phase 5で決定）
- Markdownレポートのテンプレート詳細のさらなる改善（Phase 5以降、必要になった場合）

Tavily Search/Extractの検索件数・抽出件数の上限はPhase 3で確定した
（`docs/TAVILY.md`参照。Search: `max_results=3`、Extract: 公式URL1件のみ）。
