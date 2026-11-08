import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { WorkBuddy } from '../src/workbuddy.mjs';
function fixture() {
  const adapter=new WorkBuddy({endpoint:'http://127.0.0.1:9238',executable:'D:/Example/WorkBuddyAI.exe',testedVersion:'5.9.4'});
  let account='a',sent=0;
  const conversation={info:{state:'idle'},requestEntries:async()=>({requests:[],hasOlder:false}),ui:{input:{getDraftBlocks:()=>[],sendPrompt:async()=>{sent++;return{ok:true}}}}};
  const wb={account:{profile:async()=>({uid:account})},conversations:{currentId:'target',current:conversation}};
  adapter.evaluate=async code=>vm.runInNewContext(code,{window:{wb}});
  adapter.open=async()=>({});
  return{adapter,conversation,wb,sent:()=>sent,setAccount:a=>account=a};
}
test('adapter rejects busy chats and preserves drafts',async()=>{
  const f=fixture();f.conversation.info.state='working';
  await assert.rejects(f.adapter.send('target','message','HANDOFF_ID: test','a'),/busy/);
  f.conversation.info.state='idle';f.conversation.ui.input.getDraftBlocks=()=>[{type:'text',text:'user draft'}];
  await assert.rejects(f.adapter.send('target','message','HANDOFF_ID: test','a'),/draft/);assert.equal(f.sent(),0);
});
test('adapter checks account and active chat again at the send boundary',async()=>{
  const f=fixture();f.setAccount('b');await assert.rejects(f.adapter.send('target','x','HANDOFF_ID: test','a'),/account/);
  f.setAccount('a');f.wb.conversations.currentId='other';await assert.rejects(f.adapter.send('target','x','HANDOFF_ID: test','a'),/changed/);assert.equal(f.sent(),0);
});
test('adapter deduplicates exact marker lines, not partial IDs',async()=>{
  const f=fixture();f.conversation.requestEntries=async()=>({requests:[{id:'old',userMessage:{content:[{type:'text',text:'HANDOFF_ID: test-long'}]}}]});
  await f.adapter.send('target','message','HANDOFF_ID: test','a');assert.equal(f.sent(),1);
  f.conversation.requestEntries=async()=>({requests:[{id:'old',userMessage:{content:[{type:'text',text:'HANDOFF_ID: test'}]}}]});
  const r=await f.adapter.send('target','message','HANDOFF_ID: test','a');assert.equal(r.deduplicated,true);assert.equal(f.sent(),1);
});
test('adapter refuses truncated history instead of guessing prior delivery',async()=>{
  const f=fixture();f.conversation.requestEntries=async()=>({requests:[],hasOlder:true});
  await assert.rejects(f.adapter.send('target','message','HANDOFF_ID: test','a'),/paginated/);assert.equal(f.sent(),0);
});
test('a freshly reserved handoff can send in long history, while retry cannot',async()=>{
 const f=fixture();f.conversation.requestEntries=async()=>({requests:[],hasOlder:true});
 const r=await f.adapter.send('target','message','HANDOFF_ID: fresh','a',true);assert.equal(r.accepted,true);
 await assert.rejects(f.adapter.send('target','message','HANDOFF_ID: fresh','a'),/paginated/);assert.equal(f.sent(),1);
});
test('switching away while history is loading never sends to a stale conversation',async()=>{
 const f=fixture();f.conversation.requestEntries=async()=>{f.wb.conversations.currentId='other';return{requests:[],hasOlder:false};};
 await assert.rejects(f.adapter.send('target','message','HANDOFF_ID: fresh','a',true),/changed/);assert.equal(f.sent(),0);
});
