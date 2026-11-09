// Owl Toons agent: runs the studio on NEAR.
//   GET  /api/toons?state=1          round, stats, episodes (for the site)
//   GET  /api/toons?ep=N             episode N as an SVG comic (NFT media)
//   GET  /api/toons?tick=1           cron: when the vote has closed, make + publish the episode, open the next vote
//   POST /api/toons {action:'setup'} one-time: create the testnet accounts, deploy the contract, open the first vote
// The agent signs its own NEAR transactions with its own key. Nobody presses a button.
const nodeCrypto = require('crypto');
const { render } = require('./_toons_art.js');

const NET = process.env.OWLTOONS_NETWORK || 'testnet';
const RPC = NET === 'mainnet' ? ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'] : ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'];
const CONTRACT = process.env.OWLTOONS_CONTRACT || 'owltoons-hoodl.testnet';
const AGENT = process.env.OWLTOONS_AGENT || 'owltoons-agent.testnet';
const TREASURY = process.env.OWLTOONS_TREASURY || 'owltoons-treasury.testnet';
const WASM = 'https://raw.githubusercontent.com/justhoodl/hoodlowl-toons/main/res/owl_toons.wasm';
const SITE = 'https://justhoodl.fun';
const ROUND_MS = Number(process.env.OWLTOONS_ROUND_MS || 6 * 3600e3);
const AI_URL = 'https://cloud-api.near.ai/v1/chat/completions';
const AI_MODEL = process.env.OWLTOONS_MODEL || 'deepseek-ai/DeepSeek-V3.1';
const SETUP_HASH = '3dc187b0fd39d9dbe8b48a76b62d01e17c8fdc222f8573cb23ae16ca2b13dcdd'; // sha256 of the one-time setup token

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV, 'content-type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const getJ = async k => { const [v] = await redis([['GET', k]]); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const setJ = (k, v, ex) => redis([ex ? ['SET', k, JSON.stringify(v), 'EX', String(ex)] : ['SET', k, JSON.stringify(v)]]);
function send(res, code, obj, type) { res.statusCode = code; res.setHeader('content-type', type || 'application/json'); res.end(type ? obj : JSON.stringify(obj)); }

