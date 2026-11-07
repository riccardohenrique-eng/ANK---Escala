// P0.3 (07/11/2026) — segurança das datas dos pedidos. Equipe e pedidos FICTÍCIOS (p1..p6).
// Regra: a data da IA é a data do pedido; nada é trocado/ampliado sozinho; data inválida é recusada;
// divergência com as datas escritas no trecho vira alerta que bloqueia o Aplicar até conferência humana.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, freshState } = require('./harness');

function app() {
  const base = loadApp();
  const s = freshState(base);
  s.team = s.team.map((e, i) => ({ ...e, id: 'p' + (i + 1), name: 'Pessoa ' + (i + 1), saida: undefined }));
  const a = loadApp(s);
  a.showTab = () => {};
  return a;
}
const abs = (emp, s, e, note) => ({ type: 'absence', empId: emp, dateStart: s, dateEnd: e, note });
const forced = (emp, s, note, t = 'abertura') => ({ type: 'forced_shift', empId: emp, shiftType: t, dateStart: s, dateEnd: s, note });

test('data única correta: sem alerta, aplica com a mesma data', () => {
  const a = app();
  a.showParsed('x', [forced('p5', '2026-11-14', 'Pessoa 5 abre dia 14/11')]);
  assert.deepStrictEqual([...a.__pending()[0]._alerts], []);
  a.applyParsedConstraints();
  const c = a.__get().constraints[0];
  assert.strictEqual(c.dateStart, '2026-11-14');
  assert.ok(!('_alerts' in c) && !('_ok' in c), 'campos de tela não vão para os dados');
});

test('data única incorreta (IA 15, texto 14): mantém 15, alerta e bloqueia até conferir', () => {
  const a = app();
  a.showParsed('x', [forced('p5', '2026-11-15', 'Pessoa 5 abre dia 14/11')]);
  const p = a.__pending()[0];
  assert.strictEqual(p.dateStart, '2026-11-15');
  assert.strictEqual(p._alerts.length, 1);
  a.applyParsedConstraints();
  assert.strictEqual(a.__get().constraints.length, 0);
});

test('correção manual da data resolve o alerta e grava a data digitada', () => {
  const a = app();
  a.showParsed('x', [forced('p5', '2026-11-15', 'Pessoa 5 abre dia 14/11')]);
  const id = a.__pending()[0].id;
  a.editPendingDate(id, 'dateStart', '2026-11-14');
  a.editPendingDate(id, 'dateEnd', '2026-11-14');
  a.applyParsedConstraints();
  const c = a.__get().constraints[0];
  assert.strictEqual(c.dateStart, '2026-11-14');
  assert.strictEqual(c.dateEnd, '2026-11-14');
});

test('correção manual inválida (fim antes do início) continua bloqueando', () => {
  const a = app();
  a.showParsed('x', [abs('p5', '2026-11-15', '2026-11-16', 'Pessoa 5 folga dias 15 e 16/11')]);
  const id = a.__pending()[0].id;
  a.editPendingDate(id, 'dateEnd', '2026-11-10');
  assert.ok(a.__pending()[0]._err);
  a.applyParsedConstraints();
  assert.strictEqual(a.__get().constraints.length, 0);
});

test('intervalo: "dias 15 e 16/11" = Folga (2 dias); "de 17 a 30/11" = Férias (14 dias)', () => {
  const a = app();
  a.showParsed('x', [abs('p5', '2026-11-15', '2026-11-16', 'Pessoa 5 folga dias 15 e 16/11'), abs('p3', '2026-11-17', '2026-11-30', 'Pessoa 3 férias de 17 a 30/11')]);
  const [f, v] = a.__pending();
  assert.strictEqual(f._alerts.length, 0, 'folga de 2 dias: nada a conferir');
  assert.deepStrictEqual([...v._alerts.map((x) => x.k)], ['cat'], 'Férias de 14 dias: pede confirmação (P0.3b), sem alerta de período longo');
  assert.match(a.reviewTitle(f), /Folga \(2 dias\)/);
  assert.match(a.reviewTitle(v), /Férias \(14 dias\)/);
});

