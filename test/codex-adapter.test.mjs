import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { Codex } from '../src/codex.mjs';
import { withCodexCaller, codexCaller } from '../src/codex-context.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-handoff-')), store = new Store(home);
  const sourceId = randomUUID(), targetId = randomUUID(), calls = [], turns = [];
  let state = 'idle', missingTool = false, failSend = false;
  const bridge = { sourceId, pipePath: 'fixture-pipe',
    tools: async () => ['list_threads','read_thread','send_message_to_thread',...(!missingTool ? ['create_thread'] : [])].map(name => ({ name })),
    call: async (name, args) => {
      calls.push({ name, args });
      if (name === 'list_threads') return { threads: [sourceId,targetId].map(id => ({ id, kind:'codex', hostId:'local', status:'idle', title:'fixture' })), nextCursor:null };
      if (name === 'read_thread') return { schemaVersion:1, thread:{id:args.threadId,kind:'codex',hostId:'local',title:'fixture',status:{type:state}},
        page:{hasMore:false},turns:args.threadId === targetId ? turns : [] };
      if (name === 'create_thread') return { threadId:randomUUID(),hostId:'local' };
      if (name === 'send_message_to_thread') { if (failSend) throw new Error('lost response'); return { sent:true }; }
      if (name === 'navigate_to_codex_page') return { opened:true };
      throw new Error('Unexpected fixture operation');
    } };
  let records = [];
  const adapter = new Codex({store,bridge,home,loadDelegations:()=>records});
  t.after(()=>{store.close();fs.rmSync(home,{recursive:true,force:true});});
  return {adapter,store,sourceId,targetId,calls,turns,
    records:value=>{records=value;}, busy:()=>{state='active';}, missing:()=>{missingTool=true;}, fail:()=>{failSend=true;} };
}
test('Codex new chat sends full packet once and explicitly selects Sol',async t=>{
  const f=fixture(t),id=randomUUID(),marker='HANDOFF_ID: '+randomUUID(),text=marker+String.fromCharCode(10)+'context';
  await f.adapter.create(id,{title:'test',projectPath:os.tmpdir(),source:{application:'Codex',conversationId:f.sourceId}},f.adapter.accountId);
  assert.equal(f.calls.filter(c=>c.name==='create_thread').length,0);
  await f.adapter.send(id,text,marker,f.adapter.accountId,true);
  const created=f.calls.filter(c=>c.name==='create_thread');
  assert.equal(created.length,1);assert.equal(created[0].args.prompt,text);
  assert.equal(created[0].args.model,'gpt-6.1-sol');
  assert.equal(created[0].args.target.type,'projectless');
  await assert.rejects(f.adapter.send(id,text,marker,f.adapter.accountId,true),/reserved/);
  assert.equal(f.calls.filter(c=>c.name==='create_thread').length,1);
});
test('Codex existing-chat send preserves model and sends through original desktop',async t=>{
  const f=fixture(t),marker='HANDOFF_ID: '+randomUUID();
  await f.adapter.send(f.targetId,marker,marker,f.adapter.accountId,true);
  const sent=f.calls.filter(c=>c.name==='send_message_to_thread');
  assert.equal(sent.length,1);assert.equal(sent[0].args.threadId,f.targetId);
  assert.equal(Object.hasOwn(sent[0].args,'model'),false);
  assert.equal(f.calls.some(c=>c.name==='navigate_to_codex_page'),false);
});
test('Codex rejects self, busy targets, missing capabilities and profile mismatch',async t=>{
  const f=fixture(t),marker='HANDOFF_ID: '+randomUUID();
  await assert.rejects(f.adapter.send(f.sourceId,marker,marker,f.adapter.accountId,true),/self-delivery/);
  f.busy();await assert.rejects(f.adapter.send(f.targetId,marker,marker,f.adapter.accountId,true),/busy/);
  await assert.rejects(f.adapter.read(f.targetId,'other-profile'),/profile/);
  f.missing();await assert.rejects(f.adapter.status(),/required tool/);
  assert.equal(f.calls.some(c=>c.name==='send_message_to_thread'),false);
});
test('lost Codex send response reserves dispatch across adapter reconnects',async t=>{
  const f=fixture(t),marker='HANDOFF_ID: '+randomUUID();f.fail();
  await assert.rejects(f.adapter.send(f.targetId,marker,marker,f.adapter.accountId,true),/lost response/);
  await assert.rejects(f.adapter.send(f.targetId,marker,marker,f.adapter.accountId,true),/reserved/);
  assert.equal(f.calls.filter(c=>c.name==='send_message_to_thread').length,1);
});
test('Codex delegated reply requires exact item, turn, source and locally reserved packet hash',async t=>{
  const f=fixture(t),marker='HANDOFF_ID: '+randomUUID(),text=marker+String.fromCharCode(10)+'context',turnId=randomUUID(),itemId=randomUUID();
  f.store.reserveSetting(f.adapter.prefix+'dispatch:'+f.targetId+':'+hash(marker),{textHash:hash(text)});
  const record={id:itemId,internal_chat_message_metadata_passthrough:{turn_id:turnId},output:'<codex_delegation>'+String.fromCharCode(10)+'  <source_thread_id>'+f.sourceId+'</source_thread_id>'+String.fromCharCode(10)+'  <input>'+text+'</input>'+String.fromCharCode(10)+'</codex_delegation>'};
  f.records([record]);
  f.turns.push({id:turnId,status:'completed',items:[{type:'functionCallOutput',id:itemId,name:'create_thread',namespace:'codex_app'},
    {type:'reasoning',text:'private'},{type:'agentMessage',text:'HANDOFF_ACCEPTED '+marker.slice(12),phase:null}]});
  let history=await f.adapter.read(f.targetId,f.adapter.accountId);
  assert.equal(history.requests[0].state,'completed');assert.equal(history.requests[0].userMessage.content[0].text,text);
  assert.ok(!JSON.stringify(history).includes('private'));
  for(const altered of [{...record,id:randomUUID()},{...record,internal_chat_message_metadata_passthrough:{turn_id:randomUUID()}},
    {...record,output:record.output.replace(f.sourceId,randomUUID())},{...record,output:record.output.replace('context','altered')}]){
    f.records([altered]);history=await f.adapter.read(f.targetId,f.adapter.accountId);
    assert.equal(history.requests[0].state,'unknown');assert.equal(history.requests[0].userMessage.content.length,0);
  }
});
test('Codex ignores commentary acknowledgements and rejects multiple user inputs',async t=>{
  const f=fixture(t);
  f.turns.push({id:randomUUID(),status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'input'}]},
    {type:'agentMessage',phase:'commentary',text:'HANDOFF_ACCEPTED X'},{type:'agentMessage',phase:'final_answer',text:'not confirmed'}]});
  let history=await f.adapter.read(f.targetId,f.adapter.accountId);
  assert.equal(history.requests[0].assistantMessage.content[0].text,'not confirmed');
  f.turns[0].items.push({type:'userMessage',content:[]});
  history=await f.adapter.read(f.targetId,f.adapter.accountId);assert.equal(history.requests[0].state,'unknown');
});
test('Codex source must match actual caller, not a supplied unrelated chat ID',t=>{
  const f=fixture(t);
  assert.throws(()=>f.adapter.assertSource({source:{adapter:'codex',application:'Codex',conversationId:f.targetId}}),/calling thread/);
});
test('MCP caller metadata stays request-scoped across concurrent conversations',async()=>{
  const first=randomUUID(),second=randomUUID();
  const a=withCodexCaller({_meta:{'x-codex-turn-metadata':JSON.stringify({thread_id:first,turn_id:'turn-a'})}},async()=>{
    await new Promise(r=>setTimeout(r,5));return codexCaller();
  });
  const b=withCodexCaller({_meta:{thread_id:second}},async()=>codexCaller());
  assert.equal((await a).sourceId,first);assert.equal((await b).sourceId,second);
  assert.equal(codexCaller(),undefined);
});
