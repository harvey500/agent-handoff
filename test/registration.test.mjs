import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upsertJsonRegistration } from '../src/registration.mjs';
test('registration preserves unrelated config, backs up and never claims loaded', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-reg-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'config.json'), entry={command:'node',args:['mcp.mjs']};
  fs.writeFileSync(file,String.fromCharCode(65279)+JSON.stringify({custom:{value:1},mcpServers:{other:{command:'keep'}}}));
  const before=fs.readFileSync(file);
  assert.equal(upsertJsonRegistration(file,entry).result,'added');
  assert.deepEqual(fs.readFileSync(file),before);
  const result=upsertJsonRegistration(file,entry,{dryRun:false});
  assert.equal(result.loaded,'not-verified');
  const after=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(after.custom.value,1);assert.equal(after.mcpServers.other.command,'keep');
  assert.equal(fs.readdirSync(dir).length,2);
  assert.equal(upsertJsonRegistration(file,{command:'changed'}).result,'exists-different');
});
test('invalid config shape is preserved instead of replacing it', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-reg-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'config.json');
  for(const raw of ['[]','null','{"mcpServers":[]}', '{bad']){
    fs.writeFileSync(file,raw);assert.equal(upsertJsonRegistration(file,{} ,{dryRun:false}).result,'invalid-json');
    assert.equal(fs.readFileSync(file,'utf8'),raw);
  }
});
