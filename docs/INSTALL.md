# Install / 安装

## Windows x64 Package / Windows x64 包

Download AgentHandoff-0.2.1-windows-x64.zip and SHA256SUMS.txt from the same
[release](https://github.com/harvey500/agent-handoff/releases). Compare the ZIP's
SHA-256, extract it, and run Install.cmd. Node24.20.0 and locked dependencies are
included; Node/npm and administrator rights are not required for normal use.
This is a ZIP with install scripts, not a signed EXE/MSI installer.

下载同一发行版的 ZIP 和 SHA256SUMS.txt，核对 SHA-256 后解压，运行
Install.cmd。内置 Node24.20.0 和锁定依赖，不需要预装 Node/npm 或管理员
权限。这是带安装脚本的 ZIP，不是经过代码签名的 EXE/MSI 安装器。

~~~powershell
Get-FileHash ./AgentHandoff-0.2.1-windows-x64.zip -Algorithm SHA256
~~~

Use only the official repository's release. The package is unsigned; Windows or
your organization may restrict scripts. Inspect scripts or use source installation
instead of disabling antivirus, SmartScreen or organization controls.

仅从本项目仓库下载。未签名包可能被系统或组织策略限制；可检查脚本或改用
源码安装，不应关闭安全软件、SmartScreen 或组织策略。

Install.cmd prompts for a directory. It prefers D:/Apps/AgentHandoff when D: exists,
otherwise the current user's local Programs directory. It refuses an existing
destination and linked paths. Choose a separate empty/new location for each version;
in-place upgrade and automatic migration are not implemented.

安装时可输入目录，存在 D 盘就优先 D:/Apps/AgentHandoff，否则使用当前用户
的 Programs 目录。已有目录、链接路径会拒绝安装，避免覆盖。每个版本请用
单独新目录；暂未实现原地升级和自动数据迁移。

## Host Connection / 接入宿主

After installation, run Connect-Codex.cmd from the installed folder. It asks before
using the installed Codex CLI to add one MCP entry to the active CODEX_HOME.
No same-name entry is overwritten. If Codex CLI is not on PATH, use:

安装后在安装目录运行 Connect-Codex.cmd，确认后用本机 Codex CLI 给当前
CODEX_HOME 添加一个 MCP 条目，不覆盖同名配置。如果 PATH 中没有 CLI：

~~~powershell
./runtime/node.exe ./scripts/setup.mjs connect --codex C:/Path/To/codex.exe
~~~

Reload tools or restart the host yourself when needed. Installation does not
restart agents, change model/gateway settings, send a chat, install recipient
applications or grant automatic tool permissions. The bundled skill is optional;
the MCP initialization also provides natural-language guidance.

需要时自行重新加载工具或重开宿主。安装器不重启 Agent、不改模型/网关，
不发送聊天、不安装接收方软件，也不授予自动工具权限。随附 skill 可按宿主
规则另行安装，MCP 初始化本身也带自然语言指引。

Other MCP hosts: adapt mcp-config.json using the host's actual configuration format.
It contains absolute paths to the bundled runtime/entrypoint and the local data
directory. It is a reference, not a universal import format. Copying JSON alone is
not proof that a host loaded the MCP.

其他 MCP 宿主按自身格式使用 mcp-config.json，其中包含运行时、入口及数据的
绝对路径。它不是所有宿主通用的导入文件；写入不等于宿主已成功加载。

## Remove / 卸载

Use Disconnect-Codex.cmd in the same CODEX_HOME first, then Uninstall.cmd. Only
unchanged, manifest-owned program files are deleted. Task data under .local/,
unrelated files and modified program files remain. A recorded host registration
blocks uninstall until explicitly disconnected. No recipient chat is deleted.

先在相同 CODEX_HOME 下运行 Disconnect-Codex.cmd，再运行 Uninstall.cmd。
只删除清单中未被修改的程序文件，保留 .local/ 任务数据、无关文件和用户改动。
记录中的宿主连接未断开时会阻止卸载；不会删除接收方聊天。

Close hosts using this installation before uninstalling. Do not force-kill agents.
If files are locked, close the relevant program normally and retry after checking
the remaining files. If modified files remain, ownership records also remain.

卸载前正常关闭使用此安装目录的宿主，不强制结束进程。文件占用时先正常
退出相关程序，核对残留后再试。存在被修改文件时也会保留归属记录。

## Build / 构建

On Windows x64 with Node24 and npm installed:
在装有 Node24/npm 的 Windows x64 上：

~~~powershell
npm ci --ignore-scripts
node scripts/build-windows.mjs
~~~

The builder uses a clean locked dependency install, checks the pinned official
Node executable SHA-256, includes Node/dependency licenses, runs tests under the
bundled runtime and writes a ZIP plus SHA256SUMS.txt into ignored dist/.
An existing Node executable may be supplied with --node PATH but must match the
same official checksum. Release manifests check accidental damage, not authenticity
against an attacker who can replace both the manifest and package.

构建器使用干净锁定安装，核对固定版本官方 Node 的 SHA-256，附带许可证，
用内置运行时跑测试，输出 ZIP 与校验文件到不入 Git 的 dist/。
可用 --node PATH 指定已有官方二进制，但仍须匹配校验和。清单可检查意外
损坏，不能抵御同时替换包与清单的攻击者。
