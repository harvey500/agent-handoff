# Desktop Compatibility / 桌面兼容性

## Status / 当前状态

v0.4.0 acceptance snapshot: 2026-11-13, Windows. These changes are not in the
older v0.3.0 package. This is a version-specific experimental result, not
a guarantee for every installation or future client update.

本页记录 2026-11-13 的 Windows v0.4.0 验收，旧 v0.3.0 包没有这些改动。
结果只适用于已测试版本和运行条件，不承诺所有机器或后续版本自动兼容。

## Direction Matrix / 方向矩阵

Rows are sources, columns are recipients. A means a real completed reply with
the exact handoff ID, independently read back. The 20 off-diagonal directions
passed acknowledgement checks. External source hosts used their own loaded
MCP tools; these were not substituted with Codex running a delivery script.

行是来源，列是接收端。A 表示已独立读回匹配交接编号的真实完成回复。
20 个跨客户端方向均取得确认。四种外部来源客户端也均真实调用了各自加载的
MCP 工具，未用 Codex 代跑脚本冒充来源。部分 Codex 发起的验收由其授权
会话执行测试脚本；并非每条都由当前已加载 MCP 进程发起。

| From / To | Codex | WorkBuddy | Claude | Qoder | DSH |
| --- | --- | --- | --- | --- | --- |
| Codex | S | A | A | A | A |
| WorkBuddy | A | S | A | A | A |
| Claude | A | A | U | A | A |
| Qoder | A | A | A | U | A |
| DSH | A | A | A | A | S |

S = a separate same-client, different-chat acknowledgement test exists.
U = no live same-client test. Same-client results are not counted in the 20.
Self-delivery to the source conversation is always refused.

S 为另行测试过的同客户端不同会话确认；U 为该项未实测。对角线不计入 20
个跨客户端方向，且不允许发回来源会话本身。WorkBuddy 的早期同客户端
测试使用过临时发现端点，默认发现修复后只做了只读回归，未重复发送。

ACK is not task completion. One bounded Codex-to-DSH continue-mode test wrote
a specified marker to a temporary file, which was independently checked.
Arbitrary development execution across all 20 directions has not been tested.
One Qoder source test also wrote its own project memory despite the test's
no-file-change constraint; strict no-write compliance is not established.

确认不代表实际工作完成。Codex 到 DSH 的一项限定执行测试已写出指定临时
文件并核对内容，但未做 20 个方向的任意开发任务验收。某次 Qoder 来源
测试还自行写了项目记忆，因此不能宣称所有接收端都严格遵守“不写文件”。

## Runtime Requirements / 运行条件

| Client / 客户端 | Tested / 已测版本 | Transport / 链路 | Important Limit / 重要限制 |
| --- | --- | --- | --- |
| Codex | 0.167.0-alpha.4.1 | Native app-tools and opt-in private inbound pipe / 原生工具与可选私有接收管道 | External sources need a live authorized owner / 外部来源依赖在线授权所有者 |
| WorkBuddy AI | 5.9.4 | Running desktop SDK / 真实桌面 SDK | MCP must be trusted and enabled / 须信任并启用 MCP |
| Claude gateway | 4.4212.0 | Windows accessibility and read-only transcripts / 无障碍控制与只读记录 | Restored, unlocked desktop; may take focus / 非最小化且未锁屏，可能抢焦点 |
| Qoder desktop | 0.4.9 | Opt-in loopback desktop connection / 可选本机桌面连接 | Not a separate CLI session / 不是另起 CLI 会话 |
| DeepSeek Harness | 0.2.2-rc.1 | Opt-in native Cordis plugin / 可选原生插件 | Local profile/credential epoch, not verified cloud identity / 本地配置与凭证文件代际，不是云账号认证 |

The source model must invoke the loaded tools itself. Configuration on disk,
installation, SDK presence or a running app does not prove MCP is trusted or
loaded. WorkBuddy's earlier failure was resolved by the user explicitly trusting
and enabling this connector, then resuming its existing needs-info receipt.

来源模型需要真实调用已加载工具。配置存在、SDK 已装或程序在运行都不等于
MCP 已加载并获信任。WorkBuddy 早期问题已在用户信任、启用连接器后，通过
补充原 needs-info 回执恢复，而非丢弃原记录盲目重发。

Claude requires the process flags documented in [CLAUDE.md](CLAUDE.md). Sending
to a minimized window is rejected before staging. A window minimized after
staging leaves the owned draft/reservation intact and delivery may be unknown.
No automatic restore, unlock, approval or forced restart is implemented.
Official Claude cloud profiles and other client versions are not validated.

