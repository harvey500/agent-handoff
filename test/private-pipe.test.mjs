import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { servePrivatePipe, callPrivatePipe } from '../src/private-pipe.mjs';
import { inboundLifecycle } from '../src/inbound-lifecycle.mjs';

test('private bridge refuses legacy descriptors without changing their contents', { skip: process.platform !== 'win32' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-legacy-'));
  const descriptor = path.join(dir, 'connection.json');
  const original = JSON.stringify({ pid: process.pid, token: 'legacy-test-capability' });
  try {
    await fs.writeFile(descriptor, original);
    await assert.rejects(servePrivatePipe(dir, 'test', async () => ({})), /already has a descriptor/);
    assert.equal(await fs.readFile(descriptor, 'utf8'), original);
    assert.equal(await fs.access(path.join(dir, 'owner.lock')).then(() => true, () => false), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('private bridge has one owner, cleans up on MCP lifecycle close and reconnects', { skip: process.platform !== 'win32' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-pipe-'));
  const events = [];
  const makeLifecycle = () => inboundLifecycle(() => servePrivatePipe(dir, 'test', async operation => ({ operation, value: '中文回执' })), () => events.push('store'), true);
  let life = makeLifecycle();
  try {
    assert.equal(await life.ensure({}), true);
    const original = await fs.readFile(path.join(dir, 'connection.json'), 'utf8');
    assert.deepEqual(await callPrivatePipe(dir, 'test', 'status'), { operation: 'status', value: '中文回执' });
    await assert.rejects(servePrivatePipe(dir, 'test', async () => ({})), /already has an owner/);
    assert.equal(await fs.readFile(path.join(dir, 'connection.json'), 'utf8'), original);
    await life.close();
    for (const file of ['connection.json', 'owner.lock']) assert.equal(await fs.access(path.join(dir, file)).then(() => true, () => false), false);
    life = makeLifecycle();
    assert.equal(await life.ensure({}), true);
    assert.notEqual(await fs.readFile(path.join(dir, 'connection.json'), 'utf8'), original);
    assert.equal((await callPrivatePipe(dir, 'test', 'read')).operation, 'read');
  } finally { await life.close(); await fs.rm(dir, { recursive: true, force: true }); }
  assert.equal(events.length, 2);
});
