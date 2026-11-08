import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { HandoffService } from '../src/service.mjs';
import { formatPacket, parseReply, matchingRequest } from '../src/contracts.mjs';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-')); const store = new Store(dir);
  let account = 'account-a', calls = 0, failAfterSend = false, mode = 'HANDOFF_ACCEPTED';
  const conversations = [{ id: randomUUID(), title: '已有任务', state: 'idle' }]; const requests = [];
  const adapter = {
    status: async () => ({ accountId: account, version: '5.9.4' }),
    list: async () => ({ items: conversations, total: conversations.length }),
    create: async id => { conversations.push({ id, title: '新建任务', state: 'idle' }); return { id }; },
    open: async id => ({ currentId: id }),
    send: async (id, text) => { calls++; const marker = text.split(String.fromCharCode(10)).find(l => l.startsWith('HANDOFF_ID: ')).slice(12);
      requests.push({ id: randomUUID(), state: 'completed', userMessage: { content: [{ type: 'text', text }] },
        assistantMessage: { content: [{ type: 'text', text: mode + ' ' + marker + String.fromCharCode(10) + '收到，理解目标。' }] } });
      if (failAfterSend) throw new Error('connection lost after delivery'); return { accepted: true }; },
    read: async id => ({ id, title: '目标任务', requests }),
  };
  const service = new HandoffService(store, { discover: async () => ({ installed: true, running: true, executable: 'fake', endpoint: 'http://127.0.0.1:9238' }), makeAdapter: () => adapter });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, store, conversations, task: () => service.task({ title: '任务', goal: '验证交接', projectPath: path.resolve(dir), source: { application: 'Codex', conversationId: 'source-test' } }),
    setAccount: a => account = a, loseReply: () => failAfterSend = true, decline: () => mode = 'HANDOFF_DECLINED', setMode:m=>mode=m,calls: () => calls };
}
test('a reply from a real target is required before acceptance', async t => {
  const f = fixture(t), task = f.task(); const h = await f.service.send({ taskId: task.id, conversationId: f.conversations[0].id });
  assert.equal(h.status, 'accepted'); assert.equal(f.calls(), 1);
  await assert.rejects(f.service.send({ taskId: task.id, createNew: true }), /未结束/); assert.equal(f.calls(), 1);
});
test('lost transport response remains unknown, then recovers without a second send', async t => {
  const f = fixture(t); f.loseReply(); const task = f.task(); const h = await f.service.send({ taskId: task.id, createNew: true });
  assert.equal(h.status, 'unknown');
  await assert.rejects(f.service.send({ taskId: task.id, createNew: true }), /未结束/);
  const recovered = await f.service.refresh(h.id); assert.equal(recovered.status, 'accepted'); assert.equal(f.calls(), 1);
});
test('account changes cannot read another account handoff', async t => {
  const f = fixture(t), task = f.task(); const h = await f.service.send({ taskId: task.id, createNew: true });
  f.setAccount('account-b'); await assert.rejects(f.service.refresh(h.id), /账号/);
});
test('declined is not accepted and a close cannot imply remote cancellation', async t => {
  const f = fixture(t); f.decline(); const task = f.task(); const h = await f.service.send({ taskId: task.id, createNew: true });
  assert.equal(h.status, 'declined'); const closed = f.service.resolve(h.id, '测试结束，人工关闭'); assert.match(closed.resolutionMeaning, /不取消远端/);
  assert.equal((await f.service.refresh(h.id)).status,'closed');
});
test('unselected titles never cause an automatic message', async t => {
  const f = fixture(t), task = f.task(); await assert.rejects(f.service.send({ taskId: task.id }), /请选择/); assert.equal(f.calls(), 0);
});
test('packets carry constraints, decisions, evidence, source and explicit execution scope', () => {
  const text = formatPacket({ id: 'task', title: 't', goal: 'g', source: { application: 'Codex' }, constraints: ['keep files'], decisions: ['use SDK'], evidence: ['proof'], mode: 'acknowledge-only' }, 'id');
  assert.match(text, /不使用工具/); for (const s of ['keep files','use SDK','proof','Codex']) assert.ok(text.includes(s));
});
test('wrong IDs, reasoning and quoted confirmations never count as acceptance', () => {
  const r = { state: 'completed', assistantMessage: { content: [{ type: 'reasoning', text: 'HANDOFF_ACCEPTED X' }, { type: 'text', text: 'HANDOFF_ACCEPTED XX' }] } };
  assert.equal(parseReply(r, 'X').status, 'reply-unconfirmed');
  assert.equal(matchingRequest([{ userMessage: {content: [{type: 'text', text: 'HANDOFF_ID: XX'}]} }], 'X'), undefined);
});
test('the store survives a reopen with task and receipt history intact', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-persist-')); let store = new Store(dir);
  store.putTask({ id: 'task', title: '持久任务' }); store.close(); store = new Store(dir);
  assert.equal(store.get('tasks', 'task').title, '持久任务'); store.close(); fs.rmSync(dir, {recursive:true,force:true});
});
test('repeated preparation and natural transfer resume the same receipt without another send',async t=>{
  const f=fixture(t),task=f.task();assert.equal(f.task().id,task.id);
  const h=await f.service.transfer({taskId:task.id,createNew:true,waitSeconds:0});
  const same=await f.service.transfer({taskId:f.task().id,waitSeconds:0});
  assert.equal(same.id,h.id);assert.equal(f.calls(),1);
});
test('a bound task reuses its existing recipient after an explicit closure',async t=>{
  const f=fixture(t),task=f.task();const h=await f.service.transfer({taskId:task.id,createNew:true,waitSeconds:0});
  f.service.resolve(h.id,'前次工作完成，允许再次交接');
  const route=await f.service.route(task.id);assert.equal(route.action,'reuse-bound');assert.equal(route.conversationId,h.conversationId);
  const next=await f.service.transfer({taskId:task.id,waitSeconds:0});assert.equal(next.conversationId,h.conversationId);assert.equal(f.conversations.length,2);
});
test('unbound natural transfer returns candidates without sending or inventing a match',async t=>{
  const f=fixture(t),task=f.task();const r=await f.service.transfer({taskId:task.id,waitSeconds:0});
  assert.equal(r.status,'needs-session-review');assert.equal(f.calls(),0);
});
test('recipient needs-info receives a linked supplement once',async t=>{
  const f=fixture(t);f.setMode('HANDOFF_NEEDS_INFO');const task=f.task();const h=await f.service.transfer({taskId:task.id,createNew:true,waitSeconds:0});
  assert.equal(h.status,'needs-info');f.setMode('HANDOFF_ACCEPTED');
  const next=await f.service.supplement(h.id,'补充已授权的验收目标');assert.equal(next.status,'accepted');assert.equal(next.parentHandoffId,h.id);
  assert.equal(next.conversationId,h.conversationId);await assert.rejects(f.service.supplement(h.id,'不能重复补充'));assert.equal(f.calls(),2);
});
test('active task context cannot be silently replaced',async t=>{
  const f=fixture(t),task=f.task();await f.service.transfer({taskId:task.id,createNew:true,waitSeconds:0});
  const input=Object.fromEntries(Object.keys((await import('../src/contracts.mjs')).taskSchema.shape).filter(k=>task[k]!==undefined).map(k=>[k,task[k]]));
  input.goal='不同目标';assert.throws(()=>f.service.task(input),/不能重新准备/);
});
test('candidate inspection returns bounded visible text marked as untrusted',async t=>{
  const f=fixture(t),task=f.task();await f.service.transfer({taskId:task.id,conversationId:f.conversations[0].id,waitSeconds:0});
  const r=await f.service.inspect(f.conversations[0].id,1000);
  assert.ok(r.recentMessages.reduce((n,m)=>n+m.user.length+m.assistant.length,0)<=1000);assert.match(r.contentTrust,/untrusted/);
});
