/**
 * chat.js - チャット機能メイン (D1バックエンド版)
 */

let currentRoom = null;
let currentUser = null;
let isAdmin     = false;
let pendingMedia = [];
let pollTimer    = null;
let currentFilter = 'all';
const visitedRooms = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = Storage.Session.get();
  if (!currentUser) { window.location.href = 'index.html'; return; }
  if (!currentUser.verified) {
    alert('メールアドレスが未確認です。認証メールのリンクをクリックしてから再度ログインしてください。');
    Storage.Session.clear();
    window.location.href = 'index.html';
    return;
  }

  isAdmin = currentUser.userId === 'Administrator';
  initUI();
  setupEventListeners();

  await updateCategoryFilters();
  await loadRooms();

  const rooms = (await API.listRooms()).rooms || [];
  const defaultRoom = rooms.find(r => r.id === 'r_001') || rooms[0];
  if (defaultRoom) await selectRoom(defaultRoom.id);

  pollTimer = setInterval(async () => {
    if (currentRoom) await refreshMessages();
    await updateDMBadge();
  }, 3000);
  await updateDMBadge();
});

// ---- UI初期化 ----
function initUI() {
  const avatar = document.getElementById('header-avatar');
  const uname  = document.getElementById('header-username');
  renderAvatar(avatar, currentUser);
  uname.textContent = currentUser.nickname || currentUser.name || '';
}

// ---- DM未読バッジ ----
async function updateDMBadge() {
  if (!currentUser) return;
  const res = await API.getDMConversations().catch(() => ({ ok: false }));
  const unread = res.ok
    ? (res.conversations || []).reduce((sum, c) => sum + (c.unread || 0), 0)
    : 0;

  const headerBadge = document.getElementById('dm-header-badge');
  const menuBadge   = document.getElementById('dm-menu-badge');
  if (headerBadge) headerBadge.style.display = unread > 0 ? 'block' : 'none';
  if (menuBadge) {
    if (unread > 0) { menuBadge.style.display = 'inline-flex'; menuBadge.textContent = unread > 99 ? '99+' : unread; }
    else menuBadge.style.display = 'none';
  }
}

// ---- ルーム一覧 ----
async function loadRooms(filterCategory) {
  if (filterCategory !== undefined) currentFilter = filterCategory;

  const res   = await API.listRooms();
  const rooms = res.rooms || [];
  const list  = document.getElementById('room-list');
  list.innerHTML = '';

  const filtered = currentFilter === 'all'
    ? rooms
    : rooms.filter(r => (r.tags || '').split(',').map(t => t.trim()).includes(currentFilter));

  filtered.forEach(room => {
    const item     = document.createElement('div');
    item.className = 'room-item' + (currentRoom?.id === room.id ? ' active' : '');
    item.dataset.roomId = room.id;
    const cnt       = room.messageCount || 0;
    const showBadge = cnt > 0 && !visitedRooms.has(room.id);
    const isCreator = (room.createdBy === currentUser.id || isAdmin) && room.createdBy !== 'system';
    item.innerHTML = `
      <span class="room-icon">${room.icon || '💬'}</span>
      <div class="room-info">
        <div class="room-name truncate">${escapeHtml(room.name)}</div>
        <div class="room-category">${room.tags ? room.tags.split(',').map(t=>t.trim()).filter(Boolean).map(t=>`<span class="tag-pill">${escapeHtml(t)}</span>`).join('') : ''}</div>
      </div>
      ${showBadge ? `<span class="room-badge">${cnt > 99 ? '99+' : cnt}</span>` : ''}
      ${isCreator ? `<button class="room-delete-btn" data-room-id="${room.id}" title="掲示板を削除">✕</button>` : ''}
    `;
    item.addEventListener('click', () => selectRoom(room.id));
    const delBtn = item.querySelector('.room-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        deleteRoom(room.id, room.name);
      });
    }
    list.appendChild(item);
  });

  const container = document.getElementById('category-filters');
  container.querySelectorAll('.category-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === currentFilter);
  });
}

