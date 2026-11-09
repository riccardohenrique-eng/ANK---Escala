// UX Fase E.4 (08/11/2026) — "Remover da equipe": aviso honesto e botões explícitos. Lógica de remoção igual.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs'), path = require('path');
const { loadApp, freshState } = require('./harness');
const F = (x) => JSON.parse(JSON.stringify(x));
const html = fs.readFileSync(['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x)), 'utf8');

function app() {
  const a = loadApp(freshState(loadApp()));
  a.showTab = () => {};
  const els = {}; const el = (id) => els[id] || (els[id] = { id, textContent: '', innerHTML: '', hidden: true, style: {} });
  const sheets = [];
  a.openSheet = (id) => { sheets.push('abrir:' + id); };
  a.closeSheet = () => { sheets.push('fechar'); };
  const orig = a.document;
  a.document = new Proxy(orig, { get: (t, k) => (k === 'getElementById' ? (id) => (id === 'remove-emp-msg' ? el(id) : t.getElementById(id)) : t[k]) });
  a.generateRange('2026-11-02', '2026-11-08');
  const st = a.__get();
  for (let k = '2026-11-02'; k <= '2026-11-08'; k = a.dAdd(k, 1)) { st.days[k].conf = { ...st.days[k].draft, at: 1 }; st.days[k].draft = null; }
  return { a, st, els, sheets };
}

test('tocar no × só abre a confirmação; nada é removido', () => {
  const { a, st, els, sheets } = app();
  const antes = F(st.team);
  a.removeEmployee(1);
  assert.deepStrictEqual(sheets, ['abrir:sh-remove-emp']);
  assert.deepStrictEqual(F(st.team), antes);
  assert.match(els['remove-emp-msg'].textContent, new RegExp('^Remover ' + antes[1].name + ' da equipe\\?'));
});

test('Cancelar não altera nada', () => {
  const { a, st, sheets } = app();
  const antes = F(st);
  a.removeEmployee(1); a.closeSheet();   // botão "Cancelar" só fecha a folha
  assert.deepStrictEqual(F(st), antes);
  assert.deepStrictEqual(sheets, ['abrir:sh-remove-emp', 'fechar']);
});

test('"Remover da equipe" remove a mesma pessoa, como antes (só depois da confirmação)', () => {
  const { a, st } = app();
  const ref = F(st.team); ref.splice(1, 1);
  const quem = st.team[1].id;
  a.removeEmployee(1);
  assert.ok(st.team.some((e) => e.id === quem), 'ainda não removida');
  a.doRemoveEmployee();
  assert.deepStrictEqual(F(st.team), ref, 'mesmo efeito da remoção antiga (splice)');
  a.doRemoveEmployee();
  assert.deepStrictEqual(F(st.team), ref, 'segundo toque não remove mais ninguém');
});

test('a mensagem corresponde ao comportamento real', () => {
  const { a, st, els } = app();
  const p = st.team[1];
  a.removeEmployee(1);
  const msg = els['remove-emp-msg'].textContent;
  assert.match(msg, /deixa de aparecer nas escalas, nas imagens, nos PDFs e nos relatórios, inclusive nos períodos anteriores/);
  assert.match(msg, /Os registros continuam armazenados, mas não aparecem mais nessas telas/);
  assert.match(msg, /“Último dia de trabalho” em Ajustes › Condições de cada pessoa/);
  a.doRemoveEmployee();
  const semana = a.dRange('2026-11-02', '2026-11-08');
  assert.ok(!a.visibleTeam(semana).some((e) => e.id === p.id), 'some da escala/imagem/PDF do período anterior');
  assert.ok(!st.team.some((e) => e.id === p.id), 'some da lista dos relatórios');
  assert.ok(Object.values(st.days).some((d) => d.conf.sh[p.id]), 'registros continuam armazenados');
});

test('folha com "Remover da equipe" e "Cancelar", fora das outras folhas; sem confirm() nativo', () => {
  const i = html.indexOf('<div class="sheet asheet" id="sh-remove-emp"');
  const blk = html.slice(i, html.indexOf('</div>\n</div>\n', i));
  assert.match(blk, /id="remove-emp-btn" onclick="doRemoveEmployee\(\)">Remover da equipe<\/button>/);
  assert.match(blk, />Cancelar<\/button>/);
  const antes = html.slice(html.indexOf('<div class="sheet asheet" id="sh-discard"'), i);
  assert.strictEqual((antes.match(/<div\b/g) || []).length, (antes.match(/<\/div>/g) || []).length, 'folha de descarte fechada antes (não aninhada)');
  const fn = html.slice(html.indexOf('function removeEmployee('), html.indexOf('function doRemoveEmployee('));
  assert.ok(!/confirm\(/.test(fn));
  assert.ok(!/Os dias já confirmados continuam no histórico/.test(html), 'texto antigo saiu');
});
