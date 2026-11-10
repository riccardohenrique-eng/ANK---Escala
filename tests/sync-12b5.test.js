// Etapa 12B.5 (08/11/2026) — D3 e aparelhos só desatualizados na 1ª abertura. Servidor FALSO com a junção real
// (api/_merge.js) e o histórico de versões igual ao da API (LPUSH do estado anterior a cada mudança, 30 últimas;
// GET ?versions=1 e ?version=N). Dados fictícios.
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
  const srv = { raw: JSON.stringify(seed), bak: [], posts: 0, gets: 0, modo: 'ok', modoHist: 'ok', holdHist: null };
  const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (body === 'QUEBRADO') throw new SyntaxError('x'); return body; } });
  srv.fetch = async (url, opts = {}) => {
    if (srv.modo === 'rede') throw new TypeError('Failed to fetch');
    if (opts.method !== 'POST') {
      srv.gets++;
      if (/versions=1/.test(url) || /version=\d+/.test(url)) {
        if (srv.holdHist) await srv.holdHist;
        if (srv.modoHist === 'rede') throw new TypeError('Failed to fetch');
        if (srv.modoHist === '500') return resp(500, { error: 'x' });
        if (srv.modoHist === 'quebrado') return resp(200, 'QUEBRADO');
        if (/versions=1/.test(url)) return resp(200, srv.modoHist === 'semlista' ? { ok: true } : { versions: srv.bak.map((r, i) => ({ i })) });
        const i = +url.match(/version=(\d+)/)[1];
        if (srv.modoHist === 'versaoFalha' && i > 0) return resp(500, { error: 'x' });
        return resp(200, { state: srv.bak[i] ? JSON.parse(srv.bak[i]) : null });
      }
      return resp(200, { state: JSON.parse(srv.raw) });
    }
    srv.posts++;
    const body = JSON.parse(opts.body), cur = JSON.parse(srv.raw), m = mergeStates(cur, body), behind = stable(m) !== stable(body);
    if (stable(m) !== stable(cur)) { srv.bak.unshift(srv.raw); srv.bak = srv.bak.slice(0, 30); srv.raw = JSON.stringify(m); }
    return resp(behind ? 409 : 200, behind ? { error: 'x', state: m } : { ok: true });
  };
  srv.get = () => JSON.parse(srv.raw);
  // outro aparelho grava (como a versão no ar: POST do estado inteiro → junção → histórico)
  srv.outro = async (fn, t) => { const st = srv.get(); fn(st); st._updatedAt = t; if (st.__cfg) { st._cfgAt = t; delete st.__cfg; } return srv.fetch('/api/state', { method: 'POST', body: JSON.stringify(st) }); };
  return srv;
}
function semente() {
  const a = loadApp(freshState(loadApp()));
  a.generateRange('2026-11-09', '2026-11-22');
  const st = a.__get();
  for (const k of ['2026-11-09', '2026-11-10', '2026-11-11']) { st.days[k].conf = { ...st.days[k].draft, at: 1000 }; st.days[k].draft = null; }
  st.diaristaPool = ['D1', 'D2']; st._updatedAt = 1000; st._cfgAt = 1000;
  return F(st);
}
function abrir(srv, estado) { const a = loadApp(estado ? F(estado) : undefined); a.showTab = () => {}; a.toasts = []; a.toast = (m) => { a.toasts.push(m); }; a.fetch = srv.fetch; return a; }
const S = (a) => vm.runInContext('SYNC', a);
const copia = (a) => JSON.parse(a.localStorage.getItem('ank_sync_remoto') || 'null');
const confirmar = (st, k, at) => { st.days[k].conf = { ...st.days[k].draft, at }; st.days[k].draft = null; };
const trocar = (c) => { const id = Object.keys(c.sh).find((i) => c.sh[i].type !== 'folga'); c.sh[id] = { ...c.sh[id], type: 'folga', time: null }; return id; };

