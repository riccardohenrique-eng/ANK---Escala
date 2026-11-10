// Conferência mínima de WebAuthn (passkeys / Face ID), sem dependências (10/11/2026).
// Só o que o app usa: atestado "none" (não conferimos o fabricante), chaves ES256 (-7) e RS256 (-257),
// verificação obrigatória do usuário (Face ID / código do aparelho). Arquivo com "_": não é rota.
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

// CBOR (RFC 8949), só os tipos que aparecem em WebAuthn. Devolve [valor, próximaPosição].
function cborAt(buf, pos) {
  const ib = buf[pos++]; if (ib === undefined) throw new Error('cbor: fim inesperado');
  const mt = ib >> 5, ai = ib & 31;
  let len;
  if (ai < 24) len = ai;
  else if (ai === 24) { len = buf[pos]; pos += 1; }
  else if (ai === 25) { len = buf.readUInt16BE(pos); pos += 2; }
  else if (ai === 26) { len = buf.readUInt32BE(pos); pos += 4; }
  else if (ai === 27) { len = Number(buf.readBigUInt64BE(pos)); pos += 8; }
  else throw new Error('cbor: tamanho indefinido não suportado');
  switch (mt) {
    case 0: return [len, pos];
    case 1: return [-1 - len, pos];
    case 2: { if (pos + len > buf.length) throw new Error('cbor: bytes'); return [buf.subarray(pos, pos + len), pos + len]; }
    case 3: { if (pos + len > buf.length) throw new Error('cbor: texto'); return [buf.subarray(pos, pos + len).toString('utf8'), pos + len]; }
    case 4: { const a = []; for (let i = 0; i < len; i++) { const [v, p] = cborAt(buf, pos); a.push(v); pos = p; } return [a, pos]; }
    case 5: { const m = new Map(); for (let i = 0; i < len; i++) { const [k, p1] = cborAt(buf, pos); const [v, p2] = cborAt(buf, p1); m.set(k, v); pos = p2; } return [m, pos]; }
    case 7: if (ai === 20) return [false, pos]; if (ai === 21) return [true, pos]; if (ai === 22) return [null, pos]; throw new Error('cbor: simples');
    default: throw new Error('cbor: tipo ' + mt);
  }
}

function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authData curto');
  const out = { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33) };
  out.up = !!(out.flags & 0x01); out.uv = !!(out.flags & 0x04);
  if (out.flags & 0x40) {
    let p = 37 + 16; const n = ad.readUInt16BE(p); p += 2;
    out.credId = ad.subarray(p, p + n); p += n;
    const [cose] = cborAt(ad, p); out.cose = cose;
  }
  return out;
}

function coseToKey(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg, jwk: { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) } };
  throw new Error('tipo de chave não suportado');
}

function checkClient(cdjB64, type, origin) {
  const raw = fromB64u(cdjB64); const cd = JSON.parse(raw.toString('utf8'));
  if (cd.type !== type) throw new Error('tipo errado');
  if (cd.origin !== origin) throw new Error('origem errada: ' + cd.origin);
  if (typeof cd.challenge !== 'string' || !cd.challenge) throw new Error('sem desafio');
  return { raw, challenge: cd.challenge };
}
function checkRp(ad, rpId) {
  if (!crypto.timingSafeEqual(ad.rpIdHash, sha256(Buffer.from(rpId)))) throw new Error('rpId errado');
  if (!ad.up || !ad.uv) throw new Error('sem verificação do usuário');
}

// Cadastro: devolve { challenge, credId, key:{alg,jwk}, signCount }. O desafio é conferido por quem chama.
function verifyRegistration(cred, { rpId, origin }) {
  const r = cred && cred.response; if (!r) throw new Error('sem resposta');
  const cd = checkClient(r.clientDataJSON, 'webauthn.create', origin);
  const [att] = cborAt(fromB64u(r.attestationObject), 0);
  const authData = att instanceof Map ? att.get('authData') : null; if (!Buffer.isBuffer(authData)) throw new Error('sem authData');
  const ad = parseAuthData(authData); checkRp(ad, rpId);
  if (!ad.credId || !ad.cose) throw new Error('sem credencial');
  if (b64u(ad.credId) !== cred.id) throw new Error('id diferente');
  return { challenge: cd.challenge, credId: b64u(ad.credId), key: coseToKey(ad.cose), signCount: ad.signCount };
}

// Entrada: confere assinatura com a chave guardada. Devolve { challenge, signCount }.
function verifyAssertion(cred, stored, { rpId, origin }) {
  const r = cred && cred.response; if (!r) throw new Error('sem resposta');
  const cd = checkClient(r.clientDataJSON, 'webauthn.get', origin);
  const authData = fromB64u(r.authenticatorData); const ad = parseAuthData(authData); checkRp(ad, rpId);
  const data = Buffer.concat([authData, sha256(cd.raw)]), sig = fromB64u(r.signature);
  const key = crypto.createPublicKey({ key: stored.jwk, format: 'jwk' });
  const ok = stored.alg === -7 ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig) : crypto.verify('sha256', data, key, sig);
  if (!ok) throw new Error('assinatura inválida');
  if (ad.signCount && stored.signCount && ad.signCount <= stored.signCount) throw new Error('contador voltou');
  return { challenge: cd.challenge, signCount: ad.signCount };
}

module.exports = { cborAt, parseAuthData, coseToKey, verifyRegistration, verifyAssertion, b64u, fromB64u, sha256 };
