// UX Fase B.3 (08/11/2026) — exportação nunca entrega arquivo inválido; PDF largo exige escolha explícita.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadApp, freshState } = require('./harness');

function app() {
  const s = freshState(loadApp());
  const a = loadApp(s);
  a.showTab = () => {};
  return a;
}
const fakeBlob = (bytes, type = 'image/png') => ({ size: bytes.length, type, slice: (x, y) => ({ arrayBuffer: async () => Uint8Array.from(bytes.slice(x, y)).buffer }) });
const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

test('1. render que devolve null é recusado', async () => {
  const a = app();
  await assert.rejects(a.checkPngBlob(null), /não conseguiu desenhar/);
});
test('2. imagem vazia é recusada', async () => {
  const a = app();
  await assert.rejects(a.checkPngBlob(fakeBlob([])), /vazia/);
});
test('3. conteúdo inválido com extensão PNG ("null", 4 bytes; ou sem assinatura PNG) é recusado', async () => {
  const a = app();
  await assert.rejects(a.checkPngBlob(fakeBlob([...Buffer.from('null')])), /vazia/);
  await assert.rejects(a.checkPngBlob(fakeBlob(new Array(4000).fill(65))), /corrompida/);
  await assert.rejects(a.checkPngBlob(fakeBlob([...PNG, ...new Array(4000).fill(0)], 'text/plain')), /formato inválido/);
  const ok = fakeBlob([...PNG, ...new Array(4000).fill(0)]);
  assert.strictEqual(await a.checkPngBlob(ok), ok, 'PNG de verdade passa');
});
test('4/5. duas e quatro semanas: resolução cheia (×2)', () => {
  const a = app();
  assert.deepStrictEqual({ ...a.exportPlan(1102, 941, 2) }, { ok: true, scale: 2, px: 2204 * 1882 });
  const p = a.exportPlan(1227, 2449, 4);
  assert.strictEqual(p.ok, true); assert.strictEqual(p.scale, 2);
});
test('6/7. período longo: reduz a resolução de forma proporcional, dentro do limite, sem cair abaixo de 1×', () => {
  const a = app();
  const p = a.exportPlan(1229, 6152, 10);
  assert.strictEqual(p.ok, true);
  assert.ok(p.scale < 2 && p.scale >= 1, String(p.scale));
  assert.ok(p.px <= vm.runInContext('EXPORT_MAX_PX', a));
  assert.ok(Math.abs((1229 * p.scale) / (6152 * p.scale) - 1229 / 6152) < 1e-9, 'mesma proporção');
});
test('excessivo: recusa com orientação de quantas semanas cabem (nunca imagem ilegível)', () => {
  const a = app();
  const p = a.exportPlan(1229, 22000, 36);
  assert.strictEqual(p.ok, false);
  assert.ok(p.maxWeeks >= 1 && p.maxWeeks < 36, String(p.maxWeeks));
  assert.match(p.reason, /longo demais para uma imagem legível.*Escolha até \d+ semanas por vez/);
  assert.strictEqual(a.exportPlan(0, 100, 1).ok, false);
});
test('canvas do tamanho errado ou vazio é recusado', () => {
  const a = app();
  assert.throws(() => a.checkCanvas({ width: 0, height: 0 }, 10, 10), /não conseguiu desenhar/);
  assert.throws(() => a.checkCanvas({ width: 100, height: 100 }, 200, 200), /tamanho errado/);
  const branco = { width: 64, height: 8, getContext: () => ({ getImageData: (x, y, w) => ({ data: new Uint8ClampedArray(w * 4).fill(255) }) }) };
  assert.throws(() => a.checkCanvas(branco, 64, 8), /em branco/);
  const desenho = { width: 64, height: 8, getContext: () => ({ getImageData: (x, y, w) => { const d = new Uint8ClampedArray(w * 4).fill(255); d[0] = 40; return { data: d }; } }) };
  a.checkCanvas(desenho, 64, 8);
});

function pdfApp(tableW) {
  const a = app();
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: id === 'print-from' ? '2026-11-09' : '2026-11-22', hidden: true, style: {} });
  const table = { style: { width: '', minWidth: '' }, get offsetWidth() { return this.style.width === 'min-content' ? tableW : 1066; } };
  const block = { querySelectorAll: () => [table] };
  els['print-weeks'] = { style: { zoom: '0.3' }, querySelector: () => block };
  a.document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [] };
  let prints = 0;
  a.window.print = () => { prints++; };
  vm.runInContext('window.print=function(){ __prints(); }', a);
  a.__prints = () => { prints++; };
  return { a, els, prints: () => prints };
}
test('10. PDF que cabe na folha: gera direto, sem aviso', () => {
  const { a, els, prints } = pdfApp(1000);
  assert.strictEqual(a.pdfTooWide(), 0, 'mede a largura mínima, não os 100% da caixa');
  assert.strictEqual(els['print-weeks'].style.zoom, '0.3', 'zoom da prévia restaurado');
  assert.strictEqual(a.gerarPdf(), true);
  assert.strictEqual(prints(), 1);
  assert.strictEqual(els['pdf-warn'].hidden, true);
});
test('11/12. PDF mais largo que a folha: aviso antes, nada é gerado sem escolha explícita', () => {
  const { a, els, prints } = pdfApp(1188);
  assert.strictEqual(a.pdfTooWide(), 1188);
  assert.strictEqual(a.gerarPdf(), false, 'primeiro toque só avisa');
  assert.strictEqual(prints(), 0);
  assert.strictEqual(els['pdf-warn'].hidden, false);
  assert.match(els['pdf-warn'].innerHTML, /O PDF pode sair cortado.*1188 px para 1062 px.*Usar a imagem.*Gerar PDF mesmo assim.*Cancelar/s);
  a.pdfWarnClose();
  assert.strictEqual(prints(), 0, 'cancelar não gera');
  assert.strictEqual(a.gerarPdf(true), true, 'só com "Gerar PDF mesmo assim"');
  assert.strictEqual(prints(), 1);
});
test('falha guardada: "Enviar no WhatsApp" mostra o motivo e não compartilha nada', async () => {
  const a = app();
  const toasts = []; let shared = 0;
  a.toast = (m) => { toasts.push(m); };
  vm.runInContext('navigator.canShare=()=>true; navigator.share=async()=>{ __shared(); };', a);
  a.__shared = () => { shared++; };
  vm.runInContext("shareFile=null; shareJob=null; shareErr=new Error('o período é longo demais para uma imagem legível no celular. Escolha até 26 semanas por vez');", a);
  await a.shareEscala();
  assert.strictEqual(shared, 0);
  assert.match(toasts[0], /^Não deu para gerar a imagem: o período é longo demais/);
});
