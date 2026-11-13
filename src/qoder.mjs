import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const newline = String.fromCharCode(10);
const qoderHome = () => process.env.AGENT_HANDOFF_QODER_HOME || path.join(os.homedir(), '.qoder');
const projectsRoot = () => path.join(qoderHome(), 'projects');

export async function findQoderCli() {
  const configured = process.env.QODERCLI_BIN;
  if (configured && fs.existsSync(configured)) return configured;
  try {
    const { stdout } = await exec(process.platform === 'win32' ? 'where' : 'which', ['qodercli'], { windowsHide: true, timeout: 8000 });
    const first = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {}
  const names = process.platform === 'win32' ? ['qodercli.cmd', 'qodercli.exe', 'qodercli'] : ['qodercli'];
  const dirs = [
    process.env.NPM_CONFIG_PREFIX,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs'),
    'D:\\npm-global',
    'C:\\npm-global',
    path.join(qoderHome(), 'bin', 'qodercli'),
  ].filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export async function discoverQoder() {
  const executable = await findQoderCli();
  const installed = Boolean(executable) || fs.existsSync(projectsRoot());
  return { id: 'qoder', installed, running: null, executable, endpoint: null, processes: [], transport: 'qodercli', desktopSessionsVerified: false };
}

function localAccountId() {
  if (process.env.AGENT_HANDOFF_QODER_ACCOUNT) return process.env.AGENT_HANDOFF_QODER_ACCOUNT;
  try {
    const raw = fs.readFileSync(path.join(qoderHome(), '.auth', 'machine_id'), 'utf8').trim();
    if (raw) return 'machine:' + raw;
  } catch {}
  return 'local:' + os.userInfo().username;
}

function blocksOf(content) {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string' && b.text.trim()).map(b => ({ type: 'text', text: b.text }));
}

function textOf(message) {
  return (message?.content || []).filter(b => b.type === 'text').map(b => b.text).join(newline);
}

function parseSession(text) {
  const requests = [];
  let current = null;
  let projectPath = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === 'workspace-directories' && Array.isArray(entry.directories) && entry.directories[0]) {
      projectPath = entry.directories[0];
    } else if (entry.type === 'user' && entry.message?.role === 'user') {
      current = { id: entry.uuid, state: 'pending', userMessage: { content: blocksOf(entry.message.content) }, assistantMessage: { content: [] } };
      requests.push(current);
    } else if (entry.type === 'assistant' && current) {
      const blocks = blocksOf(entry.message?.content);
      if (blocks.length) current.assistantMessage.content.push(...blocks);
      if (blocks.length || entry.message?.stop_reason) current.state = 'completed';
    }
  }
  return { requests, projectPath };
}

function titleOf(parsed) {
  const first = parsed.requests.find(r => textOf(r.userMessage).trim());
  return first ? textOf(first.userMessage).replace(/\s+/g, ' ').trim().slice(0, 80) : '(未命名会话)';
}

async function sessionFiles() {
  const root = projectsRoot();
  let dirs;
  try { dirs = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const base = path.join(root, dir.name);
    let names;
    try { names = await fsp.readdir(base); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(base, name);
      try {
        const stat = await fsp.stat(file);
        if (!stat.isFile()) continue;
        found.push({ file, id: name.slice(0, -6), mtime: stat.mtimeMs });
      } catch {}
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

export class Qoder {
  constructor(config = {}) {
    this.config = config;
    this.projectPath = config.projectPath || null;
  }

  async cli() {
    const executable = await findQoderCli();
    if (!executable) throw new Error('未找到 qodercli，请先安装：npm install -g @qoder-ai/qodercli');
    return executable;
  }

  async status() {
    const executable = await this.cli();
    return { connected: false, reason: 'Qoder CLI was found, but desktop session control, login and receipt attribution are not verified. Desktop handoff is disabled; CLI sessions are not desktop chats.', accountId: null, version: 'qodercli', executable,
      currentId: null, support: { desktopSessionsVerified: false }, busy: null, draftPresent: null };
  }

  async list() {
    throw new Error('Unverified Qoder transport: desktop handoff is disabled.');
    const files = await sessionFiles();
    const items = [];
    for (const file of files.slice(0, 200)) {
      let parsed;
      try { parsed = parseSession(await fsp.readFile(file.file, 'utf8')); } catch { continue; }
      items.push({ id: file.id, title: titleOf(parsed), projectPath: parsed.projectPath || null,
        state: parsed.requests.some(r => r.state === 'pending') ? 'busy' : 'idle',
        updatedAt: new Date(file.mtime).toISOString() });
    }
    return { total: items.length, items, truncated: files.length > items.length };
  }

  async create(id, task) {
    throw new Error('Unverified Qoder transport: desktop handoff is disabled.');
    this.projectPath = task.projectPath;
    return { id, title: '交接 · ' + task.title };
  }

  async open(id) {
    throw new Error('Unverified Qoder transport: desktop handoff is disabled.');
  }

  async read(id) {
    throw new Error('Unverified Qoder transport: desktop handoff is disabled.');
    const hit = (await sessionFiles()).find(file => file.id === id);
    if (!hit) throw new Error('Qoder 会话不存在：' + id);
    const parsed = parseSession(await fsp.readFile(hit.file, 'utf8'));
    return { id, title: titleOf(parsed), state: parsed.requests.some(r => r.state === 'pending') ? 'busy' : 'idle',
      projectPath: parsed.projectPath || null, totalRequests: parsed.requests.length, hasOlder: false, requests: parsed.requests };
  }

  async send(id, text, marker, accountId, freshOnce = false) {
    throw new Error('Unverified Qoder transport: desktop handoff is disabled.');
    const hit = (await sessionFiles()).find(file => file.id === id);
    if (hit) {
      const parsed = parseSession(await fsp.readFile(hit.file, 'utf8'));
      const matches = parsed.requests.filter(r => textOf(r.userMessage).split(newline).map(line => line.trim()).includes(marker));
      if (matches.length > 1) throw new Error('同一个交接编号出现多条消息，需要人工检查');
      if (matches.length) return { deduplicated: true, requestId: matches[0].id, transport: 'qodercli' };
      this.projectPath = parsed.projectPath || this.projectPath;
    }
    const executable = await this.cli();
    const cwd = this.projectPath && fs.existsSync(this.projectPath) ? this.projectPath : os.homedir();
    const logDir = path.join(process.env.AGENT_HANDOFF_HOME || path.join(process.cwd(), '.local'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const log = path.join(logDir, 'qoder-' + id + '.log');
    const sink = fs.openSync(log, 'a');
    let child;
    try {
      child = spawn(executable, ['-p', text, '--session-id', id], { cwd, detached: true, stdio: ['ignore', sink, sink], windowsHide: true });
    } finally { fs.closeSync(sink); }
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    return { accepted: true, transport: 'qodercli', log, pid: child.pid };
  }
}
