# MVP要件・受入条件

## 背景・目的

BtoB営業担当者が商談前に行う企業リサーチと提案仮説づくりを、公開情報の自動調査と
LLMによる構造化出力で支援する。事実と仮説を明確に分離し、各事実に出典（source id）を
追跡可能にすることで、根拠の無い情報がそのまま商談準備資料になることを防ぐ。

CLAUDE.md記載のMission（このリサーチエージェントを実用可能なポートフォリオとして
提示し、有料のAI関連案件を1件受注する）に基づき、Phase 4完了時点でMVPの中核機能
（調査→LLM分析→構造化JSON＋Markdown出力）が動くデモとして完成している。
人間承認フロー（Wait/HITL）は意図的に後回しにしている（下記「Phase 5（未着手）」参照）。

## 想定ユーザー

- BtoB営業担当者（個人利用、社内システム前提ではない）
- 1回の入力につき1社を調査する想定（バッチ処理は対象外）

## 入力

n8n Manual Trigger＋固定テスト入力（Set）で以下を受け取る。Form Trigger（フォームUI）は
Phase 4時点では追加していない（デモにはManual Triggerで十分と判断、docs/ASSUMPTIONS.md参照）。

| 項目 | 必須 | 備考 |
|---|---|---|
| company_name（企業名） | 必須 | 調査対象企業の正式名称または通称 |
| official_url（公式URL） | 必須 | 企業公式サイトのURL |
| research_purpose（調査目的） | 必須 | フリーテキスト |
| offering（提案する商品・サービス） | 必須 | 提案仮説・商談質問の生成軸（Phase 4で追加） |

## 処理フロー（概要、Phase 4時点）

1. 固定テスト入力を受け付ける
2. Tavily Search（1回）／Extract（1回）で公式サイト・ニュース等の公開情報を収集する
3. 収集した情報を正規化・重複排除し、公式情報／外部情報を区別した構造化JSONにまとめる
4. 3の結果とofferingをOpenAI Responses APIに渡し、Structured Output
   （JSON Schema、strict=true、1回のみ呼び出し）で以下を生成する
   - 出典付き企業情報サマリー（企業概要・最近の動き・組織シグナル）
   - offeringとの適合理由を含む提案仮説
   - offeringを前提にした商談で使える質問リスト
   - 出典が確認できない・不足している情報の注意事項
5. LLM応答を検証し（refusal／incomplete／空出力／APIエラー／schema不正／不正source参照を
   明示的に検出）、Phase3の出典情報と統合してJSON・Markdownレポートを出力する

詳細な設計は [ARCHITECTURE.md](ARCHITECTURE.md) を参照。人間承認（Wait/HITL）は
Phase 5として未着手（下記参照）。

## 出力

- **JSON**：`{meta, report}`の構造化データ（`meta`は入力・Tavily/LLMの実行状態、
  `report`は企業情報・出典・提案仮説・質問リスト。LLM生成が失敗した場合`report`はnull）
- **Markdownレポート**：人間が読む商談準備資料としての整形版（失敗時は理由のみ簡潔に記載）

Phase 4時点では生成された時点のものがそのまま最終出力となる（承認フローは未実装）。

## 受入条件（Acceptance Criteria、Phase 4時点で充足）

1. 企業名・公式URL・調査目的・offeringを入力できる（Manual Trigger＋固定テスト入力）
2. Tavily Search／Extractで実際に外部情報を取得できる
   （Phase 3実施済み：実企業「株式会社サイボウズ」での実API疎通確認で充足を確認。
   詳細はdocs/ASSUMPTIONS.md）
3. OpenAI Responses APIへのリクエストがJSON Schema・strict=trueで構造化出力を強制し、
   スキーマ違反時にエラーとして扱える（Phase 4で実装。実API疎通は未確認、
   ユーザーがCredentialを割り当てて実行するまで行われない）
4. 生成された事実（企業情報の各項目）には`source_ids`が、仮説には`evidence_source_ids`が
   付与されており、いずれも実在する`sources`エントリを参照している（参照整合性を検証できる）。
   出典が確認できない事実は確定情報に含めず`uncertainties`に分離されている
5. OpenAI呼び出しは1実行あたり1回のみ
6. refusal／incomplete／空出力／APIエラー／schema不正／不正source参照のいずれも、
   架空の情報で補わず明示的な失敗として検出される
7. APIキー等の秘密情報がリポジトリに含まれない（`.env`は`.gitignore`対象、
   コミット履歴にも含まれない。Tavily・OpenAIともn8n Credentialで管理）
8. ワークフローが単一のn8nワークフローファイルとして完結している
   （DB・RAG・マルチエージェント・独自UI・PDF出力を用いない）

## Phase 5（未着手）で追加検討する受入条件

CLAUDE.mdの判断ルール（デモに必須でない追加開発は停止する）に基づき、以下は
実際の案件応募・顧客反応で必要性が確認された場合にのみ着手する。

- Waitノードで処理が一時停止し、人間が承認・修正・却下のいずれかを選択できる
- 承認時のみ最終出力が確定し、修正時は修正内容が反映され、却下時は最終出力が生成されない

## 非機能要件

- ローカル実行のみ（Docker Compose）。外部ホスティングは対象外。
- 同時実行・大量処理のスケーラビリティは対象外（個人利用のMVP）。
- 認証・マルチユーザー対応は対象外。

## 明示的な対象外事項

- Form Trigger（フォームUI）：デモにはManual Triggerで十分なため、必要性が確認されるまで追加しない
- Wait/HITL（承認・修正・却下フロー）：Phase 5として保留
- データベースへの永続化
- RAG（社内ドキュメント等をベースにした検索拡張生成）
- マルチエージェント構成（複数LLMエージェントの協調）
- 独自UI
- PDF生成・出力
