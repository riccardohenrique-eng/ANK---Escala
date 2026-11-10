// Etapa 12B.3 (08/11/2026) — correções R1, R1b, R2, R3, R4 da revisão 12B.2. Servidor FALSO com a junção real
// (api/_merge.js). Dados fictícios. Regra central: sem referência remota confiável o app só LÊ e compara; nunca grava às cegas.
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
  const srv = { raw: JSON.stringify(seed), modo: 'ok', posts: 0, gets: 0, holdGet: null, corpo200: undefined, corpoGet: undefined, corpo409: undefined };
  srv.fetch = async (url, opts = {}) => {
    const resp = (status, body, quebrado) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (quebrado) throw new SyntaxError('Unexpected end of JSON'); return body; } });
    if (srv.modo === 'rede') throw new TypeError('Failed to fetch');
    if (opts.method !== 'POST') {
      srv.gets++; if (srv.holdGet) await srv.holdGet;
      if (srv.corpoGet !== undefined) return resp(200, srv.corpoGet === 'QUEBRADO' ? null : srv.corpoGet, srv.corpoGet === 'QUEBRADO');
      return resp(200, { state: JSON.parse(srv.raw) });
    }
    srv.posts++;
    const body = JSON.parse(opts.body), cur = JSON.parse(srv.raw);
    if (cur === null) { srv.raw = JSON.stringify(body); return resp(200, { ok: true }); }
    const m = mergeStates(cur, body), ms = stable(m), behind = ms !== stable(body);
    if (ms !== stable(cur)) srv.raw = JSON.stringify(m);
    if (!behind && srv.corpo200 !== undefined) return resp(200, srv.corpo200 === 'QUEBRADO' ? null : srv.corpo200, srv.corpo200 === 'QUEBRADO');
    if (behind && srv.corpo409 !== undefined) return resp(409, srv.corpo409);
    return resp(behind ? 409 : 200, behind ? { error: 'aparelho desatualizado', state: m } : { ok: true });
  };
  srv.get = () => JSON.parse(srv.raw);
  return srv;
}
function semente() {
  const a = loadApp(freshState(loadApp()));
  a.generateRange('2026-11-09', '2026-11-15');
  const st = a.__get();
  for (const k of ['2026-11-09', '2026-11-10', '2026-11-11']) { st.days[k].conf = { ...st.days[k].draft, at: 1000 }; st.days[k].draft = null; }
  st.diaristaPool = ['D1', 'D2']; st._updatedAt = 1000; st._cfgAt = 1000;
  return F(st);
}
function abrir(srv, estadoLocal) {   // aparelho com estado local e SEM referência (como a 1ª abertura nesta versão)
  const a = loadApp(estadoLocal ? F(estadoLocal) : undefined);
  a.showTab = () => {}; a.toasts = []; a.toast = (m) => { a.toasts.push(m); };
  a.fetch = srv.fetch;
  return a;
}
const S = (a) => vm.runInContext('SYNC', a);
function reabrir(srv, estado, syncJson) {   // "fechar e abrir de novo" com o que ficou guardado no aparelho
  const a = abrir(srv, estado); a.localStorage.setItem('ank_sync_v1', syncJson); vm.runInContext('SYNC=loadSync()', a); return a;
}
const local = (a) => JSON.parse(a.localStorage.getItem('ank_escala_v1'));
const copia = (a) => JSON.parse(a.localStorage.getItem('ank_sync_remoto') || 'null');
const outroAparelho = (srv, fn) => { const st = srv.get(); fn(st); srv.raw = JSON.stringify(st); };

test('1ª abertura sem referência, aparelho igual ao servidor: só lê (0 POST) e passa a "Salvo no servidor"', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  assert.strictEqual(S(a).known, null);
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(srv.posts, 0); assert.strictEqual(S(a).st, 'salvo'); assert.ok(S(a).known);
  assert.match(a.syncText(), /^Salvo no servidor/);
});

test('fluxo normal de um aparelho: referência → editar → gravar → "Salvo"', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  await a.syncStateFromServerOnLoad();
  a.__get().diaristaPool = ['D1', 'D2', 'D9']; a.saveState();
  assert.strictEqual(S(a).st, 'pendente');
  assert.strictEqual(await a.syncNow(), 'salvo');
  assert.deepStrictEqual(F(srv.get().diaristaPool), ['D1', 'D2', 'D9']);
});

