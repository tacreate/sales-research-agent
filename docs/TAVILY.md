# Tavily API仕様（Phase 3設計）

確認日：2026-09-01
確認方法：Tavily公式ドキュメント（`https://docs.tavily.com/documentation/api-reference/endpoint/search`
／`https://docs.tavily.com/documentation/api-reference/endpoint/extract`）を参照。

## 認証

- Tavily APIとしてはHTTP Bearer認証（`Authorization: Bearer tvly-YOUR_API_KEY`）を採用しているが、
  n8n上ではこれを**Generic Credential Type「HTTP Header Auth」**として設定する
  （n8nの「HTTP Bearer Auth」種別は使わない）。
- ユーザーが既にn8n画面で作成済みの「Tavily API」Credential（Header Auth、
  Header Name: `Authorization`、Value: `Bearer <Tavilyキー>`、許可ドメイン:
  `api.tavily.com`）を、Search／Extract両方のHTTP Requestノードにそのまま割り当てる。
  **新規のCredential作成・APIキーの再取得は不要**
- ワークフローJSONにはCredentialのid・値を含めない（Credentials未選択でもimport可能な状態にする）

## Tavily Search API

- エンドポイント：`POST https://api.tavily.com/search`
- 本ワークフローで使用するリクエストボディ（最小限）：

```json
{
  "query": "<企業名> 会社概要",
  "search_depth": "basic",
  "max_results": 3
}
```

| パラメータ | 採用値 | 理由 |
|---|---|---|
| `search_depth` | `basic` | `advanced`より消費クレジットが少ないため（要件2） |
| `max_results` | `3` | MVPとして必要最小限の件数に抑え、不要なクレジット消費を避ける |

- レスポンス主要フィールド：`results[]`（各要素：`title`／`url`／`content`／`score`）、
  `query`、`response_time`、`usage`
- `results`が空配列の場合は「検索結果0件」として明示的に扱う（架空データで補わない）

## Tavily Extract API

- エンドポイント：`POST https://api.tavily.com/extract`
- 本ワークフローで使用するリクエストボディ（最小限）：

```json
{
  "urls": ["<公式URL>"],
  "extract_depth": "basic"
}
```

| パラメータ | 採用値 | 理由 |
|---|---|---|
| `urls` | 公式URLのみ（1件） | Phase 3のスコープは公式URLの本文取得のみ。検索結果URLへの
  Extract拡大は行わない（クレジット消費抑制、要件2） |
| `extract_depth` | `basic` | `advanced`より消費クレジットが少ないため |

- レスポンス主要フィールド：`results[]`（`url`／`raw_content`／`favicon`）、
  `failed_results[]`（`url`／`error`）、`response_time`、`usage`、`request_id`
- 対象URLが`failed_results`に含まれる場合は「Extract失敗」として明示的に扱う
  （本文を空のまま扱い、架空の本文で補わない）

## API呼び出し上限（1回のワークフロー実行あたり）

- Tavily Search：**最大1回**（`max_results=3`）
- Tavily Extract：**最大1回**（`urls`は公式URL1件のみ）

合計で1回の実行につきTavily APIへの呼び出しは2回のみ。

## エラー・空結果・失敗の扱い方針

n8nのHTTP Requestノードは`onError: continueRegularOutput`を設定し、APIエラー時も
ワークフローを停止させず、後続のCodeノードでエラー状態を検知・構造化する。

| 状況 | 検知方法 | 出力への反映 |
|---|---|---|
| Search API呼び出し失敗（ネットワークエラー・4xx/5xx） | レスポンスitemに`error`フィールドが存在 | `search.status = "error"`、`search.error_message`に詳細 |
| Search結果0件 | `results`が空配列 | `search.status = "empty"` |
| Extract API呼び出し失敗 | レスポンスitemに`error`フィールドが存在 | `extract.status = "error"`、`extract.error_message`に詳細 |
| Extract対象URLが`failed_results`に含まれる | `failed_results`配列に該当URLあり | `extract.status = "error"`、`extract.error_message`に`failed_results[].error`を格納 |

いずれの場合も、失敗・空の箇所を架空の情報で補完せず、`status`フィールドで
明示的に「取得できなかったこと」を表現する。

## Search/Extractの並列実行とMergeノード（PRレビューで確認）

Fixed Test Input → Tavily Search／Tavily Extract → 後続ノード、という並列分岐構成において、
n8n 2.36.9で実際にどう実行されるかを、実行中の本番コンテナとは別の使い捨てコンテナ
（`n8nio/n8n:2.36.9`、ボリューム無し）で検証した。

- **検証1（Mergeノード無し）**：2つのSetノードの出力を同じCodeノードの同じ入力
  （index 0）へ直接接続して`n8n execute`で実行したところ、
  `ExpressionError: Node 'Set B' hasn't been executed`で失敗した。
  すなわち、**両方の分岐の完了を待たずに後続ノードが実行され得る**ことを確認した
  （片方の分岐が先に完了した時点で後続ノードが起動してしまう）。
- **検証2（Mergeノードあり）**：同じ2ノードをMergeノード（`mode: combine`、
  `combineBy: combineByPosition`）の入力0・入力1にそれぞれ接続し、Mergeの出力を
  Codeノードへ接続したところ、両方のSetノードの完了を待ってからCodeノードが実行され、
  `$('Set A')`／`$('Set B')`とも正しく解決されることを確認した。

この結果を踏まえ、`workflows/phase3-tavily-research.json`では
**Tavily Search → Merge(入力0)、Tavily Extract → Merge(入力1)、Merge → Normalize,
Dedupe & Structure Output** という構成にした。Mergeノード自身の出力内容
（フィールドの統合結果）は使用せず、後続のCodeノードは従来どおり
`$('Tavily Search')`／`$('Tavily Extract')`で個別に参照する
（Mergeは「両方の完了を待つ」ための同期点としてのみ機能させる）。

## Phase 3のスコープ外（既存設計からの縮小）

`docs/ARCHITECTURE.md`のPhase 1時点の設計案では「Tavily Extractは公式URLおよび
検索結果の上位N件を対象とする」としていたが、Phase 3ではクレジット消費抑制とMVP最小化の
方針（要件2）により、**Extractは公式URLのみ**に縮小した。検索結果URLへのExtract拡大は
将来フェーズでの検討事項とする（`docs/ASSUMPTIONS.md`参照）。
