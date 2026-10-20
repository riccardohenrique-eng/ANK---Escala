// Tarefa do dia (2026-10-20): padrão por dia da semana + exceção por data; '' = sem tarefa naquele dia.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, freshState } = require('./harness');

test('padrão igual à planilha: seg/qua/sáb', () => {
  const a = loadApp(freshState(loadApp()));
  assert.strictEqual(a.taskFor('2026-10-26'), 'Limpar freezers da bancada');
  assert.strictEqual(a.taskFor('2026-10-28'), 'Limpar freezers da cozinha');
  assert.strictEqual(a.taskFor('2026-10-31'), 'Limpeza da cozinha');
  assert.strictEqual(a.taskFor('2026-10-27'), '');
});

test('exceção por data vale só naquele dia; vazio apaga a tarefa do dia', () => {
  const a = loadApp(freshState(loadApp()));
  a.setTaskDay('2026-10-27', 'Limpeza dos vidros, porta e mesas');
  a.setTaskDay('2026-10-26', '');
  assert.strictEqual(a.taskFor('2026-10-27'), 'Limpeza dos vidros, porta e mesas');
  assert.strictEqual(a.taskFor('2026-11-03'), '');
  assert.strictEqual(a.taskFor('2026-10-26'), '');
  assert.strictEqual(a.taskFor('2026-11-02'), 'Limpar freezers da bancada');
  a.setTaskDay('2026-10-27', '');            // igual ao padrão (vazio) → some a exceção
  assert.ok(!('2026-10-27' in a.__get().taskDay));
});

test('padrão editado em Ajustes muda todas as semanas', () => {
  const a = loadApp(freshState(loadApp()));
  a.__get().tasks = { ...a.__get().tasks, 1: 'Limpeza geral 08h' };
  assert.strictEqual(a.taskFor('2026-10-27'), 'Limpeza geral 08h');
  assert.strictEqual(a.taskFor('2026-11-03'), 'Limpeza geral 08h');
});
