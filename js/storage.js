/**
 * storage.js - CSVベースのデータ管理モジュール
 * 釧路コミュニティチャット
 */

const Storage = (() => {
  const KEYS = {
    ACCOUNTS: 'kushiro_accounts',
    USERS:    'kushiro_users',
    ROOMS:    'kushiro_rooms',
    MESSAGES: 'kushiro_messages',
    SESSION:  'kushiro_current_user',
    DMS:      'kushiro_dms',
  };

  // ---- SHA-256 ハッシュ (Web Crypto API) ----
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- CSV パース ----
  function parseCSV(text) {
    if (!text.trim()) return [];
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const values = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] || ''; });
      return obj;
    });
  }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }

  function toCSV(data, headers) {
    if (!data.length) return headers.join(',') + '\n';
    const head = headers || Object.keys(data[0]);
    const rows = data.map(row =>
      head.map(h => {
        const val = String(row[h] || '').replace(/"/g, '""');
        return val.includes(',') || val.includes('\n') || val.includes('"') ? `"${val}"` : val;
      }).join(',')
    );
    return [head.join(','), ...rows].join('\n');
  }

  function loadFromStorage(key) {
    try { const raw = localStorage.getItem(key); if (!raw) return []; return JSON.parse(raw); }
    catch { return []; }
  }

  function saveToStorage(key, data) { localStorage.setItem(key, JSON.stringify(data)); }


  // ============ Accounts ============
  // { id, userId, email, passwordHash, nickname, color, avatarDataUrl, birthdate, gender, bio, xUrl, igUrl, fbUrl, createdAt, updatedAt }
  const Accounts = {
    getAll() { return loadFromStorage(KEYS.ACCOUNTS); },
    save(accounts) { saveToStorage(KEYS.ACCOUNTS, accounts); },
    findByEmail(email) { return this.getAll().find(a => a.email.toLowerCase() === email.toLowerCase()); },
    findById(id) { return this.getAll().find(a => a.id === id); },

    async register({ email, password, nickname, color }) {
      if (this.findByEmail(email)) throw new Error('このGmailアドレスはすでに登録されています');
      const passwordHash = await sha256(password);
      const account = {
        id: 'a_' + Date.now(),
        userId: '',  // 登録フォームから渡される
        email: email.toLowerCase(),
        passwordHash,
        nickname,
        color: color || '#f4a620',
        avatarDataUrl: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const accounts = this.getAll();
      accounts.push(account);
      this.save(accounts);
      return account;
    },

    async login(email, password) {
      const account = this.findByEmail(email);
      if (!account) throw new Error('このGmailアドレスは登録されていません');
      const hash = await sha256(password);
      if (hash !== account.passwordHash) throw new Error('パスワードが正しくありません');
      return account;
    },

    update(id, updates) {
      const accounts = this.getAll().map(a =>
        a.id !== id ? a : { ...a, ...updates, updatedAt: new Date().toISOString() }
      );
      this.save(accounts);
      return this.findById(id);
    },

    deleteAccount(id) {
      this.save(this.getAll().filter(a => a.id !== id));
    },
    // 管理者専用: 強制削除（自分自身・Administratorは削除不可）
    adminDeleteAccount(id) {
      const target = this.findById(id);
      if (!target) return false;
      if (target.userId === 'Administrator') return false; // 管理者自身は削除不可
      this.save(this.getAll().filter(a => a.id !== id));
      return true;
    },
    isAdmin(account) {
      return account && account.userId === 'Administrator';
    },
    toCSV() {
      return toCSV(
        this.getAll().map(a => ({ ...a, avatarDataUrl: a.avatarDataUrl ? '[IMAGE]' : '' })),
        ['id', 'email', 'passwordHash', 'nickname', 'color', 'verified', 'createdAt', 'updatedAt']
      );
    },
  };

  // ============ Users (表示用プロフィールキャッシュ) ============
  const Users = {
    getAll() { return loadFromStorage(KEYS.USERS); },
    save(users) { saveToStorage(KEYS.USERS, users); },
    findByName(name) { return this.getAll().find(u => u.name === name); },
    findById(id) { return this.getAll().find(u => u.id === id); },
    upsert(account) {
      const users = this.getAll();
      const idx = users.findIndex(u => u.id === account.id);
      const rec = {
        id: account.id, name: account.nickname,
        userId: account.userId || '',
        avatar: account.nickname.charAt(0).toUpperCase(),
        avatarDataUrl: account.avatarDataUrl || '',
        color: account.color, createdAt: account.createdAt,
        bio:      account.bio      || '',
        gender:   account.gender   || '',
        birthdate:account.birthdate || '',
        xUrl:  account.xUrl  || '',
        igUrl: account.igUrl || '',
        fbUrl: account.fbUrl || '',
      };
      if (idx >= 0) users[idx] = rec; else users.push(rec);
      this.save(users);
      return rec;
    },
    toCSV() { return toCSV(this.getAll(), ['id', 'name', 'avatar', 'color', 'createdAt']); },
  };

  // ============ Rooms ============
  const Rooms = {
    getAll() {
      let rooms = loadFromStorage(KEYS.ROOMS);
      const DEFAULT_ROOMS = [
        { id: 'r_001', name: 'なんでも雑談',  tags: '雑談,日常',        description: '釧路の日常なんでも話しましょう',   createdBy: 'system', icon: '🌊', createdAt: new Date().toISOString() },
        { id: 'r_002', name: '釧路グルメ情報', tags: 'グルメ,食事,海鮮', description: '美味しいお店や食べ物の情報交換', createdBy: 'system', icon: '🦀', createdAt: new Date().toISOString() },
      ];
      if (!rooms.length) {
        saveToStorage(KEYS.ROOMS, DEFAULT_ROOMS);
        return DEFAULT_ROOMS;
      }
      // r_001が存在しなければ先頭に追加
      if (!rooms.find(r => r.id === 'r_001')) {
        rooms = [DEFAULT_ROOMS[0], ...rooms];
        saveToStorage(KEYS.ROOMS, rooms);
      }
      return rooms;
    },
    save(rooms) { saveToStorage(KEYS.ROOMS, rooms); },
    getById(id) { return this.getAll().find(r => r.id === id); },
    add(room) {
      const rooms = this.getAll();
      room.id = 'r_' + Date.now();
      room.createdAt = new Date().toISOString();
      rooms.push(room);
      this.save(rooms);
      return room;
    },
    getCategories() {
      const tags = new Set();
      this.getAll().forEach(r => {
        (r.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t));
      });
      return [...tags];
    },
    delete(roomId) {
      this.save(this.getAll().filter(r => r.id !== roomId));
    },
    toCSV() { return toCSV(this.getAll(), ['id', 'name', 'tags', 'description', 'createdBy', 'icon', 'createdAt']); },
  };

  // ============ Messages ============
  const Messages = {
    getAll() { return loadFromStorage(KEYS.MESSAGES); },
    save(messages) { saveToStorage(KEYS.MESSAGES, messages); },
    getByRoom(roomId) { return this.getAll().filter(m => m.roomId === roomId); },
    getByUser(userId) { return this.getAll().filter(m => m.userId === userId); },
    add(msg) {
      const messages = this.getAll();
      msg.id = 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      msg.createdAt = new Date().toISOString();
      messages.push(msg);
      this.save(messages);
      return msg;
    },
    delete(id, userId) {
      this.save(this.getAll().filter(m => !(m.id === id && m.userId === userId)));
    },
    adminDelete(id) {
      this.save(this.getAll().filter(m => m.id !== id));
    },
    toCSV() { return toCSV(this.getAll(), ['id', 'roomId', 'userId', 'userName', 'text', 'imageData', 'videoData', 'tags', 'createdAt']); },
  };


  // ============ DirectMessages ============
  // { id, fromId, fromName, toId, toName, text, imageData, createdAt }
  const DirectMessages = {
    getAll() { return loadFromStorage(KEYS.DMS); },
    save(dms) { saveToStorage(KEYS.DMS, dms); },

    // 会話一覧（自分が関わる相手ごとにまとめる）
    getConversations(myId) {
      const all = this.getAll().filter(m => m.fromId === myId || m.toId === myId);
      const partnerMap = {};
      all.forEach(m => {
        const partnerId   = m.fromId === myId ? m.toId   : m.fromId;
        const partnerName = m.fromId === myId ? m.toName : m.fromName;
        if (!partnerMap[partnerId]) {
          partnerMap[partnerId] = { partnerId, partnerName, last: m, unread: 0 };
        } else {
          if (m.createdAt > partnerMap[partnerId].last.createdAt) partnerMap[partnerId].last = m;
        }
        if (m.toId === myId && !m.read) partnerMap[partnerId].unread++;
      });
      return Object.values(partnerMap).sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt));
    },

    // 二者間のメッセージ取得
    getBetween(myId, partnerId) {
      return this.getAll()
        .filter(m => (m.fromId === myId && m.toId === partnerId) || (m.fromId === partnerId && m.toId === myId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    add(msg) {
      const all = this.getAll();
      msg.id = 'dm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      msg.createdAt = new Date().toISOString();
      msg.read = false;
      all.push(msg);
      this.save(all);
      return msg;
    },

    // 既読にする
    markRead(myId, partnerId) {
      const all = this.getAll().map(m =>
        (m.fromId === partnerId && m.toId === myId) ? { ...m, read: true } : m
      );
      this.save(all);
    },

    delete(id, userId) {
      this.save(this.getAll().filter(m => !(m.id === id && m.fromId === userId)));
    },
  };

  // ============ Session ============
  const Session = {
    get() { try { return JSON.parse(sessionStorage.getItem(KEYS.SESSION)); } catch { return null; } },
    set(account) { sessionStorage.setItem(KEYS.SESSION, JSON.stringify(account)); },
    clear() { sessionStorage.removeItem(KEYS.SESSION); },
  };

  // ============ CSV Export ============
  function exportCSV(filename, csvContent) {
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportAll() {
    exportCSV('kushiro_accounts.csv', Accounts.toCSV());
    setTimeout(() => exportCSV('kushiro_rooms.csv',    Rooms.toCSV()),    300);
    setTimeout(() => exportCSV('kushiro_messages.csv', Messages.toCSV()), 600);
  }

  return { Accounts, Users, Rooms, Messages, DirectMessages, Session, exportAll, exportCSV, toCSV, sha256 };
})();

window.Storage = Storage;

// ---- マイグレーション ----
(function migrate() {
  const REMOVE_IDS = ['r_002', 'r_003', 'r_004', 'r_005'];
  const rooms = Storage.Rooms.getAll();
  let changed = false;
  const migrated = rooms
    .filter(r => { if (REMOVE_IDS.includes(r.id)) { changed = true; return false; } return true; })
    .map(r => {
      if (r.id === 'r_001' && r.name === '釧路よもやま話') { changed = true; return { ...r, name: 'なんでも雑談' }; }
      return r;
    });
  if (changed) Storage.Rooms.save(migrated);
})();
