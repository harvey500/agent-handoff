import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { projectRoot } from '../src/paths.mjs';
test('MCP initializes without an HTTP service and shares durable tasks across host reconnects',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-mcp-'));
 async function connect(){
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(projectRoot,'src/mcp.mjs')],env:{...process.env,AGENT_HANDOFF_HOME:dir},stderr:'pipe'});
  const client=new Client({name:'contract-test',version:'0.2.0'});await client.connect(transport);
  return{client,close:async()=>{await client.close();await transport.close();}};
 }
 let link;
 try{
  link=await connect();assert.match(link.client.getInstructions(),/without asking them to open a separate UI/);
  const names=(await link.client.listTools()).tools.map(t=>t.name);
  assert.equal(names.length,13);for(const n of ['handoff_doctor','handoff_transfer','handoff_route','handoff_inspect_conversation','handoff_supplement'])assert.ok(names.includes(n));
  const sameClientInput={title:'same client',goal:'continue in another chat',projectPath:dir,
    source:{application:'WorkBuddy AI',adapter:'workbuddy',conversationId:'actual-host-chat-id'}};
  const sameClientResult=await link.client.callTool({name:'handoff_prepare',arguments:sameClientInput});
  assert.ok(!sameClientResult.isError);
  assert.equal(JSON.parse(sameClientResult.content[0].text).source.adapter,'workbuddy');
  const input={title:'test task',taskKey:'stable-key',goal:'continue',projectPath:dir,source:{application:'Codex',conversationId:'test'}};
  const parse=r=>JSON.parse(r.content[0].text);
  const task=parse(await link.client.callTool({name:'handoff_prepare',arguments:input}));await link.close();
  link=await connect();const second=parse(await link.client.callTool({name:'handoff_prepare',arguments:input}));assert.equal(second.id,task.id);
  assert.equal(await fs.access(path.join(dir,'runtime.json')).then(()=>true,()=>false),false);
 }finally{await link?.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('MCP stdin EOF removes its managed private bridge before the process exits', { skip: process.platform !== 'win32' }, async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-mcp-owner-'));
 const pipe=String.fromCharCode(92,92,46,92)+'pipe'+String.fromCharCode(92)+'codex-app-tools-'+randomUUID();
 const sourceId=randomUUID(),sockets=new Set();
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  let input=Buffer.alloc(0),done=false;
  socket.on('data',chunk=>{
   if(done)return;input=Buffer.concat([input,chunk]);
   if(input.length<4||input.length<4+input.readUInt32LE(0))return;done=true;
   const request=JSON.parse(input.subarray(4,4+input.readUInt32LE(0)).toString('utf8'));
   const result=request.method==='tools/list'?{tools:['list_threads','read_thread','send_message_to_thread','create_thread'].map(name=>({name,namespace:'codex_app'}))}
    :{success:true,contentItems:[{type:'inputText',text:JSON.stringify({thread:{id:sourceId,kind:'codex',hostId:'local'}})}]};
   const bytes=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:request.id,result})),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);
   socket.end(Buffer.concat([header,bytes]));
  });
 });
 let client,transport;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});
  transport=new StdioClientTransport({command:process.execPath,args:[path.join(projectRoot,'src/mcp.mjs')],env:{...process.env,CODEX_HOME:dir,CODEX_APP_TOOLS_PIPE_PATH:pipe,AGENT_HANDOFF_HOME:dir,AGENT_HANDOFF_CODEX_INBOUND:'1'},stderr:'pipe'});
  transport.stderr?.resume();client=new Client({name:'owner-lifecycle-test',version:'1'});await client.connect(transport);
  const unrelated=await client.callTool({name:'handoff_prepare',arguments:{title:'no caller',goal:'prepare only',projectPath:dir,source:{application:'WorkBuddy',adapter:'workbuddy',conversationId:randomUUID()}}});
  assert.ok(!unrelated.isError);
  assert.equal(await fs.access(path.join(dir,'codex-inbound','connection.json')).then(()=>true,()=>false),false);
  // The independent owner probe must not borrow the environment's fixed ID.
  // Wait out its short failure cooldown before the authenticated request.
  await new Promise(resolve=>setTimeout(resolve,5100));
  const response=await client.callTool({name:'handoff_status',arguments:{target:'codex'},_meta:{'openai/threadId':sourceId}});
  assert.ok(!response.isError);assert.equal(JSON.parse(response.content[0].text).connected,true);
  const descriptor=path.join(dir,'codex-inbound','connection.json');
  assert.equal(JSON.parse(await fs.readFile(descriptor,'utf8')).pid,transport.pid);
  const child=transport._process;
  await client.close();await transport.close();
  assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);
  for(const file of ['connection.json','owner.lock'])assert.equal(await fs.access(path.join(dir,'codex-inbound',file)).then(()=>true,()=>false),false);
 }finally{
  await client?.close();await transport?.close();for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});
 }
});
