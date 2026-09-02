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

13. **認証情報の種類（Phase 3、PRレビューで訂正）**
    n8nにTavily専用の組み込みCredential型が存在しないことを、インストール済みn8nの
    node_modules内を検索して確認した（`n8n-nodes-base`／`@n8n`配下に`tavily`関連の
    Credential定義なし）。当初はGeneric Credential Type「HTTP Bearer Auth」を前提に
    設計したが、PRレビューでユーザーが実際にn8n画面へ作成済みのCredentialは
    「HTTP Header Auth」（Header Name: `Authorization`、Value: `Bearer <キー>`、
    許可ドメイン: `api.tavily.com`）であることが判明したため、workflow・README・
    docs/TAVILY.mdをすべて「HTTP Header Auth」前提へ訂正した
    （`genericAuthType: httpHeaderAuth`）。ユーザーはCredentialを再作成する必要はない。

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
    workflow JSONの妥当性を検証した。実行中の本番コンテナに対する`execute`コマンドは
    ポート競合するため使用せず、並列分岐の実行順序検証（下記17）や実際のワークフロー
    実行確認は、実行中インスタンスとは別の使い捨てコンテナ、またはユーザーが
    n8n画面でTavily API Credentialを割り当てた後に行った／行う。

17. **並列分岐の実行順序とMergeノードの追加（Phase 3、PRレビューで発見・修正）**
    Fixed Test Input → Tavily Search／Tavily Extract → 同一の後続ノード、という
    構成について、n8n 2.36.9の実際の挙動を使い捨てコンテナで検証したところ、
    両方の分岐の完了を待たずに後続ノードが実行され、`$('未実行のノード名')`参照で
    `ExpressionError`となることを確認した。そのため、Search/Extractの出力を
    Mergeノード（`mode: combine`、`combineBy: combineByPosition`、入力0/1に
    それぞれ接続）で同期させてから後続のCodeノードへ渡す構成に修正した
    （詳細はdocs/TAVILY.md「Search/Extractの並列実行とMergeノード」）。

18. **Code同期チェックの実装方式（Phase 3、PRレビューで追加）**
    「過剰実装にならない範囲」でCodeノードと`src/normalize.js`の同期漏れを検出する
    手段として、ビルドスクリプトによる自動生成（ソース一本化）ではなく、
    `test/workflow-sync.test.js`でworkflow内のjsCodeをNode.jsの`vm`モジュールで
    実行し、`src/normalize.js`の関数と同一fixtureに対する出力を比較するテストを
    追加した。テキスト差分比較ではなく実行結果比較にしたのは、コメント等の
    些細な違いを誤検知せず振る舞いの一致だけを見るため。ビルドスクリプトは
    プロセスの複雑化（生成物の管理、生成タイミングのずれ等）を避けるため
    見送った。なお、vmの別レルムオブジェクトを`assert.deepEqual`
  （`node:assert/strict`は`deepStrictEqual`相当）で直接比較するとプロトタイプの
    違いで誤って不一致判定されるため、比較前にJSON往復でプレーンオブジェクト化する
    実装上の注意点がある（テスト内にコメントで明記）。

19. **「API成功だがsources空」インシデントの根本原因と修正（Phase 3、実API確認で発覚）**
    ユーザーが実際に「株式会社サイボウズ」を対象にワークフローを実行したところ、
    Search/Extractとも成功（search.returned_count=3、extract.status=ok）しているのに
    `sources`が空になり「有効な出典が1件も取得できませんでした」という警告が出た。

    調査の結果、`normalizeUrl`が標準の`URL`クラス（`new URL(...)`）に依存していたが、
    **n8n Codeノードの実行サンドボックス（JS Task Runner）にはグローバルの`URL`/
    `URLSearchParams`が存在せず**（診断用ワークフローを使い捨てコンテナで実行し、
    `typeof URL === 'undefined'`、`new URL(...)`が`"URL is not defined"`で例外になることを
    実機確認した）、`require('url')`等の代替も許可されていないことが根本原因と判明した。
    normalizeUrlは例外をtry/catchでnullとして扱う設計だったため、有効なURLも含めて
    「不正なURL」として全件除外されていた。

    通常の`npm test`はNode.js上で実行されるため`URL`が普通に使え、この非互換性を
    検知できなかった（`test/workflow-sync.test.js`のvmサンドボックスにも当初`URL`を
    明示的に注入しており、同様に見逃していた）。実際にユーザーが提供した実データ
    （公開情報：日経電子版・SlideShare・Wikipedia・企業公式サイトの検索結果、
    Tavily APIの実レスポンス）を使い捨てコンテナ上の実際のn8n Codeノード
    （JS Task Runner）で再実行し、修正前は再現、修正後は解消することを確認した。

    **修正内容**：`normalizeUrl`／`getHostname`を`URL`クラスを一切使わない
    正規表現＋文字列操作ベースの実装に書き換えた（`src/normalize.js`、workflow内Codeノード
    の両方）。既存の`normalizeUrl`のテストケース（大文字ホスト・トラッキングパラメータ・
    フラグメント・末尾スラッシュの正規化）はすべて同じ期待値のまま通過することを確認済み。

    **再発防止**：`test/workflow-sync.test.js`のvmサンドボックスから`URL`の注入を削除し
    （実際のn8nサンドボックスに合わせた）、`src/normalize.js`とworkflow内Codeノードの
    ソーステキストに`new URL(`／`URLSearchParams`／`require(`／`fetch(`が含まれていないことを
    検査する専用テストを追加した。このテストは、修正前のコードに対しては実際に失敗する
    （`new URL(...)が使われています`）ことを確認済み。

    実データ（サイボウズの検索結果、公開情報）は`fixtures/tavily/search_ok_real_incident.json`
    ／`extract_ok_real_incident.json`としてそのまま回帰テストのfixtureに追加した
    （認証情報・APIキーは含まれていない公開のWeb検索結果のため）。

## 未解決事項（人間の判断が必要）

- OpenAI Responses APIで使用する具体的なモデル名は未確定（Phase 4で決定）。
- Tavily API・OpenAI APIの利用契約・料金プランの確認は未実施（ユーザー側で確認が必要）。
- n8n初回セットアップ（オーナーアカウント作成）はブラウザでの人間の操作が必要
  （`http://localhost:5678`にアクセスして行う、Phase 2で完了済み）。
- n8n画面での既存「Tavily API」Credential（Header Auth）のSearch/Extract両ノードへの
  割り当てはユーザー操作が必要（Phase 3、本PRのマージ後）。
- workflow内のCodeノードと`src/normalize.js`は手動でコードを複製する運用のため、
  変更時に一方だけ修正して`npm test`（`test/workflow-sync.test.js`）を実行し忘れると
  ズレたままコミットされ得る。同期漏れ自体は`npm test`で検出できるが、
  「テストを実行してからコミットする」運用自体は引き続き人間の注意に依存する。
