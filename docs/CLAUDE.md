# Claude Integration / Claude 接入

## Compatibility / 兼容范围

Experimental Windows adapter for Claude Desktop **4.4212.0**, active
**Claude-3p gateway local-chat profile** only. It uses standard Windows UI
Automation to navigate, stage a draft and invoke Send, then reads local
transcripts without writing to them. It does not substitute a CLI conversation
or direct model API for the actual desktop chat.

实验适配器仅面向 Windows Claude Desktop 4.4212.0 的 Claude-3p 网关本地
聊天。使用标准无障碍接口操作真实窗口，只读本机记录核验结果；不把另建的
CLI 会话或直接模型调用冒充桌面聊天，不绕过签名、调试或登录保护。

## Launch / 启动

Quit Claude normally, then run from the project directory:
正常退出 Claude 后，从项目目录执行：

~~~powershell
./Start-Claude-Handoff.ps1
node cli.mjs status --target claude
~~~

The launcher refuses if Claude is already running. It accepts only the validated
version and passes these arguments to this process, without changing settings:

启动器不会终止已有进程，只接受已验证版本。这些参数只作用于本次进程，
不会修改代理、模型、密钥、历史或开机启动项：

~~~text
--force-renderer-accessibility
--disable-renderer-backgrounding
--disable-backgrounding-occluded-windows
--disable-background-timer-throttling
~~~

Without these flags, read-only inspection may still work, but automatic staging
and dispatch stop with an actionable error. The adapter never restarts Claude
automatically. Launching through the ordinary shortcut next time does not retain
the flags. They are an experimentally validated combination, not a proven causal
explanation of the earlier stale UI state.

缺少参数时仍可能读取状态，但自动写入和发送会停止并提示，不自动重启。
下次使用普通快捷方式不会保留参数。当前只验证了这个组合有效，没有证明
哪一个参数是此前界面状态滞后的根因。

## Focus / 焦点限制

No mouse, global keystrokes, SetFocus or explicit foreground activation are used
in the send path. Nevertheless, the tested Claude UIA ValuePattern.SetValue
operation changed the foreground process from another app to Claude. Therefore
**automatic scripted send is supported experimentally; fully non-disruptive
background send is not verified**. Do not promise the latter or change OS focus
restrictions to conceal this limitation.

发送路径不移动鼠标、不模拟全局按键，也不主动调用切前台或 SetFocus。
但实测 Claude 的输入框 SetValue 操作本身会取得前台焦点。因此目前能自动
脚本发送，但不能保证你使用其他软件时完全不受打扰。状态中的
focusMayChange=true 和 fullyBackgroundVerified=false 明确反映这个限制。

## Delivery / 送达核验

1. Check active profile/account, target, existing draft and busy state.
2. Persist an atomic send reservation, then stage exactly one task packet.
3. Independently recheck the target, account and exact committed draft.
4. Invoke the current Send control once. Never auto-retry an unknown result.
5. Require an exact persisted user marker before declaring delivery.
6. Follow parentUuid ancestry through attachments/retries to identify the reply.
7. Accept only a completed visible reply with the exact first-line decision/ID.

先检查账号、目标和草稿，原子预约后暂存，再独立复核并只发送一次。
先有真实用户消息才算送达；沿 parentUuid 祖先链核对回复，不按记录顺序猜。
分支冲突、缺失父节点、进行中回复、思考内容和错误回显不算确认。
发生未知结果时只查询，不自动重发，也不覆盖用户草稿。

## Verification / 当前验收

- 2026-11-08: existing test chat, user-configured DeepSeek channel, one scripted
  send, persisted user message, ancestry-verified real HANDOFF_ACCEPTED reply.
- Same receipt can be read without another send. Confirmation only: recipient
  did not receive permission to run tools or perform development in this test.
- Focus-only draft probe reproduced the foreground change and was cleared by
  exact comparison. No probe was sent.
- New-chat flow, official cloud accounts, other versions and completely
  background operation have not passed live conformance.

2026-11-08 已通过原聊天自动发送和真实回执，使用用户原有 DeepSeek 渠道。
本次只确认收到，不代表接收方完成开发。专用草稿探针未发送，已精确清理。
新建聊天、官方云端账号、其他版本和完全不切焦点仍未真实验收。
Private local evidence is excluded from Git and source packaging.
包含本机信息的验收证据不进入 Git 或发布包。
