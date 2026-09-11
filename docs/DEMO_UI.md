# デモUI（応募用、Phase 3ベース）

非エンジニアにも価値が伝わる応募用デモとして、既存のTavily調査ワークフロー（Phase 3、main）
をブラウザから実行できる最小UIを追加したもの。**OpenAI連携は含まない**（Phase 4とは独立）。

## 全体構成

```
[ブラウザ: web/index.html]
      │  POST /api/research { company_name, official_url, research_purpose }
      ▼
[server/index.js（Node標準ライブラリのみ、追加npm依存なし）]
      │  入力検証・レート制限・タイムアウト適用後、
      │  n8n Webhookを共有シークレットヘッダー付きで呼び出す
      ▼
[n8n: Webhook Trigger] → [Sanitize Webhook Input] → [Input Ready]
      │
      ▼
   [Is Input Valid]
      ├─ 妥当 → [Tavily Search/Extract] → [Merge] → [Normalize, Dedupe & Structure Output]
      └─ 不正 → [Build Input Error Result]（Tavilyを呼び出さない）
      │
      ▼
   [Result Ready] → [Is Webhook Request]
      ├─ Webhook経由 → [Respond to Webhook]（バックエンドへ結果を返す）
      └─ Manual Trigger経由 → 何も繋がず終了（n8n画面で結果を確認できる）
      ▼
[server/index.jsが結果を整形（reshape_result.js）してブラウザへ返す]
```

- **Manual Trigger経路**：`Fixed Test Input`（従来の固定テスト値）→`Input Ready`。
  Respond to Webhookは通らない。n8n画面で「Test workflow」を実行すれば、
  従来どおり各ノードの実行結果を確認できる。
- **Webhook経路**：`Webhook Trigger`（POST、path: `research`、Header Auth）
  →`Sanitize Webhook Input`でブラウザ入力を安全に正規化してから同じ`Input Ready`へ合流する。
- 両経路とも同じ`Tavily Search`/`Tavily Extract`/`Merge`/`Normalize, Dedupe & Structure Output`
  （Phase 3から無変更）を通る。

## 入力の安全な正規化

`src/sanitize_input.js`（Manual/Webhook共通の正規化ロジック。n8nの
`Sanitize Webhook Input`Codeノードにも同一内容を手動で複製、
`test/workflow-sync.test.js`で同期を検証）：

- 会社名・調査目的は文字数上限で切り詰める（架空の値で補わず、拒否もしない）
- 公式URLは`http`/`https`のみ許可し、`localhost`・ループバック・プライベートIP・
  リンクローカルアドレス（クラウドメタデータエンドポイント`169.254.169.254`等を含む）を拒否する
  （SSRF一次防御。実際のURL取得はTavily側の処理系で行われるため多層防御の一環であり、
  完全な排除を保証するものではない）
- 不正な入力は`Is Input Valid`ノードで検出され、**Tavily自体を呼び出さずに**
  明示的なエラー結果を返す（架空情報で補わない、という既存Phase 3の方針を踏襲）

バックエンド（`server/index.js`）も同じ`sanitizeResearchInput`を呼び出しており、
不正な入力はn8nを呼び出す前の時点で400エラーとして拒否される（主たる防御層）。
n8n側の検証は、Webhookが万一直接叩かれた場合の多層防御。

## 表示への変換（`src/reshape_result.js`）

n8n Webhookからの生JSON（`input`/`search`/`extract`/`sources`/`warnings`/`generated_at`）を、
以下のみを含む最小限のUI向け形状へ変換してからブラウザへ返す。

```json
{
  "company_name": "...",
  "official_url": "...",
  "official_sources": [{ "title": "...", "url": "...", "snippet": "..." }],
  "external_sources": [{ "title": "...", "url": "...", "snippet": "..." }],
  "warnings": ["..."],
  "generated_at": "..."
}
```

- `source_type`が`official`のものを「公式サイトから取得した情報」、それ以外を
  「外部サイトから取得した情報」として分離する
- `title`が`null`の場合、公式は「公式サイト」、外部は「外部サイト」と表示する
- n8nの内部フィールド（`_source`/`_input_error`）、生の`search`/`extract`ステータス構造は
  一切含めない（Webhookのレスポンス自体には残るが、ブラウザにはこの変換後の形しか返さない）
- UIでは「AI要約」という表現は使わず、「公式サイトから取得した情報」「外部サイトから
  取得した情報」「情報源」「警告」と表示する（LLMによる要約ではなく検索結果の再構成である
  ことを利用者に誤解させないため）
- 長いsnippetはフロントエンド側で150文字に短縮表示し、「続きを読む」で全文を展開する
  （`web/index.html`のJavaScriptで実装、サーバー側では2000文字を上限に保持するのみ）
- 結果画面には「画像として保存」ボタンを設置し、[html2canvas](https://html2canvas.hertzen.com/)
  （CDN読み込み、新規npm依存なし）で結果カード部分をPNG画像化してダウンロードできる
  （応募・提案時の証拠保存を目的とする）

## セキュリティ

- **秘密情報の保管場所**：Tavily/OpenAI鍵はn8n Credential（無変更）。新設の
  Webhook共有シークレット（`N8N_WEBHOOK_SECRET`）は`.env`（Git対象外）とn8nの
  Header Auth Credentialのみに存在し、フロントエンド・workflow JSON・Gitに含まれない
- **入力検証**：文字数上限、URLスキーム/SSRF簡易ガード（上記）
- **レート制限**：IPアドレス単位の固定ウィンドウ制限（`src/rate_limiter.js`、
  既定：1時間あたり5回、単一インスタンス運用のデモ規模を想定したインメモリ実装）
- **タイムアウト**：バックエンド→n8n Webhook呼び出しに上限（既定60秒）を設定
- **リクエストサイズ制限**：バックエンドは10KBを超えるリクエストボディを413で拒否する
- **エラー内容の非開示**：n8n接続エラー等の詳細（内部URL・スタックトレース）はサーバー側の
  ログにのみ記録し、ブラウザへは一般化したメッセージのみ返す
- **n8nは非公開のまま**：`docker-compose.yml`で`n8n`は`127.0.0.1:5678`のみに公開する方針を
  維持。ブラウザ・外部から到達できるのは`web`サービス（`127.0.0.1:3000`）のみ

## ローカルでの起動手順

1. n8n画面（`http://localhost:5678`）で`workflows/phase3-tavily-research.json`を再importする
2. `Webhook Trigger`ノードに、Header Auth Credential（例：名前「Demo Webhook Auth」、
   Header Name: `X-Demo-Webhook-Secret`、Value: `.env`の`N8N_WEBHOOK_SECRET`と同じ値）を割り当てる
3. `Tavily Search`/`Tavily Extract`ノードには既存の「Tavily API」Credentialを割り当てる
   （Phase 3から変更なし）
4. workflowを有効化（Active）する（Webhookの本番パスを使えるようにするため）
5. `.env`に`N8N_WEBHOOK_SECRET`を設定する
6. `docker compose up -d`（`web`サービスが追加される。既存`n8n`サービス・volumeは無変更）
7. ブラウザで`http://localhost:3000`を開く

## 対象外（今回追加していない）

- OpenAI連携、ログイン、履歴保存、管理画面、PDF出力、HITL
- 外部公開・本番デプロイ（ホスティング先の選定、HTTPS/ドメイン、複数インスタンス時の
  レート制限共有ストアはPhase 5以降・別途検討）
- n8n自体の外部公開（`web`サービスのみを公開する想定で、n8nは公開しない）
