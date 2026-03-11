/**
 * index.js - 釧路コミュニティチャット メール認証 Cloudflare Worker
 *
 * ランタイム: Cloudflare Workers (V8 isolate)
 * メール送信: Resend API (https://resend.com)
 * トークン保存: Cloudflare KV
 *
 * 環境変数 (wrangler.toml [vars] または Secrets):
 *   FRONTEND_URL        - フロントエンドURL (CORS許可対象)
 *   MAIL_FROM_NAME      - 送信者表示名
 *   MAIL_FROM_ADDRESS   - 送信元メールアドレス
 *   TOKEN_EXPIRES_SEC   - トークン有効期限(秒) デフォルト86400
 *   RESEND_API_KEY      - Resend APIキー [Secret]
 *   API_SECRET          - フロントエンドとの共有秘密キー [Secret]
 *
 * KV バインディング:
 *   TOKENS              - トークン保存用KV Namespace
 */

export default {
  async fetch(request, env) {
    // ---- CORS プリフライト ----
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      // ---- ルーティング ----
      if (path === '/api/send-verification' && request.method === 'POST') {
        return await handleSendVerification(request, env);
      }
      if (path.startsWith('/api/verify/') && request.method === 'GET') {
        const token = path.replace('/api/verify/', '');
        return await handleVerify(token, env);
      }
      if (path === '/api/resend-verification' && request.method === 'POST') {
        return await handleResend(request, env);
      }
      if (path === '/api/health' && request.method === 'GET') {
        return corsResponse({ ok: true, time: new Date().toISOString() }, 200, env);
      }

      return corsResponse({ ok: false, error: 'Not Found' }, 404, env);

    } catch (err) {
      console.error('[Worker Error]', err);
      return corsResponse({ ok: false, error: 'Internal Server Error' }, 500, env);
    }
  },
};

// ================================================================
// ハンドラ
// ================================================================

/**
 * POST /api/send-verification
 * 認証メール送信 & トークンをKVに保存
 */
async function handleSendVerification(request, env) {
  // APIシークレット検証
  const authErr = checkApiSecret(request, env);
  if (authErr) return authErr;

  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ ok: false, error: 'リクエストの形式が不正です' }, 400, env);
  }

  const { email, nickname, passwordHash, color } = body;

  // バリデーション
  if (!email || !nickname || !passwordHash) {
    return corsResponse({ ok: false, error: '必要なパラメータが不足しています' }, 400, env);
  }
  if (!/^[a-zA-Z0-9._%+\-]+@gmail\.com$/i.test(email)) {
    return corsResponse({ ok: false, error: 'Gmailアドレスのみ有効です' }, 400, env);
  }

  // 既存の未検証トークンを無効化（同じメールアドレスの再送対応）
  // KVはprefixリストで検索
  const listResult = await env.TOKENS.list({ prefix: `email:${email.toLowerCase()}:` });
  for (const key of listResult.keys) {
    await env.TOKENS.delete(key.name);
  }

  // トークン生成
  const token     = crypto.randomUUID();
  const expiresAt = Date.now() + Number(env.TOKEN_EXPIRES_SEC || 86400) * 1000;

  const tokenData = JSON.stringify({
    email:        email.toLowerCase(),
    nickname,
    passwordHash,
    color:        color || '#f4a620',
    expiresAt,
    verified:     false,
  });

  // KVに保存（TTL = TOKEN_EXPIRES_SEC秒後に自動削除）
  const ttlSeconds = Number(env.TOKEN_EXPIRES_SEC || 86400);
  await env.TOKENS.put(`token:${token}`, tokenData, { expirationTtl: ttlSeconds });
  // メールアドレス→トークンの逆引きインデックスも保存
  await env.TOKENS.put(`email:${email.toLowerCase()}:${token}`, token, { expirationTtl: ttlSeconds });

  // メール送信
  try {
    await sendVerificationEmail({ env, to: email, nickname, token });
  } catch (err) {
    console.error('[Resend Error]', err.message);
    // 失敗したらKVのトークンも削除
    await env.TOKENS.delete(`token:${token}`);
    await env.TOKENS.delete(`email:${email.toLowerCase()}:${token}`);
    return corsResponse({ ok: false, error: 'メール送信に失敗しました。Resend APIキーを確認してください。' }, 500, env);
  }

  console.log(`[Send] ${email} → token: ${token.slice(0, 8)}...`);
  return corsResponse({ ok: true, message: '認証メールを送信しました' }, 200, env);
}

