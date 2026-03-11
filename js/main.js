/**
 * main.js - ログイン・エントリーページ処理
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = Storage.Session.get();
  if (session) {
    window.location.href = 'chat.html';
    return;
  }

  // アバターカラー選択
  const colors = [
    '#f4a620', '#4dd0e1', '#ef5350', '#66bb6a',
    '#ab47bc', '#42a5f5', '#ff7043', '#26c6da',
  ];
  let selectedColor = colors[0];

  const colorPicker = document.getElementById('color-picker');
  colors.forEach(c => {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch';
    swatch.style.background = c;
    swatch.dataset.color = c;
    if (c === selectedColor) swatch.classList.add('selected');
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = c;
      updatePreview();
    });
    colorPicker.appendChild(swatch);
  });

  // アバタープレビュー更新
  const nameInput = document.getElementById('username-input');
  const previewAvatar = document.getElementById('preview-avatar');
  const previewName = document.getElementById('preview-name');

  function updatePreview() {
    const name = nameInput.value.trim();
    const initials = name ? name.charAt(0).toUpperCase() : '?';
    previewAvatar.textContent = initials;
    previewAvatar.style.background = selectedColor + '22';
    previewAvatar.style.borderColor = selectedColor;
    previewAvatar.style.color = selectedColor;
    previewName.textContent = name || 'ニックネームを入力';
  }

  nameInput.addEventListener('input', updatePreview);
  updatePreview();

  // 参加ボタン
  const joinBtn = document.getElementById('join-btn');
  const form = document.getElementById('login-form');

  function tryJoin() {
    const name = nameInput.value.trim();
    if (!name) {
      showError('ニックネームを入力してください');
      nameInput.focus();
      return;
    }
    if (name.length > 20) {
      showError('ニックネームは20文字以内で入力してください');
      return;
    }

    // ユーザー登録または既存ユーザー取得
    let user = Storage.Users.findByName(name);
    if (!user) {
      user = Storage.Users.add({ name, color: selectedColor, avatar: name.charAt(0).toUpperCase() });
    }
    Storage.Session.set(user);

    joinBtn.disabled = true;
    joinBtn.innerHTML = '<span class="spinner"></span> 参加中...';
    setTimeout(() => {
      window.location.href = 'chat.html';
    }, 600);
  }

  joinBtn.addEventListener('click', tryJoin);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') tryJoin();
  });

  function showError(msg) {
    const err = document.getElementById('error-msg');
    err.textContent = msg;
    err.classList.remove('hidden');
    nameInput.style.borderColor = '#ef5350';
    setTimeout(() => {
      err.classList.add('hidden');
      nameInput.style.borderColor = '';
    }, 3000);
  }

  // 背景アニメーション
  createStarField();
});

function createStarField() {
  const canvas = document.getElementById('star-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const stars = Array.from({ length: 150 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height * 0.6,
    r: Math.random() * 1.5 + 0.3,
    alpha: Math.random() * 0.7 + 0.3,
    speed: Math.random() * 0.003 + 0.001,
    phase: Math.random() * Math.PI * 2,
  }));

  const lights = Array.from({ length: 12 }, () => ({
    x: Math.random() * canvas.width,
    y: canvas.height * (0.6 + Math.random() * 0.1),
    r: Math.random() * 3 + 1,
    color: Math.random() > 0.5 ? '#f4a620' : '#ffd54f',
    pulse: Math.random() * 0.02 + 0.005,
    phase: Math.random() * Math.PI * 2,
  }));

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    t += 0.01;

    // Stars
    stars.forEach(s => {
      const alpha = s.alpha * (0.7 + 0.3 * Math.sin(t * s.speed * 10 + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(232, 234, 246, ${alpha})`;
      ctx.fill();
    });

    // Harbor lights
    lights.forEach(l => {
      const glow = 1 + 0.3 * Math.sin(t * l.pulse * 10 + l.phase);
      const grad = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 10 * glow);
      grad.addColorStop(0, l.color + 'cc');
      grad.addColorStop(1, l.color + '00');
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.r * 10 * glow, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Reflection on water
      const refGrad = ctx.createRadialGradient(l.x, l.y + 30, 0, l.x, l.y + 30, 6);
      refGrad.addColorStop(0, l.color + '55');
      refGrad.addColorStop(1, l.color + '00');
      ctx.beginPath();
      ctx.ellipse(l.x, l.y + 60, 4, 25, 0, 0, Math.PI * 2);
      ctx.fillStyle = refGrad;
      ctx.fill();
    });

    // Water horizon line
    ctx.beginPath();
    ctx.moveTo(0, canvas.height * 0.65);
    ctx.lineTo(canvas.width, canvas.height * 0.65);
    ctx.strokeStyle = 'rgba(77, 208, 225, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    requestAnimationFrame(draw);
  }
  draw();

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
}
