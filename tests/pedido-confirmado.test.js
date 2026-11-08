// P0.1 (08/11/2026) — pedido que cai em dia confirmado: detectar, perguntar, abrir alteração só com autorização.
// Cenário FICTÍCIO equivalente ao diagnóstico de 07/11 (equipe p1..p6, sem dados reais):
// 10–15/11 confirmados, 16/11 livre; abertura pedida em 14/11, folga em 15–16/11, outros pedidos já atendidos.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

const F = (x) => JSON.parse(JSON.stringify(x));
function app() {
  const s = freshState(loadApp());
  s.team = s.team.map((e, i) => ({ ...e, id: 'p' + (i + 1), name: 'Pessoa ' + (i + 1), saida: undefined, cond: undefined }));
  const a = loadApp(s);
  a.showTab = () => {};
  return a;
}
function cenario() {
  const a = app();
  a.generateRange('2026-11-02', '2026-11-15');
  const st = a.__get();
  for (let k = '2026-11-02'; k <= '2026-11-15'; k = a.dAdd(k, 1)) { st.days[k].conf = { ...st.days[k].draft, at: 1 }; st.days[k].draft = null; }
  const put = (k, id, type) => { st.days[k].conf.sh[id] = { type, time: a.shiftTime(a.dDow(k), type) }; };
  put('2026-11-14', 'p2', 'fechamento');   // pedido: p2 abre no 14 → mudança real
  put('2026-11-15', 'p3', 'abertura');     // pedido: p3 folga 15–16 → mudança real no 15
  put('2026-11-11', 'p4', 'folga');        // pedido: p4 folga 11 → já atendido
  put('2026-11-12', 'p5', 'fechamento');   // pedido: p5 fecha 12 → já atendido
  a.markSent(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);   // 14/11 já foi ao grupo
  const reqs = [
    { id: 'r1', type: 'forced_shift', empId: 'p2', shiftType: 'abertura', dateStart: '2026-11-14', dateEnd: '2026-11-14', note: 'Pessoa 2 abre dia 14' },
    { id: 'r2', type: 'absence', empId: 'p3', dateStart: '2026-11-15', dateEnd: '2026-11-16', note: 'Pessoa 3 folga 15 e 16' },
    { id: 'r3', type: 'absence', empId: 'p4', dateStart: '2026-11-11', dateEnd: '2026-11-11', note: 'Pessoa 4 folga 11' },
    { id: 'r4', type: 'forced_shift', empId: 'p5', shiftType: 'fechamento', dateStart: '2026-11-12', dateEnd: '2026-11-12', note: 'Pessoa 5 fecha 12' },
  ];
  st.constraints = reqs.slice();   // como applyParsedConstraints faz antes de montar
  return { a, st, reqs };
}
const confirmados = (st) => F(Object.fromEntries(Object.entries(st.days).filter(([k]) => k >= '2026-11-10' && k <= '2026-11-15')));

test('1. detecta só os dias que exigem mudança real; separa os já atendidos', () => {
  const { a, reqs } = cenario();
  const imp = a.confirmedImpact(reqs);
  assert.deepStrictEqual(F(imp.mudar.map((w) => [w.k, w.empId, w.de, w.para])), [
    ['2026-11-14', 'p2', 'fechamento', 'abertura'],
    ['2026-11-15', 'p3', 'abertura', 'folga'],
  ]);
  assert.deepStrictEqual(F(a.uniqK(imp.atendidos)), ['2026-11-11', '2026-11-12']);
  assert.strictEqual(imp.manual.length, 0);
  assert.ok(!imp.mudar.some((w) => w.k === '2026-11-16'), '16/11 não é confirmado: vale pela montagem normal');
});