// ---------- D3 ----------
test('D3: confirmação local (sem internet) e outra remota, diferentes, para o mesmo dia → conflito; nada some, nada é enviado, nada de "Salvo"', async () => {
  const seed = semente(), srv = servidor(seed);
  const loc = F(seed); confirmar(loc, '2026-11-12', 1500); const id = trocar(loc.days['2026-11-12'].conf); loc._updatedAt = 1500;
  await srv.outro((st) => confirmar(st, '2026-11-12', 2000), 2000);
  const antes = srv.raw, a = abrir(srv, loc); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); assert.strictEqual(srv.posts, 1, 'só a gravação do outro aparelho'); assert.strictEqual(srv.raw, antes);
  assert.strictEqual(a.__get().days['2026-11-12'].conf.sh[id].type, 'folga', 'confirmação local intacta');
  assert.notStrictEqual(srv.get().days['2026-11-12'].conf.sh[id].type, 'folga', 'confirmação remota intacta');
  assert.doesNotMatch(a.syncText(), /^Salvo no servidor/);
  assert.ok(copia(a).itens.some((x) => /confirmação de 12\/11/.test(x)));
  assert.strictEqual(await a.syncNow(), 'bloqueado');
});

test('D3 variante: confirmação local com histórico de mudança (log) que o servidor não tem → conflito', async () => {
  const seed = semente(), srv = servidor(seed);
  const loc = F(seed); loc.days['2026-11-10'].conf.log = [{ at: 1200, ch: [['x', 'abertura', 'folga']], motivo: 'pedido' }]; loc.days['2026-11-10'].conf.at = 1200;
  const r = srv.get(); r.days['2026-11-10'].conf.at = 3000; srv.raw = JSON.stringify(r);
  const a = abrir(srv, loc); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito');
});

test('confirmações equivalentes: servidor tem a MESMA escala, só com marca de envio/carimbo mais novos → adota, "Salvo", nada perdido', async () => {
  const seed = semente(), srv = servidor(seed);
  const r = srv.get(); const c = r.days['2026-11-10'].conf; c.sent = { at: 5000, sig: 's', snap: {} }; c.at = 5000; srv.raw = JSON.stringify(r);
  const a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(srv.posts, 0);
  assert.strictEqual(a.__get().days['2026-11-10'].conf.sent.at, 5000);
  assert.deepStrictEqual(F(a.__get().days['2026-11-10'].conf.sh), F(seed.days['2026-11-10'].conf.sh));
});

test('marca de envio local mais nova que a do servidor não é descartada → conflito', async () => {
  const seed = semente(), srv = servidor(seed);
  const loc = F(seed); loc.days['2026-11-10'].conf.sent = { at: 4000, sig: 'a', snap: {} };
  const r = srv.get(); r.days['2026-11-10'].conf.at = 6000; r.days['2026-11-10'].conf.sent = { at: 3000, sig: 'b', snap: {} }; srv.raw = JSON.stringify(r);
  const a = abrir(srv, loc); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito');
});

// ---------- aparelhos só desatualizados (histórico) ----------
test('aparelho igual ao servidor → "Salvo", sem ler o histórico, sem POST', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(srv.gets, 1); assert.strictEqual(srv.posts, 0);
});

test('aparelho sem dados → adota o servidor', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(Object.values(a.__get().days).filter((d) => d.conf).length, 3);
});

test('aparelho antigo SEM mudanças próprias (igual a uma versão anterior do servidor) → adota a atual com aviso discreto, sem POST', async () => {
  const seed = semente(), srv = servidor(seed);
  await srv.outro((st) => { st.constraints.push({ type: 'absence', empId: st.team[1].id, dateStart: '2026-11-18', dateEnd: '2026-11-18' }); st.__cfg = 1; }, 2000);
  const posts = srv.posts, a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(srv.posts, posts);
  assert.strictEqual(a.__get().constraints.length, 1, 'pegou o pedido do outro aparelho');
  assert.ok(a.toasts.some((m) => /estava desatualizado/.test(m)));
  // e continua gravando normalmente
  a.__get().diaristaPool = ['D1', 'D2', 'N']; a.saveState(); assert.strictEqual(await a.syncNow(), 'salvo');
});

