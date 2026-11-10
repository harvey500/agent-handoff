import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export function delegationRecords(home, threadId) {
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'), { readOnly: true });
  let row;
  try { row = db.prepare('SELECT rollout_path FROM threads WHERE id = ? AND archived = 0').get(threadId); }
  finally { db.close(); }
  if (!row) throw new Error('Codex thread rollout unavailable.');
  const root = fs.realpathSync(path.join(home, 'sessions')), file = fs.realpathSync(row.rollout_path);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Codex rollout is outside active sessions.');
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Codex rollout is not a regular file.');
    const head = Buffer.alloc(Math.min(262144, stat.size));
    fs.readSync(fd, head, 0, head.length, 0);
    const firstLine = head.toString('utf8').split(String.fromCharCode(10))[0];
    const meta = JSON.parse(firstLine);
    if (meta.type !== 'session_meta' || meta.payload.id !== threadId) throw new Error('Codex rollout thread identity mismatch.');
    const length = Math.min(stat.size, 2000000), tail = Buffer.alloc(length);
    fs.readSync(fd, tail, 0, length, stat.size - length);
    const lines = tail.toString('utf8').split(String.fromCharCode(10));
    if (stat.size > length) lines.shift();
    const records = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const item = record.payload;
      if (record.type === 'response_item' && item?.type === 'function_call_output' && item.namespace === 'codex_app' &&
          ['create_thread','send_message_to_thread'].includes(item.name) && typeof item.output === 'string') records.push(item);
    }
    return records;
  } finally { fs.closeSync(fd); }
}
