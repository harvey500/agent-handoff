import test from 'node:test';
import assert from 'node:assert/strict';
import { inboundLifecycle } from '../src/inbound-lifecycle.mjs';

test('inbound bridge is opt-in and does not start from an unrelated host', async () => {
  let starts = 0, closes = 0;
  const life = inboundLifecycle(async () => { starts++; }, () => closes++);
  assert.equal(await life.ensure({}), false);
  await life.close(); await life.close();
  assert.equal(starts, 0); assert.equal(closes, 1);
});
test('one MCP owner starts once and closes its bridge before the store', async () => {
  const calls = [];
  const life = inboundLifecycle(async () => { calls.push('start'); return async () => calls.push('bridge'); }, () => calls.push('store'), true);
  await Promise.all([life.ensure({}), life.ensure({})]);
  await life.close(); await life.close();
  assert.deepEqual(calls, ['start','bridge','store']);
  assert.equal(await life.ensure({}), false);
});
test('MCP disconnect during startup waits and cleans up instead of orphaning the bridge', async () => {
  let release;
  const calls = [], ready = new Promise(resolve => { release = resolve; });
  const life = inboundLifecycle(async () => { await ready; return async () => calls.push('bridge'); }, () => calls.push('store'), true);
  const start = life.ensure({}), close = life.close();
  release(); await start; await close;
  assert.deepEqual(calls, ['bridge','store']);
});
test('inbound owner conflict does not break unrelated host tools or close another bridge', async()=>{
 let starts=0,closes=0;
 const life=inboundLifecycle(async()=>{starts++;throw Error('owner exists');},()=>closes++,true);
 assert.equal(await life.ensure({}),false);assert.equal(await life.ensure({}),false);
 assert.equal(life.status().ready,false);assert.match(life.status().error,/owner exists/);
 await life.close();assert.equal(starts,1);assert.equal(closes,1);
});