test('aparelho vários dias sem abrir (muitas gravações depois, dentro das 30 versões) → adota sem conflito', async () => {
  const seed = semente(), srv = servidor(seed); let t = 2000;
  for (const k of ['2026-11-12', '2026-11-13', '2026-11-14']) await srv.outro((st) => confirmar(st, k, t), t += 10);
  await srv.outro((st) => { st.rates.weekday = 99; st.__cfg = 1; }, t += 10);
  await srv.outro((st) => { const d = st.days['2026-11-16'].draft; trocar(d); }, t += 10);
  for (let i = 0; i < 10; i++) await srv.outro((st) => { st.diaristaPool = ['D1', 'D2', 'X' + i]; st.__cfg = 1; }, t += 10);
  const a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(a.__get().rates.weekday, 99); assert.strictEqual(Object.values(a.__get().days).filter((d) => d.conf).length, 6);
});

test('aparelho parado além das 30 versões guardadas → histórico não cobre → conflito (conservador)', async () => {
  const seed = semente(), srv = servidor(seed); let t = 2000;
  for (let i = 0; i < 31; i++) await srv.outro((st) => { st.diaristaPool = ['D1', 'D2', 'Y' + i]; st.__cfg = 1; }, t += 10);
  const a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); assert.deepStrictEqual(F(a.__get().diaristaPool), ['D1', 'D2']);
});

for (const [nome, mexe] of [
  ['pedido pendente', (st) => { st.constraints.push({ type: 'absence', empId: st.team[2].id, dateStart: '2026-11-20', dateEnd: '2026-11-20' }); }],
  ['rascunho pendente', (st) => { trocar(st.days['2026-11-15'].draft); }],
  ['regra e valor alterados', (st) => { st.rates.weekday = 61; st.sunRule = 'mes'; }],
  ['funcionária alterada', (st) => { st.team[0].name = 'Nome Novo'; }],
]) {
  test(`aparelho com ${nome} (feito sem internet, nunca enviado) + servidor mudou → conflito, mesmo com histórico disponível`, async () => {
    const seed = semente(), srv = servidor(seed);
    const loc = F(seed); mexe(loc); loc._updatedAt = 1500; loc._cfgAt = 1500;
    await srv.outro((st) => { st.diaristaPool = ['D1', 'D2', 'OUTRO']; st.__cfg = 1; }, 2000);
    const antes = srv.raw, a = abrir(srv, loc); await a.syncStateFromServerOnLoad();
    assert.strictEqual(S(a).st, 'conflito'); assert.strictEqual(srv.raw, antes);
    assert.strictEqual(stable(F(a.__get()).days), stable(F(loc).days)); assert.strictEqual(stable(F(a.__get()).constraints), stable(loc.constraints));
    assert.strictEqual(a.__get().rates.weekday, loc.rates.weekday);
  });
}

test('alteração local que VOLTA a um valor antigo (igual a uma versão passada, mas editada depois) → conflito (carimbo não bate)', async () => {
  const seed = semente(), srv = servidor(seed);
  await srv.outro((st) => { st.rates.weekday = 81; st.__cfg = 1; }, 2000);   // versão 0 do histórico = seed (80)
  const loc = F(srv.get()); loc.rates.weekday = seed.rates.weekday; loc._updatedAt = 2500; loc._cfgAt = 2500;   // aparelho voltou a 80 sem internet
  await srv.outro((st) => { st.diaristaPool = ['D1', 'D2', 'Z']; st.__cfg = 1; }, 3000);
  const a = abrir(srv, loc); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); assert.strictEqual(a.__get().rates.weekday, seed.rates.weekday);
});

