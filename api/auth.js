// /api/auth — entrada com Face ID (passkeys) no Escala ANK (10/11/2026).
// Cadastro de aparelho: exige o código de cadastro (env ANK_REG_CODE). 5 erros por IP (ou 20 no total) em 15 min → trava.
// Entrada: o iPhone assina um desafio com a passkey (Face ID / código do aparelho); o servidor confere e abre uma sessão de 12 h.
// Guardado no Upstash: ank_creds (hash credId → chave pública), ank_chal:<desafio> (5 min), ank_sess:<token> (12 h), ank_fail:*.
const crypto = require('crypto');
const { kv, kvConf } = require('./_kv');
const W = require('./_webauthn');
const { SESS_PREFIX } = require('./_auth');

const CREDS = 'ank_creds', CHAL = 'ank_chal:', FAIL_IP = 'ank_fail:', FAIL_ALL = 'ank_fail_all';
const SESS_TTL = 12 * 3600, CHAL_TTL = 300, LOCK_TTL = 900, MAX_IP = 5, MAX_ALL = 20;

function where(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const rpId = host.replace(/:\d+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || (rpId === 'localhost' ? 'http' : 'https')).split(',')[0].trim();
  return { rpId, origin: `${proto}://${host}` };
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'x').split(',')[0].trim();
const token = () => crypto.randomBytes(32).toString('base64url');
const same = (a, b) => crypto.timingSafeEqual(W.sha256(String(a)), W.sha256(String(b)));

async function newChallenge(kind) { const ch = token(); await kv([['SET', CHAL + ch, kind, 'EX', String(CHAL_TTL)]]); return ch; }
async function takeChallenge(ch, kind) { if (typeof ch !== 'string' || !ch) return false; const [v] = await kv([['GETDEL', CHAL + ch]]); return v === kind; }
async function newSession() { const t = token(); await kv([['SET', SESS_PREFIX + t, '1', 'EX', String(SESS_TTL)]]); return t; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'método não suportado' }); return; }
  const code = process.env.ANK_REG_CODE;
  if (!code || !kvConf()) { res.status(503).json({ error: 'entrada com Face ID ainda não configurada no servidor' }); return; }
  let body = req.body; try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) { body = null; }
  body = body && typeof body === 'object' ? body : {};
  const op = (req.query && req.query.op) || body.op, { rpId, origin } = where(req);
  try {
    // PIN (10/11/2026): no computador a entrada é só o PIN de 6 números (o mesmo código de cadastro), com a mesma trava.
    if (op === 'register-options' || op === 'pin-login') {
      const ip = ipOf(req), [nIp, nAll] = await kv([['GET', FAIL_IP + ip], ['GET', FAIL_ALL]]);
      if ((+nIp || 0) >= MAX_IP || (+nAll || 0) >= MAX_ALL) { res.status(429).json({ error: 'Muitas tentativas erradas. Espere 15 minutos.' }); return; }
      if (typeof body.code !== 'string' || !same(body.code.trim(), code)) {
        const [n] = await kv([['INCR', FAIL_IP + ip], ['EXPIRE', FAIL_IP + ip, String(LOCK_TTL)], ['INCR', FAIL_ALL], ['EXPIRE', FAIL_ALL, String(LOCK_TTL)]]);
        res.status(403).json({ error: op === 'pin-login' ? 'PIN errado.' : 'Código de cadastro errado.', restantes: Math.max(0, MAX_IP - (+n || 0)) }); return;
      }
      await kv([['DEL', FAIL_IP + ip]]);
      if (op === 'pin-login') { res.status(200).json({ ok: true, token: await newSession() }); return; }
      const challenge = await newChallenge('reg');
      res.status(200).json({ publicKey: {
        challenge, rp: { id: rpId, name: 'Escala ANK' },
        user: { id: W.b64u(Buffer.from('ank-escala-dono')), name: 'Escala ANK', displayName: 'Escala ANK' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        attestation: 'none', timeout: 120000 } });
      return;
    }
    if (op === 'register-verify') {
      const v = W.verifyRegistration(body.cred, { rpId, origin });
      if (!(await takeChallenge(v.challenge, 'reg'))) { res.status(400).json({ error: 'Cadastro expirou. Tente de novo.' }); return; }
      const rec = { alg: v.key.alg, jwk: v.key.jwk, signCount: v.signCount, at: Date.now(), rpId, label: String(body.label || '').slice(0, 60) };
      await kv([['HSET', CREDS, v.credId, JSON.stringify(rec)]]);
      res.status(200).json({ ok: true, token: await newSession() });
      return;
    }
    if (op === 'login-options') {
      res.status(200).json({ publicKey: { challenge: await newChallenge('get'), rpId, userVerification: 'required', timeout: 120000, allowCredentials: [] } });
      return;
    }
    if (op === 'login-verify') {
      const id = body.cred && body.cred.id;
      const [raw] = typeof id === 'string' && id ? await kv([['HGET', CREDS, id]]) : [null];
      if (!raw) { res.status(401).json({ error: 'Este aparelho não está cadastrado. Cadastre com o código.', naoCadastrado: true }); return; }
      const stored = JSON.parse(raw);
      const v = W.verifyAssertion(body.cred, stored, { rpId, origin });
      if (!(await takeChallenge(v.challenge, 'get'))) { res.status(400).json({ error: 'A entrada expirou. Tente de novo.' }); return; }
      if (v.signCount) await kv([['HSET', CREDS, id, JSON.stringify({ ...stored, signCount: v.signCount })]]);
      res.status(200).json({ ok: true, token: await newSession() });
      return;
    }
    if (op === 'logout') {
      const s = req.headers['x-ank-session']; if (typeof s === 'string' && s) await kv([['DEL', SESS_PREFIX + s]]);
      res.status(200).json({ ok: true }); return;
    }
    res.status(400).json({ error: 'operação desconhecida' });
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/^kv|Upstash/.test(msg)) { res.status(503).json({ error: 'servidor indisponível, tente de novo' }); return; }
    res.status(400).json({ error: 'Não consegui conferir a entrada.', detail: msg });
  }
};
