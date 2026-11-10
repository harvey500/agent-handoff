import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  assert.equal(names.length,12);for(const n of ['handoff_transfer','handoff_route','handoff_inspect_conversation','handoff_supplement'])assert.ok(names.includes(n));
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
