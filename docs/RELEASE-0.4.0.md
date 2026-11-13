# v0.4.0 Windows x64 Preview

## Changes / 更新

- Five desktop adapters: Codex, WorkBuddy AI, Claude gateway, Qoder desktop and
  DeepSeek Harness. / 接入五种真实桌面客户端，不用 CLI 会话冒充桌面。
- Read-only doctor, capability gates, source exclusion, durable receipts and
  send-once protection. / 只读诊断、能力预检、来源排除、持久回执及防重发。
- Native DSH plugin and opt-in managed Codex inbound with stdin-EOF cleanup.
  / DSH 原生插件、Codex 可选托管接收及宿主退出清理。
- Explicit installer --enable-inbound option and bilingual desktop setup guide.
  / 安装器显式接收开关与双语接入步骤。

## Verification / 验证

133 automated tests passed on Windows, including bridge ownership, fragmented
UTF-8, account/draft/busy checks and simulated MCP disconnect. All 20 directed
cross-client paths have local exact-ID ACK evidence; external source hosts used
their own loaded MCP. Some Codex-origin tests used an authorized source script.
One bounded Codex-to-DSH execution test produced the required temporary file.

Windows 自动化测试 133 项通过。20 个跨客户端方向都有准确确认，四种外部
来源真实调用自身 MCP。部分 Codex 来源验收由授权会话脚本发起。另有一项
DSH 限定执行文件结果验收；未做所有方向任意项目的执行验收。

## Limits / 边界

Independent MCP feature, not a standalone AI or unattended compatibility promise.
Each host must load/trust the tools; recipients must be online. Claude must be
restored on an unlocked desktop and may change focus. Codex inbound is explicit:
an authorized real Codex tool call starts the owner after reload. The 20-path live
tests used a temporary Codex helper; isolated managed lifecycle passed, while
installed-host migration/restart acceptance remains pending. DSH latest server
UTF-8 fix needs safe plugin reload on the test machine. ACK is not task completion.

独立 MCP 功能，不是脱离宿主的 AI，也不承诺无人值守。接收端需在线、工具
需信任并加载。Claude 需非最小化、未锁屏且可能抢焦点。Codex 接收须显式
启用并在重载后真实调用工具建立所有者；活动宿主迁移和重启验收仍未完成。
DSH 测试机需安全重载采用最新修复。确认不等于任务完成。

## Install / 安装

Download AgentHandoff-0.4.0-windows-x64.zip and SHA256SUMS.txt together.
Verify SHA-256, extract, run Install.cmd, then explicitly connect each host.
Bundled Node 24.20.0 and locked dependencies; no Node/npm prerequisite.
Unsigned ZIP/scripts, not EXE/MSI. New directory only, no in-place upgrade.
Read docs/INSTALL.md, docs/DESKTOP-SETUP.md and docs/COMPATIBILITY.md first.

下载 ZIP 与校验文件，核对 SHA-256 后解压运行 Install.cmd，再按说明连接
各宿主。内置 Node 和锁定依赖，未签名 ZIP 脚本安装器，不是 EXE/MSI。
每版用新目录，不覆盖旧安装、聊天或模型配置。