/* ---------- NEAR: rpc, keys, borsh, signing ---------- */
async function rpc(method, params) {
  let last;
  for (const u of RPC) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.error) { last = new Error(JSON.stringify(j.error.data || j.error.cause || j.error).slice(0, 400)); if (/UNKNOWN|does not exist|InvalidTransaction|ActionError/.test(last.message)) throw last; continue; }
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('rpc');
}
async function view(method, args) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args || {})).toString('base64') });
  return JSON.parse(Buffer.from(r.result).toString());
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf) { let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b) break; s = '1' + s; } return s; }
function b58dec(s) { let n = 0n; for (const c of s) { const v = B58.indexOf(c); if (v < 0) throw new Error('b58'); n = n * 58n + BigInt(v); } let h = n ? n.toString(16) : ''; if (h.length % 2) h = '0' + h; let z = 0; while (s[z] === '1') z++; return Buffer.concat([Buffer.alloc(z), Buffer.from(h, 'hex')]); }
function newKey() { const seed = nodeCrypto.randomBytes(32); return keyFromSeed(seed); }
function keyFromSeed(seed) {
  const priv = nodeCrypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const pub = nodeCrypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).slice(-32);
  return { seed, pub, priv, pubStr: 'ed25519:' + b58enc(pub), secret: 'ed25519:' + b58enc(Buffer.concat([seed, pub])) };
}
function keyFromSecret(s) { return keyFromSeed(b58dec(String(s).replace(/^ed25519:/, '')).slice(0, 32)); }
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u128 = n => { const b = Buffer.alloc(16); let v = BigInt(n); for (let i = 0; i < 16; i++) { b[i] = Number(v & 255n); v >>= 8n; } return b; };
const str = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32(b.length), b]); };
const bytes = b => Buffer.concat([u32(b.length), b]);
const pk = key => Buffer.concat([Buffer.from([0]), key.pub]);
const A = {
  deploy: code => Buffer.concat([Buffer.from([1]), bytes(code)]),
  call: (m, args, gasT, dep) => Buffer.concat([Buffer.from([2]), str(m), bytes(Buffer.from(JSON.stringify(args || {}))), u64(BigInt(gasT) * 10n ** 12n), u128(dep || 0)]),
  transfer: dep => Buffer.concat([Buffer.from([3]), u128(dep)]),
  delKey: pubBuf => Buffer.concat([Buffer.from([6]), Buffer.from([0]), pubBuf]),
};
async function sendTx(key, signer, receiver, actions) {
  const ak = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: signer, public_key: key.pubStr });
  const block = await rpc('block', { finality: 'final' });
  const tx = Buffer.concat([str(signer), pk(key), u64(BigInt(ak.nonce) + 1n), str(receiver), b58dec(block.header.hash), u32(actions.length), ...actions]);
  const sig = nodeCrypto.sign(null, nodeCrypto.createHash('sha256').update(tx).digest(), key.priv);
  const signed = Buffer.concat([tx, Buffer.from([0]), sig]);
  const r = await rpc('send_tx', { signed_tx_base64: signed.toString('base64'), wait_until: 'FINAL' });
  const st = r.status || (r.final_execution_outcome && r.final_execution_outcome.status);
  if (st && st.Failure) throw new Error('tx failed: ' + JSON.stringify(st.Failure).slice(0, 300));
  const fail = (r.receipts_outcome || []).map(o => o.outcome.status).find(s => s && s.Failure);
  if (fail) throw new Error('receipt failed: ' + JSON.stringify(fail.Failure).slice(0, 300));
  return { hash: r.transaction && r.transaction.hash, value: st && st.SuccessValue ? Buffer.from(st.SuccessValue, 'base64').toString() : null };
}
async function agentKey() { const k = await redis([['GET', 'ot:k:agent']]); if (!k[0]) throw new Error('agent not set up'); return keyFromSecret(k[0]); }
const callContract = async (method, args, gas, dep) => sendTx(await agentKey(), AGENT, CONTRACT, [A.call(method, args, gas || 100, dep || 0)]);

/* ---------- the writer: NEAR AI Cloud ---------- */
const CAST = 'owl (Hoodl, the HOODL owl: calm, never sells, holds an orange coin), fox (a slick scammer), whale (a big rich holder, friendly), frog (a nervous paper-hands trader)';
const SCENES = 'branch (owl tree by day), night (tree at night with moon), chart (trading screen), moon (on the moon), beach, market (a busy market)';
const PROPS = 'coin, laptop, rug, rocket, airdrop (a suspicious paper to sign), none';
const POSES = 'normal, happy, shock, fly, sleep, point';
async function ai(messages, maxTokens) {
  const key = process.env.NEARAI_API_KEY; if (!key) throw new Error('NEARAI_API_KEY missing');
  const r = await fetch(AI_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.9, max_tokens: maxTokens || 1200 }), signal: AbortSignal.timeout(45000) });
  const j = await r.json(); if (!r.ok) throw new Error('ai ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  return { text: j.choices[0].message.content, usage: j.usage || {} };
}
function jsonFrom(t) { const m = String(t).match(/\{[\s\S]*\}/); if (!m) throw new Error('no json'); return JSON.parse(m[0]); }
async function writeEpisode(n, plot, by) {
  const sys = 'You write a 4-panel newspaper comic strip starring a cartoon owl named Hoodl from the $HOODL crypto meme community on NEAR. Funny, short, kind, crypto-native humor (holding, dips, scams, airdrops, whales, charts). Never mention real people or real brands other than NEAR and HOODL. Output ONLY JSON.';
  const user = 'Episode ' + n + '. The fans voted for this plot: "' + plot + '" (pitched by ' + by + ').\nCast you may use: ' + CAST + '.\nScenes: ' + SCENES + '.\nProps: ' + PROPS + '.\nPoses: ' + POSES + '.\n\nReturn JSON exactly like:\n{"title":"max 5 words","panels":[{"scene":"branch","cast":[{"who":"owl","pose":"normal"},{"who":"fox","pose":"point"}],"prop":"airdrop","lines":[{"who":"fox","say":"max 9 words"},{"who":"owl","say":"max 9 words"}]}],"caption":"one short line under the strip"}\nRules: exactly 4 panels, 1 or 2 characters per panel, at most 2 lines per panel, each line at most 9 words, panel 4 is the punchline.';
  const r = await ai([{ role: 'system', content: sys }, { role: 'user', content: user }]);
  const s = jsonFrom(r.text);
  if (!Array.isArray(s.panels) || s.panels.length < 4) throw new Error('bad script');
  s.panels = s.panels.slice(0, 4); s.title = String(s.title || 'Untitled').slice(0, 40);
  return { script: s, usage: r.usage };
}
async function writeIdeas(n, recent) {
  const r = await ai([{ role: 'system', content: 'You pitch plots for a daily crypto comic about Hoodl the owl ($HOODL on NEAR). Output ONLY JSON.' }, { role: 'user', content: 'Pitch 3 different, funny plots for episode ' + n + '. Each at most 12 words. Avoid repeating these recent plots: ' + JSON.stringify(recent || []) + '. Cast: ' + CAST + '. Return {"ideas":["...","...","..."]}' }], 300);
  const j = jsonFrom(r.text); return { ideas: (j.ideas || []).map(x => String(x).slice(0, 110)).filter(Boolean).slice(0, 3), usage: r.usage };
}

