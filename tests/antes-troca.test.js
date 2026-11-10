// 10/11/2026 — "Antes do período" (como terminou a escala anterior) e "Trocar com" no menu da célula. Dados FICTÍCIOS.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');
const F = (x) => JSON.parse(JSON.stringify(x));
function novo() { const a = loadApp(freshState(loadApp())); a.showTab = () => {}; a.toasts = []; a.toast = (m) => a.toasts.push(m); a.renderAll = () => {}; return a; }
function dia(a, k, plan) { const st = a.__get(), w = a.dDow(k), sh = {}; st.team.forEach((e) => { const t = plan[e.id] || 'folga'; sh[e.id] = { type: t, time: a.shiftTime(w, t) }; }); st.days[k] = { conf: null, draft: { sh, diar: [], holiday: false } }; }
const tem = (a, k, rule, quem) => a.checkDay(k).flags.some((f) => f.rule === rule && (!quem || f.msg.startsWith(quem)));

test('antes: 2 domingos informados → domingo do período é o 3º seguido (apontado); sem informar, não', () => {
  const a = novo(); a.mqSetPeriod('2026-11-16', '2026-11-22', true);
  dia(a, '2026-11-22', { alana: 'fechamento', maria: 'abertura' });
  assert.ok(!tem(a, '2026-11-22', 'dom', 'Alana'));
  a.setAntes('dom', 'alana', 2);
  assert.ok(tem(a, '2026-11-22', 'dom', 'Alana'));
  assert.ok(!tem(a, '2026-11-22', 'dom', 'Maria'));
});
test('antes: dias seguidos somam com os do período (6 antes + 1 = 7º dia)', () => {
  const a = novo(); a.mqSetPeriod('2026-11-16', '2026-11-22', true);
  dia(a, '2026-11-16', { joeli: 'abertura' });
  assert.ok(!tem(a, '2026-11-16', 'sete'));
  a.setAntes('run', 'joeli', 6);
  assert.ok(tem(a, '2026-11-16', 'sete', 'Joeli'));
});
test('antes: gerador respeita (quem vem de 2 domingos não trabalha o domingo)', () => {
  const a = novo(); a.mqSetPeriod('2026-11-16', '2026-11-22', true);
  ['maria', 'joeli', 'alana', 'duda'].forEach((id) => a.setAntes('dom', id, 2));
  a.generateRange('2026-11-16', '2026-11-22');
  const st = a.__get(), sun = st.days['2026-11-22'].draft.sh;
  const fixasDom = ['maria', 'joeli', 'alana', 'duda'].filter((id) => ['abertura', 'intermediario', 'fechamento'].includes(sun[id].type));
  // pode furar só se não houver ninguém (o gerador explica no "why"); com marta e mjose livres, as 4 ficam de fora ou explicadas
  const why = st.days['2026-11-22'].draft.why.join(' ');
  fixasDom.forEach((id) => assert.match(why, /domingo seguido/));
});
test('antes: fica guardado por início de período, na configuração (vai para o servidor)', () => {
  const a = novo(); a.mqSetPeriod('2026-11-16', '2026-11-22', true);
  a.setAntes('run', 'alana', 4); a.setAntes('run', 'alana', 0);
  a.setAntes('dom', 'maria', 1);
  assert.deepStrictEqual(F(a.__get().antes['2026-11-16']), { dom: { maria: 1 }, run: {} });
  assert.ok(a.cfgJson(a.__get()).includes('"antes"'));
  a.mqSetPeriod('2026-11-23', '2026-11-29', true);
  assert.strictEqual(a.seedOf('2026-11-23', 'dom', 'maria'), 0, 'outro período começa sem informação');
  const b = loadApp(F(a.__get())); assert.strictEqual(b.seedOf('2026-11-16', 'dom', 'maria'), 1);
});
test('trocar: duas pessoas trocam turno e horário no mesmo dia; outros dias não mudam', () => {
  const a = novo(); a.mqSetPeriod('2026-11-16', '2026-11-22', true);
  dia(a, '2026-11-21', { joeli: 'fechamento', alana: 'abertura', maria: 'abertura', duda: 'fechamento' });
  dia(a, '2026-11-20', { joeli: 'abertura' });
  const antes20 = F(a.__get().days['2026-11-20']);
  a.mqSwap('2026-11-21', 'joeli', 'alana');
  const sh = a.__get().days['2026-11-21'].draft.sh;
  assert.strictEqual(sh.joeli.type, 'abertura'); assert.strictEqual(sh.joeli.time, a.shiftTime(5, 'abertura'));
  assert.strictEqual(sh.alana.type, 'fechamento');
  assert.deepStrictEqual(F(a.__get().days['2026-11-20']), antes20);
  assert.match(a.toasts[0], /^Joeli e Alana trocaram em sáb 21\/11/);
});
test('trocar: candidatas = quem tem turno diferente no dia, sem férias/ausência', () => {
  const a = novo(); a.mqSetPeriod('2026-11-16', '2026-11-22', true);
  dia(a, '2026-11-21', { joeli: 'fechamento', alana: 'fechamento', maria: 'abertura', duda: 'ferias' });
  const ids = F(a.swapCandidates('2026-11-21', 'joeli').map((e) => e.id)).sort();
  assert.ok(!ids.includes('alana'), 'mesmo turno não aparece');
  assert.ok(!ids.includes('duda'), 'férias não aparece');
  assert.ok(ids.includes('maria'));
});
