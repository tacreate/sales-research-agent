# アーキテクチャ設計（Phase 1実装用の設計案）

本ドキュメントはPhase 0時点での設計案であり、n8nワークフロー本体はまだ実装していない。
Phase 1着手時にこの設計を出発点として実装・調整する。

## 全体構成

```
[Form Trigger]
      │  企業名 / 公式URL / 自社サービス概要
      ▼
[Tavily Search]  ── 企業名・公式ドメインを軸にニュース・IR等を検索
      ▼
[Tavily Extract] ── 公式サイト＋検索結果上位URLの本文を取得
      ▼
[Aggregate/Set]  ── 検索・抽出結果を1つのコンテキストにまとめる
      ▼
[HTTP Request: OpenAI Responses API]
      │  Structured Output (JSON Schema, strict=true)
      ▼
[Wait: 人間承認]  ── 承認 / 修正 / 却下
      ▼
   ┌──┴───────────────┐
   │承認・修正            │却下
   ▼                  ▼
[出力: JSON + Markdown]   [終了（出力なし／却下ログ）]
```

単一ワークフロー内でこれらのノードを直列に接続する。DB・外部ストレージ・
サブワークフロー分割（マルチエージェント化）は行わない。

## ノード設計

### 1. Form Trigger（入力）

- フィールド：企業名（テキスト）、公式URL（URL）、自社サービス概要（複数行テキスト）
- すべて必須項目とする

### 2. Tavily Search

- クエリ例：`"{企業名}" 会社概要 OR ニュース OR IR`、`"{企業名}" 採用`
- 目的：企業の事業内容・最近の動き・組織シグナル（採用状況等）を広く拾う
- 検索結果はURL・タイトル・スニペットを保持し、後段の出典情報に使う

### 3. Tavily Extract

- 対象：公式URL、および検索結果の上位N件
- 目的：本文を取得し、要約・引用の元データとする
- 各抽出結果に元URLを保持し、出典として引き継ぐ

### 4. Aggregate / Set

- 検索・抽出結果を、後続のLLM入力用に1つのテキスト/JSON構造にまとめる
- 各情報片に出典URLを紐付けたまま保持する（LLMが出典を引用できるようにするため）

### 5. HTTP Request: OpenAI Responses API

- Structured Output（JSON Schema、`strict: true`）で以下を強制する
- モデル・具体的なリクエストパラメータはPhase 1で確定する
  （本ドキュメントでは出力契約のみを定義する）

## データ契約

### LLM出力 JSON Schema

正本は独立ファイル [`schema/sales_research_output.schema.json`](../schema/sales_research_output.schema.json)
（Phase 1で作成）。本ドキュメントでは設計方針のみを記す。

- トップレベルに `sources`（出典一覧。各出典は `id`／`url`／`title` を持つ）を持ち、
  他のフィールドはURLを直接埋め込まず `sources[].id` を参照する
- **事実**（`company_profile.business_overview`／`recent_news[]`／`org_signals[]`）は
  出典参照として `source_ids`（`sources[].id`の配列）を必須とする
- **仮説**（`proposal_hypotheses[]`）は根拠として `evidence_source_ids`
  （`sources[].id`の配列）を必須とする。空配列（根拠ゼロ件）は業務ルール違反として
  スキーマ検証とは別の参照整合性チェックで弾く（詳細はPhase 1の`schema/README.md`参照）
- **商談質問**（`discovery_questions[]`）は出典を持たない、単純な文字列配列とする
  （質問自体は情報の主張ではないため出典の対象外）
- 出典が確認できない事実は `company_profile`／`proposal_hypotheses` に含めず、
  `uncertainties[]`（`note`／`reason`）に分離する
- OpenAI Responses APIのStructured Output（`strict: true`）との互換性を優先し、
  スキーマ本体には`minItems`等のstrictモード非対応キーワードを使わない。
  「仮説の根拠が1件以上必要」という業務ルールはJSON Schemaではなく
  アプリケーション側の参照整合性チェックで担保する
- 出典参照（`source_ids`／`evidence_source_ids`）が実在する`sources[].id`を
  指しているかは、JSON Schemaの検証範囲外のため、Phase 1で作成する
  カスタムバリデーション（`src/validate.js`想定）で別途検証する

### 最終出力（承認後）

- **JSON**：上記スキーマの内容 ＋ メタ情報（`generated_at`、`input_echo`、承認ステータス、
  修正があればその差分）
- **Markdown**：人間可読なレポート。企業概要・提案仮説・商談質問を見出し付きで整形し、
  各情報の出典URLを脚注または括弧書きで併記する

## Waitノードによる承認フロー

- LLM出力後、Waitノードで一時停止する
- 承認者は以下のいずれかを選択する
  1. **承認**：生成内容をそのまま最終出力に採用
  2. **修正**：承認者が内容を編集し、編集後の内容を最終出力に採用
  3. **却下**：最終出力を生成しない（却下ログのみ残す想定）
- 再開方法（Webhook resume／n8n標準のWait機能のどちらを使うか）はPhase 1で確定する

## 秘密情報の扱い

- OpenAI APIキー、Tavily APIキーはすべて環境変数経由（`.env`）でn8nに渡す
- `.env`実体はGit管理対象外。リポジトリには`.env.example`のみを含める
- n8nワークフローのエクスポートJSONに認証情報が埋め込まれないよう、
  Credentialsはn8nのCredential機能を使い、ワークフロー本体には値を書かない

## OpenAI Structured Output（strict=true）との構造整合性チェック（Phase 1レビュー）

`schema/sales_research_output.schema.json`について、OpenAI Responses APIの
Structured Output strictモードで一般に要求される構造要件を目視で確認した。

**確認できた点（スキーマファイル内で自己完結的に検証可能な事項）**：

- ルート、および`sources`／`company_profile`／`business_overview`／`recent_news`の要素／
  `org_signals`の要素／`proposal_hypotheses`の要素／`uncertainties`の要素の
  すべてのobject型ノードに`"additionalProperties": false`が設定されている
- 上記すべてのobject型ノードで、`properties`に定義した全キーが`required`にも
  含まれている（プロパティ数と`required`配列の要素数が一致）
- `minItems`／`pattern`／`format`等、strictモードで非対応とされることが多いキーワードは
  使用していない

**断定しないこと（Phase 1では未検証）**：

- 上記は「一般に言われているstrictモードの制約」に対する構造上の自己チェックであり、
  実際にOpenAI Responses APIへこのスキーマを送信して受理されるかどうかは
  **未検証**（Phase 1はn8n/Docker/OpenAI/Tavilyへの実通信を行わない方針のため）
- `$schema: draft-07`という宣言や`description`キーワードの併用がOpenAI側で
  そのまま許容されるかも未確認
- 本ファイルはあくまで「schema」部分のみであり、実際のAPIリクエストに必要な
  `{"name": "...", "strict": true, "schema": {...}}`という外側のラップ構造は
  含んでいない（Phase 4で実装時に確定）

→ 実際の互換性確認はPhase 4（OpenAI Responses APIへの実接続）で行う。

## 未確定事項（Phase 1で決定）

- OpenAIのモデル名・温度等のパラメータ
- Tavily Search/Extractの検索件数・抽出件数の上限
- Wait再開の具体的な実装方式（Webhook／フォーム）
- Markdownレポートのテンプレート詳細
