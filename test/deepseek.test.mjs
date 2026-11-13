import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { bridgeOperations, apply } from '../src/deepseek-bridge.mjs';
import { deepseekRequests, deepseekBusy, DeepSeek } from '../src/deepseek.mjs';
import { parseReply } from '../src/contracts.mjs';

const event = (type, data, surfaceOp) => ({ event: { type, data, surfaceOp } });
test('DSH receipt follows the real user RPC and its own completed turn', () => {
  const id = randomUUID();
  const rows = [event('turn/start', { turn: 1 }), event('user/message', { id: 'u', source: { kind: 'user', rpcId: 'r' }, content: [{ type: 'text', text: 'HANDOFF_ID: ' + id }] }, 'append'), event('user/message', { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'internal context' }] }, 'append'), event('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'HANDOFF_ACCEPTED ' + id }] } }, 'append'), event('turn/end', { turn: 1, reason: { kind: 'completed' } })];
  const requests = deepseekRequests(rows);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, 'r');
  assert.equal(parseReply(requests[0], id).status, 'accepted');
  rows.at(-1).event.data.reason = { kind: 'aborted' };
  assert.equal(parseReply(deepseekRequests(rows)[0], id).status, 'failed');
  rows.at(-1).event.data.turn = 2;
  assert.equal(deepseekRequests(rows)[0].state, 'pending');
});

function host() {
  const items = [], calls = [];
  const ctx = { workspaceRegistry: { archivedSessionIds: [], create: async () => ({ id: 'workspace' }) }, sessionController: {
    list: async () => ({ items }), create: async request => { items.push({ sessionId: request.sessionId }); return { sessionId: request.sessionId }; },
    rename: async () => {}, state: async () => ({ running: false, pendingInput: [], queue: [] }),
    events: async () => ({ records: [], hasMore: false }),
    prompt: async request => { calls.push(request); return { accepted: true }; },
  } };
  return { ctx, calls, items, run: bridgeOperations(ctx, 'profile') };
}
test('DSH refuses arbitrary existing sessions and archived sessions', async () => {
  const h = host(), id = randomUUID(); h.items.push({ sessionId: id });
  await assert.rejects(h.run('activate', { id }), /Existing-session/);
  await assert.rejects(h.run('create', { id, projectPath: process.cwd(), title: 'test' }), /already exists/);
  h.ctx.workspaceRegistry.archivedSessionIds.push(id);
  await assert.rejects(h.run('read', { id }), /archived/);
});
test('DSH sends at most once even after an ambiguous prompt failure', async () => {
  const h = host(), id = randomUUID();
  await h.run('create', { id, projectPath: process.cwd(), title: 'test' });
  h.ctx.sessionController.prompt = async () => { throw new Error('connection lost'); };
  const request = { id, text: 'confirm only', requestId: randomUUID() };
  await assert.rejects(h.run('send', request), /connection lost/);
  await assert.rejects(h.run('send', request), /Only one send/);
});
test('DSH refuses busy or nonblank test sessions without calling prompt', async () => {
  const h = host(), id = randomUUID();
  await h.run('create', { id, projectPath: process.cwd(), title: 'test' });
  h.ctx.sessionController.state = async () => ({ running: true });
  const request = { id, text: 'confirm only', requestId: randomUUID() };
  await assert.rejects(h.run('send', request), /not idle/);
  const freshId = randomUUID();
  await h.run('create', { id: freshId, projectPath: process.cwd(), title: 'test' });
  h.ctx.sessionController.state = async () => ({ running: false });
  h.ctx.sessionController.events = async () => ({ records: [event('user/message', {})], hasMore: false });
  await assert.rejects(h.run('send', { ...request, id: freshId }), /no longer blank/);
  assert.equal(h.calls.length, 0);
});
test('DSH concurrent sends reserve admission before asynchronous checks', async () => {
  const h = host(), id = randomUUID();
  await h.run('create', { id, projectPath: process.cwd(), title: 'test' });
  const results = await Promise.allSettled([1, 2].map(() => h.run('send', { id, text: 'test', requestId: randomUUID() })));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(h.calls.length, 1);
});
test('DSH prefixed native sessions retain a separate logical identity', async () => {
  const h = host(), id = randomUUID(); h.items.push({ sessionId: 'session-' + id });
  const row = (await h.run('list')).items[0];
  assert.equal(row.id, id); assert.equal(row.nativeId, 'session-' + id);
  await h.run('read', { id: row.nativeId });
});
test('Windows DSH authenticated pipe opens and cleans up its private descriptor', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'handoff-dsh-'));
  const disposers = [];
  try {
    await apply({ effect: f => disposers.push(f()) }, { directory });
    const adapter = new DeepSeek({ directory });
    assert.equal((await adapter.status()).connected, true);
    await assert.rejects(adapter.call('unknown'), /rejected/);
  } finally {
    for (const dispose of disposers) await dispose();
    await assert.rejects(readFile(path.join(directory, 'connection.json')), /ENOENT/);
    await rm(directory, { recursive: true, force: true });
  }
});
test('DSH validates profile and packet identity before sending', async () => {
  const adapter = new DeepSeek({ call: async () => ({ accountId: 'profile' }) });
  await assert.rejects(adapter.send(randomUUID(), 'hello', 'marker', 'other'), /identity changed/);
  await assert.rejects(adapter.send(randomUUID(), 'hello', 'marker', 'profile'), /Missing handoff/);
});
test('DSH treats both native queue shapes and pending input as busy', () => {
  for (const state of [{running:true},{pendingInput:[{}]},{queue:[{}]},{queue:{nextTurn:[{}]}},{queue:{nextStep:[{}]}}]) assert.equal(deepseekBusy(state), true);
  assert.equal(deepseekBusy({running:false,pendingInput:[],queue:{nextTurn:[],nextStep:[]}}), false);
});
test('DSH fragmented UTF-8 response is decoded only after a complete frame', {skip:process.platform!=='win32'}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'handoff-dsh-utf8-'));
  const {writeFile} = await import('node:fs/promises');
  const pipe = String.fromCharCode(92,92,46,92)+'pipe'+String.fromCharCode(92)+'agent-handoff-dsh-'+randomUUID().replaceAll('-','');
  const expected = '中文交接已收到';
  const bytes = Buffer.from(JSON.stringify({result:{text:expected}})+'\n');
  const split = bytes.indexOf(Buffer.from(expected))+1;
  const sockets = new Set();
  const server = net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    socket.once('data',()=>{socket.write(bytes.subarray(0,split));setTimeout(()=>socket.end(bytes.subarray(split)),25);});
  });
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});
    await writeFile(path.join(directory,'connection.json'),JSON.stringify({pipe,token:'a'.repeat(64)}));
    assert.equal((await new DeepSeek({directory}).call('read')).text,expected);
  } finally {
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
