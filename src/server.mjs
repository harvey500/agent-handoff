import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.mjs';
import { HandoffService } from './service.mjs';
import { dataRoot, projectRoot } from './paths.mjs';
const store = new Store(dataRoot);
const service = new HandoffService(store);
const token = randomBytes(32).toString('hex');
let origin;
function json(res, code, object) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(object)); }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON content type required');
  let bytes = 0, chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 100000) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const routes = {
  'POST /api/connect': () => service.connect(),
  'POST /api/tasks': b => service.task(b),
  'POST /api/preview': b => service.preview(b.taskId),
  'POST /api/send': b => service.send(b),
  'POST /api/check': b => service.refresh(b.id),
  'POST /api/open': b => service.open(b.conversationId),
  'POST /api/resolve': b => service.resolve(b.id, b.note),
};
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  try {
    if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Invalid Host' });
    if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Cross-origin request rejected' });
    const u = new URL(req.url, origin);
    if (u.pathname.startsWith('/api/')) {
      const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') || '');
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, 401, { error: 'Local API authentication required' });
      if (req.method === 'POST' && u.pathname === '/api/shutdown') {
        json(res, 200, { stopped: true }); setImmediate(shutdown); return;
      }
      if (req.method === 'GET' && u.pathname === '/api/state') return json(res, 200, { tasks: store.list('tasks'), handoffs: store.list('handoffs') });
      if (req.method === 'GET' && u.pathname === '/api/connection') return json(res, 200, await service.connection());
      if (req.method === 'GET' && u.pathname === '/api/conversations') return json(res, 200, await service.conversations(u.searchParams.get('taskId')));
      const handler = routes[req.method + ' ' + u.pathname];
      if (!handler) return json(res, 404, { error: 'Unknown operation' });
      return json(res, 200, await handler(await body(req)));
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const staticFiles = { '/': ['public/index.html', 'text/html; charset=utf-8'], '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
      '/style.css': ['public/style.css', 'text/css; charset=utf-8'], '/lucide.js': ['node_modules/lucide/dist/umd/lucide.min.js', 'text/javascript; charset=utf-8'] };
    const selected = staticFiles[u.pathname];
    if (!selected) return json(res, 404, { error: 'Not found' });
    let content = await fs.readFile(path.join(projectRoot, selected[0]));
    if (u.pathname === '/') content = Buffer.from(content.toString().replace('__LOCAL_TOKEN__', token));
    res.writeHead(200, { 'Content-Type': selected[1] }); res.end(content);
  } catch (e) { json(res, 400, { error: e.message }); }
});
server.requestTimeout = 60000;
server.headersTimeout = 10000;
server.listen(Number(process.env.AGENT_HANDOFF_PORT || 0), '127.0.0.1', async () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  await fs.writeFile(path.join(dataRoot, 'runtime.json'), JSON.stringify({ url: origin, token, pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
  console.log('Agent Handoff: ' + origin);
});
async function shutdown() {
  server.close(async () => {
    try { const r = JSON.parse(await fs.readFile(path.join(dataRoot, 'runtime.json'), 'utf8')); if (r.pid === process.pid) await fs.unlink(path.join(dataRoot, 'runtime.json')); } catch {}
    store.close(); process.exit(0);
  });
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
