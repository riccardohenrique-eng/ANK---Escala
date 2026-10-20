// Ajusta turnos de um dia ainda não confirmado (ou cria a alteração por cima de um confirmado), como
// se o Ricardo tocasse nas células do Montar. Usado quando ele pede a troca pelo chat (20/10/2026).
// Uso: node ferramentas/ajustar-dia.js AAAA-MM-DD marta=folga duda=abertura [...]
//   turnos: abertura | intermediario | fechamento | folga | ferias. Horário = padrão do turno no dia.
// Depois de rodar, o Ricardo recarrega o app: rascunhos vêm de quem salvou por último (api/_merge.js),
// então um navegador aberto com a cópia antiga desfaria a troca na próxima edição.
// Chave de acesso, se ativa: ANK_ACCESS_KEY=... node ferramentas/ajustar-dia.js ...

const URL = process.env.ANK_URL || 'https://ank-escala.vercel.app/api/state';
const headers = { 'Content-Type': 'application/json' };
if (process.env.ANK_ACCESS_KEY) headers['X-ANK-Key'] = process.env.ANK_ACCESS_KEY;
const TYPES = ['abertura', 'intermediario', 'fechamento', 'folga', 'ferias'];

// mesmo horário padrão do app (shiftTime em index.html); dow 0 = segunda
function shiftTime(dow, type) {
  if (type === 'abertura') return [0, 2, 5].includes(dow) ? '09:30–16:00' : (dow === 6 ? '11:30–17:30' : '10:30–17:30');
  if (type === 'fechamento') return '16:00–22:00';
  if (type === 'intermediario') return dow === 0 ? '12:00–18:00' : '15:00–21:00';
  return null;
}

(async () => {
  const [k, ...pairs] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k || '') || !pairs.length) { console.error('Uso: ajustar-dia.js AAAA-MM-DD pessoa=turno ...'); process.exit(1); }
  const dow = (new Date(k + 'T12:00:00Z').getUTCDay() + 6) % 7;

  const state = (await (await fetch(URL, { headers })).json()).state;
  if (!state || !state.days) { console.error('Estado do app vazio — nada enviado.'); process.exit(1); }
  const ids = new Set(state.team.map((e) => e.id));
  const changes = pairs.map((p) => p.split('='));
  for (const [id, t] of changes) {
    if (!ids.has(id)) { console.error(`Pessoa desconhecida: ${id} (use ${[...ids].join(', ')})`); process.exit(1); }
    if (!TYPES.includes(t)) { console.error(`Turno desconhecido: ${t}`); process.exit(1); }
  }

  const day = state.days[k] || (state.days[k] = { conf: null, draft: null });
  if (!day.draft) { day.draft = JSON.parse(JSON.stringify(day.conf || { sh: {}, diar: [], holiday: false })); delete day.draft.at; delete day.draft.motivo; }
  for (const [id, t] of changes) day.draft.sh[id] = { type: t, time: shiftTime(dow, t), manual: true };
  state._updatedAt = Date.now();

  const post = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(state) });
  if (!post.ok) { console.error('O app recusou:', post.status, await post.text()); process.exit(1); }

  const c = (await (await fetch(URL, { headers })).json()).state.days[k];
  const v = c && (c.draft || c.conf);
  const ok = v && changes.every(([id, t]) => v.sh[id] && v.sh[id].type === t);
  console.log(`${k}: ${changes.map(([id, t]) => `${id} → ${t}`).join(', ')}${ok ? ' — gravado.' : ' — NÃO ficou gravado.'}`);
  if (!ok) process.exit(1);
  console.log('Recarregue o app (feche e abra a aba) antes de continuar montando.');
})();
