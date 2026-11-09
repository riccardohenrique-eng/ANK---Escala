// UX Fase E.3 (08/11/2026) — aviso da ação destrutiva "Descartar rascunhos e alterações pendentes" fiel ao efeito.
// Só texto: a ação continua igual (rascunho sem versão confirmada é apagado; alteração pendente volta ao confirmado).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { loadApp, freshState } = require('./harness');
const F = (x) => JSON.parse(JSON.stringify(x));

// cenário fictício: dias confirmados, alterações pendentes (conf+draft) e rascunhos (só draft)
function app({ rasc = [], alt = [], conf = [] }) {
  const a = loadApp(freshState(loadApp()));
  a.showTab = () => {};
  const toasts = []; a.toast = (m) => { toasts.push(m); };
  const todos = [...rasc, ...alt, ...conf].sort();
  a.generateRange(todos[0], todos[todos.length - 1]);
  const st = a.__get();
  for (const k of Object.keys(st.days)) if (!todos.includes(k)) delete st.days[k];
  for (const k of [...alt, ...conf]) { st.days[k].conf = { ...st.days[k].draft, at: 1 }; st.days[k].draft = null; }
  for (const k of alt) { st.days[k].draft = F(st.days[k].conf); const id = Object.keys(st.days[k].draft.sh)[0]; st.days[k].draft.sh[id] = { type: 'folga', time: null, manual: true }; }
  return { a, st, toasts };
}
// a lógica antiga, copiada, para provar que nada mudou no efeito
const antiga = (st, p) => { p.forEach((k) => { const d = st.days[k]; if (d.conf) d.draft = null; else delete st.days[k]; }); };

test('1. só rascunhos: fala só de rascunho; apaga os rascunhos', () => {
  const { a, st, toasts } = app({ rasc: ['2026-11-11', '2026-11-12'], conf: ['2026-11-10'] });
  const c = a.discardCounts();
  assert.deepStrictEqual({ ...c }, { rasc: 2, alt: 0 });
  assert.strictEqual(a.discardAskText(c), 'Descartar 2 dias em rascunho? Os dias confirmados sem alterações permanecerão intactos.');
  a.uiDiscardDrafts();
  assert.ok(!st.days['2026-11-11'] && !st.days['2026-11-12']);
  assert.strictEqual(toasts.pop(), '2 dias em rascunho descartados. Os dias confirmados sem alterações continuam iguais.');
});

test('2. só alterações pendentes: avisa que voltam à versão confirmada', () => {
  const { a, st, toasts } = app({ alt: ['2026-11-09'], conf: ['2026-11-10'] });
  const conf09 = F(st.days['2026-11-09'].conf);
  const c = a.discardCounts();
  assert.strictEqual(a.discardAskText(c), 'Descartar 1 alteração pendente? A alteração pendente voltará à versão confirmada. Os dias confirmados sem alterações permanecerão intactos.');
  a.uiDiscardDrafts();
  assert.strictEqual(st.days['2026-11-09'].draft, null);
  assert.deepStrictEqual(F(st.days['2026-11-09'].conf), conf09, 'volta exatamente à versão confirmada');
  assert.strictEqual(toasts.pop(), '1 alteração pendente desfeita (voltou à versão confirmada). Os dias confirmados sem alterações continuam iguais.');
});