test('R1b: outro aparelho mudou o servidor; este (sem referência) tem versão diferente → conflito, NADA gravado, as duas cópias guardadas', async () => {
  const seed = semente(), srv = servidor(seed);
  outroAparelho(srv, (st) => { st.rates.weekday = 777; st._cfgAt = 5000; st._updatedAt = 5000; });
  const antes = srv.raw, a = abrir(srv, seed);
  a.__get().diaristaPool = ['D1', 'LOCAL']; a.saveState();   // alteração deste aparelho (sem referência)
  await new Promise((r) => setTimeout(r, 450));   // (o envio adiado só agenda a comparação; stub não roda)
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(srv.posts, 0, 'nenhum POST'); assert.strictEqual(srv.raw, antes, 'servidor intacto (777 preservado)');
  assert.strictEqual(S(a).st, 'conflito');
  assert.deepStrictEqual(F(local(a).diaristaPool), ['D1', 'LOCAL'], 'versão local preservada');
  assert.strictEqual(local(a).rates.weekday, seed.rates.weekday, 'nada do servidor foi enfiado no local');
  const cp = copia(a); assert.strictEqual(cp.remoto.rates.weekday, 777); assert.deepStrictEqual(F(cp.local.diaristaPool), ['D1', 'LOCAL']);
  assert.ok(cp.itens.some((x) => /configuração/.test(x)));
  assert.match(a.syncAlert()[1], /Conflito entre aparelhos/);
});

test('R1: 1ª gravação falha, reabre com rede: não reenvia às cegas; conflito, servidor e local preservados', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  srv.modo = 'rede'; await a.syncStateFromServerOnLoad(); assert.strictEqual(S(a).st, 'falha');
  a.__get().diaristaPool = ['D1', 'T']; a.saveState();
  assert.strictEqual(S(a).st, 'falha', 'continua pausado'); assert.strictEqual(S(a).known, null);
  assert.strictEqual(a.syncAlert()[2], 'Tentar agora', '"Tentar agora" faz só a comparação (leitura)');
  srv.modo = 'ok'; const antes = srv.raw;
  const b2 = reabrir(srv, local(a), a.localStorage.getItem('ank_sync_v1'));
  assert.strictEqual(S(b2).st, 'falha', 'situação persistida ao reabrir');
  await b2.syncStateFromServerOnLoad();
  assert.strictEqual(srv.posts, 0); assert.strictEqual(srv.raw, antes);
  assert.strictEqual(S(b2).st, 'conflito'); assert.notStrictEqual(b2.syncText(), 'Salvo no servidor');
  assert.deepStrictEqual(F(b2.__get().diaristaPool), ['D1', 'T']);
});

test('"Tentar agora" sem referência: compara; se igual ao servidor vira "Salvo" sem POST', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  srv.modo = 'rede'; await a.syncStateFromServerOnLoad(); assert.strictEqual(S(a).st, 'falha');
  srv.modo = 'ok'; assert.strictEqual(await a.retryNow(), 'salvo'); assert.strictEqual(srv.posts, 0);
});

test('rascunho exclusivo deste aparelho (sem referência) → conflito, rascunho preservado; servidor intacto', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  const k = '2026-11-12'; const d = a.__get().days[k].draft; const id = Object.keys(d.sh)[0];
  d.sh[id] = { ...d.sh[id], type: 'folga', time: null, manual: true }; a.saveState();
  const antes = srv.raw; await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); assert.strictEqual(srv.raw, antes); assert.strictEqual(srv.posts, 0);
  assert.strictEqual(local(a).days[k].draft.sh[id].type, 'folga');
  assert.ok(copia(a).itens.some((x) => /rascunho de/.test(x)));
});

test('confirmação deste aparelho que o servidor não tem → conflito (não adota, não grava)', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  const st = a.__get(); st.days['2026-11-12'].conf = { ...st.days['2026-11-12'].draft, at: 2000 }; st.days['2026-11-12'].draft = null; a.saveState();
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); assert.strictEqual(srv.posts, 0);
  assert.ok(local(a).days['2026-11-12'].conf, 'confirmação local preservada');
});

test('servidor só tem confirmação MAIS NOVA/a mais (nada exclusivo daqui) → adota com aviso, sem POST, nada local perdido', async () => {
  const seed = semente(), srv = servidor(seed);
  outroAparelho(srv, (st) => { st.days['2026-11-12'].conf = { ...st.days['2026-11-12'].draft, at: 3000 }; st.days['2026-11-12'].draft = null; st.days['2026-11-09'].conf.at = 3000; st._updatedAt = 3000; });
  const a = abrir(srv, seed); a.__get().days['2026-11-12'].draft = null; a.saveState();   // mesmo rascunho que o servidor (nenhum)
  const remotoAntes = srv.raw; await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(srv.posts, 0); assert.strictEqual(srv.raw, remotoAntes);
  assert.strictEqual(local(a).days['2026-11-12'].conf.at, 3000); assert.strictEqual(local(a).days['2026-11-09'].conf.at, 3000);
  assert.ok(a.toasts.some((m) => /nada deste aparelho foi descartado/.test(m)));
});

