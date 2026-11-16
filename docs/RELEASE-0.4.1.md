# v0.4.1 Windows x64 Preview

## Changes / 更新

- Normalize Codex string/object thread states. idle/notLoaded can proceed to
  final checks; active, errors and unknown states remain blocked.
  / 修复未加载旧聊天被误判忙碌，异常和未知状态仍拒绝投递。
- Exclude the authenticated inbound owner's chat and aliases from candidates
  and reject owner-targeted grants. / 排除接收桥所有者及别名，防止自投递。
- Use native Windows real-path lookup for rollout receipts, retaining active
  session containment. / 修复目录链接和扩展路径解析，保留历史读取边界。
- Accept a trusted local QQ dispatcher with consistent generic owner labels,
  a real source UUID and existing-chat-only grants. No personal identifier is
  hardcoded. / 支持通用 QQ 来源标签，仅投递另一个已有聊天，不写死个人账号。

## Verification / 验证

138 Windows automated tests passed, including negative QQ-label checks,
unloaded/unknown thread states, owner aliases and a junction/extended-path
receipt fixture. Tests do not make paid model calls.
Windows 自动化测试 138 项通过，覆盖来源不匹配、未知状态、所有者别名、
目录链接及扩展路径。不发送付费模型请求。

On 2026-11-16, the local personalized bridge completed one QQ-to-existing-Codex
system-time task: the desktop executed Get-Date/Get-TimeZone and the QQ bridge
reported sending the final result. The published generic-label extension is
regression-tested; no extra live message was sent for this release. Private
receipts, chat history and account settings are not distributed.
11 月 16 日本机个性化桥接完成一次 QQ → 已有桌面 Codex 读取系统时间 →
QQ 回传。公开版通用标签扩展通过回归测试，本次发布未额外发送真实消息；
不公开私人回执、聊天和账号配置。

## Limits / 边界

Experimental Windows integration. QQ sender authentication, allowlists, bot
transport, model defaults and tool isolation remain in the separate QQ bridge.
Matching label text does not authenticate a sender. This package is not a QQ
bot installer and does not grant the QQ model direct computer access.
实验性 Windows 集成；QQ 认证、白名单、机器人通道、模型设置及工具隔离
仍由独立桥接负责。本包不是 QQ 机器人安装器，也不授予 QQ 模型电脑控制权。

Host restart recovery, receipt migration after a changed desktop pipe and
arbitrary tasks across every client remain unverified. Claude still needs a
restored/unlocked desktop and may take focus. Do not overwrite existing live
bridge ownership, silently resend unknown deliveries or auto-approve host prompts.
重启恢复、桌面通道变化后的回执迁移及所有方向任意任务仍未验收。Claude
仍需未锁屏且窗口非最小化。不得覆盖活动所有者、盲重发或自动批准宿主权限。

## Install / 安装

Download AgentHandoff-0.4.1-windows-x64.zip and SHA256SUMS.txt together. Verify
the hash, extract and run Install.cmd into a new empty directory. Connect hosts
explicitly using docs/INSTALL.md and docs/DESKTOP-SETUP.md. Bundled Node
24.20.0 and locked dependencies; unsigned ZIP/scripts, not EXE/MSI.
下载 ZIP 和校验文件，核对 SHA-256 后解压，安装到新的空目录并显式接入宿主。
内置 Node 和锁定依赖，未签名 ZIP 脚本安装器，不是 EXE/MSI；不覆盖旧聊天或配置。
