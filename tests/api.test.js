// Chave de acesso das APIs (api/_auth.js): Upstash e Gemini simulados, nada real é chamado.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const API = path.join(__dirname, '..', 'api');

let externos = 0;
global.fetch = async () => { externos++; return { ok: true, status: 200, json: async () => ({ result: null }) }; };

async function chamar(arquivo, { chave, headers = {}, query = {}, method = 'GET' } = {}) {
  for (const f of ['_auth.js', arquivo]) delete require.cache[require.resolve(path.join(API, f))];
  process.env.UPSTASH_REDIS_REST_URL = 'http://upstash.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 't';
  if (chave) process.env.ANK_ACCESS_KEY = chave; else delete process.env.ANK_ACCESS_KEY;
  const handler = require(path.join(API, arquivo));
  const res = { code: 200 }; res.status = (c) => { res.code = c; return res; }; res.json = () => res;
  externos = 0;
  await handler({ method, headers, query, body: method === 'POST' ? { days: {} } : undefined }, res);
  return { code: res.code, externos };
}

test('sem ANK_ACCESS_KEY configurada a rota segue aberta (transição)', async () => {
  const r = await chamar('state.js');
  assert.notStrictEqual(r.code, 401); assert.ok(r.externos > 0);
});

for (const arq of ['state.js', 'edit-schedule.js', 'interpret-constraints.js']) {
  test(`${arq}: sem chave ou com chave errada → 401 sem tocar no banco/IA`, async () => {
    for (const h of [{}, { 'x-ank-key': 'errada' }]) {
      const r = await chamar(arq, { chave: 'segredo-de-teste-123', method: 'POST', headers: h });
      assert.strictEqual(r.code, 401); assert.strictEqual(r.externos, 0);
    }
  });
}

test('chave certa no header passa (GET e POST)', async () => {
  for (const method of ['GET', 'POST']) {
    const r = await chamar('state.js', { chave: 'segredo-de-teste-123', method, headers: { 'x-ank-key': 'segredo-de-teste-123' } });
    assert.notStrictEqual(r.code, 401); assert.ok(r.externos > 0);
  }
});

test('chave certa em ?k= (sendBeacon) passa', async () => {
  const r = await chamar('state.js', { chave: 'segredo-de-teste-123', method: 'POST', query: { k: 'segredo-de-teste-123' } });
  assert.notStrictEqual(r.code, 401);
});
