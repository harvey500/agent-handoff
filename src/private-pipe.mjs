import net from 'node:net';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const nl = String.fromCharCode(10);
const prefix = name => String.fromCharCode(92, 92, 46, 92) + 'pipe' + String.fromCharCode(92) + 'agent-handoff-' + name + '-';
export async function servePrivatePipe(directory, name, run) {
  if (process.platform !== 'win32' || !path.isAbsolute(directory) || !/^[a-z-]+$/.test(name)) throw new Error('A Windows private pipe directory is required.');
  await mkdir(directory, { recursive: true });
  const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  const sid = identity.match(/S-1-[0-9-]+/)?.[0];
  if (!sid) throw new Error('Could not resolve the current Windows identity.');
  execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'pipe', timeout: 10000 });
  const token = randomBytes(32).toString('hex'), pipe = prefix(name) + randomBytes(16).toString('hex');
  const descriptor = path.join(directory, 'connection.json'), sockets = new Set();
  const lockFile = path.join(directory, 'owner.lock');
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); await lock.writeFile(JSON.stringify({ pid: process.pid })); }
  catch (error) {
    await lock?.close();
    if (error.code === 'EEXIST') throw new Error('Private bridge already has an owner; inspect it rather than replacing its connection.');
    throw error;
  }
  await lock.close();
  // Older bridges have a descriptor but no owner lock. Never replace their
  // capability, or guess that an unreadable/stale descriptor is safe.
  try {
    await readFile(descriptor);
    throw new Error('Private bridge already has a descriptor; inspect its owner before replacing its connection.');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      await unlink(lockFile).catch(() => {});
      throw error;
    }
  }
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.setTimeout(30000, () => socket.destroy());
    let input = Buffer.alloc(0), started = false;
    socket.on('data', chunk => {
      if (started) return;
      input = Buffer.concat([input, chunk]);
      if (input.length > 150000) return socket.destroy();
      if (!input.includes(10)) return;
      started = true;
      void (async () => {
        try {
          const request = JSON.parse(input.subarray(0, input.indexOf(10)).toString('utf8'));
          const supplied = Buffer.from(String(request.token || ''));
          if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) throw new Error('Unauthenticated');
          socket.end(JSON.stringify({ result: await run(request.operation, request.args) }) + nl);
        } catch { socket.end(JSON.stringify({ error: 'Private bridge operation rejected; inspect readiness and the original receipt before retrying.' }) + nl); }
      })();
    });
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); }); }
  catch (error) { await unlink(lockFile).catch(()=>{}); throw error; }
  try { await writeFile(descriptor, JSON.stringify({ pipe, token, pid: process.pid }), { mode: 0o600, flag: 'wx' }); }
  catch (error) { server.close(); await unlink(lockFile).catch(()=>{}); throw error; }
  let closed = false;
  return async () => {
    if (closed) return; closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    const current = await readFile(descriptor, 'utf8').then(JSON.parse).catch(() => null);
    if (current?.token === token) await unlink(descriptor).catch(() => {});
    await unlink(lockFile).catch(() => {});
  };
}
export async function callPrivatePipe(directory, name, operation, args = {}) {
  const descriptor = JSON.parse(await readFile(path.join(directory, 'connection.json'), 'utf8'));
  const start = prefix(name);
  if (typeof descriptor.pipe !== 'string' || !descriptor.pipe.startsWith(start) || !/^[a-f0-9]{32}$/.test(descriptor.pipe.slice(start.length)) || !/^[a-f0-9]{64}$/.test(descriptor.token)) throw new Error('Invalid private bridge descriptor.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(descriptor.pipe);
    let input = Buffer.alloc(0), done = false;
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('Private bridge timed out; do not resend.')), 25000);
    socket.on('error', () => finish(new Error('Private bridge is not connected.')));
    socket.on('close', () => finish(new Error('Private bridge closed; delivery may be unknown.')));
    socket.on('connect', () => socket.write(JSON.stringify({ token: descriptor.token, operation, args }) + nl));
    socket.on('data', chunk => {
      input = Buffer.concat([input, chunk]);
      if (input.length > 8 * 1024 * 1024) return finish(new Error('Private response exceeds limit.'));
      if (!input.includes(10)) return;
      try { const value = JSON.parse(input.subarray(0, input.indexOf(10)).toString('utf8')); finish(value.error ? new Error(value.error) : null, value.result); }
      catch (error) { finish(error); }
    });
  });
}