async function updateCategoryFilters() {
  const res   = await API.listRooms();
  const rooms = res.rooms || [];
  const tags  = new Set();
  rooms.forEach(r => (r.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t)));

  const container = document.getElementById('category-filters');
  container.innerHTML = '<button class="category-btn active" data-cat="all">すべて</button>';
  tags.forEach(cat => {
    const btn = document.createElement('button');
    btn.className   = 'category-btn';
    btn.dataset.cat = cat;
    btn.textContent = cat;
    container.appendChild(btn);
  });
  container.querySelectorAll('.category-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === currentFilter);
    b.addEventListener('click', () => loadRooms(b.dataset.cat));
  });
}

// ---- ルーム選択 ----
async function selectRoom(roomId) {
  visitedRooms.add(roomId);
  const rooms = (await API.listRooms()).rooms || [];
  const room  = rooms.find(r => r.id === roomId);
  if (!room) return;
  currentRoom = room;

  document.querySelectorAll('.room-item').forEach(el => {
    el.classList.toggle('active', el.dataset.roomId === roomId);
  });

  document.getElementById('chat-room-icon').textContent  = room.icon || '💬';
  document.getElementById('chat-room-name').textContent  = room.name;
  document.getElementById('chat-room-desc').textContent  = room.description || '';
  document.getElementById('chat-main').classList.remove('hidden');
  document.getElementById('no-room-state').classList.add('hidden');
  document.getElementById('message-input').focus();

  await refreshMessages();
}

// ---- メッセージ表示 ----
async function refreshMessages() {
  if (!currentRoom) return;
  const res      = await API.listMessages(currentRoom.id);
  const messages = res.messages || [];
  const container = document.getElementById('messages-container');
  const scrollEl  = document.getElementById('messages-container');
  const atBottom  = scrollEl.scrollHeight - scrollEl.scrollTop <= scrollEl.clientHeight + 80;

  container.innerHTML = '';
  if (!messages.length) {
    container.innerHTML = `<div class="no-messages"><div class="no-messages-icon">${currentRoom.icon || '💬'}</div><p>まだメッセージはありません<br><span>最初のメッセージを送ってみましょう</span></p></div>`;
  }

  let lastUserId = null;
  messages.forEach(msg => {
    const isOwn = msg.userId === currentUser.id;
    const row   = document.createElement('div');

    const date    = new Date(msg.createdAt);
    const timeStr = String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0');

    row.className = `message-row${isOwn ? ' own' : ''}`;
    row.dataset.msgId = msg.id;

    // アバター(直前と同じユーザーなら省略)
    const showAvatar = msg.userId !== lastUserId;
    let avHtml = '';
    if (!isOwn && showAvatar) {
      const color = msg.userColor || '#f4a620';
      avHtml = msg.userAvatar
        ? `<div class="avatar avatar-sm" style="border-color:${color};overflow:hidden;background:transparent;cursor:pointer;" onclick="showUserProfile('${escapeHtml(msg.userId)}')"><img src="${msg.userAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`
        : `<div class="avatar avatar-sm" style="background:${color}22;border-color:${color};color:${color};cursor:pointer;" onclick="showUserProfile('${escapeHtml(msg.userId)}')">${(msg.userName||'?').charAt(0).toUpperCase()}</div>`;
    } else if (!isOwn) {
      avHtml = '<div class="avatar avatar-sm" style="visibility:hidden;"></div>';
    }

    const bubbleWrap = document.createElement('div');
    bubbleWrap.className = 'bubble-wrap';
    bubbleWrap.style.alignItems = isOwn ? 'flex-end' : 'flex-start';

    if (!isOwn && showAvatar) {
      const nameEl = document.createElement('div');
      nameEl.className = 'message-username';
      nameEl.textContent = msg.userName || '';
      nameEl.style.cursor = 'pointer';
      nameEl.addEventListener('click', () => showUserProfile(msg.userId));
      bubbleWrap.appendChild(nameEl);
    }

    const bubble = document.createElement('div');
    bubble.className = `message-bubble${isOwn ? ' own' : ''}`;

    if (msg.text) {
      const textEl = document.createElement('div');
      textEl.className = 'message-text';
      textEl.innerHTML = escapeHtml(msg.text).replace(/\n/g, '<br>');
      bubble.appendChild(textEl);
    }
    if (msg.imageData) {
      const img = document.createElement('img');
      img.src = msg.imageData;
      img.className = 'message-image';
      img.addEventListener('click', () => img.requestFullscreen?.());
      bubble.appendChild(img);
    }

    const timeEl = document.createElement('div');
    timeEl.className = `message-time${isOwn ? ' own' : ''}`;
    timeEl.textContent = timeStr;
    bubbleWrap.appendChild(bubble);
    bubbleWrap.appendChild(timeEl);

    if (isOwn || isAdmin) {
      const delBtn = document.createElement('button');
      delBtn.className = 'msg-delete-btn' + (isAdmin && !isOwn ? ' admin-delete-btn' : '');
      delBtn.title     = isAdmin && !isOwn ? '[管理者] 削除' : 'メッセージを削除';
      delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
      delBtn.addEventListener('click', () => {
        if (isAdmin && !isOwn) {
          API.adminAction(`このメッセージを削除しますか？（管理者操作）`, async () => {
            const r = await API.adminDeleteMessage(msg.id);
            if (r.ok) { await refreshMessages(); showToast('メッセージを削除しました（管理者）', 'success'); }
            else showToast(r.error || '削除に失敗しました', 'error');
          });
        } else {
          deleteMessage(msg.id);
        }
      });
      row.appendChild(bubbleWrap);
      row.appendChild(delBtn);
    } else {
      row.appendChild(bubbleWrap);
    }

    if (!isOwn) row.insertBefore(document.createRange().createContextualFragment(avHtml || '<div class="avatar avatar-sm" style="visibility:hidden;"></div>'), row.firstChild);

    container.appendChild(row);
    lastUserId = msg.userId;
  });

  if (atBottom) scrollEl.scrollTop = scrollEl.scrollHeight;
}

