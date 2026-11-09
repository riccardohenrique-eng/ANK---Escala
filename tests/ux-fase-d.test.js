// UX Fase D, alternativa A (08/11/2026) — alvos de toque da grade do Montar no celular.
// Só CSS, só a grade interativa (.mq:not(.mqp)), só ≤ 700 px; sem rolagem nova; imagem/PDF intocados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');

const file = ['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x));
const html = fs.readFileSync(file, 'utf8');
const i = html.indexOf('/* --- UX Fase D, alternativa A');
const bloco = html.slice(i, html.indexOf('\n}', html.indexOf('@media (max-width:700px){', i)) + 2);

test('bloco da Fase D existe e vale só no celular', () => {
  assert.ok(i > 0, 'bloco presente');
  assert.match(bloco, /@media \(max-width:700px\)\{/);
});
test('alvos mínimos de 44 px: célula, dia e diarista (célula inteira)', () => {
  assert.match(bloco, /\.mq:not\(\.mqp\) \.mq-cell\{min-height:44px\}/);
  assert.match(bloco, /\.mq:not\(\.mqp\) \.mq-dbtn\{min-height:44px/);
  assert.match(bloco, /\.mq:not\(\.mqp\) \.mq-di \.mq-dn\{[^}]*width:100%;height:44px/);
  assert.match(bloco, /\.mq-dn::before\{[^}]*width:36px;height:36px[^}]*pointer-events:none/, 'visual compacto de 36 px, sem roubar o toque');
});
test('não alcança a imagem/PDF, não muda largura de coluna e não cria rolagem', () => {
  const regras = bloco.split('\n').filter((l) => /\{/.test(l) && !/^\s*(\/\*|@media)/.test(l));
  assert.ok(regras.length >= 4);
  regras.forEach((l) => assert.match(l, /\.mq:not\(\.mqp\)/, 'regra restrita à grade interativa: ' + l.trim()));
  assert.ok(!/overflow|scroll/.test(bloco.replace(/\/\*[\s\S]*?\*\//g, '')), 'sem overflow/rolagem');
  assert.ok(!/width:\s*\d+px\s*[;}]/.test(bloco.replace(/::before\{[^}]*\}/, '')), 'sem largura fixa de coluna');
  assert.match(html, /\.mq-scroll\{overflow:hidden;overflow:clip\}/, 'proteção A1 continua');
});
