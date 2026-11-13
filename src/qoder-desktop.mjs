import { createHash, randomUUID } from 'node:crypto';
import { desktopEvaluate, discoverDesktop } from './desktop-cdp.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
const identity = `const auth=await a.getAuthState();if(auth.status!=='signed-in'||!auth.user?.id)throw new Error('Qoder is not signed in.');const accountId=auth.user.id;`;
const draftCheck = `if([...document.querySelectorAll('[contenteditable=true]')].some(x=>x.innerText.replace(/[\u200B-\u200D\uFEFF]/g,'').trim()))throw new Error('Qoder has a visible unsent draft; no navigation or sending.');`;
export const discoverQoderDesktop = () => discoverDesktop('Qoder.exe', 'Qoder');
export function qoderRequests(messages) {
  return messages.filter(m => m.role === 'user').map(user => {
    const replies = messages.filter(m => m.role === 'assistant' && m.turnId === user.turnId);
    const reply = replies.length === 1 ? replies[0] : null;
    const finals=reply?.parts?.filter(p=>p.type==='text'&&p.id===reply.finalTextId&&!p.parentToolUseId)||[];
    const finalText=reply?.finalTextId?(finals.length===1?finals[0].text:''):(reply?.text||'');
    return { id:user.turnId, state:replies.length>1||reply?.finalTextId&&finals.length!==1?'unknown':reply?.status==='completed'&&reply.completedAt?'completed':['failed','error','interrupted','cancelled'].includes(reply?.status)?'failed':'pending',
      userMessage:{content:[{type:'text',text:user.text||''}]},assistantMessage:{content:reply?[{type:'text',text:finalText}]:[]} };
  });
}
export class QoderDesktop {
  constructor(config) { this.config=config;this.store=config.store;this.evaluateOverride=config.evaluate; }
  evaluate(expression) { return this.evaluateOverride?this.evaluateOverride(expression):desktopEvaluate({...this.config,product:'Qoder',version:'0.4.9',page:u=>u.startsWith('qoder-app://renderer/index.html?workbenchScope=primary')},expression); }
  async status() { return this.evaluate(`(async()=>{const a=window.qoderDesktop;${identity}return {accountId,connected:true,version:'0.4.9',currentId:location.hash.split('/chat/')[1]?.split('?')[0],support:'native-desktop-preload; opt-in loopback CDP',automation:{transport:'qoder-desktop',launchReady:true,focusMayChange:false}};})()`); }
  async check(accountId) { const state=await this.status();if(accountId&&accountId!==state.accountId)throw new Error('Qoder account changed.');return state; }
  key(accountId,id) { return 'qoder-desktop:'+hash(accountId)+':'+id; }
  async list() { return this.evaluate(`(async()=>{const a=window.qoderDesktop;${identity}const rows=await a.listChatSessions(1000,0,false);return {items:rows.filter(r=>!r.archived&&r.executionKind==='local'&&!r.sideChat).map(r=>({id:r.sessionId,nativeId:r.sessionId,title:r.title,projectPath:r.cwd,state:r.pendingInteractionCount||r.latestTurnStatus==='running'?'busy':'unknown'})),truncated:rows.length>=1000};})()`); }
  async create(id,task,accountId) {
    await this.check(accountId);
    if((await this.list()).items.some(r=>r.id===id)||!this.store.reserveSetting(this.key(accountId,id),{phase:'prepared',task}))throw new Error('Qoder session already exists or was reserved.');
    return {id,deferredUntilSend:true};
  }
  async open(id) { const state=await this.status();if(this.store.get('settings',this.key(state.accountId,id))?.phase==='prepared')return {id,prepared:true};
    if(!(await this.list()).items.some(r=>r.id===id))throw new Error('Qoder session not visible.');return {id,navigationChanged:false}; }
  async show(id) { await this.open(id);return this.evaluate(`(()=>{${draftCheck}location.hash='/chat/'+${JSON.stringify(id)}+'?surface=conversation';return {id:${JSON.stringify(id)}};})()`); }
  async read(id,accountId) {
    const status=await this.check(accountId);
    const owned=this.store.get('settings',this.key(status.accountId,id));
    if(owned?.phase==='prepared')return {id,title:owned.task.title,projectPath:owned.task.projectPath,state:'idle',requests:[],hasOlder:false};
    const result=await this.evaluate(`(async()=>{const a=window.qoderDesktop;${identity}if(accountId!==${JSON.stringify(status.accountId)})throw new Error('Qoder account changed.');const rows=await a.listChatSessions(1000,0,false);const row=rows.find(r=>r.sessionId===${JSON.stringify(id)}&&!r.archived&&r.executionKind==='local'&&!r.sideChat);if(!row)throw new Error('Qoder session missing.');const r=await a.openChatSession(row.sessionId);if(r.summary?.sessionId!==row.sessionId)throw new Error('Qoder history identity changed.');return {id:row.sessionId,title:row.title,projectPath:row.cwd,state:r.activeTurn||r.queuedTurns?.length||r.pendingInteractions?.length||r.backgroundAgents?.length?'busy':'idle',hasOlder:r.hasMoreBefore,messages:r.messages.map(m=>({id:m.id,turnId:m.turnId,role:m.role,text:m.text,status:m.status,completedAt:m.completedAt,finalTextId:m.finalTextId,parts:m.parts?.filter(p=>p.type==='text').map(p=>({id:p.id,type:p.type,text:p.text,parentToolUseId:p.parentToolUseId}))}))};})()`);
    return {...result,requests:qoderRequests(result.messages),messages:undefined};
  }
  async send(id,text,marker,accountId,freshOnce=false) {
    const status=await this.check(accountId);accountId=status.accountId;
    const history=await this.read(id,accountId);
    const matches=history.requests.filter(r=>r.userMessage.content[0].text.split(String.fromCharCode(10)).includes(marker));
    if(matches.length>1)throw new Error('Duplicate Qoder marker.');
    if(matches.length)return {deduplicated:true,requestId:matches[0].id};
    if(history.state!=='idle'||history.hasOlder&&!freshOnce)throw new Error('Qoder target is busy or requires reconciliation.');
    const key=this.key(accountId,id),owned=this.store.get('settings',key),isNew=owned?.phase==='prepared';
    const dispatch=key+':dispatch:'+hash(marker);
    if(!this.store.reserveSetting(dispatch,{textHash:hash(text),phase:'reserved'}))throw new Error('Qoder dispatch already reserved; do not resend.');
    const requestId=randomUUID();
    const result=await this.evaluate(`(async()=>{const a=window.qoderDesktop;${identity}if(accountId!==${JSON.stringify(accountId)})throw new Error('Qoder account changed.');${draftCheck}
      const rows=await a.listChatSessions(1000,0,false),row=rows.find(r=>r.sessionId===${JSON.stringify(id)});
      if(${isNew}&&row)throw new Error('New Qoder identity already exists.');
      if(!${isNew}){if(!row||row.archived)throw new Error('Qoder target missing.');const r=await a.openChatSession(row.sessionId);if(r.activeTurn||r.queuedTurns?.length||r.pendingInteractions?.length||r.backgroundAgents?.length)throw new Error('Qoder target became busy.');}
      ${draftCheck}
      return a.sendChatMessage({sessionId:${JSON.stringify(id)},agentId:'agent:default',inputId:${JSON.stringify(requestId)},turnId:${JSON.stringify(requestId)},prompt:${JSON.stringify(text)},cwd:${JSON.stringify(history.projectPath)},permissionMode:row?.permissionMode||'default',executionKind:'local',productMode:row?.productMode||'coding',title:${JSON.stringify('Handoff - '+history.title)},attachments:[]});})()`);
    if(isNew)this.store.putSetting(key,{...owned,phase:'dispatched'});
    this.store.putSetting(dispatch,{textHash:hash(text),phase:'dispatched',requestId});
    return {requestId,invokedOnce:true,result:typeof result==='object'?{keys:Object.keys(result||{})}:result};
  }
}
