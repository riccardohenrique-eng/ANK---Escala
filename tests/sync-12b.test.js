// Etapa 12B (08/11/2026) — salvamento no servidor: situação real, envio pausado após falha, conflito sem
// sobrescrita. Servidor FALSO com a mesma regra de junção do real (api/_merge.js). Dados fictícios.
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
  const srv = { raw: JSON.stringify(seed), modo: 'ok', posts: 0, gets: 0, hold: null };
  srv.fetch = async (url, opts = {}) => {
    const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    if (srv.modo === 'rede') throw new TypeError('Failed to fetch');
    if (srv.modo === 'tempo') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (srv.modo === '500') { if (opts.method === 'POST') srv.posts++; return resp(500, { error: 'x' }); }
    if (srv.modo === '401') return resp(401, { error: 'chave' });
    if (opts.method !== 'POST') { srv.gets++; return resp(200, { state: JSON.parse(srv.raw) }); }
    srv.posts++;
    if (srv.hold) await srv.hold;              // segura a resposta (fora de ordem)
    const body = JSON.parse(opts.body), cur = JSON.parse(srv.raw), m = mergeStates(cur, body), ms = stable(m), behind = ms !== stable(body);
    if (ms !== stable(cur)) srv.raw = JSON.stringify(m);
    return resp(behind ? 409 : 200, behind ? { state: m } : { ok: true });
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
// aparelho: app com o estado da semente e o servidor falso; já "sincronizado" uma vez (como ao abrir o app)
async function aparelho(srv, seed, { sincronizar = true } = {}) {
  const a = loadApp(F(seed));
  a.showTab = () => {}; a.toasts = []; a.toast = (m) => { a.toasts.push(m); };
  a.fetch = srv.fetch;
  if (sincronizar) { const r = await a.syncNow(); assert.strictEqual(r, 'salvo', 'base sincronizada'); }
  return a;
}
const S = (a) => vm.runInContext('SYNC', a);
const local = (a) => JSON.parse(a.localStorage.getItem('ank_escala_v1'));

test('1. gravação bem-sucedida: só então "Salvo no servidor"', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  a.__get().diaristaPool = ['D1', 'D2', 'D3']; a.saveState();
  assert.strictEqual(S(a).st, 'pendente', 'antes da resposta: só neste aparelho');
  assert.notStrictEqual(a.syncText(), 'Salvo no servidor');
  assert.strictEqual(await a.syncNow(), 'salvo');
  assert.deepStrictEqual(F(srv.get().diaristaPool), ['D1', 'D2', 'D3']);
  assert.match(a.syncText(), /^Salvo no servidor às \d\d:\d\d$/);
});

for (const [n, modo, st, re] of [['2', '500', 'falha', /recusou a gravação, código 500/], ['3', '401', 'chave', /entrar de novo com o Face ID/], ['4', 'rede', 'falha', /sem conexão/], ['5', 'tempo', 'falha', /não respondeu a tempo/]]) {
  test(`${n}/6/15. ${modo}: dado guardado no aparelho, servidor intacto, envio pausado, nenhuma mensagem de sucesso`, async () => {
    const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
    const antes = srv.raw;
    srv.modo = modo;
    a.__get().diaristaPool = ['D1', 'D2', 'NOVA']; a.saveState();
    assert.strictEqual(await a.syncNow(), st);
    assert.deepStrictEqual(F(local(a).diaristaPool), ['D1', 'D2', 'NOVA'], 'guardado no aparelho');
    assert.strictEqual(srv.raw, antes, 'servidor sem mudança');
    assert.match(a.syncText(), re); assert.ok(!/^Salvo no servidor/.test(a.syncText()));
    if (st === 'falha') assert.match(a.syncText(), /As alterações estão guardadas neste aparelho\./);
    srv.modo = 'ok'; const posts = srv.posts;
    a.__get().diaristaPool = ['D1', 'D2', 'NOVA', 'OUTRA']; a.saveState();
    assert.strictEqual(await a.syncNow(), 'bloqueado', 'sem reenvio automático');
    assert.strictEqual(srv.posts, posts);
    assert.ok(a.syncAlert(), 'aviso no Início');
    assert.ok(!a.toasts.some((t) => /^Salvo/.test(t)));
  });
}

