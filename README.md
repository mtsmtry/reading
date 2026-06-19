# ブリタニカ国際大百科事典 小項目事典 ビューア

[kotobank.jp](https://kotobank.jp/dictionary/britannica/) の「ブリタニカ国際大百科事典 小項目事典」を、**1ページ分の全項目（約70件）を1画面にまとめて閲覧**するための Web サービスです。TypeScript + React（フロント）と Node/Express（バックエンド）で構成し、しおり・読書進捗・本文キャッシュは **Supabase (PostgreSQL)** に保存します。本番は **Render** にデプロイできます。

> ⚠️ **注意**: 本文の著作権は Britannica Japan Co., Ltd. / kotobank に帰属します。本ツールは**個人の閲覧専用**です。全項目の一括ダウンロードは行わず、表示中のページの項目のみをその都度取得します（サーバー負荷を抑えるためレート制限・同時実行制限・キャッシュを実装）。再配布・商用利用はしないでください。

## 構成

```
reading/
├─ server/   Express API（kotobank プロキシ / HTML パース / Postgres / 認証）
│  └─ src/   index.ts, kotobank.ts, db.ts
├─ client/   React + Vite（一覧 / 項目カード / しおり / ログイン設定）
│  └─ src/
├─ render.yaml  Render デプロイ用ブループリント
└─ package.json （npm workspaces）
```

- フロント: `http://localhost:5173`（Vite。`/api` を `:5174` へプロキシ）
- API: `http://localhost:5174`（Express）
- DB: Supabase PostgreSQL（テーブル `bookmarks` / `settings` / `word_cache` / `reading_progress` は起動時に自動作成）

## セットアップ

Node.js 18 以上（推奨 20+）が必要です。

```bash
npm install
# ネットワーク/権限の都合でホームの npm キャッシュが使えない場合:
# npm install --cache "$PWD/.npmcache"
```

### 環境変数（必須）

`server/.env` に Supabase の接続文字列を設定します（`server/.env.example` 参照）。

```bash
DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres
```

接続文字列は Supabase ダッシュボードの **Project Settings → Database → Connection string** で取得できます。

## 起動（ローカル開発）

```bash
npm run dev
```

サーバーとクライアントが同時に起動します。ブラウザで `http://localhost:5173` を開いてください。初回起動時に必要なテーブルが Supabase 上へ自動作成されます。

個別に起動する場合:

```bash
npm run dev:server   # API のみ
npm run dev:client   # フロントのみ
```

## Render へのデプロイ

リポジトリ直下の `render.yaml`（Blueprint）を使うと、API とビルド済みフロントを **1つの Web Service** で配信します。

1. このリポジトリを GitHub に push。
2. Render で **New → Blueprint** を選び、リポジトリを指定（`render.yaml` が自動検出されます）。
3. 環境変数 **`DATABASE_URL`** を設定する。
   - ⚠️ **Render では Supabase の「Pooler」接続文字列（IPv4対応・ユーザー名は `postgres.<ref>` 形式）を使ってください。**
     直結の `db.<ref>.supabase.co:5432` は IPv6 専用で Render から接続できない場合があります。
   - 例（Transaction pooler / 6543）: `postgresql://postgres.<ref>:<PASSWORD>@aws-1-<region>.pooler.supabase.com:6543/postgres`
   - 例（Session pooler / 5432）も可。Supabase ダッシュボード → Database → Connection string → **Session/Transaction pooler** から取得。
4. デプロイ完了後、表示された URL にアクセス。

ビルド/起動コマンド（`render.yaml` に定義済み）:

- Build: `npm install --include=dev && npm run build`（client を `client/dist` にビルド）
- Start: `npm start`（`NODE_ENV=production` で Express が API + `client/dist` を配信）

## 使い方

- **ページ送り**: 上下のページャで `前へ / 番号 / 次へ`。番号は**テキスト入力欄に入力し「確定」ボタン（または Enter）で確定したときだけ**移動します（入力途中では飛びません）。現在ページは URL に反映され（例: `/313`）、`http://localhost:5173/313` のように直接開けます。
- **コトバンクで開く**: ヘッダーの「コトバンクで開く ↗」で、表示中ページに対応する kotobank ページ（例: 313ページなら `https://kotobank.jp/dictionary/britannica/313/`）を新規タブで開きます。
- **重複排除**: 参照先 URL 末尾の ID で同一性を判定し、同じ項目（連続重複など）は一覧から除外します。
- **参照のみ項目の非表示**: 「『〜』のページをご覧ください。」のような参照だけの項目は本文取得時に検出して非表示にします。
- **本文の自動表示**: ヘッダーの「本文を自動表示」チェックで、各カードの本文を自動取得するか切り替え（同時取得数は4件に制限）。
- **絞り込み**: ツールバーの入力欄で、表示中ページ内を項目名でフィルタ。
- **しおり**: 各カードの ☆ で追加/解除。右上「しおり」ボタンで一覧を開き、メモの追加・削除ができます。しおりは Supabase (PostgreSQL) に永続化されます。
- **再取得**: 各カード右上の ↻ アイコンでキャッシュを無視して再取得します。
- **読書の進捗（自動復帰）**: 各カードが画面内に一定割合（55%）以上、一定時間（約2.5秒）表示され続けると「既読」と判定し、最も先まで読んだ位置を Supabase (PostgreSQL) に保存します。次回起動時はそのページを開き、「前回の続き」バーの「ここから再開」で前回位置へスクロールできます（保存ページの一覧表示時には自動でもスクロールします）。既読のカードには ✓ と淡色背景が付きます。
  - 進捗は **単調増加** で、前の項目に戻っても後退しません。
  - 進む判定には **連続性** を条件にしており、同一ページ内の前進、または直後のページ（次ページ）への前進のみ進捗を更新します。たとえば1ページを読んだ後に100ページへ飛んでも、100ページが読了になることはありません（飛んだ先では進捗は更新されません）。

## kotobank ログイン（Cookie）設定

ブリタニカの項目は通常ログイン不要ですが、「ログインしないと表示されない」ケースに備えて、**ブラウザのログイン済み Cookie をバックエンドに渡して全リクエストへ付与**できます。

1. ヘッダー右上の「ログイン設定」を開く。
2. ブラウザで `kotobank.jp` にログインする。
3. 開発者ツール（F12）→ Network タブで kotobank へのリクエストを選び、Request Headers の `Cookie` の値をコピー。
4. 設定画面のテキスト欄に貼り付けて「Cookie を保存」。
5. 「接続テスト」で疎通とログイン要求の有無を確認できます。

Cookie は Supabase の `settings` テーブルに保存され、kotobank への取得リクエスト時のみ使用されます。接続情報（`DATABASE_URL`）は `server/.env`（gitignore 済み）や Render の環境変数で管理してください。

## API（参考）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/list/:page` | ページの項目一覧 + ページネーション |
| POST | `/api/word` | `{ url, force? }` で項目本文を取得（キャッシュ付き） |
| GET | `/api/bookmarks` | しおり一覧 |
| POST | `/api/bookmarks` | しおり追加 `{ term, url, page?, excerpt?, note? }` |
| PATCH | `/api/bookmarks/:id` | メモ更新 `{ note }` |
| DELETE | `/api/bookmarks/:id` | しおり削除 |
| DELETE | `/api/bookmarks?url=` | URL でしおり削除 |
| GET | `/api/progress` | 読書の進捗（最後に読んだ位置）を取得 |
| PUT | `/api/progress` | 進捗を保存 `{ page, itemIndex, url, term }` |
| GET | `/api/auth` | Cookie 設定状態 |
| POST | `/api/auth/cookie` | Cookie 保存 `{ cookie }` |
| DELETE | `/api/auth/cookie` | Cookie 削除 |
| GET | `/api/auth/probe` | 接続/ログイン要求の確認 |
| DELETE | `/api/cache` | 本文キャッシュ全削除 |

## 技術メモ

- HTML パースは `cheerio`。一覧は `ul.grid02 li a[rel="dic_britannica"]`、本文は `article.britannica` を抽出し、内部リンクは絶対 URL 化して別タブで開くよう変換。
- 取得は最小 300ms 間隔のレートリミッタ + クライアント側の同時実行4件制限。
- 本文は `word_cache` に最大30日キャッシュし、再取得を抑制。
