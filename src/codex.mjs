import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CodexPipe } from './codex-pipe.mjs';
import { delegationRecords } from './codex-history.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class Codex {
  constructor({ store, bridge, loadDelegations = delegationRecords, home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex') }) {
    this.store = store; this.bridge = bridge || new CodexPipe();
    this.home = fs.realpathSync(home);
    this.accountId = 'codex-local-profile:' + hash(this.home + ':' + this.bridge.pipePath);
    this.prefix = this.accountId + ':';
    this.loadDelegations = loadDelegations;
  }
  alias(id) { return this.store.get('settings', this.prefix + 'alias:' + id); }
  native(id) { return this.alias(id)?.nativeId || id; }
  assertSource(task) {
    if ((task.source.adapter === 'codex' || /^(codex|codex desktop)$/i.test(task.source.application)) && this.native(task.source.conversationId) !== this.bridge.sourceId) throw new Error('Codex source does not match the authenticated calling thread.');
  }
  async status() {
    const tools = await this.bridge.tools();
    for (const name of ['list_threads','read_thread','send_message_to_thread','create_thread']) {
      if (!tools.some(tool => tool.name === name)) throw new Error('Codex app lacks required tool: ' + name);
    }
    const result = await this.bridge.call('read_thread', { threadId: this.bridge.sourceId, hostId: 'local', turnLimit: 1, includeOutputs: false, maxOutputCharsPerItem: 0 });
    if (result.thread?.id !== this.bridge.sourceId || result.thread.kind !== 'codex' || result.thread.hostId !== 'local') throw new Error('Codex caller is not a verified local desktop thread.');
    return { accountId: this.accountId, version: process.env.CODEX_VERSION || 'app-tools',
      currentId: this.bridge.sourceId, support: 'desktop-local-app-tools',
      identityScope: 'local profile and desktop pipe, not provider account identity',
      automation: { transport: 'codex-app-tools', launchReady: true, focusMayChange: false } };
  }
  async check(accountId) {
    if (accountId && accountId !== this.accountId) throw new Error('Codex desktop profile or pipe changed.');
    return this.status();
  }
  async list() {
    let cursor, rows = [], truncated = false;
    for (let page = 0; page < 20; page++) {
      const result = await this.bridge.call('list_threads', { mode: 'history', source: 'codex', hostId: 'local', archived: false, limit: 50, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.threads)) throw new Error('Unsupported Codex thread catalog.');
      rows.push(...result.threads.filter(row => row.kind === 'codex' && row.hostId === 'local'));
      if (!result.nextCursor) { truncated = false; break; }
      if (cursor === result.nextCursor) throw new Error('Codex catalog cursor did not advance.');
      cursor = result.nextCursor; truncated = true;
    }
    const unique = [...new Map(rows.map(row => [row.id,row])).values()];
    return { total: unique.length, truncated, items: unique.map(row => ({
      id: this.store.get('settings', this.prefix + 'native:' + row.id)?.logicalId || row.id,
      nativeId: row.id, title: row.title || 'Codex chat', projectPath: row.cwd,
      state: row.status === 'idle' ? 'idle' : 'busy', transport: 'codex-app-tools',
    })) };
  }
  async create(id, task, accountId) {
    this.assertSource(task);
    await this.check(accountId);
    if (this.alias(id)) throw new Error('Codex conversation already reserved.');
    // create_thread starts a turn: defer creation until the full packet is ready.
    this.store.putSetting(this.prefix + 'alias:' + id, { phase: 'prepared', title: task.title, projectPath: task.projectPath });
    return { id, deferredUntilSend: true };
  }
  async open(id) {
    const alias = this.alias(id);
    if (alias && !alias.nativeId) return { id, prepared: true, navigationChanged: false };
    const catalog = await this.list();
    if (!catalog.items.some(row => row.id === id || row.nativeId === id)) throw new Error('Codex chat is not in the local catalog.');
    return { id, nativeId: this.native(id), navigationChanged: false, visibleInSidebar: true };
  }
  async show(id) {
    await this.open(id);
    if (this.alias(id) && !this.alias(id).nativeId) throw new Error('Codex chat has not been created yet.');
    return this.bridge.call('navigate_to_codex_page', { threadId: this.native(id) });
  }
  async read(id, accountId) {
    await this.check(accountId);
    const alias = this.alias(id);
    if (alias && !alias.nativeId) return { id, title: alias.title, state: 'unknown', requests: [], hasOlder: false };
    const nativeId = this.native(id);
    const result = await this.bridge.call('read_thread', { threadId: nativeId, hostId: 'local', turnLimit: 10, includeOutputs: false, maxOutputCharsPerItem: 20000 });
    if (result.schemaVersion !== 1 || result.thread?.id !== nativeId || result.thread.kind !== 'codex' || result.thread.hostId !== 'local' || !Array.isArray(result.turns)) throw new Error('Codex thread identity or history format changed.');
    const requests = result.turns.map(turn => {
      const users = turn.items.filter(item => item.type === 'userMessage');
      const delegated = turn.items.filter(item => item.type === 'functionCallOutput' && item.namespace === 'codex_app' && ['create_thread','send_message_to_thread'].includes(item.name));
      let delegatedInput = [];
      if (!users.length && delegated.length === 1) {
        const records = this.loadDelegations(this.home, nativeId).filter(item => item.id === delegated[0].id && item.internal_chat_message_metadata_passthrough?.turn_id === turn.id);
        if (records.length === 1) {
          const prefix = '<codex_delegation>' + String.fromCharCode(10) + '  <source_thread_id>' + this.bridge.sourceId + '</source_thread_id>' + String.fromCharCode(10) + '  <input>';
          const suffix = '</input>' + String.fromCharCode(10) + '</codex_delegation>';
          const output = records[0].output;
          if (output.startsWith(prefix) && output.endsWith(suffix)) {
            const text = output.slice(prefix.length, -suffix.length);
            const markers = text.split(String.fromCharCode(10)).filter(line => /^HANDOFF_ID: [0-9a-f-]{36}$/.test(line));
            const dispatch = markers.length === 1 && this.store.get('settings', this.prefix + 'dispatch:' + id + ':' + hash(markers[0]));
            if (dispatch && dispatch.textHash === hash(text)) delegatedInput = [{ type: 'text', text }];
          }
        }
      }
      const messages = turn.items.filter(item => item.type === 'agentMessage' && item.phase !== 'commentary');
      const finals = messages.filter(item => item.phase === 'final_answer');
      const reply = finals.length === 1 ? finals[0] : finals.length > 1 ? null : messages.at(-1);
      const state = (users.length !== 1 && !delegatedInput.length) || finals.length > 1 ? 'unknown' :
        turn.status === 'completed' ? 'completed' : ['failed','interrupted'].includes(turn.status) ? 'failed' : 'pending';
      return { id: turn.id, state, userMessage: { content: delegatedInput.length ? delegatedInput : users.flatMap(item => item.content || []).filter(block => block.type === 'text') },
        assistantMessage: { content: reply ? [{ type: 'text', text: reply.text }] : [] } };
    });
    return { id, nativeId, title: result.thread.title, projectPath: result.thread.cwd,
      state: result.thread.status?.type === 'idle' ? 'idle' : 'busy', requests, hasOlder: !!result.page?.hasMore };
  }
  async send(id, text, marker, accountId, freshOnce = false) {
    await this.check(accountId);
    const history = await this.read(id, accountId);
    const matches = history.requests.filter(r => r.userMessage.content.some(block => block.text.split(String.fromCharCode(10)).map(line => line.trim()).includes(marker)));
    if (matches.length > 1) throw new Error('Duplicate Codex handoff marker.');
    if (matches.length) return { deduplicated: true, requestId: matches[0].id };
    const alias = this.alias(id), isNew = !!alias && !alias.nativeId;
    if (!isNew && this.native(id) === this.bridge.sourceId) throw new Error('Refusing Codex self-delivery.');
    if (!isNew && history.state !== 'idle') throw new Error('Codex target is busy or its status is unknown.');
    if (history.hasOlder && !freshOnce) throw new Error('Codex history is paginated; reconcile before any retry.');
    const key = this.prefix + 'dispatch:' + id + ':' + hash(marker);
    if (!this.store.reserveSetting(key, { phase: 'reserved', marker, textHash: hash(text) })) throw new Error('Codex send already reserved; inspect receipt, never resend automatically.');
    if (!isNew && (await this.read(id,accountId)).state !== 'idle') throw new Error('Codex target became busy before dispatch.');
    let result;
    if (isNew) {
      result = await this.bridge.call('create_thread', { title: '交接 · ' + alias.title, prompt: text,
        model: 'gpt-6.1-sol', target: { type: 'projectless', directoryName: 'agent-handoff' } });
      if (result.hostId !== 'local' || !uuid.test(result.threadId || '')) throw new Error('Codex creation has no confirmed local thread ID; delivery unknown.');
      this.store.putSetting(this.prefix + 'alias:' + id, { ...alias, phase: 'bound', nativeId: result.threadId });
      this.store.putSetting(this.prefix + 'native:' + result.threadId, { logicalId: id });
    } else {
      result = await this.bridge.call('send_message_to_thread', { threadId: this.native(id), hostId: 'local', prompt: text });
    }
    this.store.putSetting(key, { phase: 'dispatched', marker, nativeId: this.native(id), textHash: hash(text) });
    return { invokedOnce: true, nativeId: this.native(id), outcome: 'unconfirmed-until-thread-read' };
  }
}
