// Pedido de montagem pela caixa de pedidos (2026-11-07): "monta de 10 a 16/11" gera rascunho do período.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

function confirmado(a, k) {
  const w = a.dDow(k), sh = {};
  a.__get().team.forEach((e) => { sh[e.id] = { type: 'folga', time: a.shiftTime(w, 'folga') }; });
  return { conf: { sh, diar: [], holiday: false, at: 1 }, draft: null };
}

test('lê "montagem a partir de 10/11 até dia 16/11" como período', () => {
  const a = loadApp(freshState(loadApp()));
  const b = a.localBuildRange('Montagem a partir de 10/11 até dia 16/11 já que a ultima escala enviada foi do dia 02/11 até o dia 09/11');
  assert.strictEqual(b.type, 'build_range');
  assert.strictEqual(b.dateStart.slice(5), '11-10');
  assert.strictEqual(b.dateEnd.slice(5), '11-16');
});

test('"monta de 10 a 16/11" usa o mês do fim para o início', () => {
  const a = loadApp(freshState(loadApp()));
  const b = a.localBuildRange('monta de 10 a 16/11');
  assert.strictEqual(b.dateStart.slice(5), '11-10');
});

test('pedido sobre pessoa não vira montagem', () => {
  const a = loadApp(freshState(loadApp()));
  assert.strictEqual(a.localBuildRange('Joeli de férias de 10 a 20/11'), null);
});

test('aplicar montagem: gera rascunho no período, não guarda como pedido, não mexe no confirmado', () => {
  const a = loadApp(freshState(loadApp()));
  const st = a.__get();
  st.days['2026-11-09'] = confirmado(a, '2026-11-09');
  a.showParsed('monta de 09 a 16/11', []);
  a.applyParsedConstraints();
  assert.strictEqual(st.constraints.length, 0);
  assert.strictEqual(st.days['2026-11-09'].draft, null);
  for (let k = '2026-11-10'; k <= '2026-11-16'; k = a.dAdd(k, 1)) assert.ok(st.days[k] && st.days[k].draft, 'sem rascunho em ' + k);
  assert.ok(!st.days['2026-11-17']);
});

test('montagem + pedido juntos: pedido é guardado e respeitado no rascunho', () => {
  const a = loadApp(freshState(loadApp()));
  const st = a.__get();
  const id = st.team[0].id;
  a.showParsed('monta de 10 a 16/11', [{ type: 'absence', empId: id, dateStart: '2026-11-12', dateEnd: '2026-11-12', note: 'x' }]);
  a.applyParsedConstraints();
  assert.strictEqual(st.constraints.length, 1);
  assert.ok(st.days['2026-11-12'].draft);
  assert.notStrictEqual(['abertura', 'intermediario', 'fechamento'].includes(st.days['2026-11-12'].draft.sh[id].type), true);
});

test('próximo início = dia seguinte ao último confirmado', () => {
  const a = loadApp(freshState(loadApp()));
  a.__get().days['2026-11-09'] = confirmado(a, '2026-11-09');
  assert.strictEqual(a.nextBuildStart(), '2026-11-10');
});

test('datas da IA erradas em 1 dia são corrigidas pelo trecho original (caso real 07/11)', () => {
  const a = loadApp(freshState(loadApp()));
  a.showTab = () => {};
  const st = a.__get();
  st.team.find((e) => e.id === 'marta').saida = '2026-10-31';
  const mais1 = [
    { type: 'build_range', dateStart: '2026-11-11', dateEnd: '2026-11-17', note: 'Monta de 10 a 16/11' },
    { type: 'forced_shift', empId: 'alana', shiftType: 'abertura', dateStart: '2026-11-15', dateEnd: '2026-11-15', note: 'Alana abre dia 14/11' },
    { type: 'absence', empId: 'alana', dateStart: '2026-11-16', dateEnd: '2026-11-17', note: 'Alana de folga dias 15 e 16/11' },
    { type: 'absence', empId: 'joeli', dateStart: '2026-11-12T03:00:00Z', dateEnd: '2026-11-12', note: 'Joeli de folga dia 11/11' },
    { type: 'absence', empId: 'joeli', dateStart: '2026-11-16', dateEnd: '2026-11-16', note: 'Joeli de folga dia 15/11', allowedDows: [0] },
  ];
  a.showParsed('x', mais1);
  a.applyParsedConstraints();
  const t = (k, id) => st.days[k].draft.sh[id].type;
  assert.strictEqual(t('2026-11-14', 'alana'), 'abertura');
  assert.strictEqual(t('2026-11-15', 'alana'), 'folga');
  assert.strictEqual(t('2026-11-16', 'alana'), 'folga');
  assert.strictEqual(t('2026-11-11', 'joeli'), 'folga');
  assert.strictEqual(t('2026-11-15', 'joeli'), 'folga');
  assert.ok(st.days['2026-11-10'].draft);
  assert.ok(!st.days['2026-11-17']);
});

test('lê datas escritas: "dias 15 e 16/11", "de 17 a 30/11", "dia 14/11"', () => {
  const a = loadApp(freshState(loadApp()));
  assert.deepStrictEqual([...a.datesInText('folga dias 15 e 16/11')].map((k) => k.slice(5)), ['11-15', '11-16']);
  assert.deepStrictEqual([...a.datesInText('férias de 17 a 30/11')].map((k) => k.slice(5)), ['11-17', '11-30']);
  assert.deepStrictEqual([...a.datesInText('abre dia 14/11')].map((k) => k.slice(5)), ['11-14']);
  assert.strictEqual(a.datesInText('folga toda sexta').length, 0);
});
