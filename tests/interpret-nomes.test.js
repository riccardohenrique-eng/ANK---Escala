// /api/interpret-constraints (2026-11-07): a IA às vezes devolve o nome no lugar do id;
// antes o pedido era descartado em silêncio (Alana seguia escalada no dia de folga).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('aceita nome no lugar do id e lista o que foi descartado', async () => {
  const f = path.join(__dirname, '..', 'api', 'interpret-constraints.js');
  delete require.cache[require.resolve(f)];
  delete process.env.ANK_ACCESS_KEY; process.env.GEMINI_API_KEY = 'teste';
  const args = { constraints: [
    { type: 'build_range', dateStart: '2026-11-10', dateEnd: '2026-11-16', note: 'monta' },
    { type: 'absence', empId: 'Alana', dateStart: '2026-11-15', dateEnd: '2026-11-16', note: 'Alana folga' },
    { type: 'forced_shift', empId: 'alana', shiftType: 'abertura', dateStart: '2026-11-14', dateEnd: '2026-11-14', note: 'abre' },
    { type: 'absence', empId: 'Maria Jose', dateStart: '2026-11-12', dateEnd: '2026-11-12', note: 'MJ' },
    { type: 'absence', empId: 'Fulana', dateStart: '2026-11-12', dateEnd: '2026-11-12', note: 'Fulana folga' },
  ] };
  const antes = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'return_constraints', args } }] } }] }) });
  const res = { code: 200 }; res.status = (c) => { res.code = c; return res; }; res.json = (b) => { res.body = b; return res; };
  try {
    await require(f)({ method: 'POST', headers: {}, body: { text: 'x', team: [{ id: 'alana', name: 'Alana' }, { id: 'mjose', name: 'Maria José' }] } }, res);
  } finally { global.fetch = antes; }
  assert.strictEqual(res.code, 200);
  const c = res.body.constraints;
  assert.strictEqual(c.length, 4);
  assert.strictEqual(c[1].empId, 'alana');
  assert.strictEqual(c[3].empId, 'mjose');
  assert.deepStrictEqual(res.body.dropped, ['Fulana folga']);
});
