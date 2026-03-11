/**
 * server.js - 釧路コミュニティチャット メール認証バックエンド
 *
 * 担当:
 *   - メール認証トークンの生成・管理・検証
 *   - Gmailによる認証メール送信
 *   - フロントエンドへのAPIレスポンス
 */

'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ================================================================
// ミドルウェア
// ================================================================
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Secret'],
}));

// フロントエンドの静的ファイルを配信（サーバーと同じオリジンで動かす場合）
// 本番では nginx 等でフロントエンドを配信し、API は /api/* のみにする
app.use(express.static(path.join(__dirname, '..')));

// ================================================================
// トークンストア（メモリ）
// { token: { email, nickname, color, passwordHash, expiresAt, verified } }
// ================================================================
const tokenStore = new Map();

// 期限切れトークンを定期的に削除
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of tokenStore) {
    if (data.expiresAt < now) {
      tokenStore.delete(token);
      console.log(`[Token] Expired and removed: ${token.slice(0, 8)}...`);
    }
  }
}, 10 * 60 * 1000); // 10分ごと

// ================================================================
// Nodemailer トランスポート
// ================================================================
function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

async function verifyTransport() {
  try {
    const t = createTransport();
    await t.verify();
    console.log('✅ Gmail SMTP 接続確認 OK');
    return true;
  } catch (e) {
    console.error('❌ Gmail SMTP 接続失敗:', e.message);
    console.error('   .env の GMAIL_USER / GMAIL_APP_PASSWORD を確認してください');
    return false;
  }
}

// ================================================================
// APIキー検証ミドルウェア
// ================================================================
function requireApiSecret(req, res, next) {
  const secret = req.headers['x-api-secret'];
  if (!process.env.API_SECRET || process.env.API_SECRET === 'change-this-to-a-random-secret-string') {
    // 開発中は警告のみ
    console.warn('⚠️  API_SECRET が未設定です。本番環境では必ず設定してください。');
    return next();
  }
  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ ok: false, error: '認証エラー' });
  }
  next();
}

