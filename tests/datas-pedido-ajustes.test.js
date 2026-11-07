// P0.3b (07/11/2026) — ajustes da revisão 04B. Equipe e pedidos FICTÍCIOS (p1..p6).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, freshState } = require('./harness');

function app() {
  const s = freshState(loadApp());
  s.team = s.team.map((e, i) => ({ ...e, id: 'p' + (i + 1), name: 'Pessoa ' + (i + 1), saida: undefined }));
  const a = loadApp(s);
  a.showTab = () => {};
  return a;
}
const kinds = (c) => [...c._alerts.map((x) => x.k)];
const abs = (emp, s, e, note) => ({ type: 'absence', empId: emp, dateStart: s, dateEnd: e, note });

test('mês cruzado: "de 11/11 a 10/12" lê só 11/11 e 10/12 (sem data falsa 11/12) e não dá alerta de texto', () => {
  const a = app();
  assert.deepStrictEqual([...a.datesInText('licença de 11/11 a 10/12')], ['2026-11-11', '2026-12-10']);
  assert.deepStrictEqual([...a.datesInText('folga de 30/11 a 02/12')], ['2026-11-30', '2026-12-02']);
  assert.deepStrictEqual([...a.datesInText('dias 15, 16 e 17/11')], ['2026-11-15', '2026-11-16', '2026-11-17']);
  const r = a.checkConstraint(abs('p4', '2026-11-11', '2026-12-10', 'Pessoa 4 licença de 11/11 a 10/12'));
  assert.ok(!r.alerts.some((x) => x.k === 'texto'), 'sem alerta falso de divergência');
});

test('campos obrigatórios por tipo são recusados com mensagem clara (sem derrubar a conferência)', () => {
  const a = app();
  const d = { dateStart: '2026-11-14', dateEnd: '2026-11-14', note: 'x' };
  const casos = [
    [{ type: 'absence', ...d }, /qual pessoa/],
    [{ type: 'absence', empId: 'ninguem', ...d }, /qual pessoa/],
    [{ type: 'forced_shift', empId: 'p1', ...d }, /turno não reconhecido/],
    [{ type: 'forced_shift', empId: 'p1', shiftType: 'folga', ...d }, /turno não reconhecido/],
    [{ type: 'no_pair', ...d }, /quais duas pessoas/],
    [{ type: 'no_pair', empIds: ['p1', 'p1'], ...d }, /quais duas pessoas/],
    [{ type: 'diarista_limit', allowedDows: [5], ...d }, /qual diarista/],
  ];
  casos.forEach(([c, re]) => { const r = a.checkConstraint(c); assert.strictEqual(r.ok, false, JSON.stringify(c)); assert.match(r.why, re); });
  assert.doesNotThrow(() => a.showParsed('x', casos.map((x) => x[0])));
  assert.strictEqual(a.__pending().length, 0);
});

test('"Em vigor" escapa texto não confiável (nome de diarista, nota, tipo desconhecido)', () => {
  const a = app();
  const xss = '<img src=x onerror=alert(1)>';
  const out = [
    a.constraintDescribe({ type: 'diarista_limit', diaristaName: xss, allowedDows: [5], dateStart: '2026-11-01', dateEnd: '2026-11-30' }),
    a.constraintDescribe({ type: 'outro', note: xss, dateStart: '2026-11-01', dateEnd: '2026-11-01' }),
    a.constraintDescribe({ type: 'forced_shift', empId: 'p1', shiftType: xss, dateStart: '2026-11-01', dateEnd: '2026-11-01' }),
    a.constraintDescribe({ type: 'no_pair', dateStart: '2026-11-01', dateEnd: '2026-11-01' }),
  ];
  out.forEach((h) => { assert.ok(!/<img/i.test(h), h); });
  assert.match(out[0], /&lt;img/);
});

