import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEndpoint, textOnly, findRequest, inspectRequest, targetPage } from '../src/core.mjs';
const message = text => ({content:[{type:'text',text}]});
test('debugging is restricted to an explicit loopback port',()=>{
  assert.equal(validateEndpoint('http://127.0.0.1:9238'),'http://127.0.0.1:9238');
  for(const u of ['http://0.0.0.0:9238','http://example.com:9238','http://user@127.0.0.1:9238','http://127.0.0.1:9238/path'])assert.throws(()=>validateEndpoint(u));
});
test('reasoning and user echoes never count as an acknowledgement',()=>{
  const r={state:'completed',userMessage:message('ACK X'),assistantMessage:{content:[{type:'reasoning',text:'ACK X'},{type:'text',text:'Not accepted'}]}};
  assert.equal(inspectRequest(r,'ACK X').status,'completed-without-ack');
  assert.equal(textOnly(r.assistantMessage),'Not accepted');
});
test('an acknowledgement must be completed and start the visible reply',()=>{
  const r={state:'streaming',assistantMessage:message('ACK X received')};
  assert.equal(inspectRequest(r,'ACK X').status,'pending');
  r.state='completed';assert.equal(inspectRequest(r,'ACK X').status,'acknowledged');
  r.assistantMessage=message('Example: ACK X');assert.equal(inspectRequest(r,'ACK X').status,'completed-without-ack');
});
test('duplicate request markers require review',()=>{
  const r={userMessage:message('HANDOFF-123')};
  assert.equal(findRequest([r],'HANDOFF-123'),r);
  assert.throws(()=>findRequest([r,r],'HANDOFF-123'));
});
test('desktop selection matches the exact installation, not page title',()=>{
  const t={type:'page',url:'file:///D:/WorkBuddy/resources/app.asar/renderer/index.html?private=ignored'};
  assert.equal(targetPage([t],'D:/WorkBuddy/WorkBuddyAI.exe'),t);
  assert.equal(targetPage([t],'D:/Other/WorkBuddyAI.exe'),undefined);
});