test('3/6. rascunhos e alterações juntos, singular e plural', () => {
  const um = app({ alt: ['2026-11-09'], conf: ['2026-11-10'], rasc: ['2026-11-11'] });
  assert.strictEqual(um.a.discardAskText(um.a.discardCounts()), 'Descartar 1 dia em rascunho e 1 alteração pendente? A alteração pendente voltará à versão confirmada. Os dias confirmados sem alterações permanecerão intactos.');
  um.a.uiDiscardDrafts();
  assert.strictEqual(um.toasts.pop(), '1 dia em rascunho descartado; 1 alteração pendente desfeita (voltou à versão confirmada). Os dias confirmados sem alterações continuam iguais.');
  const dois = app({ alt: ['2026-11-09', '2026-11-10'], rasc: ['2026-11-12', '2026-11-13'] });
  assert.strictEqual(dois.a.discardAskText(dois.a.discardCounts()), 'Descartar 2 dias em rascunho e 2 alterações pendentes? As alterações pendentes voltarão à versão confirmada. Os dias confirmados sem alterações permanecerão intactos.');
  dois.a.uiDiscardDrafts();
  assert.strictEqual(dois.toasts.pop(), '2 dias em rascunho descartados; 2 alterações pendentes desfeitas (voltaram à versão confirmada). Os dias confirmados sem alterações continuam iguais.');
});

test('4. dias confirmados sem alteração ficam intactos', () => {
  const { a, st } = app({ alt: ['2026-11-09'], conf: ['2026-11-10', '2026-11-14'], rasc: ['2026-11-11'] });
  const antes = F({ a: st.days['2026-11-10'], b: st.days['2026-11-14'] });
  a.uiDiscardDrafts();
  assert.deepStrictEqual(F({ a: st.days['2026-11-10'], b: st.days['2026-11-14'] }), antes);
});

test('5. cancelar: abrir a folha (contar e montar o texto) não muda nada', () => {
  const { a, st } = app({ alt: ['2026-11-09'], conf: ['2026-11-10'], rasc: ['2026-11-11'] });
  const antes = F(st.days);
  a.discardAskText(a.discardCounts());   // o que a folha faz ao abrir; "Cancelar" só fecha a folha
  assert.deepStrictEqual(F(st.days), antes);
  assert.strictEqual(a.discardAskText({ rasc: 0, alt: 0 }), 'Não há rascunho nem alteração pendente para descartar.');
});

test('7/8. a mensagem bate com o resultado e o efeito é o mesmo da lógica anterior', () => {
  const { a, st } = app({ alt: ['2026-11-09', '2026-11-13'], conf: ['2026-11-10'], rasc: ['2026-11-11', '2026-11-12', '2026-11-14'] });
  const ref = F(st); antiga(ref, a.pendingDays());
  const c = a.discardCounts(), antes = F(st.days);
  a.uiDiscardDrafts();
  const apagados = Object.keys(antes).filter((k) => !st.days[k]).length;
  const desfeitos = Object.keys(antes).filter((k) => antes[k].conf && antes[k].draft && st.days[k] && st.days[k].draft === null).length;
  assert.deepStrictEqual([apagados, desfeitos], [c.rasc, c.alt], 'números anunciados = efeito real');
  assert.deepStrictEqual(F(st.days), F(ref.days), 'mesmo resultado da lógica anterior');
});

test('falha ao gravar: não anuncia sucesso', () => {
  const { a, toasts } = app({ rasc: ['2026-11-11'], conf: ['2026-11-10'] });
  a.saveState = () => { throw new Error('sem espaço'); };
  a.uiDiscardDrafts();
  assert.match(toasts.pop(), /^Não deu para descartar: sem espaço$/);
  assert.ok(!toasts.some((t) => /descartad/.test(t)));
});

test('rótulos: menu, título e botão explícitos (sem "OK"/"Confirmar" sozinhos)', () => {
  const html = fs.readFileSync(['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x)), 'utf8');
  assert.match(html, />Descartar rascunhos e alterações pendentes<\/button>/);
  assert.match(html, /id="sh-discard"[^>]*aria-label="Descartar rascunhos e alterações pendentes"/);
  assert.match(html, /id="discard-btn" onclick="uiDiscardDrafts\(\); closeSheet\(\);">Descartar rascunhos e alterações<\/button>/);
  assert.match(html.slice(html.indexOf('id="sh-discard"'), html.indexOf('id="sh-discard"') + 900), />Cancelar<\/button>/);
  assert.ok(!/em rascunho\? Os dias confirmados não mudam/.test(html), 'texto antigo saiu');
});
