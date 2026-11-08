// UX Fase C (08/11/2026) — Ajustes em categorias + subpáginas. Só navegação: os controles são os mesmos.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs'), path = require('path');
const { loadApp, freshState } = require('./harness');

const file = ['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x));
const html = fs.readFileSync(file, 'utf8');
const cfg = html.slice(html.indexOf('<section class="tabpage" id="tab-config"'), html.indexOf('</section>', html.indexOf('<section class="tabpage" id="tab-config"')));
const subOf = (id) => { const i = cfg.indexOf(`id="${id}"`); const j = cfg.lastIndexOf('<div class="cfg-sub" data-sub="', i); return cfg.slice(j).match(/data-sub="([^"]*)"/)[1]; };

test('todo controle de antes continua em Ajustes, uma vez só, na subpágina certa', () => {
  const where = { people: 'pessoas', 'task-cfg': 'tarefas', 'comp-table': 'pordia', 'cfg-diar': 'diaristas', 'cfg-rateWeekday': 'diaristas', 'cfg-rateWeekend': 'diaristas',
    rules: 'regras', 'cfg-maxFe': 'regras', 'cfg-maxAb': 'regras', 'cfg-cct': 'regras', 'team-table': 'equipe', 'app-version': '' };
  for (const [id, sub] of Object.entries(where)) {
    assert.strictEqual((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id + ' existe uma vez');
    assert.strictEqual(subOf(id), sub, id + ' em ' + (sub || 'principal'));
  }
  assert.match(cfg, /onclick="addEmployee\(\)">Adicionar funcionária<\/button>/);
  assert.strictEqual(subOf('team-table'), 'equipe');
});

test('página principal lista as categorias; cada subpágina tem título e "‹ Ajustes"', () => {
  const subs = ['pessoas', 'tarefas', 'pordia', 'diaristas', 'regras', 'equipe'];
  for (const k of subs) {
    assert.match(cfg, new RegExp(`onclick="cfgGo\\('${k}'\\)"`), 'atalho para ' + k);
    const blk = cfg.slice(cfg.indexOf(`data-sub="${k}"`));
    assert.match(blk.slice(0, 400), /hidden>\s*<button class="back-link" onclick="cfgGo\(''\)">‹ Ajustes<\/button>\s*<h1 class="lt">/);
  }
  assert.match(cfg, /onclick="showTab\('tab-domingos'\)"/, 'Domingos continua');
  assert.match(cfg, /<div class="cfg-sub" data-sub="" data-title="Ajustes">/);
});

function app() {
  const a = loadApp(freshState(loadApp()));
  const subs = ['', 'pessoas', 'regras', 'equipe'].map((k) => ({ dataset: { sub: k, title: k ? 'T-' + k : 'Ajustes' }, hidden: !!k }));
  let blurs = 0;
  const nb = { textContent: '' };
  a.document = { activeElement: { blur() { blurs++; } }, body: {}, getElementById: (id) => (id === 'nb-title' ? nb : null), querySelectorAll: (q) => (q === '#tab-config .cfg-sub' ? subs : []) };
  vm.runInContext("UI.tab='tab-config'", a);
  a.observeTitle = () => {};
  return { a, subs, nb, blurs: () => blurs };
}

test('cfgGo mostra só a subpágina pedida, troca o título e grava o campo em edição antes (blur)', () => {
  const { a, subs, nb, blurs } = app();
  a.cfgGo('regras');
  assert.deepStrictEqual(subs.map((s) => s.hidden), [true, true, false, true]);
  assert.strictEqual(nb.textContent, 'T-regras');
  assert.strictEqual(vm.runInContext('UI.cfgSub', a), 'regras');
  assert.ok(blurs() >= 1, 'tira o foco antes de trocar');
  a.cfgGo('');
  assert.deepStrictEqual(subs.map((s) => s.hidden), [false, true, true, true]);
  assert.strictEqual(nb.textContent, 'Ajustes');
});

test('atalho de Relatórios abre "Equipe e valores"', () => {
  assert.match(html, /onclick="cfgGo\('equipe'\);setTimeout\(\(\)=>document\.getElementById\('team-table'\)\.scrollIntoView/);
});