test('datas inexistentes e formatos inválidos são recusados (não viram pedido, não são corrigidos)', () => {
  const a = app();
  const bad = [
    abs('p1', '2026-11-31', '2026-11-31', 'dia 31/11'),
    abs('p1', '2026-02-29', '2026-02-29', 'dia 29/02'),
    abs('p1', '15/11/2026', '15/11/2026', 'dia 15/11'),
    abs('p1', '2026-11-15T03:00:00Z', '2026-11-15', 'dia 15/11'),
    abs('p1', '', '2026-11-15', 'x'),
    { type: 'qualquer', empId: 'p1', dateStart: '2026-11-15', dateEnd: '2026-11-15' },
  ];
  bad.forEach((c) => assert.strictEqual(a.checkConstraint(c).ok, false, JSON.stringify(c)));
  a.showParsed('x', bad);
  assert.strictEqual(a.__pending().length, 0);
});

test('fim antes do início é recusado (não é invertido em silêncio)', () => {
  const a = app();
  const r = a.checkConstraint(abs('p1', '2026-11-16', '2026-11-15', 'x'));
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /final vem antes/);
});

test('sem limite arbitrário de ano/duração: datas válidas distantes passam (com o tipo explícito)', () => {
  const a = app();
  const r = a.checkConstraint(abs('p1', '2027-01-04', '2027-03-31', 'licença de 04/01 a 31/03'));
  assert.strictEqual(r.ok, true);
  assert.match(a.reviewTitle(r.item), /Férias \(87 dias\)/);
});

test('pedidos múltiplos no mesmo texto, cada um com o seu trecho: nenhum alerta, todos aplicados como vieram', () => {
  const a = app();
  a.showParsed('x', [
    forced('p5', '2026-11-14', 'Pessoa 5 abre dia 14/11'),
    abs('p5', '2026-11-15', '2026-11-16', 'Pessoa 5 de folga dias 15 e 16/11'),
    abs('p4', '2026-11-11', '2026-11-11', 'Pessoa 4 de folga dia 11/11'),
    abs('p4', '2026-11-15', '2026-11-15', 'Pessoa 4 de folga dia 15/11'),
  ]);
  assert.ok(a.__pending().every((c) => c._alerts.length === 0));
  a.applyParsedConstraints();
  const got = a.__get().constraints.map((c) => [c.empId, c.dateStart, c.dateEnd]);
  assert.deepStrictEqual(got, [['p5', '2026-11-14', '2026-11-14'], ['p5', '2026-11-15', '2026-11-16'], ['p4', '2026-11-11', '2026-11-11'], ['p4', '2026-11-15', '2026-11-15']]);
});

test('caso real (anonimizado): trecho com datas de outra pessoa NÃO amplia 15–16 para 11–16 nem vira férias', () => {
  const a = app();
  a.showParsed('x', [abs('p5', '2026-11-15', '2026-11-16', 'Pessoa 4 folga 11/11; Pessoa 5 folga dias 15 e 16/11')]);
  const p = a.__pending()[0];
  assert.strictEqual(p.dateStart, '2026-11-15');
  assert.strictEqual(p.dateEnd, '2026-11-16');
  assert.strictEqual(a.absenceKind(p), 'folga');
  assert.strictEqual(p._alerts.length, 1, 'avisa que o texto cita outra data');
  a.okPending(p.id);
  a.applyParsedConstraints();
  const c = a.__get().constraints[0];
  assert.deepStrictEqual([c.dateStart, c.dateEnd], ['2026-11-15', '2026-11-16']);
  assert.strictEqual(a.absenceType('p5', '2026-11-15'), 'folga');
  assert.strictEqual(a.absentOn('p5', '2026-11-11'), false, 'o dia 11 não entra no período');
});

test('ausência longa só vira férias com o rótulo explícito na conferência', () => {
  const a = app();
  a.showParsed('x', [abs('p2', '2026-11-11', '2026-11-16', 'Pessoa 2 fora de 11 a 16/11')]);
  assert.match(a.reviewTitle(a.__pending()[0]), /Férias \(6 dias\)/);
});

test('texto sem datas escritas: usa a data da IA sem alerta de divergência (recorrente longo pede confirmação)', () => {
  const a = app();
  a.showParsed('x', [{ type: 'absence', empId: 'p6', dateStart: '2026-11-13', dateEnd: '2026-11-27', allowedDows: [4], note: 'Pessoa 6 de folga toda sexta até o fim do mês' }]);
  const p = a.__pending()[0];
  assert.ok(!p._alerts.some((x) => x.k === 'texto'), 'sem divergência de texto');
  assert.deepStrictEqual([...p._alerts.map((x) => x.k)], ['cat', 'longo'], 'o gerador trata o período inteiro como Férias: o usuário precisa ver e confirmar');
  assert.match(p._alerts[1].t, /só sex/);
  assert.deepStrictEqual([...p.allowedDows], [4]);
  assert.deepStrictEqual([p.dateStart, p.dateEnd], ['2026-11-13', '2026-11-27']);
});

