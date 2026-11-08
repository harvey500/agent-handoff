# Contributing / 参与贡献

This is an experimental Windows client integration, not a universal agent API.
这是实验性的 Windows 客户端集成，不是所有 Agent 通用的官方接口。

## Development / 开发

Use Node.js 24+ and install the locked dependencies:
使用 Node.js 24+，按锁文件安装依赖：

~~~powershell
npm ci --ignore-scripts
npm test
~~~

Tests use temporary fixtures and do not send live model requests. For adapters,
include sanitized fixtures and follow [the adapter contract](docs/ADAPTERS.md).
Unit tests do not establish live compatibility. Identify the exact app version,
profile type and verified workflows when reporting a live test.

测试使用临时样本，不发真实模型请求。新增适配器应附脱敏样本并遵循适配器
规范。真实验收请注明客户端版本、账号类型和通过的流程，不能只写“支持”。

## Bug Reports / 问题反馈

Include the project revision, OS/Node/client versions, target adapter, reproduction
steps, expected/actual result and whether a message may already have been sent.
Distinguish sent, accepted and completed. For unknown delivery, query the receipt;
do not repeat a live send just to collect more logs.

请附项目版本、系统/Node/客户端版本、适配器、复现步骤、预期与实际结果，
并说明消息是否可能已发出。未知送达时查询回执，不为补日志反复发送。

Never attach credentials, full chat histories, account identifiers, debugging
endpoints, .local/, evidence/, state/ or config.local.json. Redact reproduction
material before posting publicly. Report suspected security issues using
[SECURITY.md](SECURITY.md), not a public exploit or private chat dump.

不要上传凭据、完整聊天、账号标识、调试端点或本机状态文件。公开反馈前先
脱敏；安全问题按安全说明处理，不在公开 issue 贴私人聊天或攻击细节。
