// 10/11/2026 — período livre no Montar, assistente só no período e apagamento das escalas confirmadas.
// Equipe padrão do app com dados FICTÍCIOS; servidor falso com a junção real (api/_merge.js).
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadApp, freshState } = require('./harness');
const { mergeStates, stable } = require('../api/_merge.js');
const F = (x) => JSON.parse(JSON.stringify(x));
const R = (a, code) => vm.runInContext(code, a);

function confirmar(a, from, to, at = 1000) {
  a.generateRange(from, to);
  const st = a.__get();
  for (let k = from; k <= to; k = a.dAdd(k, 1)) { st.days[k].conf = { ...st.days[k].draft, at }; st.days[k].draft = null; }
}
function novo() { const a = loadApp(freshState(loadApp())); a.showTab = () => {}; a.toasts = []; a.toast = (m) => a.toasts.push(m); return a; }

// ---------- período ----------
test('período: escolher De/Até define os dias do Montar (1 a 42) e fica guardado no aparelho', () => {
  const a = novo();
  a.mqSetPeriod('2026-11-20', '2026-11-26', true);
  assert.deepStrictEqual(F(a.mqDays()), F(a.dRange('2026-11-20', '2026-11-26')));
  assert.deepStrictEqual(JSON.parse(a.localStorage.getItem('ank_mq_periodo')), ['2026-11-20', '2026-11-26']);
  a.mqSetPeriod('2026-11-26', '2026-11-20', true);
  assert.strictEqual(a.mqDays()[0], '2026-11-20', 'De/Até invertidos são corrigidos');
  a.mqSetPeriod('2026-11-01', '2027-01-31', true);
  assert.strictEqual(a.mqDays().length, 42, 'no máximo 6 semanas');
  a.mqSetPeriod('2026-11-18', '2026-11-18', true);
  assert.strictEqual(a.mqDays().length, 1, 'um dia só também vale');
});
test('período: setas andam o tamanho do período; gerar sugestão gera só o período', () => {
  const a = novo(); a.renderMontar = () => {};
  a.mqSetPeriod('2026-11-18', '2026-11-27', true);   // 10 dias, começando numa quarta
  a.mqShift(1);
  assert.deepStrictEqual([a.mqDays()[0], a.mqDays()[9]], ['2026-11-28', '2026-12-07']);
  a.mqSetPeriod('2026-11-18', '2026-11-27', true);
  a.renderAll = () => {}; a.showBuildReport = () => '';
  a.mqGenerate();
  const ks = Object.keys(a.__get().days).sort();
  assert.deepStrictEqual(ks, F(a.dRange('2026-11-18', '2026-11-27')));
});
test('período padrão: dia seguinte ao último confirmado, 7 dias; sem nada, começa hoje', () => {
  const a = novo(); const hoje = a.todayISO();
  assert.deepStrictEqual([a.mqDays()[0], a.mqDays().length], [hoje, 7]);
  const b = novo(); confirmar(b, a.dAdd(hoje, 0), a.dAdd(hoje, 3));
  R(b, 'MQ.start=MQ.end=null'); b.localStorage.removeItem('ank_mq_periodo');
  assert.strictEqual(b.mqDays()[0], a.dAdd(hoje, 4));
});
test('pedido "monta de X a Y" abre o Montar exatamente nesse período', () => {
  const a = novo(); a.renderAll = () => {}; a.closeSheet = () => {}; a.showBuildReport = () => '';
  a.buildFrom('2026-11-19', '2026-11-25');
  assert.deepStrictEqual([a.mqDays()[0], a.mqDays()[a.mqDays().length - 1]], ['2026-11-19', '2026-11-25']);
});

// ---------- assistente só no período ----------
test('assessor: domingos ANTES do período não contam para o 2×1; dentro do período contam', () => {
  const a = novo(), st = a.__get();
  const dom = { maria: 'abertura', marta: 'intermediario', alana: 'fechamento' };
  ['2026-11-01', '2026-11-08', '2026-11-15'].forEach((k) => {
    const sh = {}; st.team.forEach((e) => { const t = dom[e.id] || 'folga'; sh[e.id] = { type: t, time: a.shiftTime(6, t) }; });
    st.days[k] = { conf: { sh, diar: [], holiday: false, at: 1 }, draft: null };
  });
  a.mqSetPeriod('2026-11-15', '2026-11-21', true);
  assert.ok(!a.checkDay('2026-11-15').flags.some((f) => f.rule === 'dom'), 'só 1 domingo no período');
  assert.ok(!a.assess(a.mqDays()).some((i) => i.rule === 'dom'));
  a.mqSetPeriod('2026-11-01', '2026-11-21', true);
  assert.ok(a.checkDay('2026-11-15').flags.some((f) => f.rule === 'dom'), '3 domingos no período');
});
test('assessor: dias seguidos de trabalho só contam dentro do período', () => {
  const a = novo(), st = a.__get();
  for (let k = '2026-11-10'; k <= '2026-11-17'; k = a.dAdd(k, 1)) {
    const w = a.dDow(k), sh = {}; st.team.forEach((e) => { const t = e.id === 'alana' ? 'fechamento' : 'folga'; sh[e.id] = { type: t, time: a.shiftTime(w, t) }; });
    st.days[k] = { conf: { sh, diar: [], holiday: false, at: 1 }, draft: null };
  }
  a.mqSetPeriod('2026-11-10', '2026-11-17', true);
  assert.ok(a.checkDay('2026-11-17').flags.some((f) => f.rule === 'sete'));
  a.mqSetPeriod('2026-11-14', '2026-11-20', true);
  assert.ok(!a.checkDay('2026-11-17').flags.some((f) => f.rule === 'sete'), 'antes de 14/11 não conta');
});
test('gerador: escala confirmada antes do período não muda a sugestão (igual a gerar sem histórico)', () => {
  const sem = novo(); sem.generateRange('2026-11-16', '2026-11-29');
  const com = novo(); confirmar(com, '2026-11-02', '2026-11-15');
  // histórico "estranho": todo mundo trabalhando no domingo e 6 dias seguidos antes do período
  const st = com.__get(); ['2026-11-08', '2026-11-15'].forEach((k) => st.team.forEach((e) => { st.days[k].conf.sh[e.id] = { type: 'fechamento', time: '16:00–22:00' }; }));
  com.generateRange('2026-11-16', '2026-11-29');
  const draft = (a) => F(a.dRange('2026-11-16', '2026-11-29').map((k) => a.__get().days[k].draft));
  assert.deepStrictEqual(draft(com), draft(sem));
});

