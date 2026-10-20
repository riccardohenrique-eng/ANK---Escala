// Data de saída, horário livre de diarista e painel Início (2026-10-20).
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

test('depois do último dia a pessoa não é escalada e some da grade', () => {
  const a = loadApp(freshState(loadApp()));
  a.__get().team.find((e) => e.id === 'marta').saida = '2026-11-08';
  a.generateRange('2026-11-02', '2026-11-15');
  const st = a.__get();
  for (const k of a.dRange('2026-11-09', '2026-11-15')) assert.strictEqual(st.days[k].draft.sh.marta.type, 'folga');
  assert.ok(a.visibleTeam(a.dRange('2026-11-09', '2026-11-15')).every((e) => e.id !== 'marta'));
  assert.ok(a.visibleTeam(a.dRange('2026-11-02', '2026-11-15')).some((e) => e.id === 'marta'));
});

test('diarista com horário livre: aparece e vai para a confirmação', () => {
  const a = loadApp(freshState(loadApp()));
  const k = '2026-11-15', st = a.__get(), w = a.dDow(k), sh = {};
  st.team.forEach((e) => { sh[e.id] = { type: 'folga', time: null }; });
  st.days[k] = { conf: null, draft: { sh, diar: [{ name: 'Rebeca', t: 'fe', time: '14:00–20:00' }], holiday: false } };
  assert.strictEqual(a.diarHours(w, st.days[k].draft.diar[0]), '14:00–20:00');
  assert.strictEqual(a.diarHours(w, { t: 'ab' }), '11:30–16:30');
  st.days[k].draft.sh.joeli = { type: 'abertura', time: a.shiftTime(w, 'abertura') };
  a.confirmRange(k, 'teste');
  assert.strictEqual(st.days[k].conf.diar[0].time, '14:00–20:00');
});

test('dia antigo sem horário livre mantém a mesma assinatura (não vira "mudou")', () => {
  const a = loadApp(freshState(loadApp()));
  assert.strictEqual(a.confSig({ sh: {}, diar: [{ name: 'X', t: 'fe' }] }), JSON.stringify({ sh: {}, diar: [['X', 'fe']] }));
});
