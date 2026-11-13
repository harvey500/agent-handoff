import test from 'node:test';
import assert from 'node:assert/strict';
import { qoderRequests } from '../src/qoder-desktop.mjs';
test('Qoder native replies require matching turn identity and completed state',()=>{
 const rows=[{id:'u',role:'user',turnId:'one',text:'packet'},{role:'assistant',turnId:'other',text:'wrong',status:'completed',completedAt:'now'}];
 assert.equal(qoderRequests(rows)[0].state,'pending');
 rows.push({role:'assistant',turnId:'one',text:'ack',status:'completed',completedAt:'now'});
 assert.equal(qoderRequests(rows)[0].assistantMessage.content[0].text,'ack');
 rows.at(-1).status='running';assert.equal(qoderRequests(rows)[0].state,'pending');
 rows.push({...rows.at(-1),status:'completed'});assert.equal(qoderRequests(rows)[0].state,'unknown');
});
test('Qoder uses its exact final text segment, never preceding commentary',()=>{
 const rows=[{role:'user',turnId:'one',text:'packet'},{role:'assistant',turnId:'one',status:'completed',completedAt:'now',text:'commentary then ack',finalTextId:'final',parts:[{id:'commentary',type:'text',text:'commentary'},{id:'final',type:'text',text:'HANDOFF_ACCEPTED test'}]}];
 assert.equal(qoderRequests(rows)[0].assistantMessage.content[0].text,'HANDOFF_ACCEPTED test');
 rows[1].parts.pop();assert.equal(qoderRequests(rows)[0].state,'unknown');
});
