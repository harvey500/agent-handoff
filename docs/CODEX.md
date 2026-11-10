# Codex Desktop / Codex 桌面会话交接

Included in the v0.3.0 Windows package; not included in the old v0.2.1 installer.
v0.3.0 安装包已包含，旧 v0.2.1 不包含。

## Connection / 连接

Run from Codex Desktop with CODEX_APP_TOOLS_PIPE_PATH and per-call thread
metadata (x-codex-turn-metadata or a supported thread ID field). The channel
uses bounded length-prefixed JSON-RPC frames. This desktop integration is not a
public stable API guarantee. No second app-server, model API substitution,
shared TCP listener, UI injection or chat-database write is used.

使用桌面给出的本机工具管道和每次调用的来源会话身份。直接命令行测试可继承
CODEX_THREAD_ID；共享 MCP 不能用启动时的固定会话身份代替其他会话。当前仅
Windows 本机 Codex 聊天，不支持 ChatGPT、远程主机。缺通道或身份则停止。

## Workflow / 流程

Prepare with source.adapter=codex and the actual source ID. List and route with
taskId to exclude the source. Inspect candidate content. Send to existing chats
through send_message_to_thread without a model override. Send does not navigate
or edit composers, so drafts are not overwritten. The recipient is checked idle
immediately before dispatch, but simultaneous user activity is not locked out.

New chats require explicit user authorization. Creation is deferred until send
because create_thread starts generation: submit the full packet once, not a
second duplicate prompt. Explicitly select gpt-6.1-sol, never inherited Astra.
Create a projectless local chat with the project path in the packet; this does
not grant file access or move the source project. A recipient lacking access
must request information rather than claim it can execute.

新聊天固定 Sol；已有聊天不改模型。发送不跳转界面；handoff_open 才展示聊天。
用户未明确允许新建且没有合适会话时，先询问。交接摘要不等于复制全部历史。

## Receipt / 回执

Delegation can be stored as functionCallOutput, not userMessage. The read-only
fallback locates the exact rollout via state_5.sqlite, confines it to active
sessions, checks session ID and reads at most a 2 MB tail. A matching codex_app
delegation must have the exact item ID, turn ID, source, marker and packet SHA256
from a local dispatch reservation. Replies must belong to that completed turn.
Reasoning and unrelated tool output are never an acknowledgement.

缺记录、格式变化、超出读取窗口、创建超时未返回实际编号时保留 unknown，不重发，
不通过标题或预览认领。只检查最近十轮；很旧的交接可能需要人工核对。

Identity is a local profile plus desktop pipe, not a provider account ID. A
desktop restart changing the pipe prevents automatic reuse of old receipts;
reconciliation/migration is not implemented. Do not claim provider-account
isolation or restart migration from this local identity.

## Verification / 验证

On 2026-11-10, one user-authorized new local Codex chat received the packet and
returned a matching acknowledge-only acceptance. This first test inherited
Astra before the user chose Sol. Sol selection is now explicit and tested with
fixtures, not another live model request. Runtime: 0.167.0-alpha.3.2. Other
versions require compatibility checks. Existing-chat send is fixture-tested.

新建聊天到真实确认已实测，不代表实际执行完成。已有聊天发送、项目执行权限、
跨版本和桌面重启迁移尚未真实验收。修正模型选择后没有再消耗测试额度。
