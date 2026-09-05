const DEFAULT_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DATA_PATH = (process.env.GITHUB_DATA_PATH || 'site-data.json').replace(/^\/+/, '');

function getRepo() {
  const raw = process.env.GITHUB_REPO_URL;
  if (!raw) throw new Error('Missing GITHUB_REPO_URL environment variable.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('GITHUB_REPO_URL must be a valid GitHub repository URL.'); }
  if (url.hostname !== 'github.com') throw new Error('GITHUB_REPO_URL must point to github.com.');
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('GITHUB_REPO_URL must look like https://github.com/OWNER/REPO.');
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Missing GITHUB_TOKEN environment variable.');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

async function githubRequest(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { ...githubHeaders(), ...(options.headers || {}) }
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const message = payload.message || `GitHub API returned ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function encodeBase64Utf8(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function decodeBase64Utf8(value) {
  return Buffer.from(String(value).replace(/\n/g, ''), 'base64').toString('utf8');
}

async function getDataFile() {
  const { owner, repo } = getRepo();
  const path = encodeURIComponent(DATA_PATH).replace(/%2F/g, '/');
  const result = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(DEFAULT_BRANCH)}`);
  if (Array.isArray(result)) throw new Error(`${DATA_PATH} is a directory, not a file.`);
  return { data: JSON.parse(decodeBase64Utf8(result.content)), sha: result.sha, path: DATA_PATH };
}

async function upsertDataFile(data, message) {
  const { owner, repo } = getRepo();
  const path = encodeURIComponent(DATA_PATH).replace(/%2F/g, '/');
  let existing = null;
  try { existing = await getDataFile(); } catch (error) {
    if (error.status !== 404) throw error;
  }

  const body = {
    message: message || 'Update site content',
    content: encodeBase64Utf8(JSON.stringify(data, null, 2) + '\n'),
    branch: DEFAULT_BRANCH
  };
  if (existing && existing.sha) body.sha = existing.sha;

  try {
    return await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  } catch (error) {
    // One safe retry for a stale SHA caused by a parallel commit.
    if (error.status === 409 && existing) {
      const latest = await getDataFile();
      body.sha = latest.sha;
      return githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
    }
    throw error;
  }
}

module.exports = { DEFAULT_BRANCH, DATA_PATH, getRepo, getDataFile, upsertDataFile };
