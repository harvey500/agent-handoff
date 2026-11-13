import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverWorkBuddy } from '../src/discovery.mjs';
test('running-client discovery does not invoke COM or optional shortcut lookup', {skip:process.platform!=='win32'}, async () => {
  let calls=0;
  const result=await discoverWorkBuddy({run:async (_file,args)=>{
    calls++;assert.ok(!args.at(-1).includes('ComObject'));
    return {stdout:JSON.stringify({processes:[{pid:1,executable:'fake.exe',ports:[]}],paths:['fake.exe']})};
  }});
  assert.equal(calls,1);assert.equal(result.running,true);
});
test('denied optional shortcut lookup does not discard process discovery', {skip:process.platform!=='win32'}, async () => {
  let calls=0;
  const result=await discoverWorkBuddy({run:async()=>{
    calls++;if(calls===2)throw new Error('COM denied by host');
    return {stdout:JSON.stringify({processes:[],paths:[]})};
  }});
  assert.equal(calls,2);assert.equal(result.running,false);assert.equal(result.installed,false);
});
