// P0.4 (08/11/2026) — pedidos repetidos, sobrepostos e incompatíveis. Equipe FICTÍCIA (p1..p6).
// "Hoje" fixo em 08/11/2026 para o teste não mudar de resultado com o calendário.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

const F = (x) => JSON.parse(JSON.stringify(x));
function app(mut) {
  const s = freshState(loadApp());
  s.team = s.team.map((e, i) => ({ ...e, id: 'p' + (i + 1), name: 'Pessoa ' + (i + 1), saida: undefined, cond: undefined }));
  if (mut) mut(s);
  const a = loadApp(s);
  a.showTab = () => {};
  a.todayISO = () => '2026-11-08';
  return a;
}
// simula "Interpretar com IA" → conferência → "Aplicar"
const ler = (a, list) => { a.showParsed('texto', list, false, []); a.renderParsedReview(); return a.__pending(); };
const aplicar = (a) => { a.applyParsedConstraints(); };
const folga = (id, d1, d2) => ({ type: 'absence', empId: id, dateStart: d1, dateEnd: d2 || d1, note: `${id} folga` });
const turno = (id, t, d1, d2) => ({ type: 'forced_shift', empId: id, shiftType: t, dateStart: d1, dateEnd: d2 || d1, note: `${id} ${t}` });
const semIds = (cs) => F(cs).map(({ id, ...c }) => c);

test('1. pedido idêntico aplicado duas vezes: não duplica e a escala não muda', () => {
  const a = app(); const st = a.__get();
  ler(a, [folga('p1', '2026-11-12')]); aplicar(a);
  a.generateRange('2026-11-10', '2026-11-16'); const esc1 = F(st.days);
  const p = ler(a, [folga('p1', '2026-11-12')]);
  assert.strictEqual(p[0]._dup, 'vigor');
  assert.strictEqual(a.pendingNeedsCheck(p[0]), false, 'repetido não trava o Aplicar');
  aplicar(a);
  assert.strictEqual(st.constraints.length, 1, 'continua uma cópia só');
  a.generateRange('2026-11-10', '2026-11-16');
  assert.deepStrictEqual(F(st.days), esc1, 'mesmo resultado');
});

test('2. repetido dentro da mesma leva entra uma vez só', () => {
  const a = app(); const st = a.__get();
  const p = ler(a, [folga('p2', '2026-11-13'), folga('p2', '2026-11-13')]);
  assert.deepStrictEqual(F(p.map((c) => c._dup)), [null, 'leva']);
  aplicar(a);
  assert.strictEqual(st.constraints.length, 1);
});

test('3. folga × abertura obrigatória da mesma pessoa no mesmo dia: trava até escolher', () => {
  const a = app(); const st = a.__get();
  const p = ler(a, [folga('p3', '2026-11-14'), turno('p3', 'abertura', '2026-11-14')]);
  assert.ok(p.every((c) => a.pendingNeedsCheck(c)), 'os dois marcados');
  assert.ok(p.every((c) => c._conf.length === 1 && c._conf[0].where === 'leva'));
  assert.match(a.p04ItemHTML(p[0]), /Não combina com outro item desta leva.*14\/11/);
  aplicar(a);
  assert.strictEqual(st.constraints.length, 0, 'nada aplicado com conflito aberto');
  assert.strictEqual(a.__pending().length, 2, 'a leva continua na tela');
  a.p04KeepThis(p[1].id, p[0].id);
  aplicar(a);
  assert.deepStrictEqual(semIds(st.constraints), [turno('p3', 'abertura', '2026-11-14')]);
});

