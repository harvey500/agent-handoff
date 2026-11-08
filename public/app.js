const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = $('meta[name=local-token]').content;
const state = { tasks: [], handoffs: [], conversations: [], selectedTask: null, selectedReceipt: null, connection: null };
const statuses = { preparing: '准备中', sending: '发送中', pending: '等待回复', unknown: '结果未知', accepted: '已接受', declined: '已拒绝', 'needs-info': '需要补充资料', 'reply-unconfirmed': '回复待确认', failed: '未成功', closed: '本机回执已关闭' };
const badge = status => `<span class="badge ${status === 'accepted' ? 'good' : ['unknown', 'needs-info', 'pending', 'reply-unconfirmed'].includes(status) ? 'warn' : ['failed', 'declined'].includes(status) ? 'bad' : ''}">${esc(statuses[status] || status)}</span>`;
const icons = () => window.lucide?.createIcons();
function notice(message) { $('#notice').hidden = !message; $('#notice').textContent = message || ''; }
async function api(route, data) {
  const response = await fetch('/api/' + route, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || '操作未成功'); return body;
}
async function busy(button, fn) { button.disabled = true; notice(''); try { await fn(); } catch (e) { notice(e.message); } finally { button.disabled = false; icons(); } }
function time(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''; }
function currentTask() { return state.tasks.find(t => t.id === state.selectedTask); }
async function loadState() {
  const result = await api('state'); Object.assign(state, result);
  if (!state.tasks.some(t => t.id === state.selectedTask)) state.selectedTask = state.tasks[0]?.id;
  $('#task-select').innerHTML = state.tasks.length ? state.tasks.map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('') : '<option value="">暂无任务</option>';
  $('#task-select').value = state.selectedTask || '';
  $('#task-count').textContent = state.tasks.length + ' 项';
  $('#history-count').textContent = state.handoffs.length;
  renderTask(); renderReceipt(); renderHistory();
}
function renderTask() {
  const t = currentTask();
  $('#task-detail').className = t ? '' : 'empty';
  $('#task-detail').innerHTML = t ? `<div class="task-title">${esc(t.title)}</div><div class="task-goal">${esc(t.goal)}</div><div class="task-path">${esc(t.projectPath)}</div><div class="task-meta"><span class="badge">${esc(t.source.application)}</span><span class="badge ${t.mode === 'acknowledge-only' ? '' : 'warn'}">${t.mode === 'acknowledge-only' ? '仅确认收到' : '允许继续任务'}</span><span class="badge">待完成 ${t.remaining.length} 项</span></div>` : '暂无任务';
  $('#send').disabled = !t || !state.connection?.connected; $('#preview').disabled = !t;
}
async function loadConnection() {
  state.connection = await api('connection'); const c = state.connection;
  $('#client-state').textContent = c.connected ? c.version + ' · 已连接' : c.installed ? '未连接' : '未发现安装';
  $('#client-dot').className = 'dot' + (c.connected ? '' : ' muted');
  $('#connect').hidden = !!c.connected;
  $('#connection-error').hidden = !!c.connected; $('#connection-error').textContent = c.reason || '';
  renderTask(); renderAdapter();
}
async function loadConversations() {
  if (!state.connection?.connected) { state.conversations = []; renderConversations(); return; }
  const r = await api('conversations' + (state.selectedTask ? '?taskId=' + state.selectedTask : ''));
  state.conversations = r.items; state.bound = r.bound;
  if(state.targetTask!==state.selectedTask){state.target=r.bound||'new';state.targetTask=state.selectedTask;}
  renderConversations();
  if (r.truncated) notice('会话超过适配器本次读取范围，未展示全部历史');
}
function renderConversations() {
  const search = $('#search').value.trim().toLowerCase();
  const selected = state.target || 'new';
  $('input[name=target][value=new]').checked=selected==='new';
  const list = state.conversations.filter(c => c.title?.toLowerCase().includes(search));
  $('#conversations').innerHTML = list.length ? list.map(c => `<label class="conversation"><input type="radio" name="target" value="${esc(c.id)}" ${selected === c.id || !selected && c.bound ? 'checked' : ''}><span class="conversation-content"><span class="conversation-title">${esc(c.title || '未命名会话')}</span><span class="conversation-meta">${esc(c.id.slice(0,8))} · ${c.state === 'idle' ? '空闲' : esc(c.state)}</span></span>${c.bound ? '<span class="badge good">已绑定</span>' : c.suggested ? '<span class="badge">候选</span>' : ''}</label>`).join('') : '<div class="empty">暂无匹配会话</div>';
  updateTarget(); icons();
}
function updateTarget() {
  const id = $('input[name=target]:checked')?.value || 'new';
  state.target=id;
  $('#target-status').textContent = id === 'new' ? '新建会话' : '已有会话 · ' + (state.conversations.find(c=>c.id===id)?.title || id.slice(0,8));
}
function receipt() { return state.handoffs.find(h=>h.id===state.selectedReceipt) || state.handoffs.find(h=>h.taskId===state.selectedTask) || state.handoffs[0]; }
function renderReceipt() {
  const h = receipt(); const node = $('#receipt'); node.className = h ? '' : 'empty';
  if (!h) { node.textContent = '暂无交接记录'; return; }
  node.innerHTML = `<div class="receipt-top">${badge(h.status)}<span class="small muted-text">WorkBuddy AI</span></div><strong>${esc(h.taskTitle)}</strong><div class="receipt-id">${esc(h.id)}</div><div class="receipt-time">${esc(time(h.updatedAt))}</div>${h.error ? `<p class="error">${esc(h.error)}</p>` : ''}<div class="receipt-actions"><button class="secondary" data-action="open" data-conversation="${esc(h.conversationId)}" title="打开目标聊天"><i data-lucide="external-link"></i>打开会话</button><button class="icon" data-action="check" data-id="${esc(h.id)}" title="检查回复" aria-label="检查回复"><i data-lucide="refresh-cw"></i></button>${['accepted','unknown','needs-info','pending','reply-unconfirmed'].includes(h.status) ? `<button class="icon" data-action="resolve" data-id="${esc(h.id)}" title="记录人工处理结果" aria-label="记录人工处理结果"><i data-lucide="square-check"></i></button>` : ''}</div>${h.receiptMeaning ? `<p class="meaning">${esc(h.receiptMeaning)}</p>` : ''}${h.resolution ? `<p class="meaning">${esc(h.resolution)} · ${esc(h.resolutionMeaning)}</p>` : ''}<div class="reply">${esc(h.reply || '尚无已确认的回复')}</div>`;
  icons();
}
function renderHistory() {
  $('#history-list').innerHTML = state.handoffs.length ? state.handoffs.map(h=>`<div class="history-row"><div><strong>${esc(h.taskTitle)}</strong><span class="small muted-text">${esc(time(h.createdAt))} · ${esc(h.source.application)} → WorkBuddy</span></div><div class="history-actions">${badge(h.status)}<button class="icon" data-action="show" data-id="${esc(h.id)}" title="查看回执" aria-label="查看回执"><i data-lucide="arrow-up-right"></i></button></div></div>`).join('') : '<div class="empty">暂无交接记录</div>'; icons();
}
function renderAdapter() {
  const c = state.connection || {};
  $('#adapter-detail').innerHTML = `<table class="adapter-table"><tbody><tr><th>客户端</th><td>WorkBuddy AI</td></tr><tr><th>连接状态</th><td>${c.connected ? '<span class="badge good">已连接</span>' : esc(c.reason || '未连接')}</td></tr><tr><th>已验证版本</th><td>Windows · 5.9.4</td></tr><tr><th>安装位置</th><td>${esc(c.executable || '未发现')}</td></tr><tr><th>本机端点</th><td>${esc(c.endpoint || '未启用')}</td></tr><tr><th>连接方式</th><td>客户端本地 SDK / CDP · 非官方外部接口</td></tr><tr><th>执行归属</th><td>协议约定，不提供系统级文件互斥</td></tr></tbody></table><div class="capabilities">${['会话列表','可见聊天','新建会话','发送说明','读取回复','交接回执'].map(s=>`<span class="badge good">${s}</span>`).join('')}<span class="badge">来源上下文由 Agent 提供</span></div>`;
}
function tab(name) { document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==name); document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name)); }
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#new-task').onclick=()=>$('#task-dialog').showModal();
$('#search').oninput=renderConversations;
document.addEventListener('change', e=>{if(e.target.name==='target')updateTarget();});
$('#task-select').onchange=()=>{state.selectedTask=$('#task-select').value;state.selectedReceipt=null;renderTask();renderReceipt();loadConversations().catch(e=>notice(e.message));};
$('#refresh-connection').onclick=e=>busy(e.currentTarget,async()=>{await loadConnection();await loadConversations();});
$('#connect').onclick=e=>busy(e.currentTarget,async()=>{await api('connect',{});await loadConnection();await loadConversations();});
$('#refresh-conversations').onclick=e=>busy(e.currentTarget,loadConversations);
$('#refresh-history').onclick=e=>busy(e.currentTarget,loadState);
$('#task-form').onsubmit=e=>{e.preventDefault();busy($('#task-form button[type=submit]'),async()=>{const data=Object.fromEntries(new FormData(e.target));
  for(const k of ['constraints','decisions','completed','remaining','evidence'])data[k]=data[k].split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean);
  data.source={application:data.application,conversationId:data.conversationId};delete data.application;delete data.conversationId;
  const task=await api('tasks',data);state.selectedTask=task.id;state.selectedReceipt=null;$('#task-dialog').close();e.target.reset();await loadState();await loadConversations();});};
