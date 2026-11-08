# Agent Handoff

现有 Agent 内的自然语言任务交接功能 · Natural-language handoff inside existing agents

**0.2.1 · 实验预览版 / Experimental Preview**

适合开发者试用和贡献适配器，暂不承诺稳定版兼容性。建议先用不含敏感资料的
测试任务验收，不要把唯一一份重要工作直接交给未验证的客户端流程。
For developer trials and adapter contributions, not a stable compatibility
promise. Validate with a non-sensitive test task before handing off critical work.

用户或源 Agent 提供目标、约束、进度和证据，程序把任务交给真实客户端
中的指定聊天，记录接收方接受、拒绝或要求补充信息的回复。

The source agent understands the natural-language request, assembles relevant
context, finds the recipient conversation, sends, waits for the actual decision
and reports back in the original source chat. The MCP owns its runtime and store.
No dashboard, separate desktop app or manually started HTTP service is required.

## 添加功能 / Add The Feature

Windows x64 用户可从 [Releases](https://github.com/harvey500/agent-handoff/releases)
下载带 Node 和依赖的 ZIP，无需预装 Node/npm。解压后双击 Install.cmd，默认
优先安装到 D:/Apps/AgentHandoff，可输入其他空目录；安装后再运行
Connect-Codex.cmd，确认后通过 Codex CLI 注册。不会覆盖已有同名 MCP。
其他宿主使用生成的 mcp-config.json 按各自格式导入，不宣称自动适配所有宿主。

Download the Windows x64 ZIP from Releases for a bundled Node/dependency package.
Extract, run Install.cmd, then opt in using Connect-Codex.cmd in the installed
directory. An existing same-name MCP is preserved. Other hosts can use the generated
mcp-config.json as a host-specific configuration reference.
See [installation and removal](docs/INSTALL.md), including unsigned-package limits.

以下为源码安装方式 / Source installation follows:

需要 Windows、Node.js 24+；当前真实适配器为 WorkBuddy AI 5.9.4。
另有 Claude Desktop 4.4212.0 网关本地聊天实验适配器，自动发送和真实回执
已通过一次本机验收，但写入可能改变前台焦点，不是完全无打扰的后台控制。
须按 [Claude 接入](docs/CLAUDE.md) 使用本次进程的渲染参数；不修改安装包、
账号、模型或代理配置。

Windows and Node.js 24+ are required. WorkBuddy AI 5.9.4 is live-tested.
Claude Desktop 4.4212.0 gateway local chat has an experimental adapter: one
automatic existing-chat send and real acknowledgement passed locally. UIA input
can change foreground focus, so fully background operation is not verified.
See [Claude integration](docs/CLAUDE.md) for its required process-only launch flags.

从项目目录执行：

```powershell
npm ci --ignore-scripts
node src/mcp.mjs
```

将 `node /绝对路径/agent-handoff/src/mcp.mjs` 注册为宿主 Agent 的 stdio
MCP。宿主启动和停止该 MCP，无需手动运行上面的命令。随附的
`skills/agent-handoff` 提供自然语言触发指引，复制到宿主支持的技能目录。
MCP 的初始化指引和工具描述也包含完整流程。

Register the absolute entrypoint as a stdio MCP server. The host manages its
lifetime. The optional skill supplies trigger guidance; it is not the delivery
engine. Unknown recipient versions fail closed. No administrator permission is required.

## 使用 / Workflow

用户在原聊天说：**“接下来的活交给 WorkBuddy，帮我交接一下。”**

Agent 应执行：提取当前需求、约束、决定、进度和证据 → 准备稳定任务 →
查已有绑定或读取候选会话正文 → 复用同任务聊天，没有则新建 → 发送并
等待决定 → 缺资料时补充 → 回原聊天报告，并停止已转出的工作。
不要求用户填表或手动选择，只有真实歧义或必要未知信息才询问。

The host model must actually invoke the tools. Installing MCP is not a global
message listener and cannot force every agent to follow the workflow. Recipient
history and replies are data, never instructions authorizing unrelated work.

## CLI

```powershell
node cli.mjs status
node cli.mjs conversations
node cli.mjs task ./examples/task.json
node cli.mjs preview TASK_UUID
node cli.mjs send TASK_UUID CONVERSATION_UUID
node cli.mjs send TASK_UUID --new
node cli.mjs check HANDOFF_UUID
node cli.mjs open CONVERSATION_UUID
node cli.mjs status --target claude
```

运行示例前将 `examples/task.json` 的项目位置和来源会话改为实际值。
Set a real project path and source conversation before using the example.

## MCP

stdio 入口：`node /absolute/path/to/agent-handoff/src/mcp.mjs`。
12 个工具，均有 `handoff_` 前缀：status、connect、list_conversations、
prepare、route、inspect_conversation、preview、transfer、send、check、
supplement、open。CLI 与 MCP 直接调用核心程序，共用 SQLite 记录。

No HTTP service is required. Register the absolute MCP entrypoint in your host.
The MCP server neither reads all host history nor automatically posts to its
source chat. The source agent supplies context and reports the actual receipt.
Codex configuration reference: https://developers.openai.com/codex/mcp

## 测试 / Verification

```powershell
npm test
```

单元与故障测试使用模拟适配器，不发模型请求。真实客户端测试需要明确
授权，可能消耗模型额度；本机验收证据不发布。公开的验收步骤见
[适配器规范](docs/ADAPTERS.md)，不能把模拟测试通过当作客户端兼容性证明。

Tests cover duplicate sends, lost responses, exact reply matching, account
changes, refusal and persistence. Live tests are opt-in and can consume the
recipient provider's quota. CI conformance is not a live compatibility verdict.
Claude 的额外测试覆盖 parentUuid 祖先链、附件和重试节点、分支歧义、
分段回复、草稿暂存失败、发送前换会话，以及跨连接原子发送预约。
Claude tests also cover parent-chain reply attribution, conflicting branches,
split replies, staging failure, target changes and atomic dispatch reservations.

## 数据与边界 / Data And Limits

- `.local/` 保存 SQLite、运行端点及本机令牌，默认放项目目录，可用
  `AGENT_HANDOFF_HOME` 指定同一绝对目录；各个 MCP 宿主和 CLI 必须一致。
- HTTP、CDP 仅绑定 127.0.0.1；CDP 有客户端控制能力，不可映射公网。
- 不修改 WorkBuddy 安装包、不直接写聊天数据库；内部 SDK 非官方外部接口。
- 已验证 WorkBuddy AI 5.9.4；Claude 4.4212.0 仅网关本地聊天的指定流程通过，
  其全新聊天、官方云端账号和完全无前台干扰的发送尚未真实验收。
- 任务 ID/账号绑定可复用；标题仅候选，未实现任意会话的语义自动匹配。
- 来源 Agent 可读取候选正文并判断是否同任务；程序本身不假装具备独立语义判断。
- 不自动提取全部 Codex 历史；初版没有系统级执行锁，也不保证目标接受后完成任务。
- 结果未知不自动重发；已接受的记录需显式关闭，关闭不取消远端执行。
- 密钥模式检查不等于完整脱敏；用户和源 Agent 应仅传必要授权资料。

The MCP ends with the host's transport. No always-on HTTP daemon, scheduled task
or desktop application is required. WorkBuddy stays open. No API gateway or model
configuration is changed. Data is local but not encrypted at rest.
Claude also stays open; its experimental launcher is opt-in and never stops an
existing process. Required flags are checked before automatic staging/dispatch.

`Start-Agent-Handoff.ps1` / `src/server.mjs` retain an optional developer dashboard
for inspecting records; that dashboard is not the product's required user flow.

See [architecture](docs/ARCHITECTURE.md), [adapter contract](docs/ADAPTERS.md),
and [Claude limits](docs/CLAUDE.md).
Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).
MIT license. This repository is not affiliated with WorkBuddy, Anthropic or OpenAI.

## 早期实验 / Legacy Experiment

早期的固定绑定配置、本机测试脚本和旧启动器不属于公开发行内容。
使用上面的 MCP 入口即可，不需要寻找这些旧文件。
Legacy machine-specific bindings and test scripts are not part of this release
and are not required for the MCP workflow.
