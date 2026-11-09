// UX Fase E (08/11/2026) — polimento: mesmos nomes de situação em todas as telas, rótulos fiéis ao que a ação faz,
// legibilidade residual. Só interface: motor, regras, dados, sincronização e exportação intocados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { loadApp, freshState } = require('./harness');

const file = ['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x));
const html = fs.readFileSync(file, 'utf8');
const i = html.indexOf('/* UX Fase E (08/11/2026)');
const css = html.slice(i, html.indexOf('\n', html.indexOf('.lvl button[aria-pressed="true"][data-l="off"]', i)));

test('legenda do Início usa os mesmos nomes e símbolos da legenda do Montar', () => {
  const app = loadApp();
  const leg = Object.fromEntries(app.IW_LEG ?? vm2(app));
  const montar = html.match(/<div class="mq-leg2"[^>]*>([\s\S]*?)<\/div>/)[1];
  for (const [st, nome] of Object.entries(leg)) {
    assert.ok(montar.includes(`class="s-${st}"`), 'estado no Montar: ' + st);
    assert.ok(montar.includes(`</b>${nome}</span>`), `mesmo nome no Montar: ${st} = ${nome}`);
  }
  assert.deepStrictEqual(Object.keys(leg).sort(), ['confirmada', 'enviada', 'mudou', 'pendente', 'rascunho']);
  assert.ok(!/>a confirmar</.test(html), 'nome antigo "a confirmar" saiu');
  assert.ok(!/class="iw-dot s-/.test(html), 'Início não depende só de cor');
});
function vm2(app) { return require('vm').runInContext('IW_LEG', app); }

test('textos de situação: Confirmar fala de dias para confirmar; plural correto', () => {
  assert.ok(!/ainda não enviado\$\{/.test(html), 'Confirmar não chama rascunho de "não enviado"');
  assert.match(html, /para confirmar \(rascunho ou alteração pendente\), a partir de/);
  assert.match(html, /\$\{mud\.length>1\?'s mudaram':' mudou'\} após o envio/);
  assert.match(html, /\$\{changed\.length>1\?'mudaram':'mudou'\} após o envio/);
  assert.ok(!/como “não enviado”/.test(html), 'sugestão aplicada vira rascunho');
});

test('"Descartar rascunhos" só descarta rascunho; dia confirmado não enviado continua', () => {
  assert.match(html, /onclick="openSheet\('sh-discard'\)">Descartar rascunhos e alterações pendentes<\/button>/);
  assert.match(html, /onclick="uiDiscardDrafts\(\); closeSheet\(\);">Descartar rascunhos e alterações<\/button>/);
  assert.ok(!/Apagar o que (ainda )?não foi enviado/.test(html));
  const app = loadApp(freshState(loadApp()));
  app.showTab = () => {};
  app.generateRange('2026-11-09', '2026-11-12');
  const st = app.__get();
  st.days['2026-11-09'].conf = { ...st.days['2026-11-09'].draft, at: 1 }; st.days['2026-11-09'].draft = null;   // confirmada, não enviada
  app.uiDiscardDrafts();
  assert.ok(app.__get().days['2026-11-09'] && app.__get().days['2026-11-09'].conf, 'confirmada fica');
  assert.strictEqual(app.dayStatus('2026-11-09'), 'confirmada');
  assert.ok(!app.__get().days['2026-11-10'], 'rascunho sem confirmação some');
});

test('Regras: "Metas de rodízio" aponta para onde o valor é definido', () => {
  assert.match(html, /\(definido abaixo, em Metas e pausa\)\./);
  const metas = html.indexOf('METAS E PAUSA') > 0 ? 'METAS E PAUSA' : 'Metas e pausa';
  assert.ok(html.includes(metas));
});

test('CSS da Fase E: só telas do app, sem tocar na imagem, na grade ou em rolagem', () => {
  assert.ok(i > 0, 'bloco presente');
  const regras = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.mqp|#print-weeks|\.mq[ :.{-]|\.mq-/.test(regras), 'não alcança a imagem nem a grade do Montar');
  assert.ok(!/overflow|position|[{;](min-|max-)?height/.test(regras), 'sem rolagem, posição ou altura novas');
  assert.match(html, /#print-weeks \*\{text-wrap:wrap\}/, 'imagem continua com quebra normal');
  assert.match(regras, /\.lvl button\[aria-pressed="true"\]\[data-l="off"\]\{background:#fff/, 'Desligada marcada fica visível');
  assert.match(regras, /table\.team-cfg select\{min-width:116px/, '"Mensalista" cabe no seletor');
});
