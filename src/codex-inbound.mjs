import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateTaskInput, formatPacket } from './contracts.mjs';
import { sourceAdapter } from './conversation-routing.mjs';
import { callPrivatePipe, servePrivatePipe } from './private-pipe.mjs';
import { dataRoot } from './paths.mjs';

const uuid = value => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value || '');
const hash = value => createHash('sha256').update(value).digest('hex');
const directory = () => path.join(dataRoot, 'codex-inbound');

// The owning Codex process retains its own authenticated caller. External hosts
// receive only handoff operations, never a raw app-tools endpoint or identity.
export function inboundOperations(adapter, store) {
  const key = 'codex-inbound:';
  return async (operation, args = {}) => {
    if (operation === 'status') return { ...await adapter.status(), support: 'opt-in-codex-inbound' };
    if (operation === 'list') return adapter.list();
    if (operation === 'authorize') {
      const { id, createdAt, updatedAt, ...input } = args.task;
      const task = { ...validateTaskInput(input), id };
      sourceAdapter(task.source);
      if (!uuid(task.id) || !path.isAbsolute(task.projectPath) || !['workbuddy','claude','qoder','deepseek'].includes(task.source.adapter)) throw new Error('A real external source task is required.');
      if (!args.createNew && !uuid(args.conversationId)) throw new Error('Explicit target is required.');
      const record = { task, createNew: args.createNew === true, conversationId: args.conversationId };
      const prior = store.get('settings', key + 'task:' + task.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error('An inbound authorization cannot be replaced.');
      store.putSetting(key + 'task:' + task.id, record);
      return { authorized: true, taskId: task.id };
    }
    if (operation === 'read') return adapter.read(args.id, args.accountId);
    if (operation === 'activate') return adapter.open(args.id);
    if (operation === 'show') return adapter.show(args.id);
    if (operation === 'create') {
      const grant = store.get('settings', key + 'task:' + args.taskId);
      if (!grant?.createNew || !uuid(args.id)) throw new Error('No inbound new-chat grant.');
      const reserved = key + 'created:' + args.taskId;
      if (!store.reserveSetting(reserved, { id: args.id })) throw new Error('Creation already reserved; inspect the original receipt.');
      await adapter.create(args.id, grant.task, args.accountId);
      store.putSetting(key + 'session:' + args.id, { taskId: args.taskId });
      return { id: args.id };
    }
    if (operation !== 'send') throw new Error('Unsupported inbound operation.');
    const grant = store.get('settings', key + 'task:' + args.taskId);
    if (!grant || !uuid(args.id) || !uuid(args.handoffId)) throw new Error('No inbound task grant.');
    if (grant.createNew ? store.get('settings', key + 'session:' + args.id)?.taskId !== args.taskId : grant.conversationId !== args.id) throw new Error('Inbound target differs from its grant.');
    const text = formatPacket(grant.task, args.handoffId);
    if (hash(text) !== args.textHash) throw new Error('Inbound packet differs from the authorized task.');
    return adapter.send(args.id, text, 'HANDOFF_ID: ' + args.handoffId, args.accountId, true);
  };
}
export function startCodexInbound(adapter, store, targetDirectory = directory()) {
  return servePrivatePipe(targetDirectory, 'codex-inbound', inboundOperations(adapter, store));
}
export class CodexInbound {
  constructor({ directory: targetDirectory = directory(), call } = {}) { this.directory = targetDirectory; this.callOverride = call; }
  call(operation, args) { return this.callOverride ? this.callOverride(operation, args) : callPrivatePipe(this.directory, 'codex-inbound', operation, args); }
  status() { return this.call('status'); }
  list() { return this.call('list'); }
  async authorize(task, options) {
    await this.call('authorize', { task, createNew: options.createNew, conversationId: options.conversationId });
    this.taskId = task.id;
  }
  create(id, task, accountId) { return this.call('create', { id, taskId: task.id, accountId }); }
  open(id) { return this.call('activate', { id }); }
  show(id) { return this.call('show', { id }); }
  read(id, accountId) { return this.call('read', { id, accountId }); }
  send(id, text, marker, accountId) {
    const handoffId = marker.replace(/^HANDOFF_ID: /, '');
    return this.call('send', { id, taskId: this.taskId, handoffId, accountId, textHash: hash(text) });
  }
}
