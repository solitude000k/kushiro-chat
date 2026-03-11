/**
 * chat.js - チャット機能メイン
 */

let currentRoom = null;
let currentUser = null;
let pendingMedia = []; // { type, data, name }
let pendingTags = [];
let typingTimer = null;
let pollTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  // セッション確認（未認証・未ログインはログインページへ）
  currentUser = Storage.Session.get();
  if (!currentUser) {
    window.location.href = 'index.html';
    return;
  }
  if (!currentUser.verified) {
    alert('メールアドレスが未確認です。認証メールのリンクをクリックしてから再度ログインしてください。');
    Storage.Session.clear();
    window.location.href = 'index.html';
    return;
  }

  initUI();
  purgeStaleRooms();        // 72時間更新なし掲示板を自動削除
  updateCategoryFilters(); // フィルターボタンを先に生成してイベント登録
  loadRooms();
  setupEventListeners();
  // 初期ルーム: なんでも雑談 (r_001) を自動選択
  const defaultRoom = Storage.Rooms.getAll().find(r => r.id === 'r_001') || Storage.Rooms.getAll()[0];
  if (defaultRoom) selectRoom(defaultRoom.id);

  // ポーリング (擬似リアルタイム)
  pollTimer = setInterval(() => {
    if (currentRoom) refreshMessages();
  }, 3000);
});

// ---- UI初期化 ----
function initUI() {
  // ユーザー情報セット
  const avatar = document.getElementById('header-avatar');
  const uname = document.getElementById('header-username');
  renderAvatar(avatar, currentUser);
  uname.textContent = currentUser.name;
}

// ---- ルーム一覧読み込み ----
// 現在のフィルター状態を保持
let currentFilter = 'all';
// 訪問済みルームIDのセット（バッジ管理）
const visitedRooms = new Set();

function loadRooms(filterCategory = currentFilter) {
  currentFilter = filterCategory;
  const rooms = Storage.Rooms.getAll();
  const list = document.getElementById('room-list');
  list.innerHTML = '';

  const filtered = filterCategory === 'all' ? rooms : rooms.filter(r => (r.tags || '').split(',').map(t=>t.trim()).includes(filterCategory));

  filtered.forEach(room => {
    const item = document.createElement('div');
    item.className = 'room-item' + (currentRoom?.id === room.id ? ' active' : '');
    item.dataset.roomId = room.id;
    const msgCount = Storage.Messages.getByRoom(room.id).length;
    const showBadge = msgCount > 0 && !visitedRooms.has(room.id);
    const isCreator = room.createdBy === currentUser.name && room.createdBy !== 'system';
    item.innerHTML = `
      <span class="room-icon">${room.icon || '💬'}</span>
      <div class="room-info">
        <div class="room-name truncate">${escapeHtml(room.name)}</div>
        <div class="room-creator">作成者: ${escapeHtml(room.createdBy === 'system' ? 'システム' : (room.createdBy || '不明'))}</div>
        <div class="room-category">${room.tags ? room.tags.split(',').map(t=>t.trim()).filter(Boolean).map(t=>`<span class="tag-pill">${escapeHtml(t)}</span>`).join('') : ''}</div>
      </div>
      ${showBadge ? `<span class="room-badge">${msgCount > 99 ? '99+' : msgCount}</span>` : ''}
      ${isCreator ? `<button class="room-delete-btn" data-room-id="${room.id}" title="掲示板を削除">✕</button>` : ''}
    `;
    item.addEventListener('click', () => selectRoom(room.id));
    // 削除ボタン（クリックイベントをバブリングさせない）
    const delBtn = item.querySelector('.room-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        deleteRoom(room.id, room.name);
      });
    }
    list.appendChild(item);
  });

  // フィルターボタンの active 状態だけ更新（ボタン再生成はしない）
  const container = document.getElementById('category-filters');
  container.querySelectorAll('.category-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === filterCategory);
  });
}

