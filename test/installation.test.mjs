import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {childPath,installAt,uninstallAt,configureCodex,hostConfig} from '../scripts/installation.mjs';
async function fixture(t){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-install-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const source=path.join(folder,'package'),destination=path.join(folder,'installed app');await fs.mkdir(path.join(source,'src'),{recursive:true});
 await fs.writeFile(path.join(source,'src/mcp.mjs'),'// fixture');
 const files=[{path:'src/mcp.mjs',sha256:createHash('sha256').update('// fixture').digest('hex')}];
 await fs.writeFile(path.join(source,'release-manifest.json'),JSON.stringify({schema:1,product:'agent-handoff',version:'test',files}));
 return{folder,source,destination};
}
test('release installation verifies files and produces absolute host config',async t=>{
 const f=await fixture(t),result=await installAt(f.source,f.destination);
 assert.equal(result.directory,f.destination);
 const config=JSON.parse(await fs.readFile(result.config));assert.deepEqual(config.mcpServers['agent-handoff'],hostConfig(f.destination));
 assert.equal(await fs.readFile(path.join(f.destination,'src/mcp.mjs'),'utf8'),'// fixture');
});
test('existing destinations and damaged payloads are refused before writing',async t=>{
 const f=await fixture(t);await fs.mkdir(f.destination);await fs.writeFile(path.join(f.destination,'keep'),'user');
 await assert.rejects(installAt(f.source,f.destination),/already exists/);
 await fs.writeFile(path.join(f.source,'src/mcp.mjs'),'changed');
 await assert.rejects(installAt(f.source,path.join(f.folder,'second')),/verification failed/);
 assert.equal(await fs.access(path.join(f.folder,'second')).then(()=>true,()=>false),false);
});
test('manifest traversal, duplicate paths and symlink payloads cannot install',async t=>{
 const f=await fixture(t);assert.throws(()=>childPath(f.source,'../escape'),/Unsafe/);
 assert.throws(()=>childPath(f.source,'src/../../escape'),/Unsafe/);
 await fs.writeFile(path.join(f.source,'release-manifest.json'),JSON.stringify({schema:1,product:'agent-handoff',files:[{path:'../escape',sha256:'0'.repeat(64)}]}));
 await assert.rejects(installAt(f.source,f.destination),/Unsafe/);
});
test('uninstall preserves task state and unrelated files',async t=>{
 const f=await fixture(t);await installAt(f.source,f.destination);
 await fs.mkdir(path.join(f.destination,'.local'));await fs.writeFile(path.join(f.destination,'.local/tasks'),'private');
 await fs.writeFile(path.join(f.destination,'user-note'),'keep');
 const result=await uninstallAt(f.destination);assert.equal(result.preserved.length,0);
 assert.equal(await fs.readFile(path.join(f.destination,'.local/tasks'),'utf8'),'private');
 assert.equal(await fs.readFile(path.join(f.destination,'user-note'),'utf8'),'keep');
 assert.equal(await fs.access(path.join(f.destination,'src/mcp.mjs')).then(()=>true,()=>false),false);
});
test('uninstall preserves changed program files and refuses a linked installation root',async t=>{
 const f=await fixture(t);await installAt(f.source,f.destination);await fs.writeFile(path.join(f.destination,'src/mcp.mjs'),'user edit');
 assert.ok((await uninstallAt(f.destination)).preserved.includes('src/mcp.mjs'));
 const link=path.join(f.folder,'linked');await fs.symlink(f.destination,link,process.platform==='win32'?'junction':'dir');
 await assert.rejects(uninstallAt(link),/Linked/);
});
test('uninstall requires disconnecting a recorded host first',async t=>{
 const f=await fixture(t);await installAt(f.source,f.destination);
 const file=path.join(f.destination,'install-state.json'),state=JSON.parse(await fs.readFile(file));
 await fs.writeFile(file,JSON.stringify({...state,registration:{home:'test'}}));
 await assert.rejects(uninstallAt(f.destination),/Disconnect/);
 assert.equal(await fs.readFile(path.join(f.destination,'src/mcp.mjs'),'utf8'),'// fixture');
});
test('Codex integration refuses collisions and verifies an owned registration',()=>{
 const root=path.resolve('example app'),calls=[];let rows=[{name:'unrelated',transport:{type:'stdio',command:'other'}}];
 const run=argv=>{calls.push(argv);if(argv[1]==='list')return{status:0,stdout:JSON.stringify(rows)};
  if(argv[1]==='add')rows.push({name:argv[2],transport:{type:'stdio',...hostConfig(root)}});
  if(argv[1]==='remove')rows=rows.filter(r=>r.name!==argv[2]);return{status:0};};
 assert.equal(configureCodex(root,'connect',run).changed,true);assert.equal(configureCodex(root,'connect',run).changed,false);
 assert.equal(calls.filter(c=>c[1]==='add').length,1);assert.equal(configureCodex(root,'disconnect',run).changed,true);
 assert.equal(rows[0].name,'unrelated');rows.push({name:'agent-handoff',transport:{type:'stdio',command:'someone-else'}});
 assert.throws(()=>configureCodex(root,'connect',run),/preserving/);assert.throws(()=>configureCodex(root,'disconnect',run),/preserving/);
});
