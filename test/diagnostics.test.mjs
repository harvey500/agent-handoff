import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/diagnostics.mjs';
test('doctor enumerates all 36 directions without claiming a source live test', async () => {
  const calls = [];
  const report = await diagnose({adapters:{codex:{},workbuddy:{},claude:{},qoder:{}},
    connection:async target=>{calls.push(target);return {connected:target==='workbuddy',reason:'unavailable',capabilities:{}};}});
  assert.equal(report.directions.length,36);
  assert.equal(calls.length,4);
  assert.ok(report.directions.every(row=>row.status!=='passed'));
  assert.ok(report.directions.filter(row=>row.target==='workbuddy').every(row=>row.status==='not-live-tested'));
  assert.equal(report.recipients.find(row=>row.adapter==='deepseek').connected,false);
  assert.equal(JSON.stringify(report).includes(process.env.CODEX_APP_TOOLS_PIPE_PATH || 'NOT_A_REAL_PIPE'),false);
});
test('one failed recipient probe does not suppress the remaining diagnostic matrix', async () => {
  const calls = [];
  const report = await diagnose({ adapters: { codex: {}, workbuddy: {} },
    connection: async target => {
      calls.push(target);
      if (target === 'codex') throw new Error('host unavailable');
      return { connected: true, capabilities: {} };
    },
  });
  assert.deepEqual(calls, ['codex', 'workbuddy']);
  assert.equal(report.recipients.find(r => r.adapter === 'codex').reason, 'host unavailable');
  assert.equal(report.recipients.find(r => r.adapter === 'workbuddy').connected, true);
  assert.equal(report.directions.length, 36);
});
