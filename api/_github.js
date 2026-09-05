const crypto = require('crypto');

function env(name, fallback='') { return process.env[name] || fallback; }

function parseRepoUrl(url) {
  const u = new URL(url);
  if (u.hostname !== 'github.com') throw new Error('GITHUB_REPO_URL must point to github.com.');
  const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 2) throw new Error('GITHUB_REPO_URL must be https://github.com/OWNER/REPOSITORY.');
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
}

function githubConfig() {
  const repoUrl = env('GITHUB_REPO_URL');
  const token = env('GITHUB_TOKEN');
  if (!repoUrl || !token) throw new Error('GitHub server configuration is incomplete.');
  return { ...parseRepoUrl(repoUrl), token, branch: env('GITHUB_BRANCH','main'), api: 'https://api.github.com' };
}

async function gh(path, options={}) {
  const cfg = githubConfig();
  const res = await fetch(cfg.api + path, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'js-collections-vercel',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!res.ok) {
    const err = new Error(body.message || `GitHub request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function apiPath(path) { return String(path).split('/').map(encodeURIComponent).join('/'); }
function dataPath(kind='data') {
  return kind === 'orders' ? env('GITHUB_ORDERS_PATH','orders.json') : env('GITHUB_DATA_PATH','site-data.json');
}

async function getJsonFile(path) {
  const cfg = githubConfig();
  try {
    const body = await gh(`/repos/${cfg.owner}/${cfg.repo}/contents/${apiPath(path)}?ref=${encodeURIComponent(cfg.branch)}`);
    const content = Buffer.from((body.content || '').replace(/\n/g,''), 'base64').toString('utf8');
    return { data: JSON.parse(content), sha: body.sha };
  } catch (err) {
    if (err.status === 404) return { data: null, sha: null };
    throw err;
  }
}

async function putJsonFile(path, data, message) {
  const cfg = githubConfig();
  const current = await getJsonFile(path);
  const content = Buffer.from(JSON.stringify(data, null, 2) + '\n','utf8').toString('base64');
  const payload = { message, content, branch: cfg.branch };
  if (current.sha) payload.sha = current.sha;
  return gh(`/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
}

function sign(value) {
  return crypto.createHmac('sha256', env('ADMIN_SESSION_SECRET', env('ADMIN_PASSWORD',''))).update(value).digest('hex');
}
function createSession() {
  const now = Date.now().toString();
  return `${now}.${sign(now)}`;
}
function validSession(token) {
  if (!token) return false;
  const [ts, sig] = String(token).split('.');
  if (!ts || !sig || Date.now() - Number(ts) > 1000*60*60*12) return false;
  const expected = sign(ts);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}
function requireAdmin(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if (!validSession(token)) { const e = new Error('Unauthorized.'); e.status = 401; throw e; }
}

module.exports = { env, githubConfig, gh, getJsonFile, putJsonFile, dataPath, createSession, requireAdmin };
