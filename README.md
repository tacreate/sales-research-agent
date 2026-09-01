# 商談準備AIエージェント（sales-research-agent）

BtoB営業担当者が「企業名・公式URL・自社サービス」を入力すると、公開情報を調査し、
出典付きの企業情報・提案仮説・商談質問を生成、人間承認を経てJSON/Markdownレポートを
出力するn8nワークフローのMVP。

## ステータス

現在 **Phase 1（Structured Output契約の確立）** に着手中。
n8n／Docker／OpenAI／Tavilyへの実通信はまだ行っておらず、固定サンプル（fixture）による
JSON Schema契約の検証のみを行っている。n8nワークフロー本体はまだ実装していない。

## スコープ（MVP）

- 単一のn8nワークフロー
- 入力：n8n Form Trigger（企業名／公式URL／自社サービス概要）
- 調査：Tavily Search／Extract API
- 生成：OpenAI Responses API（HTTP Requestノード、Structured Output / JSON Schema / strict=true）
- 承認：Waitノードによる人間の承認・修正・却下
- 出力：承認後にJSONとMarkdownレポート

**対象外**：DB、RAG、マルチエージェント、独自UI、PDF出力。

## 前提環境

| ツール | 用途 | 状態（確認日: 2026-09-01） |
|---|---|---|
| Docker / Docker Compose | n8nのローカル実行 | 未インストール（本機に無し） |
| Git | バージョン管理 | あり（2.50.1） |
| GitHub CLI (gh) | リポジトリ・Issue・PR操作 | あり（2.97.0） |

Docker未インストールのため、Phase 0時点ではn8nコンテナは起動していない。
詳細は [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) を参照。

## ドキュメント

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — MVP要件・受入条件
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — ワークフロー設計・データ契約
- [docs/ROADMAP.md](docs/ROADMAP.md) — 開発フェーズ計画（Phase 0〜6）
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — 環境確認結果
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

## CI

`.github/workflows/test.yml`により、push・PR作成時にGitHub Actions上で
Node.js（`lts/*`）で`npm ci` → `npm test`を自動実行する。外部API・n8n・Dockerは使用しない。

## セットアップ（Phase 2以降で使用予定）

```bash
cp .env.example .env
# .env にAPIキー等の実値を設定する（コミット禁止）
docker compose up -d
```

`.env` はGit管理対象外（`.gitignore`参照）。実際のAPIキーは絶対にコミットしない。

## ディレクトリ構成

```
sales-research-agent/
├── README.md
├── package.json
├── .env.example
├── .gitignore
├── schema/
│   └── sales_research_output.schema.json
├── fixtures/
│   ├── valid.json
│   ├── missing_required_field.json
│   ├── invalid_source_reference.json
│   ├── hypothesis_missing_evidence.json
│   ├── duplicate_source_ids.json
│   ├── unknown_field.json
│   └── invalid_evidence_reference.json
├── src/
│   └── validate.js
├── test/
│   └── validate.test.js
├── docs/
│   ├── REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── ENVIRONMENT.md
│   └── ASSUMPTIONS.md
└── .github/
    ├── workflows/
    │   └── test.yml
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.md
    │   └── feature_request.md
    └── pull_request_template.md
```

（`docker-compose.yml`、`workflows/`等はPhase 2以降で追加予定。）
