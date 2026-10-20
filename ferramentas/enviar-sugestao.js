// Envia uma sugestão de escala (montada no chat com o Claude) para a CAIXA DE SUGESTÕES do app.
// Uso: node ferramentas/enviar-sugestao.js <arquivo-de-rascunhos.json> ["nota opcional"]
//   O arquivo é { "AAAA-MM-DD": { sh:{empId:{type,time}}, diar:[], holiday, why:[] }, ... }.
//   Se a chave de acesso estiver ativa: ANK_ACCESS_KEY=... node ferramentas/enviar-sugestao.js arquivo.json
// Desde 20/10/2026 não grava nos dias: aparece no Montar a faixa "Sugestão do assessor · Ver · Aplicar ·
// Descartar" e só vira rascunho quando o Ricardo toca em Aplicar. Uma sugestão nova substitui a anterior.
// STATE.sugestao é configuração: o servidor (api/_merge.js) fica com ela porque _cfgAt é o mais novo.

const fs = require('fs');
const URL = process.env.ANK_URL || 'https://ank-escala.vercel.app/api/state';
const headers = { 'Content-Type': 'application/json' };
if (process.env.ANK_ACCESS_KEY) headers['X-ANK-Key'] = process.env.ANK_ACCESS_KEY;

(async () => {
  const [file, nota] = process.argv.slice(2);
  if (!file) { console.error('Informe o arquivo de rascunhos.'); process.exit(1); }
  const days = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ks = Object.keys(days).sort();
  if (!ks.length) { console.error('Arquivo sem dias.'); process.exit(1); }

  const got = await fetch(URL, { headers });
  if (!got.ok) { console.error('Não consegui ler o app:', got.status); process.exit(1); }
  const state = (await got.json()).state;
  if (!state || !state.days) { console.error('Estado do app vazio — nada enviado.'); process.exit(1); }

  const now = Date.now();
  state.sugestao = { from: ks[0], to: ks[ks.length - 1], at: now, nota: nota || '', days };
  state._cfgAt = now; state._updatedAt = Math.max(state._updatedAt || 0, now);

  const post = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(state) });
  if (!post.ok) { console.error('O app recusou o envio:', post.status, await post.text()); process.exit(1); }

  const check = (await (await fetch(URL, { headers })).json()).state;
  if (!check.sugestao || check.sugestao.at !== now) { console.error('A sugestão não ficou gravada.'); process.exit(1); }
  const conf = ks.filter((k) => check.days[k] && check.days[k].conf).length;
  console.log(`Sugestão na caixa do app: ${ks.length} dias (${ks[0]} → ${ks[ks.length - 1]}). Abra o Montar e toque em Ver.`);
  if (conf) console.log(`${conf} desses dias já estão confirmados no app e não vão mudar ao aplicar.`);
})();