test('4. sobreposição parcial incompatível com pedido em vigor: Substituir manda o antigo ao histórico', () => {
  const a = app(); const st = a.__get();
  ler(a, [folga('p1', '2026-11-10', '2026-11-14')]); a.__pending().forEach((c) => a.okPending(c.id)); aplicar(a);
  const antigo = F(st.constraints[0]);
  const p = ler(a, [turno('p1', 'abertura', '2026-11-13', '2026-11-16')]);
  assert.strictEqual(p[0]._conf[0].where, 'vigor');
  assert.deepStrictEqual(F(p[0]._conf[0].dias), ['2026-11-13', '2026-11-14'], 'só os dias em comum');
  assert.ok(a.pendingNeedsCheck(p[0]));
  a.p04Replace(p[0].id, antigo.id);
  assert.strictEqual(a.pendingNeedsCheck(a.__pending()[0]), false);
  assert.match(a.p04ItemHTML(a.__pending()[0]), /Os outros dias dele \(10 a 12\/11\) deixam de valer\./, 'avisa o que sai junto');
  assert.ok(!/Está certo/.test(a.__pending()[0]._alerts.map((x) => x.t).join('')));
  aplicar(a);
  assert.deepStrictEqual(semIds(st.constraints), [turno('p1', 'abertura', '2026-11-13', '2026-11-16')]);
  assert.strictEqual(st.constraintsOld.length, 1);
  const { endedAt, endedWhy, ...arq } = st.constraintsOld[0];
  assert.deepStrictEqual(arq, antigo, 'pedido antigo guardado inteiro');
  assert.strictEqual(endedWhy, 'substituído por pedido novo');
});

test('5. sobreposição total compatível (folga dentro de férias): avisa, não trava, os dois ficam', () => {
  const a = app(); const st = a.__get();
  ler(a, [folga('p4', '2026-11-10', '2026-11-16')]);
  a.__pending().forEach((c) => a.okPending(c.id));   // férias pede "Está certo" (P0.3)
  aplicar(a);
  const p = ler(a, [folga('p4', '2026-11-12', '2026-11-13')]);
  assert.strictEqual(p[0]._over.length, 1);
  assert.strictEqual(p[0]._conf.length, 0);
  assert.strictEqual(a.pendingNeedsCheck(p[0]), false);
  assert.match(a.p04ItemHTML(p[0]), /Coincide em 12 a 13\/11.*Os dois valem/);
  aplicar(a);
  assert.strictEqual(st.constraints.length, 2);
});

test('6. novo contra existente: "Manter o antigo" não grava nada', () => {
  const a = app(); const st = a.__get();
  ler(a, [turno('p2', 'fechamento', '2026-11-11')]); aplicar(a);
  const antes = F(st.constraints);
  const p = ler(a, [turno('p2', 'abertura', '2026-11-11')]);
  assert.match(a.p04ItemHTML(p[0]), /Não combina com pedido em vigor/);
  a.removePending(p[0].id);   // botão "Manter o antigo"
  aplicar(a);
  assert.deepStrictEqual(F(st.constraints), antes);
  assert.ok(!st.constraintsOld || !st.constraintsOld.length);
});

test('7. pedidos compatíveis não geram aviso: pessoas diferentes, datas diferentes, mesmo turno', () => {
  const a = app(); const st = a.__get();
  ler(a, [folga('p1', '2026-11-12'), turno('p1', 'abertura', '2026-11-13')]); aplicar(a);
  const p = ler(a, [folga('p2', '2026-11-12'), turno('p1', 'abertura', '2026-11-13', '2026-11-14')]);
  assert.strictEqual(p[0]._conf.length + p[0]._over.length, 0);
  assert.strictEqual(p[1]._conf.length, 0);
  assert.strictEqual(p[1]._over.length, 1, 'mesmo turno em dias comuns = sobreposição compatível');
  assert.ok(!p.some((c) => a.pendingNeedsCheck(c)));
  aplicar(a);
  assert.strictEqual(st.constraints.length, 4);
});

test('8. encerrados: não geram aviso, não somem e aparecem separados', () => {
  const a = app((s) => { s.constraints = [{ id: 'velho', ...folga('p5', '2026-10-20', '2026-10-21') }]; });
  const st = a.__get();
  const p = ler(a, [folga('p5', '2026-10-20', '2026-10-21')]);
  assert.strictEqual(p[0]._dup, null, 'pedido que já terminou não conta como repetido');
  assert.deepStrictEqual(F(a.activeReqs()), []);
  a.discardParsedConstraints();
  assert.strictEqual(st.constraints.length, 1, 'encerrado não é apagado');
  a.removeConstraint('velho');
  assert.strictEqual(st.constraints.length, 0);
  assert.strictEqual(st.constraintsOld[0].id, 'velho');
  assert.strictEqual(st.constraintsOld[0].endedWhy, 'removido por você');
});

