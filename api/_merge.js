// Junta o estado que um aparelho mandou com o que já está no servidor (2026-10-20).
// Antes a regra era "quem tem mais dias confirmados ganha": em 08/10 um aparelho com dados
// velhos (28 dias convertidos do modelo antigo por semanas) passou por cima da escala real
// lançada em 07/10 (15 dias), porque 28 > 15.
// Regras de agora:
//  - dia confirmado nunca some pela sincronização; se os dois lados confirmaram o mesmo dia,
//    fica a confirmação mais recente (conf.at). Empate = servidor.
//  - rascunhos vêm de quem editou por último (_updatedAt); configuração (equipe, regras,
//    pedidos, composição…) vem de quem mudou a configuração por último (_cfgAt). Empate = servidor.
// Arquivo com "_" no início: a Vercel não expõe como rota.

// Chaves que não são configuração. O app tem a mesma lista em cfgJson() — manter iguais.
const NOT_CFG = new Set(['days', '_updatedAt', '_cfgAt', 'schema', 'legacyHistory', 'history']);

function pickConf(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (b.at || 0) > (a.at || 0) ? b : a;
}

function mergeStates(server, incoming) {
  if (!server || typeof server !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return server;
  const draftsFromIncoming = (incoming._updatedAt || 0) > (server._updatedAt || 0);
  const cfgFromIncoming = (incoming._cfgAt || 0) > (server._cfgAt || 0);
  const [cfgMain, cfgOther] = cfgFromIncoming ? [incoming, server] : [server, incoming];

  const out = {};
  new Set([...Object.keys(server), ...Object.keys(incoming)]).forEach((k) => {
    if (NOT_CFG.has(k)) return;
    out[k] = k in cfgMain ? cfgMain[k] : cfgOther[k];
  });
  out._updatedAt = Math.max(server._updatedAt || 0, incoming._updatedAt || 0);
  out._cfgAt = Math.max(server._cfgAt || 0, incoming._cfgAt || 0);
  const schema = Math.max(server.schema || 0, incoming.schema || 0);
  if (schema) out.schema = schema;
  if (server.legacyHistory || incoming.legacyHistory) out.legacyHistory = server.legacyHistory || incoming.legacyHistory;

  const sd = server.days || {}, id = incoming.days || {};
  out.days = {};
  Object.keys({ ...sd, ...id }).sort().forEach((k) => {
    const s = sd[k], i = id[k];
    const conf = pickConf(s && s.conf, i && i.conf);
    const draftSrc = draftsFromIncoming ? i : s;
    const draft = (draftSrc && draftSrc.draft) || null;
    if (conf || draft) out.days[k] = { conf: conf || null, draft };
  });
  return out;
}

// JSON com chaves em ordem, para comparar estados sem depender da ordem das propriedades.
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// Resumo de uma versão (para listar as versões guardadas sem baixar tudo).
function summary(s) {
  const days = (s && s.days) || {};
  const conf = Object.keys(days).filter((k) => days[k] && days[k].conf).sort();
  return {
    updatedAt: (s && s._updatedAt) || 0,
    confirmados: conf.length,
    deAte: conf.length ? [conf[0], conf[conf.length - 1]] : null,
    confirmadosNoApp: conf.filter((k) => days[k].conf.at > 0).length,
    rascunhos: Object.keys(days).filter((k) => days[k] && days[k].draft).length
  };
}

module.exports = { mergeStates, stable, summary, NOT_CFG };
