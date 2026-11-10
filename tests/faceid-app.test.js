// 10/11/2026 — lado do app: sessão do Face ID nas chamadas, tela de entrada, e conflito → fica a versão do servidor.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadApp, freshState } = require('./harness');
const { mergeStates, stable } = require('../api/_merge.js');
const F = (x) => JSON.parse(JSON.stringify(x));
const R = (a, c) => vm.runInContext(c, a);

function servidor(seed) {
  const srv = { raw: JSON.stringify(seed), posts: 0, headers: [] };
  srv.fetch = async (url, opts = {}) => {
    srv.headers.push(opts.headers || {});
    const resp = (status, body) => ({ status, ok: status < 300, json: async () => body });
    if (opts.method !== 'POST') return resp(200, String(url).includes('versions') ? { versions: [] } : { state: JSON.parse(srv.raw) });
    srv.posts++;
    const body = JSON.parse(opts.body), cur = JSON.parse(srv.raw), m = mergeStates(cur, body), behind = stable(m) !== stable(body);
    srv.raw = JSON.stringify(m);
    return resp(behind ? 409 : 200, behind ? { state: m } : { ok: true });
  };
  return srv;
}
function semente() {
  const a = loadApp(freshState(loadApp()));
  a.generateRange('2026-11-16', '2026-11-22');
  const st = a.__get(); ['2026-11-16', '2026-11-17'].forEach((k) => { st.days[k].conf = { ...st.days[k].draft, at: 1000 }; st.days[k].draft = null; });
  st._updatedAt = 1000; st._cfgAt = 1000; return F(st);
}
function abrir(srv, local) { const a = loadApp(F(local)); a.showTab = () => {}; a.toasts = []; a.toast = (m) => a.toasts.push(m); a.fetch = srv.fetch; return a; }

test('cópia antiga diferente (ex.: Safari) na 1ª abertura → fica com a do servidor, avisa, guarda a cópia, não grava', async () => {
  const seed = semente(), srv = servidor(seed);
  const velho = F(seed); velho.team[0].name = 'Nome Antigo'; velho.days['2026-11-11'] = { conf: null, draft: F(seed.days['2026-11-18'].draft) }; velho._cfgAt = 500; velho._updatedAt = 500;
  const a = abrir(srv, velho);
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(R(a, 'SYNC').st, 'salvo');
  assert.strictEqual(srv.posts, 0);
  assert.strictEqual(a.__get().team[0].name, seed.team[0].name);
  assert.ok(!a.__get().days['2026-11-11']);
  assert.match(a.toasts.join(' '), /Fiquei com a do servidor/);
  assert.strictEqual(JSON.parse(a.localStorage.getItem('ank_sync_remoto')).local.team[0].name, 'Nome Antigo', 'cópia do aparelho guardada');
});
test('conflito que ficou gravado no aparelho (versão anterior) → ao abrir, resolve ficando com o servidor', async () => {
  const seed = semente(), srv = servidor(seed);
  const velho = F(seed); velho.team[0].name = 'Outro'; velho._cfgAt = 1;
  const a = abrir(srv, velho);
  a.localStorage.setItem('ank_sync_v1', JSON.stringify({ st: 'conflito', err: 'x', known: 'abc' })); R(a, 'SYNC=loadSync()');
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(R(a, 'SYNC').st, 'salvo');
  assert.strictEqual(a.__get().team[0].name, seed.team[0].name);
});
test('gravação que a junção descartaria (outro aparelho mudou a configuração depois) → fica com o servidor', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  await a.syncStateFromServerOnLoad();
  const st = JSON.parse(srv.raw); st.team[1].name = 'Mudado no outro'; st._cfgAt = Date.now() + 60000; st._updatedAt = Date.now() + 60000; srv.raw = JSON.stringify(st);
  a.__get().team[2].name = 'Mudado aqui'; a.saveState();
  await a.syncNow();
  assert.strictEqual(R(a, 'SYNC').st, 'salvo');
  assert.strictEqual(a.__get().team[1].name, 'Mudado no outro');
});
test('chamadas levam a sessão do Face ID; 401 abre a tela de entrada e esquece a sessão', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  R(a, "AUTH.token='tok-123'");
  await a.apiFetch('/api/state');
  const h = srv.headers.pop();
  assert.strictEqual(h['X-ANK-Session'], 'tok-123'); assert.ok(!h['X-ANK-Key']);
  a.fetch = async () => ({ status: 401, ok: false, json: async () => ({}) });
  R(a, 'lockShow=function(){ AUTH.token=null; }');
  await a.apiFetch('/api/state');
  assert.strictEqual(R(a, 'AUTH.token'), null);
});
test('sincronização só começa depois de entrar (authDone), e uma vez só', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  R(a, 'syncStateFromServerOnLoad=function(){ globalThis.__n=(globalThis.__n||0)+1; }');
  a.authDone('t1'); a.authDone('t2');
  assert.strictEqual(R(a, 'globalThis.__n'), 1);
  assert.strictEqual(R(a, 'AUTH.token'), 't2');
});
test('a chave antiga não é mais enviada nem guardada', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', require('fs').existsSync(require('path').join(__dirname, '..', 'index.html')) ? 'index.html' : 'gerador-escala-ank.html'), 'utf8');
  assert.ok(!/X-ANK-Key/.test(src)); assert.match(src, /localStorage\.removeItem\('ank_escala_key'\)/);
});