// ---- integração com P0.1 / P0.2 / P0.3 ----
function confirmar(a, from, to) {
  a.generateRange(from, to);
  const st = a.__get();
  for (let k = from; k <= to; k = a.dAdd(k, 1)) { st.days[k].conf = { ...st.days[k].draft, at: 1 }; st.days[k].draft = null; }
}

test('9. P0.1: pedido repetido não reabre alteração; conflito é resolvido antes de tocar dia confirmado', () => {
  const a = app(); const st = a.__get();
  confirmar(a, '2026-11-09', '2026-11-15');
  st.days['2026-11-14'].conf.sh.p2 = { type: 'fechamento', time: a.shiftTime(a.dDow('2026-11-14'), 'fechamento') };
  ler(a, [turno('p2', 'abertura', '2026-11-14')]); aplicar(a);
  assert.ok(a.p01State(), 'primeira vez: oferta da P0.1');
  a.p01Dismiss();
  const dias = F(st.days);
  ler(a, [turno('p2', 'abertura', '2026-11-14')]); aplicar(a);
  assert.strictEqual(a.p01State(), null, 'repetido: sem nova oferta');
  ler(a, [folga('p2', '2026-11-14')]); aplicar(a);
  assert.strictEqual(a.p01State(), null, 'conflito travado antes da P0.1');
  assert.deepStrictEqual(F(st.days), dias, 'dias confirmados intactos');
  assert.strictEqual(st.constraints.length, 1);
});

test('10. P0.2 e P0.3: resumo honesto com repetido na leva; férias ainda pedem "Está certo"; data inválida recusada', () => {
  const a = app(); const st = a.__get();
  confirmar(a, '2026-11-09', '2026-11-15');
  ler(a, [folga('p6', '2026-11-16')]); aplicar(a);
  const p = ler(a, [{ type: 'build_range', dateStart: '2026-11-10', dateEnd: '2026-11-16', note: 'monta de 10 a 16/11' }, folga('p6', '2026-11-16')]);
  assert.strictEqual(p[1]._dup, 'vigor');
  aplicar(a);
  assert.strictEqual(st.constraints.length, 1);
  assert.strictEqual(st.days['2026-11-16'].draft.sh.p6.type, 'folga', 'pedido em vigor continua valendo');
  const r = a.buildReport(a.generateRange('2026-11-16', '2026-11-16'));
  assert.match(a.reportText(r), /^Solicitados: 1 dia\. Montados: 1 \(16\/11\)\./);
  const fer = ler(a, [folga('p5', '2026-11-20', '2026-11-25')]);
  assert.ok(a.pendingNeedsCheck(fer[0]) && fer[0]._alerts.some((x) => x.k === 'cat'), 'P0.3: férias pedem conferência');
  a.discardParsedConstraints();
  const ruim = ler(a, [folga('p5', '2026-11-31')]);
  assert.strictEqual(ruim.length, 0, 'P0.3: 31/11 recusado');
});

test('11 e 12. cancelar (Descartar) não muda nada: pedidos, histórico e dias iguais', () => {
  const a = app(); const st = a.__get();
  ler(a, [folga('p1', '2026-11-10', '2026-11-12')]); aplicar(a);
  a.generateRange('2026-11-10', '2026-11-12');
  const antes = F({ c: st.constraints, o: st.constraintsOld || [], d: st.days });
  const p = ler(a, [turno('p1', 'fechamento', '2026-11-11'), folga('p1', '2026-11-10', '2026-11-12')]);
  a.p04Replace(p[0].id, st.constraints[0].id);   // escolheu substituir, mas desistiu
  a.discardParsedConstraints();
  assert.deepStrictEqual(F({ c: st.constraints, o: st.constraintsOld || [], d: st.days }), antes);
  assert.strictEqual(a.__pending().length, 0);
});

test('Em vigor separa atuais e encerrados sem erro', () => {
  const a = app((s) => { s.constraints = [{ id: 'v', ...folga('p1', '2026-11-20') }, { id: 'e', ...folga('p2', '2026-10-01') }]; s.constraintsOld = [{ id: 'x', ...folga('p3', '2026-11-12'), endedAt: 1, endedWhy: 'substituído por pedido novo' }]; });
  let html = '';
  a.document = { getElementById: () => ({ set innerHTML(v) { html = v; } }) };
  a.renderActiveConstraints();
  const [vig, enc] = html.split('<details');
  assert.match(vig, /Pessoa 1 ausente/);
  assert.ok(!/Pessoa 2|Pessoa 3/.test(vig));
  assert.match(enc, /Encerrados \(2\)/);
  assert.match(enc, /Pessoa 2 ausente .* · terminou/);
  assert.match(enc, /Pessoa 3 ausente .* · substituído por pedido novo/);
});

