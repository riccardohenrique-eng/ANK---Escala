// Etapa 12B.4 (08/11/2026) — verificação de compatibilidade da 1ª abertura após atualizar. Dados fictícios, servidor falso
// com a junção real. (A lacuna D3 foi corrigida na 12B.5; o servidor falso daqui NÃO tem histórico de versões.)
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const H = require('./harness');
// 10/11/2026: o app passou a ficar com o servidor no conflito (CONFLICT_POLICY='servidor'). Estes testes continuam
// conferindo o modo anterior ("parar e guardar as duas cópias"), que segue no código como CONFLICT_POLICY='parar'.
const loadApp = (...a) => { const x = H.loadApp(...a); require('vm').runInContext("CONFLICT_POLICY='parar'", x); return x; };
const { freshState } = H;
const { mergeStates, stable } = require('../api/_merge.js');
const F = (x) => JSON.parse(JSON.stringify(x));
function servidor(seed) {
  const srv = { raw: JSON.stringify(seed), modo: 'ok', posts: 0 };
  srv.fetch = async (url, opts = {}) => {
    const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    if (srv.modo === 'rede') throw new TypeError('Failed to fetch');
    if (opts.method !== 'POST') return resp(200, { state: JSON.parse(srv.raw) });
    srv.posts++;
    const body = JSON.parse(opts.body), cur = JSON.parse(srv.raw), m = mergeStates(cur, body), behind = stable(m) !== stable(body);
    if (stable(m) !== stable(cur)) srv.raw = JSON.stringify(m);
    return resp(behind ? 409 : 200, behind ? { error: 'x', state: m } : { ok: true });
  };
  return srv;
}
function semente() {
  const a = loadApp(freshState(loadApp()));
  a.generateRange('2026-11-09', '2026-11-15');
  const st = a.__get();
  for (const k of ['2026-11-09', '2026-11-10', '2026-11-11']) { st.days[k].conf = { ...st.days[k].draft, at: 1000 }; st.days[k].draft = null; }
  st._updatedAt = 1000; st._cfgAt = 1000;
  return F(st);
}
function abrir(srv, estado) { const a = loadApp(F(estado)); a.showTab = () => {}; a.toasts = []; a.toast = (m) => { a.toasts.push(m); }; a.fetch = srv.fetch; return a; }
const S = (a) => vm.runInContext('SYNC', a);

test('12B.4/12B.5 D3: confirmação só deste aparelho, mais antiga e DIFERENTE da do servidor, não é trocada em silêncio (conflito)',
  async () => {
    const seed = semente(), srv = servidor(seed);
    const loc = F(seed); const c = loc.days['2026-11-11'].conf; const id = Object.keys(c.sh).find((i) => c.sh[i].type !== 'folga');
    c.sh[id] = { ...c.sh[id], type: 'folga', time: null }; c.at = 1500;            // confirmação feita só aqui (nunca enviada)
    const r = JSON.parse(srv.raw); r.days['2026-11-11'].conf.at = 2000; srv.raw = JSON.stringify(r);   // servidor: mesmo dia, confirmado depois, sem a troca
    const a = abrir(srv, loc); await a.syncStateFromServerOnLoad();
    assert.strictEqual(a.__get().days['2026-11-11'].conf.sh[id].type, 'folga', 'confirmação local preservada');
    assert.strictEqual(S(a).st, 'conflito');
  });

test('12B.4 B/H sem histórico disponível: aparelho desatualizado na 1ª abertura → conflito (conservador), nada gravado', async () => {
  const seed = semente(), srv = servidor(seed);
  const r = JSON.parse(srv.raw); r.constraints.push({ type: 'absence', empId: r.team[1].id, dateStart: '2026-11-14', dateEnd: '2026-11-14' }); r._cfgAt = 3000; r._updatedAt = 3000; srv.raw = JSON.stringify(r);
  const antes = srv.raw, a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); assert.strictEqual(srv.posts, 0); assert.strictEqual(srv.raw, antes);
});

test('12B.4: depois da 1ª abertura (com referência), aparelho desatualizado sem nada próprio reabre sem conflito e adota o servidor', async () => {
  const seed = semente(), srv = servidor(seed);
  const mac = abrir(srv, seed); await mac.syncStateFromServerOnLoad(); assert.strictEqual(S(mac).st, 'salvo');
  const guardado = { st: JSON.stringify(mac.__get()), sync: mac.localStorage.getItem('ank_sync_v1') };
  const iph = abrir(srv, seed); await iph.syncStateFromServerOnLoad();
  iph.__get().rates.weekday = 91; iph.saveState(); assert.strictEqual(await iph.syncNow(), 'salvo');
  const m2 = abrir(srv, JSON.parse(guardado.st)); m2.localStorage.setItem('ank_sync_v1', guardado.sync); vm.runInContext('SYNC=loadSync()', m2);
  await m2.syncStateFromServerOnLoad(); await m2.syncNow();
  assert.strictEqual(S(m2).st, 'salvo', S(m2).err); assert.strictEqual(m2.__get().rates.weekday, 91);
});
