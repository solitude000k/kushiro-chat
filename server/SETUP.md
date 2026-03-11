# サーバーセットアップガイド

## 前提条件
- **Node.js v18以上** がインストール済みであること
- **Gmailアカウント** と **2段階認証** が有効であること

---

## 1. Gmailアプリパスワードの取得

1. Googleアカウントにログイン → [セキュリティ設定](https://myaccount.google.com/security) を開く
2. 「2段階認証プロセス」が **有効** になっているか確認
3. 検索バーに「アプリパスワード」と入力 → 「アプリパスワード」を選択
4. アプリ名に「釧路チャット」など任意の名前を入力 → 「作成」
5. 表示された **16桁のパスワード（スペース含む）** をメモする

---

## 2. 環境設定ファイルの作成

```bash
cd server
cp .env.example .env
```

`.env` を編集して以下を設定：

```env
PORT=3000
FRONTEND_URL=http://localhost:8080

GMAIL_USER=あなたのメールアドレス@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   ← 手順1で取得した16桁

MAIL_FROM_NAME=釧路コミュニティチャット
TOKEN_EXPIRES_MS=86400000

API_SECRET=ランダムな文字列（下記コマンドで生成）
```

`API_SECRET` の生成：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. 依存パッケージのインストール

```bash
cd server
npm install
```

---

## 4. サーバーの起動

```bash
# 通常起動
npm start

# 開発モード（ファイル変更時に自動再起動）
npm run dev
```

起動成功時の表示：
```
🌊 釧路コミュニティチャット — 認証サーバー起動
   URL: http://localhost:3000
   フロントエンド: http://localhost:8080

✅ Gmail SMTP 接続確認 OK
```

---

## 5. フロントエンドの起動

別のターミナルで：

```bash
# プロジェクトルート（kushiro-chat/）で実行
cd ..
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080` を開く。

---

## 6. フロントエンドのAPI設定（必要な場合）

フロントエンドとサーバーが**同じオリジン**（localhost:3000）で動く場合は設定不要です。

**別オリジンで動かす場合**、フロントエンドの各HTMLファイルの `<head>` に追加：

```html
<script>
  window.KUSHIRO_API_BASE   = 'https://your-server.com';
  window.KUSHIRO_API_SECRET = 'your-api-secret';
</script>
```

---

## フロー概要

```
ユーザー登録
    │
    ▼
[フロントエンド] パスワードをSHA-256ハッシュ化
    │
    ▼
[POST /api/send-verification]
    │  { email, nickname, passwordHash, color }
    ▼
[サーバー] トークン生成 → Gmailで認証メール送信
    │
    ▼
ユーザーがメール内リンクをクリック
    │  https://localhost:8080/verify.html?token=xxxx
    ▼
[GET /api/verify/:token]
    │  → トークン検証 → アカウントデータ返却
    ▼
[verify.html] アカウントをlocalStorageに保存（verified: true）
    │
    ▼
チャットへ自動リダイレクト ✅
```

---

## トラブルシューティング

| エラー | 原因 | 解決策 |
|--------|------|--------|
| Gmail SMTP 接続失敗 | App Passwordが間違い | `.env` の `GMAIL_APP_PASSWORD` を確認 |
| メールが届かない | 迷惑メールに振り分け | 迷惑メールフォルダを確認 |
| 「サーバーに接続できません」 | サーバー未起動 | `npm start` でサーバーを起動 |
| CORS エラー | FRONTEND_URL の設定ミス | `.env` の `FRONTEND_URL` を確認 |
| トークン期限切れ | 24時間以上経過 | 再登録または再送ボタンを使用 |
