// Vercel serverless function — /api/send-push
// Envia notificação Web Push nativa (sem serviço terceiro) pra todas as inscrições
// salvas em STATE.pushSubscriptions (mesmo blob do Upstash usado por /api/state).
//
// Única função deste projeto com dependência npm (web-push) — decisão consciente:
// a criptografia do Web Push (assinatura VAPID em JWT + criptografia aes128gcm do
// payload) não é razoável de reimplementar à mão sem uma biblioteca testada. Todo
// o resto do projeto (incluindo /api/state e /api/interpret-constraints) continua
// sem dependências, só fetch nativo — isso não muda.
//
// Requer 3 env vars novas no projeto Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// (geradas com `npx web-push generate-vapid-keys`) e VAPID_SUBJECT (ex.:
// "mailto:algum@email.com" — exigido pelo protocolo, não precisa ser monitorado).

const webpush = require('web-push');

const KV_KEY = 'ank_escala_v1';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'método não suportado' });
    return;
  }

  const base = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    res.status(503).json({ error: 'Upstash não conectado a este projeto Vercel ainda.' });
    return;
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    res.status(503).json({ error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT não configuradas neste projeto Vercel.' });
    return;
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }
  const title = (body && body.title) || 'Escala ANK';
  const message = (body && body.body) || '';
  const url = (body && body.url) || '/';

  const auth = { Authorization: `Bearer ${token}` };
  let state;
  try {
    const r = await fetch(`${base}/get/${KV_KEY}`, { headers: auth });
    if (!r.ok) throw new Error('kv get http ' + r.status);
    const data = await r.json();
    state = data.result ? JSON.parse(data.result) : null;
  } catch (err) {
    res.status(500).json({ error: 'falha ao ler inscrições do KV', detail: String((err && err.message) || err) });
    return;
  }

  const subs = (state && state.pushSubscriptions) || [];
  if (!subs.length) {
    res.status(200).json({ sent: 0, removed: 0, note: 'nenhuma inscrição salva ainda' });
    return;
  }

  const payload = JSON.stringify({ title, body: message, url });
  let sent = 0;
  const stillValid = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
      stillValid.push(sub);
    } catch (err) {
      // 404/410 = inscrição expirada/revogada pelo navegador — remove da lista.
      // Qualquer outro erro (ex.: falha transitória de rede) mantém a inscrição.
      const code = err && err.statusCode;
      if (code !== 404 && code !== 410) stillValid.push(sub);
    }
  }));

  const removed = subs.length - stillValid.length;
  if (removed > 0) {
    try {
      const newState = { ...state, pushSubscriptions: stillValid, _updatedAt: Date.now() };
      await fetch(`${base}/set/${KV_KEY}`, { method: 'POST', headers: auth, body: JSON.stringify(newState) });
    } catch (e) {
      // limpeza best-effort — não deve bloquear a resposta do envio em si.
    }
  }

  res.status(200).json({ sent, removed });
};
