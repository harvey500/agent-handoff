import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterCapabilities, desktopCapabilities, requireCapability } from '../src/capabilities.mjs';
import { HandoffService } from '../src/service.mjs';
import { Qoder } from '../src/qoder.mjs';

test('undeclared capabilities fail closed and cannot be enabled by truthy strings', () => {
  assert.equal(adapterCapabilities({ send: 'true' }).send, false);
  assert.throws(() => requireCapability({adapter:'x',capabilities:{}}, 'send'), /does not support/);
});
test('a local machine identifier cannot override explicit disconnected status', async () => {
  const service = new HandoffService(null, { adapters: { workbuddy: { requiresEndpoint:false,
    discover:async()=>({}), makeAdapter:()=>({status:async()=>({accountId:'machine', connected:false, reason:'Login unverified'})}) } } });
  const status = await service.connection();
  assert.equal(status.connected, false);
  assert.equal(status.reason, 'Login unverified');
});
test('unsupported operations are refused before any adapter side effect', async () => {
  let calls = 0;
  const service = new HandoffService(null, { adapters: { workbuddy: { requiresEndpoint:false, capabilities:{read:true},
    discover:async()=>({}), makeAdapter:()=>({status:async()=>({accountId:'a'}),open:async()=>calls++}) } } });
  await assert.rejects(service.open('00000000-0000-4000-8000-000000000000'), /openVisible/);
  assert.equal(calls, 0);
});
test('discovery failure is reported without a rejected-promise cache', async () => {
  let calls = 0;
  const service = new HandoffService(null, {discover:async()=>{calls++;throw new Error('Discovery unavailable');}});
  assert.equal((await service.connection()).connected, false);
  assert.equal((await service.connection()).reason, 'Discovery unavailable');
  assert.equal(calls, 2);
});
test('unvalidated Qoder cannot create or spawn a task even when called directly', async () => {
  const qoder = new Qoder();
  await assert.rejects(qoder.create('anything', {}), /disabled/);
  await assert.rejects(qoder.send('anything', 'text'), /disabled/);
  await assert.rejects(qoder.list(), /disabled/);
  await assert.rejects(qoder.read('anything'), /disabled/);
  await assert.rejects(qoder.open('anything'), /disabled/);
});
test('send checks every dependent capability before list, navigation or dispatch', async () => {
  const taskId = '00000000-0000-4000-8000-000000000001';
  for (const missing of ['list', 'read', 'replies', 'activate', 'create']) {
    let effects = 0;
    const service = new HandoffService({ get: () => ({ id: 'task' }) }, { adapters: {
      workbuddy: { requiresEndpoint: false, capabilities: { ...desktopCapabilities, [missing]: false },
        discover: async () => ({}), makeAdapter: () => ({
          status: async () => ({ accountId: 'a' }), list: async () => { effects++; return { items: [] }; },
          create: async () => effects++, open: async () => effects++, send: async () => effects++,
        }) },
    } });
    await assert.rejects(service.send({ taskId, createNew: true }), new RegExp(missing));
    assert.equal(effects, 0, missing);
  }
});
test('inspection refuses missing list capability before reading a conversation', async () => {
  let effects = 0;
  const service = new HandoffService(null, { adapters: { workbuddy: { requiresEndpoint: false,
    capabilities: { read: true }, discover: async () => ({}), makeAdapter: () => ({
      status: async () => ({ accountId: 'a' }), list: async () => effects++, read: async () => effects++,
    }) } } });
  await assert.rejects(service.inspect('00000000-0000-4000-8000-000000000000'), /list/);
  assert.equal(effects, 0);
});
test('DSH continue-mode is refused before writes unless the durable bridge is ready', async () => {
  let effects = 0;
  const service = new HandoffService({ get: () => ({ mode: 'continue' }) }, { adapters: {
    deepseek: { requiresEndpoint: false, capabilities: desktopCapabilities,
      discover: async () => ({}), makeAdapter: () => ({status:async()=>({accountId:'profile'}),list:async()=>{effects++;return {items:[]};}}) },
  } });
  await assert.rejects(service.send({ target: 'deepseek', taskId: '00000000-0000-4000-8000-000000000001', createNew: true }), /limited to acknowledgement/);
  assert.equal(effects, 0);
});
