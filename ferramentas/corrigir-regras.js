// Reaplica no servidor as regras decididas em 20/10/2026 que a migração _mig20261020 perdeu:
// ela rodava no aparelho sem subir _cfgAt, então no merge (api/_merge.js) a configuração antiga
// do servidor venceu — só a marca _mig20261020 passou. Resultado em produção: domingo 'alt',
// metas de rodízio ligadas e Duda podendo abrir qua–sex.
// Uso: node ferramentas/corrigir-regras.js   (ANK_ACCESS_KEY=... se a chave estiver ativa)

const URL = process.env.ANK_URL || 'https://ank-escala.vercel.app/api/state';
const headers = { 'Content-Type': 'application/json' };
if (process.env.ANK_ACCESS_KEY) headers['X-ANK-Key'] = process.env.ANK_ACCESS_KEY;

(async () => {
  const state = (await (await fetch(URL, { headers })).json()).state;
  if (!state || !state.team) { console.error('Estado do app vazio — nada enviado.'); process.exit(1); }

  const antes = { sunRule: state.sunRule, rot: state.levels && state.levels.rot };
  state.sunRule = 'tres';                                   // domingo 2×1 (no máx. 2 seguidos)
  state.levels = { ...(state.levels || {}), rot: 'off' };   // metas semanais viravam ruído
  const du = state.team.find((e) => e.id === 'duda');
  if (du && du.cond) {
    if (String(du.cond.intermediario) === '1,1,0,0,0,1,1') du.cond.intermediario = [1, 1, 1, 1, 1, 1, 1];
    [2, 3, 4].forEach((i) => { du.cond.abertura[i] = 0; });  // Duda estuda qua–sex à tarde: não abre
  }
  const now = Date.now();
  state._mig20261020b = 1; state._cfgAt = now; state._updatedAt = Math.max(state._updatedAt || 0, now);

  const post = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(state) });
  if (!post.ok) { console.error('O app recusou:', post.status, await post.text()); process.exit(1); }

  const c = (await (await fetch(URL, { headers })).json()).state;
  const d = c.team.find((e) => e.id === 'duda');
  const ok = c.sunRule === 'tres' && c.levels.rot === 'off' && d && [2, 3, 4].every((i) => d.cond.abertura[i] === 0);
  console.log(`Domingos: ${antes.sunRule} → ${c.sunRule} · Metas de rodízio: ${antes.rot} → ${c.levels.rot} · Duda abre qua–sex: ${d && d.cond.abertura.slice(2, 5).some(Boolean) ? 'sim' : 'não'}`);
  if (!ok) { console.error('A correção não ficou gravada.'); process.exit(1); }
  console.log('Regras corrigidas. Feche e abra o app.');
})();