test('diferenças só de representação (ordem das chaves, campo-padrão ausente, undefined) contam como iguais', async () => {
  const seed = semente(), srv = servidor(seed);
  const rev = (o) => Array.isArray(o) ? o.map(rev) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).reverse().map((k) => [k, rev(o[k])])) : o;
  const remoto = rev(F(seed)); delete remoto.taskDay; delete remoto.compDay; delete remoto.constraints; srv.raw = JSON.stringify(remoto);   // normalizeState repõe os padrões
  const a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(srv.posts, 0);
});
test('servidor em formato antigo (sem schema → migrações mudam a configuração) NÃO conta como igual → conflito', async () => {
  const seed = semente(), srv = servidor(seed); const remoto = F(seed); delete remoto.schema; srv.raw = JSON.stringify(remoto);
  const a = abrir(srv, seed); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); assert.strictEqual(srv.posts, 0);
});

test('mesma confirmação com carimbo diferente e conteúdo diferente, local mais novo → conflito (não decide sozinho)', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  const c = a.__get().days['2026-11-10'].conf; const id = Object.keys(c.sh)[0]; c.sh[id] = { ...c.sh[id], type: 'folga', time: null }; c.at = 1500; a.saveState();
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); assert.strictEqual(srv.posts, 0);
  assert.strictEqual(srv.get().days['2026-11-10'].conf.at, 1000, 'servidor intacto');
});

test('aparelho novo (vazio): adota o servidor, sem POST', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv);
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(srv.posts, 0);
  assert.strictEqual(Object.values(local(a).days).filter((d) => d.conf).length, 3);
});

test('servidor vazio (null) e aparelho com dados: nada a sobrescrever → grava e fica "Salvo"', async () => {
  const seed = semente(), srv = servidor(null), a = abrir(srv, seed);
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'salvo'); assert.strictEqual(srv.posts, 1);
  assert.deepStrictEqual(F(srv.get().diaristaPool), ['D1', 'D2']);
});

test('R2: edição durante o carregamento inicial NÃO é substituída pelo servidor (aparelho novo)', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv);
  let solta; srv.holdGet = new Promise((r) => { solta = r; });
  const p = a.syncStateFromServerOnLoad();
  a.__get().diaristaPool = ['EDITADO']; a.saveState();   // usuário edita enquanto o GET não volta
  solta(); await p;
  assert.deepStrictEqual(F(a.__get().diaristaPool), ['EDITADO'], 'edição continua na tela');
  assert.deepStrictEqual(F(local(a).diaristaPool), ['EDITADO'], 'e guardada no aparelho');
  assert.strictEqual(srv.posts, 0); assert.deepStrictEqual(F(srv.get().diaristaPool), ['D1', 'D2'], 'servidor intacto');
  assert.strictEqual(S(a).st, 'conflito');
});

test('R2: edição durante o carregamento (aparelho com dados): idem, nenhuma das versões é trocada', async () => {
  const seed = semente(), srv = servidor(seed); outroAparelho(srv, (st) => { st.rates.weekday = 555; st._cfgAt = 4000; });
  const a = abrir(srv, seed); let solta; srv.holdGet = new Promise((r) => { solta = r; });
  const p = a.syncStateFromServerOnLoad(); a.__get().diaristaPool = ['X']; a.saveState(); solta(); await p;
  assert.deepStrictEqual(F(local(a).diaristaPool), ['X']); assert.strictEqual(srv.get().rates.weekday, 555); assert.strictEqual(srv.posts, 0);
});

test('R3: armazenamento local falhou → nunca diz "Salvo só neste aparelho"; avisa que pode perder ao fechar; memória preservada', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  await a.syncStateFromServerOnLoad();
  const orig = a.localStorage.setItem;
  a.localStorage.setItem = (k, v) => { if (k === 'ank_escala_v1') throw new Error('QuotaExceededError'); return orig(k, v); };
  srv.modo = 'rede';
  a.__get().diaristaPool = ['MEM']; a.saveState();
  for (const st of ['pendente', 'falha']) {
    if (st === 'falha') await a.syncNow();
    assert.strictEqual(S(a).st, st);
    assert.doesNotMatch(a.syncText(), /Salvo só neste aparelho|guardadas neste aparelho/);
    assert.match(a.syncText(), /NÃO foi possível guardar neste aparelho|não foi possível guardar neste aparelho; se fechar o app/i);
    assert.strictEqual(a.syncAlert()[0], 'red'); assert.doesNotMatch(a.syncAlert()[1], /estão guardadas aqui/);
  }
  assert.deepStrictEqual(F(a.__get().diaristaPool), ['MEM'], 'alteração continua em memória');
  srv.modo = 'ok'; assert.strictEqual(await a.retryNow(), 'salvo');
  assert.match(a.syncText(), /Salvo no servidor.*não foi possível guardar neste aparelho/);
});

