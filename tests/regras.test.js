// Livro de regras (checkDay): cada regra de bloqueio precisa ser detectada.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

// monta dias confirmados: plan = {data: {empId: tipo | [tipo, 'HH:MM–HH:MM']}}; quem não aparece fica de folga
function app(plan, diar = {}) {
  const a = loadApp(freshState(loadApp()));
  const st = a.__get();
  Object.entries(plan).forEach(([k, p]) => {
    const w = a.dDow(k), sh = {};
    st.team.forEach((e) => {
      const v = p[e.id] || 'folga', t = Array.isArray(v) ? v[0] : v;
      sh[e.id] = { type: t, time: Array.isArray(v) ? v[1] : a.shiftTime(w, t) };
    });
    st.days[k] = { conf: { sh, diar: diar[k] || [], holiday: false }, draft: null };
  });
  return a;
}
const regras = (a, k) => [...a.checkDay(k).flags.filter((f) => f.l === 'block').map((f) => f.rule)];
const diaOk = { maria: 'abertura', joeli: 'abertura', alana: 'fechamento', duda: 'fechamento' };

test('dia correto não tem bloqueio', () => {
  assert.strictEqual(regras(app({ '2026-10-13': diaOk }), '2026-10-13').length, 0);
});

test('abertura só com Marta e Maria José: falta alguém do caixa', () => {
  const a = app({ '2026-10-13': { marta: 'abertura', mjose: 'abertura', alana: 'fechamento', duda: 'fechamento' } });
  assert.ok(regras(a, '2026-10-13').includes('caixa'));
});

test('fechamento com 1 pessoa só: cobertura mínima', () => {
  const a = app({ '2026-10-13': { maria: 'abertura', joeli: 'abertura', alana: 'fechamento' } });
  assert.ok(regras(a, '2026-10-13').includes('cober'));
});

test('diarista conta para cobertura mas não para o caixa', () => {
  const a = app({ '2026-10-13': { maria: 'abertura', joeli: 'abertura', marta: 'fechamento' } }, { '2026-10-13': [{ name: 'D1', t: 'fe' }] });
  const r = regras(a, '2026-10-13');
  assert.ok(!r.includes('cober')); assert.ok(r.includes('caixa'));
});

test('Maria fechando: condição da pessoa', () => {
  const a = app({ '2026-10-13': { maria: 'fechamento', joeli: 'abertura', alana: 'abertura', duda: 'fechamento' } });
  assert.ok(regras(a, '2026-10-13').includes('cond'));
});

test('7º dia seguido de trabalho é bloqueado (OJ 410)', () => {
  const plan = {}; for (let i = 0; i < 7; i++) plan[`2026-10-${String(12 + i).padStart(2, '0')}`] = diaOk;
  const a = app(plan);
  assert.ok(!regras(a, '2026-10-17').includes('sete'), '6º dia ainda pode');
  assert.ok(regras(a, '2026-10-18').includes('sete'));
});

test('menos de 11h entre fechar e abrir no dia seguinte (art. 66)', () => {
  const a = app({ '2026-10-13': diaOk, '2026-10-14': { ...diaOk, alana: ['abertura', '07:00–13:00'], maria: 'abertura', joeli: 'fechamento' } });
  assert.ok(regras(a, '2026-10-14').includes('inter'));
});

test('domingos alternados: 2º domingo seguido é bloqueado', () => {
  const dom = { maria: 'abertura', marta: 'intermediario', alana: 'fechamento' };
  const a = app({ '2026-10-11': dom, '2026-10-18': dom }, { '2026-10-11': [{ name: 'D1', t: 'ab' }, { name: 'D2', t: 'fe' }], '2026-10-18': [{ name: 'D1', t: 'ab' }, { name: 'D2', t: 'fe' }] });
  assert.ok(regras(a, '2026-10-18').includes('dom'));
});
