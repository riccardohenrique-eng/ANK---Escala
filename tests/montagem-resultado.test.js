// P0.2 (07/11/2026) — a mensagem de montagem conta a verdade. Equipe FICTÍCIA (p1..p6), sem dados reais.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

function app(mut) {
  const s = freshState(loadApp());
  s.team = s.team.map((e, i) => ({ ...e, id: 'p' + (i + 1), name: 'Pessoa ' + (i + 1), saida: undefined }));
  if (mut) mut(s);
  const a = loadApp(s);
  a.showTab = () => {};
  return a;
}
// confirma (como o app faz: conf = cópia do rascunho) os dias de um período
function confirmar(a, from, to) {
  a.generateRange(from, to);
  const st = a.__get();
  for (let k = from; k <= to; k = a.dAdd(k, 1)) { st.days[k].conf = { ...st.days[k].draft, at: 1 }; st.days[k].draft = null; }
}

test('montagem completa: todos os dias montados, sem "Não alterados"', () => {
  const a = app();
  const r = a.buildReport(a.generateRange('2026-11-16', '2026-11-22'));
  assert.strictEqual(r.gerados.length, 7);
  assert.strictEqual(r.conf.length + r.pend.length, 0);
  const t = a.reportText(r);
  assert.match(t, /^Solicitados: 7 dias\. Montados: 7 \(16 a 22\/11\)\./);
  assert.ok(!/Não alterados/.test(t));
  assert.strictEqual(r.completo, r.need.length === 0);
});

test('caso de 07/11 (fictício): 10–15 confirmados, pedir 10–16 → só 16 montado, nada de sucesso completo', () => {
  const a = app();
  confirmar(a, '2026-11-02', '2026-11-15');
  const antes = JSON.stringify(Object.fromEntries(Object.entries(a.__get().days).filter(([k]) => k <= '2026-11-15')));
  const r = a.buildReport(a.generateRange('2026-11-10', '2026-11-16'));
  assert.ok(a.reportText(r).startsWith('Solicitados: 7 dias. Montados: 1 (16/11). Não alterados: 6 (10 a 15/11, já confirmados).'), a.reportText(r));
  assert.strictEqual(r.completo, false);
  const depois = JSON.stringify(Object.fromEntries(Object.entries(a.__get().days).filter(([k]) => k <= '2026-11-15')));
  assert.strictEqual(depois, antes, 'dias confirmados intactos');
});

test('período todo confirmado: Montados 0, parcial', () => {
  const a = app();
  confirmar(a, '2026-11-10', '2026-11-15');
  const r = a.buildReport(a.generateRange('2026-11-10', '2026-11-15'));
  assert.match(a.reportText(r), /^Solicitados: 6 dias\. Montados: 0\. Não alterados: 6 \(10 a 15\/11, já confirmados\)\./);
  assert.strictEqual(r.completo, false);
});

test('dia confirmado com alteração pendente aparece separado e não é refeito', () => {
  const a = app();
  confirmar(a, '2026-11-10', '2026-11-12');
  const st = a.__get();
  st.days['2026-11-11'].draft = JSON.parse(JSON.stringify(st.days['2026-11-11'].conf));
  st.days['2026-11-11'].draft.sh.p1 = { type: 'folga', time: null, manual: true };
  const r = a.buildReport(a.generateRange('2026-11-10', '2026-11-13'));
  const t = a.reportText(r);
  assert.match(t, /Não alterados: 3 \(10\/11, 12\/11, já confirmados; 11\/11, com alteração pendente\)/);
  assert.strictEqual(st.days['2026-11-11'].draft.sh.p1.type, 'folga', 'alteração pendente preservada');
});

test('dias com alerta do assessor entram em "Precisam de você"', () => {
  const a = app((s) => { s.team.forEach((e) => { e.podeOperarCaixa = false; }); });
  const r = a.buildReport(a.generateRange('2026-11-16', '2026-11-17'));
  assert.strictEqual(r.need.length, 2);
  assert.strictEqual(r.completo, false);
  assert.match(a.reportText(r), /Precisam de você: 2 \(16 a 17\/11\): veja o assessor\./);
});

test('copiar 2 semanas anteriores também conta a verdade (sem base, confirmados)', () => {
  const a = app();
  confirmar(a, '2026-11-02', '2026-11-04');
  confirmar(a, '2026-11-16', '2026-11-16');
  const r = a.buildReport(a.copyPrevRange('2026-11-16', '2026-11-19'));
  assert.deepStrictEqual([...r.gerados], ['2026-11-17', '2026-11-18']);
  assert.deepStrictEqual([...r.conf], ['2026-11-16']);
  assert.deepStrictEqual([...r.semBase], ['2026-11-19']);
  assert.match(a.reportText(r), /Sem escala para copiar: 1 \(19\/11\)/);
});

