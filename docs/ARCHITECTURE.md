# Architecture / 架构

```text
Source agent's original conversation
     natural-language request
                |
     stdio MCP (host-managed) / CLI
                |
       HandoffService + SQLite
                |
       versioned client adapters
                |
  original WorkBuddy / Claude conversations
```

The MCP owns its core runtime and SQLite connection. It needs no HTTP service,
dashboard or extra desktop shell. A host-provided workflow/skill triggers calls
from the original source conversation. SQLite prevents overlapping active sends
for the same task. The optional dashboard is a developer diagnostic surface only.
MCP 随宿主运行，直接持有核心与数据库；自然语言由来源 Agent 理解并调用。
网页仅为可选诊断入口，不是用户必须操作的产品界面。

Task context is provided explicitly by the source agent/user. This prototype does
not scrape a full Codex history, share credentials or grant hidden new access.
源 Agent 或用户提供任务上下文；此版本不自动采集 Codex 全部历史，不传递凭据。

Handoff transitions: preparing → sending → pending → accepted / declined /
needs-info / reply-unconfirmed. A transport failure may become unknown. The same
task cannot have another active handoff. A completed text response is parsed for
an exact first-line decision and exact handoff UUID. Acceptance is a recipient
claim, not proof of capability or completed work.
交接状态覆盖准备、发送、等待、接受、拒绝、缺资料、回复待确认和结果未知。
接受只代表目标在规定范围内确认，不证明它有所有工具，也不证明任务完成。

An accepted record remains active until explicitly closed. Closing a local receipt
does not cancel the remote agent. The protocol asks the source to yield work; no
OS file lock can constrain every independent client.
已接受的记录继续占用任务，需显式关闭。关闭本机回执不会取消远端执行；执行归属目前靠协议约定。

Known bindings use task ID + adapter + account hash. Titles are suggestions only.
The source model can read bounded candidate text and compare task identity; the
core never pretends a title match proves identity. Unknown outcomes are reconciled by handoff UUID;
they are never automatically resent.
复用按任务、适配器和账号绑定；标题只作为候选提示，不冒充语义匹配。未知结果按交接编号查询，不自动重发。

## Local Access / 本机访问

UI and HTTP API bind to 127.0.0.1. API needs a random bearer token; Host and Origin
are checked. Static pages refuse framing and external scripts. No external fonts,
images, telemetry or model calls are added by this program. WorkBuddy messages
still use WorkBuddy's configured model provider.
服务仅监听本机，API 验证随机令牌、Host 和 Origin。程序不直接调用模型；发给 WorkBuddy 的消息仍使用它原有渠道。

Claude uses Windows UIA and bounded read-only local transcripts instead of CDP.
Draft staging and one-shot dispatch are separate operations with a persistent
reservation. Replies follow parentUuid ancestry; append order is not attribution.
UIA input may change focus even without an explicit foreground API.
Claude 使用 UIA 和限量只读记录；暂存、复核、单次发送由持久预约保护。
回执按祖先链匹配，不按追加顺序猜测；写入可能改变前台焦点。

CDP can control the client and must stay loopback-only. Tokens and transcripts in
the data directory are private local state, excluded from Git. They are not
encrypted by this prototype; another process under the same OS user can access
them. Secret-pattern checks are a limited convenience, not comprehensive redaction.
调试端口只能留在本机。状态目录不入 Git，但当前不加密，不能防同一系统用户的其他进程；密钥模式检查不等于完整脱敏。
