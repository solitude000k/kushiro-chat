/**
 * api.js - D1バックエンド API クライアント
 * storage.js の後に読み込むこと
 */

const API = (() => {
  const B = () => window.KUSHIRO_API_BASE  || '';
  const S = () => window.KUSHIRO_API_SECRET || '';

  // 管理者トークン (メモリ内、5分間有効)
  let _adminToken  = '';
  let _adminExpiry = 0;

  function getAdminToken()         { return Date.now() < _adminExpiry ? _adminToken : ''; }
  function setAdminToken(t, ttlMs) { _adminToken = t; _adminExpiry = Date.now() + ttlMs; }

  function headers(useAdmin = false) {
    const h = { 'Content-Type': 'application/json', 'X-API-Secret': S() };
    const tok = Storage.Session.getToken();
    if (tok) h['X-Session-Token'] = tok;
    if (useAdmin) { const at = getAdminToken(); if (at) h['X-Admin-Token'] = at; }
    return h;
  }

  async function req(method, path, body, useAdmin = false) {
    const opts = { method, headers: headers(useAdmin) };
    if (body !== undefined) opts.body = JSON.stringify(body);
    try {
      const res  = await fetch(B() + path, opts);
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('[API Error]', method, path, err);
      return { ok: false, error: 'サーバーに接続できません' };
    }
  }

  // ================================================================
  // 認証
  // ================================================================
  async function login(email, passwordHash) {
    return req('POST', '/api/auth/login', { email, passwordHash });
  }

  /** 管理者パスワード確認 → adminToken を内部にセット */
  async function adminVerify(password) {
    const hash = await Storage.sha256(password);
    const res  = await req('POST', '/api/auth/admin-verify', { passwordHash: hash });
    if (res.ok && res.adminToken) setAdminToken(res.adminToken, 5 * 60 * 1000);
    return res;
  }

  function isAdminTokenValid() { return Date.now() < _adminExpiry; }

  // ================================================================
  // アカウント
  // ================================================================
  async function getMyAccount() {
    return req('GET', '/api/accounts/me');
  }

  async function checkUserId(userId) {
    return req('GET', `/api/check-userid?userId=${encodeURIComponent(userId)}`);
  }

  async function listAccounts() {
    return req('GET', '/api/accounts', undefined, true);
  }

  async function updateAccount(id, updates) {
    return req('PUT', `/api/accounts/${id}`, updates);
  }

  async function deleteAccount(id) {
    return req('DELETE', `/api/accounts/${id}`);
  }

  async function adminDeleteAccount(id) {
    return req('DELETE', `/api/admin/accounts/${id}`, undefined, true);
  }

  async function adminSetup(nickname, passwordHash, color) {
    return req('POST', '/api/admin/setup', { nickname, passwordHash, color });
  }

  // ================================================================
  // 掲示板
  // ================================================================
  async function listRooms() {
    return req('GET', '/api/rooms');
  }

  async function createRoom(room) {
    return req('POST', '/api/rooms', room);
  }

  async function deleteRoom(id) {
    return req('DELETE', `/api/rooms/${id}`, undefined, true);
  }

  // ================================================================
  // メッセージ
  // ================================================================
  async function listMessages(roomId) {
    return req('GET', `/api/messages?roomId=${encodeURIComponent(roomId)}`);
  }

  async function postMessage(msg) {
    return req('POST', '/api/messages', msg);
  }

  async function deleteMessage(id) {
    return req('DELETE', `/api/messages/${id}`);
  }

  async function adminDeleteMessage(id) {
    return req('DELETE', `/api/messages/${id}?admin=1`, undefined, true);
  }

  // ================================================================
  // DM
  // ================================================================
  async function getDMConversations() {
    return req('GET', '/api/dms/conversations');
  }

  async function getDMThread(partnerId) {
    return req('GET', `/api/dms?partnerId=${encodeURIComponent(partnerId)}`);
  }

  async function sendDM(msg) {
    return req('POST', '/api/dms', msg);
  }

  async function markDMRead(partnerId) {
    return req('PUT', '/api/dms/read', { partnerId });
  }

  async function deleteDM(id) {
    return req('DELETE', `/api/dms/${id}`);
  }

  async function adminListDMs() {
    return req('GET', '/api/admin/dms');
  }

  // ================================================================
  // ランダムチャット
  // ================================================================
  async function getRandomStatus() {
    return req('GET', '/api/random/status');
  }

  async function toggleRandom() {
    return req('POST', '/api/random/toggle');
  }

  async function startRandom() {
    return req('POST', '/api/random/start');
  }

  // ================================================================
  // 管理者アクション (パスワード再認証付き)
  // ================================================================

  /**
   * 管理者認証モーダルを表示してコールバックを実行
   * @param {string} message - 確認メッセージ
   * @param {Function} callback - 認証後に実行する async 関数
   */
  function adminAction(message, callback) {
    if (isAdminTokenValid()) {
      if (!confirm(message)) return;
      callback();
      return;
    }

    let modal = document.getElementById('admin-auth-modal-global');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'admin-auth-modal-global';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
      modal.innerHTML = `
        <div style="background:var(--bg-card,#151c2c);border:1px solid rgba(239,83,80,0.4);border-radius:16px;padding:28px;width:340px;max-width:92vw;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef5350" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span style="font-size:1rem;font-weight:700;color:#ef5350;">管理者認証</span>
          </div>
          <p id="adm-auth-msg" style="font-size:.8rem;color:var(--text-muted,#9aa5c4);margin-bottom:16px;line-height:1.6;white-space:pre-wrap;"></p>
          <input type="password" id="adm-auth-pw" placeholder="管理者パスワード"
            style="width:100%;background:var(--bg-elevated,#1a2340);border:1px solid var(--border,#2a3456);border-radius:8px;padding:10px 14px;color:var(--text-primary,#e8eaf6);font-size:.875rem;margin-bottom:8px;box-sizing:border-box;">
          <div id="adm-auth-err" style="font-size:.75rem;color:#ef5350;min-height:18px;margin-bottom:10px;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="adm-auth-cancel" style="padding:8px 16px;background:var(--bg-elevated,#1a2340);border:1px solid var(--border,#2a3456);border-radius:8px;color:var(--text-secondary,#9aa5c4);cursor:pointer;font-size:.82rem;">キャンセル</button>
            <button id="adm-auth-ok"     style="padding:8px 16px;background:#ef5350;border:none;border-radius:8px;color:#fff;cursor:pointer;font-weight:600;font-size:.82rem;">認証して実行</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }

    document.getElementById('adm-auth-msg').textContent = message;
    document.getElementById('adm-auth-pw').value        = '';
    document.getElementById('adm-auth-err').textContent = '';
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('adm-auth-pw')?.focus(), 50);

    const ok  = document.getElementById('adm-auth-ok');
    const can = document.getElementById('adm-auth-cancel');
    const nok  = ok.cloneNode(true);
    const ncan = can.cloneNode(true);
    ok.replaceWith(nok); can.replaceWith(ncan);

    ncan.addEventListener('click', () => { modal.style.display = 'none'; });
    nok.addEventListener('click', async () => {
      const pw = document.getElementById('adm-auth-pw').value;
      if (!pw) { document.getElementById('adm-auth-err').textContent = 'パスワードを入力してください'; return; }
      nok.disabled = true; nok.textContent = '確認中...';
      const res = await adminVerify(pw);
      if (!res.ok) {
        document.getElementById('adm-auth-err').textContent = res.error || 'パスワードが正しくありません';
        document.getElementById('adm-auth-pw').value = '';
        nok.disabled = false; nok.textContent = '認証して実行';
        return;
      }
      modal.style.display = 'none';
      callback();
    });
    document.getElementById('adm-auth-pw').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('adm-auth-ok').click();
    });
  }

  async function getPublicProfile(accountId) {
    return req('GET', `/api/public-profile/${encodeURIComponent(accountId)}`);
  }

  async function lookupAccount({ userId, email } = {}) {
    if (email) return req('GET', `/api/accounts/lookup?email=${encodeURIComponent(email)}`);
    return req('GET', `/api/accounts/lookup?userId=${encodeURIComponent(userId)}`);
  }

  return {
    login, adminVerify, isAdminTokenValid, adminAction,
    getMyAccount, checkUserId, listAccounts, lookupAccount, updateAccount, deleteAccount, adminDeleteAccount, adminSetup,
    listRooms, createRoom, deleteRoom,
    listMessages, postMessage, deleteMessage, adminDeleteMessage,
    getDMConversations, getDMThread, sendDM, markDMRead, deleteDM, adminListDMs,
    getPublicProfile,
    getRandomStatus, toggleRandom, startRandom,
  };
})();

window.API = API;