function updateCategoryFilters() {
  const cats = Storage.Rooms.getCategories();
  const container = document.getElementById('category-filters');
  container.innerHTML = '<button class="category-btn active" data-cat="all">すべて</button>';
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.dataset.cat = cat;
    btn.textContent = cat;
    container.appendChild(btn);
  });
  // 現在のフィルター状態を反映
  container.querySelectorAll('.category-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === currentFilter);
  });
  // イベントは一度だけここで登録
  container.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      loadRooms(btn.dataset.cat);
    });
  });
}

// ---- ルーム選択 ----
function selectRoom(roomId) {
  const room = Storage.Rooms.getById(roomId);
  if (!room) return;
  currentRoom = room;
  visitedRooms.add(roomId); // 訪問済みとしてマーク（バッジを消す）

  // サイドバーのアクティブ更新
  document.querySelectorAll('.room-item').forEach(el => {
    el.classList.toggle('active', el.dataset.roomId === roomId);
  });

  // チャットヘッダー更新
  document.getElementById('chat-room-icon').textContent = room.icon || '💬';
  document.getElementById('chat-room-name').textContent = room.name;
  document.getElementById('chat-room-desc').textContent = room.description || '';

  const tagsEl = document.getElementById('chat-room-tags');
  tagsEl.innerHTML = '';
  if (room.tags) {
    room.tags.split(',').forEach(tag => {
      const span = document.createElement('span');
      span.className = 'badge badge-amber';
      span.textContent = tag.trim();
      tagsEl.appendChild(span);
    });
  }

  // チャットエリアを表示
  document.getElementById('no-room-state').classList.add('hidden');
  document.getElementById('chat-main').classList.remove('hidden');

  // 入力エリアを有効化
  document.getElementById('message-input').disabled = false;
  document.getElementById('message-input').placeholder = `${room.name} にメッセージを送る…`;

  refreshMessages(true);

  // モバイル: サイドバーを閉じる
  closeMobileSidebar();
}

// ---- メッセージ表示 ----
let lastMessageCount = 0;