/**
 * GET /api/verify/:token
 * トークン検証 → アカウントデータをフロントに返す
 */
async function handleVerify(token, env) {
  if (!token || token.length < 10) {
    return corsResponse({ ok: false, error: 'トークンが不正です' }, 400, env);
  }

  const raw = await env.TOKENS.get(`token:${token}`);
  if (!raw) {
    return corsResponse({ ok: false, error: 'トークンが見つかりません。リンクが無効か、期限切れです。' }, 404, env);
  }

  let data;
  try { data = JSON.parse(raw); } catch {
    return corsResponse({ ok: false, error: 'トークンデータが破損しています' }, 500, env);
  }

  if (data.expiresAt < Date.now()) {
    await env.TOKENS.delete(`token:${token}`);
    return corsResponse({ ok: false, error: '認証リンクの有効期限が切れました。再度登録をお試しください。' }, 410, env);
  }
  if (data.verified) {
    return corsResponse({ ok: false, error: 'このトークンはすでに使用済みです。' }, 409, env);
  }

  // 検証成功 → 使用済みフラグを立てて更新
  data.verified = true;
  // 使用済みトークンは短時間だけ保持（重複クリック防止用・5分）
  await env.TOKENS.put(`token:${token}`, JSON.stringify(data), { expirationTtl: 300 });
  // 逆引きインデックス削除
  await env.TOKENS.delete(`email:${data.email}:${token}`);

  console.log(`[Verify] ${data.email} → verified ✅`);

  return corsResponse({
    ok: true,
    account: {
      email:        data.email,
      nickname:     data.nickname,
      passwordHash: data.passwordHash,
      color:        data.color,
    },
  }, 200, env);
}

/**
 * POST /api/resend-verification
 * 認証メール再送
 */
async function handleResend(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return corsResponse({ ok: false, error: 'リクエストの形式が不正です' }, 400, env);
  }

  const { email } = body;
  if (!email) return corsResponse({ ok: false, error: 'メールアドレスが必要です' }, 400, env);

  // 既存の未検証トークンを検索
  const listResult = await env.TOKENS.list({ prefix: `email:${email.toLowerCase()}:` });
  if (!listResult.keys.length) {
    return corsResponse({ ok: false, error: '対象の未認証登録が見つかりません。新規登録をお試しください。' }, 404, env);
  }

  // 最初に見つかったトークンのデータを取得
  const existingToken = listResult.keys[0].name.split(':').pop();
  const raw = await env.TOKENS.get(`token:${existingToken}`);
  if (!raw) {
    return corsResponse({ ok: false, error: 'トークンが見つかりません' }, 404, env);
  }

  const data = JSON.parse(raw);

  // 古いトークンを削除
  await env.TOKENS.delete(`token:${existingToken}`);
  await env.TOKENS.delete(`email:${email.toLowerCase()}:${existingToken}`);

  // 新しいトークンを発行
  const newToken   = crypto.randomUUID();
  const ttlSeconds = Number(env.TOKEN_EXPIRES_SEC || 86400);
  const expiresAt  = Date.now() + ttlSeconds * 1000;
  const newData    = { ...data, expiresAt, verified: false };

  await env.TOKENS.put(`token:${newToken}`, JSON.stringify(newData), { expirationTtl: ttlSeconds });
  await env.TOKENS.put(`email:${email.toLowerCase()}:${newToken}`, newToken, { expirationTtl: ttlSeconds });

  try {
    await sendVerificationEmail({ env, to: email, nickname: data.nickname, token: newToken });
  } catch (err) {
    console.error('[Resend Error]', err.message);
    return corsResponse({ ok: false, error: 'メール再送に失敗しました' }, 500, env);
  }

  return corsResponse({ ok: true, message: '認証メールを再送しました' }, 200, env);
}

