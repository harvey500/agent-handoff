import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'windows', 'claude-uia.ps1');
export function invokeClaudeUI(args, { timeoutMs = 25000 } = {}) {
  if (process.platform !== 'win32') throw new Error('Claude desktop adapter requires Windows.');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-Command',
      '& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:HANDOFF_CLAUDE_SCRIPT,[Text.Encoding]::UTF8)))'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HANDOFF_CLAUDE_SCRIPT: script } });
    const output = [], errors = [];
    let bytes = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', b => { bytes += b.length; if (bytes > 1000000) { timedOut = true; child.kill(); } else output.push(b); });
    child.stderr.on('data', b => { if (Buffer.concat(errors).length < 32000) errors.push(b); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('Claude operation timed out; delivery may be unknown. Read the original conversation before retrying.'));
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString('utf8').slice(0,3000) || 'Claude UI operation failed.'));
      try { resolve(JSON.parse(Buffer.concat(output).toString('utf8').trim())); } catch { reject(new Error('Claude UI helper returned invalid data.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ expectedVersion: '4.4212.0', ...args }));
  });
}