// ---------- apagar escalas confirmadas ----------
test('apagar: 1º toque só arma; 2º apaga todos os confirmados e o histórico antigo; rascunhos e configuração ficam', () => {
  const a = novo(); a.renderAll = () => {}; a.closeSheet = () => {}; a.saveState = () => {};
  confirmar(a, '2026-11-02', '2026-11-08');
  a.generateRange('2026-11-09', '2026-11-10');
  const st = a.__get(); st.legacyHistory = [{ x: 1 }]; st.days['2026-11-05'].draft = F(st.days['2026-11-05'].conf);
  const team = F(st.team);
  a.clearConfirmed();
  assert.strictEqual(Object.values(a.__get().days).filter((d) => d.conf).length, 7, '1º toque não apaga');
  a.clearConfirmed();
  const s2 = a.__get();
  assert.strictEqual(Object.values(s2.days).filter((d) => d.conf).length, 0);
  assert.ok(!s2.days['2026-11-05'], 'alteração pendente de dia confirmado sai junto');
  assert.ok(s2.days['2026-11-09'].draft && s2.days['2026-11-10'].draft, 'rascunhos ficam');
  assert.strictEqual(s2.legacyHistory, undefined);
  assert.ok(s2.histCut && s2.histCut.at > 0);
  assert.deepStrictEqual(F(s2.team), team);
});
test('apagar: com salvamento pausado (falha/conflito) não apaga', () => {
  const a = novo(); a.renderAll = () => {}; a.closeSheet = () => {};
  confirmar(a, '2026-11-02', '2026-11-04');
  a.setSync('falha', { err: 'teste' });
  a.clearConfirmed(); a.clearConfirmed();
  assert.strictEqual(Object.values(a.__get().days).filter((d) => d.conf).length, 3);
});
test('servidor: apagamento vale para todos; aparelho antigo não traz dias de volta; confirmado depois fica', () => {
  const a = novo(); confirmar(a, '2026-11-02', '2026-11-08', 1000);
  const antigo = F(a.__get()); antigo._updatedAt = 2000;
  const servidor = F(antigo); servidor.histCut = { at: 5000 }; servidor.days = {}; servidor._updatedAt = 5000; servidor._cfgAt = 1;
  // aparelho antigo (sem a marca) grava por cima
  let m = mergeStates(servidor, antigo);
  assert.strictEqual(Object.keys(m.days).length, 0, 'nada volta');
  assert.deepStrictEqual(m.histCut, { at: 5000 });
  // o mesmo, gravado com _updatedAt maior (rascunhos vêm dele): ainda nada volta
  antigo._updatedAt = 9000; m = mergeStates(servidor, antigo);
  assert.strictEqual(Object.keys(m.days).length, 0);
  // dia confirmado depois do apagamento fica
  const novoDia = F(servidor); novoDia.days['2026-11-20'] = { conf: { sh: {}, diar: [], holiday: false, at: 6000 }, draft: null };
  m = mergeStates(servidor, novoDia);
  assert.ok(m.days['2026-11-20'].conf);
  // estado já limpo e igual: nada a mudar (servidor responde 200)
  assert.strictEqual(stable(mergeStates(servidor, F(servidor))), stable(servidor));
});
test('aparelho antigo abrindo depois do apagamento: adota o servidor sem conflito e os dias somem', async () => {
  const a = novo(); confirmar(a, '2026-11-02', '2026-11-08', 1000);
  const antigo = F(a.__get()); antigo._updatedAt = 2000; antigo._cfgAt = 2000;
  const srvState = F(antigo); srvState.histCut = { at: 5000 }; srvState.days = {}; srvState._updatedAt = 5000;
  const b = loadApp(F(antigo)); b.showTab = () => {}; b.toast = () => {};
  b.fetch = async (url, opts = {}) => ({ status: 200, ok: true, json: async () => (opts.method === 'POST' ? { ok: true } : { state: F(srvState) }) });
  await b.syncStateFromServerOnLoad();
  assert.strictEqual(R(b, 'SYNC').st, 'salvo');
  assert.strictEqual(Object.keys(b.__get().days).length, 0);
  assert.deepStrictEqual(F(b.__get().histCut), { at: 5000 });
});
