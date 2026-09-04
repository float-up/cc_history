const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SessionStore, sessionToMarkdown } = require('./lib/session-store');

const PORT = Number(process.env.PORT) || 4312;
const HOST = process.env.HOST || '127.0.0.1';
const CLAUDE_DIR = path.resolve(
  (process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects'))
    .replace(/^~(?=$|\/)/, os.homedir()),
);
const PUBLIC_DIR = path.join(__dirname, 'public');
const store = new SessionStore(CLAUDE_DIR);
const clients = new Set();
let lastFingerprint = '';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function safeFilename(value) {
  return String(value || 'claude-session')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'claude-session';
}

function serveStatic(urlPath, res) {
  const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, requested);
  if (file !== PUBLIC_DIR && !file.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(file, (error, content) => {
    if (error) {
      sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: 'Not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

function handleApi(req, res, url) {
  if (url.pathname === '/api/config') {
    sendJson(res, 200, { source: CLAUDE_DIR, exists: fs.existsSync(CLAUDE_DIR) });
    return true;
  }

  if (url.pathname === '/api/sessions') {
    sendJson(res, 200, { sessions: store.list() });
    return true;
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return true;
  }

  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(\/export)?$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const session = store.get(id);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return true;
    }
    if (match[2]) {
      const markdown = sessionToMarkdown(session);
      const filename = `${safeFilename(session.title)}.md`;
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="session.md"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      });
      res.end(markdown);
      return true;
    }
    sendJson(res, 200, { session });
    return true;
  }

  return false;
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    if (url.pathname.startsWith('/api/') && handleApi(req, res, url)) return;
    serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || 'Internal server error' });
  }
});

setInterval(() => {
  try {
    const fingerprint = store.fingerprint();
    if (!lastFingerprint) {
      lastFingerprint = fingerprint;
      return;
    }
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      const message = `event: sessions\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`;
      for (const client of clients) client.write(message);
    }
  } catch (error) {
    console.error('Unable to watch Claude sessions:', error.message);
  }
}, 1000).unref();

setInterval(() => {
  for (const client of clients) client.write(': heartbeat\n\n');
}, 20000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Claude Session Viewer: http://${HOST}:${PORT}`);
  console.log(`Reading sessions from: ${CLAUDE_DIR}`);
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.warn('Session directory does not exist. Set CLAUDE_PROJECTS_DIR to override it.');
  }
});