for (const [nome, corpo] of [['vazio/inválido (JSON quebrado)', 'QUEBRADO'], ['objeto vazio', {}], ['null', null], ['ok:false', { ok: false }], ['erro disfarçado', { error: 'falhou' }], ['ok:"true" (texto)', { ok: 'true' }]]) {
  test(`R4: POST 200 com corpo ${nome} NÃO conta como salvo`, async () => {
    const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
    await a.syncStateFromServerOnLoad(); const known = S(a).known;
    srv.corpo200 = corpo; a.__get().diaristaPool = ['R4']; a.saveState();
    assert.strictEqual(await a.syncNow(), 'falha');
    assert.strictEqual(S(a).st, 'falha'); assert.match(S(a).err, /resposta inesperada/);
    assert.strictEqual(S(a).known, known, 'referência não avança');
    assert.doesNotMatch(a.syncText(), /^Salvo no servidor/);
    assert.deepStrictEqual(F(local(a).diaristaPool), ['R4']);
  });
}
test('R4: 409 sem estado válido (sem days) → falha, não adota', async () => {
  const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
  await a.syncStateFromServerOnLoad();
  outroAparelho(srv, (st) => { st.days['2026-11-12'].conf = { ...st.days['2026-11-12'].draft, at: 9000 }; });
  srv.corpo409 = { state: { team: [] } }; a.__get().diaristaPool = ['Y']; a.saveState();
  assert.strictEqual(await a.syncNow(), 'falha'); assert.deepStrictEqual(F(a.__get().diaristaPool), ['Y']);
});
for (const [nome, corpo] of [['sem "state"', { ok: true }], ['JSON quebrado', 'QUEBRADO'], ['state texto', { state: 'x' }]]) {
  test(`R4: GET da comparação com corpo ${nome} → falha, nada adotado nem gravado`, async () => {
    const seed = semente(), srv = servidor(seed), a = abrir(srv, seed);
    srv.corpoGet = corpo; await a.syncStateFromServerOnLoad();
    assert.strictEqual(S(a).st, 'falha'); assert.strictEqual(srv.posts, 0); assert.strictEqual(S(a).known, null);
  });
}

test('compatibilidade: estado salvo pela 12B com falha e sem referência é tratado pela comparação (não reenvia)', async () => {
  const seed = semente(), srv = servidor(seed);
  const a = reabrir(srv, seed, JSON.stringify({ st: 'falha', since: 1, err: 'sem conexão com o servidor', known: null }));
  assert.strictEqual(S(a).st, 'falha');
  await a.syncStateFromServerOnLoad();
  assert.strictEqual(srv.posts, 0); assert.strictEqual(S(a).st, 'salvo', 'igual ao servidor → referência estabelecida');
});

test('conflito persistido: reabrir não compara de novo nem grava; "Tentar agora" também não', async () => {
  const seed = semente(), srv = servidor(seed); outroAparelho(srv, (st) => { st.rates.weekday = 1; st._cfgAt = 9; });
  const a = abrir(srv, seed); a.__get().diaristaPool = ['Z']; a.saveState(); await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'conflito'); const gets = srv.gets, cp = a.localStorage.getItem('ank_sync_remoto');
  await a.syncStateFromServerOnLoad(); assert.strictEqual(await a.retryNow(), 'conflito'); assert.strictEqual(await a.syncNow(), 'bloqueado');
  assert.strictEqual(srv.gets, gets); assert.strictEqual(srv.posts, 0); assert.strictEqual(a.localStorage.getItem('ank_sync_remoto'), cp);
});

test('aviso ao fechar só quando há alteração apenas em memória', () => {
  const fs = require('fs'), path = require('path');
  const arq = ['index.html', 'gerador-escala-ank.html'].map((f) => path.join(__dirname, '..', f)).find((f) => fs.existsSync(f));   // repo: index.html
  const src = fs.readFileSync(arq, 'utf8');
  assert.match(src, /addEventListener\('beforeunload',e=>\{ if\(!localSaveOk&&SYNC\.st!=='salvo'\)/);
});
