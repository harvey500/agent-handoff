import net from 'node:net';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const inject = ['sessionController', 'workspaceRegistry'];
const uuid = value => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value || '');

// The host loads this through its normal Cordis plugin loader, not an injected
// renderer or a second CLI. Only freshly created bridge sessions may be written.
export function bridgeOperations(ctx, identity, journal) {
  const owned = new Map();
  const signal = () => AbortSignal.timeout(15000);
  const rows = async () => {
    const archived = ctx.workspaceRegistry.archivedSessionIds;
    const result = await ctx.sessionController.list({}, signal());
    return result.items.filter(row => !archived.includes(row.sessionId) && !row.parentSessionId);
  };
  const requireSession = async id => {
    if (!uuid(String(id).replace(/^session-/, '')) || !(await rows()).some(row => row.sessionId === id)) throw new Error('Session is missing or archived.');
  };
  return async (operation, args = {}) => {
    const accountId = typeof identity === 'function' ? await identity() : identity;
    if (args.accountId && args.accountId !== accountId) throw new Error('DSH profile identity changed.');
    if (operation === 'status') return { connected: true, accountId, version: '0.2.2-rc.1', executionReady: !!journal && !accountId.endsWith(':unbound'), support: journal ? 'native desktop append; durable reservations' : 'experimental; new bridge sessions only' };
    if (operation === 'list') return { items: (await rows()).map(row => ({ id: row.sessionId.replace(/^session-/, ''), nativeId: row.sessionId, title: row.projections?.values?.title?.title || row.projections?.values?.title || row.sessionId, projectPath: row.cwd, running: row.running })), truncated: false };
    if (operation === 'create') {
      if (!uuid(args.id) || !path.isAbsolute(args.projectPath) || typeof args.title !== 'string' || args.title.length > 160) throw new Error('Invalid new session request.');
      if ((await rows()).some(row => row.sessionId.replace(/^session-/, '') === args.id)) throw new Error('Session already exists; refusing to adopt it.');
      if (journal) await journal.reserve('create:' + args.id, { accountId });
      const workspace = await ctx.workspaceRegistry.create(args.projectPath, 'Agent Handoff');
      const result = await ctx.sessionController.create({ sessionId: args.id, workspaceId: workspace.id });
      if (result.sessionId !== args.id) throw new Error('Host returned a different session identity.');
      owned.set(args.id, { attempted: false });
      await ctx.sessionController.rename({ sessionId: args.id, title: args.title });
      return { id: args.id };
    }
    if (!['read', 'send', 'activate'].includes(operation)) throw new Error('Unsupported bridge operation.');
    await requireSession(args.id);
    if (operation === 'activate') {
      if (!journal && !owned.has(args.id)) throw new Error('Existing-session delivery is not enabled.');
      return { id: args.id, background: true };
    }
    if (operation === 'read') {
      const history = await ctx.sessionController.events({ address: { kind: 'session', sessionId: args.id }, maxMessages: 60 }, signal());
      const state = await ctx.sessionController.state({ sessionId: args.id }, signal());
      return { ...history, state };
    }
    const session = owned.get(args.id);
    if (!journal && (!session || session.attempted)) throw new Error('Only one send to a newly created bridge session is allowed; inspect the original receipt.');
    if (typeof args.text !== 'string' || Buffer.byteLength(args.text) > 60000 || !uuid(args.requestId)) throw new Error('Invalid prompt.');
    // Reserve before the first asynchronous preflight; concurrent callers must
    // not both pass a blank-history check. Failed preflights remain reserved.
    if (journal) {
      if (!/^[0-9a-f-]{36}$/i.test(args.handoffId || '') || !args.text.split(String.fromCharCode(10)).includes('HANDOFF_ID: ' + args.handoffId)) throw new Error('Missing durable handoff identity.');
      await journal.reserve('send:' + accountId + ':' + args.handoffId, { id: args.id, textHash: createHash('sha256').update(args.text).digest('hex') });
    } else session.attempted = true;
    const state = await ctx.sessionController.state({ sessionId: args.id }, signal());
    if (state.running || state.pendingInput?.length || state.queue?.nextTurn?.length || state.queue?.nextStep?.length || Array.isArray(state.queue) && state.queue.length) throw new Error('Session is not idle.');
    const history = await ctx.sessionController.events({ address: { kind: 'session', sessionId: args.id }, maxMessages: 10 }, signal());
    if (!journal && (history.hasMore || history.records.some(row => row.event.type === 'user/message' || row.event.type === 'turn/start'))) throw new Error('Session is no longer blank.');
    if (typeof identity === 'function' && await identity() !== accountId) throw new Error('DSH profile identity changed before dispatch.');
    return ctx.sessionController.prompt({ sessionId: args.id, requestId: args.requestId, content: [{ type: 'text', text: args.text }], mode: 'followup' }, signal());
  };
}

