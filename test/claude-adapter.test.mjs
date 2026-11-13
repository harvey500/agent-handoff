import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { Claude } from '../src/claude.mjs';

async function fixture(t) {
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'claude-adapter-'));
 const profile=path.join(folder,'Claude-3p'),account=randomUUID(),native=randomUUID(),session=randomUUID();
 const root=path.join(profile,'local-agent-mode-sessions',account.slice(0,8),'00000000');
 const transcript=path.join(root,native.slice(0,8),'.claude','projects','session',session+'.jsonl');
 await fs.mkdir(path.dirname(transcript),{recursive:true});
 await fs.writeFile(path.join(profile,'config.json'),JSON.stringify({lastKnownAccountUuid:account}));
 await fs.writeFile(path.join(root,'local_'+native+'.json'),JSON.stringify({sessionId:'local_'+native,cliSessionId:session,title:'Fixture chat',createdAt:Date.now()}));
 await fs.writeFile(transcript,'');
 const store=new Store(path.join(folder,'store'));
 const state={version:'4.4212.0',profileRoot:profile,currentId:native,busy:false,draftPresent:false};
 const calls=[];let staged='',loseAfterDispatch=false,changeAtDispatch=false,failStage=false,stageHook;
 const ui=async request=>{
  calls.push(request.action);
  if(request.action==='status')return{...state};
  if(request.action==='open')return{opened:true};
  if(request.action==='stage'){
   if(state.draftPresent)throw new Error('user draft');
   staged=request.text;state.draftPresent=true;
   if(failStage)throw new Error('staging timed out; draft may exist');
   if(stageHook)return stageHook(state);
   return{staged:true,invokedOnce:false};
  }
  if(request.action==='dispatch'){
   if(changeAtDispatch)throw new Error('draft changed');
   assert.equal(request.text,staged);assert.equal(request.nativeId,native);
   const user={type:'user',uuid:randomUUID(),parentUuid:null,sessionId:session,message:{role:'user',content:staged}};
   await fs.appendFile(transcript,JSON.stringify(user)+'\n');state.draftPresent=false;
   if(loseAfterDispatch)throw new Error('connection lost after invoke');
   return{invokedOnce:true,nativeId:native};
  }
  throw new Error('Unexpected operation '+request.action);
 };
 const adapter=new Claude({store,ui});
 t.after(async()=>{store.close();await fs.rm(folder,{recursive:true,force:true});});
 return{adapter,store,state,calls,native,account,profile,root,transcript,session,
  packet:id=>'HANDOFF_ID: '+id+'\nAcknowledge only.',
  lose:()=>loseAfterDispatch=true,changeDraft:()=>changeAtDispatch=true,
  failStage:()=>failStage=true,afterStage:hook=>stageHook=hook};
}

