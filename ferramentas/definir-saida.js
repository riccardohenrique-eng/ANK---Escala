// Grava o último dia de trabalho de uma pessoa (team[].saida) no servidor (20/10/2026).
// Mesmo campo da ficha em Ajustes › Condições de cada pessoa; aqui sobe _cfgAt para vencer o merge.
// Uso: node ferramentas/definir-saida.js <id> <AAAA-MM-DD | nenhuma>   ex.: marta 2026-10-31
// Chave de acesso, se ativa: ANK_ACCESS_KEY=... node ferramentas/definir-saida.js ...

const URL = process.env.ANK_URL || 'https://ank-escala.vercel.app/api/state';
const headers = { 'Content-Type': 'application/json' };
if (process.env.ANK_ACCESS_KEY) headers['X-ANK-Key'] = process.env.ANK_ACCESS_KEY;

(async () => {
  const [id, dia] = process.argv.slice(2);
  if (!id || !(dia === 'nenhuma' || /^\d{4}-\d{2}-\d{2}$/.test(dia || ''))) { console.error('Uso: definir-saida.js <id> <AAAA-MM-DD | nenhuma>'); process.exit(1); }
  const state = (await (await fetch(URL, { headers })).json()).state;
  const e = state && state.team && state.team.find((x) => x.id === id);
  if (!e) { console.error(`Pessoa não encontrada: ${id}`); process.exit(1); }
  e.saida = dia === 'nenhuma' ? null : dia;
  const now = Date.now();
  state._cfgAt = now; state._updatedAt = Math.max(state._updatedAt || 0, now);
  const post = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(state) });
  if (!post.ok) { console.error('O app recusou:', post.status, await post.text()); process.exit(1); }
  const c = (await (await fetch(URL, { headers })).json()).state.team.find((x) => x.id === id);
  if ((c.saida || null) !== e.saida) { console.error('Não ficou gravado.'); process.exit(1); }
  console.log(`${c.name}: último dia de trabalho = ${c.saida || 'nenhum (continua na equipe)'}.`);
})();
