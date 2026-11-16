import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { inboundOperations } from '../src/codex-inbound.mjs';
import { formatPacket,taskSchema } from '../src/contracts.mjs';
test('inbound catalog excludes its authenticated owner and rejects owner grants',async()=>{
 const owner=randomUUID(),other=randomUUID(),alias=randomUUID();
 const adapter={bridge:{sourceId:owner},native:id=>id===alias?owner:id,list:async()=>({items:[{id:owner,nativeId:owner},{id:alias,nativeId:owner},{id:other,nativeId:other}],total:3,truncated:false})};
 const run=inboundOperations(adapter,{get:()=>null,putSetting:()=>{throw new Error('must not persist')}});
 const catalog=await run('list');assert.deepEqual(catalog.items,[{id:other,nativeId:other}]);assert.equal(catalog.total,1);
 const task={...taskSchema.parse({title:'test',goal:'由 QQ 123456789 传达的命令：测试',projectPath:process.cwd(),source:{application:'QQ Bridge 123456789',conversationId:randomUUID()}}),id:randomUUID()};
 for(const conversationId of [owner,alias])await assert.rejects(run('authorize',{task,conversationId}),/owner cannot receive/);
});
test('QQ dispatcher retains external identity and targets only a different existing chat',async()=>{
 const saved=new Map();const run=inboundOperations({}, {get:(_,id)=>saved.get(id),putSetting:(id,v)=>saved.set(id,v)});
 const task={...taskSchema.parse({title:'QQ test',goal:'由 QQ 123456789 传达的命令：测试',projectPath:process.cwd(),source:{application:'QQ Bridge 123456789',conversationId:randomUUID()}}),id:randomUUID()};
 await assert.rejects(run('authorize',{task,createNew:true}),/different existing/);
 await assert.rejects(run('authorize',{task,conversationId:task.source.conversationId}),/different existing/);
 await run('authorize',{task,conversationId:randomUUID()});assert.equal(saved.size,1);
});
test('QQ dispatcher rejects mismatched labels, fabricated source IDs and adapter overrides',async()=>{
 const writes=[];const run=inboundOperations({}, {get:()=>null,putSetting:(...args)=>writes.push(args)});
 const task={...taskSchema.parse({title:'QQ test',goal:'由 QQ 123456789 传达的命令：测试',projectPath:process.cwd(),source:{application:'QQ Bridge 123456789',conversationId:randomUUID()}}),id:randomUUID()};
 const sources=[
  {...task.source,application:'QQ Bridge 987654321'},
  {...task.source,application:'QQ Bridge not-a-number'},
  {...task.source,conversationId:'invented-thread'},
 ];
 for(const source of sources)await assert.rejects(run('authorize',{task:{...task,source},conversationId:randomUUID()}),/real external source/);
 await assert.rejects(run('authorize',{task:{...task,source:{...task.source,adapter:'codex'}},conversationId:randomUUID()}),/real external source/);
 assert.equal(writes.length,0);
});
test('Codex inbound exposes only authorized packets and cannot forward arbitrary app tools',async()=>{
 const settings=new Map(),calls=[];
 const store={get:(_,id)=>settings.get(id),putSetting:(id,v)=>settings.set(id,v),reserveSetting:(id,v)=>{if(settings.has(id))return false;settings.set(id,v);return true;}};
 const adapter={create:async(...a)=>calls.push(a),send:async(...a)=>calls.push(a)};
 const run=inboundOperations(adapter,store),task={...taskSchema.parse({title:'test',goal:'confirm',projectPath:process.cwd(),source:{application:'WorkBuddy',adapter:'workbuddy',conversationId:randomUUID()}}),id:randomUUID()},id=randomUUID(),handoffId=randomUUID();
 await assert.rejects(run('tools/call',{}),/Unsupported/);
 await assert.rejects(run('create',{id,taskId:task.id}),/grant/);
 await run('authorize',{task,createNew:true});
 await run('create',{id,taskId:task.id});
 await assert.rejects(run('create',{id,taskId:task.id}),/reserved/);
 await assert.rejects(run('send',{id,taskId:task.id,handoffId,textHash:'modified'}),/differs/);
 const text=formatPacket(task,handoffId),textHash=createHash('sha256').update(text).digest('hex');
 await run('send',{id,taskId:task.id,handoffId,textHash});
 assert.equal(calls.length,2);assert.equal(calls[1][1],text);assert.equal(calls[1][1].includes('WorkBuddy'),true);
 await assert.rejects(run('authorize',{task:{...task,goal:'change'},createNew:true}),/replaced/);
});
test('Codex inbound applies source, secret and byte-size validation before persisting a grant', async () => {
 const writes=[];
 const run=inboundOperations({}, {get:()=>null,putSetting:(...args)=>writes.push(args)});
 const task={...taskSchema.parse({title:'test',goal:'confirm',projectPath:process.cwd(),source:{application:'WorkBuddy',adapter:'workbuddy',conversationId:randomUUID()}}),id:randomUUID()};
 await assert.rejects(run('authorize',{task:{...task,goal:'sk-'+ 'x'.repeat(25)},createNew:true}),/密钥/);
 await assert.rejects(run('authorize',{task:{...task,constraints:Array(30).fill('中'.repeat(1900))},createNew:true}),/50KB/);
 await assert.rejects(run('authorize',{task:{...task,source:{...task.source,application:'Claude'}},createNew:true}),/disagree/);
 await assert.rejects(run('authorize',{task:{...task,projectPath:'relative'},createNew:true}),/绝对路径/);
 assert.equal(writes.length,0);
});
