// Acesso às APIs.
// 10/11/2026 — entrada com Face ID (passkeys, api/auth.js): o app manda a sessão em X-ANK-Session (ou ?s= no sendBeacon).
// A sessão vale 12 h no servidor; o app pede o Face ID a cada abertura (a sessão fica só na memória).
// Modo ativo quando ANK_REG_CODE (código de cadastro de aparelhos) está configurado na Vercel.
// Chave antiga (ANK_ACCESS_KEY, X-ANK-Key / ?k=): continua aceita enquanto a env var existir (scripts de ferramentas/);
// para desligar de vez, apagar ANK_ACCESS_KEY na Vercel. Sem nenhuma das duas, a rota fica aberta (transição).
// Arquivo com "_" no início: a Vercel não expõe como rota.
const crypto = require('crypto');
const { kv } = require('./_kv');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const SESS_PREFIX = 'ank_sess:';

async function checkAccess(req, res) {
  const key = process.env.ANK_ACCESS_KEY, reg = process.env.ANK_REG_CODE;
  if (!key && !reg) return true;
  const q = req.query || {};
  if (key) {
    let got = req.headers['x-ank-key'] || '';
    if (!got && typeof q.k === 'string') got = q.k;
    if (got && crypto.timingSafeEqual(digest(got), digest(key))) return true;
  }
  if (reg) {
    let s = req.headers['x-ank-session'] || '';
    if (!s && typeof q.s === 'string') s = q.s;
    if (/^[A-Za-z0-9_-]{30,80}$/.test(s)) {
      try { const [v] = await kv([['GET', SESS_PREFIX + s]]); if (v) return true; } catch (e) { res.status(503).json({ error: 'não consegui conferir a entrada' }); return false; }
    }
  }
  res.status(401).json({ error: 'entrada necessária' });
  return false;
}
module.exports = checkAccess;
module.exports.SESS_PREFIX = SESS_PREFIX;
