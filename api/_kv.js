// Upstash Redis via REST (mesmo padrão de state.js). Arquivo com "_": a Vercel não expõe como rota.
function kvConf() {
  const base = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return base && token ? { base, token } : null;
}
// Executa comandos em lote e devolve o "result" de cada um (erro de qualquer um → exceção).
async function kv(cmds) {
  const c = kvConf(); if (!c) throw new Error('Upstash não conectado');
  const r = await fetch(`${c.base}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('kv pipeline http ' + r.status);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error('kv resposta inesperada');
  return data.map((x) => { if (x && x.error) throw new Error('kv ' + x.error); return x ? x.result : null; });
}
module.exports = { kv, kvConf };