/* ---------- the studio: one full night ---------- */
async function studio() {
  const [lock] = await redis([['SET', 'ot:lock', '1', 'EX', '240', 'NX']]); if (lock !== 'OK') return { skipped: 'busy' };
  try {
    const round = await view('get_round');
    if (!round.options.length) return { skipped: 'no round' };
    if (Date.now() < round.closes_at) return { skipped: 'vote open', closes_in_min: Math.round((round.closes_at - Date.now()) / 60000) };
    let win = 0; round.options.forEach((o, i) => { if (BigInt(o.votes) > BigInt(round.options[win].votes)) win = i; });
    const w = round.options[win], n = round.episode, log = [];
    const { script, usage } = await writeEpisode(n, w.text, w.by === AGENT ? 'the Owl Toons agent' : w.by);
    log.push('script by NEAR AI: ' + script.title);
    await setJ('ot:ep:' + n, { n, script, plot: w.text, by: w.by, at: Date.now() });
    const media = SITE + '/api/toons?ep=' + n;
    const pub = await callContract('publish_episode', { title: script.title, media, script: JSON.stringify(script) }, 150);
    log.push('published #' + n + ' tx ' + pub.hash);
    // the agent pays its own AI bill from the compute reserve (estimated from tokens used)
    const tokens = (usage.total_tokens || 1500) + 600, costNear = Math.max(0.001, tokens / 1e6 * 2 / 2.5); // ~$2 per 1M tokens, NEAR at ~$2.5
    const stats = await view('get_stats'), want = BigInt(Math.round(costNear * 1e6)) * 10n ** 18n;
    if (BigInt(stats.reserve) >= want) { const p = await callContract('pay_compute', { amount: want.toString(), note: 'NEAR AI Cloud, episode ' + n + ', ' + tokens + ' tokens' }, 30); log.push('paid compute ' + costNear.toFixed(4) + ' NEAR tx ' + p.hash); }
    const recent = ((await view('get_episodes', { limit: 5 })) || []).map(e => e.plot);
    const { ideas } = await writeIdeas(n + 1, recent);
    const op = await callContract('open_round', { ideas, closes_at: Date.now() + ROUND_MS }, 50);
    log.push('opened vote for #' + (n + 1) + ' tx ' + op.hash);
    await redis([['LPUSH', 'ot:log', JSON.stringify({ at: Date.now(), n, lines: log })], ['LTRIM', 'ot:log', '0', '49'], ['DEL', 'ot:state']]);
    return { ok: true, log };
  } finally { await redis([['DEL', 'ot:lock']]); }
}

