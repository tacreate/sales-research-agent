# 商談準備AIエージェント（sales-research-agent）

BtoB営業担当者が「企業名・公式URL・自社サービス」を入力すると、公開情報を調査し、
出典付きの企業情報・提案仮説・商談質問を生成、人間承認を経てJSON/Markdownレポートを
出力するn8nワークフローのMVP。

## ステータス

現在 **Phase 0（プロジェクト初期化・環境確認・設計文書化のみ）** が完了。
n8nワークフロー本体はまだ実装していない。

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
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — ワークフロー設計・データ契約（JSON Schema案）
- [docs/ROADMAP.md](docs/ROADMAP.md) — 開発フェーズ計画
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — 環境確認結果
- [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) — Phase 0で行った仮定の記録

## セットアップ（Phase 1以降で使用予定）

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
├── .env.example
├── .gitignore
├── docs/
│   ├── REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── ENVIRONMENT.md
│   └── ASSUMPTIONS.md
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.md
    │   └── feature_request.md
    └── pull_request_template.md
```

（`docker-compose.yml`、`workflows/`等はPhase 1で追加予定。Phase 0ではまだ作成していない。）