test('2. nada muda antes da autorização; 16/11 é montado com a folga; resumo não diz sucesso', () => {
  const { a, st, reqs } = cenario();
  const antes = confirmados(st);
  const txt = a.buildFrom('2026-11-10', '2026-11-16', reqs);
  assert.deepStrictEqual(confirmados(st), antes, 'dias confirmados idênticos');
  assert.strictEqual(st.days['2026-11-16'].draft.sh.p3.type, 'folga');
  assert.match(txt, /Montados: 1 \(16\/11\)/);
  assert.match(txt, /Pedido ainda sem efeito em 2 dias já confirmados \(14 a 15\/11\): escolha abaixo se abre alteração\./);
  assert.ok(!/11\/11|12\/11/.test(txt.split('Pedido ainda')[1]), 'dias já atendidos não aparecem como pendência');
  assert.ok(a.p01State(), 'oferta aberta');
});

test('3. "Agora não" preserva integralmente a escala e o resumo conta isso', () => {
  const { a, st, reqs } = cenario();
  const antes = confirmados(st);
  a.buildFrom('2026-11-10', '2026-11-16', reqs);
  const r = a.p01State().report;
  a.p01Dismiss();
  assert.deepStrictEqual(confirmados(st), antes);
  assert.strictEqual(a.p01State(), null);
  const t = a.reportText(r);
  assert.match(t, /Mantidos como confirmados, sem o pedido: 2 dias \(14 a 15\/11\)\./);
  assert.ok(!/escolha abaixo/.test(t), 'aviso antigo some');
  assert.strictEqual(r.completo, false);
});

test('4 e 5. "Abrir alteração" cria rascunho só nas células pedidas; confirmado, histórico e envio intactos', () => {
  const { a, st, reqs } = cenario();
  st.days['2026-11-14'].conf.log = [{ at: 5, ch: ['algo antigo'], motivo: '' }];
  const antes = confirmados(st);
  a.buildFrom('2026-11-10', '2026-11-16', reqs);
  const ks = a.p01Open(['2026-11-14', '2026-11-15']);
  assert.deepStrictEqual(F(ks), ['2026-11-14', '2026-11-15']);
  for (const k of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) assert.deepStrictEqual(F(st.days[k]), antes[k], k + ' intocado');
  for (const k of ['2026-11-14', '2026-11-15']) {
    assert.deepStrictEqual(F(st.days[k].conf), antes[k].conf, k + ': confirmado preservado (inclui log e sent)');
    assert.strictEqual(a.dayStatus(k), 'pendente');
    const dr = st.days[k].draft, cf = st.days[k].conf;
    const mudou = Object.keys(cf.sh).filter((id) => dr.sh[id].type !== cf.sh[id].type);
    assert.deepStrictEqual(mudou, k === '2026-11-14' ? ['p2'] : ['p3'], 'só a célula do pedido');
    assert.deepStrictEqual(F(dr.diar), F(cf.diar), 'diaristas iguais');
  }
  assert.strictEqual(st.days['2026-11-14'].draft.sh.p2.type, 'abertura');
  assert.strictEqual(st.days['2026-11-14'].draft.sh.p2.time, a.shiftTime(a.dDow('2026-11-14'), 'abertura'));
  assert.strictEqual(st.days['2026-11-15'].draft.sh.p3.type, 'folga');
  assert.match(st.days['2026-11-14'].draft.pedido[0], /^Pedido: Pessoa 2 abertura/);
  assert.ok(st.days['2026-11-14'].conf.sent, 'informação de envio continua');
});

test('4b. escolher só um dia: o outro fica confirmado e o resumo diz qual', () => {
  const { a, st, reqs } = cenario();
  const antes = confirmados(st);
  a.buildFrom('2026-11-10', '2026-11-16', reqs);
  const r = a.p01State().report;
  a.p01Open(['2026-11-15']);
  assert.deepStrictEqual(F(st.days['2026-11-14']), antes['2026-11-14']);
  assert.strictEqual(a.dayStatus('2026-11-15'), 'pendente');
  const t = a.reportText(r);
  assert.match(t, /Alteração aberta: 1 dia \(15\/11\)\. Falta confirmar para valer\./);
  assert.match(t, /Não alterados: 5 \(10 a 14\/11, já confirmados\)\./, 'dia aberto não é contado duas vezes');
  assert.match(t, /Mantidos como confirmados, sem o pedido: 1 dia \(14\/11\)\./);
  assert.ok(!/sem efeito/.test(t));
  assert.strictEqual(r.completo, false, 'alteração aberta ainda não é definitiva');
});