/* ---------- one-time setup ---------- */
async function createTestnetAccount(id, key) {
  const r = await fetch('https://helper.testnet.near.org/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.pubStr }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('helper ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
async function setup(step) {
  const out = [];
  if (step === 'accounts' || step === 'all') {
    for (const [role, id] of [['agent', AGENT], ['contract', CONTRACT], ['treasury', TREASURY]]) {
      const [have] = await redis([['GET', 'ot:k:' + role]]); if (have) { out.push(role + ' exists'); continue; }
      const k = newKey(); await createTestnetAccount(id, k); await redis([['SET', 'ot:k:' + role, k.secret]]); out.push(role + ' created ' + id);
    }
  }
  if (step === 'deploy' || step === 'all') {
    const [sec] = await redis([['GET', 'ot:k:contract']]); const ck = keyFromSecret(sec);
    const code = Buffer.from(await (await fetch(WASM + '?t=' + Date.now())).arrayBuffer()); if (code.length < 10000) throw new Error('wasm not built yet');
    const d = await sendTx(ck, CONTRACT, CONTRACT, [A.deploy(code), A.call('new', { agent: AGENT, treasury: TREASURY }, 100, 0)]);
    out.push('deployed ' + code.length + ' bytes tx ' + d.hash);
  }
  if (step === 'lock' || step === 'all') {
    const [sec] = await redis([['GET', 'ot:k:contract']]); const ck = keyFromSecret(sec);
    const d = await sendTx(ck, CONTRACT, CONTRACT, [A.delKey(ck.pub)]); await redis([['DEL', 'ot:k:contract']]);
    out.push('contract locked (key deleted) tx ' + d.hash);
  }
  if (step === 'open' || step === 'all') {
    const { ideas } = await writeIdeas(1, []);
    const op = await callContract('open_round', { ideas, closes_at: Date.now() + ROUND_MS }, 50);
    out.push('first vote open tx ' + op.hash + ': ' + ideas.join(' | '));
  }
  return out;
}

/* ---------- state for the site ---------- */
async function state() {
  const c = await getJ('ot:state'); if (c) return c;
  const [round, stats, eps, logs] = await Promise.all([view('get_round'), view('get_stats'), view('get_episodes', { limit: 12 }), redis([['LRANGE', 'ot:log', '0', '9']])]);
  const s = { network: NET, contract: CONTRACT, agent: AGENT, treasury: TREASURY, round, stats, episodes: eps, log: (logs[0] || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean), at: Date.now() };
  await setJ('ot:state', s, 15); return s;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    if (req.method === 'GET' && q.ep) {
      const e = await getJ('ot:ep:' + Number(q.ep)); if (!e) return send(res, 404, { error: 'no such episode' });
      res.setHeader('cache-control', 'public, max-age=86400'); return send(res, 200, render(e), 'image/svg+xml');
    }
    if (req.method === 'GET' && q.script) { const e = await getJ('ot:ep:' + Number(q.script)); return send(res, e ? 200 : 404, e || { error: 'no such episode' }); }
    if (req.method === 'GET' && q.state) { res.setHeader('cache-control', 'no-store'); return send(res, 200, await state()); }
    if (req.method === 'GET' && (q.tick || /^vercel-cron\//.test(String(req.headers['user-agent'] || '')))) return send(res, 200, await studio());
    if (req.method === 'POST') {
      let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      if (!b || nodeCrypto.createHash('sha256').update(String(b.token || '')).digest('hex') !== SETUP_HASH) return send(res, 403, { error: 'forbidden' });
      if (b.action === 'setup') return send(res, 200, { ok: true, out: await setup(b.step || 'all') });
      if (b.action === 'studio') return send(res, 200, await studio());
      if (b.action === 'aitest') {
        const m = await fetch('https://cloud-api.near.ai/v1/models', { headers: { Authorization: 'Bearer ' + process.env.NEARAI_API_KEY } }).then(r => r.json()).catch(e => ({ error: String(e) }));
        let ideas = null; try { ideas = await writeIdeas(1, []); } catch (e) { ideas = { error: String(e.message || e).slice(0, 300) }; }
        return send(res, 200, { models: (m.data || []).map(x => x.id), modelError: m.error || null, ideas });
      }
      return send(res, 400, { error: 'bad action' });
    }
    return send(res, 200, { ok: true, app: 'Owl Toons agent', contract: CONTRACT, network: NET });
  } catch (e) { console.error('toons', e); return send(res, 500, { error: String(e.message || e).slice(0, 400) }); }
};
