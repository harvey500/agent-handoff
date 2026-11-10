import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { codexCaller } from './codex-context.mjs';
const maxFrame = 8 * 1024 * 1024;
export class CodexPipe {
  constructor({ pipePath = process.env.CODEX_APP_TOOLS_PIPE_PATH, sourceId = codexCaller()?.sourceId || (!codexCaller() && (process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID)), connect = net.createConnection, timeoutMs = 20000 } = {}) {
    const prefix = String.fromCharCode(92,92,46,92) + 'pipe' + String.fromCharCode(92) + 'codex-app-tools-';
    if (process.platform === 'win32' && (!pipePath?.startsWith(prefix) || !/^[a-z0-9-]+$/i.test(pipePath.slice(prefix.length)))) throw new Error('A Codex-provided local app tools pipe is required.');
    if (!pipePath || !sourceId) throw new Error('Run this adapter inside Codex Desktop with its app tools pipe and source thread identity.');
    this.pipePath = pipePath; this.sourceId = sourceId; this.connect = connect; this.timeoutMs = timeoutMs;
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const socket = this.connect(this.pipePath), id = randomUUID();
      let bytes = Buffer.alloc(0), finished = false;
      const finish = (error, result) => {
        if (finished) return; finished = true; clearTimeout(timer); socket.destroy();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('Codex app request timed out; query the receipt before retrying a send.')), this.timeoutMs);
      socket.on('error', error => finish(error));
      socket.on('close', () => finish(new Error('Codex app pipe closed; delivery may be unknown.')));
      socket.on('connect', () => {
        const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        if (body.length > maxFrame) return finish(new Error('Codex request exceeds frame limit.'));
        const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
        socket.write(Buffer.concat([header, body]));
      });
      socket.on('data', chunk => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > maxFrame + 4) return finish(new Error('Codex response exceeds frame limit.'));
        if (bytes.length < 4) return;
        const length = bytes.readUInt32LE(0);
        if (!length || length > maxFrame) return finish(new Error('Invalid Codex frame length.'));
        if (bytes.length < length + 4) return;
        try {
          const response = JSON.parse(bytes.subarray(4, length + 4).toString('utf8'));
          if (response.id !== id || response.jsonrpc !== '2.0') throw new Error('Codex response identity mismatch.');
          if (response.error) throw new Error(response.error.message || 'Codex app rejected request.');
          if (!Object.hasOwn(response, 'result')) throw new Error('Codex result missing.');
          finish(null, response.result);
        } catch (error) { finish(error); }
      });
    });
  }
  async tools() {
    const result = await this.request('tools/list', { threadStartKind: 'all' });
    if (!Array.isArray(result.tools)) throw new Error('Codex tool catalog unavailable.');
    this.catalog = result.tools; return result.tools;
  }
  async call(name, args) {
    const tools = this.catalog || await this.tools(), tool = tools.find(item => item.name === name);
    if (!tool || tool.namespace !== 'codex_app') throw new Error('Required Codex app tool unavailable: ' + name);
    const result = await this.request('tools/call', { tool: name, namespace: tool.namespace, arguments: args,
      callerSource: 'codex', threadId: this.sourceId, callId: 'handoff-' + randomUUID(), turnId: codexCaller()?.turnId || 'handoff-' + randomUUID() });
    const text = (result.contentItems || []).filter(item => item.type === 'inputText').map(item => item.text).join(String.fromCharCode(10));
    if (!result.success) throw new Error('Codex app operation failed: ' + text.slice(0,2000));
    try { return JSON.parse(text); } catch { throw new Error('Codex app returned an unsupported non-JSON result.'); }
  }
}
