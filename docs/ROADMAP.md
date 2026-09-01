# 開発フェーズ計画

## Phase 0 — プロジェクト初期化（完了）

- ディレクトリ作成、環境確認（Docker／Git／GitHub CLI）
- 要件・アーキテクチャ・受入条件の文書化
- `.gitignore`／`.env.example`／README／Issue・PRテンプレート作成
- ローカルGit初期化とコミット
- GitHubリポジトリ作成・push・PR・Issue登録は**未実施**

## Phase 1 — 環境構築とスケルトン実装

- Docker（Docker Desktop等）のインストール（人間の作業）
- `docker-compose.yml`作成、n8nのローカル起動確認
- n8n上でForm Trigger〜Tavily〜OpenAI〜Wait〜出力までのノードを配置
  （実データでの動作確認は次フェーズ）
- n8n Credentialsの設定手順を文書化

## Phase 2 — 調査・生成ロジックの実装

- Tavily Search／Extractの実クエリ設計・パラメータ確定
- OpenAI Responses APIへのリクエスト実装（JSON Schema、strict=true）
- 出典付き出力の検証（受入条件3・4）

## Phase 3 — 承認フローの実装

- Waitノードの実装、承認・修正・却下の分岐実装
- 承認後のJSON／Markdown出力実装
- 却下時の挙動実装

## Phase 4 — 検証・仕上げ

- 受入条件（REQUIREMENTS.md）に基づく一通りの動作確認
- エラーハンドリング（API失敗、スキーマ不一致等）の最低限の対応
- GitHubリポジトリ作成、Issue登録、push、PR作成（人間承認のうえ実施）

## 備考

- 各フェーズの区切りは目安であり、実装しながら前後する可能性がある
- スコープ外事項（DB、RAG、マルチエージェント、独自UI、PDF）はどのフェーズでも追加しない