// ---- メッセージ送信 ----
async function sendMessage() {
  if (!currentRoom) return;
  const input = document.getElementById('message-input');
  const text  = input.value.trim();
  if (!text && !pendingMedia.length) return;

  const msg = {
    roomId:   currentRoom.id,
    userId:   currentUser.id,
    userName: currentUser.nickname || currentUser.name || '',
    text:     text,
    imageData: pendingMedia.find(m => m.type === 'image')?.data || '',
  };

  input.value = '';
  input.style.height = '';
  pendingMedia = [];
  renderMediaPreview();

  const res = await API.postMessage(msg);
  if (!res.ok) { showToast(res.error || '送信に失敗しました', 'error'); return; }
  await refreshMessages();
  await updateCategoryFilters();
}

// ---- メッセージ削除 ----
async function deleteMessage(id) {
  if (!confirm('このメッセージを削除しますか？')) return;
  const res = await API.deleteMessage(id);
  if (res.ok) { await refreshMessages(); showToast('メッセージを削除しました', 'success'); }
  else showToast(res.error || '削除に失敗しました', 'error');
}

// ---- メディア添付 ----
function handleFileSelect(type) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = type === 'image' ? 'image/*' : 'image/*'; // 動画はURLリンクに変更
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    // D1の行サイズ上限のため 1MB に制限
    if (file.size > 1 * 1024 * 1024) {
      showToast('ファイルサイズが大きすぎます（最大1MB）', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      pendingMedia = [{ type: 'image', data: e.target.result, name: file.name }];
      renderMediaPreview();
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

function renderMediaPreview() {
  const preview = document.getElementById('input-previews');
  if (!preview) return;
  preview.innerHTML = '';
  if (!pendingMedia.length) { preview.style.display = 'none'; return; }
  preview.style.display = 'flex';
  pendingMedia.forEach((m, i) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:inline-block;';
    if (m.type === 'image') {
      const img = document.createElement('img');
      img.src = m.data;
      img.style.cssText = 'max-height:80px;border-radius:8px;border:1px solid var(--border);';
      wrap.appendChild(img);
    }
    const rm = document.createElement('button');
    rm.innerHTML = '✕';
    rm.style.cssText = 'position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--bg-card);border:1px solid var(--border);cursor:pointer;font-size:10px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;';
    rm.addEventListener('click', () => { pendingMedia.splice(i, 1); renderMediaPreview(); });
    wrap.appendChild(rm);
    preview.appendChild(wrap);
  });
}

// ---- 掲示板作成モーダル ----
function openNewRoomModal() {
  document.getElementById('new-room-modal')?.classList.add('active');
  // アイコン選択リセット（最初のボタンを選択状態に）
  document.querySelectorAll('.icon-option').forEach((btn, i) => {
    btn.classList.toggle('selected', i === 0);
  });
  // タグカウントリセット
  const countEl = document.getElementById('tag-count');
  if (countEl) { countEl.textContent = '0'; countEl.style.color = 'var(--text-muted)'; }
}
function closeNewRoomModal() {
  document.getElementById('new-room-modal')?.classList.remove('active');
}

// ---- 掲示板作成 ----
async function createRoom() {
  const rawName = document.getElementById('new-room-name')?.value.trim();
  const rawTags = document.getElementById('new-room-tags')?.value.trim();
  const rawDesc = document.getElementById('new-room-desc')?.value.trim();
  const selectedIconBtn = document.querySelector('.icon-option.selected');
  const icon = selectedIconBtn?.dataset.icon || '💬';

  // クライアント側バリデーション
  const forbidden = /[<>&"'`\\{}()\[\]=;]/;
  if (!rawName) { showToast('掲示板名を入力してください', 'error'); return; }
  if (forbidden.test(rawName)) { showToast('掲示板名に使用できない文字が含まれています', 'error'); return; }
  if (rawTags && forbidden.test(rawTags)) { showToast('タグに使用できない文字が含まれています', 'error'); return; }
  if (rawDesc && forbidden.test(rawDesc)) { showToast('説明に使用できない文字が含まれています', 'error'); return; }
  // タグ最大3つチェック
  const tagParts = rawTags ? rawTags.split(',').filter(t => t.trim()) : [];
  if (tagParts.length > 3) { showToast('タグは最大3つまでです', 'error'); return; }

  const name = rawName;
  const tags = tagParts.join(',');
  const desc = rawDesc;
  if (!name) { showToast('掲示板名を入力してください', 'error'); return; }

  const res = await API.createRoom({ name, tags, description: desc, icon });
  if (!res.ok) { showToast(res.error || '作成に失敗しました', 'error'); return; }

  closeNewRoomModal();
  ['new-room-name','new-room-tags','new-room-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  await updateCategoryFilters();
  await loadRooms();
  showToast(`「${res.room.name}」を作成しました`, 'success');
  await selectRoom(res.room.id);
}

// ---- 掲示板削除 ----
async function deleteRoom(roomId, roomName) {
  const room = (await API.listRooms()).rooms?.find(r => r.id === roomId);
  if (room && room.createdBy !== currentUser.id && isAdmin) {
    API.adminAction(`「${roomName}」を削除しますか？\nメッセージも全て削除されます。（管理者操作）`, async () => {
      const r = await API.deleteRoom(roomId);
      if (r.ok) { await _afterRoomDelete(roomId, roomName); }
      else showToast(r.error || '削除に失敗しました', 'error');
    });
  } else {
    if (!confirm(`「${roomName}」を削除しますか？\nメッセージも全て削除されます。`)) return;
    const r = await API.deleteRoom(roomId);
    if (r.ok) await _afterRoomDelete(roomId, roomName);
    else showToast(r.error || '削除に失敗しました', 'error');
  }
}

async function _afterRoomDelete(roomId, roomName) {
  if (currentRoom?.id === roomId) {
    currentRoom = null;
    document.getElementById('chat-main').classList.add('hidden');
    document.getElementById('no-room-state').classList.remove('hidden');
  }
  await updateCategoryFilters();
  await loadRooms();
  showToast(`「${roomName}」を削除しました`, 'success');
}

// ---- イベント設定 ----
function setupEventListeners() {
  // 送信
  document.getElementById('send-btn')?.addEventListener('click', sendMessage);
  const input = document.getElementById('message-input');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
  }

  // メディア
  document.getElementById('attach-image-btn')?.addEventListener('click', () => handleFileSelect('image'));

  // ヘッダー ドロップダウン
  const trigger  = document.getElementById('user-menu-trigger');
  const dropdown = document.getElementById('user-dropdown');
  trigger?.addEventListener('click', e => {
    e.stopPropagation();
    dropdown?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => dropdown?.classList.add('hidden'));

  // ログアウト
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    Storage.Session.clear();
    window.location.href = 'index.html';
  });

  // 掲示板作成モーダル
  document.getElementById('new-room-btn')?.addEventListener('click', openNewRoomModal);
  document.getElementById('new-room-cancel')?.addEventListener('click', closeNewRoomModal);
  document.getElementById('new-room-submit')?.addEventListener('click', createRoom);
  // アイコン選択
  document.querySelectorAll('.icon-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.icon-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

// ---- プロフィールモーダル ----
async function showUserProfile(userId) {
  // D1からアカウント情報を取得 (adminなら listAccounts、一般はメッセージから)
  // フォールバック: メッセージ内のユーザー情報を使用
  let profile = null;
  if (isAdmin) {
    const res = await API.listAccounts().catch(() => ({}));
    profile = (res.accounts || []).find(a => a.id === userId || a.userId === userId);
  }
  // フォールバック: 表示中メッセージから探す
  if (!profile) {
    const msgs = document.querySelectorAll(`.message-row[data-msg-id]`);
    // 現在のメッセージから uid が一致するものを探してアバター情報を収集
    const res = await API.listMessages(currentRoom?.id || '');
    const msg = (res.messages || []).find(m => m.userId === userId);
    if (msg) {
      profile = {
        id:           msg.userId,
        userId:       msg.userId,
        nickname:     msg.userName,
        color:        msg.userColor || '#f4a620',
        avatarDataUrl:msg.userAvatar || '',
      };
    }
  }
  if (!profile) { showToast('プロフィールを取得できませんでした', 'error'); return; }

  _renderProfileModal(profile);
}

function _renderProfileModal(profile) {
  const nickname = profile.nickname || '';
  const uid      = profile.userId   || '';
  const color    = profile.color    || '#f4a620';
  const avatarDataUrl = profile.avatarDataUrl || '';
  const bio      = profile.bio      || '';
  const gender   = profile.gender   || '';
  const birthdate= profile.birthdate|| '';

  const genderLabel = gender === 'male' ? '男性' : gender === 'female' ? '女性' : gender === 'other' ? 'その他' : '';
  let ageRange = '';
  if (birthdate) {
    const age = Math.floor((Date.now() - new Date(birthdate)) / (365.25 * 86400000));
    ageRange = age < 20 ? '10代' : age < 30 ? '20代' : age < 40 ? '30代' : age < 50 ? '40代' : age < 60 ? '50代' : '60代以上';
  }

  let avHtml;
  if (avatarDataUrl) {
    avHtml = `<div style="width:72px;height:72px;border-radius:50%;overflow:hidden;border:3px solid ${color};flex-shrink:0;"><img src="${avatarDataUrl}" style="width:100%;height:100%;object-fit:cover;"></div>`;
  } else {
    const init = nickname.charAt(0).toUpperCase();
    avHtml = `<div style="width:72px;height:72px;border-radius:50%;border:3px solid ${color};background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:700;flex-shrink:0;">${init}</div>`;
  }

  function snsBtn(url, title, svgInner) {
    if (url) return `<a href="${url}" target="_blank" rel="noopener" class="profile-sns-btn" title="${title}">${svgInner}</a>`;
    return `<span class="profile-sns-btn profile-sns-disabled" title="${title}（未登録）">${svgInner}</span>`;
  }
  const xSvg  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
  const igSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`;
  const fbSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`;
  const sns = [snsBtn(profile.xUrl||'', 'X (Twitter)', xSvg), snsBtn(profile.igUrl||'', 'Instagram', igSvg), snsBtn(profile.fbUrl||'', 'Facebook', fbSvg)];

  let modal = document.getElementById('user-profile-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'user-profile-modal';
    modal.className = 'user-profile-modal-overlay';
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    document.body.appendChild(modal);
  }

  const isOwnProfile = profile.id === currentUser.id;
  const adminDeleteBtn = isAdmin && !isOwnProfile
    ? `<button onclick="adminDeleteFromProfile('${escapeHtml(profile.id)}','${escapeHtml(nickname)}')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:0.72rem;background:rgba(239,83,80,0.12);color:#ef5350;border:1px solid rgba(239,83,80,0.3);border-radius:20px;cursor:pointer;white-space:nowrap;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        削除
      </button>`
    : '';

  modal.innerHTML = `
    <div class="user-profile-modal-card">
      <button class="user-profile-close" onclick="document.getElementById('user-profile-modal').classList.remove('active')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        ${avHtml}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">${escapeHtml(nickname)}</div>
            ${!isOwnProfile ? `<button onclick="startDM('${escapeHtml(profile.id)}','${escapeHtml(nickname)}')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:0.72rem;background:rgba(77,208,225,0.12);color:var(--cyan);border:1px solid rgba(77,208,225,0.25);border-radius:20px;cursor:pointer;white-space:nowrap;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              DM
            </button>` : ''}
            ${adminDeleteBtn}
          </div>
          ${uid ? `<div style="font-size:0.72rem;color:var(--text-muted);font-family:monospace;margin-top:2px;">@${escapeHtml(uid)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;font-size:0.78rem;color:var(--text-muted);">
        <div>性別：<span style="color:${genderLabel ? 'var(--text-secondary)' : 'var(--text-muted)'};font-style:${genderLabel ? 'normal' : 'italic'}">${genderLabel || '登録されていません'}</span></div>
        <div>年齢：<span style="color:${ageRange ? 'var(--text-secondary)' : 'var(--text-muted)'};font-style:${ageRange ? 'normal' : 'italic'}">${ageRange || '登録されていません'}</span></div>
      </div>
      <div style="font-size:0.82rem;color:${bio ? 'var(--text-secondary)' : 'var(--text-muted)'};line-height:1.6;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:8px;margin-bottom:12px;font-style:${bio ? 'normal' : 'italic'}">${bio ? escapeHtml(bio) : '自己紹介が登録されていません'}</div>
      <div style="display:flex;gap:10px;margin-top:4px;">${sns.join('')}</div>
    </div>`;
  modal.classList.add('active');
}

function startDM(targetId, targetName) {
  document.getElementById('user-profile-modal')?.classList.remove('active');
  window.location.href = `dm.html?to=${encodeURIComponent(targetId)}&name=${encodeURIComponent(targetName)}`;
}

async function adminDeleteFromProfile(targetId, targetName) {
  API.adminAction(`「${targetName}」のアカウントを強制削除しますか？\nそのユーザーのメッセージも全て削除されます。`, async () => {
    const res = await API.adminDeleteAccount(targetId);
    if (!res.ok) { showToast(res.error || '削除に失敗しました', 'error'); return; }
    document.getElementById('user-profile-modal')?.classList.remove('active');
    showToast(`「${targetName}」を削除しました（管理者）`, 'success');
    await loadRooms();
    await refreshMessages();
  });
}

// ---- アバター描画 ----
function renderAvatar(el, user) {
  if (!el || !user) return;
  const color = user.color || '#f4a620';
  if (user.avatarDataUrl) {
    el.innerHTML = `<img src="${user.avatarDataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    el.style.background  = 'transparent';
    el.style.overflow    = 'hidden';
  } else {
    el.textContent       = (user.nickname || user.name || '?').charAt(0).toUpperCase();
    el.style.background  = color + '22';
    el.style.color       = color;
  }
  el.style.borderColor = color;
}

// ---- ユーティリティ ----
// ---- 入力サニタイズ ----
// 特殊文字（<>&"'`など）を除去（タグ名・説明用）
function sanitizeTextInput(el) {
  el.value = el.value.replace(/[<>&"'`\\{}()\[\]=;]/g, '');
}
// タグ入力: 特殊文字除去 + コンマ最大2個（タグ最大3つ）
function sanitizeTagInput(el) {
  // 特殊文字を除去（カンマは許可）
  el.value = el.value.replace(/[<>&"'`\\{}()\[\]=;]/g, '');
  // コンマを最大2個に制限
  const parts = el.value.split(',');
  if (parts.length > 3) {
    el.value = parts.slice(0, 3).join(',');
  }
  // カウント更新
  const countEl = document.getElementById('tag-count');
  if (countEl) {
    const filled = parts.filter(p => p.trim().length > 0).length;
    countEl.textContent = Math.min(filled, 3);
    countEl.style.color = filled >= 3 ? '#ef5350' : 'var(--text-muted)';
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c])
  );
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toast-container')?.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}
