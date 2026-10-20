// Sincronização entre aparelhos (api/_merge.js + api/state.js + saveState do app), 2026-10-20.
// Upstash simulado em memória — nada real é chamado.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { mergeStates } = require('../api/_merge');
const { loadApp } = require('./harness');

const conf = (at, extra = {}) => ({ sh: { maria: { type: 'abertura' } }, diar: [], holiday: false, at, ...extra });
const days = (de, ate, mk) => {
  const out = {};
  for (let d = new Date(de + 'T00:00:00Z'); d <= new Date(ate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10); out[k] = mk(k);
  }
  return out;
};

// Escala real lançada em 07/10 (15 dias, at > 0) e o aparelho velho de 08/10 (28 dias do modelo antigo, at 0).
const real = () => ({ _updatedAt: 2000, _cfgAt: 0, team: [{ id: 'duda', cond: 'nova' }], days: days('2026-09-21', '2026-10-05', () => ({ conf: conf(1900, { motivo: 'real' }), draft: null })) });
const velho = () => ({ _updatedAt: 1000, team: [{ id: 'duda', cond: 'velha' }], days: { ...days('2026-08-10', '2026-08-23', () => ({ conf: conf(0), draft: null })), ...days('2026-09-21', '2026-10-04', () => ({ conf: conf(0, { motivo: null }), draft: null })) } });

test('08/10: aparelho velho com MAIS dias não apaga a escala real', () => {
  const m = mergeStates(real(), velho());
  assert.strictEqual(m.days['2026-09-21'].conf.motivo, 'real');
  assert.ok(m.days['2026-10-05'].conf, '05/10 continua');
  assert.ok(m.days['2026-08-10'].conf, 'semanas antigas que só o aparelho tinha entram');
  assert.strictEqual(m.team[0].cond, 'nova', 'configuração velha não passa por cima');
});

test('recuperação: reenviar a versão boa repõe os dias reais sobre os convertidos (at 0)', () => {
  const atual = { ...velho(), _updatedAt: 3000, days: { ...velho().days, '2026-10-08': { conf: null, draft: { sh: {} } } } };
  const m = mergeStates(atual, real());
  assert.strictEqual(m.days['2026-10-04'].conf.motivo, 'real');
  assert.ok(m.days['2026-10-05'].conf);
  assert.ok(m.days['2026-10-08'].draft, 'rascunhos mais novos do servidor ficam');
});

test('mesmo dia confirmado dos dois lados: fica a confirmação mais recente', () => {
  const s = { _updatedAt: 1, days: { '2026-10-13': { conf: conf(100, { motivo: 'a' }), draft: null } } };
  const i = { _updatedAt: 1, days: { '2026-10-13': { conf: conf(200, { motivo: 'b' }), draft: null } } };
  assert.strictEqual(mergeStates(s, i).days['2026-10-13'].conf.motivo, 'b');
  assert.strictEqual(mergeStates(i, s).days['2026-10-13'].conf.motivo, 'b');
});

test('descartar rascunho no aparelho mais recente apaga o rascunho; confirmado nunca some', () => {
  const s = { _updatedAt: 1, days: { '2026-10-13': { conf: conf(5), draft: { x: 1 } }, '2026-10-14': { conf: null, draft: { x: 1 } } } };
  const i = { _updatedAt: 2, days: {} };
  const m = mergeStates(s, i);
  assert.ok(m.days['2026-10-13'].conf); assert.strictEqual(m.days['2026-10-13'].draft, null);
  assert.ok(!m.days['2026-10-14']);
});

test('configuração mais nova (_cfgAt) ganha, venha de onde vier', () => {
  const s = { _updatedAt: 9, _cfgAt: 5, rates: { weekday: 80 }, days: {} };
  const i = { _updatedAt: 1, _cfgAt: 7, rates: { weekday: 85 }, days: {} };
  assert.strictEqual(mergeStates(s, i).rates.weekday, 85);
  assert.strictEqual(mergeStates(s, { ...i, _cfgAt: 4 }).rates.weekday, 80);
});

// ---------- handler com Upstash em memória ----------
function upstash() {
  const db = { kv: null, bak: [] }; let writes = 0;
  global.fetch = async (url, opts = {}) => {
    const ok = (result) => ({ ok: true, status: 200, json: async () => (result) });
    if (url.includes('/get/')) return ok({ result: db.kv });
    if (url.includes('/lrange/')) return ok({ result: db.bak });
    if (url.includes('/lindex/')) return ok({ result: db.bak[+url.split('/').pop()] ?? null });
    if (url.endsWith('/pipeline')) {
      writes++;
      JSON.parse(opts.body).forEach(([cmd, , v]) => { if (cmd === 'LPUSH') db.bak.unshift(v); if (cmd === 'SET') db.kv = v; });
      return ok([{ result: 'OK' }]);
    }
    throw new Error('url inesperada ' + url);
  };
  return { db, writes: () => writes };
}
async function call(method, { body, query = {} } = {}) {
  for (const f of ['state.js', '_auth.js']) delete require.cache[require.resolve(path.join(__dirname, '..', 'api', f))];
  delete process.env.ANK_ACCESS_KEY;
  process.env.UPSTASH_REDIS_REST_URL = 'http://upstash.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 't';
  const handler = require(path.join(__dirname, '..', 'api', 'state.js'));
  const res = { code: 200, body: null }; res.status = (c) => { res.code = c; return res; }; res.json = (b) => { res.body = b; return res; };
  await handler({ method, headers: {}, query, body }, res);
  return res;
}

test('POST de aparelho velho: 409 com o estado junto, servidor guarda o junto e a versão anterior', async () => {
  const u = upstash(); u.db.kv = JSON.stringify(real());
  const r = await call('POST', { body: velho() });
  assert.strictEqual(r.code, 409);
  assert.strictEqual(r.body.state.days['2026-09-21'].conf.motivo, 'real');
  assert.strictEqual(JSON.parse(u.db.kv).days['2026-10-05'].conf.motivo, 'real');
  assert.strictEqual(u.db.bak.length, 1);
});

test('POST que não muda nada não grava nem gasta versão guardada', async () => {
  const u = upstash(); u.db.kv = JSON.stringify(real());
  const r = await call('POST', { body: real() });
  assert.strictEqual(r.code, 200); assert.strictEqual(u.writes(), 0);
});

test('GET ?versions=1 resume e ?version=N devolve a versão inteira', async () => {
  const u = upstash(); u.db.bak = [JSON.stringify(velho()), JSON.stringify(real())];
  const l = await call('GET', { query: { versions: '1' } });
  assert.deepStrictEqual(l.body.versions.map((v) => [v.i, v.confirmados, v.confirmadosNoApp]), [[0, 28, 0], [1, 15, 15]]);
  const v = await call('GET', { query: { version: '1' } });
  assert.strictEqual(v.body.state.days['2026-10-05'].conf.motivo, 'real');
});

test('app: saveState marca _cfgAt só quando a configuração muda', () => {
  const a = loadApp();
  a.saveState(); const c1 = a.__get()._cfgAt || 0;
  a.__get().days['2026-10-13'] = { conf: null, draft: { sh: {} } };
  a.saveState();
  assert.strictEqual(a.__get()._cfgAt || 0, c1, 'mexer em dia não é configuração');
  a.__get().rates.weekday = 99; a.saveState();
  assert.ok(a.__get()._cfgAt > 0 && a.__get()._cfgAt >= c1);
});
