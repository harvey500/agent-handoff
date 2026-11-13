import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function discoverDesktop(exe, product) {
  if (!/^[a-z -]+[.]exe$/i.test(exe)) throw new Error('Invalid desktop executable name.');
  const script = `$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue);$apps=@(Get-CimInstance Win32_Process -Filter "Name='${exe}'"|Where-Object {$_.CommandLine -notmatch '--type='}|ForEach-Object {$owner=$_.ProcessId;[pscustomobject]@{pid=$owner;executable=$_.ExecutablePath;ports=@($listeners|Where-Object {$_.OwningProcess -eq $owner -and $_.LocalAddress -eq '127.0.0.1'}|ForEach-Object {$_.LocalPort})}});ConvertTo-Json -InputObject $apps -Depth 4 -Compress`;
  const { stdout } = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], { windowsHide:true,timeout:12000,maxBuffer:32000 });
  const apps = JSON.parse(stdout.trim() || '[]');
  for (const app of apps) for (const port of app.ports) {
    const endpoint = 'http://127.0.0.1:' + port;
    try { const version = await (await fetch(endpoint + '/json/version', {signal:AbortSignal.timeout(500)})).json();
      if (version['User-Agent']?.includes(product + '/')) return { installed:true,running:true,executable:app.executable,endpoint,processes:apps };
    } catch {}
  }
  return { installed:apps.length>0,running:apps.length>0,executable:apps[0]?.executable,endpoint:null,processes:apps };
}
export async function desktopEvaluate(config, expression, timeoutMs = 15000) {
  const address = new URL(config.endpoint);
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.pathname !== '/') throw new Error('Literal loopback desktop endpoint required.');
  const version = await (await fetch(address + 'json/version', {signal:AbortSignal.timeout(3000)})).json();
  if (!version['User-Agent']?.includes(config.product + '/' + config.version + ' ')) throw new Error('Unvalidated desktop version.');
  const targets = await (await fetch(address + 'json/list', {signal:AbortSignal.timeout(3000)})).json();
  const pages = targets.filter(t => t.type === 'page' && config.page(t.url));
  if (pages.length !== 1) throw new Error('Expected one verified desktop page.');
  const ws = new URL(pages[0].webSocketDebuggerUrl);
  if (ws.protocol !== 'ws:' || ws.hostname !== address.hostname || ws.port !== address.port) throw new Error('Unexpected desktop socket.');
  const socket = new WebSocket(ws); let timer;
  try { return await new Promise((resolve,reject) => {
    timer=setTimeout(()=>reject(new Error('Desktop operation timed out; inspect receipt before retrying.')),timeoutMs);
    socket.addEventListener('error',()=>reject(new Error('Desktop connection failed.')),{once:true});
    socket.addEventListener('close',()=>reject(new Error('Desktop connection closed; delivery unknown.')),{once:true});
    socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}})),{once:true});
    socket.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id!==1)return;
      if(r.error||r.result?.exceptionDetails)reject(new Error(r.error?.message||r.result.exceptionDetails.exception?.description||'Desktop evaluation rejected.'));
      else resolve(r.result.result?.value);
    });
  }); } finally { clearTimeout(timer);socket.close(); }
}
