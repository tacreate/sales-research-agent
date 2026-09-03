# 営業前企業調査エージェント（sales-research-agent）

BtoB営業担当者が「企業名・公式URL・調査目的・提案する商品/サービス（offering）」を
入力すると、公開情報を調査し、事実と仮説を分離した出典付きの企業情報・提案仮説・
商談質問を生成し、構造化JSON／Markdownレポートを出力するn8nワークフローのMVP。

## ステータス

現在 **Phase 4（OpenAIによる企業分析生成）** まで完了。Phase 1（Structured Output契約）・
Phase 2（n8nローカル実行環境）・Phase 3（Tavily情報取得）も完了。
Tavily・OpenAIとも認証情報（Credential）が未割り当てのため、実際のAPI呼び出しは
ユーザーがn8n画面でCredentialを割り当てるまで行っていない。
Form Trigger・Human-in-the-loop（Wait/承認フロー）はPhase 5として意図的に未着手
（CLAUDE.mdのMissionに基づき、デモ完成・案件応募を優先するため）。

## スコープ（MVP）

- 単一のn8nワークフロー
- 入力：固定テスト入力（企業名／公式URL／調査目的／offering=提案する商品・サービス）
- 調査：Tavily Search／Extract API（1実行あたりSearch1回・Extract1回）
- 生成：OpenAI Responses API（HTTP Requestノード、Structured Output / JSON Schema / strict=true、
  1実行あたり1回のみ）
- 出力：構造化JSON（`{meta, report}`）とMarkdownレポート

**対象外**：Form Trigger、Wait/HITL（Phase 5）、DB、RAG、マルチエージェント、独自UI、PDF出力。

## 前提環境

| ツール | 用途 | 状態（確認日: 2026-09-01） |
|---|---|---|
| Docker / Docker Compose | n8nのローカル実行 | あり（Docker Desktop、Apple silicon対応） |
| Git | バージョン管理 | あり（2.50.1） |
| GitHub CLI (gh) | リポジトリ・Issue・PR操作 | あり（2.97.0） |

詳細は [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) を参照。

## ドキュメント

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — MVP要件・受入条件
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — ワークフロー設計・データ契約
- [docs/ROADMAP.md](docs/ROADMAP.md) — 開発フェーズ計画（Phase 0〜6）
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — 環境確認結果
- [docs/DOCKER.md](docs/DOCKER.md) — n8nイメージバージョン選定・Apple silicon対応確認・構成方針
- [docs/TAVILY.md](docs/TAVILY.md) — Tavily Search/Extract API仕様、認証方式、呼び出し上限
- [docs/OPENAI.md](docs/OPENAI.md) — OpenAI Responses API仕様、認証方式、モデル・料金、失敗検知方針
- [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) — 各フェーズで行った仮定の記録

## Structured Output契約の検証（Phase 1）

`schema/sales_research_output.schema.json` がLLM出力のJSON Schema契約。
固定サンプル（`fixtures/`）を使い、Node.jsでスキーマ検証と出典参照の整合性検証を行う。
外部API・n8n・Dockerへの実通信は行わない。

```bash
npm install
npm test
```

