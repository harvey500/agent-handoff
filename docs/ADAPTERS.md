# Adapter Contract / 适配器规范

An adapter controls an existing client; it is not a replacement chat engine.
适配器连接原客户端，不把新建 CLI 会话冒充桌面已有会话。

| Operation | Meaning / 含义 |
| --- | --- |
| discover | Installed executable, running process, loopback endpoint / 安装路径、进程、本机端点 |
| status | Actual version, account identity, active conversation / 版本、账号、当前会话 |
| list | Account-scoped conversation IDs, titles, state, pagination / 账号内会话及分页 |
| create | Caller-chosen stable ID, project path, bounded permission / 稳定 ID、项目位置和权限 |
| open | Navigate and confirm the actual visible conversation / 打开并确认真实可见会话 |
| send | Check account, draft and busy state; send through client workflow / 检查账号、草稿、忙碌状态后发送 |
| read | Visible user/assistant text and request state; omit reasoning / 读取正文与状态，不取思考内容 |

## Evidence Levels / 验证等级

- Declared: an adapter claims support; not a compatibility verdict. 声明支持不代表已验证。
- Fixture-tested: recorded shapes and failure handling pass. 脱敏样本测试通过。
- Live-tested: identified client version passes visible session tests. 指定版本真实客户端测试通过。

No generic protocol guarantees all desktop apps support existing-session control.
官方协议也不能自动保证能操作任意客户端的已有聊天框。

WorkBuddy 0.1: Windows, WorkBuddy AI 5.9.4, internal renderer SDK via loopback CDP.
This is an experimental integration, not an officially supported WorkBuddy API.
WorkBuddy 当前适配为实验集成，非官方外部 API。未知版本停止操作，重新验收后才能加入支持范围。

Claude: Windows Desktop 4.4212.0, Claude-3p gateway local chat, standard UIA plus
read-only transcript ancestry verification. Existing-chat automatic send and
receipt passed once; new-chat and fully background operation remain unverified.
Required launch flags and the observed focus change are documented in
[Claude integration](CLAUDE.md). No package/debugging protection is bypassed.

Claude 仅指定版本和网关本地聊天，原聊天自动发送已实测；新聊天和完全后台
控制未验收。写入可能切前台，不能把“不模拟鼠标”描述为“不影响焦点”。

## Required Conformance Cases / 必测场景

1. Exact client and account identification; reject wrong app/version/account. 识别错误时拒绝。
2. List existing chats; open an explicit ID; create a visible chat. 列表、打开和新建真实聊天。
3. Send once; read an explicit matching decision from assistant text. 只发送一次，确认编号与正文。
4. Lost response after delivery; query the record without blind resend. 响应丢失后查询而非重发。
5. Preserve unsent drafts; reject a busy conversation. 保留草稿，忙碌时拒绝发送。
6. Close/restart and re-read the same durable receipt. 重启后读取同一回执。
7. Reject public debugging endpoints and unexpected page paths. 拒绝公网调试和错误页面。

Extensions should supply an adapter, sanitized fixtures, a version matrix, and live test instructions.
新增适配器应提交实现、脱敏样本、版本矩阵和真实验收步骤；维护者不需要安装所有客户端。