test('datas: mês cruzado e dias soltos', () => {
  const a = app();
  assert.strictEqual(a.daysText(['2026-11-30', '2026-12-01', '2026-12-02']), '30/11 a 02/12');
  assert.strictEqual(a.daysText(['2026-11-11', '2026-11-13']), '11/11, 13/11');
  assert.strictEqual(a.daysText(['2026-11-16']), '16/11');
});

test('fluxo "Montar" pelo pedido (buildFrom) devolve o resumo honesto', () => {
  const a = app();
  confirmar(a, '2026-11-02', '2026-11-15');
  const txt = a.buildFrom('2026-11-10', '2026-11-16');
  assert.ok(txt.startsWith('Solicitados: 7 dias. Montados: 1 (16/11). Não alterados: 6 (10 a 15/11, já confirmados).'), txt);
});

test('compatibilidade: gerar sem confirmados mantém o comportamento (rascunho em todos os dias)', () => {
  const a = app();
  a.generateRange('2026-11-16', '2026-11-22');
  const st = a.__get();
  for (let k = '2026-11-16'; k <= '2026-11-22'; k = a.dAdd(k, 1)) assert.ok(st.days[k].draft && !st.days[k].conf);
});

test('título: completa / montados com pendências / parcial', () => {
  const a = app();
  assert.strictEqual(a.reportTitle({ completo: true, gerados: [1], pedidos: [1] }), 'Montagem completa');
  assert.strictEqual(a.reportTitle({ completo: false, gerados: [1, 2], pedidos: [1, 2] }), 'Montados, com pendências');
  assert.strictEqual(a.reportTitle({ completo: false, gerados: [1], pedidos: [1, 2] }), 'Montagem parcial');
});

// P0.2b (08/11/2026) — pedido que cai em dia confirmado não pode parecer aplicado.
test('pedido em dia confirmado: buildFrom avisa "sem efeito" e não diz completo; confirmado intacto', () => {
  const a = app();
  confirmar(a, '2026-11-02', '2026-11-15');
  const antes = JSON.stringify(a.__get().days['2026-11-12']);
  const reqs = [{ type: 'absence', empId: 'p3', dateStart: '2026-11-12', dateEnd: '2026-11-12' }];
  a.__get().constraints = reqs.slice();
  const txt = a.buildFrom('2026-11-10', '2026-11-16', reqs);
  assert.match(txt, /Pedido sem efeito em 1 dia já confirmado \(12\/11\): para mudar, toque no dia\./, txt);
  assert.strictEqual(JSON.stringify(a.__get().days['2026-11-12']), antes, 'dia confirmado não mudou');
});

test('pedido só em dias livres: nada de "sem efeito"', () => {
  const a = app();
  confirmar(a, '2026-11-02', '2026-11-15');
  const reqs = [{ type: 'absence', empId: 'p3', dateStart: '2026-11-16', dateEnd: '2026-11-16' }];
  const r = a.buildReport(a.generateRange('2026-11-16', '2026-11-16'), reqs);
  assert.strictEqual(r.reqConf.length, 0);
  assert.ok(!/sem efeito/.test(a.reportText(r)));
});

test('confirmedHit respeita dias da semana do pedido e ignora pedido de diarista', () => {
  const a = app();
  confirmar(a, '2026-11-09', '2026-11-15');   // seg a dom
  const hit = a.confirmedHit([
    { type: 'absence', empId: 'p1', dateStart: '2026-11-09', dateEnd: '2026-11-22', allowedDows: [4] }, // só sextas
    { type: 'diarista_limit', diaristaName: 'X', dateStart: '2026-11-09', dateEnd: '2026-11-15', allowedDows: [0] },
  ]);
  assert.deepStrictEqual([...hit], ['2026-11-13']);
});

test('sem rascunho: pedido em dia confirmado não promete "vai valer quando montar"', () => {
  const a = app();
  confirmar(a, '2026-11-09', '2026-11-15');
  const so = a.pedidoGuardadoHTML([{ type: 'absence', empId: 'p2', dateStart: '2026-11-12', dateEnd: '2026-11-12' }]);
  assert.match(so, /Pedido guardado, com pendência\./);
  assert.ok(!/vai valer quando você montar/.test(so) && !/Nos outros dias/.test(so), so);
  const misto = a.pedidoGuardadoHTML([{ type: 'absence', empId: 'p2', dateStart: '2026-11-15', dateEnd: '2026-11-16' }]);
  assert.match(misto, /sem efeito em 1 dia já confirmado \(15\/11\).*Nos outros dias, vale quando você montar o período\./);
  const livre = a.pedidoGuardadoHTML([{ type: 'absence', empId: 'p2', dateStart: '2026-11-17', dateEnd: '2026-11-17' }]);
  assert.match(livre, /vai valer quando você montar o período/);
});

test('versão local é posterior à publicada (p03 de 07/11)', () => {
  const fs = require('fs'), path = require('path');
  const f = ['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x));
  const html = fs.readFileSync(f, 'utf8');
  const v = (html.match(/const APP_VERSION='([^']+)'/) || [])[1];
  assert.ok(v && v > '2026.11.07-p03', v);
});