- スキーマ検証：[ajv](https://ajv.js.org/)によるJSON Schema準拠チェック
  （未定義フィールドは`additionalProperties: false`で拒否）
- 業務ルール検証（`src/validate.js`、JSON Schemaでは表現できない事項）：
  - `sources[].id`の重複拒否
  - `source_ids`／`evidence_source_ids`が実在する`sources[].id`を参照しているか
  - 仮説の根拠（`evidence_source_ids`）が1件以上あるか（空配列を拒否）
- fixture 7種（正常系1・異常系6）で上記を検証（`fixtures/`）

`src/normalize.js`（Phase 3、Tavily結果の正規化・重複排除・構造化）は
`fixtures/tavily/`の固定fixture（正常系・検索結果0件・検索失敗・Extract失敗等、
Search/Extractの主要な組み合わせを網羅）で検証する。

`src/openai_request.js`（Phase 4、OpenAI Responses APIリクエスト構築）・
`src/assemble_report.js`（Phase 4、LLM応答の検証・統合、ajv等は使わない手書きの構造チェック）・
`src/render_markdown.js`（Phase 4、Markdownレポートの決定的生成）は
`fixtures/openai/`の固定fixture（正常系・refusal・incomplete・空出力・APIエラー・
schema不正・不正source参照の7種）で検証する。実際のOpenAI/Tavily API呼び出しは行わない。

n8nワークフロー内のCodeノードは、これら`src/*.js`と同一ロジックを手動で複製しているため
（n8n Codeノードは外部モジュール（ajv等）をimportできないため）、
`test/workflow-sync.test.js`でworkflow側のロジックを実際に実行し、
`src/*.js`と同じfixtureに対して同じ出力になることを自動検証する
（手動同期の漏れを検出する）。

## CI

`.github/workflows/test.yml`により、push・PR作成時にGitHub Actions上で
Node.js（`lts/*`）で`npm ci` → `npm test`を自動実行する。外部API・n8n・Dockerは使用しない。

## n8nワークフロー：営業前企業調査エージェント（Phase 3〜4）

`workflows/sales-research-agent.json`（workflow名「営業前企業調査エージェント」）に、
Manual Trigger〜Tavily Search／Extract〜Merge〜正規化・構造化〜OpenAIによる分析生成〜
検証・統合〜Markdown生成までを実装している。Form Trigger・Human-in-the-loop（Wait/承認）
はPhase 5として意図的に含めていない。

### workflowのインポート

n8n画面（[http://localhost:5678](http://localhost:5678)）の「Import from File」から
`workflows/sales-research-agent.json`を読み込む。認証情報は未設定の状態でインポートされる。

### 既存のTavily・OpenAI認証情報の割り当て（ユーザー操作）

以下2つのCredentialは**作成済み**の前提。新規作成やAPIキーの再取得は不要。

- 「Tavily API」（Header Auth、Header Name: `Authorization`、Value: `Bearer <Tavilyキー>`、
  許可ドメイン: `api.tavily.com`）
- 「OpenAI API」（Header Auth、Header Name: `Authorization`、Value: `Bearer <OpenAIキー>`、
  許可ドメイン: `api.openai.com`）※**ChatGPT Plus等のサブスクリプションとは別に、
  OpenAI APIの課金設定（[platform.openai.com](https://platform.openai.com/)側での
  支払い方法登録）が必要（詳細は[docs/OPENAI.md](docs/OPENAI.md)）

1. 「Tavily Search」「Tavily Extract」ノードそれぞれで、「Credential for Header Auth」欄から
   既存の**「Tavily API」**を選択する
2. 「OpenAI Responses API」ノードで、同様に既存の**「OpenAI API」**を選択する
3. 「Test workflow」で実行する（初回実行でTavily・OpenAI両方の課金が発生する点に注意）

APIキー自体はn8nのCredentialとして暗号化保存されるのみで、リポジトリには一切含まれない。

### 出力の構造（概要）

`Validate & Assemble Report`ノードの出力：

```json
{
  "meta": {
    "input": { "company_name": "...", "official_url": "...", "research_purpose": "...", "offering": "..." },
    "generated_at": "2026-09-03T00:00:00.000Z",
    "tavily": { "search": { "status": "ok|empty|error" }, "extract": { "status": "ok|empty|error" }, "warnings": [] },
    "llm": { "status": "ok|refusal|incomplete|empty|error|invalid_schema|invalid_reference", "model": "gpt-5.6-terra", "detail": null }
  },
  "report": {
    "sources": [{ "id": "src1", "url": "...", "title": "...", "source_type": "official|external" }],
    "company_profile": { "company_name": "...", "official_url": "...", "business_overview": {}, "recent_news": [], "org_signals": [] },
    "proposal_hypotheses": [{ "hypothesis": "...", "rationale": "...", "evidence_source_ids": ["src1"] }],
    "discovery_questions": ["..."],
    "uncertainties": []
  },
  "markdown": "# ... 商談準備レポート ..."
}
```

`meta.llm.status`が`ok`以外の場合、`report`は`null`（架空の分析結果で補わない）。
詳細な仕様・API呼び出し上限は[docs/TAVILY.md](docs/TAVILY.md)・[docs/OPENAI.md](docs/OPENAI.md)を参照。

## n8nローカル実行環境（Phase 2）

n8nはDocker Composeでローカル起動する。バージョン選定・Apple silicon対応の確認結果は
[docs/DOCKER.md](docs/DOCKER.md)を参照。`localhost:5678`のみで利用し、外部には公開しない。

### 初回セットアップ

```bash
cp .env.example .env
```

`.env`の`N8N_ENCRYPTION_KEY`に、以下で生成した値を設定する（表示・共有・コミットしないこと）。

```bash
openssl rand -hex 32
```

OpenAI／Tavilyの`OPENAI_API_KEY`／`TAVILY_API_KEY`はPhase 2時点ではまだ設定不要（空のままでよい）。

`.env` はGit管理対象外（`.gitignore`参照）。実際の値は絶対にコミットしない。

### 起動

```bash
docker compose up -d
```

起動後、ブラウザで [http://localhost:5678](http://localhost:5678) を開き、
n8nの初回セットアップ（オーナーアカウント作成）を行う（ユーザー自身の操作）。

### 停止

```bash
docker compose down
```

（`-v`オプションは付けない。付けるとnamed volumeごとデータが削除される）

### ログ確認

```bash
docker compose logs -f n8n
```

### 再起動

```bash
docker compose restart
```

named volume（`n8n_data`）にデータが永続化されているため、再起動してもn8n上で作成した
設定・ワークフローは失われない。

## ディレクトリ構成

```
sales-research-agent/
├── README.md
├── package.json
├── docker-compose.yml
├── .env.example
├── .gitignore
├── schema/
│   ├── sales_research_output.schema.json
│   └── phase4_llm_analysis_output.schema.json
├── fixtures/
│   ├── valid.json
│   ├── missing_required_field.json
│   ├── invalid_source_reference.json
│   ├── hypothesis_missing_evidence.json
│   ├── duplicate_source_ids.json
│   ├── unknown_field.json
│   ├── invalid_evidence_reference.json
│   ├── tavily/
│   │   ├── input.json
│   │   ├── search_ok.json
│   │   ├── search_empty.json
│   │   ├── search_error.json
│   │   ├── extract_ok.json
│   │   ├── extract_error.json
│   │   └── extract_failed_results.json
│   └── openai/
│       ├── input.json
│       ├── tavily_output_ok.json
│       ├── analysis_ok.json
│       ├── response_ok.json
│       ├── response_refusal.json
│       ├── response_incomplete.json
│       ├── response_empty.json
│       ├── response_api_error.json
│       ├── response_invalid_schema.json
│       └── response_invalid_reference.json
├── workflows/
│   └── sales-research-agent.json
├── src/
│   ├── validate.js
│   ├── normalize.js
│   ├── openai_request.js
│   ├── assemble_report.js
│   └── render_markdown.js
├── test/
│   ├── validate.test.js
│   ├── normalize.test.js
│   ├── openai_request.test.js
│   ├── assemble_report.test.js
│   ├── render_markdown.test.js
│   └── workflow-sync.test.js
├── docs/
│   ├── REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── ENVIRONMENT.md
│   ├── DOCKER.md
│   ├── TAVILY.md
│   ├── OPENAI.md
│   └── ASSUMPTIONS.md
└── .github/
    ├── workflows/
    │   └── test.yml
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.md
    │   └── feature_request.md
    └── pull_request_template.md
```

（OpenAI連携・Human-in-the-loop・レポート生成部分はPhase 4以降で追加予定。）
