import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nodeVersion='24.20.0',nodeHash='5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5';
const args=process.argv.slice(2),index=args.indexOf('--node');
const localNode=index<0?null:args[index+1];
const archiveIndex=args.indexOf('--node-archive'),localArchive=archiveIndex<0?null:args[archiveIndex+1];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Build on Windows x64');
const pkg=JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8'));
const dist=path.join(project,'dist');await fs.mkdir(dist,{recursive:true});
const stage=await fs.mkdtemp(path.join(dist,'stage-')),root=path.join(stage,'AgentHandoff');await fs.mkdir(root);
const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const run=(file,argv,cwd=project,timeout=120000)=>execFileSync(file,argv,{cwd,encoding:'utf8',windowsHide:true,timeout,stdio:['ignore','pipe','pipe']});
const packed=JSON.parse(run(process.execPath,[npm,'pack','--dry-run','--ignore-scripts','--json']))[0];
for(const file of [...packed.files.map(f=>f.path),'package-lock.json']){
 if(file.startsWith('node_modules/')||file.startsWith('dist/')||file.includes('..'))throw new Error('Unexpected packed path');
 const destination=path.join(root,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(project,file),destination);
}
console.log('Installing locked dependencies into clean package');
run(process.execPath,[npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--fetch-timeout=15000','--fetch-retries=0'],root);
await fs.mkdir(path.join(root,'runtime'));
let nodeBytes=localNode?await fs.readFile(localNode):Buffer.from(await (await fetch('https://nodejs.org/dist/v'+nodeVersion+'/win-x64/node.exe',{signal:AbortSignal.timeout(120000)})).arrayBuffer());
if(digest(nodeBytes)!==nodeHash)throw new Error('Node executable differs from official pinned checksum');
await fs.writeFile(path.join(root,'runtime/node.exe'),nodeBytes);nodeBytes=null;
const archive=path.join(stage,'node.zip'),unpacked=path.join(stage,'official-node');
let archiveBytes;
if(localArchive)archiveBytes=await fs.readFile(localArchive);
else{
 const response=await fetch('https://nodejs.org/dist/v'+nodeVersion+'/node-v'+nodeVersion+'-win-x64.zip',{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error('Official Node archive download failed');
 archiveBytes=Buffer.from(await response.arrayBuffer());
}
if(digest(archiveBytes)!=='6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba')throw new Error('Official Node archive checksum differs');
await fs.writeFile(archive,archiveBytes);
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:HANDOFF_NODE_ZIP -DestinationPath $env:HANDOFF_NODE_OUT'],{env:{...process.env,HANDOFF_NODE_ZIP:archive,HANDOFF_NODE_OUT:unpacked},windowsHide:true,timeout:120000,stdio:'pipe'});
await fs.copyFile(path.join(unpacked,'node-v'+nodeVersion+'-win-x64','LICENSE'),path.join(root,'runtime/NODE-LICENSE.txt'));
await fs.writeFile(path.join(root,'runtime/PROVENANCE.json'),JSON.stringify({version:nodeVersion,url:'https://nodejs.org/dist/v'+nodeVersion+'/win-x64/node.exe',sha256:nodeHash},null,2));
console.log('Testing bundled runtime and dependencies');
console.log(run(path.join(root,'runtime/node.exe'),['--test',...packed.files.map(f=>f.path).filter(f=>f.startsWith('test/')&&f.endsWith('.test.mjs'))],root));
const files=[];
async function walk(folder,prefix=''){
 for(const entry of await fs.readdir(folder,{withFileTypes:true})){
  const name=prefix?prefix+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink())throw new Error('Symlink in bundle: '+name);
  if(entry.isDirectory())await walk(path.join(folder,entry.name),name);
  else files.push({path:name,sha256:digest(await fs.readFile(path.join(folder,entry.name)))});
 }
}
await walk(root);files.sort((a,b)=>a.path.localeCompare(b.path));
await fs.writeFile(path.join(root,'release-manifest.json'),JSON.stringify({schema:1,product:'agent-handoff',version:pkg.version,platform:'win32-x64',nodeVersion,files},null,2));
const zip=path.join(dist,'AgentHandoff-'+pkg.version+'-windows-x64.zip');
if(await fs.access(zip).then(()=>true,()=>false))throw new Error('Release asset exists; refuse to overwrite');
const ps='$ErrorActionPreference='+String.fromCharCode(39)+'Stop'+String.fromCharCode(39)+'; Compress-Archive -LiteralPath $env:HANDOFF_STAGE_ROOT -DestinationPath $env:HANDOFF_ZIP -CompressionLevel Optimal';
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{env:{...process.env,HANDOFF_STAGE_ROOT:root,HANDOFF_ZIP:zip},windowsHide:true,timeout:120000,stdio:'pipe'});
const sha256=digest(await fs.readFile(zip));await fs.writeFile(path.join(dist,'SHA256SUMS.txt'),sha256+'  '+path.basename(zip)+os.EOL);
console.log(JSON.stringify({root,zip,sha256,files:files.length,bytes:(await fs.stat(zip)).size}));
