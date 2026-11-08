# Security / 安全说明

## Preview Scope / 预览范围

Only the current preview is maintained on a best-effort basis. No security audit
or stable compatibility guarantee is claimed. Use the same trusted OS account
for the source and recipient; client access can expose sensitive conversations
and can cause real actions through the recipient agent.

当前仅尽力维护最新预览版本，未宣称通过完整安全审计或稳定性认证。
来源和接收方应在可信的同一系统用户下运行；接入客户端会接触聊天信息，
接收方还可能按任务执行真实操作。

## Data / 数据

Task packets and receipts are local, not encrypted at rest. Do not include secrets
or unrelated private conversations. Secret-pattern checks are incomplete. Local
HTTP/CDP endpoints must remain loopback-only and must not be exposed publicly.
No package modification or authentication/debugging-protection bypass is part
of the supported workflow.

本机任务和回执没有静态加密，不应传递密钥和无关隐私，模式检查无法完整
脱敏。本机 HTTP/CDP 端点不得映射公网。支持流程不包含修改客户端安装包、
绕过认证或调试保护。

## Reporting / 报告方式

Use GitHub's private vulnerability reporting when enabled for this repository.
If it is unavailable, open a minimal issue asking for a private reporting channel
without disclosing sensitive details. Do not test against other users' clients
or accounts, or attach real credentials or private histories.

优先使用仓库启用的 GitHub 私密漏洞报告；若不可用，只开一个请求私下
联系的简短 issue，不公开敏感细节。不要测试他人客户端或账号，不附真实
凭据和私人聊天记录。目前不承诺固定响应时间，也未设立现金赏金计划。
