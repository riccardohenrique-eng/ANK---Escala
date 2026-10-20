// Troca o histórico do app pelo da planilha do Google Sheets (pedido do Ricardo, 20/10/2026).
// Uso: node ferramentas/importar-planilha.js <planilha.json> <primeiro-dia-a-manter AAAA-MM-DD>
//   planilha.json = { "AAAA-MM-DD": { sh, diar, holiday, motivo } } extraído pelo importador do app.
//   Todo dia ANTES do "primeiro dia a manter" vira o da planilha (confirmado, sem rascunho);
//   dia antigo que a planilha não tem é apagado. Dias a partir dele (sugestões) ficam como estão.
//   Pedidos antigos (que terminam antes desse dia) também saem.
// Por que funciona com o merge do servidor (api/_merge.js): confirmação com `at` mais novo vence,
// e rascunhos/configuração vêm de quem tem `_updatedAt`/`_cfgAt` maior.
// Chave de acesso, se ativa: ANK_ACCESS_KEY=... node ferramentas/importar-planilha.js ...

const fs = require('fs'), path = require('path');
const URL = process.env.ANK_URL || 'https://ank-escala.vercel.app/api/state';
const headers = { 'Content-Type': 'application/json' };
if (process.env.ANK_ACCESS_KEY) headers['X-ANK-Key'] = process.env.ANK_ACCESS_KEY;

(async () => {
  const [file, keepFrom] = process.argv.slice(2);
  if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(keepFrom || '')) { console.error('Uso: importar-planilha.js <planilha.json> <AAAA-MM-DD>'); process.exit(1); }
  const sheet = JSON.parse(fs.readFileSync(file, 'utf8'));

  const state = (await (await fetch(URL, { headers })).json()).state;
  if (!state || !state.days) { console.error('Estado do app vazio — nada enviado.'); process.exit(1); }
  const bak = path.join(__dirname, `estado-antes-planilha-${Date.now()}.json`);
  fs.writeFileSync(bak, JSON.stringify(state));

  const now = Date.now();
  const removed = Object.keys(state.days).filter((k) => k < keepFrom && !sheet[k]);
  removed.forEach((k) => delete state.days[k]);
  let n = 0;
  for (const k of Object.keys(sheet)) {
    if (k >= keepFrom) continue;
    state.days[k] = { conf: { ...sheet[k], at: now }, draft: null };
    n++;
  }
  const oldReq = (state.constraints || []).filter((c) => (c.dateEnd || c.dateStart || '') < keepFrom).length;
  state.constraints = (state.constraints || []).filter((c) => (c.dateEnd || c.dateStart || '') >= keepFrom);
  state._updatedAt = now; state._cfgAt = now;

  const post = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(state) });
  if (!post.ok) { console.error('O app recusou:', post.status, await post.text()); process.exit(1); }

  const check = (await (await fetch(URL, { headers })).json()).state;
  const old = Object.keys(check.days).filter((k) => k < keepFrom);
  const bad = old.filter((k) => !sheet[k] || check.days[k].draft || !check.days[k].conf || check.days[k].conf.at !== now);
  const kept = Object.keys(check.days).filter((k) => k >= keepFrom).length;
  console.log(`Planilha no app: ${old.length - bad.length} de ${n} dias confirmados. Dias apagados: ${removed.length}. Pedidos antigos removidos: ${oldReq}. Dias a partir de ${keepFrom} mantidos: ${kept}.`);
  console.log(`Cópia do estado anterior: ${bak}`);
  if (bad.length) { console.error('Dias que não ficaram iguais à planilha:', bad.join(', ')); process.exit(1); }
})();
