import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function childPath(root, name) {
  if (typeof name !== 'string' || !name || name.includes(String.fromCharCode(92)) || path.isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe manifest path');
  const result = path.resolve(root, name);
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new Error('Manifest path escapes root');
  return result;
}
async function noLinks(root, file) {
  const resolved = path.resolve(root);
  for (let current = path.parse(resolved).root; ;) {
    const rel = path.relative(current, resolved).split(path.sep).filter(Boolean);
    if (!rel.length) break;
    current = path.join(current, rel[0]);
    const st = await fs.lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (st?.isSymbolicLink()) throw new Error('Linked installation paths are not supported');
  }
  for (const part of path.relative(resolved, file).split(path.sep).filter(Boolean)) {
    root = path.join(root, part);
    const st = await fs.lstat(root).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (st?.isSymbolicLink()) throw new Error('Linked payload path is not supported');
  }
}
export async function manifestAt(root) {
  const data = JSON.parse(await fs.readFile(path.join(root, 'release-manifest.json'), 'utf8'));
  if (data.product !== 'agent-handoff' || data.schema !== 1 || !Array.isArray(data.files) || !data.files.length) throw new Error('Invalid release manifest');
  const seen = new Set();
  for (const f of data.files) {
    childPath(root, f.path);
    if (!/^[a-f0-9]{64}$/.test(f.sha256) || seen.has(f.path.toLowerCase())) throw new Error('Invalid or duplicate manifest entry');
    seen.add(f.path.toLowerCase());
  }
  return data;
}
export async function verifyPayload(root) {
  const manifest = await manifestAt(root);
  for (const f of manifest.files) {
    const file = childPath(root, f.path); await noLinks(root, file);
    const st = await fs.lstat(file);
    if (!st.isFile() || digest(await fs.readFile(file)) !== f.sha256) throw new Error('Payload verification failed: ' + f.path);
  }
  return manifest;
}
export function hostConfig(root) {
  return {command: path.join(root, 'runtime', 'node.exe'), args: [path.join(root, 'src', 'mcp.mjs')], env: {AGENT_HANDOFF_HOME: path.join(root, '.local')}};
}
export async function installAt(source, destination) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (destination === source || destination.startsWith(source + path.sep) || source.startsWith(destination + path.sep)) throw new Error('Choose a separate installation directory');
  await noLinks(destination, destination);
  if (await fs.lstat(destination).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) throw new Error('Destination already exists; choose an unused directory');
  const manifest = await verifyPayload(source);
  await fs.mkdir(path.dirname(destination), {recursive: true});
  await fs.mkdir(destination);
  for (const f of manifest.files) {
    const file = childPath(destination, f.path);
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.copyFile(childPath(source, f.path), file, 1);
  }
  await fs.copyFile(path.join(source, 'release-manifest.json'), path.join(destination, 'release-manifest.json'), 1);
  const config = JSON.stringify({mcpServers: {'agent-handoff': hostConfig(destination)}}, null, 2);
  await fs.writeFile(path.join(destination, 'mcp-config.json'), config, {flag: 'wx'});
  await fs.writeFile(path.join(destination, 'install-state.json'), JSON.stringify({product:'agent-handoff', schema:1, directory:destination, version:manifest.version, generated:{'mcp-config.json':digest(config)}}), {flag:'wx'});
  await verifyPayload(destination);
  return {directory:destination, version:manifest.version, config:path.join(destination, 'mcp-config.json')};
}
export function sameRegistration(actual, expected) {
  const t = actual?.transport;
  const same = (a,b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  return t?.type === 'stdio' && same(t.command, expected.command) && Array.isArray(t.args) && t.args.length === 1 && same(t.args[0],expected.args[0]) && same(t.env?.AGENT_HANDOFF_HOME,expected.env.AGENT_HANDOFF_HOME);
}
export function configureCodex(root, operation, run, name = 'agent-handoff') {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw new Error('Invalid MCP name');
  const listed = run(['mcp','list','--json']);
  if (listed.status !== 0) throw new Error('Cannot inspect Codex MCP settings; no changes made');
  const rows = JSON.parse(listed.stdout);
  if (!Array.isArray(rows)) throw new Error('Unexpected Codex configuration format');
  const old = rows.find(r => r.name === name), expected = hostConfig(root);
  if (old && !sameRegistration(old, expected)) throw new Error('A different MCP entry already uses this name; preserving it');
  if (operation === 'connect' && old || operation === 'disconnect' && !old) return {changed:false};
  const result = run(operation === 'connect' ? ['mcp','add',name,'--env','AGENT_HANDOFF_HOME='+expected.env.AGENT_HANDOFF_HOME,'--',expected.command,...expected.args] : ['mcp','remove',name]);
  if (result.status !== 0) throw new Error('Codex configuration command failed; inspect settings before retrying');
  const after = run(['mcp','list','--json']);
  if (after.status !== 0) throw new Error('Unable to verify Codex configuration');
  const current = JSON.parse(after.stdout).find(r => r.name === name);
  if (operation === 'connect' ? !sameRegistration(current,expected) : !!current) throw new Error('Codex configuration verification failed');
  return {changed:true};
}
export async function uninstallAt(root) {
  root = path.resolve(root);
  const stateFile = path.join(root,'install-state.json');
  await noLinks(root,stateFile);
  const state = JSON.parse(await fs.readFile(stateFile,'utf8'));
  if (state.product !== 'agent-handoff' || state.schema !== 1 || path.resolve(state.directory) !== root) throw new Error('Installation ownership does not match');
  if (state.registration) throw new Error('Disconnect Codex in the same CODEX_HOME first; no files removed');
  const manifest = await manifestAt(root), preserved = [], removed = [], dirs = new Set();
  const files = [...manifest.files,...Object.entries(state.generated || {}).map(([name,sha256])=>({path:name,sha256}))];
  for (const f of files) {
    const target = childPath(root,f.path); await noLinks(root,target);
    const st = await fs.lstat(target).catch(e => {if(e.code==='ENOENT')return null;throw e;});
    if (!st) continue;
    if (!st.isFile() || digest(await fs.readFile(target)) !== f.sha256) {preserved.push(f.path);continue;}
    await fs.unlink(target); removed.push(f.path);
    for (let dir=path.dirname(target);dir!==root;dir=path.dirname(dir)) dirs.add(dir);
  }
  for (const dir of [...dirs].sort((a,b)=>b.length-a.length)) await fs.rmdir(dir).catch(e=>{if(!['ENOTEMPTY','ENOENT','EBUSY'].includes(e.code))throw e;});
  // Keep ownership records if modified program files remain, so the user can inspect them.
  if (!preserved.length) {await fs.unlink(path.join(root,'release-manifest.json'));await fs.unlink(stateFile);}
  await fs.rmdir(root).catch(e=>{if(!['ENOTEMPTY','EBUSY'].includes(e.code))throw e;});
  return {removed:removed.length,preserved,dataPreserved:path.join(root,'.local')};
}