test('dias da semana que não caem no período viram alerta (não são apagados em silêncio)', () => {
  const a = app();
  a.showParsed('x', [{ type: 'absence', empId: 'p6', dateStart: '2026-11-14', dateEnd: '2026-11-14', allowedDows: [4], note: 'x' }]);
  const p = a.__pending()[0];
  assert.deepStrictEqual([...p.allowedDows], [4]);
  assert.strictEqual(p._alerts.length, 1);
});

test('texto preservado na caixa quando parte foi recusada', () => {
  const a = app();
  a.showParsed('x', [forced('p5', '2026-11-14', 'Pessoa 5 abre dia 14/11'), abs('p1', '2026-11-31', '2026-11-31', 'dia 31/11')]);
  assert.strictEqual(a.__pending().length, 1);
  assert.strictEqual(a.parseHadRejectsNow(), true);
});

test('compatibilidade: pedidos já guardados (formato antigo) continuam valendo e descrevem sem erro', () => {
  const base = loadApp();
  const s = freshState(base);
  s.constraints = [
    { id: 'c1794081000000123', type: 'absence', empId: 'joeli', dateStart: '2026-11-11', dateEnd: '2026-11-11', note: 'antigo' },
    { id: 'c179408200000012345', type: 'forced_shift', empId: 'alana', shiftType: 'abertura', dateStart: '2026-11-14', dateEnd: '2026-11-14', note: 'antigo' },
    { id: 'c1', type: 'absence', empId: 'duda', dateStart: '2026-11-20T03:00:00Z', dateEnd: '2026-11-20', note: 'legado com hora' },
  ];
  const a = loadApp(s);
  a.showTab = () => {};
  a.__get().constraints.forEach((c) => assert.strictEqual(typeof a.constraintDescribe(c), 'string'));
  a.generateRange('2026-11-09', '2026-11-15');
  const st = a.__get();
  assert.strictEqual(st.days['2026-11-11'].draft.sh.joeli.type, 'folga');
  assert.strictEqual(st.days['2026-11-14'].draft.sh.alana.type, 'abertura');
  assert.strictEqual(st.constraints.length, 3, 'nada guardado é apagado ou reescrito');
});

test('servidor e app recusam as mesmas datas', async () => {
  const f = path.join(__dirname, '..', 'api', 'interpret-constraints.js');
  delete require.cache[require.resolve(f)];
  delete process.env.ANK_ACCESS_KEY; process.env.GEMINI_API_KEY = 'teste';
  const casos = [
    ['2026-11-14', '2026-11-14', true], ['2026-11-15', '2026-11-16', true], ['2026-11-31', '2026-11-31', false],
    ['2026-02-29', '2026-02-29', false], ['2028-02-29', '2028-02-29', true], ['15/11/2026', '15/11/2026', false],
    ['2026-11-15T03:00:00Z', '2026-11-15', false], ['2026-11-16', '2026-11-15', false],
  ];
  const args = { constraints: casos.map(([s, e], i) => ({ type: 'absence', empId: 'p1', dateStart: s, dateEnd: e, note: 'caso ' + i })) };
  const antes = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'return_constraints', args } }] } }] }) });
  const res = { code: 200 }; res.status = (c) => { res.code = c; return res; }; res.json = (b) => { res.body = b; return res; };
  try { await require(f)({ method: 'POST', headers: {}, body: { text: 'x', team: [{ id: 'p1', name: 'Pessoa 1' }] } }, res); }
  finally { global.fetch = antes; }
  const a = app();
  const servidorAceitou = new Set(res.body.constraints.map((c) => c.note));
  casos.forEach(([s, e, esperado], i) => {
    assert.strictEqual(servidorAceitou.has('caso ' + i), esperado, `servidor caso ${i}`);
    assert.strictEqual(a.checkConstraint({ type: 'absence', empId: 'p1', dateStart: s, dateEnd: e, note: 'caso ' + i }).ok, esperado, `app caso ${i}`);
  });
});
