# 商談準備AIエージェント（sales-research-agent）

BtoB営業担当者が「企業名・公式URL・自社サービス」を入力すると、公開情報を調査し、
出典付きの企業情報・提案仮説・商談質問を生成、人間承認を経てJSON/Markdownレポートを
出力するn8nワークフローのMVP。

## ステータス

現在 **Phase 2（n8nローカル実行環境）** に着手中。Phase 1（Structured Output契約）は完了。
n8nはDocker Composeでローカル起動できるようになったが、OpenAI／Tavilyへの実通信、
n8nワークフロー本体の実装はまだ行っていない。

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
│   ├── DOCKER.md
│   └── ASSUMPTIONS.md
└── .github/
    ├── workflows/
    │   └── test.yml
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.md
    │   └── feature_request.md
    └── pull_request_template.md
```

（n8nワークフロー定義（`workflows/`等）はPhase 3以降で追加予定。）
