// Folha (computePayrollForRange): horista com taxa fictícia de R$10/h.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

function comTurnos(turnos) { // turnos = {data: 'HH:MM–HH:MM' | 'folga'} para a Alana (horista)
  const a = loadApp(freshState(loadApp()));
  const st = a.__get();
  Object.entries(turnos).forEach(([k, t]) => {
    const sh = {}; st.team.forEach((e) => { sh[e.id] = { type: 'folga', time: null }; });
    if (t !== 'folga') sh.alana = { type: 'abertura', time: t, breakInfo: { given: true, duration: 0 } };
    st.days[k] = { conf: { sh, diar: [], holiday: false }, draft: null };
  });
  return a;
}
const semana = (seg, horario, nDias) => { const o = {}; for (let i = 0; i < 7; i++) { const d = new Date(Date.UTC(2026, 9, seg + i)).toISOString().slice(0, 10); o[d] = i < nDias ? horario : 'folga'; } return o; };
const datas = (o) => Object.keys(o).sort();
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} ≠ ${b}`);

test('semana de 5 dias de 7h: 35h normais, sem extra, DSR = média do dia', () => {
  const t = semana(12, '10:30–17:30', 5), a = comTurnos(t);
  const p = a.computePayrollForRange('alana', datas(t), 10);
  perto(p.normalHours, 35, 'normais'); perto(p.extraHours, 0, 'extras'); perto(p.dsr, 70, 'DSR');
  perto(p.fgts, (350 + 70) * 0.08, 'FGTS');
});

test('6 dias de 8h (48h): 4h extras com 50%, teto de 44h por semana', () => {
  const t = semana(12, '09:00–17:00', 6), a = comTurnos(t);
  const p = a.computePayrollForRange('alana', datas(t), 10);
  perto(p.normalHours, 44, 'normais'); perto(p.extraHours, 4, 'extras'); perto(p.valorExtra, 60, 'valor extra');
  perto(p.dsr, 440 / 6, 'DSR');
});

test('quinzena = soma de 2 semanas (DSR e teto de 44h por semana, não pelo período)', () => {
  const t1 = semana(12, '09:00–17:00', 6), t2 = semana(19, '09:00–17:00', 6);
  const tudo = { ...t1, ...t2 }, a = comTurnos(tudo);
  const q = a.computePayrollForRange('alana', datas(tudo), 10);
  const s1 = a.computePayrollForRange('alana', datas(t1), 10), s2 = a.computePayrollForRange('alana', datas(t2), 10);
  perto(q.extraHours, s1.extraHours + s2.extraHours, 'extras'); perto(q.dsr, s1.dsr + s2.dsr, 'DSR'); perto(q.total, s1.total + s2.total, 'total');
});

test('domingo trabalhado sem folga na semana é pago em dobro (Súmula 146)', () => {
  const t = semana(12, '10:30–17:30', 7), a = comTurnos(t); // 7 dias, sem folga
  const p = a.computePayrollForRange('alana', datas(t), 10);
  assert.strictEqual(p.dobroDays, 1); perto(p.dobroValue, 70, 'dobro');
  const t2 = semana(12, '10:30–17:30', 6); t2['2026-10-18'] = '10:30–17:30'; t2['2026-10-12'] = 'folga'; // folga na segunda
  const p2 = comTurnos(t2).computePayrollForRange('alana', datas(t2), 10);
  assert.strictEqual(p2.dobroDays, 0);
});

test('mensalista: 30 dias = salário do mês, sem hora extra', () => {
  const a = loadApp(freshState(loadApp()));
  const d = []; for (let i = 1; i <= 30; i++) d.push(`2026-11-${String(i).padStart(2, '0')}`);
  const maria = a.__get().team.find((e) => e.id === 'maria');
  const p = a.computePayrollForRange('maria', d, 0);
  assert.ok(p.isMensalista); perto(p.base, maria.monthlySalary, 'base'); perto(p.valorExtra, 0, 'extra');
});