test('7. fechar e reabrir com pendência: a situação persiste e nada é enviado sozinho', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  srv.modo = '500'; a.__get().diaristaPool = ['D1', 'NOVA']; a.saveState(); await a.syncNow();
  const sync = a.localStorage.getItem('ank_sync_v1'), estado = a.localStorage.getItem('ank_escala_v1');
  srv.modo = 'ok';
  const b = loadApp(JSON.parse(estado)); b.fetch = srv.fetch; b.toast = () => {};
  b.localStorage.setItem('ank_sync_v1', sync); vm.runInContext('SYNC=loadSync()', b);
  const posts = srv.posts;
  await b.syncStateFromServerOnLoad();
  assert.strictEqual(vm.runInContext('SYNC.st', b), 'falha');
  assert.strictEqual(srv.posts, posts, 'reabrir não reenvia às cegas');
  assert.deepStrictEqual(F(b.__get().diaristaPool), ['D1', 'NOVA']);
});

test('8/14. conexão volta e o servidor não mudou: "Tentar agora" confere e envia', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  srv.modo = 'rede'; a.__get().diaristaPool = ['D1', 'NOVA']; a.saveState(); await a.syncNow();
  srv.modo = 'ok';
  assert.strictEqual(await a.retryNow(), 'salvo');
  assert.deepStrictEqual(F(srv.get().diaristaPool), ['D1', 'NOVA']);
  assert.strictEqual(S(a).st, 'salvo');
});

test('13/14. outro aparelho gravou enquanto este estava em falha: "Tentar agora" NÃO envia; conflito com as duas cópias', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed), b = await aparelho(srv, seed);
  srv.modo = '500'; a.__get().diaristaPool = ['D1', 'NOVA-A']; a.saveState(); await a.syncNow();
  srv.modo = 'ok'; b.__get().rates.weekday = 120; b.saveState(); assert.strictEqual(await b.syncNow(), 'salvo');
  const remoto = srv.raw, posts = srv.posts;
  assert.strictEqual(await a.retryNow(), 'conflito');
  assert.strictEqual(srv.posts, posts, 'nenhuma gravação'); assert.strictEqual(srv.raw, remoto, 'servidor intacto (mudança de B preservada)');
  assert.deepStrictEqual(F(a.__get().diaristaPool), ['D1', 'NOVA-A'], 'cópia deste aparelho preservada');
  const copia = JSON.parse(a.localStorage.getItem('ank_sync_remoto'));
  assert.strictEqual(copia.remoto.rates.weekday, 120); assert.deepStrictEqual(copia.local.diaristaPool, ['D1', 'NOVA-A']);
  assert.match(a.syncAlert()[1], /^Conflito entre aparelhos: .*Nada foi sobrescrito/);
  assert.strictEqual(a.syncAlert()[2], '', 'sem botão de ação (resolver exige nova autorização)');
});

test('9. duas alterações rápidas: um envio por vez; a última versão é a que fica salva', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  let solta; srv.hold = new Promise((r) => { solta = r; });
  a.__get().diaristaPool = ['D1', 'X']; a.saveState(); const p1 = a.syncNow();
  await new Promise((r) => setTimeout(r, 5));               // edição humana: ms diferentes (empate no mesmo ms → ver teste 9b)
  a.__get().diaristaPool = ['D1', 'X', 'Y']; a.saveState();
  assert.strictEqual(await a.syncNow(), 'em-andamento', 'não abre segundo envio concorrente');
  srv.hold = null; solta(); assert.strictEqual(await p1, 'reenviar', 'resposta antiga não marca a versão nova como salva');
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20 && vm.runInContext('SYNC.st', a) !== 'salvo'; i++) await new Promise((r) => setImmediate(r));
  assert.strictEqual(S(a).st, 'salvo');
  assert.deepStrictEqual(F(srv.get().diaristaPool), ['D1', 'X', 'Y']);
});

test('9b. limite registrado: duas mudanças de configuração no MESMO milissegundo empatam no carimbo; o app mostra conflito em vez de perder em silêncio', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  let solta; srv.hold = new Promise((r) => { solta = r; });
  const agora = Date.now; vm.runInContext('Date.now=()=>4242424242424', a);
  a.__get().diaristaPool = ['D1', 'X']; a.saveState(); const p1 = a.syncNow();
  a.__get().diaristaPool = ['D1', 'X', 'Y']; a.saveState();
  srv.hold = null; solta(); await p1;
  for (let i = 0; i < 20 && !['salvo', 'conflito'].includes(vm.runInContext('SYNC.st', a)); i++) await new Promise((r) => setImmediate(r));
  Date.now = agora;   // o Date é compartilhado com o resto dos testes: devolve o relógio
  assert.strictEqual(S(a).st, 'conflito');
  assert.deepStrictEqual(F(a.__get().diaristaPool), ['D1', 'X', 'Y'], 'nada perdido neste aparelho');
});

