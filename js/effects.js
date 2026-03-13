/**
 * effects.js - サイト全体の動的エフェクト
 * - 浮遊パーティクル背景
 * - スクロールリビール (IntersectionObserver)
 * - 送信ボタン波紋
 */

(function () {
  'use strict';

  /* ============================================================
     1. 浮遊パーティクル背景キャンバス
  ============================================================ */
  function initParticles() {
    const canvas = document.createElement('canvas');
    canvas.id = 'fx-canvas';
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');

    let W, H, particles = [];

    const COLORS = [
      'rgba(77,208,225,',   // cyan
      'rgba(244,166,32,',   // amber
      'rgba(100,150,255,',  // blue
    ];

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function createParticle() {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      return {
        x:     Math.random() * W,
        y:     Math.random() * H,
        r:     Math.random() * 1.4 + 0.3,
        alpha: Math.random() * 0.4 + 0.05,
        vx:    (Math.random() - 0.5) * 0.18,
        vy:    -(Math.random() * 0.25 + 0.05),
        color,
        life:  Math.random() * 300 + 200,
        maxLife: 0,
      };
    }

    function init() {
      resize();
      particles = [];
      const count = Math.min(80, Math.floor(W * H / 14000));
      for (let i = 0; i < count; i++) {
        const p = createParticle();
        p.y = Math.random() * H; // 最初は全体に散らす
        p.maxLife = p.life;
        particles.push(p);
      }
    }

    let raf;
    function draw() {
      ctx.clearRect(0, 0, W, H);

      particles.forEach((p, i) => {
        p.x  += p.vx;
        p.y  += p.vy;
        p.life--;

        // フェードイン・フェードアウト
        const progress = p.life / p.maxLife;
        const fade = progress < 0.15
          ? progress / 0.15
          : progress > 0.85
          ? (1 - progress) / 0.15
          : 1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color + (p.alpha * fade) + ')';
        ctx.fill();

        // 寿命が尽きたら再生成
        if (p.life <= 0 || p.y < -10) {
          particles[i] = createParticle();
          particles[i].y = H + 5;
          particles[i].maxLife = particles[i].life;
        }
      });

      // 近い粒子同士を線で繋ぐ（60px以内）
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 80) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(77,208,225,${0.04 * (1 - dist/80)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(draw);
    }

    init();
    draw();

    window.addEventListener('resize', () => { init(); });

    // タブ非表示時は停止
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else draw();
    });
  }

  /* ============================================================
     2. スクロールリビール (IntersectionObserver)
  ============================================================ */
  function initScrollReveal() {
    const targets = document.querySelectorAll(
      '.card, .news-section, .news-item, .room-card, .feature-card, .form-group, .section-header'
    );

    if (!targets.length) return;

    // reveal クラスを付与
    targets.forEach((el, i) => {
      el.classList.add('reveal');
      // 同じ親内での順番に応じてディレイ
      const siblings = el.parentElement
        ? [...el.parentElement.children].indexOf(el)
        : 0;
      const delay = Math.min(siblings * 0.07, 0.35);
      el.style.transitionDelay = delay + 's';
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    targets.forEach(el => io.observe(el));
  }

  /* ============================================================
     3. 送信ボタン送信アニメーション
  ============================================================ */
  function initSendButton() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[id*="send"], .send-btn, [data-send]');
      if (!btn) return;
      btn.classList.remove('send-pop');
      void btn.offsetWidth; // reflow
      btn.classList.add('send-pop');
      btn.addEventListener('animationend', () => btn.classList.remove('send-pop'), { once: true });
    });
  }

  /* ============================================================
     4. ナビホバーにマウス追従グロー
  ============================================================ */
  function initNavGlow() {
    const nav = document.querySelector('.header-nav');
    if (!nav) return;

    const glow = document.createElement('div');
    glow.style.cssText = `
      position:absolute; pointer-events:none; border-radius:8px;
      background:rgba(244,166,32,0.08); transition:all 0.2s ease;
      opacity:0; z-index:0;
    `;
    nav.style.position = 'relative';
    nav.prepend(glow);

    nav.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('mouseenter', () => {
        const r = link.getBoundingClientRect();
        const nr = nav.getBoundingClientRect();
        glow.style.cssText += `
          left:${r.left - nr.left}px; top:${r.top - nr.top}px;
          width:${r.width}px; height:${r.height}px; opacity:1;
        `;
      });
      link.addEventListener('mouseleave', () => {
        glow.style.opacity = '0';
      });
    });
  }

  /* ============================================================
     5. マウス追従アンビエントグロー
  ============================================================ */
  function initMouseGlow() {
    const glow = document.createElement('div');
    glow.style.cssText = `
      position:fixed; width:400px; height:400px;
      border-radius:50%; pointer-events:none; z-index:0;
      background: radial-gradient(circle, rgba(77,208,225,0.035) 0%, transparent 70%);
      transform: translate(-50%,-50%);
      transition: left 0.6s ease, top 0.6s ease;
      will-change: left, top;
    `;
    document.body.appendChild(glow);

    let tx = 0, ty = 0;
    window.addEventListener('mousemove', e => {
      tx = e.clientX; ty = e.clientY;
      glow.style.left = tx + 'px';
      glow.style.top  = ty + 'px';
    });
  }

  /* ============================================================
     DM未読バッジ ポーリング（全ページ共通）
  ============================================================ */
  function initDMUnreadBadge() {
    // ログイン済みでないなら何もしない
    const sess = (() => { try { return JSON.parse(localStorage.getItem('kushiro_session')); } catch { return null; } })();
    if (!sess?.sessionToken) return;

    const API_BASE = (window.KUSHIRO_API_BASE || '').replace(/\/$/, '');
    if (!API_BASE) return;

    // nav内のDMリンクにバッジ用spanを動的追加（既にあれば再利用）
    function ensureBadgeEl() {
      let el = document.getElementById('dm-nav-badge');
      if (!el) {
        const dmLink = document.querySelector('a[href="dm.html"]');
        if (!dmLink) return null;
        if (getComputedStyle(dmLink).position === 'static') {
          dmLink.style.position = 'relative';
        }
        el = document.createElement('span');
        el.id = 'dm-nav-badge';
        el.style.cssText = 'display:none;position:absolute;top:2px;right:2px;width:8px;height:8px;background:#ef5350;border-radius:50%;border:2px solid var(--bg-dark);';
        dmLink.appendChild(el);
      }
      return el;
    }

    async function checkUnread() {
      try {
        const res = await fetch(`${API_BASE}/api/dm/conversations`, {
          headers: { 'X-Session-Token': sess.sessionToken, 'X-Api-Secret': window.KUSHIRO_API_SECRET || '' },
        });
        if (!res.ok) return;
        const data = await res.json();
        const hasUnread = (data.conversations || []).some(c => c.unread > 0);
        const el = ensureBadgeEl();
        if (el) el.style.display = hasUnread ? 'block' : 'none';
      } catch {}
    }

    // 初回即時チェック → 30秒ごとにポーリング
    checkUnread();
    setInterval(checkUnread, 30000);
  }

  /* ============================================================
     初期化
  ============================================================ */
  function init() {
    // パーティクルは一部ページのみ（チャットは重いので除外）
    const isChat = document.querySelector('.messages-container');
    if (!isChat) {
      initParticles();
    }

    initScrollReveal();
    initSendButton();
    initNavGlow();
    initMouseGlow();
    initDMUnreadBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
