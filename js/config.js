/**
 * config.js - フロントエンド API 設定
 *
 * デプロイ環境に合わせて KUSHIRO_API_BASE を変更してください。
 *
 * ローカル開発:
 *   window.KUSHIRO_API_BASE = 'http://localhost:8787';
 *
 * Cloudflare Workers デプロイ後:
 *   window.KUSHIRO_API_BASE = 'https://kushiro-chat-auth.your-account.workers.dev';
 *   または独自ドメイン設定後:
 *   window.KUSHIRO_API_BASE = 'https://api.your-domain.com';
 */

window.KUSHIRO_API_BASE   = 'https://kushiro-chat.preview-me.workers.dev/';
window.KUSHIRO_API_SECRET = 're_X7VXMFvh_JnFKpvhjxAyhKjb7N7hrBreq';  // Workers側でAPI_SECRETを設定した場合はここに同じ値を入力
