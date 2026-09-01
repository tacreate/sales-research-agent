# 開発フェーズ計画

## Phase 0 — プロジェクト初期化（完了）

- ディレクトリ作成、環境確認（Docker／Git／GitHub CLI）
- 要件・アーキテクチャ・受入条件の文書化
- `.gitignore`／`.env.example`／README／Issue・PRテンプレート作成
- ローカルGit初期化とコミット
- レビュー修正：Git authorをこのリポジトリ限定でGitHub noreplyアドレスへ変更、
  Schema設計を`source_ids`／`evidence_source_ids`／`uncertainties`ベースへ修正
- GitHubリポジトリ作成・push・PR・Issue登録は本フェーズでは行わない
  （Phase 1から開始）

## Phase 1 — Structured Output契約の確立（GitHub運用開始・完了）

- 固定サンプル（fixture）を用いたJSON Schema契約の確立
  - n8n／Docker／OpenAI／Tavilyへの実通信は行わない
- `schema/sales_research_output.schema.json`を独立ファイルとして作成
- 正常系・必須項目欠落・出典参照不正・仮説の根拠欠落のfixtureを作成
- JSON Schema検証に加え、`source_ids`／`evidence_source_ids`の参照整合性を
  検証するカスタムバリデーションを実装
- Node.js（`node:test`＋最小限の依存関係）で検証を自動テスト化
- GitHub CLI認証確認 → 個人アカウントに公開リポジトリ作成 → Phase 0をpush
- Phase 1用Issue作成、featureブランチで実装、テスト成功後にPR作成（マージはしない）

## Phase 2 — n8nローカル実行環境（Docker）

- Docker Desktopのインストール（人間の作業、完了）
- n8n公式イメージの安定版（`n8nio/n8n:2.36.9`）への固定、Apple silicon対応確認
- `docker-compose.yml`作成、n8nのローカル起動確認（`localhost:5678`のみ、named volumeで永続化）
- `N8N_ENCRYPTION_KEY`等の秘密値の安全な取り扱い方針の実装
- n8n Credentialsの設定手順の文書化はPhase 3以降（実際にCredentialsを使うタイミング）で行う

## Phase 3 — Tavily情報取得

- Manual Triggerから固定テスト入力（企業名／公式URL／調査目的）を受ける
- Tavily Search（search_depth=basic、max_results=3）／Extract（公式URLのみ、
  extract_depth=basic）の実装
- URL正規化・重複排除、公式情報／外部情報の区別、後続LLM向け構造化JSONへの整形
- API失敗・検索結果0件・Extract失敗を明示的な状態として出力（架空情報で補完しない）
- workflow JSON（`workflows/phase3-tavily-research.json`）をリポジトリで管理、
  Credential未選択でもimport可能な状態を維持
- 正規化・重複排除ロジックを`src/normalize.js`として独立させ、固定fixtureで自動テスト
- 実際のTavily API呼び出しは、ユーザーがn8n画面で「Tavily API」Credentialを
  割り当てるまで行わない

## Phase 4 — LLM生成の実装

- n8n上にForm Trigger／OpenAI Responses APIノードを追加
- OpenAI Responses APIへのリクエスト実装（Phase 1で確立したJSON Schema、strict=true）
- Phase 3の`sources`をLLM入力として渡し、出典付き出力の検証（受入条件3・4）を実データで確認

## Phase 5 — 承認フローの実装

- Waitノードの実装、承認・修正・却下の分岐実装
- 承認後のJSON／Markdown出力実装
- 却下時の挙動実装

## Phase 6 — 検証・仕上げ

- 受入条件（REQUIREMENTS.md）に基づく一通りの動作確認
- エラーハンドリング（API失敗、スキーマ不一致等）の最低限の対応
- 運用ドキュメントの整備、Issueクローズ・最終PRのレビュー依頼

## 備考

- 各フェーズの区切りは目安であり、実装しながら前後する可能性がある
- スコープ外事項（DB、RAG、マルチエージェント、独自UI、PDF）はどのフェーズでも追加しない
- GitHub運用（リポジトリ作成、Issue、ブランチ、PR）はPhase 1以降、各フェーズごとに
  Issue／featureブランチ／PRの単位を保つ
