import fs from 'node:fs';
export function upsertJsonRegistration(file, entry, { dryRun = true, force = false } = {}) {
  const raw = fs.readFileSync(file, 'utf8');
  let data;
  try { data = JSON.parse(raw.startsWith(String.fromCharCode(65279)) ? raw.slice(1) : raw); } catch { return { result: 'invalid-json' }; }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(data) || (data.mcpServers !== undefined && !object(data.mcpServers))) return { result: 'invalid-json' };
  const current = data.mcpServers?.['agent-handoff'];
  if (current && JSON.stringify(current) === JSON.stringify(entry)) return { result: 'unchanged' };
  if (current && !force) return { result: 'exists-different' };
  data.mcpServers ??= {};
  data.mcpServers['agent-handoff'] = entry;
  if (!dryRun) {
    const backup = file + '.bak-' + Date.now();
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + String.fromCharCode(10), 'utf8');
    JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return { result: current ? 'updated' : 'added', loaded: 'not-verified' };
}
