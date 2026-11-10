// 10/11/2026 — entrada com Face ID (passkeys): autenticador de software (chave ES256 gerada aqui) + Upstash falso em memória.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const API = path.join(__dirname, '..', 'api');

// ---------- Upstash falso ----------
let DB = {};
function cmd(c) {
  const [op, k, ...a] = c; const now = Date.now();
  const live = (key) => { const e = DB[key]; if (e && e.exp && e.exp < now) { delete DB[key]; return null; } return e || null; };
  switch (op) {
    case 'SET': DB[k] = { v: a[0], exp: a[1] === 'EX' ? now + (+a[2]) * 1000 : 0 }; return 'OK';
    case 'GET': { const e = live(k); return e ? e.v : null; }
    case 'GETDEL': { const e = live(k); delete DB[k]; return e ? e.v : null; }
    case 'DEL': delete DB[k]; return 1;
    case 'INCR': { const e = live(k) || { v: '0', exp: 0 }; e.v = String((+e.v) + 1); DB[k] = e; return +e.v; }
    case 'EXPIRE': if (DB[k]) DB[k].exp = now + (+a[0]) * 1000; return 1;
    case 'HSET': { DB[k] = DB[k] || { h: {} }; DB[k].h[a[0]] = a[1]; return 1; }
    case 'HGET': return (DB[k] && DB[k].h && DB[k].h[a[0]]) || null;
    case 'LPUSH': case 'LTRIM': return 'OK';
    default: throw new Error('cmd ' + op);
  }
}
global.fetch = async (url, opts = {}) => {
  if (String(url).endsWith('/pipeline')) { const r = JSON.parse(opts.body).map((c) => ({ result: cmd(c) })); return { ok: true, status: 200, json: async () => r }; }
  if (String(url).includes('/get/')) return { ok: true, status: 200, json: async () => ({ result: null }) };
  return { ok: true, status: 200, json: async () => ({}) };
};

function env(extra = {}) {
  for (const f of ['_auth.js', '_kv.js', '_webauthn.js', 'auth.js', 'state.js']) delete require.cache[require.resolve(path.join(API, f))];
  process.env.UPSTASH_REDIS_REST_URL = 'http://upstash.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 't';
  process.env.ANK_REG_CODE = '654321'; delete process.env.ANK_ACCESS_KEY;
  Object.assign(process.env, extra);
}
const HOST = 'ank-escala.vercel.app', ORIGIN = 'https://' + HOST;
async function call(file, { op, body = {}, headers = {}, method = 'POST', query = {}, ip = '1.1.1.1' } = {}) {
  const h = require(path.join(API, file));
  const res = { code: 200, body: null }; res.status = (c) => { res.code = c; return res; }; res.json = (b) => { res.body = b; return res; };
  await h({ method, headers: { host: HOST, 'x-forwarded-for': ip, ...headers }, query: { ...(op ? { op } : {}), ...query }, body }, res);
  return res;
}

// ---------- autenticador de software ----------
function cbor(v) {
  const head = (mt, n) => n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : Buffer.from([(mt << 5) | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor teste');
}
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest();
function device({ origin = ORIGIN, rpId = HOST } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }), credId = crypto.randomBytes(16);
  const cd = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    credId: b64u(credId),
    create(challenge) {
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const len = Buffer.from([credId.length >> 8, credId.length & 255]);
      const ad = Buffer.concat([sha(Buffer.from(rpId)), Buffer.from([0x45, 0, 0, 0, 0]), Buffer.alloc(16), len, credId, cose]);
      const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', response: { clientDataJSON: b64u(cd('webauthn.create', challenge)), attestationObject: b64u(att) } };
    },
    get(challenge, { flags = 0x05, tamper = false } = {}) {
      const ad = Buffer.concat([sha(Buffer.from(rpId)), Buffer.from([flags, 0, 0, 0, 0])]), c = cd('webauthn.get', challenge);
      let sig = crypto.sign('sha256', Buffer.concat([ad, sha(c)]), privateKey); if (tamper) sig = Buffer.from(sig.map((x, i) => (i === 10 ? x ^ 1 : x)));
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', response: { clientDataJSON: b64u(c), authenticatorData: b64u(ad), signature: b64u(sig), userHandle: null } };
    },
  };
}
async function cadastrar(dev) {
  const o = await call('auth.js', { op: 'register-options', body: { code: '654321' } });
  assert.strictEqual(o.code, 200, JSON.stringify(o.body));
  assert.strictEqual(o.body.publicKey.rp.id, HOST);
  assert.strictEqual(o.body.publicKey.authenticatorSelection.userVerification, 'required');
  return call('auth.js', { op: 'register-verify', body: { cred: dev.create(o.body.publicKey.challenge) } });
}
async function entrar(dev, opt) {
  const o = await call('auth.js', { op: 'login-options' });
  return call('auth.js', { op: 'login-verify', body: { cred: dev.get(o.body.publicKey.challenge, opt) } });
}

