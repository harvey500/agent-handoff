import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function discoverWorkBuddy() {
  if (process.platform !== 'win32') return { installed: false, reason: 'WorkBuddy desktop adapter currently requires Windows.', processes: [] };
  const script = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
    $apps=@(Get-CimInstance Win32_Process -Filter "Name='WorkBuddyAI.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object {
      $owner=$_.ProcessId
      $ports=@(Get-NetTCPConnection -State Listen -OwningProcess $owner -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq '127.0.0.1' | ForEach-Object {$_.LocalPort})
      [pscustomobject]@{pid=$owner;executable=$_.ExecutablePath;ports=$ports}
    })
    $paths=@($apps | ForEach-Object {$_.executable})
    $ws=New-Object -ComObject WScript.Shell
    foreach($base in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'))){
      if(Test-Path -LiteralPath $base){ Get-ChildItem -LiteralPath $base -Filter '*WorkBuddy*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $paths+= $ws.CreateShortcut($_.FullName).TargetPath } }
    }
    $paths+=Join-Path $env:LOCALAPPDATA 'Programs/WorkBuddyAI/WorkBuddyAI.exe'
    [pscustomobject]@{processes=$apps;paths=@($paths | Where-Object {$_ -and (Test-Path -LiteralPath $_)} | Select-Object -Unique)} | ConvertTo-Json -Depth 4 -Compress`;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 12000, maxBuffer: 32000 });
  const result = JSON.parse(stdout.replace(/^﻿/, '').trim());
  const configured = process.env.AGENT_HANDOFF_WORKBUDDY_EXE;
  if (configured) { await fs.access(configured); result.paths.unshift(configured); }
  let main = result.processes[0], endpoint = null;
  for (const process of result.processes) {
    for (const port of process.ports || []) {
      try {
        const address = 'http://127.0.0.1:' + port;
        const v = await (await fetch(address + '/json/version', { signal: AbortSignal.timeout(400) })).json();
        if (v['User-Agent']?.includes('WorkBuddyAI/')) { main = process; endpoint = address; break; }
      } catch {}
    }
    if (endpoint) break;
  }
  return { id: 'workbuddy', installed: result.paths.length > 0, running: !!main, executable: main?.executable || result.paths[0], endpoint, processes: result.processes };
}

export async function launchWorkBuddy(app, port) {
  if (!app.executable) throw new Error('未找到 WorkBuddy 安装位置');
  if (app.running) throw new Error('WorkBuddy 已运行，但未启用连接。请先手动退出，再点击连接。不会强制重启。');
  const { spawn } = await import('node:child_process');
  const child = spawn(app.executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