test('versão local é posterior à publicada (p01 de 08/11)', () => {
  const fs = require('fs'), path = require('path');
  const f = ['index.html', 'gerador-escala-ank.html'].map((n) => path.join(__dirname, '..', n)).find((x) => fs.existsSync(x));
  const v = (fs.readFileSync(f, 'utf8').match(/const APP_VERSION='([^']+)'/) || [])[1];
  assert.ok(v && v > '2026.11.08.2-p01', v);
});

// ---------- Etapa 08C: substituição só com autorização válida ----------
function comAntigo() {
  const a = app(); const st = a.__get();
  ler(a, [folga('p1', '2026-11-10', '2026-11-12')]); aplicar(a);   // 3 dias = folga
  return { a, st, old: st.constraints[0] };
}
const vigor = (st) => F(st.constraints).map((c) => c.id);

test('08C-1/2. defeito original: Substituir e depois mudar datas para fora → antigo continua em vigor', () => {
  const { a, st, old } = comAntigo();
  const p = ler(a, [turno('p1', 'abertura', '2026-11-12')]);
  a.p04Replace(p[0].id, old.id);
  a.editPendingDate(p[0].id, 'dateStart', '2026-11-20'); a.editPendingDate(p[0].id, 'dateEnd', '2026-11-20');
  const c = a.__pending()[0];
  assert.strictEqual(c._replace.length, 0, 'autorização caiu');
  assert.match(a.p04ItemHTML(c), /escolha de substituir .* foi desfeita porque o pedido mudou\. O antigo continua em vigor/);
  aplicar(a);
  assert.ok(vigor(st).includes(old.id), 'antigo segue em vigor');
  assert.ok(!(st.constraintsOld || []).length, 'nada encerrado');
  assert.strictEqual(st.constraints.length, 2, 'novo entrou sem substituir');
});

test('08C-3. mudar para outro período ainda sobreposto: pede nova escolha e trava o Aplicar', () => {
  const { a, st, old } = comAntigo();
  const p = ler(a, [turno('p1', 'abertura', '2026-11-12', '2026-11-14')]);
  a.p04Replace(p[0].id, old.id);
  a.editPendingDate(p[0].id, 'dateStart', '2026-11-11');   // alcance muda: 11–12 em comum
  const c = a.__pending()[0];
  assert.strictEqual(c._replace.length, 0);
  assert.ok(a.pendingNeedsCheck(c), 'conflito volta a travar');
  aplicar(a);
  assert.deepStrictEqual(vigor(st), [old.id], 'nada aplicado');
  a.p04Replace(c.id, old.id);                                // nova escolha, agora para o alcance novo
  aplicar(a);
  assert.deepStrictEqual(F(st.constraintsOld.map((x) => x.id)), [old.id]);
});

test('08C-4. mudar pessoa, tipo ou turno depois de Substituir invalida a escolha', () => {
  for (const muda of [(c) => { c.empId = 'p2'; }, (c) => { c.shiftType = 'fechamento'; }, (c) => { c.type = 'absence'; delete c.shiftType; }]) {
    const { a, st, old } = comAntigo();
    const p = ler(a, [turno('p1', 'abertura', '2026-11-12')]);
    a.p04Replace(p[0].id, old.id);
    muda(a.__pending()[0]);
    a.renderParsedReview();
    if (!a.pendingNeedsCheck(a.__pending()[0])) aplicar(a);
    assert.ok(vigor(st).includes(old.id), 'antigo continua');
    assert.ok(!(st.constraintsOld || []).length);
  }
});

