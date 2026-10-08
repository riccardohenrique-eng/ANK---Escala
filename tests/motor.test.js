// Motor de geração (generateRange): regras fixas da loja, 2 folgas por semana, diarista quando falta gente.
// Rodar: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

function gerar(de, ate, constraints = []) {
  const base = loadApp();
  const app = loadApp(freshState(base, { constraints }));
  app.generateRange(de, ate);
  return app;
}
const dias = (app) => Object.keys(app.__get().days).sort();
const draft = (app, k) => app.__get().days[k].draft;
const bloqueios = (app) => dias(app).flatMap((k) => app.checkDay(k).flags.filter((f) => f.l === 'block').map((f) => `${k} ${f.msg}`));
function folgasPorSemana(app) {
  const out = {};
  dias(app).forEach((k) => {
    const m = app.dMon(k), sh = draft(app, k).sh;
    Object.entries(sh).forEach(([id, c]) => {
      out[m] = out[m] || {}; out[m][id] = out[m][id] || { folga: 0, ferias: 0 };
      if (c.type === 'folga') out[m][id].folga++;
      if (c.type === 'ferias') out[m][id].ferias++;
    });
  });
  return out;
}

test('4 semanas normais: nenhum bloqueio e todas com pelo menos 2 folgas por semana', () => {
  const app = gerar('2026-10-12', '2026-11-08');
  assert.deepStrictEqual(bloqueios(app), []);
  Object.entries(folgasPorSemana(app)).forEach(([m, p]) =>
    Object.entries(p).forEach(([id, c]) => assert.ok(c.folga >= 2, `${id} com ${c.folga} folga(s) na semana de ${m}`)));
});

test('condições fixas: Maria nunca fecha, Maria José não fecha sáb/dom, Duda só fecha qua–sex', () => {
  const app = gerar('2026-10-12', '2026-11-08');
  dias(app).forEach((k) => {
    const w = app.dDow(k), sh = draft(app, k).sh;
    assert.notStrictEqual(sh.maria.type, 'fechamento', `Maria fechando em ${k}`);
    if (w >= 5) assert.notStrictEqual(sh.mjose.type, 'fechamento', `Maria José fechando no fim de semana ${k}`);
    if (w >= 2 && w <= 4) assert.ok(['fechamento', 'folga', 'ferias'].includes(sh.duda.type), `Duda em ${sh.duda.type} em ${k}`);
  });
});

test('toda abertura e todo fechamento tem alguém do caixa e pelo menos 2 pessoas', () => {
  const app = gerar('2026-10-12', '2026-11-08');
  const caixa = new Set(app.__get().team.filter((e) => e.podeOperarCaixa).map((e) => e.id));
  dias(app).forEach((k) => {
    const v = draft(app, k);
    [['abertura', 'ab'], ['fechamento', 'fe']].forEach(([t, d]) => {
      const fix = Object.entries(v.sh).filter(([, c]) => c.type === t).map(([id]) => id);
      const dia = v.diar.filter((x) => x.t === d).length;
      assert.ok(fix.some((id) => caixa.has(id)), `${t} sem caixa em ${k}`);
      assert.ok(fix.length + dia >= 2, `${t} com ${fix.length + dia} pessoa(s) em ${k}`);
    });
  });
});

test('semana com férias (Joeli): sem bloqueio, diarista cobre e ninguém perde folga', () => {
  const app = gerar('2026-09-21', '2026-09-27', [{ type: 'absence', empId: 'joeli', dateStart: '2026-09-21', dateEnd: '2026-09-30' }]);
  assert.deepStrictEqual(bloqueios(app), []);
  const sem = folgasPorSemana(app)['2026-09-21'];
  Object.entries(sem).filter(([id]) => id !== 'joeli').forEach(([id, c]) => assert.ok(c.folga >= 2, `${id} com ${c.folga} folga(s)`));
  assert.strictEqual(sem.joeli.ferias, 7);
  const diaristasSemana = dias(app).reduce((n, k) => n + draft(app, k).diar.length, 0);
  assert.ok(diaristasSemana > 2, 'esperava diarista extra além das do fim de semana');
});

test('edição manual sobrevive a gerar de novo', () => {
  const app = gerar('2026-10-12', '2026-10-18');
  const st = app.__get();
  st.days['2026-10-14'].draft.sh.marta = { type: 'folga', time: null, manual: true };
  app.generateRange('2026-10-12', '2026-10-18');
  assert.strictEqual(draft(app, '2026-10-14').sh.marta.type, 'folga');
  assert.ok(draft(app, '2026-10-14').sh.marta.manual);
});

test('gerar não mexe em dia confirmado', () => {
  const app = gerar('2026-10-12', '2026-10-18');
  const st = app.__get();
  const k = '2026-10-13';
  st.days[k] = { conf: JSON.parse(JSON.stringify(st.days[k].draft)), draft: null };
  const antes = JSON.stringify(st.days[k]);
  app.generateRange('2026-10-12', '2026-10-18');
  assert.strictEqual(JSON.stringify(app.__get().days[k]), antes);
});

test('falta de gente para intermediário: vaga fica vazia com aviso, ninguém no intermediário fura regra', () => {
  // 3 fixas de férias na mesma semana: não há gente para tudo
  const c = ['joeli', 'alana', 'marta'].map((id) => ({ type: 'absence', empId: id, dateStart: '2026-10-12', dateEnd: '2026-10-18' }));
  const app = gerar('2026-10-12', '2026-10-18', c);
  const avisos = dias(app).flatMap((k) => draft(app, k).why || []);
  assert.ok(avisos.some((a) => /Sem intermediário|Diarista/.test(a)), 'esperava aviso de intermediário vago ou diarista');
  const st = app.__get();
  dias(app).forEach((k) => {
    const inter = st.team.filter((e) => draft(app, k).sh[e.id].type === 'intermediario').map((e) => e.name);
    app.checkDay(k).flags.filter((f) => f.l === 'block' && ['dom', 'sete', 'inter'].includes(f.rule))
      .forEach((f) => inter.forEach((n) => assert.ok(!f.msg.startsWith(n + ':'), `${k}: ${f.msg}`)));
  });
});
