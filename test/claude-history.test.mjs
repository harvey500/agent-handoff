import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeTranscript } from '../src/claude-history.mjs';
import { parseReply, matchingRequest } from '../src/contracts.mjs';
const user = (id, handoff = id, parentUuid = null) => ({ uuid:id,parentUuid,type:'user',sessionId:'s',message:{role:'user',content:'HANDOFF_ID: '+handoff} });
const node = (id,parentUuid,type='attachment') => ({ uuid:id,parentUuid,type,sessionId:'s' });
const reply = (id,parentUuid,handoff,extra={}) => ({ uuid:id,parentUuid,type:'assistant',sessionId:'s',message:{id:'msg-'+id,role:'assistant',model:'fixture',stop_reason:'end_turn',content:[{type:'text',text:'HANDOFF_ACCEPTED '+handoff}]},...extra });
const parse = (rows,options) => parseClaudeTranscript(rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n','s',options);

test('Claude replies are assigned by their parent chain, never the nearest append',()=>{
 const history=parse([user('old'),user('new'),reply('a','old','new')]);
 assert.equal(parseReply(matchingRequest(history.requests,'new'),'new').status,'pending');
 assert.equal(parseReply(matchingRequest(history.requests,'old'),'old').status,'reply-unconfirmed');
});
test('attachments and retry nodes preserve the user ancestor',()=>{
 const history=parse([user('u','h'),node('x','u'),node('y','x','system'),reply('a','y','h')]);
 assert.equal(parseReply(history.requests[0],'h').status,'accepted');
 assert.equal(history.requests[0].assistantId,'a');
});
test('out of order records resolve only via their exact known parents',()=>{
 const history=parse([reply('a','x','h'),node('x','u'),user('u','h')]);
 assert.equal(parseReply(history.requests[0],'h').status,'accepted');
});
test('missing, wrong-session and sidechain parents never authenticate a reply',()=>{
 for(const ancestor of [null,{...node('x','u'),sessionId:'other'},{...node('x','u'),isSidechain:true}]){
  const history=parse([user('u','h'),...(ancestor?[ancestor]:[]),reply('a','x','h')]);
  assert.equal(parseReply(history.requests[0],'h').status,'pending');
 }
});
test('parent cycles cannot hang or confirm a receipt',()=>{
 const history=parse([user('u','h'),node('x','y'),node('y','x'),reply('a','x','h')]);
 assert.equal(parseReply(history.requests[0],'h').status,'pending');
});
test('a user tool-result continuation is not a new human turn',()=>{
 const continuation={...user('tool'),parentUuid:'a',message:{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'result'},{type:'text',text:'context'}]}};
 const partial=reply('a','u','h');partial.message.stop_reason='tool_use';
 const history=parse([user('u','h'),partial,continuation,reply('b','tool','h')]);
 assert.equal(history.requests.length,1);assert.equal(parseReply(history.requests[0],'h').status,'accepted');
});
test('split thinking and text blocks use the same assistant identity without leaking thoughts',()=>{
 const a=reply('a','u','h');a.message.id='shared';a.message.content=[{type:'thinking',thinking:'private fixture reasoning'}];
 const b=reply('b','a','h');b.message.id='shared';
 const history=parse([user('u','h'),a,b]);
 assert.equal(parseReply(history.requests[0],'h').status,'accepted');
 assert.ok(!JSON.stringify(history).includes('private fixture reasoning'));
});
test('multiple assistant text blocks are combined in ancestry order',()=>{
 const a=reply('a','u','h');a.message.id='shared';
 const b=reply('b','a','h');b.message.id='shared';b.message.content=[{type:'text',text:'Understood.'}];
 const history=parse([user('u','h'),b,a]);
 assert.equal(parseReply(history.requests[0],'h').reply,'HANDOFF_ACCEPTED h\nUnderstood.');
});
test('exact duplicate records do not duplicate text or requests',()=>{
 const u=user('u','h'),a=reply('a','u','h');const history=parse([u,a,u,a]);
 assert.equal(history.requests.length,1);assert.equal(parseReply(history.requests[0],'h').reply,'HANDOFF_ACCEPTED h');
});
test('conflicting duplicate UUIDs cannot be trusted',()=>{
 const a=reply('a','u','h'),changed=reply('a','u','other');const history=parse([user('u','h'),a,changed]);
 assert.equal(parseReply(history.requests[0],'h').status,'unknown');
});
test('multiple competing reply branches require review',()=>{
 const history=parse([user('u','h'),reply('a','u','h'),reply('b','u','h')]);
 assert.equal(parseReply(history.requests[0],'h').status,'unknown');
});
test('synthetic provider errors are failed even when their text echoes an ACK',()=>{
 const a=reply('a','u','h');a.message.model='<synthetic>';a.isApiErrorMessage=true;a.error='rate_limit';
 assert.equal(parseReply(parse([user('u','h'),a]).requests[0],'h').status,'failed');
});
test('a retry on the same ancestry may recover after an error',()=>{
 const a=reply('a','u','h');a.message.model='<synthetic>';a.isApiErrorMessage=true;
 const history=parse([user('u','h'),a,node('retry','a','system'),reply('b','retry','h')]);
 assert.equal(parseReply(history.requests[0],'h').status,'accepted');
});
test('an API error without a terminal assistant error remains pending',()=>{
 const error={...node('e','u','system'),subtype:'api_error',error:{status:429},retryAttempt:1,maxRetries:5};
 assert.equal(parseReply(parse([user('u','h'),error]).requests[0],'h').status,'pending');
});
test('an error descending from a terminal reply invalidates its completed state',()=>{
 const error={...node('e','a','system'),subtype:'api_error',error:{status:429}};
 assert.equal(parseReply(parse([user('u','h'),reply('a','u','h'),error]).requests[0],'h').status,'pending');
});
test('busy, nonterminal and missing assistant identities never accept',()=>{
 const a=reply('a','u','h');a.message.stop_reason='tool_use';
 assert.equal(parseReply(parse([user('u','h'),a]).requests[0],'h').status,'pending');
 assert.equal(parseReply(parse([user('u','h'),reply('b','u','h')],{busy:true}).requests[0],'h').status,'pending');
 delete a.message.id;a.message.stop_reason='end_turn';
 assert.equal(parseReply(parse([user('u','h'),a]).requests[0],'h').status,'unknown');
});
test('truncated tail and incomplete final record retain explicit coverage',()=>{
 const history=parseClaudeTranscript('broken prefix\n'+JSON.stringify(user('u','h'))+'\n'+JSON.stringify(reply('a','u','h'))+'\n{"type":','s',{truncated:true});
 assert.equal(history.hasOlder,true);assert.equal(parseReply(history.requests[0],'h').status,'accepted');
 assert.throws(()=>parse([user('u','h'),'broken record',reply('a','u','h')]),/invalid record/);
});