test('Férias sempre pede confirmação explícita; folga de até 3 dias não', () => {
  const a = app();
  a.showParsed('x', [abs('p1', '2026-11-11', '2026-11-13', 'folga de 11 a 13/11'), abs('p2', '2026-11-11', '2026-11-14', 'folga de 11 a 14/11')]);
  const [tres, quatro] = a.__pending();
  assert.deepStrictEqual(kinds(tres), []);
  assert.deepStrictEqual(kinds(quatro), ['cat']);
  assert.match(quatro._alerts[0].t, /4 dias/);
  a.applyParsedConstraints();
  assert.strictEqual(a.__get().constraints.length, 0, 'bloqueado até confirmar');
  a.okPending(quatro.id);
  a.applyParsedConstraints();
  assert.strictEqual(a.__get().constraints.length, 2);
});

test('editar as datas NÃO confirma Férias sozinho (precisa de "Está certo"); voltar para folga libera', () => {
  const a = app();
  a.showParsed('x', [abs('p1', '2026-11-11', '2026-11-11', 'folga dia 11/11')]);
  const id = a.__pending()[0].id;
  a.editPendingDate(id, 'dateEnd', '2026-11-20');
  assert.strictEqual(a.pendingNeedsCheck(a.__pending()[0]), true);
  a.editPendingDate(id, 'dateEnd', '2026-11-12');
  assert.strictEqual(a.pendingNeedsCheck(a.__pending()[0]), false);
});

test('mais de 14 dias: alerta adicional de período longo; 14 dias exatos não', () => {
  const a = app();
  assert.deepStrictEqual([...a.checkConstraint(abs('p1', '2026-11-17', '2026-11-30', 'férias de 17 a 30/11')).alerts.map((x) => x.k)], ['cat']);
  assert.deepStrictEqual([...a.checkConstraint(abs('p1', '2026-11-17', '2026-12-01', 'férias de 17/11 a 01/12')).alerts.map((x) => x.k)], ['cat', 'longo']);
});

test('nenhuma ausência é recusada só pela duração (30, 60 e 87 dias)', () => {
  const a = app();
  [['2026-11-01', '2026-11-30'], ['2026-11-01', '2026-12-30'], ['2027-01-04', '2027-03-31']].forEach(([s, e]) => {
    const r = a.checkConstraint(abs('p1', s, e, 'licença'));
    assert.strictEqual(r.ok, true, `${s}..${e}`);
    assert.deepStrictEqual([...r.alerts.map((x) => x.k)], ['cat', 'longo']);
  });
});

test('servidor recusa os mesmos campos obrigatórios que o app', async () => {
  const f = path.join(__dirname, '..', 'api', 'interpret-constraints.js');
  delete require.cache[require.resolve(f)];
  delete process.env.ANK_ACCESS_KEY; process.env.GEMINI_API_KEY = 'teste';
  const d = { dateStart: '2026-11-14', dateEnd: '2026-11-14' };
  const casos = [
    [{ type: 'absence', empId: 'p1', ...d }, true], [{ type: 'absence', ...d }, false],
    [{ type: 'forced_shift', empId: 'p1', shiftType: 'abertura', ...d }, true], [{ type: 'forced_shift', empId: 'p1', ...d }, false],
    [{ type: 'forced_shift', empId: 'p1', shiftType: 'folga', ...d }, false],
    [{ type: 'no_pair', empIds: ['p1', 'p2'], ...d }, true], [{ type: 'no_pair', empIds: ['p1', 'p1'], ...d }, false],
    [{ type: 'diarista_limit', diaristaName: 'D1', allowedDows: [5], ...d }, true], [{ type: 'diarista_limit', diaristaName: '  ', ...d }, false],
  ].map(([c, ok], i) => [{ ...c, note: 'caso ' + i }, ok]);
  const antes = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'return_constraints', args: { constraints: casos.map((x) => x[0]) } } }] } }] }) });
  const res = { code: 200 }; res.status = (c) => { res.code = c; return res; }; res.json = (b) => { res.body = b; return res; };
  try { await require(f)({ method: 'POST', headers: {}, body: { text: 'x', team: [{ id: 'p1', name: 'Pessoa 1' }, { id: 'p2', name: 'Pessoa 2' }] } }, res); }
  finally { global.fetch = antes; }
  const a = app();
  const aceitos = new Set(res.body.constraints.map((c) => c.note));
  casos.forEach(([c, ok]) => {
    assert.strictEqual(aceitos.has(c.note), ok, 'servidor ' + c.note);
    assert.strictEqual(a.checkConstraint(c).ok, ok, 'app ' + c.note);
  });
});
