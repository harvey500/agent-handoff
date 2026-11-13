#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createRuntime } from './src/runtime.mjs';
const runtime=createRuntime();
async function localRequest(route, body) {
  const url=new URL(route,'http://127.0.0.1');
  const operation=url.pathname.slice('/api/'.length);
  const payload={...(body||Object.fromEntries(url.searchParams))};
  if(operation!=='tasks') payload.target=target;
  return runtime.dispatch(operation,payload);
}
const args=process.argv.slice(2),targetIndex=args.indexOf('--target');
let target='workbuddy';
if(targetIndex!==-1){target=args[targetIndex+1];args.splice(targetIndex,2);}
const [command = 'status', a, b] = args;
try {
  let result;
  if (command === 'status') result = await localRequest('/api/connection');
  else if (command === 'doctor') result = await localRequest('/api/doctor');
  else if (command === 'state') result = await localRequest('/api/state');
  else if (command === 'connect') result = await localRequest('/api/connect', {});
  else if (command === 'conversations') result = await localRequest('/api/conversations' + (a ? '?taskId=' + encodeURIComponent(a) : ''));
  else if (command === 'task') result = await localRequest('/api/tasks', JSON.parse(await fs.readFile(a, 'utf8')));
  else if (command === 'preview') result = await localRequest('/api/preview', { taskId: a });
  else if (command === 'route') result = await localRequest('/api/route', {taskId:a});
  else if (command === 'inspect') result = await localRequest('/api/inspect', {conversationId:a});
  else if (command === 'transfer') result = await localRequest('/api/transfer', {taskId:a,...(b==='--new'?{createNew:true}:b?{conversationId:b}:{})});
  else if (command === 'send') result = await localRequest('/api/send', { taskId: a, ...(b === '--new' ? { createNew: true } : b ? { conversationId: b } : {}) });
  else if (command === 'check') result = await localRequest('/api/check', { id: a });
  else if (command === 'open') result = await localRequest('/api/open', { conversationId: a });
  else if (command === 'resolve') result = await localRequest('/api/resolve', { id: a, note: b });
  else throw new Error('Commands: status, doctor, state, connect, conversations [taskId], task file.json, preview taskId, route taskId, inspect conversationId, transfer taskId [conversationId|--new], send taskId [conversationId|--new], check handoffId, open conversationId, resolve handoffId note');
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { runtime.close(); }