$('#preview').onclick=e=>busy(e.currentTarget,async()=>{const p=await api('preview',{taskId:state.selectedTask});$('#preview-text').textContent=p.text;$('#preview-dialog').showModal();});
$('#send').onclick=e=>busy(e.currentTarget,async()=>{const target=$('input[name=target]:checked')?.value||'new';
  const h=await api('send',{taskId:state.selectedTask,...(target==='new'?{createNew:true}:{conversationId:target})});
  state.selectedReceipt=h.id;await loadState();await loadConversations();notice(h.status==='unknown'?'发送结果未知，请检查回执；不会自动重发':h.status==='failed'?h.error:'交接已记录');});
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;
  if(a==='show'){state.selectedReceipt=b.dataset.id;tab('workspace');renderReceipt();return;}
  if(a==='resolve'){state.resolveId=b.dataset.id;$('#resolve-dialog').showModal();return;}
  busy(b,async()=>{if(a==='open')await api('open',{conversationId:b.dataset.conversation});if(a==='check'){await api('check',{id:b.dataset.id});await loadState();}});});
$('#resolve-form').onsubmit=e=>{e.preventDefault();busy($('#resolve-form button[type=submit]'),async()=>{await api('resolve',{id:state.resolveId,note:new FormData(e.target).get('note')});$('#resolve-dialog').close();e.target.reset();await loadState();});};
let polling=false;
setInterval(async()=>{if(polling||document.hidden)return;const h=receipt();if(!h||!['pending','sending'].includes(h.status))return;polling=true;try{await api('check',{id:h.id});await loadState();}catch{}finally{polling=false;}},6000);
(async()=>{icons();try{await loadState();await loadConnection();await loadConversations();}catch(e){notice(e.message);}})();
