# n8nローカル実行環境（Phase 2）

## イメージバージョンの選定

- 使用イメージ：`n8nio/n8n:2.36.9`
- 確認日：2026-09-01
- 確認方法：Docker Hub API（`https://hub.docker.com/v2/repositories/n8nio/n8n/tags`）で
  `latest`タグのマニフェストダイジェストを取得し、同一ダイジェストを持つ具体的なバージョンタグを
  特定した。`latest`と`2.36.9`が同一ダイジェストであったため、`2.36.9`を安定版として採用した。
- `latest`ではなく`2.36.9`に固定することで、将来イメージが更新されても本プロジェクトの
  動作が意図せず変わらないようにしている。

## Apple silicon（arm64）対応の確認

Docker Hub APIのタグ情報で、`n8nio/n8n:2.36.9`が以下のアーキテクチャ向けイメージを
含むマルチアーキイメージであることを確認した。

- `linux/amd64`
- `linux/arm64`

本機（`uname -m` → `arm64`、Apple silicon）でも同一イメージタグでネイティブ実行できる。

## 構成方針

- `docker-compose.yml`でn8nコンテナ単体のみを起動する（DB・リバースプロキシは導入しない）
- ポートは`127.0.0.1:5678:5678`のみを公開し、`localhost:5678`以外からはアクセスできない
- n8nのデータ（ワークフロー、認証情報等）はnamed volume（`n8n_data`）に永続化し、
  `/home/node/.n8n`にマウントする。ホスト側にディレクトリを作らないため、
  秘密情報を含むデータがリポジトリ配下に露出しない
- `TZ`／`GENERIC_TIMEZONE`は`Asia/Tokyo`に固定
- `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true`を設定し、n8nの設定ファイルの
  パーミッションを厳格化する
- 秘密値（`N8N_ENCRYPTION_KEY`、APIキー）は`.env`経由でのみコンテナに渡す。
  `docker-compose.yml`には値を直接書かない

## 起動・停止・ログ・再起動

詳細な手順は[README.md](../README.md)の「n8nローカル実行環境（Phase 2）」を参照。

## 検証記録（Phase 2実装時）

- `docker compose config` で設定内容（環境変数展開後）を確認
- `docker compose up -d` でコンテナを起動し、`docker compose ps`で状態を確認
- `docker compose logs` でエラーが無いことを確認
- `curl -I http://localhost:5678` でHTTP応答を確認
- `docker compose restart` 後もnamed volumeの内容（n8nの初期セットアップ状態）が
  維持されることを確認（`docker compose down -v`のようなvolume削除は行っていない）
- 既存のPhase 1 Node.jsテスト（`npm test`）が引き続き成功することを確認

## Phase 2で未実施の事項

- OpenAI／Tavily APIキーの設定（Phase 3以降）
- n8nワークフロー本体の実装
- n8n管理画面での初回セットアップ（オーナーアカウント作成等、ブラウザでの人間の操作が必要）
