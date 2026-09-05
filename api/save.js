const { upsertDataFile } = require('./_github');
const { isAuthorized } = require('./_session');

function validData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.brand !== 'string' || typeof value.heroTitle !== 'string') return false;
  if (!Array.isArray(value.sections)) return false;
  if (JSON.stringify(value).length > 900000) return false;
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Your admin session is missing or expired.' });

  const payload = req.body || {};
  if (!validData(payload.data)) return res.status(400).json({ error: 'Invalid site data.' });

  try {
    const result = await upsertDataFile(payload.data, typeof payload.message === 'string' ? payload.message.slice(0, 120) : 'Update site content');
    return res.status(200).json({ ok: true, commit: result.commit?.sha?.slice(0, 7) || '', path: result.content?.path || '' });
  } catch (error) {
    console.error('GitHub save error:', error);
    const status = error.status === 401 || error.status === 403 ? 502 : 500;
    return res.status(status).json({ error: error.message || 'Unable to save to GitHub.' });
  }
};
