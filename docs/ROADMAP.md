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

## Phase 3 — Tavily情報取得（完了）

- Manual Triggerから固定テスト入力（企業名／公式URL／調査目的）を受ける
- Tavily Search（search_depth=basic、max_results=3）／Extract（公式URLのみ、
  extract_depth=basic）の実装
- URL正規化・重複排除、公式情報／外部情報の区別、後続LLM向け構造化JSONへの整形
- API失敗・検索結果0件・Extract失敗を明示的な状態として出力（架空情報で補完しない）
- workflow JSON（`workflows/sales-research-agent.json`）をリポジトリで管理、
  Credential未選択でもimport可能な状態を維持
- 正規化・重複排除ロジックを`src/normalize.js`として独立させ、固定fixtureで自動テスト
- 実際のTavily API呼び出しは、ユーザーがn8n画面で「Tavily API」Credentialを
  割り当てるまで行わない

## Phase 4 — OpenAIによる企業分析生成（完了）

CLAUDE.mdのMission（案件応募に使えるデモを最短で作る）に基づき、当初計画にあった
「Form Trigger追加」は見送り、Manual Trigger＋固定テスト入力のまま最小構成で実装した。

- 入力に`offering`（提案する商品・サービス）を追加
- Tavily Searchのクエリを企業概要＋最近の動き向けに変更（呼び出し回数は1回のまま）
- `schema/phase4_llm_analysis_output.schema.json`を新規作成
  （LLMが生成する分析部分のみ。`source_ids`／`evidence_source_ids`は`minItems: 1`、
  全object `additionalProperties: false`）
- OpenAI Responses APIへのリクエスト実装（`src/openai_request.js`、
  model: `gpt-5.6-terra`、`reasoning.effort: low`、`max_output_tokens: 4000`、
  1実行あたり1回のみ）
- LLM応答の検証・統合（`src/assemble_report.js`）：refusal／incomplete／空出力／
  APIエラー／schema不正／不正source参照を明示的に検出し、`ok`以外はreportをnullにする
  （架空情報で補わない）。ajv等の外部ライブラリはn8n Codeノードで使えないため、
  手書きの構造チェックのみで実装
- Markdownレポート生成（`src/render_markdown.js`、LLMを使わない決定的処理）
- workflowを`workflows/phase3-tavily-research.json`から
  `workflows/sales-research-agent.json`へリネーム、workflow名を
  「営業前企業調査エージェント」に変更
- OpenAI Credentialの許可ドメインを`api.openai.com`に限定する方針を採用（Tavilyと同じ方式）
- 実際のOpenAI/Tavily API呼び出しは、ユーザーがCredentialを割り当てるまで行わない

## Phase 5 — 承認フローの実装（未着手、CLAUDE.mdのMissionに基づき保留）

CLAUDE.mdの判断ルール（デモに必須でない追加開発は停止する）に基づき、Phase 4完了後は
本フェーズに進まず、デモ整備・案件応募を優先する。実際の案件応募・顧客反応によって
必要性が確認された場合にのみ着手を検討する。

- Waitノードの実装、承認・修正・却下の分岐実装
- 承認後のJSON／Markdown出力実装
- 却下時の挙動実装

## Phase 6 — 検証・仕上げ（未着手、Phase 5と同様に保留）

- 受入条件（REQUIREMENTS.md）に基づく一通りの動作確認
- エラーハンドリング（API失敗、スキーマ不一致等）の最低限の対応
- 運用ドキュメントの整備、Issueクローズ・最終PRのレビュー依頼

## Phase 4完了後の優先事項（CLAUDE.md Mission）

Phase 4の完了により「事実と仮説を分離し、出典を追跡できる企業調査＋商談準備資料生成」
というMVPの中核機能が動くデモとして完成した。CLAUDE.mdの成果の定義・判断ルールに従い、
これ以降は機能追加よりも次を優先する。

1. デモとして提示できる状態の整備（README・実行手順の最終確認等）
2. 実際の案件への応募・提案
3. 顧客反応の確認
4. 反応・不具合に基づいてのみ、Phase 5以降や追加機能を検討する

## 備考

- 各フェーズの区切りは目安であり、実装しながら前後する可能性がある
- スコープ外事項（DB、RAG、マルチエージェント、独自UI、PDF、Form Trigger）は
  実際の案件応募・顧客反応で必要性が確認されるまで追加しない
- GitHub運用（リポジトリ作成、Issue、ブランチ、PR）はPhase 1以降、各フェーズごとに
  Issue／featureブランチ／PRの単位を保つ
