// 10/11/2026 — Início: ignorar avisos neste aparelho até a situação mudar; avisos de salvamento não podem ser ignorados.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadApp, freshState } = require('./harness');
function app() {
  const a = loadApp(freshState(loadApp())); a.showTab = () => {};
  const els = {}; const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} } });
  vm.runInContext('document={getElementById:(id)=>__el(id),querySelector:()=>null,querySelectorAll:()=>[]}', Object.assign(a, { __el: el }));
  return { a, html: () => el('in-body').innerHTML };
}
function rascunho(a, n) { const t = a.todayISO(); a.generateRange(t, a.dAdd(t, n - 1)); }

test('aviso ignorado some e mostra "1 aviso ignorado · mostrar"; mostrar traz de volta', () => {
  const { a, html } = app(); rascunho(a, 3); a.renderInicio();
  assert.match(html(), /3 dias em rascunho/);
  const k = vm.runInContext("iaKey(['orange','3 dias em rascunho ou com alteração pendente. Revise e confirme.'])", a);
  a.iaIgnore(k);
  assert.doesNotMatch(html(), /3 dias em rascunho/);
  assert.match(html(), /aviso ignorado · mostrar/);
  a.iaShowAll();
  assert.match(html(), /3 dias em rascunho/);
});
test('situação mudou (número diferente) → o aviso volta', () => {
  const { a, html } = app(); rascunho(a, 3); a.renderInicio();
  a.iaIgnore(vm.runInContext("iaKey(['orange','3 dias em rascunho ou com alteração pendente. Revise e confirme.'])", a));
  rascunho(a, 4); a.renderInicio();
  assert.match(html(), /4 dias em rascunho/);
  assert.deepStrictEqual(JSON.parse(a.localStorage.getItem('ank_avisos_ignorados')), [], 'chave antiga esquecida');
});
test('aviso de salvamento no servidor não tem botão de ignorar', () => {
  const { a, html } = app(); a.setSync('falha', { err: 'teste' }); a.renderInicio();
  const h = html(), i = h.indexOf('o servidor não confirmou'), bloco = h.slice(h.lastIndexOf('<div class="ia', i), h.indexOf('</div>', i));
  assert.ok(i > 0); assert.doesNotMatch(bloco, /ia-x/);
});
test('textos: "Monte os próximos dias" (sem quinzena)', () => {
  const { a, html } = app(); a.renderInicio();
  assert.match(html(), /Monte os próximos dias/); assert.doesNotMatch(html(), /quinzena/);
});
