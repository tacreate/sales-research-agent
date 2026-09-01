# Phase 0で行った仮定の記録

指示に明記されていなかったが、Phase 0の範囲内で安全に判断できると考え、以下を仮定した。
Phase 1以降で認識齟齬があれば修正する。

1. **プロジェクトの配置場所**
   指示された作業ディレクトリ（AI副業フォルダ）直下に`sales-research-agent/`を作成した。
   これより深い階層構成（例：`projects/sales-research-agent/`）は指定がなかったため採用していない。

2. **ドキュメント構成**
   要件・アーキテクチャ・受入条件・開発フェーズ・環境確認・仮定記録を、それぞれ独立した
   Markdownファイル（`docs/`配下）に分割した。単一ファイルへの統合は行っていない。

3. **JSON Schema案の記載**
   「アーキテクチャを文書化する」という指示を、LLM出力のJSON Schema案（Structured Output用）
   まで含めて設計することと解釈した。ただし、これは設計案であり、n8nワークフローとしての
   実装（Phase 0で禁止されている「ワークフロー本体の実装」）ではないと判断した。

4. **Issue・PRテンプレートの内容**
   一般的なバグ報告・機能要望・PRテンプレートを用意した。プロジェクト固有の項目
   （例：Tavily/OpenAIのクォータ影響確認欄）は最小限とし、過剰なテンプレート化は避けた。

5. **`.gitignore`の対象範囲**
   n8n・Node.js・Docker・一般的なOS生成ファイル・`.env`系を対象に含めた。
   n8n自体のデータボリューム（`n8n_data/`等）もDocker Compose運用を想定して除外対象に含めた
   （Phase 1で`docker-compose.yml`を作る際に整合させる前提）。

6. **GitHub CLI認証状態の未確認**
   `gh auth status`の確認は行わなかった。GitHub操作自体がPhase 0のスコープ外のため、
   認証確認も次フェーズ（Phase 4、GitHub操作着手時）に委ねた。

7. **コミットの粒度**
   Phase 0で作成した全ファイルを1つのコミットにまとめた。複数コミットへの分割指示は
   なかったため、単一コミットとした。

8. **Git author emailの決定方法（レビュー修正）**
   `gh api user/emails`によるnoreplyアドレス確認には`user`スコープの追加認可が必要だったが、
   ユーザーの指示により追加認可は行わず、GitHub公式のID型noreply形式
   （`{id}+{login}@users.noreply.github.com`）を`gh api user`の公開情報（`id`／`login`）のみで
   組み立てて採用した。このリポジトリのローカルgit configにのみ設定し、グローバル設定・
   GitHub側の認証スコープは変更していない。

9. **検証用ライブラリの選定（Phase 1）**
   JSON Schema検証には`ajv`を採用した（Node.js標準にJSON Schemaバリデータが無いため）。
   テストランナーは追加依存を避けるためNode.js標準の`node:test`を使用し、
   Mocha/Jest等の外部テストフレームワークは導入していない。

10. **業務ルール検証をJSON Schemaの外に置いた理由（Phase 1）**
    「仮説の根拠が1件以上必要」という制約は`minItems`で表現可能だが、OpenAI Responses APIの
    Structured Output（`strict: true`）はstrictモードで使用できるキーワードに制限があるため、
    将来そのままAPIリクエストへ流用できるよう、スキーマ本体には`minItems`を使わず、
    参照整合性チェックと合わせてアプリケーション側（`src/validate.js`）で検証することにした。

11. **n8nイメージバージョンの選定方法（Phase 2）**
    Docker Hub APIで`latest`タグのマニフェストダイジェストを取得し、同一ダイジェストを持つ
    具体的なバージョンタグ（`2.36.9`）を特定して採用した。ダイジェスト一致により
    「`latest`が指している実体」を推測ではなく確認した上で固定した。

12. **非秘密の環境変数の配置場所（Phase 2）**
    `N8N_HOST`／`N8N_PORT`／`N8N_PROTOCOL`／`TZ`／`GENERIC_TIMEZONE`／
    `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS`は秘密情報ではないため、`.env`ではなく
    `docker-compose.yml`に直接記述した。`.env`（および`.env.example`）は秘密値・
    利用者固有の値（`N8N_ENCRYPTION_KEY`、APIキー）のみを扱う方針とした。

13. **認証情報の種類（Phase 3）**
    n8nにTavily専用の組み込みCredential型が存在しないことを、インストール済みn8nの
    node_modules内を検索して確認した（`n8n-nodes-base`／`@n8n`配下に`tavily`関連の
    Credential定義なし）。そのため、HTTP RequestノードのGeneric Credential Type
    「HTTP Bearer Auth」を用い、ユーザーがn8n画面でCredential名を
    「Tavily API」として作成する前提で設計した。

14. **Extractの対象をpublic URLのみに縮小した理由（Phase 3）**
    Phase 1時点の設計案では検索結果上位N件もExtract対象としていたが、要件2
    （クレジット消費抑制・MVP最小化）に合わせて公式URLのみに縮小した
    （詳細はdocs/TAVILY.md）。

15. **n8n Codeノードのロジック複製（Phase 3）**
    n8nのCodeノードは外部モジュールをimportできないため、`src/normalize.js`と
    同一のロジックをworkflow JSON内のCodeノードにも手動で複製した。将来的な
    ドリフト（実装の乖離）のリスクを本ドキュメントに明記し、変更時は両方を
    同期させる運用とする。ビルドスクリプトによる自動生成は、依存関係・
    プロセスの複雑化を避けるため今回は導入しなかった。

16. **workflow検証方法（Phase 3）**
    実際のn8n画面へのログイン（オーナーパスワード入力）は行わず、n8n CLI
    （`import:workflow`／`export:workflow`）とNode.jsの構文チェック（`node --check`）で
    workflow JSONの妥当性を検証した。CLIの`execute`コマンドは実行中サーバーと
    ポート競合するため使用せず、実際のワークフロー実行確認はユーザーが
    n8n画面でTavily API Credentialを割り当てた後に行う。

## 未解決事項（人間の判断が必要）

- OpenAI Responses APIで使用する具体的なモデル名は未確定（Phase 4で決定）。
- Tavily API・OpenAI APIの利用契約・料金プランの確認は未実施（ユーザー側で確認が必要）。
- n8n初回セットアップ（オーナーアカウント作成）はブラウザでの人間の操作が必要
  （`http://localhost:5678`にアクセスして行う、Phase 2で完了済み）。
- n8n画面での「Tavily API」Credential作成・ノードへの割り当てはユーザー操作が必要
  （Phase 3、本PRのマージ後）。
- workflow内のCodeノードと`src/normalize.js`のロジック同期は手動運用のため、
  将来の変更時にレビューで両者の一致を確認する必要がある。