test('6. desfazer o dia volta exatamente ao confirmado', () => {
  const { a, st, reqs } = cenario();
  const antes = confirmados(st);
  a.buildFrom('2026-11-10', '2026-11-16', reqs);
  a.p01Open(['2026-11-14', '2026-11-15']);
  a.undoDay('2026-11-14'); a.undoDay('2026-11-15');
  assert.deepStrictEqual(confirmados(st), antes);
  assert.strictEqual(a.dayStatus('2026-11-14'), 'enviada');
});

test('7 e 8. nova confirmação registra a mudança com o motivo do pedido; dia enviado vira "mudou após o envio"', () => {
  const { a, st, reqs } = cenario();
  a.buildFrom('2026-11-10', '2026-11-16', reqs);
  assert.match(a.p01OfferHTML(), /já enviado ao grupo/, 'oferta identifica o dia enviado');
  a.p01Open(['2026-11-14', '2026-11-15']);
  const { blocks } = a.confirmBlocks('2026-11-16');
  assert.ok(a.confirmRange('2026-11-16', blocks.length ? 'teste' : undefined));
  const c14 = st.days['2026-11-14'].conf, last = c14.log[c14.log.length - 1];
  assert.strictEqual(st.days['2026-11-14'].draft, null);
  assert.strictEqual(c14.sh.p2.type, 'abertura');
  assert.ok(last.ch.some((x) => /^Pessoa 2: Abertura/.test(x)), last.ch.join(' | '));
  assert.match(last.motivo, /Pedido: Pessoa 2 abertura/);
  assert.ok(c14.sent, 'envio anterior guardado');
  assert.strictEqual(a.dayStatus('2026-11-14'), 'mudou');
  assert.strictEqual(a.dayStatus('2026-11-15'), 'confirmada', '15/11 não tinha ido ao grupo');
  assert.strictEqual(st.days['2026-11-15'].conf.sh.p3.type, 'folga');
});

test('pedido sem montar (caixa Pedidos): mesmo fluxo; nada muda sem escolha', () => {
  const { a, st, reqs } = cenario();
  const antes = confirmados(st);
  const html = a.pedidoGuardadoHTML(reqs);
  assert.match(html, /Pedido guardado, com pendência\..*2 dias já confirmados \(14 a 15\/11\)/);
  a.p01Prepare(reqs, null, 'ped');
  assert.deepStrictEqual(confirmados(st), antes);
  a.p01Open(['2026-11-14']);
  assert.strictEqual(a.dayStatus('2026-11-14'), 'pendente');
  assert.match(a.p01ResultText(['2026-11-14'], ['2026-11-15'], []), /Alteração aberta: 1 dia \(14\/11\).*Mantidos como confirmados, sem o pedido: 1 dia \(15\/11\)/);
});

test('pedido já atendido em dia confirmado: sem pendência e sem oferta', () => {
  const { a, reqs } = cenario();
  const so = [reqs[2], reqs[3]];
  assert.ok(!/com pendência/.test(a.pedidoGuardadoHTML(so)));
  assert.strictEqual(a.p01Prepare(so, null, 'ped'), null);
  const r = a.buildReport({ pedidos: [], gerados: [], preservados: [], semBase: [] }, so);
  assert.strictEqual(r.reqConf.length, 0);
});

