import fs from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from './paths.mjs';
import { validateEndpoint } from './core.mjs';
export async function localRequest(route, body) {
  const runtime = JSON.parse(await fs.readFile(path.join(dataRoot, 'runtime.json'), 'utf8').catch(() => { throw new Error('请先启动 Agent Handoff 本地服务'); }));
  const url = validateEndpoint(runtime.url);
  const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + runtime.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(55000), redirect: 'error' });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Local operation failed');
  return result;
}
