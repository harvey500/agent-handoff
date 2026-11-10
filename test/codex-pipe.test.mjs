import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexPipe } from '../src/codex-pipe.mjs';
const pipePath = String.fromCharCode(92,92,46,92) + 'pipe' + String.fromCharCode(92) + 'codex-app-tools-fixture';
function fixture(emit, timeoutMs = 100) {
  let destroyed = false;
  const pipe = new CodexPipe({pipePath,sourceId:'source',timeoutMs,connect:()=>{
    const socket = new EventEmitter();
    socket.destroy = () => { destroyed = true; };
    socket.write = data => { const req = JSON.parse(data.subarray(4).toString()); emit(socket,req); };
    queueMicrotask(()=>socket.emit('connect'));return socket;
  }});
  return {pipe,destroyed:()=>destroyed};
}
function frame(value) {
  const body=Buffer.from(JSON.stringify(value)), header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);
}
test('Codex pipe handles fragmented headers and bodies and closes its socket',async()=>{
  const f=fixture((s,req)=>{const data=frame({jsonrpc:'2.0',id:req.id,result:{tools:[]}});for(const b of data)s.emit('data',Buffer.from([b]));});
  assert.deepEqual(await f.pipe.tools(),[]);assert.equal(f.destroyed(),true);
});
test('Codex pipe refuses wrong response identity, oversized and invalid frames',async()=>{
  for(const emit of [s=>s.emit('data',frame({jsonrpc:'2.0',id:'wrong',result:{}})),s=>{const h=Buffer.alloc(4);h.writeUInt32LE(9000000);s.emit('data',h);},s=>s.emit('data',Buffer.from([1,0,0,0,123]))]){
    const f=fixture(emit);await assert.rejects(f.pipe.tools());assert.equal(f.destroyed(),true);
  }
});
test('Codex pipe returns explicit errors and bounds silent or disconnected channels',async()=>{
  const error=fixture((s,req)=>s.emit('data',frame({jsonrpc:'2.0',id:req.id,error:{message:'denied'}})));
  await assert.rejects(error.pipe.tools(),/denied/);
  const silent=fixture(()=>{},5);await assert.rejects(silent.pipe.tools(),/timed out/);assert.equal(silent.destroyed(),true);
  const closed=fixture(s=>s.emit('close'));await assert.rejects(closed.pipe.tools(),/unknown/);
});
test('Codex app call forwards caller identity and rejects tool failure without retry',async()=>{
  let sent=0;
  const f=fixture((s,req)=>{
    if(req.method==='tools/list')s.emit('data',frame({jsonrpc:'2.0',id:req.id,result:{tools:[{name:'send_message_to_thread',namespace:'codex_app'}]}}));
    else{sent++;assert.equal(req.params.threadId,'source');s.emit('data',frame({jsonrpc:'2.0',id:req.id,result:{success:false,contentItems:[{type:'inputText',text:'not authorized'}]}}));}
  });
  await assert.rejects(f.pipe.call('send_message_to_thread',{}),/not authorized/);assert.equal(sent,1);
});