Claude 需要指定启动参数。最小化时在暂存前拒绝发送；暂存后才最小化则保留
草稿与预约，可能需要核对未知送达状态。不自动还原、解锁、点权限或强制
重启。官方云端 Claude 账号和其他版本未验收。

DSH existing-chat and continue-mode operations are available only when the
native bridge reports executionReady. Visible-chat activation is unsupported.
The latest server-side fragmented UTF-8 fix is tested in source but still needs
a safe plugin reload on this machine.

DSH 仅在原生桥接报告 executionReady 时开放旧会话与 continue 操作，不支持
自动切换可见聊天。最新服务端 UTF-8 分片修复已在源码验证，本机插件仍需
在空闲时安全重载才能采用。

## Codex Inbound / Codex 接收

The managed implementation opts in with AGENT_HANDOFF_CODEX_INBOUND=1 in the
Codex host only. A real Codex tool call captures its native caller context and
starts the authenticated local Windows pipe. The MCP owns the pipe and closes
it when its transport closes. Other hosts receive limited handoff operations,
not a copied Codex app-tools pipe or caller identity.

托管实现只在 Codex 宿主显式启用。真实工具调用获取原生调用方后建立带认证
的本机管道，由 MCP 随连接清理。其他宿主只能调用限定交接操作，不能获得
复制的 Codex 原始通道或来源身份。同一 Windows 用户持有本地能力令牌即可
访问，不能将此当作密码学宿主认证；本地数据未加密。

**Live migration remains pending:** the 20-direction tests used an explicitly
authorized temporary standalone Codex inbound helper. The managed opt-in is
saved with a backup, but the current host has not reloaded it. Managed startup
now refuses an existing owner or legacy descriptor instead of overwriting it.
Do not claim restart-independent or fully unattended operation yet.

**本机迁移仍未完成：**20 方向测试时 Codex 接收使用授权的临时独立桥接。
托管开关已备份后保存，但当前宿主尚未重载。新实现遇到已有所有者或旧描述
文件会拒绝启动，绝不覆盖。尚不能宣称重启后自动恢复或完全无人值守。

Isolated Windows pipe tests cover duplicate-owner refusal, legacy descriptor
preservation, disconnect cleanup and fresh reconnection. These do not replace
live host restart acceptance. Stale owner files require inspection; automatic
takeover and profile/pipe receipt migration are not implemented.

An isolated MCP process also passed a read-only live app-tools lifecycle check:
its child owned the private bridge, stdin EOF removed both owner files, a new
connection acquired a fresh capability, and missing caller metadata could not
start a bridge. This sent no chat messages and called no model. The full local
automated suite passed 133 tests, including a simulated MCP stdin-EOF regression
and explicit installer inbound registration.

隔离管道测试覆盖重复所有者拒绝、旧描述保留、断开清理与重连，但不代替
真实宿主重启验收。过期所有者文件须先核查，不自动接管；配置或通道变化后
的回执迁移未实现。
另用隔离 MCP 对真实本机工具做了只读生命周期检查：桥接由子进程持有，
标准输入结束会清理所有者文件，重连建立新令牌，无调用方身份时不能启动。
未发送聊天或调用模型。完整自动化测试 133 项通过，含模拟宿主退出和安装器
显式接收配置回归。

## Diagnostics And Reload / 诊断与重载

Run node cli.mjs doctor or call handoff_doctor. It is read-only: no messages
or model calls. Its 36 direction rows include the five clients above plus
unimplemented GitHub Copilot and same-client cases; readiness is not live-test
evidence. Copilot and Antigravity are outside the current acceptance scope.

执行 node cli.mjs doctor 或调用 handoff_doctor，不发消息、不调用模型。
其中 36 项能力组合还包括未接入的 Copilot 和同客户端情况，不能当作实测
矩阵；本轮排除 Copilot 与反重力。

Each host must reload its MCP to use changed modules. Do so at an idle point,
preserving accounts, models, keys, drafts and other connectors. An error after
dispatch can mean delivery is unknown: inspect the original receipt, never
blindly resend. Host permission prompts remain the user's decision.

各宿主需要在空闲时重载 MCP 才会采用新模块，保留账号、模型、密钥、草稿
及其他连接器。发送后报错可能是未知送达，须查原回执，禁止盲重发；权限
确认由用户决定。

Use node register-mcp.mjs --file ABSOLUTE_EXISTING_JSON for a preview, then
--apply after verifying the active profile. It backs up and preserves unrelated
JSON settings; it is not a universal config writer. Codex TOML has its own
registration flow. No local transcripts or private connection descriptors
belong in a source package or GitHub release.

JSON 配置先指定真实活动文件预演，再决定写入。工具会备份并保留其他设置，
不能用于所有宿主格式。Codex TOML 单独处理。本机记录与连接描述文件禁止
进入源码包或公开发行。