// ================================================================
// メール送信 (Resend API)
// ================================================================
async function sendVerificationEmail({ env, to, nickname, token }) {
  const frontendUrl  = env.FRONTEND_URL || 'http://localhost:8788';
  const verifyUrl    = `${frontendUrl}/verify.html?token=${token}`;
  const fromName     = env.MAIL_FROM_NAME    || '釧路コミュニティチャット';
  const fromAddress  = env.MAIL_FROM_ADDRESS || 'onboarding@resend.dev';
  const expiresHours = Math.round(Number(env.TOKEN_EXPIRES_SEC || 86400) / 3600);

  const htmlBody = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;background:#060c18;color:#e8eaf6;margin:0;padding:20px;">
  <div style="max-width:520px;margin:0 auto;background:#0f1525;border:1px solid rgba(244,166,32,.3);border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0a0e1a,#1a2340);padding:32px 36px;text-align:center;border-bottom:1px solid rgba(244,166,32,.2);">
      <div style="font-size:2rem;margin-bottom:8px;">🌊</div>
      <h1 style="font-size:1.2rem;color:#f4a620;margin:0;letter-spacing:.05em;">釧路コミュニティチャット</h1>
      <p style="font-size:.72rem;color:#5a6585;margin:4px 0 0;letter-spacing:.1em;text-transform:uppercase;">Kushiro Community Chat</p>
    </div>
    <div style="padding:32px 36px;">
      <p style="font-size:1rem;color:#e8eaf6;margin:0 0 8px;"><strong>${escHtml(nickname)}</strong> さん、ご登録ありがとうございます。</p>
      <p style="font-size:.875rem;color:#9aa5c4;margin:0 0 28px;line-height:1.7;">
        下記のボタンをクリックして、メールアドレスの確認を完了してください。<br>確認が完了するとコミュニティに参加できます。
      </p>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${verifyUrl}" style="display:inline-block;padding:14px 36px;background:#f4a620;color:#060c18;text-decoration:none;border-radius:10px;font-weight:700;font-size:.95rem;">
          メールアドレスを確認する
        </a>
      </div>
      <div style="background:#141b2d;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px 16px;margin-bottom:20px;">
        <p style="font-size:.7rem;color:#5a6585;margin:0 0 4px;">ボタンが機能しない場合はURLをコピーしてください：</p>
        <p style="font-size:.75rem;color:#4dd0e1;margin:0;word-break:break-all;">${verifyUrl}</p>
      </div>
      <p style="font-size:.78rem;color:#5a6585;margin:0;line-height:1.6;">
        このリンクの有効期限は <strong style="color:#9aa5c4;">${expiresHours}時間</strong> です。<br>
        心当たりのない場合は、このメールを無視してください。
      </p>
    </div>
    <div style="padding:16px 36px;background:#0a0e1a;border-top:1px solid rgba(255,255,255,.05);text-align:center;">
      <p style="font-size:.68rem;color:#3a4460;margin:0;">北海道釧路市地域住民向けコミュニティ</p>
    </div>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    `${fromName} <${fromAddress}>`,
      to:      [to],
      subject: '【釧路コミュニティチャット】メールアドレスの確認',
      html:    htmlBody,
      text:    `${nickname} さん、ご登録ありがとうございます。\n\n下記URLをクリックしてメールアドレスの確認を完了してください。\n\n${verifyUrl}\n\nこのリンクの有効期限は${expiresHours}時間です。\n\n心当たりのない場合はこのメールを無視してください。\n\n釧路コミュニティチャット`,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Resend API Error: ${res.status} ${JSON.stringify(err)}`);
  }
}

// ================================================================
// ユーティリティ
// ================================================================

/** CORSヘッダー付きJSONレスポンス */
function corsResponse(body, status, env) {
  const origin = env?.FRONTEND_URL || '*';
  const headers = {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Secret',
  };
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}

/** APIシークレット検証 */
function checkApiSecret(request, env) {
  if (!env.API_SECRET) return null; // 未設定なら無視（開発用）
  const header = request.headers.get('X-API-Secret');
  if (header !== env.API_SECRET) {
    return corsResponse({ ok: false, error: '認証エラー' }, 401, env);
  }
  return null;
}

/** HTMLエスケープ */
function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}
