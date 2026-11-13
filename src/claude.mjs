import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { invokeClaudeUI } from './claude-uia.mjs';
import { parseClaudeTranscript } from './claude-history.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');

async function boundedRead(file, limit, tail = false) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Claude data is not a regular file.');
    if (!tail && stat.size > limit) throw new Error('Claude metadata exceeds the supported size.');
    const bytes = Math.min(stat.size, limit), buffer = Buffer.alloc(bytes);
    const result = await handle.read(buffer, 0, bytes, tail ? stat.size - bytes : 0);
    return { text: buffer.subarray(0, result.bytesRead).toString('utf8'), truncated: stat.size > limit };
  } finally { await handle.close(); }
}

export class Claude {
  constructor({ store, ui = invokeClaudeUI }) { this.store = store; this.ui = ui; }
  async status() {
    const state = await this.ui({ action: 'status', ...(this.profileRoot ? { profileRoot: this.uiProfileRoot, accountId: this.accountId } : {}) });
    const profileRoot = await fs.realpath(state.profileRoot);
    if (path.basename(profileRoot).toLowerCase() !== 'claude-3p') throw new Error('Only the validated Claude gateway local-chat profile is supported.');
    const config = JSON.parse((await boundedRead(path.join(profileRoot, 'config.json'), 1000000)).text);
    if (!uuid.test(config.lastKnownAccountUuid || '')) throw new Error('Claude account identity unavailable.');
    if (this.accountId && this.accountId !== config.lastKnownAccountUuid) throw new Error('Claude account changed.');
    if (this.profileRoot && this.profileRoot !== profileRoot) throw new Error('Claude profile changed.');
    this.profileRoot = profileRoot; this.uiProfileRoot = state.profileRoot; this.accountId = config.lastKnownAccountUuid;
    this.root = path.join(profileRoot, 'local-agent-mode-sessions', this.accountId.slice(0, 8), '00000000');
    this.prefix = 'claude:' + hash(profileRoot.toLowerCase() + ':' + this.accountId) + ':';
    return { ...state, accountId: this.accountId, connected: true, support: 'gateway-local-chat' };
  }
  async check(accountId) {
    const state = await this.status();
    if (accountId && state.accountId !== accountId) throw new Error('Claude account changed.');
    return state;
  }
  alias(id) {
    if (!uuid.test(id)) throw new Error('Invalid Claude conversation ID.');
    return this.store.get('settings', this.prefix + 'alias:' + id);
  }
  save(id, value) { this.store.putSetting(this.prefix + 'alias:' + id, value); }
  dispatchKey(id, marker) { return this.prefix + 'dispatch:' + id + ':' + hash(marker); }
  async sessions() {
    let files;
    try { files = await fs.readdir(this.root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const candidates = files.filter(f => f.isFile() && /^local_[0-9a-f-]{36}\.json$/i.test(f.name));
    if (candidates.length > 1000) throw new Error('Claude session catalog exceeds the bounded adapter limit.');
    const rows = [];
    for (const entry of candidates) {
      const nativeId = entry.name.slice(6, -5);
      if (!uuid.test(nativeId)) continue;
      let data;
      try { data = JSON.parse((await boundedRead(path.join(this.root, entry.name), 8000000)).text); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw new Error('Claude session metadata is not ready; try a read-only refresh.');
      }
      if (data.sessionId !== 'local_' + nativeId || !uuid.test(data.cliSessionId || '') || data.isArchived) continue;
      rows.push({ nativeId, data });
    }
    return rows;
  }
  async list() {
    const state = await this.check(), rows = await this.sessions();
    return { total: rows.length, truncated: false, items: rows.map(({ nativeId, data }) => ({
      id: this.store.get('settings', this.prefix + 'native:' + nativeId)?.logicalId || nativeId,
      nativeId, title: data.title || 'Claude local chat', projectPath: data.cwd || null,
      state: state.currentId === nativeId && state.busy ? 'busy' : data.error ? 'error' : 'idle', transport: 'windows-uia'
    })) };
  }
  async create(id, task, accountId) {
    const state = await this.check(accountId);
    if (this.alias(id)) throw new Error('Claude logical conversation already exists; reconcile before creating.');
    const baselineIds = (await this.sessions()).map(row => row.nativeId);
    this.save(id, { phase: 'preparing', baselineIds, startedAt: Date.now(), projectPath: task.projectPath });
    const result = await this.ui({ action: 'create', profileRoot: state.profileRoot, accountId: this.accountId });
    this.save(id, { phase: 'new-chat-ready', baselineIds, startedAt: Date.now(), projectPath: task.projectPath });
    return { id, ...result, projectAccess: 'path in task packet only; file access is not granted automatically' };
  }
  async open(id) {
    const state = await this.check(), alias = this.alias(id);
    if (alias && !alias.nativeId) {
      if (alias.phase !== 'new-chat-ready' || state.currentId || state.draftPresent || state.busy) throw new Error('Claude new-chat state changed; not navigating or sending.');
      return { id, newChat: true };
    }
    const nativeId = alias?.nativeId || id;
    const row = (await this.sessions()).find(row => row.nativeId === nativeId);
    if (!row) throw new Error('Claude conversation is not in the active account catalog.');
    return this.ui({ action: 'open', nativeId, title: row.data.title, profileRoot: state.profileRoot, accountId: this.accountId });
  }
  async transcript(row, busy = false) {
    const file = path.join(this.root, row.nativeId.slice(0, 8), '.claude', 'projects', 'session', row.data.cliSessionId + '.jsonl');
    try {
      const data = await boundedRead(file, 2000000, true);
      return parseClaudeTranscript(data.text, row.data.cliSessionId, { busy, truncated: data.truncated });
    } catch (error) { if (error.code === 'ENOENT') return { requests: [], hasOlder: false }; throw error; }
  }
  bindNative(id, nativeId, alias) {
    const existing = this.store.get('settings', this.prefix + 'native:' + nativeId);
    if (existing && existing.logicalId !== id) throw new Error('Claude native session already belongs to another logical conversation.');
    this.save(id, { ...alias, nativeId, phase: 'bound' });
    this.store.putSetting(this.prefix + 'native:' + nativeId, { logicalId: id });
  }
  async locate(id) {
    const alias = this.alias(id), rows = await this.sessions();
    if (!alias || alias.nativeId) return rows.find(row => row.nativeId === (alias?.nativeId || id));
    if (!alias.marker) return null;
    const candidates = rows.filter(row => !alias.baselineIds.includes(row.nativeId) && Number(row.data.createdAt) >= alias.startedAt - 2000);
    if (candidates.length > 10) throw new Error('Too many new Claude sessions to reconcile safely.');
    const matches = [];
    for (const row of candidates) {
      const history = await this.transcript(row);
      if (history.requests.some(r => r.userMessage.content.some(b => b.text.split('\n').map(line => line.trim()).includes(alias.marker)))) matches.push(row);
    }
    if (matches.length > 1) throw new Error('Multiple Claude conversations contain this handoff marker.');
    if (matches[0]) this.bindNative(id, matches[0].nativeId, alias);
    return matches[0] || null;
  }
  async read(id, accountId) {
    const state = await this.check(accountId), row = await this.locate(id);
    if (!row) {
      if (this.alias(id)) return { id, title: 'Claude pending conversation', state: 'unknown', requests: [] };
      throw new Error('Claude conversation is not available in this account.');
    }
    const history = await this.transcript(row, state.currentId === row.nativeId && state.busy);
    await this.check(accountId);
    return { ...history, id, nativeId: row.nativeId, title: row.data.title, projectPath: row.data.cwd, state: state.busy && state.currentId === row.nativeId ? 'busy' : 'idle' };
  }
  async send(id, text, marker, accountId) {
    const history = await this.read(id, accountId);
    const matches = history.requests.filter(r => r.userMessage.content.some(b => b.text.split('\n').map(line => line.trim()).includes(marker)));
    if (matches.length > 1) throw new Error('Duplicate Claude handoff markers require manual review.');
    if (matches.length) return { deduplicated: true, requestId: matches[0].id };
    if (history.hasOlder) throw new Error('Claude transcript is truncated; cannot verify a safe send.');
    const dispatchKey = this.dispatchKey(id, marker);
    if (this.store.get('settings', dispatchKey)) throw new Error('Claude send already reserved; reconcile the receipt or owned draft, never automatically resend.');
    await this.open(id);
    const state = await this.check(accountId), alias = this.alias(id);
    if (state.minimized) throw Object.assign(new Error('Claude is minimized. Restore its window before sending; no draft was changed.'), { deliveryAttempted: false });
    if (state.busy || state.draftPresent) throw Object.assign(new Error('Claude is busy or contains an unsent draft.'), { deliveryAttempted: false });
    const uiRequest = { nativeId: alias?.nativeId || id, newChat: !!alias && !alias.nativeId, text, marker, profileRoot: state.profileRoot, accountId };
    if (!this.store.reserveSetting(dispatchKey, { phase: 'staging', marker, textHash: hash(text) })) throw new Error('Claude send was concurrently reserved; reconcile before any retry.');
    const staged = await this.ui({ ...uiRequest, action: 'stage' });
    if (!staged.staged || staged.invokedOnce) throw new Error('Claude staging returned unexpected data; not dispatching.');
    this.store.putSetting(dispatchKey, { phase: 'staged', marker, textHash: hash(text) });
    // A separate UI round trip observes the committed draft and fresh button.
    const beforeDispatch = await this.check(accountId);
    if (beforeDispatch.minimized) throw new Error('Claude was minimized after staging; no send invoked. Restore and reconcile the owned draft.');
    if (beforeDispatch.busy || (!uiRequest.newChat && beforeDispatch.currentId !== uiRequest.nativeId) || (uiRequest.newChat && beforeDispatch.currentId)) throw new Error('Claude target changed after staging; no send invoked.');
    if (alias && !alias.nativeId) this.save(id, { ...alias, marker, phase: 'dispatching' });
    this.store.putSetting(dispatchKey, { phase: 'dispatching', marker, textHash: hash(text) });
    const result = await this.ui({ ...uiRequest, action: 'dispatch' });
    if (!result.invokedOnce) throw new Error('Claude dispatch outcome is unknown; reconcile before retrying.');
    if (alias && !alias.nativeId && result.nativeId) this.bindNative(id, result.nativeId, { ...alias, marker });
    const deadline = Date.now() + 8000;
    do {
      const row = await this.locate(id);
      const observed = row ? { ...(await this.transcript(row)), nativeId: row.nativeId } : { requests: [] };
      const request = observed.requests.find(r => r.userMessage.content.some(b => b.text.split('\n').map(line => line.trim()).includes(marker)));
      if (request) {
        await this.check(accountId);
        this.store.putSetting(dispatchKey, { phase: 'observed', marker, requestId: request.id, textHash: hash(text) });
        return { invokedOnce: true, requestId: request.id, nativeId: observed.nativeId, persisted: true };
      }
      await pause(300);
    } while (Date.now() < deadline);
    throw new Error('Claude send was invoked once but persistence is unconfirmed; query receipt, do not resend.');
  }
}