test('10. resposta fora de ordem não marca como salvo uma versão mais nova', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  let solta; srv.hold = new Promise((r) => { solta = r; });
  a.__get().rates.weekend = 70; a.saveState(); const p = a.syncNow();
  a.__get().rates.weekend = 71; a.saveState();             // muda antes da resposta chegar
  srv.hold = null; solta();
  assert.strictEqual(await p, 'reenviar');
  assert.notStrictEqual(S(a).st === 'salvo' && srv.get().rates.weekend === 70, true);
});

test('11. dois aparelhos alterando dados diferentes (rascunho e confirmação) não perdem nada', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed), b = await aparelho(srv, seed);
  a.editCell('2026-11-13', a.__get().team[0].id, 'folga'); assert.strictEqual(await a.syncNow(), 'salvo');
  const { blocks } = b.confirmBlocks('2026-11-12'); b.confirmRange('2026-11-12', blocks.length ? 'teste' : undefined);
  const r = await b.syncNow();
  assert.ok(['salvo', 'conflito'].includes(r));
  const sv = srv.get();
  assert.ok(sv.days['2026-11-12'].conf, 'confirmação de B no servidor');
  assert.strictEqual(sv.days['2026-11-13'].draft && sv.days['2026-11-13'].draft.sh[a.__get().team[0].id].type, r === 'salvo' ? sv.days['2026-11-13'].draft.sh[a.__get().team[0].id].type : 'folga');
});

test('16. rascunho deste aparelho que a junção descartaria: NÃO adota, mostra conflito, guarda as duas cópias', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed), b = await aparelho(srv, seed);
  const id = a.__get().team[0].id;
  srv.modo = '500'; a.editCell('2026-11-14', id, 'folga'); await a.syncNow();          // A: rascunho não enviado
  srv.modo = 'ok'; b.editCell('2026-11-15', b.__get().team[1].id, 'folga'); await b.syncNow();   // B: rascunho mais novo
  // A volta a enviar (ex.: ao reabrir, com o envio já liberado) — simulado liberando o estado
  vm.runInContext("SYNC.st='pendente'", a);
  assert.strictEqual(await a.syncNow(), 'conflito');
  assert.strictEqual(a.__get().days['2026-11-14'].draft.sh[id].type, 'folga', 'rascunho de A preservado aqui');
  assert.match(S(a).err, /rascunho de 14\/11/);
  assert.ok(JSON.parse(a.localStorage.getItem('ank_sync_remoto')).remoto.days['2026-11-15'].draft, 'cópia do servidor guardada');
});

test('16b. pedido (configuração) criado durante a falha continua no aparelho', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  srv.modo = 'rede';
  a.__get().constraints = [{ id: 'z1', type: 'absence', empId: a.__get().team[0].id, dateStart: '2026-11-14', dateEnd: '2026-11-14' }]; a.saveState(); await a.syncNow();
  assert.deepStrictEqual(local(a).constraints.map((c) => c.id), ['z1']);
  assert.strictEqual(srv.get().constraints.length, 0);
});

test('17. confirmação e histórico preservados durante falha e depois enviados', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  srv.modo = '500';
  const { blocks } = a.confirmBlocks('2026-11-13'); a.confirmRange('2026-11-13', blocks.length ? 'teste' : undefined); await a.syncNow();
  assert.ok(local(a).days['2026-11-13'].conf, 'confirmação guardada no aparelho');
  srv.modo = 'ok'; assert.strictEqual(await a.retryNow(), 'salvo');
  assert.ok(srv.get().days['2026-11-13'].conf, 'confirmação no servidor');
});

test('12. limite conhecido (registrado): dois aparelhos online mudando a mesma configuração — vale a de quem gravou por último', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed), b = await aparelho(srv, seed);
  a.__get().rates.weekday = 101; a.saveState(); assert.strictEqual(await a.syncNow(), 'salvo');
  await new Promise((r) => setTimeout(r, 5));
  b.__get().rates.weekday = 202; b.saveState(); assert.strictEqual(await b.syncNow(), 'salvo');
  assert.strictEqual(srv.get().rates.weekday, 202, 'regra atual do servidor; evitar exige mudar a API (12C)');
});

// (12B.3) o antigo teste de 'transição' (reenviar às cegas ao reabrir) foi substituído: ver tests/sync-12b3.test.js
test('com referência conhecida, falha continua pausada ao reabrir', async () => {
  const seed = semente(), srv = servidor(seed), a = await aparelho(srv, seed);
  srv.modo = '500'; a.__get().diaristaPool = ['D1', 'P']; a.saveState(); await a.syncNow();
  srv.modo = 'ok'; const posts = srv.posts; await a.syncStateFromServerOnLoad();
  assert.strictEqual(S(a).st, 'falha'); assert.strictEqual(srv.posts, posts);
});