// ================================================================
// メール送信ヘルパー
// ================================================================
async function sendVerificationEmail({ to, nickname, token }) {
  const frontendUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
  const verifyUrl   = `${frontendUrl}/verify.html?token=${token}`;
  const fromName    = process.env.MAIL_FROM_NAME || '釧路コミュニティチャット';
  const expiresHours = Math.round((process.env.TOKEN_EXPIRES_MS || 86400000) / 3600000);

  const transport = createTransport();

  const mailOptions = {
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to,
    subject: '【釧路コミュニティチャット】メールアドレスの確認',
    text: `
${nickname} さん、ご登録ありがとうございます。

下記のURLをクリックして、メールアドレスの確認を完了してください。

${verifyUrl}

このリンクの有効期限は${expiresHours}時間です。

心当たりのない場合は、このメールを無視してください。

---
釧路コミュニティチャット
    `.trim(),
    html: `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;background:#060c18;color:#e8eaf6;margin:0;padding:20px;">
  <div style="max-width:520px;margin:0 auto;background:#0f1525;border:1px solid rgba(244,166,32,.3);border-radius:16px;overflow:hidden;">

    <!-- ヘッダー -->
    <div style="background:linear-gradient(135deg,#0a0e1a,#1a2340);padding:32px 36px;text-align:center;border-bottom:1px solid rgba(244,166,32,.2);">
      <div style="font-size:2rem;margin-bottom:8px;">🌊</div>
      <h1 style="font-size:1.2rem;color:#f4a620;margin:0;letter-spacing:.05em;">釧路コミュニティチャット</h1>
      <p style="font-size:.72rem;color:#5a6585;margin:4px 0 0;letter-spacing:.1em;text-transform:uppercase;">Kushiro Community Chat</p>
    </div>

    <!-- 本文 -->
    <div style="padding:32px 36px;">
      <p style="font-size:1rem;color:#e8eaf6;margin:0 0 8px;"><strong>${escapeHtml(nickname)}</strong> さん、ご登録ありがとうございます。</p>
      <p style="font-size:.875rem;color:#9aa5c4;margin:0 0 28px;line-height:1.7;">
        下記のボタンをクリックして、メールアドレスの確認を完了してください。<br>
        確認が完了するとコミュニティに参加できます。
      </p>

      <!-- 認証ボタン -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${verifyUrl}"
           style="display:inline-block;padding:14px 36px;background:#f4a620;color:#060c18;
                  text-decoration:none;border-radius:10px;font-weight:700;font-size:.95rem;
                  letter-spacing:.02em;box-shadow:0 0 20px rgba(244,166,32,.3);">
          メールアドレスを確認する
        </a>
      </div>

      <!-- URL表示 -->
      <div style="background:#141b2d;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px 16px;margin-bottom:20px;">
        <p style="font-size:.7rem;color:#5a6585;margin:0 0 4px;">ボタンが機能しない場合は以下のURLをコピーしてください：</p>
        <p style="font-size:.75rem;color:#4dd0e1;margin:0;word-break:break-all;">${verifyUrl}</p>
      </div>

      <p style="font-size:.78rem;color:#5a6585;margin:0;line-height:1.6;">
        このリンクの有効期限は <strong style="color:#9aa5c4;">${expiresHours}時間</strong> です。<br>
        心当たりのない場合は、このメールを無視してください。
      </p>
    </div>

    <!-- フッター -->
    <div style="padding:16px 36px;background:#0a0e1a;border-top:1px solid rgba(255,255,255,.05);text-align:center;">
      <p style="font-size:.68rem;color:#3a4460;margin:0;">北海道釧路市地域住民向けコミュニティ</p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  };

  await transport.sendMail(mailOptions);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])
  );
}

// ================================================================
// API エンドポイント
// ================================================================

/**
 * POST /api/send-verification
 * 認証メール送信
 * Body: { email, nickname, passwordHash, color }
 */
app.post('/api/send-verification', requireApiSecret, async (req, res) => {
  const { email, nickname, passwordHash, color } = req.body;

  // バリデーション
  if (!email || !nickname || !passwordHash) {
    return res.status(400).json({ ok: false, error: '必要なパラメータが不足しています' });
  }
  if (!/^[a-zA-Z0-9._%+\-]+@gmail\.com$/i.test(email)) {
    return res.status(400).json({ ok: false, error: 'Gmailアドレスのみ有効です' });
  }

  // 既存の未検証トークンを削除（同じメールの再送に対応）
  for (const [tk, data] of tokenStore) {
    if (data.email.toLowerCase() === email.toLowerCase() && !data.verified) {
      tokenStore.delete(tk);
    }
  }

  // トークン生成
  const token    = uuidv4();
  const expiresAt = Date.now() + Number(process.env.TOKEN_EXPIRES_MS || 86400000);
  tokenStore.set(token, { email: email.toLowerCase(), nickname, passwordHash, color, expiresAt, verified: false });

  console.log(`[Send] ${email} → token: ${token.slice(0,8)}...`);

  try {
    await sendVerificationEmail({ to: email, nickname, token });
    res.json({ ok: true, message: '認証メールを送信しました' });
  } catch (err) {
    console.error('[Mail Error]', err.message);
    tokenStore.delete(token); // 失敗したらトークン削除
    res.status(500).json({ ok: false, error: 'メール送信に失敗しました。サーバー設定を確認してください。' });
  }
});

/**
 * GET /api/verify/:token
 * トークン検証 → アカウントデータをフロントに返す
 */
app.get('/api/verify/:token', (req, res) => {
  const { token } = req.params;
  const data = tokenStore.get(token);

  if (!data) {
    return res.status(404).json({ ok: false, error: 'トークンが見つかりません。リンクが無効か、期限切れです。' });
  }
  if (data.expiresAt < Date.now()) {
    tokenStore.delete(token);
    return res.status(410).json({ ok: false, error: '認証リンクの有効期限が切れました。再度登録をお試しください。' });
  }
  if (data.verified) {
    return res.status(409).json({ ok: false, error: 'このトークンはすでに使用済みです。' });
  }

  // 検証成功 → トークンを使用済みにしてアカウントデータを返す
  data.verified = true;
  tokenStore.set(token, data);

  console.log(`[Verify] ${data.email} → verified ✅`);

  res.json({
    ok: true,
    account: {
      email:        data.email,
      nickname:     data.nickname,
      passwordHash: data.passwordHash,
      color:        data.color || '#f4a620',
    },
  });
});

/**
 * POST /api/resend-verification
 * 認証メール再送
 * Body: { email }
 */
app.post('/api/resend-verification', requireApiSecret, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ ok: false, error: 'メールアドレスが必要です' });

  // 既存の未検証トークンを探す
  let found = null;
  for (const [tk, data] of tokenStore) {
    if (data.email.toLowerCase() === email.toLowerCase() && !data.verified) {
      found = { token: tk, data };
      break;
    }
  }

  if (!found) {
    return res.status(404).json({ ok: false, error: '対象の未認証アカウントが見つかりません' });
  }

  // トークンを更新して再送
  const newToken   = uuidv4();
  const expiresAt  = Date.now() + Number(process.env.TOKEN_EXPIRES_MS || 86400000);
  const newData    = { ...found.data, expiresAt };
  tokenStore.delete(found.token);
  tokenStore.set(newToken, newData);

  try {
    await sendVerificationEmail({ to: email, nickname: found.data.nickname, token: newToken });
    res.json({ ok: true, message: '認証メールを再送しました' });
  } catch (err) {
    console.error('[Resend Error]', err.message);
    res.status(500).json({ ok: false, error: 'メール再送に失敗しました' });
  }
});

/**
 * GET /api/health
 * ヘルスチェック
 */
app.get('/api/health', (req, res) => {
  res.json({
    ok:      true,
    uptime:  process.uptime(),
    tokens:  tokenStore.size,
    time:    new Date().toISOString(),
  });
});

// ================================================================
// サーバー起動
// ================================================================
app.listen(PORT, async () => {
  console.log('');
  console.log('🌊 釧路コミュニティチャット — 認証サーバー起動');
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   フロントエンド: ${process.env.FRONTEND_URL || '（未設定）'}`);
  console.log('');
  await verifyTransport();
  console.log('');
});
