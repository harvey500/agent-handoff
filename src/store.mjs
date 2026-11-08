import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, 'handoff.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(task TEXT NOT NULL, adapter TEXT NOT NULL, conversation TEXT NOT NULL, PRIMARY KEY(task,adapter));
      CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS task_active_v2 ON handoffs(task) WHERE status IN ('preparing','sending','pending','unknown','needs-info','reply-unconfirmed','accepted');`);
  }
  get(table, id) {
    if (!['tasks', 'handoffs', 'settings'].includes(table)) throw new Error('Invalid table');
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.body) : null;
  }
  list(table) {
    if (!['tasks', 'handoffs'].includes(table)) throw new Error('Invalid table');
    return this.db.prepare(`SELECT body FROM ${table} ORDER BY rowid DESC`).all().map(r => JSON.parse(r.body));
  }
  putTask(task) { this.db.prepare('INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id, JSON.stringify(task)); return task; }
  putSetting(id, value) { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id, JSON.stringify(value)); }
  reserveSetting(id, value) { return this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(id, JSON.stringify(value)).changes === 1; }
  insertHandoff(h) {
    this.db.prepare('INSERT INTO handoffs VALUES(?,?,?,?)').run(h.id, h.taskId, h.status, JSON.stringify(h));
    return h;
  }
  updateHandoff(h) { this.db.prepare('UPDATE handoffs SET status=?,body=? WHERE id=?').run(h.status, JSON.stringify(h), h.id); return h; }
  binding(task, adapter) { return this.db.prepare('SELECT conversation FROM bindings WHERE task=? AND adapter=?').get(task, adapter)?.conversation; }
  bind(task, adapter, conversation) { this.db.prepare('INSERT INTO bindings VALUES(?,?,?) ON CONFLICT(task,adapter) DO UPDATE SET conversation=excluded.conversation').run(task, adapter, conversation); }
  replaceWithSupplement(id, text) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const parent = this.get('handoffs', id);
      if (!parent || !['needs-info','reply-unconfirmed'].includes(parent.status)) throw new Error('此回执已处理或不支持补充');
      const task = this.get('tasks', parent.taskId);
      this.putTask({ ...task, supplement:text, parentHandoffId:id, updatedAt:new Date().toISOString() });
      this.updateHandoff({ ...parent, status:'closed', resolution:'由同一任务的补充交接继续，未取消远端执行', updatedAt:new Date().toISOString() });
      this.db.exec('COMMIT');
      return {task,parent};
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
}