for (const modo of ['rede', '500', 'quebrado', 'semlista', 'versaoFalha']) {
  test(`histórico indisponível/incompleto (${modo}) → não resolve: conflito, as duas cópias guardadas`, async () => {
    const seed = semente(), srv = servidor(seed);
    for (let i = 0; i < 2; i++) await srv.outro((st) => { st.diaristaPool = ['D1', 'D2', 'W' + i]; st.__cfg = 1; }, 2000 + i);
    srv.modoHist = modo;
    const loc = modo === 'versaoFalha' ? seed : seed;   // seed = versão 1 do histórico (a 0 falha só no modo versaoFalha)
    const a = abrir(srv, loc); await a.syncStateFromServerOnLoad();
    assert.strictEqual(S(a).st, 'conflito'); assert.ok(copia(a)); assert.strictEqual(srv.posts, 2);
  });
}

test('edição durante a conferência do histórico → não adota; conflito guarda a versão editada', async () => {
  const seed = semente(), srv = servidor(seed);
  await srv.outro((st) => { st.rates.weekday = 70; st.__cfg = 1; }, 2000);
  let solta; srv.holdHist = new Promise((r) => { solta = r; });
  const a = abrir(srv, seed); const p = a.syncStateFromServerOnLoad();
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  a.__get().diaristaPool = ['EDITADO']; a.saveState(); solta(); await p;
  assert.strictEqual(S(a).st, 'conflito'); assert.deepStrictEqual(F(a.__get().diaristaPool), ['EDITADO']);
  assert.deepStrictEqual(F(copia(a).local.diaristaPool), ['EDITADO']); assert.strictEqual(srv.get().rates.weekday, 70);
});

test('1ª gravação com falha e reabertura: alteração feita na falha não casa com o histórico → conflito, nada enviado', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  srv.modo = 'rede'; await a.syncStateFromServerOnLoad(); assert.strictEqual(S(a).st, 'falha');
  a.__get().diaristaPool = ['D1', 'F']; a.saveState(); srv.modo = 'ok';
  await srv.outro((st) => { st.rates.weekday = 71; st.__cfg = 1; }, 9e12);
  const b = abrir(srv, a.__get()); b.localStorage.setItem('ank_sync_v1', a.localStorage.getItem('ank_sync_v1')); vm.runInContext('SYNC=loadSync()', b);
  const posts = srv.posts; await b.syncStateFromServerOnLoad();
  assert.strictEqual(S(b).st, 'conflito'); assert.strictEqual(srv.posts, posts); assert.deepStrictEqual(F(b.__get().diaristaPool), ['D1', 'F']);
});

test('enquanto confere, o rodapé diz "Conferindo com o servidor…" (nunca "Salvo")', async () => {
  const seed = semente(), srv = servidor(seed); await srv.outro((st) => { st.rates.weekday = 72; st.__cfg = 1; }, 2000);
  let solta; srv.holdHist = new Promise((r) => { solta = r; });
  const a = abrir(srv, seed); const p = a.syncStateFromServerOnLoad();
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.match(a.syncText(), /^Conferindo com o servidor/); solta(); await p; assert.strictEqual(S(a).st, 'salvo');
});

test('fluxo normal de um aparelho continua: editar → gravar → reabrir', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  a.__get().rates.weekday = 85; a.saveState(); assert.strictEqual(await a.syncNow(), 'salvo');
  const b = abrir(srv, a.__get()); b.localStorage.setItem('ank_sync_v1', a.localStorage.getItem('ank_sync_v1')); vm.runInContext('SYNC=loadSync()', b);
  await b.syncStateFromServerOnLoad(); await b.syncNow(); assert.strictEqual(S(b).st, 'salvo'); assert.strictEqual(srv.get().rates.weekday, 85);
});
