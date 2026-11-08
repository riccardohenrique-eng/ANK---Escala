// UX Fase A (08/11/2026) — marcação da grade do Montar: situação do dia com símbolo + texto,
// feriado legível, resumo sem palavra solta, grade volta ao topo ao trocar de quinzena. Equipe FICTÍCIA.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

function app() {
  const s = freshState(loadApp());
  s.team = s.team.map((e, i) => ({ ...e, id: 'p' + (i + 1), name: 'Pessoa ' + (i + 1), saida: undefined }));
  const a = loadApp(s);
  a.showTab = () => {};
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', hidden: false, dataset: {}, style: {}, scrollTop: 0, scrollLeft: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() { this._l = (this._l || 0) + 1; }, setAttribute() {}, removeAttribute() {}, appendChild() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  a.document = { getElementById: el, querySelector: (q) => el('q:' + q), querySelectorAll: () => [], createElement: () => el('x' + Math.random()), body: el('body'), addEventListener() {} };
  return { a, els, el };
}
function confirmar(a, from, to) {
  a.generateRange(from, to);
  const st = a.__get();
  for (let k = from; k <= to; k = a.dAdd(k, 1)) { st.days[k].conf = { ...st.days[k].draft, at: 1 }; st.days[k].draft = null; }
}

test('A2: cada situação do dia tem símbolo próprio + texto (não só cor)', () => {
  const { a } = app();
  const S = require('vm').runInContext('STATUS_SYM', a);
  const T = require('vm').runInContext('STATUS_TXT', a);
  const ks = Object.keys(T);
  assert.deepStrictEqual(Object.keys(S).sort(), ks.sort());
  assert.strictEqual(new Set(Object.values(S)).size, ks.length, 'símbolos diferentes');
  assert.ok(!Object.values(S).some((x) => /[\u{1F300}-\u{1FAFF}]/u.test(x)), 'sem emoji');
});

test('A2/A3: grade traz título/aria com a situação, feriado com nome completo e forma curta', () => {
  const { a, els } = app();
  confirmar(a, '2026-11-02', '2026-11-15');
  a.markSent(a.dRange('2026-11-02', '2026-11-08'));
  const st = a.__get();
  st.days['2026-11-12'].draft = JSON.parse(JSON.stringify(st.days['2026-11-12'].conf));
  require('vm').runInContext("MQ.start='2026-11-02'", a);
  a.renderMontar();
  const h = els['mq-body'].innerHTML;
  assert.match(h, /class="mq-st s-enviada" title="enviada ao grupo" aria-label="enviada ao grupo">.*?<span class="sm" aria-hidden="true">✓/);
  assert.match(h, /class="mq-st s-pendente" title="alteração pendente"/);
  assert.match(h, /class="mq-st s-confirmada" title="confirmada, não enviada"/);
  assert.match(h, /<span class="mq-hol" title="Finados"><span class="lg">Finados<\/span><span class="sm">feriado<\/span><\/span>/);
  assert.match(h, /id="mq-r-2026-11-02"/, 'primeiro dia presente');
  assert.match(h, /id="mq-r-2026-11-15"/, 'último dia presente');
});

test('A4: resumo do topo quebra só entre as partes', () => {
  const { a, els } = app();
  confirmar(a, '2026-11-02', '2026-11-15');
  require('vm').runInContext("MQ.start='2026-11-02'", a);
  a.renderMontar();
  const sub = els['mq-sub'].innerHTML;
  assert.match(sub, /^<span class="nw">14 de 14 dias montados<\/span> · <span class="nw">14 sem enviar<\/span>$/);
});

test('A1: trocar de quinzena volta a grade ao topo; editar na mesma quinzena não mexe', () => {
  const { a, els } = app();
  confirmar(a, '2026-11-02', '2026-11-29');
  require('vm').runInContext("MQ.start='2026-11-02'", a);
  a.renderMontar();
  const host = els['mq-body'];
  host.scrollTop = 300; a.renderMontar();
  assert.strictEqual(host.scrollTop, 300, 'mesma quinzena: mantém a posição');
  a.mqShift(1);
  assert.strictEqual(host.scrollTop, 0, 'outra quinzena: topo');
  assert.strictEqual(host.dataset.start, '2026-11-16');
  assert.strictEqual(host._l, 1, 'vigia de rolagem instalado uma vez só');
});
