const visible = content => typeof content === 'string' ? content :
  (Array.isArray(content) ? content : []).filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
const message = text => ({ content: text ? [{ type: 'text', text }] : [] });

const terminalStops = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'refusal']);

export function parseClaudeTranscript(input, sessionId, { busy = false, truncated = false } = {}) {
  const rows = [], nodes = new Map(), conflicts = new Set();
  const lines = input.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch {
      if ((index === lines.length - 1 && !input.endsWith('\n')) || (truncated && index === 0)) continue;
      throw new Error('Claude transcript contains an invalid record; receipt cannot be verified.');
    }
    if (row?.sessionId !== sessionId || row.isSidechain || typeof row.uuid !== 'string' || !row.uuid) continue;
    if (nodes.has(row.uuid)) {
      if (JSON.stringify(nodes.get(row.uuid)) !== JSON.stringify(row)) conflicts.add(row.uuid);
      continue;
    }
    nodes.set(row.uuid, row); rows.push(row);
  }
  const requests = [], turns = new Map();
  const isUserTurn = row => row.type === 'user' && !row.isMeta && row.message?.role === 'user' &&
    !(Array.isArray(row.message.content) && row.message.content.some(b => b.type === 'tool_result')) && !!visible(row.message.content);
  for (const row of rows) {
    if (!isUserTurn(row) || conflicts.has(row.uuid)) continue;
    const request = { id: row.uuid, state: 'pending', userMessage: message(visible(row.message.content)), assistantMessage: message('') };
    requests.push(request); turns.set(row.uuid, { request, replies: [], errors: [], ambiguous: false });
  }
  // Follow the nearest user ancestor through attachments and retries; never
  // substitute record order when ancestry is missing or contradictory.
  const owner = row => {
    const visited = new Set([row.uuid]);
    let parent = row.parentUuid;
    while (typeof parent === 'string' && parent) {
      if (visited.has(parent) || conflicts.has(parent)) return null;
      visited.add(parent);
      const ancestor = nodes.get(parent);
      if (!ancestor) return null;
      if (isUserTurn(ancestor)) return turns.get(parent) || null;
      parent = ancestor.parentUuid;
    }
    return null;
  };
  for (const row of rows) {
    const turn = owner(row);
    if (!turn) continue;
    if (conflicts.has(row.uuid)) { turn.ambiguous = true; continue; }
    if (row.type === 'assistant' && row.message?.role === 'assistant') turn.replies.push(row);
    if (row.type === 'system' && row.subtype === 'api_error') turn.errors.push(row);
  }
  const isAncestor = (id, row) => {
    const visited = new Set([row.uuid]);
    for (let parent = row.parentUuid; typeof parent === 'string' && parent; parent = nodes.get(parent)?.parentUuid) {
      if (visited.has(parent) || conflicts.has(parent)) return false;
      if (parent === id) return true;
      visited.add(parent);
    }
    return false;
  };
  for (const { request, replies, errors, ambiguous } of turns.values()) {
    const leaves = replies.filter(row => !replies.some(other => row !== other && isAncestor(row.uuid, other)));
    if (ambiguous || leaves.length > 1) {
      request.state = 'unknown'; request.verificationError = 'Ambiguous Claude reply branches; not confirming a receipt.'; continue;
    }
    const leaf = leaves[0];
    if (leaf) {
      const failed = leaf.isApiErrorMessage || leaf.error || leaf.message.model === '<synthetic>';
      if (!failed && (typeof leaf.message.id !== 'string' || !leaf.message.id)) {
        request.state = 'unknown'; request.verificationError = 'Claude assistant message identity unavailable.'; continue;
      }
      const parts = replies.filter(row => row === leaf || isAncestor(row.uuid, leaf))
        .filter(row => row.message.id === leaf.message.id && !row.isApiErrorMessage && !row.error && row.message.model !== '<synthetic>');
      parts.sort((a, b) => a === b ? 0 : isAncestor(a.uuid, b) ? -1 : 1);
      const texts = [...new Set(parts.map(row => visible(row.message.content)).filter(Boolean))];
      request.assistantMessage = message(failed ? visible(leaf.message.content) || 'Claude provider failed.' : texts.join('\n'));
      request.assistantId = leaf.uuid;
      request.state = failed ? 'failed' : terminalStops.has(leaf.message.stop_reason) ? 'completed' : 'pending';
      if (failed) request.errorCode = typeof leaf.error === 'string' ? leaf.error : 'provider-error';
      if (errors.some(error => isAncestor(leaf.uuid, error))) request.state = 'pending';
    }
    const lastError = errors.at(-1);
    if (lastError) request.lastProviderError = { status: lastError.error?.status || null, retrying: Number(lastError.retryAttempt) < Number(lastError.maxRetries) };
  }
  if (busy) {
    const current = requests.at(-1);
    if (current?.state === 'completed') current.state = 'pending';
  }
  return { requests, hasOlder: truncated };
}
