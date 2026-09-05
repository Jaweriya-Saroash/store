const { getDataFile, DATA_PATH } = require('./_github');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    const result = await getDataFile();
    return res.status(200).json({ data: result.data, source: 'github', path: DATA_PATH, sha: result.sha });
  } catch (error) {
    if (error.status === 404) return res.status(200).json({ data: null, source: 'github', path: DATA_PATH });
    console.error('GitHub data load error:', error);
    return res.status(500).json({ error: error.message || 'Unable to load site data.' });
  }
};
