/** Health check and authenticated webhook hooks behind the /api/** rewrite. */
import { onRequest } from 'firebase-functions/v2/https';
import { ALLOWED_ORIGIN, REGION, WEBHOOK_SECRET } from '../config';
import { nowIso } from '../utils';

export const api = onRequest({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhook-Secret');
    res.status(204).end();
    return;
  }
  if (req.method === 'GET') {
    res.status(200).json({ status: 'ok', region: REGION, at: nowIso() });
    return;
  }
  if (req.method === 'POST') {
    if (!WEBHOOK_SECRET || req.header('x-webhook-secret') !== WEBHOOK_SECRET) {
      res.status(401).json({ error: 'Unauthorized webhook.' });
      return;
    }
    // Hook handlers can be added here without exposing any privileged callable.
    res.status(200).json({ ok: true, hook: req.query.hook ?? null });
    return;
  }
  res.status(405).json({ error: 'Method not allowed.' });
});
