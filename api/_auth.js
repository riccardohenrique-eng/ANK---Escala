// Chave de acesso compartilhada das APIs (2026-10-07).
// Antes disso qualquer pessoa com a URL lia a equipe/valores e podia sobrescrever a escala.
// A chave fica só na env var ANK_ACCESS_KEY da Vercel; o app manda no header X-ANK-Key
// (ou ?k= no sendBeacon, que não aceita header). Sem a env var configurada, a rota segue
// aberta como antes — assim o deploy não quebra nada até o dono ativar a chave.
// Arquivo com "_" no início: a Vercel não expõe como rota.

const crypto = require('crypto');

function digest(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

module.exports = function checkAccess(req, res) {
  const key = process.env.ANK_ACCESS_KEY;
  if (!key) return true;
  let got = req.headers['x-ank-key'] || '';
  if (!got && req.query && typeof req.query.k === 'string') got = req.query.k;
  if (crypto.timingSafeEqual(digest(got), digest(key))) return true;
  res.status(401).json({ error: 'chave de acesso inválida ou ausente' });
  return false;
};