test('cadastro com o código certo devolve sessão; a sessão abre /api/state; sem sessão → 401', async () => {
  DB = {}; env(); const dev = device();
  const r = await cadastrar(dev);
  assert.strictEqual(r.code, 200); assert.ok(r.body.token);
  assert.strictEqual((await call('state.js', { method: 'GET' })).code, 401);
  assert.strictEqual((await call('state.js', { method: 'GET', headers: { 'x-ank-session': 'x'.repeat(43) } })).code, 401);
  assert.strictEqual((await call('state.js', { method: 'GET', headers: { 'x-ank-session': r.body.token } })).code, 200);
  assert.strictEqual((await call('state.js', { method: 'POST', query: { s: r.body.token }, body: { days: {} } })).code, 200, 'sendBeacon com ?s=');
});
test('código errado: 403 com tentativas restantes; 5 erros travam por IP (até o certo dá 429); outro IP segue', async () => {
  DB = {}; env();
  for (let i = 1; i <= 5; i++) { const r = await call('auth.js', { op: 'register-options', body: { code: '000000' } }); assert.strictEqual(r.code, 403); assert.strictEqual(r.body.restantes, 5 - i); }
  assert.strictEqual((await call('auth.js', { op: 'register-options', body: { code: '654321' } })).code, 429);
  assert.strictEqual((await call('auth.js', { op: 'register-options', body: { code: '654321' }, ip: '2.2.2.2' })).code, 200);
});
test('trava geral: 20 erros de IPs diferentes travam todo mundo', async () => {
  DB = {}; env();
  for (let i = 0; i < 20; i++) await call('auth.js', { op: 'register-options', body: { code: '999999' }, ip: '9.9.9.' + i });
  assert.strictEqual((await call('auth.js', { op: 'register-options', body: { code: '654321' }, ip: '3.3.3.3' })).code, 429);
});
test('entrada com Face ID: assinatura certa → sessão; desafio não serve duas vezes', async () => {
  DB = {}; env(); const dev = device(); await cadastrar(dev);
  const o = await call('auth.js', { op: 'login-options' });
  const cred = dev.get(o.body.publicKey.challenge);
  const r = await call('auth.js', { op: 'login-verify', body: { cred } });
  assert.strictEqual(r.code, 200); assert.ok(r.body.token);
  assert.strictEqual((await call('state.js', { method: 'GET', headers: { 'x-ank-session': r.body.token } })).code, 200);
  assert.strictEqual((await call('auth.js', { op: 'login-verify', body: { cred } })).code, 400, 'reenvio');
});
test('entrada recusada: assinatura alterada, sem Face ID (UV), outro site, aparelho não cadastrado', async () => {
  DB = {}; env(); const dev = device(); await cadastrar(dev);
  assert.strictEqual((await entrar(dev, { tamper: true })).code, 400);
  assert.strictEqual((await entrar(dev, { flags: 0x01 })).code, 400);
  const fora = device({ origin: 'https://golpe.example' }); fora.credId = dev.credId;
  const o = await call('auth.js', { op: 'login-options' });
  assert.strictEqual((await call('auth.js', { op: 'login-verify', body: { cred: { ...dev.get(o.body.publicKey.challenge), response: { ...dev.get(o.body.publicKey.challenge).response, clientDataJSON: b64u(Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: o.body.publicKey.challenge, origin: 'https://golpe.example' }))) } } } })).code, 400);
  const r = await entrar(device());
  assert.strictEqual(r.code, 401); assert.strictEqual(r.body.naoCadastrado, true);
});
test('cadastro sem passar pelo código (desafio inventado) é recusado', async () => {
  DB = {}; env(); const dev = device();
  const r = await call('auth.js', { op: 'register-verify', body: { cred: dev.create('desafio-inventado-123') } });
  assert.strictEqual(r.code, 400);
  assert.strictEqual((await entrar(dev)).code, 401);
});
test('sessão vale 12 h; sair apaga a sessão', async () => {
  DB = {}; env(); const dev = device(); const r = await cadastrar(dev);
  const e = DB['ank_sess:' + r.body.token]; assert.ok(e.exp - Date.now() > 11.9 * 3600e3 && e.exp - Date.now() <= 12 * 3600e3);
  await call('auth.js', { op: 'logout', headers: { 'x-ank-session': r.body.token } });
  assert.strictEqual((await call('state.js', { method: 'GET', headers: { 'x-ank-session': r.body.token } })).code, 401);
});
test('chave antiga continua aceita só enquanto ANK_ACCESS_KEY existir (scripts)', async () => {
  DB = {}; env({ ANK_ACCESS_KEY: 'velha' });
  assert.strictEqual((await call('state.js', { method: 'GET', headers: { 'x-ank-key': 'velha' } })).code, 200);
  env();
  assert.strictEqual((await call('state.js', { method: 'GET', headers: { 'x-ank-key': 'velha' } })).code, 401);
});
test('sem ANK_REG_CODE configurado: /api/auth responde 503 (não cadastra nada)', async () => {
  DB = {}; env(); delete process.env.ANK_REG_CODE;
  assert.strictEqual((await call('auth.js', { op: 'register-options', body: { code: '654321' } })).code, 503);
});
