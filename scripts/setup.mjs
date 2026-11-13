import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {installAt,uninstallAt,configureCodex} from './installation.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [operation,...args]=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const interactive=!args.includes('--yes');
const prompt=createInterface({input:process.stdin,output:process.stdout});
try {
  if(operation==='install'){
    const hasD=await fs.access('D:/').then(()=>true,()=>false);
    const fallback=hasD?'D:/Apps/AgentHandoff':path.join(process.env.LOCALAPPDATA||os.homedir(),'Programs','AgentHandoff');
    const destination=option('--dir')||(interactive?(await prompt.question('Install directory / 安装目录 ['+fallback+']: ')).trim():null)||fallback;
    const result=await installAt(root,destination);
    console.log('Installed / 安装完成: '+result.directory);
    console.log('Run Connect-Codex.cmd from that directory to register with Codex. / 在安装目录运行 Connect-Codex.cmd 接入。');
    console.log('Other MCP hosts: import '+result.config+' using the host-specific format. / 其他宿主按各自格式导入。');
  } else if(operation==='connect'||operation==='disconnect'){
    const statePath=path.join(root,'install-state.json');
    const state=JSON.parse(await fs.readFile(statePath,'utf8'));
    if(state.product!=='agent-handoff'||path.resolve(state.directory)!==root)throw new Error('Use this command from an installed copy');
    const name=option('--name')||'agent-handoff';
    const home=path.resolve(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
    if(state.registration&&(state.registration.home!==home||state.registration.name!==name))throw new Error('Different CODEX_HOME or server name; preserve the existing registration');
    if(interactive && !/^(y|yes)$/i.test(await prompt.question(operation+' Codex MCP in '+home+'? [y/N] / 确认: ')))throw new Error('Cancelled; no changes');
    const run=argv=>spawnSync(option('--codex')||'codex',argv,{encoding:'utf8',windowsHide:true,timeout:25000,env:process.env});
    const codexInbound=state.registration?.codexInbound===true || operation==='connect'&&args.includes('--enable-inbound');
    const result=configureCodex(root,operation,run,name,{codexInbound});
    state.registration=operation==='connect'?{home,name,codexInbound}:null;
    await fs.writeFile(statePath,JSON.stringify(state));
    console.log(JSON.stringify(result));console.log('Reload MCP tools in the host. / 请重新加载宿主 MCP 工具。');
  } else if(operation==='uninstall'){
    if(interactive && !/^(y|yes)$/i.test(await prompt.question('Remove program files, keep task data? [y/N] / 卸载程序但保留任务数据: ')))throw new Error('Cancelled; no changes');
    console.log(JSON.stringify(await uninstallAt(root)));
  } else throw new Error('Use install, connect, disconnect or uninstall');
}catch(error){console.error(error.message);process.exitCode=1;}finally{prompt.close();}