test('duas pessoas que não podem trabalhar juntas e pedidos contraditórios: só aviso, nunca mudança automática', () => {
  const { a, st } = cenario();
  const k = '2026-11-13', sh = st.days[k].conf.sh;
  const quem = Object.keys(sh).filter((id) => a.works(sh[id].type)).slice(0, 2);
  const reqs = [
    { type: 'no_pair', empIds: quem, dateStart: k, dateEnd: k },
    { type: 'absence', empId: 'p6', dateStart: '2026-11-10', dateEnd: '2026-11-10' },
    { type: 'forced_shift', empId: 'p6', shiftType: 'fechamento', dateStart: '2026-11-10', dateEnd: '2026-11-10' },
  ];
  const imp = a.confirmedImpact(reqs);
  assert.deepStrictEqual(F(a.uniqK(imp.manual)), ['2026-11-10', k]);
  assert.ok(!imp.mudar.some((w) => w.empId === 'p6' && w.k === '2026-11-10'));
  const antes = confirmados(st);
  a.p01Prepare(reqs, null, 'ped');
  assert.deepStrictEqual(F(a.p01Open(['2026-11-10', k])), [], 'nada a abrir automaticamente');
  assert.deepStrictEqual(confirmados(st), antes);
  assert.match(a.p01OfferHTML() || '', /Entendi|^$/);
});

test('a consequência é lida sem mexer no dia', () => {
  const { a, st, reqs } = cenario();
  const antes = confirmados(st);
  const imp = a.confirmedImpact(reqs);
  a.impactConsequence('2026-11-15', imp.mudar.filter((w) => w.k === '2026-11-15'));
  assert.deepStrictEqual(confirmados(st), antes);
  assert.strictEqual(st.days['2026-11-15'].draft, null);
});

test('a montagem depois de abrir alteração não desfaz a alteração pendente', () => {
  const { a, st, reqs } = cenario();
  a.buildFrom('2026-11-10', '2026-11-16', reqs);
  a.p01Open(['2026-11-14']);
  a.generateRange('2026-11-10', '2026-11-16');
  assert.strictEqual(st.days['2026-11-14'].draft.sh.p2.type, 'abertura');
});

