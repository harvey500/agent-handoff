#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertJsonRegistration } from './src/registration.mjs';
const args = process.argv.slice(2);
const at = args.indexOf('--file');
if (at < 0 || !args[at + 1]) {
  console.error('Use --file ABSOLUTE_EXISTING_JSON [--apply] [--force]. Default: read-only preview.');
  console.error('Select the active host profile, not a guessed app-name directory. Codex TOML: use Connect-Codex.cmd or codex mcp add.');
  process.exitCode = 1;
} else {
  const file = args[at + 1];
  if (!path.isAbsolute(file) || !fs.statSync(file).isFile()) throw new Error('An existing absolute JSON config is required.');
  const root = path.dirname(fileURLToPath(import.meta.url));
  const entry = { command: process.execPath, args: [path.join(root, 'src', 'mcp.mjs')] };
  const result = upsertJsonRegistration(file, entry, { dryRun: !args.includes('--apply'), force: args.includes('--force') });
  console.log(JSON.stringify({ file, dryRun: !args.includes('--apply'), ...result }));
  console.log('Configuration written is not host-loaded verification. Reload the host and inspect actual tools.');
}
