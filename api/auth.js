const crypto = require('crypto');

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSession(secret) {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 8 })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;
  const expected = process.env.ADMIN_PASSWORD;
  if (!secret || !expected) return res.status(500).json({ error: 'Admin authentication is not configured.' });

  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const a = Buffer.from(password);
    const b = Buffer.from(expected);
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!valid) return res.status(401).json({ error: 'Incorrect admin password.' });
    return res.status(200).json({ session: createSession(secret) });
  } catch {
    return res.status(400).json({ error: 'Invalid login request.' });
  }
};