test('versão local é posterior à publicada (p02 de 08/11)', () => {
  const fs = require('fs'), path = require('path');
  const f = ['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x));
  const v = (fs.readFileSync(f, 'utf8').match(/const APP_VERSION='([^']+)'/) || [])[1];
  assert.ok(v && v > '2026.11.08-p02', v);
});

// ---------- Etapa 07B: persistência, Desfazer seguro, integridade ----------
const { mergeStates } = require('../api/_merge');
const abrir = () => { const c = cenario(); c.a.buildFrom('2026-11-10', '2026-11-16', c.reqs); c.antes = confirmados(c.st); c.a.p01Open(['2026-11-14', '2026-11-15']); return c; };

test('07B persistência: fechar e reabrir o app mantém a alteração pendente, o motivo e o confirmado original', () => {
  const { a, st } = abrir();
  const salvo = JSON.parse(JSON.stringify(st));          // o que fica no localStorage
  const b = loadApp(salvo);                               // "reabrir": normalizeState no estado gravado
  const s2 = b.__get();
  assert.strictEqual(b.dayStatus('2026-11-14'), 'pendente');
  assert.strictEqual(b.dayStatus('2026-11-13'), 'enviada', 'dia sem alteração continua como estava');
  assert.deepStrictEqual(F(s2.days['2026-11-14'].conf), F(st.days['2026-11-14'].conf));
  assert.strictEqual(s2.days['2026-11-14'].conf.sh.p2.type, 'fechamento', 'confirmado original intacto');
  assert.strictEqual(s2.days['2026-11-14'].draft.sh.p2.type, 'abertura');
  assert.match(s2.days['2026-11-14'].draft.pedido[0], /Pedido: Pessoa 2 abertura/);
  assert.strictEqual(b.p01State(), null, 'a oferta não reaparece sozinha; o dia pendente fica no Montar');
});

test('07B persistência: o merge do servidor guarda rascunho (com motivo) e confirmado do dia', () => {
  const { st } = abrir();
  const server = JSON.parse(JSON.stringify(st));
  Object.values(server.days).forEach((d) => { d.draft = null; });
  server._updatedAt = st._updatedAt - 1000;
  const m = mergeStates(server, JSON.parse(JSON.stringify(st)));
  assert.strictEqual(m.days['2026-11-14'].draft.sh.p2.type, 'abertura');
  assert.ok(m.days['2026-11-14'].draft.pedido.length);
  assert.deepStrictEqual(F(m.days['2026-11-14'].conf), F(st.days['2026-11-14'].conf));
});

test('07B Desfazer: volta só os dias da operação e nada mais', () => {
  const { a, st, antes } = abrir();
  const d16 = JSON.stringify(st.days['2026-11-16']);
  const r = a.p01UndoNow();
  assert.deepStrictEqual(F(r), { n: 2, pulados: 0 });
  assert.deepStrictEqual(confirmados(st), antes);
  assert.strictEqual(JSON.stringify(st.days['2026-11-16']), d16, 'outro dia (rascunho do 16) não muda');
  assert.strictEqual(a.p01UndoNow(), null, 'só uma vez');
});

test('07B Desfazer: some depois de qualquer edição gravada (não passa por cima)', () => {
  const { a, st } = abrir();
  a.editCell('2026-11-14', 'p1', 'folga');
  assert.strictEqual(a.p01UndoNow(), null);
  assert.strictEqual(st.days['2026-11-14'].draft.sh.p1.type, 'folga');
  assert.strictEqual(st.days['2026-11-14'].draft.sh.p2.type, 'abertura');
});

test('07B Desfazer: some depois de nova confirmação (não volta estado antigo)', () => {
  const { a, st } = abrir();
  const { blocks } = a.confirmBlocks('2026-11-16');
  assert.ok(a.confirmRange('2026-11-16', blocks.length ? 'teste' : undefined));
  assert.strictEqual(a.p01UndoNow(), null);
  assert.strictEqual(st.days['2026-11-14'].conf.sh.p2.type, 'abertura');
});

test('07B Desfazer: dia que mudou por fora (ex.: veio do servidor) não é sobrescrito', () => {
  const { a, st, antes } = abrir();
  st.days['2026-11-15'].draft.sh.p1 = { type: 'folga', time: null, manual: true };   // mudança sem saveState
  const r = a.p01UndoNow();
  assert.deepStrictEqual(F(r), { n: 1, pulados: 1 });
  assert.deepStrictEqual(F(st.days['2026-11-14']), antes['2026-11-14']);
  assert.strictEqual(st.days['2026-11-15'].draft.sh.p1.type, 'folga', 'mudança posterior preservada');
});

test('07B integridade: Abrir não confirma nem envia; o assessor vê o furo de cobertura', () => {
  const { a, st } = cenario();
  const k = '2026-11-15', sh = st.days[k].conf.sh;
  const ab = Object.keys(sh).filter((id) => sh[id].type === 'abertura');
  const reqs = ab.map((id) => ({ type: 'absence', empId: id, dateStart: k, dateEnd: k }));   // tira toda a abertura
  st.constraints = reqs.slice();
  a.p01Prepare(reqs, null, 'ped');
  assert.match(a.p01OfferHTML(), /Consequência: [^<]*Abertura com só/, 'consequência mostra a cobertura antes de abrir');
  const sentAntes = F(st.days['2026-11-14'].conf.sent);
  a.p01Open([k]);
  assert.strictEqual(a.dayStatus(k), 'pendente');
  assert.ok(a.checkDay(k).flags.some((f) => /Abertura com só/.test(f.msg)), 'assessor acusa no dia pendente');
  assert.deepStrictEqual(F(st.days['2026-11-14'].conf.sent), sentAntes);
  assert.ok(!st.days[k].conf.sent || st.days[k].conf.sent.sig !== a.confSig(st.days[k].draft), 'nada marcado como enviado');
  assert.strictEqual(a.pendingDays().includes(k), true, 'continua esperando confirmação');
});
