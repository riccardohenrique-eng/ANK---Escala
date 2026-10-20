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
const { mergeStates, stable, summary } = require('./_merge');

const KV_KEY = 'ank_escala_v1';
const BAK_KEY = 'ank_escala_v1_bak';

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
      const q = req.query || {};
      // Versões guardadas (2026-10-20): ?versions=1 lista um resumo de cada; ?version=N devolve a N-ésima inteira.
      if (q.versions) {
        const r = await fetch(`${base}/lrange/${BAK_KEY}/0/29`, { headers: auth });
        if (!r.ok) throw new Error('kv lrange http ' + r.status);
        const data = await r.json();
        const versions = (data.result || []).map((raw, i) => ({ i, ...summary(JSON.parse(raw)) }));
        res.status(200).json({ versions });
        return;
      }
      if (q.version !== undefined) {
        const r = await fetch(`${base}/lindex/${BAK_KEY}/${parseInt(q.version, 10) || 0}`, { headers: auth });
        if (!r.ok) throw new Error('kv lindex http ' + r.status);
        const data = await r.json();
        res.status(200).json({ state: data.result ? JSON.parse(data.result) : null });
        return;
      }
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
      // Proteção: o servidor JUNTA o que chegou com o que já tem, dia a dia (regras em _merge.js) —
      // dia confirmado nunca some. Substitui a regra antiga "menos dias confirmados = 409", que deixou
      // um aparelho com dados velhos (porém mais dias) apagar a escala real em 08/10/2026.
      const cur = await fetch(`${base}/get/${KV_KEY}`, { headers: auth }).then((r) => r.json());
      const currentRaw = cur && cur.result ? cur.result : null;
      const current = currentRaw ? JSON.parse(currentRaw) : null;
      const merged = mergeStates(current, body);
      const mergedStable = stable(merged);
      // Se o aparelho estava atrás (faltava algo do servidor), devolve 409 + o estado junto:
      // o app adota (inclusive versões antigas do app, que já adotavam o state do 409).
      const behind = mergedStable !== stable(body);
      if (current && mergedStable === stable(current)) {
        res.status(behind ? 409 : 200).json(behind ? { error: 'aparelho desatualizado: juntei com o servidor', state: merged } : { ok: true });
        return;
      }
      // Guarda as 30 últimas versões em ank_escala_v1_bak (LPUSH/LTRIM) antes de sobrescrever.
      const cmds = [];
      if (currentRaw) cmds.push(['LPUSH', BAK_KEY, currentRaw], ['LTRIM', BAK_KEY, '0', '29']);
      cmds.push(['SET', KV_KEY, JSON.stringify(merged)]);
      const r = await fetch(`${base}/pipeline`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds)
      });
      if (!r.ok) throw new Error('kv pipeline http ' + r.status);
      const data = await r.json();
      const last = Array.isArray(data) ? data[data.length - 1] : null;
      if (!last || last.result !== 'OK') throw new Error('resposta inesperada do KV: ' + JSON.stringify(data));
      res.status(behind ? 409 : 200).json(behind ? { error: 'aparelho desatualizado: juntei com o servidor', state: merged } : { ok: true });
    } catch (err) {
      res.status(500).json({ error: 'falha ao salvar no KV', detail: String(err && err.message || err) });
    }
    return;
  }

  res.status(405).json({ error: 'método não suportado' });
};
