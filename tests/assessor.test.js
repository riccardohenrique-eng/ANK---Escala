// Assessor de RH (2026-10-20): feriado sem folga extra, 2 folgas na semana, 44h, migração da Duda/2×1, leitura da planilha.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

function app(plan) {
  const a = loadApp(freshState(loadApp()));
  const st = a.__get();
  Object.entries(plan).forEach(([k, p]) => {
    const w = a.dDow(k), sh = {};
    st.team.forEach((e) => { const t = p[e.id] || 'folga'; sh[e.id] = { type: t, time: a.shiftTime(w, t) }; });
    st.days[k] = { conf: { sh, diar: [], holiday: false }, draft: null };
  });
  return a;
}
const regras = (a, k) => a.checkDay(k).flags.map((f) => f.rule);
const semana = (seg, f) => { const o = {}; for (let i = 0; i < 7; i++) { const d = new Date(Date.UTC(2026, 10, seg + i)).toISOString().slice(0, 10); o[d] = f(i); } return o; };

test('feriado trabalhado sem folga extra nos 7 dias seguintes é apontado', () => {
  // 02/11 (Finados): Joeli trabalha no feriado e depois só folga 2 dias em 03–09/11
  const plan = { '2026-11-02': { joeli: 'abertura' } };
  for (let i = 3; i <= 9; i++) plan[`2026-11-0${i}`.replace('-0', '-0').slice(0, 10)] = { joeli: [4, 5].includes(i) ? 'folga' : 'abertura' };
  const a = app(plan);
  assert.ok(regras(a, '2026-11-02').includes('feriado'));
});

test('feriado trabalhado com folga extra não é apontado', () => {
  const plan = { '2026-11-02': { joeli: 'abertura' } };
  for (let i = 3; i <= 9; i++) plan[`2026-11-0${i}`] = { joeli: [4, 5, 6].includes(i) ? 'folga' : 'abertura' };
  const a = app(plan);
  assert.ok(!regras(a, '2026-11-02').includes('feriado'));
});

test('semana com 1 folga só é apontada (regra da loja: 2)', () => {
  const a = app(semana(9, (i) => ({ alana: i === 3 ? 'folga' : 'fechamento' })));
  assert.ok(a.checkDay('2026-11-15').flags.some((f) => f.rule === 'folgas' && f.msg.startsWith('Alana')));
});

test('mais de 44h na semana é apontado', () => {
  const a = app(semana(9, () => ({ marta: 'abertura' })));
  const st = a.__get();
  Object.keys(st.days).forEach((k) => { st.days[k].conf.sh.marta.time = '08:00–15:00'; });
  assert.ok(regras(a, '2026-11-15').includes('h44'));
});

test('migração: estado antigo passa a 2×1 e Duda só fica proibida de ABRIR qua–sex', () => {
  const a = loadApp();
  const velho = JSON.parse(JSON.stringify(a.__get()));
  delete velho._mig20261020; velho.sunRule = 'alt';
  velho.team.find((e) => e.id === 'duda').cond.intermediario = [1, 1, 0, 0, 0, 1, 1];
  a.__set(velho);
  const s = a.__get(), du = s.team.find((e) => e.id === 'duda');
  assert.strictEqual(s.sunRule, 'tres');
  assert.deepStrictEqual([...du.cond.abertura], [1, 1, 0, 0, 0, 1, 1]);
  assert.deepStrictEqual([...du.cond.intermediario], [1, 1, 1, 1, 1, 1, 1]);
});

test('2×1: 3º domingo seguido é apontado, 2º não', () => {
  const dom = { maria: 'abertura', marta: 'intermediario', alana: 'fechamento' };
  const a = app({ '2026-11-01': dom, '2026-11-08': dom, '2026-11-15': dom });
  assert.ok(!regras(a, '2026-11-08').includes('dom'));
  assert.ok(regras(a, '2026-11-15').includes('dom'));
});

test('leitura das células da planilha', () => {
  const a = loadApp();
  const p = (s) => JSON.parse(JSON.stringify(a.parseCellShift(s)));
  assert.deepStrictEqual(p('09:30h - 16:00h (abertura)'), { type: 'abertura', time: '09:30–16:00' });
  assert.deepStrictEqual(p('16h - 22h (fechamento)'), { type: 'fechamento', time: '16:00–22:00' });
  assert.deepStrictEqual(p('14:30h - 22h (Pausa: 18h - 20h)'), { type: 'fechamento', time: '14:30–22:00' });
  assert.deepStrictEqual(p('15h - 21h (intermediário)'), { type: 'intermediario', time: '15:00–21:00' });
  assert.deepStrictEqual(p('Folga'), { type: 'folga', time: null });
  assert.deepStrictEqual(p('FÉRIAS'), { type: 'ferias', time: null });
  const d = JSON.parse(JSON.stringify(a.parseDiaristas('10:30h - 16:30h Samara')));
  assert.deepStrictEqual(d, [{ name: 'Samara', t: 'ab' }]);
  assert.strictEqual(a.parseDiaristas(' 16:30h - 22h (Diarista)  16:30h - 22h (Diarista) ').length, 2);
});
