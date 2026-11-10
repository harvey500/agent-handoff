import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { HandoffService } from '../src/service.mjs';

function fixture(t, target = 'workbuddy') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'same-client-'));
  const store = new Store(dir), sourceId = randomUUID(), targetId = randomUUID(), nativeId = randomUUID();
  const items = [{ id: sourceId, nativeId, title: 'Shared task' }, { id: targetId, title: 'Shared task' }];
  const histories = new Map(), effects = [];
  let accountId = 'test-account';
  const adapter = {
    status: async () => ({ accountId, version: 'fixture', currentId: sourceId }),
    list: async () => ({ items: [...items], total: items.length, truncated: false }),
    create: async id => { effects.push(['create', id]); items.push({ id, title: 'New task' }); },
    open: async id => { effects.push(['open', id]); },
    send: async (id, text, marker) => {
      effects.push(['send', id]);
      histories.set(id, [{ id: randomUUID(), state: 'completed',
        userMessage: { content: [{ type: 'text', text }] },
        assistantMessage: { content: [{ type: 'text', text: 'HANDOFF_ACCEPTED ' + marker.slice(12) }] } }]);
      return { accepted: true };
    },
    read: async id => ({ title: 'Recipient', requests: histories.get(id) || [] }),
  };
  const service = new HandoffService(store, { adapters: { [target]: {
    discover: async () => ({}), makeAdapter: () => adapter, requiresEndpoint: false, testedVersions: ['fixture'],
  } } });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const task = (source = {}) => service.task({ title: 'Shared task', taskKey: 'test', goal: 'Continue the task',
    projectPath: dir, source: { application: target === 'claude' ? 'Claude Desktop' : target === 'codex' ? 'Codex' : 'WorkBuddy AI',
      conversationId: sourceId, ...source }, mode: 'continue' });
  return { service, store, sourceId, targetId, nativeId, items, effects, task,
    account: value => { accountId = value; } };
}

