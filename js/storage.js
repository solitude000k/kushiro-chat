/**
 * storage.js - セッション管理 + sha256
 * localStorage/D1 のデータアクセスは js/api.js (API クライアント) が担う
 */

const Storage = (() => {
  // ---- SHA-256 ----
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- セッション (localStorage) ----
  // localStorage を使用することでタブを閉じても・ブラウザを再起動してもログイン状態を維持
  // セッション形式: { sessionToken, id, userId, email, nickname, color, avatarDataUrl,
  //                   birthdate, gender, bio, xUrl, igUrl, fbUrl, verified, ... }
  const Session = {
    get()     { try { return JSON.parse(localStorage.getItem('kushiro_session')); } catch { return null; } },
    set(data) { localStorage.setItem('kushiro_session', JSON.stringify(data)); },
    clear()   { localStorage.removeItem('kushiro_session'); },
    /** APIリクエスト用セッショントークン */
    getToken() { return this.get()?.sessionToken || ''; },
  };

  return { sha256, Session };
})();

window.Storage = Storage;
