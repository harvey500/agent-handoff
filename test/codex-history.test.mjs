import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { delegationRecords } from '../src/codex-history.mjs';
function fixture(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'codex-rollout-'));fs.mkdirSync(path.join(home,'sessions'));
  const file=path.join(home,'sessions','test.jsonl'),db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, archived INTEGER)');db.prepare('INSERT INTO threads VALUES (?, ?, 0)').run('thread',file);db.close();
  const meta={type:'session_meta',payload:{id:'thread'}};
  const write=records=>fs.writeFileSync(file,[meta,...records].map(r=>JSON.stringify(r)).join(String.fromCharCode(10))+String.fromCharCode(10));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return {home,file,write};
}
test('Codex rollout extraction exposes only exact delegation records, not reasoning or unrelated outputs',t=>{
  const f=fixture(t);f.write([{type:'response_item',payload:{type:'reasoning',text:'private'}},
    {type:'response_item',payload:{id:'match',type:'function_call_output',namespace:'codex_app',name:'create_thread',output:'packet'}},
    {type:'response_item',payload:{type:'function_call_output',namespace:'other',name:'create_thread',output:'unrelated'}}]);
  const records=delegationRecords(f.home,'thread');assert.equal(records.length,1);assert.equal(records[0].id,'match');
});
test('Codex rollout rejects metadata mismatch and paths outside active sessions',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,JSON.stringify({type:'session_meta',payload:{id:'other'}}));
  assert.throws(()=>delegationRecords(f.home,'thread'),/identity mismatch/);
  const outside=path.join(f.home,'outside.jsonl');fs.writeFileSync(outside,'{}');
  const db=new DatabaseSync(path.join(f.home,'state_5.sqlite'));db.prepare('UPDATE threads SET rollout_path = ?').run(outside);db.close();
  assert.throws(()=>delegationRecords(f.home,'thread'),/outside active sessions/);
});
test('Codex rollout accepts a Windows junction home and extended-length stored path',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t),linkedHome=path.join(f.home,'linked-home');
  fs.symlinkSync(f.home,linkedHome,'junction');
  f.write([{type:'response_item',payload:{id:'junction-match',type:'function_call_output',namespace:'codex_app',name:'create_thread',output:'packet'}}]);
  const db=new DatabaseSync(path.join(f.home,'state_5.sqlite'));
  db.prepare('UPDATE threads SET rollout_path = ?').run(path.toNamespacedPath(f.file));db.close();
  assert.equal(delegationRecords(linkedHome,'thread')[0].id,'junction-match');
});