function refreshMessages(scrollToBottom = false) {
  if (!currentRoom) return;
  const messages = Storage.Messages.getByRoom(currentRoom.id);

  if (messages.length === lastMessageCount && !scrollToBottom) return;
  lastMessageCount = messages.length;

  const container = document.getElementById('messages-container');
  const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;

  renderMessages(messages, container);

  if (scrollToBottom || wasAtBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function renderMessages(messages, container) {
  container.innerHTML = '';

  if (!messages.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <p>まだメッセージがありません。<br>最初のメッセージを送ってみましょう！</p>
      </div>`;
    return;
  }

  let lastDate = '';
  let lastUserId = '';

  messages.forEach((msg, idx) => {
    const date = new Date(msg.createdAt);
    const dateStr = formatDate(date);
    const isOwn = msg.userId === currentUser.id;
    const isSameUser = msg.userId === lastUserId;

    if (dateStr !== lastDate) {
      const divider = document.createElement('div');
      divider.className = 'messages-date-divider';
      divider.innerHTML = `<span>${dateStr}</span>`;
      container.appendChild(divider);
      lastDate = dateStr;
      lastUserId = '';
    }

    const row = document.createElement('div');
    row.className = `message-row${isOwn ? ' own' : ''}`;
    row.dataset.msgId = msg.id;

    const showMeta = true; // 常に名前・時刻を表示

    // アバター（meta の横に表示するため後で使う）
    const user = isOwn
      ? { name: currentUser.name || currentUser.nickname, color: currentUser.color, avatarDataUrl: currentUser.avatarDataUrl }
      : Storage.Users.findByName(msg.userName) || { name: msg.userName, color: '#f4a620', avatarDataUrl: '' };

    // バブル
    const bubbleWrap = document.createElement('div');
    bubbleWrap.style.display = 'flex';
    bubbleWrap.style.flexDirection = 'column';
    bubbleWrap.style.alignItems = isOwn ? 'flex-end' : 'flex-start';
    bubbleWrap.style.maxWidth = '72%';

    if (showMeta) {
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      // アバターをユーザー名の横に配置（DOM操作で安全に構築）
      const av = document.createElement('div');
      av.className = 'avatar avatar-xs';
      renderAvatar(av, user);
      const authorSpan = document.createElement('span');
      authorSpan.className = 'message-author';
      authorSpan.textContent = msg.userName || currentUser.nickname || '?';
      const timeSpan = document.createElement('span');
      timeSpan.className = 'message-time';
      timeSpan.textContent = formatTime(date);
      if (isOwn) {
        meta.appendChild(timeSpan);
        meta.appendChild(authorSpan);
        meta.appendChild(av);
      } else {
        meta.appendChild(av);
        meta.appendChild(authorSpan);
        meta.appendChild(timeSpan);
      }
      bubbleWrap.appendChild(meta);
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    let content = '';

    // テキスト
    if (msg.text) {
      content += `<div class="message-text">${formatMessageText(msg.text)}</div>`;
    }

    // 画像
    if (msg.imageData) {
      content += `<img class="message-image" src="${msg.imageData}" alt="添付画像" onclick="openLightbox(this.src)" loading="lazy">`;
    }

    // 動画
    if (msg.videoData) {
      content += `<video class="message-video" controls src="${msg.videoData}" preload="none"></video>`;
    }

    // タグ
    if (msg.tags) {
      const tags = msg.tags.split(',').filter(Boolean);
      if (tags.length) {
        content += `<div class="message-tags">${tags.map(t => `<span class="badge badge-cyan">${escapeHtml(t.trim())}</span>`).join('')}</div>`;
      }
    }

    bubble.innerHTML = content;
    bubbleWrap.appendChild(bubble);

    // 削除ボタンをバブルの横に配置（自分のメッセージのみ）
    if (isOwn) {
      const delBtn = document.createElement('button');
      delBtn.className = 'msg-delete-btn';
      delBtn.title = 'メッセージを削除';
      delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
      delBtn.addEventListener('click', () => deleteMessage(msg.id));
      row.appendChild(bubbleWrap);
      row.appendChild(delBtn);
    } else {
      row.appendChild(bubbleWrap);
    }

    container.appendChild(row);
    lastUserId = msg.userId;
  });
}

// ---- メッセージ送信 ----
function sendMessage() {
  if (!currentRoom) return;

  const input = document.getElementById('message-input');
  const text = input.value.trim();

  if (!text && !pendingMedia.length) return;

  const msg = {
    roomId: currentRoom.id,
    userId: currentUser.id,
    userName: currentUser.name,
    text: text,
    tags: pendingTags.join(','),
    createdAt: new Date().toISOString(),
  };

  // メディア添付
  pendingMedia.forEach(m => {
    if (m.type === 'image') msg.imageData = m.data;
    if (m.type === 'video') msg.videoData = m.data;
  });

  Storage.Messages.add(msg);

  // リセット
  input.value = '';
  input.style.height = '';
  pendingMedia = [];
  pendingTags = [];
  renderPreviews();

  refreshMessages(true);
  loadRooms(); // バッジ更新
}

// ---- メッセージ削除 ----
function deleteMessage(id) {
  if (!confirm('このメッセージを削除しますか？')) return;
  Storage.Messages.delete(id, currentUser.id);
  refreshMessages();
  showToast('メッセージを削除しました', 'success');
}

// ---- メディア添付 ----
function handleFileSelect(type) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = type === 'image' ? 'image/*' : 'video/*';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;

    const maxSize = type === 'image' ? 5 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast(`ファイルサイズが大きすぎます（最大${type === 'image' ? '5MB' : '50MB'}）`, 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      pendingMedia.push({ type, data: e.target.result, name: file.name });
      renderPreviews();
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

function renderPreviews() {
  const container = document.getElementById('input-previews');
  container.innerHTML = '';
  pendingMedia.forEach((m, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    if (m.type === 'image') {
      item.innerHTML = `<img src="${m.data}" alt="preview"><button class="preview-remove" onclick="removeMedia(${idx})">×</button>`;
    } else {
      item.innerHTML = `<video src="${m.data}" muted preload="metadata"></video><button class="preview-remove" onclick="removeMedia(${idx})">×</button>`;
    }
    container.appendChild(item);
  });
}

function removeMedia(idx) {
  pendingMedia.splice(idx, 1);
  renderPreviews();
}

// ---- タグ管理 ----
function renderTagChips() {
  // tag-input-area は削除済みのため何もしない
}

function removeTag(idx) {
  pendingTags.splice(idx, 1);
  renderTagChips();
}

function addTag(value) {
  const tag = value.trim().replace(/^#/, '');
  if (tag && !pendingTags.includes(tag) && pendingTags.length < 5) {
    pendingTags.push(tag);
    renderTagChips();
  }
}

// ---- 新規ルーム作成 ----
function openNewRoomModal() {
  document.getElementById('new-room-modal').classList.add('active');
  document.getElementById('new-room-name').focus();
}

function closeNewRoomModal() {
  document.getElementById('new-room-modal').classList.remove('active');
  document.getElementById('new-room-form').reset();
  document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('selected'));
  document.querySelector('.icon-option[data-icon="💬"]')?.classList.add('selected');
}

// ---- タグ入力サニタイズ（特殊文字を除去） ----
function sanitizeTagInput(input) {
  const sanitized = input.value.replace(/[^a-zA-Z0-9\u3000-\u9FFF\uF900-\uFAFF\uff66-\uff9f\u30a1-\u30f6\u3041-\u3096\s,，、]/g, '');
  const normalized = sanitized.replace(/[，、]/g, ',');
  if (input.value !== normalized) input.value = normalized;
}

function submitNewRoom() {
  const name = document.getElementById('new-room-name').value.trim();
  const rawTags = document.getElementById('new-room-tags').value.trim();
  const desc = document.getElementById('new-room-desc').value.trim();
  const icon = document.querySelector('.icon-option.selected')?.dataset.icon || '💬';

  if (!name) { showToast('掲示板名を入力してください', 'error'); return; }
  if (!rawTags) { showToast('タグを1つ以上入力してください', 'error'); return; }

  const tags = rawTags
    .split(',')
    .map(t => t.trim().replace(/[^a-zA-Z0-9\u3000-\u9FFF\uF900-\uFAFF\uff66-\uff9f\u30a1-\u30f6\u3041-\u3096\s]/g, '').trim())
    .filter(Boolean)
    .slice(0, 10)
    .join(',');

  const room = Storage.Rooms.add({ name, tags, description: desc, icon, createdBy: currentUser.name });

  closeNewRoomModal();
  loadRooms();
  showToast(`「${name}」を作成しました！`, 'success');
  selectRoom(room.id);
}


// ---- 掲示板削除 ----
function deleteRoom(roomId, roomName) {
  if (!confirm(`「${roomName}」を削除しますか？\nメッセージも全て削除されます。`)) return;
  // メッセージも削除
  const msgs = Storage.Messages.getAll().filter(m => m.roomId !== roomId);
  Storage.Messages.save(msgs);
  Storage.Rooms.delete(roomId);
  // 削除したルームが選択中なら別ルームへ
  if (currentRoom?.id === roomId) {
    currentRoom = null;
    document.getElementById('chat-main').classList.add('hidden');
    document.getElementById('no-room-state').classList.remove('hidden');
  }
  updateCategoryFilters();
  loadRooms();
  showToast(`「${roomName}」を削除しました`, 'success');
}

// ---- 72時間更新なし掲示板を自動削除 ----
function purgeStaleRooms() {
  const EXPIRE_MS = 72 * 60 * 60 * 1000; // 72時間
  const now = Date.now();
  const rooms = Storage.Rooms.getAll();
  const messages = Storage.Messages.getAll();

  const stale = rooms.filter(r => {
    if (r.createdBy === 'system') return false; // システム掲示板は対象外
    const roomMsgs = messages.filter(m => m.roomId === r.id);
    if (roomMsgs.length === 0) {
      // メッセージなし → 作成から72時間経過で削除
      return (now - new Date(r.createdAt).getTime()) > EXPIRE_MS;
    }
    // 最終メッセージから72時間経過で削除
    const lastAt = Math.max(...roomMsgs.map(m => new Date(m.createdAt).getTime()));
    return (now - lastAt) > EXPIRE_MS;
  });

  if (stale.length === 0) return;
  const staleIds = new Set(stale.map(r => r.id));
  Storage.Rooms.save(rooms.filter(r => !staleIds.has(r.id)));
  Storage.Messages.save(messages.filter(m => !staleIds.has(m.roomId)));
  console.log(`[purge] ${stale.length}件の掲示板を自動削除しました`);
}

// ---- ライトボックス ----
function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  lb.querySelector('img').src = src;
  lb.classList.add('active');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}

// ---- CSV エクスポート ----
function exportData() {
  Storage.exportAll();
  showToast('CSVファイルをダウンロードしました', 'success');
}

// ---- ログアウト ----
function logout() {
  if (confirm('ログアウトしますか？')) {
    clearInterval(pollTimer);
    Storage.Session.clear();
    window.location.href = 'index.html';
  }
}

// ---- Toast 通知 ----
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ---- Lightbox ----
function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  lb.querySelector('img').src = src;
  lb.classList.add('active');
}

// ---- モバイルサイドバー ----
function toggleMobileSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('sidebar-overlay').classList.toggle('active');
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

// ---- イベントリスナー設定 ----
function setupEventListeners() {
  // 送信ボタン
  document.getElementById('send-btn').addEventListener('click', sendMessage);

  // Enterキー送信 (Shift+Enterで改行)
  document.getElementById('message-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // テキストエリア自動リサイズ（画面の40%まで）
  document.getElementById('message-input').addEventListener('input', function () {
    this.style.height = '';
    const maxH = Math.floor(window.innerHeight * 0.40);
    this.style.height = Math.min(this.scrollHeight, maxH) + 'px';
  });

  // 画像添付
  document.getElementById('attach-image-btn').addEventListener('click', () => handleFileSelect('image'));

  // 動画添付
  document.getElementById('attach-video-btn').addEventListener('click', () => handleFileSelect('video'));

  // 新規ルーム
  document.getElementById('new-room-btn').addEventListener('click', openNewRoomModal);
  document.getElementById('new-room-cancel').addEventListener('click', closeNewRoomModal);
  document.getElementById('new-room-submit').addEventListener('click', submitNewRoom);

  // アイコン選択
  document.querySelectorAll('.icon-option').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.icon-option').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
  document.querySelector('.icon-option')?.classList.add('selected');

  // モーダル外クリックで閉じる
  document.getElementById('new-room-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewRoomModal();
  });

  // ライトボックス
  document.getElementById('lightbox').addEventListener('click', closeLightbox);

  // ユーザーメニュー
  document.getElementById('logout-btn').addEventListener('click', logout);

  // モバイル
  document.getElementById('sidebar-toggle')?.addEventListener('click', toggleMobileSidebar);
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);
}

// ---- アバター描画 ----
function renderAvatar(el, user) {
  const color = user?.color || '#f4a620';
  el.style.borderColor = color;
  const imgUrl = user?.avatarDataUrl || '';
  if (imgUrl) {
    el.style.backgroundImage = `url(${imgUrl})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.background = `url(${imgUrl}) center/cover`;
    el.style.color = 'transparent';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.style.background = color + '22';
    el.style.color = color;
    el.textContent = (user?.name || user?.nickname || '?').charAt(0).toUpperCase();
  }
}

// ---- ユーティリティ ----
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

function formatMessageText(text) {
  return escapeHtml(text)
    .replace(/\n/g, '<br>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--cyan)">$1</a>');
}

function formatDate(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d >= today) return '今日';
  if (d >= yesterday) return '昨日';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
