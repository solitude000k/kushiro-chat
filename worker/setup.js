#!/usr/bin/env node
/**
 * setup.js - Cloudflare Workers セットアップスクリプト
 * 実行: npm run setup
 */
'use strict';

const { spawnSync } = require('child_process');
const fs            = require('fs');
const path          = require('path');
const readline      = require('readline');

const TOML_PATH = path.join(__dirname, 'wrangler.toml');

const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', C = '\x1b[36m', B = '\x1b[1m', X = '\x1b[0m';
const log  = m => console.log(`${G}✅${X} ${m}`);
const warn = m => console.log(`${Y}⚠️ ${X} ${m}`);
const err  = m => console.log(`${R}❌${X} ${m}`);
const info = m => console.log(`${C}ℹ️ ${X} ${m}`);
const head = m => console.log(`\n${B}${m}${X}`);
const sep  = () => console.log('─'.repeat(50));

// ---- プロンプト（1行入力） ----
function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(a.trim()); }));
}

// ---- wrangler をspawnSyncで実行（stdout/stderrを分離） ----
function wrangler(args) {
  const r = spawnSync('npx', ['wrangler', ...args], { encoding: 'utf-8' });
  return {
    ok:     r.status === 0,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

// ---- stdoutからJSONだけ抽出してパース ----
function parseJsonFromOutput(output) {
  // 行ごとに処理して [ で始まる行からJSONブロックを探す
  const lines = output.split('\n');
  const jsonStart = lines.findIndex(l => l.trim().startsWith('['));
  if (jsonStart === -1) return null;
  // [ から ] まで結合
  let depth = 0, jsonStr = '';
  for (let i = jsonStart; i < lines.length; i++) {
    const line = lines[i];
    for (const c of line) {
      if (c === '[' || c === '{') depth++;
      if (c === ']' || c === '}') depth--;
    }
    jsonStr += line + '\n';
    if (depth <= 0 && jsonStr.trim()) break;
  }
  try { return JSON.parse(jsonStr.trim()); } catch { return null; }
}

// ---- KV Namespace 一覧から既存IDを取得 ----
function getExistingKvId(bindingName) {
  info('既存のKV Namespace一覧を取得中...');
  const r = wrangler(['kv', 'namespace', 'list']);

  // stdout にJSON出力が来る（stderrにwarning）
  const list = parseJsonFromOutput(r.stdout);
  if (list && Array.isArray(list)) {
    // wranglerがWorker名でprefixを付けることがある: "kushiro-chat-auth-TOKENS"
    const found = list.find(ns =>
      ns.title === bindingName ||
      ns.title === `kushiro-chat-auth-${bindingName}` ||
      (ns.title && ns.title.toUpperCase().includes(bindingName.toUpperCase()))
    );
    if (found) {
      log(`既存のKV Namespace を発見: "${found.title}" (id: ${found.id})`);
      return found.id;
    }
    warn('一覧にTOKENSが見つかりませんでした。一覧:');
    list.forEach(ns => console.log(`   - ${ns.title}: ${ns.id}`));
  } else {
    warn('KV一覧の取得に失敗しました。');
    if (r.stdout) console.log('stdout:', r.stdout.slice(0, 300));
  }
  return null;
}

// ---- KV作成（既存なら既存IDを取得） ----
async function resolveKvId(bindingName, preview = false) {
  const flag = preview ? ['--preview'] : [];
  info(`実行中: npx wrangler kv namespace create ${bindingName}${preview ? ' --preview' : ''}`);

  const r = wrangler(['kv', 'namespace', 'create', bindingName, ...flag]);

  if (r.ok) {
    // 成功: stdout から id を抽出
    const m = r.stdout.match(/id\s*=\s*"([0-9a-f]{32})"/) ||
              r.stdout.match(/"id":\s*"([0-9a-f]{32})"/);
    if (m) { log(`KV ID取得: ${m[1]}`); return m[1]; }
  }

  // 既存エラー (10014)
  const combined = r.stdout + r.stderr;
  if (combined.includes('10014') || combined.includes('already exists')) {
    warn(`KV "${bindingName}" はすでに存在します。既存のIDを取得します...`);
    const existingId = getExistingKvId(bindingName);
    if (existingId) return existingId;
  }

  // 自動取得失敗 → 手動入力
  err('KV IDの自動取得に失敗しました。');
  console.log('');
  console.log(`${Y}手動で取得する方法:${X}`);
  console.log('  1. https://dash.cloudflare.com を開く');
  console.log('  2. Workers & Pages → KV');
  console.log(`  3. "TOKENS" または "kushiro-chat-auth-TOKENS" の ID をコピー`);
  console.log('');
  const manualId = await ask(`KV ${preview ? 'Preview ' : ''}ID を手動で入力してください (スキップ: Enter): `);
  return manualId || null;
}

// ---- wrangler.toml にKVセクションを書き込み ----
function patchToml(id, previewId) {
  let toml = fs.readFileSync(TOML_PATH, 'utf-8');

  // 既存の[[kv_namespaces]]を全部削除（コメント行含む）
  toml = toml.replace(/^#\s*\[\[kv_namespaces\]\][^\n]*\n(^#[^\n]*\n)*/gm, '');
  toml = toml.replace(/^\[\[kv_namespaces\]\][\s\S]*?(?=^\[|\Z)/m, '');

  // [vars] の直前に挿入
  const kvBlock = `[[kv_namespaces]]
binding    = "TOKENS"
id         = "${id}"
preview_id = "${previewId || id}"

`;
  if (toml.includes('[vars]')) {
    toml = toml.replace('[vars]', kvBlock + '[vars]');
  } else {
    toml += '\n' + kvBlock;
  }
  fs.writeFileSync(TOML_PATH, toml, 'utf-8');
  log('wrangler.toml にKV IDを書き込みました');
}

// ---- [vars] の値を更新 ----
function updateVar(key, value) {
  let toml = fs.readFileSync(TOML_PATH, 'utf-8');
  toml = toml.replace(new RegExp(`^(${key}\\s*=\\s*).*$`, 'm'), `$1"${value}"`);
  fs.writeFileSync(TOML_PATH, toml, 'utf-8');
}

// ---- Secret設定 ----
async function setSecret(name, description) {
  const answer = await ask(`${Y}${name}${X}（${description}）を今すぐ設定しますか？(y/N): `);
  if (answer.toLowerCase() !== 'y') {
    warn(`後で手動で実行: npx wrangler secret put ${name}`);
    return;
  }
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { stdio: 'inherit', encoding: 'utf-8' });
  if (r.status === 0) log(`${name} を設定しました`);
  else err(`${name} の設定に失敗しました。後で手動で実行してください: npx wrangler secret put ${name}`);
}

// ================================================================
// メイン
// ================================================================
async function main() {
  console.log('');
  console.log(`${B}🌊 釧路コミュニティチャット — Cloudflare Workerセットアップ${X}`);
  sep();

  // ---- Step 0: wrangler バージョン確認 ----
  head('Step 0: Wrangler バージョン確認');
  const vr = wrangler(['--version']);
  const verLine = (vr.stdout + vr.stderr).split('\n').find(l => /\d+\.\d+/.test(l));
  if (verLine) info(`Wrangler: ${verLine.trim()}`);
  if (vr.stderr.includes('out-of-date')) {
    warn('Wranglerが古いです。`npm install` を実行してv4に更新してください。');
    const upd = await ask('今すぐ npm install を実行しますか？(Y/n): ');
    if (upd.toLowerCase() !== 'n') {
      const r = spawnSync('npm', ['install'], { stdio: 'inherit', cwd: __dirname });
      if (r.status === 0) log('Wrangler を更新しました。処理を続行します。');
    }
  }

  // ---- Step 1: ログイン確認 ----
  head('Step 1: Cloudflare 認証確認');
  const wr = wrangler(['whoami']);
  if (!wr.ok || (wr.stdout + wr.stderr).includes('not authenticated')) {
    warn('Cloudflareにログインしていません。');
    spawnSync('npx', ['wrangler', 'login'], { stdio: 'inherit' });
  } else {
    const acct = (wr.stdout + wr.stderr).split('\n').find(l => l.includes('@') || l.includes('Account'));
    log('Cloudflare認証済み' + (acct ? `: ${acct.trim()}` : ''));
  }

  // ---- Step 2: FRONTEND_URL 設定 ----
  head('Step 2: フロントエンドURL設定');
  sep();
  const toml = fs.readFileSync(TOML_PATH, 'utf-8');
  const curUrl = (toml.match(/FRONTEND_URL\s*=\s*"([^"]+)"/) || [])[1] || '';
  if (!curUrl || curUrl === 'https://your-site.pages.dev') {
    const url = await ask('Cloudflare Pages のURL を入力してください (例: https://kushiro-chat.pages.dev): ');
    if (url) { updateVar('FRONTEND_URL', url.replace(/\/$/, '')); log(`FRONTEND_URL: ${url}`); }
  } else {
    log(`FRONTEND_URL: ${curUrl}`);
    const ch = await ask('変更しますか？(y/N): ');
    if (ch.toLowerCase() === 'y') {
      const url = await ask('新しいURLを入力: ');
      if (url) updateVar('FRONTEND_URL', url.replace(/\/$/, ''));
    }
  }

  // ---- Step 3: KV Namespace ----
  head('Step 3: KV Namespace 設定');
  sep();

  const freshToml = fs.readFileSync(TOML_PATH, 'utf-8');
  const existingKvId = (freshToml.match(/^\s*id\s*=\s*"([0-9a-f]{32})"/m) || [])[1];

  if (existingKvId) {
    log(`KV ID は設定済みです: ${existingKvId.slice(0, 8)}...`);
    const redo = await ask('再設定しますか？(y/N): ');
    if (redo.toLowerCase() !== 'y') {
      info('既存の設定を使用します');
      await continueSetup();
      return;
    }
  }

  const id = await resolveKvId('TOKENS', false);
  if (!id) {
    err('KV IDが設定できませんでした。wrangler.toml を手動で編集してから npm run deploy を実行してください。');
    process.exit(1);
  }

  const previewId = await resolveKvId('TOKENS', true);
  patchToml(id, previewId || id);

  await continueSetup();
}

async function continueSetup() {
  // ---- Step 4: Secrets ----
  head('Step 4: Secrets 設定');
  sep();
  await setSecret('RESEND_API_KEY', 'Resend APIキー re_xxxx...');
  console.log('');
  await setSecret('API_SECRET',    'フロントエンドとの共有キー（任意の文字列）');

  // ---- Step 5: デプロイ ----
  head('Step 5: デプロイ');
  sep();
  const doDeploy = await ask('デプロイを実行しますか？(Y/n): ');
  if (doDeploy.toLowerCase() === 'n') {
    info('後で npm run deploy を実行してください。');
  } else {
    info('デプロイ中...');
    const r = spawnSync('npx', ['wrangler', 'deploy'], { stdio: 'inherit', encoding: 'utf-8', cwd: __dirname });
    if (r.status !== 0) {
      err('デプロイに失敗しました。エラーを確認してください。');
      process.exit(1);
    }
  }

  // ---- 完了 ----
  console.log('');
  sep();
  console.log(`${B}\x1b[32m✅ セットアップ完了！${X}`);
  sep();
  console.log(`
次のステップ:
  1. 上記デプロイ出力のWorker URLを確認
  2. js/config.js の KUSHIRO_API_BASE をWorker URLに更新
  3. Cloudflare Pages にフロントエンドをデプロイ
  `);
}

main().catch(e => {
  err(`予期しないエラー: ${e.message}`);
  console.error(e);
  process.exit(1);
});
