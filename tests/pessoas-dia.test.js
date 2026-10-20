// Pessoas por dia (2026-10-20): exceção por data em STATE.compDay — gerador e assessor respeitam só aquela data.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

const SEX = '2026-11-13', SEX2 = '2026-11-20';
const conta = (v, t) => Object.values(v.sh).filter((c) => c && c.type === t).length;

test('gerador põe 1 intermediário só na sexta escolhida; a outra sexta segue o normal', () => {
  const a = loadApp(freshState(loadApp(), { compDay: { [SEX]: { ab: 2, int: 1, fe: 2, dAb: 0, dFe: 0 } } }));
  a.generateRange('2026-11-09', '2026-11-22');
  const st = a.__get();
  assert.strictEqual(conta(st.days[SEX].draft, 'intermediario'), 1);
  assert.strictEqual(conta(st.days[SEX2].draft, 'intermediario'), 0);
});

test('assessor avisa quando o dia tem menos gente que o escolhido', () => {
  const a = loadApp(freshState(loadApp(), { compDay: { [SEX]: { ab: 2, int: 1, fe: 2, dAb: 0, dFe: 0 } } }));
  const st = a.__get(), w = a.dDow(SEX), sh = {};
  const plan = { maria: 'abertura', alana: 'abertura', joeli: 'fechamento', duda: 'fechamento' };
  st.team.forEach((e) => { const t = plan[e.id] || 'folga'; sh[e.id] = { type: t, time: a.shiftTime(w, t) }; });
  st.days[SEX] = { conf: null, draft: { sh, diar: [], holiday: false } };
  const f = a.checkDay(SEX).flags.find((x) => x.rule === 'plano');
  assert.ok(f, 'deveria avisar');
  assert.match(f.msg, /escolheu 5 pessoas e tem 4: falta 1 no intermediário/);
});

test('sem exceção não há aviso de pessoas escolhidas, e compFor usa o normal', () => {
  const a = loadApp(freshState(loadApp()));
  assert.strictEqual(a.compFor(SEX, false).int, 0);
  a.__get().compDay = { [SEX]: { ab: 2, int: 1, fe: 2, dAb: 0, dFe: 0 } };
  assert.strictEqual(a.compFor(SEX, false).int, 1);
  assert.strictEqual(a.compFor(SEX2, false).int, 0);
});

test('estado antigo sem compDay ganha objeto vazio', () => {
  const s = freshState(loadApp()); delete s.compDay;
  const a = loadApp(s);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.__get().compDay)), {});
});
