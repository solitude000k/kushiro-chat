var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204, env);
    }
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/send-verification" && request.method === "POST") {
        return await handleSendVerification(request, env);
      }
      if (path.startsWith("/api/verify/") && request.method === "GET") {
        const token = path.replace("/api/verify/", "");
        return await handleVerify(token, env);
      }
      if (path === "/api/resend-verification" && request.method === "POST") {
        return await handleResend(request, env);
      }
      if (path === "/api/health" && request.method === "GET") {
        return corsResponse({ ok: true, time: (/* @__PURE__ */ new Date()).toISOString() }, 200, env);
      }
      return corsResponse({ ok: false, error: "Not Found" }, 404, env);
    } catch (err) {
      console.error("[Worker Error]", err);
      return corsResponse({ ok: false, error: "Internal Server Error" }, 500, env);
    }
  }
};
async function handleSendVerification(request, env) {
  const authErr = checkApiSecret(request, env);
  if (authErr)
    return authErr;
  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ ok: false, error: "\u30EA\u30AF\u30A8\u30B9\u30C8\u306E\u5F62\u5F0F\u304C\u4E0D\u6B63\u3067\u3059" }, 400, env);
  }
  const { email, nickname, passwordHash, color } = body;
  if (!email || !nickname || !passwordHash) {
    return corsResponse({ ok: false, error: "\u5FC5\u8981\u306A\u30D1\u30E9\u30E1\u30FC\u30BF\u304C\u4E0D\u8DB3\u3057\u3066\u3044\u307E\u3059" }, 400, env);
  }
  if (!/^[a-zA-Z0-9._%+\-]+@gmail\.com$/i.test(email)) {
    return corsResponse({ ok: false, error: "Gmail\u30A2\u30C9\u30EC\u30B9\u306E\u307F\u6709\u52B9\u3067\u3059" }, 400, env);
  }
  const listResult = await env.TOKENS.list({ prefix: `email:${email.toLowerCase()}:` });
  for (const key of listResult.keys) {
    await env.TOKENS.delete(key.name);
  }
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + Number(env.TOKEN_EXPIRES_SEC || 86400) * 1e3;
  const tokenData = JSON.stringify({
    email: email.toLowerCase(),
    nickname,
    passwordHash,
    color: color || "#f4a620",
    expiresAt,
    verified: false
  });
  const ttlSeconds = Number(env.TOKEN_EXPIRES_SEC || 86400);
  await env.TOKENS.put(`token:${token}`, tokenData, { expirationTtl: ttlSeconds });
  await env.TOKENS.put(`email:${email.toLowerCase()}:${token}`, token, { expirationTtl: ttlSeconds });
  try {
    await sendVerificationEmail({ env, to: email, nickname, token });
  } catch (err) {
    console.error("[Resend Error]", err.message);
    await env.TOKENS.delete(`token:${token}`);
    await env.TOKENS.delete(`email:${email.toLowerCase()}:${token}`);
    return corsResponse({ ok: false, error: "\u30E1\u30FC\u30EB\u9001\u4FE1\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002Resend API\u30AD\u30FC\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002" }, 500, env);
  }
  console.log(`[Send] ${email} \u2192 token: ${token.slice(0, 8)}...`);
  return corsResponse({ ok: true, message: "\u8A8D\u8A3C\u30E1\u30FC\u30EB\u3092\u9001\u4FE1\u3057\u307E\u3057\u305F" }, 200, env);
}
__name(handleSendVerification, "handleSendVerification");
async function handleVerify(token, env) {
  if (!token || token.length < 10) {
    return corsResponse({ ok: false, error: "\u30C8\u30FC\u30AF\u30F3\u304C\u4E0D\u6B63\u3067\u3059" }, 400, env);
  }
  const raw = await env.TOKENS.get(`token:${token}`);
  if (!raw) {
    return corsResponse({ ok: false, error: "\u30C8\u30FC\u30AF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u30EA\u30F3\u30AF\u304C\u7121\u52B9\u304B\u3001\u671F\u9650\u5207\u308C\u3067\u3059\u3002" }, 404, env);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return corsResponse({ ok: false, error: "\u30C8\u30FC\u30AF\u30F3\u30C7\u30FC\u30BF\u304C\u7834\u640D\u3057\u3066\u3044\u307E\u3059" }, 500, env);
  }
  if (data.expiresAt < Date.now()) {
    await env.TOKENS.delete(`token:${token}`);
    return corsResponse({ ok: false, error: "\u8A8D\u8A3C\u30EA\u30F3\u30AF\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u307E\u3057\u305F\u3002\u518D\u5EA6\u767B\u9332\u3092\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002" }, 410, env);
  }
  if (data.verified) {
    return corsResponse({ ok: false, error: "\u3053\u306E\u30C8\u30FC\u30AF\u30F3\u306F\u3059\u3067\u306B\u4F7F\u7528\u6E08\u307F\u3067\u3059\u3002" }, 409, env);
  }
  data.verified = true;
  await env.TOKENS.put(`token:${token}`, JSON.stringify(data), { expirationTtl: 300 });
  await env.TOKENS.delete(`email:${data.email}:${token}`);
  console.log(`[Verify] ${data.email} \u2192 verified \u2705`);
  return corsResponse({
    ok: true,
    account: {
      email: data.email,
      nickname: data.nickname,
      passwordHash: data.passwordHash,
      color: data.color
    }
  }, 200, env);
}
__name(handleVerify, "handleVerify");
async function handleResend(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ ok: false, error: "\u30EA\u30AF\u30A8\u30B9\u30C8\u306E\u5F62\u5F0F\u304C\u4E0D\u6B63\u3067\u3059" }, 400, env);
  }
  const { email } = body;
  if (!email)
    return corsResponse({ ok: false, error: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u304C\u5FC5\u8981\u3067\u3059" }, 400, env);
  const listResult = await env.TOKENS.list({ prefix: `email:${email.toLowerCase()}:` });
  if (!listResult.keys.length) {
    return corsResponse({ ok: false, error: "\u5BFE\u8C61\u306E\u672A\u8A8D\u8A3C\u767B\u9332\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u65B0\u898F\u767B\u9332\u3092\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002" }, 404, env);
  }
  const existingToken = listResult.keys[0].name.split(":").pop();
  const raw = await env.TOKENS.get(`token:${existingToken}`);
  if (!raw) {
    return corsResponse({ ok: false, error: "\u30C8\u30FC\u30AF\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404, env);
  }
  const data = JSON.parse(raw);
  await env.TOKENS.delete(`token:${existingToken}`);
  await env.TOKENS.delete(`email:${email.toLowerCase()}:${existingToken}`);
  const newToken = crypto.randomUUID();
  const ttlSeconds = Number(env.TOKEN_EXPIRES_SEC || 86400);
  const expiresAt = Date.now() + ttlSeconds * 1e3;
  const newData = { ...data, expiresAt, verified: false };
  await env.TOKENS.put(`token:${newToken}`, JSON.stringify(newData), { expirationTtl: ttlSeconds });
  await env.TOKENS.put(`email:${email.toLowerCase()}:${newToken}`, newToken, { expirationTtl: ttlSeconds });
  try {
    await sendVerificationEmail({ env, to: email, nickname: data.nickname, token: newToken });
  } catch (err) {
    console.error("[Resend Error]", err.message);
    return corsResponse({ ok: false, error: "\u30E1\u30FC\u30EB\u518D\u9001\u306B\u5931\u6557\u3057\u307E\u3057\u305F" }, 500, env);
  }
  return corsResponse({ ok: true, message: "\u8A8D\u8A3C\u30E1\u30FC\u30EB\u3092\u518D\u9001\u3057\u307E\u3057\u305F" }, 200, env);
}
__name(handleResend, "handleResend");
async function sendVerificationEmail({ env, to, nickname, token }) {
  const frontendUrl = env.FRONTEND_URL || "http://localhost:8788";
  const verifyUrl = `${frontendUrl}/verify.html?token=${token}`;
  const fromName = env.MAIL_FROM_NAME || "\u91E7\u8DEF\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u30C1\u30E3\u30C3\u30C8";
  const fromAddress = env.MAIL_FROM_ADDRESS || "onboarding@resend.dev";
  const expiresHours = Math.round(Number(env.TOKEN_EXPIRES_SEC || 86400) / 3600);
  const htmlBody = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;background:#060c18;color:#e8eaf6;margin:0;padding:20px;">
  <div style="max-width:520px;margin:0 auto;background:#0f1525;border:1px solid rgba(244,166,32,.3);border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0a0e1a,#1a2340);padding:32px 36px;text-align:center;border-bottom:1px solid rgba(244,166,32,.2);">
      <div style="font-size:2rem;margin-bottom:8px;">\u{1F30A}</div>
      <h1 style="font-size:1.2rem;color:#f4a620;margin:0;letter-spacing:.05em;">\u91E7\u8DEF\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u30C1\u30E3\u30C3\u30C8</h1>
      <p style="font-size:.72rem;color:#5a6585;margin:4px 0 0;letter-spacing:.1em;text-transform:uppercase;">Kushiro Community Chat</p>
    </div>
    <div style="padding:32px 36px;">
      <p style="font-size:1rem;color:#e8eaf6;margin:0 0 8px;"><strong>${escHtml(nickname)}</strong> \u3055\u3093\u3001\u3054\u767B\u9332\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002</p>
      <p style="font-size:.875rem;color:#9aa5c4;margin:0 0 28px;line-height:1.7;">
        \u4E0B\u8A18\u306E\u30DC\u30BF\u30F3\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u3001\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u78BA\u8A8D\u3092\u5B8C\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002<br>\u78BA\u8A8D\u304C\u5B8C\u4E86\u3059\u308B\u3068\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306B\u53C2\u52A0\u3067\u304D\u307E\u3059\u3002
      </p>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${verifyUrl}" style="display:inline-block;padding:14px 36px;background:#f4a620;color:#060c18;text-decoration:none;border-radius:10px;font-weight:700;font-size:.95rem;">
          \u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3092\u78BA\u8A8D\u3059\u308B
        </a>
      </div>
      <div style="background:#141b2d;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px 16px;margin-bottom:20px;">
        <p style="font-size:.7rem;color:#5a6585;margin:0 0 4px;">\u30DC\u30BF\u30F3\u304C\u6A5F\u80FD\u3057\u306A\u3044\u5834\u5408\u306FURL\u3092\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044\uFF1A</p>
        <p style="font-size:.75rem;color:#4dd0e1;margin:0;word-break:break-all;">${verifyUrl}</p>
      </div>
      <p style="font-size:.78rem;color:#5a6585;margin:0;line-height:1.6;">
        \u3053\u306E\u30EA\u30F3\u30AF\u306E\u6709\u52B9\u671F\u9650\u306F <strong style="color:#9aa5c4;">${expiresHours}\u6642\u9593</strong> \u3067\u3059\u3002<br>
        \u5FC3\u5F53\u305F\u308A\u306E\u306A\u3044\u5834\u5408\u306F\u3001\u3053\u306E\u30E1\u30FC\u30EB\u3092\u7121\u8996\u3057\u3066\u304F\u3060\u3055\u3044\u3002
      </p>
    </div>
    <div style="padding:16px 36px;background:#0a0e1a;border-top:1px solid rgba(255,255,255,.05);text-align:center;">
      <p style="font-size:.68rem;color:#3a4460;margin:0;">\u5317\u6D77\u9053\u91E7\u8DEF\u5E02\u5730\u57DF\u4F4F\u6C11\u5411\u3051\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3</p>
    </div>
  </div>
</body>
</html>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `${fromName} <${fromAddress}>`,
      to: [to],
      subject: "\u3010\u91E7\u8DEF\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u30C1\u30E3\u30C3\u30C8\u3011\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u78BA\u8A8D",
      html: htmlBody,
      text: `${nickname} \u3055\u3093\u3001\u3054\u767B\u9332\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002

\u4E0B\u8A18URL\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u78BA\u8A8D\u3092\u5B8C\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002

${verifyUrl}

\u3053\u306E\u30EA\u30F3\u30AF\u306E\u6709\u52B9\u671F\u9650\u306F${expiresHours}\u6642\u9593\u3067\u3059\u3002

\u5FC3\u5F53\u305F\u308A\u306E\u306A\u3044\u5834\u5408\u306F\u3053\u306E\u30E1\u30FC\u30EB\u3092\u7121\u8996\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u91E7\u8DEF\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u30C1\u30E3\u30C3\u30C8`
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Resend API Error: ${res.status} ${JSON.stringify(err)}`);
  }
}
__name(sendVerificationEmail, "sendVerificationEmail");
function corsResponse(body, status, env) {
  const origin = env?.FRONTEND_URL || "*";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Secret"
  };
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}
__name(corsResponse, "corsResponse");
function checkApiSecret(request, env) {
  if (!env.API_SECRET)
    return null;
  const header = request.headers.get("X-API-Secret");
  if (header !== env.API_SECRET) {
    return corsResponse({ ok: false, error: "\u8A8D\u8A3C\u30A8\u30E9\u30FC" }, 401, env);
  }
  return null;
}
__name(checkApiSecret, "checkApiSecret");
function escHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]
  );
}
__name(escHtml, "escHtml");
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
