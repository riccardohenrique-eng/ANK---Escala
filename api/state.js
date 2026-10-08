// Vercel serverless function — /api/state
// Guarda/recupera o STATE inteiro do app (mesmo formato salvo no localStorage,
// chave ank_escala_v1) num único blob no Redis do Upstash (REST API), pra
// virar a fonte única de verdade entre dispositivos/navegadores.
// Requer conectar a integração "Upstash" (Serverless DB: Redis/Vector/Queue/
// Search) ao projeto Vercel pela aba Storage — NÃO a opção genérica "Redis"
// (essa é Redis Cloud/Redis Inc., conexão TCP tradicional, exigiria uma
// biblioteca cliente/dependência npm nova; o Upstash expõe REST simples via
// fetch, sem dependência, mesmo padrão do resto deste projeto). Aceita tanto
// o nome de variável nativo do Upstash (UPSTASH_REDIS_REST_URL/TOKEN) quanto
// o nome legado da antiga Vercel KV (KV_REST_API_URL/TOKEN), porque não há
// garantia de qual a integração atual injeta. Sem nenhum dos dois, a rota
// responde 503 e o app do lado do cliente continua funcionando só com
// localStorage (degrada graciosamente, mesmo padrão do interpret-constraints).

const checkAccess = require('./_auth');

const KV_KEY = 'ank_escala_v1';
const BAK_KEY = 'ank_escala_v1_bak';

// Dias confirmados: formato atual (days[data].conf) ou o antigo por semanas (history[].days).
function confirmedCount(s) {
  if (!s || typeof s !== 'object') return 0;
  if (s.days && typeof s.days === 'object') return Object.values(s.days).filter((d) => d && d.conf).length;
  return (Array.isArray(s.history) ? s.history : []).reduce((n, w) => n + ((w && w.days) || []).length, 0);
}

module.exports = async (req, res) => {
  if (!checkAccess(req, res)) return;
  const base = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    res.status(503).json({ error: 'Upstash não conectado a este projeto Vercel ainda.' });
    return;
  }
  const auth = { Authorization: `Bearer ${token}` };

  if (req.method === 'GET') {
    try {
      const r = await fetch(`${base}/get/${KV_KEY}`, { headers: auth });
      if (!r.ok) throw new Error('kv get http ' + r.status);
      const data = await r.json();
      const state = data.result ? JSON.parse(data.result) : null;
      res.status(200).json({ state });
    } catch (err) {
      res.status(500).json({ error: 'falha ao ler do KV', detail: String(err && err.message || err) });
    }
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
      res.status(400).json({ error: 'JSON inválido' });
      return;
    }
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'corpo vazio' });
      return;
    }
    try {
      // Proteção (2026-09-28, depois do histórico ter sido apagado por um aparelho com cópia antiga
      // em 27/09): nunca aceitar uma gravação com MENOS dias confirmados do que o servidor já tem.
      // Devolve 409 + o estado atual, e o app daquele aparelho adota a versão do servidor.
      const cur = await fetch(`${base}/get/${KV_KEY}`, { headers: auth }).then((r) => r.json());
      const currentRaw = cur && cur.result ? cur.result : null;
      const current = currentRaw ? JSON.parse(currentRaw) : null;
      if (current && confirmedCount(body) < confirmedCount(current)) {
        res.status(409).json({ error: 'gravação recusada: tem menos dias confirmados que o servidor', state: current });
        return;
      }
      // Guarda as 30 últimas versões em ank_escala_v1_bak (LPUSH/LTRIM) antes de sobrescrever.
      const cmds = [];
      if (currentRaw) cmds.push(['LPUSH', BAK_KEY, currentRaw], ['LTRIM', BAK_KEY, '0', '29']);
      cmds.push(['SET', KV_KEY, JSON.stringify(body)]);
      const r = await fetch(`${base}/pipeline`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds)
      });
      if (!r.ok) throw new Error('kv pipeline http ' + r.status);
      const data = await r.json();
      const last = Array.isArray(data) ? data[data.length - 1] : null;
      if (!last || last.result !== 'OK') throw new Error('resposta inesperada do KV: ' + JSON.stringify(data));
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'falha ao salvar no KV', detail: String(err && err.message || err) });
    }
    return;
  }

  res.status(405).json({ error: 'método não suportado' });
};
