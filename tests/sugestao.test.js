// Caixa de sugestões (2026-10-20): aplicar vira rascunho só onde não há confirmação; descartar grava null.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

function dia(a, k, plan) {
  const w = a.dDow(k), sh = {};
  a.__get().team.forEach((e) => { const t = plan[e.id] || 'folga'; sh[e.id] = { type: t, time: a.shiftTime(w, t) }; });
  return { sh, diar: [], holiday: false };
}

test('aplicar sugestão: dia confirmado fica, dia vazio vira rascunho, sugestão some (null)', () => {
  const a = loadApp(freshState(loadApp()));
  const st = a.__get();
  st.days['2026-11-09'] = { conf: { ...dia(a, '2026-11-09', { maria: 'abertura' }), at: 1 }, draft: null };
  st.sugestao = { from: '2026-11-09', to: '2026-11-10', at: 1, days: {
    '2026-11-09': dia(a, '2026-11-09', { joeli: 'abertura' }),
    '2026-11-10': dia(a, '2026-11-10', { alana: 'fechamento' }) } };
  a.sugApply();
  assert.strictEqual(st.days['2026-11-09'].conf.sh.maria.type, 'abertura');
  assert.strictEqual(st.days['2026-11-09'].draft, null);
  assert.strictEqual(st.days['2026-11-10'].draft.sh.alana.type, 'fechamento');
  assert.strictEqual(a.__get().sugestao, null);
});

test('prévia da sugestão não altera os dias', () => {
  const a = loadApp(freshState(loadApp()));
  const st = a.__get();
  const g = { days: { '2026-11-10': dia(a, '2026-11-10', { alana: 'fechamento' }) } };
  a.sugPreview(g);
  assert.ok(!('2026-11-10' in st.days));
});

test('descartar grava null (o merge do servidor não ressuscita a sugestão)', () => {
  const a = loadApp(freshState(loadApp()));
  a.__get().sugestao = { days: { '2026-11-10': dia(a, '2026-11-10', {}) } };
  a.sugDiscard();
  assert.strictEqual(a.__get().sugestao, null);
  const { mergeStates } = require('../api/_merge.js');
  const out = mergeStates({ sugestao: { days: { x: 1 } }, _cfgAt: 1, days: {} }, { sugestao: null, _cfgAt: 2, days: {} });
  assert.strictEqual(out.sugestao, null);
});