export async function apply(ctx, config) {
  if (process.platform !== 'win32') throw new Error('The experimental DSH bridge requires Windows.');
  if (!config?.directory || !path.isAbsolute(config.directory)) throw new Error('An absolute private bridge directory is required.');
  await mkdir(config.directory, { recursive: true });
  // Remove inherited permissions before placing the local capability in this folder.
  const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  const sid = identity.match(/S-1-[0-9-]+/)?.[0];
  if (!sid) throw new Error('Could not resolve the current Windows identity.');
  execFileSync('icacls.exe', [config.directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'pipe', timeout: 10000 });
  const token = randomBytes(32).toString('hex');
  const pipe = String.fromCharCode(92, 92, 46, 92) + 'pipe' + String.fromCharCode(92) + 'agent-handoff-dsh-' + randomBytes(16).toString('hex');
  const descriptor = path.join(config.directory, 'connection.json');
  const journalDirectory = path.join(config.directory, 'reservations');
  await mkdir(journalDirectory, { recursive: true });
  const journal = { reserve: async (key, value) => {
    const file = path.join(journalDirectory, createHash('sha256').update(key).digest('hex') + '.json');
    let handle;
    try { handle = await open(file, 'wx', 0o600); await handle.writeFile(JSON.stringify(value)); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('DSH operation already reserved; inspect the original receipt.'); throw error; }
    finally { await handle?.close(); }
  } };
  const profileIdentity = async () => {
    const credentialFile = config.credentialFile;
    const epoch = credentialFile ? createHash('sha256').update(await readFile(credentialFile)).digest('hex') : 'unbound';
    return 'dsh-desktop:' + config.directory + ':' + epoch;
  };
  const run = bridgeOperations(ctx, profileIdentity, journal);
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(20000, () => socket.destroy());
    let input = Buffer.alloc(0), started = false;
    socket.on('data', chunk => {
      if (started) return;
      input = Buffer.concat([input, chunk]);
      if (input.length > 100000) return socket.destroy();
      if (!input.includes(10)) return;
      started = true;
      void (async () => {
        try {
          const request = JSON.parse(input.subarray(0, input.indexOf(10)).toString('utf8'));
          const supplied = Buffer.from(String(request.token || ''));
          if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) throw new Error('Bridge authentication failed.');
          socket.end(JSON.stringify({ result: await run(request.operation, request.args) }) + String.fromCharCode(10));
        } catch { socket.end(JSON.stringify({ error: 'DSH bridge operation rejected; check session identity, freshness and readiness.' }) + String.fromCharCode(10)); }
      })();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  try { await writeFile(descriptor, JSON.stringify({ pipe, token, pid: process.pid }), { mode: 0o600 }); }
  catch (error) { server.close(); throw error; }
  ctx.effect(() => async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    const current = await readFile(descriptor, 'utf8').then(JSON.parse).catch(() => null);
    if (current?.token === token) await unlink(descriptor).catch(() => {});
  });
}