for (const target of ['workbuddy', 'claude', 'codex']) {
  test(target + ': same-client route excludes source even when titles match', async t => {
    const f = fixture(t, target), task = f.task();
    const catalog = await f.service.conversations(task.id, target);
    assert.equal(catalog.handoffKind, 'same-client');
    assert.deepEqual(catalog.items.map(row => row.id), [f.targetId]);
    const route = await f.service.route(task.id, target);
    assert.equal(route.handoffKind, 'same-client');
    assert.deepEqual(route.candidates.map(row => row.id), [f.targetId]);
    assert.equal(f.effects.length, 0);
  });
  test(target + ': transfer to a different chat persists receipt and does not resend', async t => {
    const f = fixture(t, target), task = f.task();
    const receipt = await f.service.transfer({ target, taskId: task.id, conversationId: f.targetId, waitSeconds: 0 });
    assert.equal(receipt.status, 'accepted');
    assert.equal(receipt.handoffKind, 'same-client');
    assert.equal(receipt.sourceMustYield, true);
    assert.equal(receipt.source.conversationId, f.sourceId);
    const resumed = await f.service.transfer({ target, taskId: task.id, waitSeconds: 0 });
    assert.equal(resumed.id, receipt.id);
    assert.deepEqual(f.effects.filter(([kind]) => kind === 'send'), [['send', f.targetId]]);
    f.account('different-account');
    await assert.rejects(f.service.refresh(receipt.id), /账号/);
  });
  test(target + ': self-delivery and native aliases fail before any UI mutation', async t => {
    const f = fixture(t, target), task = f.task();
    for (const conversationId of [f.sourceId, f.nativeId, f.sourceId.toUpperCase()]) {
      await assert.rejects(f.service.send({ target, taskId: task.id, conversationId }), /different verified conversation/);
    }
    assert.equal(f.effects.length, 0);
    assert.equal(f.store.list('handoffs').length, 0);
  });
  test(target + ': explicit new-chat flow never reuses source', async t => {
    const f = fixture(t, target), task = f.task();
    f.items.splice(1);
    const route = await f.service.route(task.id, target);
    assert.equal(route.catalog.length, 0);
    assert.equal(f.effects.length, 0);
    const receipt = await f.service.transfer({ target, taskId: task.id, createNew: true, waitSeconds: 0 });
    assert.equal(receipt.status, 'accepted');
    assert.notEqual(receipt.conversationId, f.sourceId);
    assert.equal(f.effects.filter(([kind]) => kind === 'create').length, 1);
  });
}
test('source native local_ identity resolves to logical ID and source is excluded', async t => {
  const f = fixture(t, 'claude'), task = f.task({ conversationId: 'local_' + f.nativeId.toUpperCase() });
  const route = await f.service.route(task.id, 'claude');
  assert.equal(route.sourceConversationId, f.sourceId);
  assert.deepEqual(route.catalog.map(row => row.id), [f.targetId]);
});
test('missing or ambiguous source fails closed, including a new-chat request', async t => {
  const f = fixture(t), task = f.task({ conversationId: randomUUID() });
  await assert.rejects(f.service.route(task.id), /uniquely verify/);
  await assert.rejects(f.service.send({ taskId: task.id, createNew: true }), /uniquely verify/);
  f.items.push({ id: randomUUID(), nativeId: f.nativeId });
  const ambiguous = f.task({ conversationId: f.nativeId });
  await assert.rejects(f.service.send({ taskId: ambiguous.id, conversationId: f.targetId }), /uniquely verify/);
  assert.equal(f.effects.length, 0);
});
test('an old self-binding is ignored by routing and blocked by low-level send', async t => {
  const f = fixture(t), task = f.task();
  const { createHash } = await import('node:crypto');
  f.store.bind(task.id, 'workbuddy:' + createHash('sha256').update('test-account').digest('hex'), f.sourceId);
  const route = await f.service.route(task.id);
  assert.equal(route.action, 'review-candidates');
  await assert.rejects(f.service.send({ taskId: task.id }), /different verified conversation/);
  assert.equal(f.effects.length, 0);
});
test('explicit adapter supports custom host names but rejects contradictory identity', async t => {
  const f = fixture(t);
  const task = f.task({ application: 'Custom Host', adapter: 'workbuddy' });
  assert.equal((await f.service.route(task.id)).handoffKind, 'same-client');
  assert.throws(() => f.task({ adapter: 'claude' }), /disagree/);
});
test('cross-client tasks keep recipient chats even when their UUID equals source UUID', async t => {
  const f = fixture(t), task = f.task({ application: 'Codex' });
  const catalog = await f.service.conversations(task.id);
  assert.equal(catalog.handoffKind, 'cross-client');
  assert.equal(catalog.items.length, 2);
  const receipt = await f.service.send({ taskId: task.id, conversationId: f.sourceId });
  assert.equal(receipt.status, 'accepted');
});
test('receipt recovery remains available when the source leaves the catalog', async t => {
  const f = fixture(t), task = f.task();
  const receipt = await f.service.transfer({ taskId: task.id, conversationId: f.targetId, waitSeconds: 0 });
  f.items.shift();
  const resumed = await f.service.transfer({ taskId: task.id, waitSeconds: 0 });
  assert.equal(resumed.id, receipt.id);
  assert.equal(f.effects.filter(([kind]) => kind === 'send').length, 1);
  await assert.rejects(f.service.send({ taskId: task.id, createNew: true }), /uniquely verify/);
});
test('ambiguous destination aliases cannot navigate or send', async t => {
  const f = fixture(t), task = f.task();
  const nativeId = randomUUID();
  f.items[1].nativeId = nativeId;
  f.items.push({ id: randomUUID(), nativeId });
  await assert.rejects(f.service.send({ taskId: task.id, conversationId: nativeId }), /歧义/);
  assert.equal(f.effects.length, 0);
});