test('08C-5. substituição válida sem mudanças: aplica e mostra antes qual pedido sai', () => {
  const { a, st, old } = comAntigo();
  const p = ler(a, [turno('p1', 'abertura', '2026-11-12')]);
  a.p04Replace(p[0].id, old.id);
  assert.match(a.p04ItemHTML(a.__pending()[0]), /Vai substituir o pedido em vigor: Pessoa 1 ausente .*10\/11.*12\/11.*Os outros dias dele \(10 a 11\/11\) deixam de valer/);
  aplicar(a);
  assert.deepStrictEqual(F(st.constraintsOld.map((x) => x.id)), [old.id]);
  assert.strictEqual(st.constraints.length, 1);
});

test('08C-6. cancelar depois de Substituir não muda nada', () => {
  const { a, st, old } = comAntigo();
  const antes = F({ c: st.constraints, o: st.constraintsOld || [] });
  const p = ler(a, [turno('p1', 'abertura', '2026-11-12')]);
  a.p04Replace(p[0].id, old.id);
  a.discardParsedConstraints();
  assert.deepStrictEqual(F({ c: st.constraints, o: st.constraintsOld || [] }), antes);
});

test('08C-7. aplicar sem nenhuma substituição continua normal', () => {
  const { a, st, old } = comAntigo();
  ler(a, [folga('p3', '2026-11-12'), turno('p4', 'fechamento', '2026-11-13')]); aplicar(a);
  assert.strictEqual(st.constraints.length, 3);
  assert.ok(vigor(st).includes(old.id));
  assert.ok(!(st.constraintsOld || []).length);
});

test('08C-8. pedidos que não participaram ficam intactos; histórico anterior preservado', () => {
  const { a, st, old } = comAntigo();
  ler(a, [folga('p5', '2026-11-15')]); aplicar(a);
  const outro = F(st.constraints.find((c) => c.empId === 'p5'));
  st.constraintsOld = [{ id: 'hist', ...folga('p6', '2026-11-01'), endedAt: 1, endedWhy: 'removido por você' }];
  const p = ler(a, [turno('p1', 'abertura', '2026-11-12')]);
  a.p04Replace(p[0].id, old.id); aplicar(a);
  assert.deepStrictEqual(F(st.constraints.find((c) => c.empId === 'p5')), outro);
  assert.deepStrictEqual(F(st.constraintsOld.map((x) => x.id)), ['hist', old.id]);
});

test('08C-9. revalida no Aplicar: autorização velha (forjada ou fora de data) não encerra nada', () => {
  const { a, st, old } = comAntigo();
  const p = ler(a, [turno('p1', 'abertura', '2026-11-12')]);
  a.p04Replace(p[0].id, old.id);
  const c = a.__pending()[0];
  c.dateStart = c.dateEnd = '2026-11-25';            // muda sem passar pela tela (sem renderizar)
  aplicar(a);
  assert.ok(vigor(st).includes(old.id), 'Aplicar recalculou e não substituiu');
  assert.ok(!(st.constraintsOld || []).length);
  const { a: b, st: s2, old: o2 } = comAntigo();
  const q = ler(b, [turno('p1', 'abertura', '2026-11-12')]);
  b.__pending()[0]._replace = [o2.id];               // formato antigo (só id), sem assinatura
  b.applyParsedConstraints();
  assert.deepStrictEqual(vigor(s2), [o2.id], 'sem autorização válida, conflito trava');
  assert.strictEqual(b.__pending().length, 1);
});

test('08C-10. P0.1/P0.2/P0.3 seguem: substituição não confirma nem envia; dia confirmado intacto', () => {
  const a = app(); const st = a.__get();
  confirmar(a, '2026-11-09', '2026-11-15');
  ler(a, [folga('p1', '2026-11-12')]); aplicar(a); a.p01Dismiss && a.p01Dismiss();
  const dias = F(st.days); const old = st.constraints[0];
  const p = ler(a, [turno('p1', 'abertura', '2026-11-12')]);
  a.p04Replace(p[0].id, old.id); aplicar(a);
  assert.deepStrictEqual(F(Object.fromEntries(Object.entries(st.days).map(([k, d]) => [k, d.conf]))), F(Object.fromEntries(Object.entries(dias).map(([k, d]) => [k, d.conf]))), 'confirmados iguais');
  assert.ok(!Object.values(st.days).some((d) => d.conf && d.conf.sent), 'nada enviado');
  if (a.p01State()) { a.p01Dismiss(); }
  assert.deepStrictEqual(F(st.days), dias, 'sem autorização da P0.1, nenhum dia muda');
});
