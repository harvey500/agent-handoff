# Host Integration / 宿主接入

Register the absolute stdio entrypoint with an existing Node.js 24 runtime:

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "node",
      "args": ["/absolute/path/agent-handoff/src/mcp.mjs"]
    }
  }
}
```

Use the host's actual MCP config syntax. This JSON is illustrative, not a
universal file format. For Codex, use its MCP settings or `codex mcp add` with
the node executable and MCP entrypoint. No API gateway settings need changing.
根据宿主实际 MCP 配置添加，不能把同一 JSON 原样写进所有 Agent。

Install `skills/agent-handoff` into the host's supported skill folder when
available. MCP initialization instructions and tool descriptions provide the
workflow too. Existing sessions may need a tool reconnect to see new tools.
有 Skill 支持时安装随附触发指引；已有聊天可能需要重新连接 MCP 才能加载新增工具。

## Natural-Language Entry / 自然语言入口

User: 接下来的工作交给 WorkBuddy，你帮我交接一下。

The source agent prepares the current relevant context, routes/inspects target
conversations, transfers once, handles necessary clarification, waits for the
recipient decision and reports it back in the original source chat. It must
stop doing transferred work as the recipient may start before its final reply.
自然语言不需要指定工具名、填写表单或打开独立界面。

## Permissions / 权限

The feature stores task and receipt records and sends messages to another client.
A host that forbids all write/tool operations cannot complete it. In that case,
use the host's normal approval mechanism for the requested handoff. Do not label
write tools read-only, suppress an approval denial, or promise silent execution
under every host policy. Read-only status discovery is not a complete handoff.
功能会写本机回执和向客户端发消息，宿主只读策略可能需要正常授权；
被拦截时如实报告，不能把写工具伪装成只读或跳过审批。

## Tested So Far / 当前验收

- Direct MCP client: no HTTP daemon or UI; real WorkBuddy chat reused, context
  compared, continue-scope subtask delivered, actual artifact independently read.
- Unit tests: routing, stable task identity, receipt resume, needs-info supplement,
  account protection, drafts, cancellation states and process lifetime.
- Clean Codex natural-language test: the agent recognized the handoff request
  and invoked status/prepare. The read-only test host denied the mutating prepare
  call because approvals were unavailable. Full unattended execution in that
  host was not verified. No bypass was attempted.

真实 MCP 链路已完成工作交接；新 Codex 会话自然语言测试触发正确，但
只读宿主在准备写记录时拒绝，因此不能声称该测试完整通过。
WorkBuddy AI 5.9.4 Windows is the tested recipient. Claude Desktop 4.4212.0
gateway local chat now has one live existing-chat automatic-send/receipt pass;
its UIA input can change foreground focus. See [Claude integration](CLAUDE.md).
Other clients and reverse WorkBuddy-to-Codex visible-chat handoff remain unimplemented.

Claude 适配仅原聊天发送已真实验收，需要本次进程的启动参数，且可能取得
焦点。它不是完全无打扰的后台控制，也不代表所有 Claude 账号或版本通用。
