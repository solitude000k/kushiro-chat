# Cloudflare デプロイガイド

## 構成

```
Cloudflare Pages  → フロントエンド (HTML/CSS/JS)
Cloudflare Workers → バックエンドAPI (メール認証)
Cloudflare KV     → トークン一時保存
Resend            → メール送信 (無料3000通/月)
```

---

## 事前準備

### 1. Resend アカウント作成・APIキー取得

1. [https://resend.com](https://resend.com) でアカウント作成（無料）
2. ダッシュボード → **API Keys** → `+ Create API Key`
3. 生成されたキー（`re_xxxx...`）をメモ

> **送信元メールアドレスについて**
> - **テスト用（無料）**: `onboarding@resend.dev` → 自分のアカウントメールにしか送れません
> - **本番用**: Resendで独自ドメインを認証すると任意のアドレスから送信可能
> - `wrangler.toml` の `MAIL_FROM_ADDRESS` を適宜変更してください

---

### 2. Wrangler CLI インストール・ログイン

```bash
npm install -g wrangler
wrangler login
```

---

## Workers デプロイ手順

### Step 1: KV Namespace を作成

```bash
cd worker
npm install

# 本番用KV作成
npm run kv:create
# 出力例: id = "abc123def456..."

# 開発用プレビューKV作成
npm run kv:create:preview
# 出力例: id = "preview_abc123..."
```

### Step 2: wrangler.toml を編集

`worker/wrangler.toml` を開いて以下を設定：

```toml
[[kv_namespaces]]
binding    = "TOKENS"
id         = "← npm run kv:create で取得したID"
preview_id = "← npm run kv:create:preview で取得したID"

[vars]
FRONTEND_URL      = "https://your-site.pages.dev"   ← Pages のURL
MAIL_FROM_ADDRESS = "onboarding@resend.dev"          ← 送信元アドレス
```

### Step 3: Secrets を登録（機密情報）

```bash
# Resend APIキー
wrangler secret put RESEND_API_KEY
# プロンプトに re_xxxx... を貼り付けてEnter

# APIシークレット（フロントエンドとWorkerの共有キー）
wrangler secret put API_SECRET
# 任意のランダム文字列を入力（例: openssl rand -hex 32 で生成）
```

### Step 4: Workers にデプロイ

```bash
npm run deploy
# 出力例:
# Published kushiro-chat-auth (0.09 sec)
# https://kushiro-chat-auth.your-account.workers.dev
```

**WorkerのURL**をメモしてください（フロントエンドの設定で使います）。

---

## フロントエンド設定

`js/config.js` を編集：

```javascript
window.KUSHIRO_API_BASE   = 'https://kushiro-chat-auth.your-account.workers.dev';
window.KUSHIRO_API_SECRET = 'Step3で設定したAPI_SECRETと同じ値';
```

---

## Cloudflare Pages デプロイ手順

### ① Cloudflare ダッシュボードから

1. **Pages** → `+ Create a project` → `Direct Upload`
2. プロジェクト名を設定（例: `kushiro-chat`）
3. `kushiro-chat/` フォルダをアップロード（`worker/` と `server/` は除く）
4. デプロイ → URLを確認（例: `https://kushiro-chat.pages.dev`）

### ② または Git 連携（GitHub/GitLab）

1. リポジトリをプッシュ（`worker/` フォルダは`.gitignore`に追加してもよい）
2. Pages → `Connect to Git` → リポジトリ選択
3. ビルド設定:
   - **フレームワーク**: `None`
   - **ビルドコマンド**: （空欄）
   - **出力ディレクトリ**: `/` または `kushiro-chat/`

---

## ローカル開発

```bash
# ターミナル1: Worker を起動
cd worker
npm run dev
# → http://localhost:8787 で起動

# ターミナル2: フロントエンドを起動
cd ..
python3 -m http.server 8080
# → http://localhost:8080 を開く
```

`js/config.js` のAPIベースをローカル用に変更：
```javascript
window.KUSHIRO_API_BASE = 'http://localhost:8787';
```

---

## 環境変数・Secrets 一覧

| 名前 | 種別 | 説明 |
|---|---|---|
| `FRONTEND_URL` | var | Pages の URL（CORS許可） |
| `MAIL_FROM_NAME` | var | 送信者表示名 |
| `MAIL_FROM_ADDRESS` | var | 送信元メールアドレス |
| `TOKEN_EXPIRES_SEC` | var | トークン有効期限（秒）デフォルト86400 |
| `RESEND_API_KEY` | **Secret** | Resend の APIキー |
| `API_SECRET` | **Secret** | フロントエンドとの共有キー |

> Secretsは `wrangler secret put <名前>` で登録するか、
> Cloudflareダッシュボード → Workers → `kushiro-chat-auth` → Settings → Variables で設定できます。

---

## トラブルシューティング

| 症状 | 原因 | 解決策 |
|---|---|---|
| メールが届かない | Resend APIキーが間違い | `wrangler secret put RESEND_API_KEY` で再設定 |
| CORSエラー | `FRONTEND_URL` が不一致 | `wrangler.toml` の `FRONTEND_URL` を確認 |
| 「トークンが見つかりません」 | KV IDが未設定 | `wrangler.toml` の `id` を確認 |
| 401エラー | `API_SECRET` が不一致 | `config.js` とWorkerのSecretを揃える |
| テスト時にメールが届かない | Resendテスト制限 | Resendは登録済みメールにしか送れません（無料テスト時） |
