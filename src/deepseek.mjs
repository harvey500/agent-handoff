import net from 'node:net';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dataRoot } from './paths.mjs';

export function deepseekRequests(records) {
  const requests = [];
  let current, turn = null;
  for (const { event } of records) {
    if (event.type === 'user/message' && event.data.source?.kind === 'user' && event.surfaceOp === 'append') {
      current = { id: event.data.source?.rpcId || event.data.id, state: 'pending', userMessage: { content: event.data.content || [] }, assistantMessage: { content: [] } };
      requests.push(current);
    } else if (event.type === 'turn/start') {
      turn = event.data.turn; current = null;
    } else if (event.type === 'assistant/message' && current && event.data.turn === turn && event.surfaceOp === 'append') {
      current.assistantMessage.content.push(...(event.data.message?.content || []).filter(part => part.type === 'text'));
    } else if (event.type === 'turn/end' && current && turn !== null && event.data.turn === turn) {
      current.state = event.data.reason?.kind === 'completed' ? 'completed' : 'failed';
      turn = null;
    }
  }
  return requests;
}
export function deepseekBusy(state) {
  return !!(state.running || state.pendingInput?.length || state.queue?.length || state.queue?.nextTurn?.length || state.queue?.nextStep?.length);
}

export class DeepSeek {
  constructor({ directory = path.join(dataRoot, 'deepseek-bridge'), call } = {}) { this.directory = directory; this.callOverride = call; }
  async call(operation, args = {}) {
    if (this.callOverride) return this.callOverride(operation, args);
    const descriptor = JSON.parse(await readFile(path.join(this.directory, 'connection.json'), 'utf8'));
    const prefix = String.fromCharCode(92, 92, 46, 92) + 'pipe' + String.fromCharCode(92) + 'agent-handoff-dsh-';
    if (typeof descriptor.pipe !== 'string' || !descriptor.pipe.startsWith(prefix) || !/^[a-f0-9]{32}$/.test(descriptor.pipe.slice(prefix.length)) || !/^[a-f0-9]{64}$/.test(descriptor.token)) throw new Error('Invalid DSH bridge descriptor.');
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(descriptor.pipe);
      const timer = setTimeout(() => finish(new Error('DSH bridge timed out; do not resend.')), 20000);
      let input = Buffer.alloc(0), done = false;
      const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
      socket.on('error', () => finish(new Error('DSH bridge is not connected.')));
      socket.on('close', () => finish(new Error('DSH bridge closed; delivery may be unknown.')));
      socket.on('connect', () => socket.write(JSON.stringify({ token: descriptor.token, operation, args }) + String.fromCharCode(10)));
      socket.on('data', chunk => {
        input = Buffer.concat([input, chunk]);
        if (input.length > 2000000) return finish(new Error('DSH response exceeds limit.'));
        if (!input.includes(10)) return;
        try { const value = JSON.parse(input.subarray(0, input.indexOf(10)).toString('utf8')); finish(value.error ? new Error(value.error) : null, value.result); }
        catch (error) { finish(error); }
      });
    });
  }
  status() { return this.call('status'); }
  list() { return this.call('list'); }
  async assertAccount(accountId) { if (accountId && (await this.status()).accountId !== accountId) throw new Error('DSH profile identity changed.'); }
  async create(id, task, accountId) { await this.assertAccount(accountId); return this.call('create', { id, title: 'Handoff - ' + task.title, projectPath: task.projectPath, accountId }); }
  open(id) { return this.call('activate', { id }); }
  async read(id, accountId) {
    await this.assertAccount(accountId);
    const row = (await this.list()).items.find(row => row.id === id);
    if (!row) throw new Error('DSH session is not visible in the current profile.');
    const result = await this.call('read', { id: row.nativeId || id, accountId });
    return { id, nativeId: row.nativeId || id, title: row.title || id, projectPath: row.projectPath, hasOlder: result.hasMore, state: deepseekBusy(result.state) ? 'busy' : 'idle', requests: deepseekRequests(result.records) };
  }
  async send(id, text, marker, accountId) {
    await this.assertAccount(accountId);
    if (!text.split(String.fromCharCode(10)).includes(marker)) throw new Error('Missing handoff identity.');
    const requestId = randomUUID();
    const row = (await this.list()).items.find(row => row.id === id);
    if (!row) throw new Error('DSH session is not visible.');
    await this.call('send', { id: row.nativeId || id, text, requestId, handoffId: marker.replace(/^HANDOFF_ID: /, ''), accountId });
    return { requestId };
  }
}
