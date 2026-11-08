// UX Fase B (08/11/2026) — tela Enviar e imagem para a equipe. Equipe FICTÍCIA.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs'), path = require('path');
const { loadApp, freshState } = require('./harness');

function app(n = 6) {
  const s = freshState(loadApp());
  const base = s.team[0];
  s.team = Array.from({ length: n }, (_, i) => ({ ...(s.team[i] || base), id: 'p' + (i + 1), name: 'Pessoa ' + (i + 1), saida: undefined }));
  const a = loadApp(s);
  a.showTab = () => {};
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', hidden: false, dataset: {}, style: {}, clientWidth: 358,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  a.document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => el('x' + Math.random()), body: el('body'), addEventListener() {} };
  a.prepareShare = () => {};
  return { a, els };
}
function confirmar(a, from, to) {
  a.generateRange(from, to);
  const st = a.__get();
  for (let k = from; k <= to; k = a.dAdd(k, 1)) { st.days[k].conf = { ...st.days[k].draft, at: 1 }; st.days[k].draft = null; }
}

test('B4: período padrão começa numa segunda (fim no domingo → 2 semanas inteiras)', () => {
  const { a, els } = app();
  confirmar(a, '2026-10-26', '2026-11-22');   // último confirmado: dom 22/11
  a.renderPrintView();
  assert.strictEqual(els['print-from'].value, '2026-11-09');
  assert.strictEqual(els['print-to'].value, '2026-11-22');
  assert.match(els['pv-sum'].textContent, /^Vai na imagem: 14 dias confirmados \(09\/11 a 22\/11\), em 2 blocos de semana/);
  assert.ok(!/incompleto/.test(els['pv-sum'].textContent));
});

test('B4: fim no meio da semana também começa numa segunda', () => {
  const { a, els } = app();
  confirmar(a, '2026-10-26', '2026-11-18');   // qua 18/11
  a.renderPrintView();
  assert.strictEqual(els['print-from'].value, '2026-11-09');
});

test('B4: período escolhido começando no domingo não muda os dias e é explicado', () => {
  const { a, els } = app();
  confirmar(a, '2026-10-26', '2026-11-15');
  els['print-from'] = Object.assign(els['print-from'] || {}, {});
  a.document.getElementById('print-from').value = '2026-11-01';
  a.document.getElementById('print-to').value = '2026-11-15';
  a.renderPrintView();
  assert.strictEqual(els['print-from'].value, '2026-11-01', 'dias escolhidos não mudam');
  assert.match(els['pv-sum'].textContent, /15 dias confirmados \(01\/11 a 15\/11\), em 3 blocos.*Bloco incompleto: domingo 01\/11 sozinho\./);
});

test('B1/B2: nome do feriado e tarefa vão inteiros na imagem', () => {
  const { a, els } = app();
  confirmar(a, '2026-11-09', '2026-11-22');
  a.__get().taskDay = { '2026-11-09': 'Limpar freezers da bancada e organizar o estoque de polpas e copos' };
  a.renderPrintView();
  const h = els['print-weeks'].innerHTML;
  assert.match(h, /<span class="mq-hol">Proclamação da República<\/span>/);
  assert.match(h, /<span class="mqp-tk">Limpar freezers da bancada e organizar o estoque de polpas e copos<\/span>/);
});

test('largura da imagem acompanha a tabela mais larga (nenhuma coluna fica de fora)', () => {
  const { a } = app();
  const blk = (ws) => ({ style: {}, querySelectorAll: () => ws.map((w) => ({ scrollWidth: w })) });
  assert.strictEqual(a.exportWidthFor(blk([900, 1000])), 1100);
  const b = blk([1200, 1507]);
  assert.strictEqual(a.exportWidthFor(b), 1543);
  assert.strictEqual(b.style.width, '1543px');
});

test('estilos da imagem não dependem do tamanho da tela', () => {
  const f = ['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x));
  const css = fs.readFileSync(f, 'utf8');
  assert.match(css, /\.mq\.mqp thead th\{white-space:normal/);
  assert.match(css, /table\.mq\.mqp\{table-layout:auto;font-size:13\.5px\}/, 'celular desfaz a tabela fixa da grade');
  assert.match(css, /holder\.style\.width=exportWidthFor\(clone\)\+'px'/);
  assert.match(css, /#print-weeks\{zoom:1!important\} #print-weeks \.pdf-block\{width:auto!important\}/, 'PDF sem zoom da prévia');
});
