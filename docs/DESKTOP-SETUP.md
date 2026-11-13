# Desktop Setup / 桌面接入

## Independent Runtime / 独立运行

Each participating source loads the same installed stdio MCP and trusts it
through its own UI. It can then route, send, check and report a handoff without
Codex running delivery scripts on its behalf. There is no required dashboard,
central model account or cloud service. Receiving clients must remain available.
This does not make the feature independent of desktop clients, user approvals,
model quota or operating-system sessions. ACK is not task completion.

各来源宿主加载同一安装目录的 MCP，并在自身界面信任它，之后即可自行完成
路由、发送、查回执与回报，不依赖 Codex 代跑脚本。无需额外网页或云服务，
但接收客户端必须在线；不脱离客户端、授权、模型额度或系统会话运行。

Use the absolute bundled Node and MCP entrypoint from mcp-config.json. All
hosts must use the same AGENT_HANDOFF_HOME, including the DSH bridge directory
below. Do not copy connection.json tokens or another client's caller metadata.
The installer does not download or log in to recipient applications.

使用安装器生成的绝对 Node、入口与共享数据目录。所有宿主及 DSH 桥接必须
指向同一个 AGENT_HANDOFF_HOME。不要复制连接令牌或借用其他客户端来源身份。

## WorkBuddy And Claude / WorkBuddy 与 Claude

WorkBuddy AI 5.9.4: import the MCP in the actual desktop profile, trust and
enable the connector. Enable an explicit loopback-only desktop debugging
connection if needed; never expose it to the LAN or Internet. Discovery checks
the running process and version. A separate CLI config is not desktop loading.

WorkBuddy 在真实桌面配置导入、信任并启用 MCP，需要时显式开放仅限本机
的桌面连接，禁止映射公网或局域网。CLI 配置不能代替桌面加载验证。

Claude gateway 4.4212.0: identify the active gateway profile rather than assuming
the standard Claude config path. Register the same MCP there. Use the provided
Start-Claude-Handoff.ps1 only at an authorized idle restart; see
[CLAUDE.md](CLAUDE.md). Keep the window restored and the desktop unlocked.
Official cloud profiles are not verified; UIA can take foreground focus.

Claude 须核对真实网关配置目录，授权空闲重启后使用所需启动参数。保持非
最小化、未锁屏；发送可能改变焦点，不支持声称完全无打扰后台控制。

## Qoder

Qoder desktop 0.4.9: import the MCP in Extensions > Connectors. On the tested
version the desktop mcpServers section lives in ~/.qoder/settings.json, not
the separate CLI config. Preserve unrelated settings and verify loaded tools.

Qoder 桌面版本通过“扩展 > 连接器”导入；已测桌面配置位于 settings.json，
不是单独 CLI 配置。保留其他设置，并在宿主核对工具已加载。

The recipient adapter requires Qoder to be started with an opt-in loopback
debugging port. At an idle point, close Qoder normally and start its actual
executable with these arguments (choose an unused local port):

接收适配器需要显式启用本机调试端口。空闲时正常退出后，给真实可执行文件
添加以下参数，选择未占用端口。不强制结束程序，不禁用安全机制：

~~~text
--remote-debugging-address=127.0.0.1 --remote-debugging-port=9241
~~~

The adapter discovers the running desktop, checks its version/account, and
refuses drafts, busy targets and duplicate reservations. It does not create
a substitute CLI session. Other Qoder versions require separate validation.

适配器检查真实桌面、版本、账号、草稿、忙碌和重复预约，不另起 CLI 冒充。

## DeepSeek Harness / DSH

DSH 0.2.2-rc.1 uses its native Cordis profile patch. Identify the active desktop
profile and back it up. Merge the following insert entry into its existing
top-level patch list, preserving models, credentials and all other entries.
Replace every example path with your own absolute installation/data paths.
Do not paste a second whole document over an existing profile.

DSH 使用真实桌面配置的 Cordis 补丁。先识别活动配置并备份，只合并 insert
条目，不覆盖已有模型、凭证及其他插件。示例路径全部换成自己的绝对路径。

~~~yaml
- insert:
    - id: agent-handoff-desktop-bridge
      name: 'file:///D:/Apps/AgentHandoff/src/deepseek-bridge.mjs'
      config:
        directory: 'D:/Apps/AgentHandoff/.local/deepseek-bridge'
        credentialFile: 'C:/Users/YOUR_NAME/.dsh/.credentials.yaml'
    - id: agent-handoff-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: agent-handoff
        command: 'D:/Apps/AgentHandoff/runtime/node.exe'
        args:
          - 'D:/Apps/AgentHandoff/src/mcp.mjs'
        env:
          AGENT_HANDOFF_HOME: 'D:/Apps/AgentHandoff/.local'
        cwd: 'D:/Apps/AgentHandoff'
~~~

credentialFile is a local existing DSH credential file, never its secret contents.
Only its digest is used as a local profile epoch. It is not cloud account
verification. The plugin's private pipe does not copy login cookies or expose
TCP. Continue-mode requires executionReady and the host's normal approvals.
Reload through the host at an idle point. Visible-chat activation is unsupported.

credentialFile 只填写已有本地凭证文件路径，不填秘密内容。只用其摘要作为
本地配置代际，不等于云账号认证。插件不复制 Cookie、不开放 TCP，实际
执行仍需宿主权限。空闲时重载；不支持自动切换可见聊天。

## Codex Inbound / Codex 接收

On a new installed registration, use setup.mjs connect --enable-inbound as
documented in [INSTALL.md](INSTALL.md). Default registration does not enable
it. Only Codex should set AGENT_HANDOFF_CODEX_INBOUND=1. After tools reload,
a real Codex chat invokes a handoff tool to establish an owner with its native
caller metadata. Missing metadata never falls back to a shared fixed chat ID.

新安装接收功能须明确选择 --enable-inbound，且只加在 Codex 宿主。重载工具
后，在真实聊天调用一次交接工具建立所有者；缺原生身份时不能借用固定来源。

The private owner closes with MCP stdin/transport; it is not a detached daemon.
An existing owner, lock or legacy descriptor is refused rather than overwritten.
Inspect stale state before any cleanup. Host restart, changed pipes and existing
receipt migration still require reconciliation. This machine's 20 ACK tests
used a temporary helper; isolated managed-owner lifecycle checks passed, but
the installed host migration remains a separate acceptance step.

私有接收随 MCP 退出，不是独立守护程序；遇到已有所有者或旧描述就拒绝
覆盖。过期状态先核查再清理。宿主重启与旧回执迁移须单独处理。本机 20
方向测试使用临时桥接，隔离托管生命周期已过，但不代替活动宿主迁移验收。
