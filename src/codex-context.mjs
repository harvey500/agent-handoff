import { AsyncLocalStorage } from 'node:async_hooks';
const callers = new AsyncLocalStorage();
export const codexCaller = () => callers.getStore();
export function withCodexCaller(extra, handler) {
  const meta = extra?._meta || {};
  let turn = meta['x-codex-turn-metadata'];
  if (typeof turn === 'string') { try { turn = JSON.parse(turn); } catch { turn = null; } }
  const sourceId = turn?.thread_id || meta['openai/threadId'] || meta.threadId || meta.thread_id;
  return callers.run({ sourceId, turnId: turn?.turn_id }, handler);
}
