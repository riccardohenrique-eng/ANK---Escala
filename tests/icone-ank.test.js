// Ícone ANK (opção D, 08/11/2026): arquivos existem, tamanhos e formato certos, sem transparência,
// manifesto e index.html apontam só para arquivos que existem, nenhum resto do ícone antigo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const app = ['index.html', 'gerador-escala-ank.html'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
const html = fs.readFileSync(app, 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
function png(rel) {   // largura, altura e tipo de cor do cabeçalho IHDR
  const b = fs.readFileSync(path.join(root, rel.replace(/^\//, '')));
  assert.strictEqual(b.toString('hex', 0, 8), '89504e470d0a1a0a', rel + ' não é PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), cor: b[25] };   // cor 2 = RGB (sem alfa)
}

test('ícones do manifesto: existem, PNG, tamanho declarado = real, sem transparência; tem "any" e "maskable"', () => {
  assert.ok(manifest.icons.length >= 3);
  for (const ic of manifest.icons) {
    const p = png(ic.src), [w, h] = ic.sizes.split('x').map(Number);
    assert.strictEqual(ic.type, 'image/png');
    assert.deepStrictEqual([p.w, p.h], [w, h], ic.src);
    assert.strictEqual(p.cor, 2, ic.src + ' deve ser RGB opaco');
  }
  const purposes = manifest.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('any') && purposes.includes('maskable'));
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'));
});

test('index.html: apple-touch-icon 180×180 opaco e favicon 32×32 apontam para arquivos que existem', () => {
  const apple = html.match(/<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)">/);
  const fav = html.match(/<link rel="icon" type="image\/png" sizes="32x32" href="([^"]+)">/);
  assert.ok(apple && fav);
  const a = png(apple[1]), f = png(fav[1]);
  assert.deepStrictEqual([a.w, a.h, a.cor], [180, 180, 2]);
  assert.deepStrictEqual([f.w, f.h], [32, 32]);
  assert.match(html, /<link rel="manifest" href="\/manifest.json">/);
});

test('nenhuma referência aos ícones antigos (icon-192/icon-512)', () => {
  assert.doesNotMatch(html, /icons\/icon-(192|512)\.png/);
  assert.doesNotMatch(JSON.stringify(manifest), /icons\/icon-(192|512)\.png/);
  assert.ok(!fs.existsSync(path.join(root, 'icons', 'icon-192.png')) && !fs.existsSync(path.join(root, 'icons', 'icon-512.png')));
});
