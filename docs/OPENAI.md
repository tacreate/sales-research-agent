# OpenAI API仕様（Phase 4設計）

確認日：2026-09-03
確認方法：`developers.openai.com`のPricing／Structured Outputsガイドを参照。

## 認証

- Tavilyと同じ**HTTP Header Auth**方式を採用する（`Authorization: Bearer <OpenAIキー>`）。
  n8nの「HTTP Bearer Auth」種別は使わない。
- Credential名：**「OpenAI API」**（Tavilyの「Tavily API」と別のCredentialとして作成する）
- **許可ドメインを`api.openai.com`に限定する**（Tavilyの`api.tavily.com`制限と同じ方針）。
- ワークフローJSONにはCredentialのid・値を含めない（Credentials未選択でもimport可能）。

## ChatGPT PlusとAPI課金は別会計

**ChatGPT Plus等のサブスクリプション契約と、OpenAI APIの利用料金は完全に別の課金体系。**
Plus契約があっても、API利用には別途[platform.openai.com](https://platform.openai.com/)側で
支払い方法の登録・API課金の有効化が必要。本ワークフローの実行にはAPI課金設定が必須。

## エンドポイント・モデル

- エンドポイント：`POST https://api.openai.com/v1/responses`
- モデル：**`gpt-5.6-terra`**
- `reasoning.effort`：**`low`**
- `max_output_tokens`：**`4000`**
- Structured Outputs（`text.format`に`type: "json_schema"`, `strict: true`）を使用

## リクエスト形式

```json
{
  "model": "gpt-5.6-terra",
  "reasoning": { "effort": "low" },
  "max_output_tokens": 4000,
  "input": "<プロンプト文字列。Phase3のsourcesを出典として埋め込む>",
  "text": {
    "format": {
      "type": "json_schema",
      "name": "phase4_llm_analysis_output",
      "strict": true,
      "schema": { "...": "schema/phase4_llm_analysis_output.schema.jsonの内容" }
    }
  }
}
```

- `schema`はLLMが生成する分析部分のみ（`company_profile`／`proposal_hypotheses`／
  `discovery_questions`／`uncertainties`）。`sources`／`company_name`／`official_url`は
  Phase3で既に確定しているためLLMには生成させず、後段で合成する
  （URL・社名のハルシネーションリスクを構造的に排除するため）。
- 全objectで`additionalProperties: false`、定義した全プロパティを`required`とする。
- `source_ids`／`evidence_source_ids`は`minItems: 1`とする。この制約が実際に
  OpenAI側のstrictモードで強制されるかは未検証（実APIを呼び出していないため）。
  仮に強制されない場合でも、レスポンスを受け取った側でajvを使わない手書きの
  構造チェック（`validatePhase4Schema`、`src/assemble_report.js`）により
  同じ制約を必ず検証するため、空配列がすり抜けることはない。

## 想定料金

`gpt-5.6-terra`：input $2.00 / output $12.00（各100万トークンあたり）

例：input 10,000トークン＋output 2,000トークンの場合

```
10,000 / 1,000,000 * $2.00  = $0.02
 2,000 / 1,000,000 * $12.00 = $0.024
合計 ≈ $0.044（実際は出典の分量・生成内容により変動する）
```

## API呼び出し上限（1回のワークフロー実行あたり）

- OpenAI Responses API：**最大1回**
- （参考）Tavily Search：最大1回、Tavily Extract：最大1回（Phase 3から変更なし）
- 合計で1回の実行につき外部API呼び出しは**3回**（Tavily 2回＋OpenAI 1回）

## レスポンスの分類と失敗の扱い方針

n8nのHTTP Requestノードは`onError: continueRegularOutput`を設定し、APIエラー時も
ワークフローを停止させず、後続のCodeノードで状態を検知・構造化する。
`meta.llm.status`として以下のいずれかに分類し、`ok`以外の場合は`report`を`null`とし、
架空の分析結果で補わない。

| status | 検知条件 |
|---|---|
| `ok` | `status: "completed"`、`output_text`がSchema・source id参照整合性を満たすJSON |
| `refusal` | `output[].content[]`に`type: "refusal"`が含まれる |
| `incomplete` | レスポンスの`status: "incomplete"`（`incomplete_details.reason`を記録） |
| `empty` | `output`が空、または`output_text`が空文字列 |
| `error` | レスポンス本体に`error`がある、または`status: "failed"` |
| `invalid_schema` | `output_text`がJSONとして解析できない、またはSchema制約（必須項目・minItems等）に違反 |
| `invalid_reference` | Schemaは満たすが、存在しない`source_id`／`evidence_source_id`を参照している |

## Phase 4のスコープ外

- Form Trigger、Wait/HITL（Phase 5）は対象外
- OpenAI呼び出しのリトライ・複数候補生成は行わない（1実行1回の原則のため）
- 実際のOpenAI APIへの疎通確認はユーザーがCredentialを割り当てた後に行う
  （本PRでは実API呼び出しを行っていない）
