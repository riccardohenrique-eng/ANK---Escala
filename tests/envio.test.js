// Envio ao grupo e histórico (2026-10-20): confirmada → enviada (marcada à mão) → mudou após o envio.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

const K = '2026-11-12'; // quinta
function montar(a, plan) {
  const st = a.__get(), w = a.dDow(K), sh = {};
  st.team.forEach((e) => { const t = plan[e.id] || 'folga'; sh[e.id] = { type: t, time: a.shiftTime(w, t) }; });
  st.days[K] = { conf: null, draft: { sh, diar: [], holiday: false } };
}
const base = { maria: 'abertura', joeli: 'abertura', alana: 'fechamento', duda: 'fechamento' };

test('fluxo: rascunho → confirmada → enviada → mudou após o envio, com histórico e mensagem', () => {
  const a = loadApp(freshState(loadApp()));
  montar(a, base);
  assert.strictEqual(a.dayStatus(K), 'rascunho');
  a.confirmRange(K, 'teste');
  assert.strictEqual(a.dayStatus(K), 'confirmada');
  assert.strictEqual(a.markSent([K]), 1);
  assert.strictEqual(a.dayStatus(K), 'enviada');

  // troca durante a semana: Alana folga, Marta fecha
  const st = a.__get();
  st.days[K].draft = JSON.parse(JSON.stringify(st.days[K].conf));
  st.days[K].draft.sh.alana = { type: 'folga', time: null };
  st.days[K].draft.sh.marta = { type: 'fechamento', time: '16:00–22:00' };
  assert.strictEqual(a.dayStatus(K), 'pendente');
  a.confirmRange(K, 'troca a pedido da Alana');
  assert.strictEqual(a.dayStatus(K), 'mudou');

  const log = st.days[K].conf.log;
  assert.strictEqual(log.length, 1);
  assert.ok(log[0].ch.some((c) => c.startsWith('Alana: Folga (antes: Fechamento')));
  assert.ok(log[0].ch.some((c) => c.startsWith('Marta: Fechamento 16h - 22h (antes: Folga)')));

  const msg = a.sendUpdateText([K]);
  assert.match(msg, /^Atualização da escala:\nquinta 12\/11: /);
  assert.match(msg, /Marta: Fechamento 16h - 22h \(antes: Folga\)/);

  a.markSent([K]);
  assert.strictEqual(a.dayStatus(K), 'enviada');
});

test('dia importado da planilha conta como enviado', () => {
  const a = loadApp(freshState(loadApp()));
  montar(a, base);
  a.confirmRange(K, '');
  a.__get().days[K].conf.motivo = 'importado da planilha';
  assert.strictEqual(a.dayStatus(K), 'enviada');
});

test('marcar como enviada sobe conf.at (o merge do servidor fica com a versão marcada)', () => {
  const a = loadApp(freshState(loadApp()));
  montar(a, base);
  a.confirmRange(K, '');
  const st = a.__get(); st.days[K].conf.at = 5;
  a.markSent([K]);
  assert.ok(st.days[K].conf.at > 5);
  const { mergeStates } = require('../api/_merge.js');
  const server = { days: { [K]: { conf: { ...st.days[K].conf, sent: undefined, at: 5 }, draft: null } } };
  const out = mergeStates(server, { days: { [K]: st.days[K] }, _updatedAt: 1 });
  assert.ok(out.days[K].conf.sent);
});
