import { codexCaller } from './codex-context.mjs';
export const desktopAgents = ['codex', 'workbuddy', 'claude', 'qoder', 'deepseek', 'copilot'];
export async function diagnose(service) {
  const recipients = [];
  // Sequential probes avoid competing for desktop accessibility focus.
  for (const target of desktopAgents) {
    if (!service.adapters[target]) {
      recipients.push({ adapter: target, connected: false, reason: 'No desktop adapter implemented.', capabilities: {} });
      continue;
    }
    try {
      const status = await service.connection(target);
      recipients.push({ adapter: target, connected: status.connected, version: status.version || null,
        transport: status.transport || status.automation?.transport || null, capabilities: status.capabilities, reason: status.reason });
    } catch (error) {
      recipients.push({ adapter: target, connected: false, reason: error.message, capabilities: {} });
    }
  }
  const caller = codexCaller();
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), readOnly: true,
    codexContext: { pipePresent: Boolean(process.env.CODEX_APP_TOOLS_PIPE_PATH),
      requestMetadataPresent: Boolean(caller?.sourceId),
      shellIdentityPresent: Boolean(process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID),
      envFallbackAllowed: !caller }, recipients,
    directions: desktopAgents.flatMap(source => desktopAgents.map(target => {
      const recipient = recipients.find(r => r.adapter === target);
      return { source, target, status: recipient.connected ? 'not-live-tested' : 'blocked',
        reason: recipient.connected ? 'Recipient probe only; real source initiation and matching completed receipt are required.' : recipient.reason };
    })),
    meaning: 'Readiness is not a handoff test. No message, model call, source impersonation or configuration write was performed.' };
}
