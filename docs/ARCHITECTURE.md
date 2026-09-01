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

## データ契約（案）

### LLM出力 JSON Schema（案）

Phase 1で実装時に微調整する前提の設計案。

```json
{
  "name": "sales_research_output",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "company_profile": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "company_name": { "type": "string" },
          "official_url": { "type": "string" },
          "business_overview": { "type": "string" },
          "recent_news": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "summary": { "type": "string" },
                "source_url": { "type": "string" }
              },
              "required": ["summary", "source_url"]
            }
          },
          "org_signals": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "signal": { "type": "string" },
                "source_url": { "type": "string" }
              },
              "required": ["signal", "source_url"]
            }
          }
        },
        "required": ["company_name", "official_url", "business_overview", "recent_news", "org_signals"]
      },
      "proposal_hypotheses": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "hypothesis": { "type": "string" },
            "rationale": { "type": "string" },
            "supporting_source_urls": {
              "type": "array",
              "items": { "type": "string" }
            }
          },
          "required": ["hypothesis", "rationale", "supporting_source_urls"]
        }
      },
      "discovery_questions": {
        "type": "array",
        "items": { "type": "string" }
      },
      "caveats": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "required": ["company_profile", "proposal_hypotheses", "discovery_questions", "caveats"]
  }
}
```

- `source_url` を必須にすることで「出典なし情報」の生成を構造レベルで防ぐ
- `caveats` は情報が不足・矛盾する場合にLLMが明示するためのフィールド

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

## 未確定事項（Phase 1で決定）

- OpenAIのモデル名・温度等のパラメータ
- Tavily Search/Extractの検索件数・抽出件数の上限
- Wait再開の具体的な実装方式（Webhook／フォーム）
- Markdownレポートのテンプレート詳細
