import { validateEndpoint, targetPage } from './core.mjs';

export class WorkBuddy {
  constructor(config) { this.config = config; this.endpoint = validateEndpoint(config.endpoint); }

  async evaluate(expression, timeoutMs = 15000) {
    const version = await (await fetch(this.endpoint + '/json/version', { signal: AbortSignal.timeout(3000) })).json();
    if (version['User-Agent']?.match(/WorkBuddyAI[/]([^ ]+)/)?.[1] !== this.config.testedVersion) {
      throw new Error('Unsupported WorkBuddy version; validate this adapter before use.');
    }
    const targets = await (await fetch(this.endpoint + '/json/list', { signal: AbortSignal.timeout(3000) })).json();
    const target = targetPage(targets, this.config.executable);
    if (!target) throw new Error('The verified WorkBuddy desktop page is not available.');
    const wsUrl = new URL(target.webSocketDebuggerUrl);
    if (wsUrl.protocol !== 'ws:' || wsUrl.hostname !== '127.0.0.1' || wsUrl.port !== new URL(this.endpoint).port) {
      throw new Error('Unexpected debugger endpoint.');
    }
    const socket = new WebSocket(wsUrl);
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Operation timed out; inspect the receipt before retrying.')), timeoutMs);
        socket.addEventListener('error', () => reject(new Error('Desktop connection failed.')), { once: true });
        socket.addEventListener('close', () => reject(new Error('Desktop connection closed; outcome may be unknown.')), { once: true });
        socket.addEventListener('open', () => socket.send(JSON.stringify({
          id: 1, method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        })), { once: true });
        socket.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          if (message.id !== 1) return;
          if (message.error || message.result?.exceptionDetails) {
            const detail = message.result?.exceptionDetails;
            reject(new Error(message.error?.message || detail?.exception?.description || detail?.text || 'Desktop API failed.'));
          } else resolve(message.result?.result?.value);
        });
      });
    } finally { clearTimeout(timer); socket.close(); }
  }

  status() {
    return this.evaluate(`(async()=>{const a=await window.wb.account.profile();return {version:window.workbuddyDesktop.appVersion,connected:!!window.wb?.conversations,
      accountId:a?.uid,currentId:window.wb.conversations.currentId,route:window.wb.navigation.route};})()`);
  }

  list() {
    return this.evaluate(`(async()=>{let items=[],total=0;for(let page=1;page<=10;page++){
      const p=await window.wb.conversations.list({transport:'local',page,size:100});total=p.total;
      items.push(...p.items.map(c=>({id:c.id,title:c.title,state:c.state,transport:c.transport})));
      if(!p.items.length||items.length>=total)break;}return {total,items,truncated:items.length<total};})()`);
  }

  create(id, task, accountId) {
    return this.evaluate(`(async()=>{
      const a=await window.wb.account.profile();if(a?.uid!==${JSON.stringify(accountId)})throw new Error('WorkBuddy account changed.');
      let c=await window.wb.conversations.get(${JSON.stringify(id)}).catch(()=>null);
      if(!c?.info){const current=window.wb.conversations.current;
        c=await window.wb.conversations.create({conversationId:${JSON.stringify(id)},cwd:${JSON.stringify(task.projectPath)},
          title:${JSON.stringify('交接 · ' + task.title)},transport:'local',conversationOrigin:'local',mode:'craft',
          model:current?.configManager.model,addonSelection:{version:1,interactionMode:'craft',permissionMode:'default'}});}
      if(!c?.info)throw new Error(c?.message||'Failed to create conversation');
      await c.configManager.setPermissionMode('default');return {id:c.info.id,title:c.info.title};})()`);
  }

  async open(id) {
    await this.evaluate(`(async()=>{const c=await window.wb.conversations.get(${JSON.stringify(id)});
      if(window.wb.conversations.currentId!==${JSON.stringify(id)} && window.wb.conversations.current?.ui?.input?.getDraftBlocks().some(b=>b.type!=='text'||b.text?.trim()))throw new Error('Current conversation has an unsent draft; not switching away.');
      if(!c?.info)throw new Error('Bound conversation is missing; not creating an unrelated replacement.');
      await window.wb.navigation.goto('/conversation/'+${JSON.stringify(id)});return {id:c.info.id,title:c.info.title};})()`);
    const deadline = Date.now() + 8000;
    do {
      const state = await this.status();
      if (state.currentId === id && state.route === '/conversation/' + id) return state;
      await new Promise(r => setTimeout(r, 200));
    } while (Date.now() < deadline);
    throw new Error('The target conversation was not activated; no message was sent.');
  }

  read(id, accountId) {
    return this.evaluate(`(async()=>{const c=await window.wb.conversations.get(${JSON.stringify(id)});
      ${accountId ? `if((await window.wb.account.profile())?.uid!==${JSON.stringify(accountId)})throw new Error('WorkBuddy account changed.');` : ''}
      c.preload();
      let p;const deadline=Date.now()+8000;
      do{p=await c.requestEntries({byteLength:262144,resultScope:'page'});
        if(p.historyReady!==false)break;
        if(Date.now()>=deadline)throw new Error('Conversation history is not loaded; cannot judge task identity.');
        await new Promise(resolve=>setTimeout(resolve,250));
      }while(true);
      ${accountId ? `if((await window.wb.account.profile())?.uid!==${JSON.stringify(accountId)})throw new Error('WorkBuddy account changed.');` : ''}
      const visible=m=>({content:(m?.content||[]).filter(b=>b.type==='text').map(b=>({type:'text',text:b.text}))});
      return {id:c.info.id,title:c.info.title,state:c.info.state,projectPath:c.info.cwd||c.info.projectPath||null,total:p.totalRequests,hasOlder:p.hasOlder,
        requests:p.requests.map(r=>({id:r.id,state:r.state,userMessage:visible(r.userMessage),assistantMessage:visible(r.assistantMessage)}))};})()`);
  }

  async send(id, text, marker, accountId, freshOnce = false) {
    await this.open(id);
    return this.evaluate(`(async()=>{
      ${accountId ? `if((await window.wb.account.profile())?.uid!==${JSON.stringify(accountId)})throw new Error('WorkBuddy account changed.');` : ''}
      if(window.wb.conversations.currentId!==${JSON.stringify(id)})throw new Error('Conversation changed before send.');
      const c=window.wb.conversations.current;
      if(c.info.state!=='idle')throw new Error('Target conversation is busy.');
      if(c.ui.input.getDraftBlocks().some(b=>b.type!=='text'||b.text?.trim()))throw new Error('Target contains an unsent draft.');
      const p=await c.requestEntries({byteLength:262144,resultScope:'page'});
      const marker=${JSON.stringify(marker)};
      const matches=p.requests.filter(r=>(r.userMessage?.content||[]).some(b=>b.type==='text'&&(marker.startsWith('HANDOFF_ID: ')?b.text?.split(String.fromCharCode(10)).map(l=>l.trim()).includes(marker):b.text?.includes(marker))));
      if(matches.length>1)throw new Error('Duplicate matching requests require review.');
      if(matches.length) return {deduplicated:true,requestId:matches[0].id};
      if(p.hasOlder && !${JSON.stringify(freshOnce)})throw new Error('History is paginated; refusing an unverified automatic retry.');
      ${accountId ? `if((await window.wb.account.profile())?.uid!==${JSON.stringify(accountId)})throw new Error('WorkBuddy account changed.');` : ''}
      if(window.wb.conversations.currentId!==${JSON.stringify(id)}||window.wb.conversations.current!==c)throw new Error('Conversation changed before dispatch.');
      if(c.info.state!=='idle')throw new Error('Target conversation became busy.');
      if(c.ui.input.getDraftBlocks().some(b=>b.type!=='text'||b.text?.trim()))throw new Error('Target contains a new unsent draft.');
      const result=await c.ui.input.sendPrompt({blocks:[{type:'text',text:${JSON.stringify(text)}}]});
      if(!result?.ok)throw new Error(result?.error?.message||'Message rejected');
      return {accepted:true};})()`);
  }
}