test('Claude stages, rechecks and invokes once; persisted message is required',async t=>{
 const f=await fixture(t),id=randomUUID(),marker='HANDOFF_ID: '+id;
 const result=await f.adapter.send(f.native,f.packet(id),marker,f.account);
 assert.equal(result.persisted,true);assert.equal(result.nativeId,f.native);
 assert.equal(f.calls.filter(c=>c==='stage').length,1);assert.equal(f.calls.filter(c=>c==='dispatch').length,1);
 const stage=f.calls.indexOf('stage'),dispatch=f.calls.indexOf('dispatch');assert.ok(f.calls.slice(stage+1,dispatch).includes('status'));
 const duplicate=await f.adapter.send(f.native,f.packet(id),marker,f.account);
 assert.equal(duplicate.deduplicated,true);assert.equal(f.calls.filter(c=>c==='dispatch').length,1);
});
test('Claude refuses a user draft and a busy target without staging',async t=>{
 const f=await fixture(t),id=randomUUID();f.state.draftPresent=true;
 await assert.rejects(f.adapter.send(f.native,f.packet(id),'HANDOFF_ID: '+id,f.account),/draft/);
 f.state.draftPresent=false;f.state.busy=true;
 await assert.rejects(f.adapter.send(f.native,f.packet(id),'HANDOFF_ID: '+id,f.account),/busy/);
 assert.ok(!f.calls.includes('stage'));assert.ok(!f.calls.includes('dispatch'));
});
test('Claude refuses a minimized window before staging or reserving delivery', async t => {
 const f=await fixture(t),id=randomUUID(),marker='HANDOFF_ID: '+id;
 f.state.minimized=true;
 await assert.rejects(f.adapter.send(f.native,f.packet(id),marker,f.account),/minimized/);
 assert.ok(!f.calls.includes('stage'));assert.ok(!f.calls.includes('dispatch'));
 assert.equal(f.store.get('settings',f.adapter.dispatchKey(f.native,marker)),null);
});
test('minimizing after staging preserves the draft and refuses dispatch', async t => {
 const f=await fixture(t),id=randomUUID(),marker='HANDOFF_ID: '+id;
 f.afterStage(state=>{state.minimized=true;return {staged:true,invokedOnce:false};});
 await assert.rejects(f.adapter.send(f.native,f.packet(id),marker,f.account),/minimized after staging/);
 assert.ok(!f.calls.includes('dispatch'));assert.equal(f.state.draftPresent,true);
 assert.equal(f.store.get('settings',f.adapter.dispatchKey(f.native,marker)).phase,'staged');
});
test('a lost dispatch response can be reconciled without another send',async t=>{
 const f=await fixture(t),id=randomUUID(),marker='HANDOFF_ID: '+id;f.lose();
 await assert.rejects(f.adapter.send(f.native,f.packet(id),marker,f.account),/lost/);
 const second=new Claude({store:f.store,ui:f.adapter.ui});
 const found=await second.send(f.native,f.packet(id),marker,f.account);
 assert.equal(found.deduplicated,true);assert.equal(f.calls.filter(c=>c==='dispatch').length,1);
});
test('a changed staged draft is preserved and never automatically dispatched again',async t=>{
 const f=await fixture(t),id=randomUUID(),marker='HANDOFF_ID: '+id;f.changeDraft();
 await assert.rejects(f.adapter.send(f.native,f.packet(id),marker,f.account),/draft changed/);
 f.state.draftPresent=false;
 const second=new Claude({store:f.store,ui:f.adapter.ui});
 await assert.rejects(second.send(f.native,f.packet(id),marker,f.account),/reserved/);
 assert.equal(f.calls.filter(c=>c==='dispatch').length,1);assert.equal(f.calls.filter(c=>c==='stage').length,1);
});
test('account changes cannot read or dispatch another profile session',async t=>{
 const f=await fixture(t);await f.adapter.status();
 await fs.writeFile(path.join(f.profile,'config.json'),JSON.stringify({lastKnownAccountUuid:randomUUID()}));
 await assert.rejects(f.adapter.read(f.native,f.account),/account changed/);
 assert.ok(!f.calls.includes('dispatch'));
});
test('duplicate markers require review before any stage',async t=>{
 const f=await fixture(t),id=randomUUID();
 const rows=[1,2].map(()=>({type:'user',uuid:randomUUID(),parentUuid:null,sessionId:f.session,message:{role:'user',content:f.packet(id)}}));
 await fs.writeFile(f.transcript,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 await assert.rejects(f.adapter.send(f.native,f.packet(id),'HANDOFF_ID: '+id,f.account),/Duplicate/);
 assert.ok(!f.calls.includes('stage'));
});
test('dispatch reservations are atomic across two store connections',async t=>{
 const f=await fixture(t);
 const second=new Store(path.join(path.dirname(f.profile),'store'));
 try{assert.equal(f.store.reserveSetting('same',{phase:'staging'}),true);assert.equal(second.reserveSetting('same',{phase:'staging'}),false);}finally{second.close();}
});

test('a staging timeout leaves a durable reservation and never invokes send',async t=>{
 const f=await fixture(t),id=randomUUID(),marker='HANDOFF_ID: '+id;f.failStage();
 await assert.rejects(f.adapter.send(f.native,f.packet(id),marker,f.account),/staging timed out/);
 assert.equal(f.state.draftPresent,true);assert.ok(!f.calls.includes('dispatch'));
 f.state.draftPresent=false;
 const next=new Claude({store:f.store,ui:f.adapter.ui});
 await assert.rejects(next.send(f.native,f.packet(id),marker,f.account),/reserved/);
 assert.equal(f.calls.filter(c=>c==='stage').length,1);
});

test('a target becoming busy after staging prevents dispatch',async t=>{
 const f=await fixture(t),id=randomUUID();
 f.afterStage(state=>{state.busy=true;return{staged:true,invokedOnce:false};});
 await assert.rejects(f.adapter.send(f.native,f.packet(id),'HANDOFF_ID: '+id,f.account),/target changed/);
 assert.ok(!f.calls.includes('dispatch'));assert.equal(f.state.draftPresent,true);
});

test('navigation after staging cannot dispatch to a different conversation',async t=>{
 const f=await fixture(t),id=randomUUID();
 f.afterStage(state=>{state.currentId=randomUUID();return{staged:true,invokedOnce:false};});
 await assert.rejects(f.adapter.send(f.native,f.packet(id),'HANDOFF_ID: '+id,f.account),/target changed/);
 assert.ok(!f.calls.includes('dispatch'));
});

test('an unexpected staging result cannot authorize a dispatch',async t=>{
 const f=await fixture(t),id=randomUUID();
 f.afterStage(()=>({staged:true,invokedOnce:true}));
 await assert.rejects(f.adapter.send(f.native,f.packet(id),'HANDOFF_ID: '+id,f.account),/unexpected data/);
 assert.ok(!f.calls.includes('dispatch'));
});
