export function validateEndpoint(endpoint) {
  const u = new URL(endpoint);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port ||
      u.username || u.password || u.pathname !== '/' || u.search || u.hash) {
    throw new Error('Only an explicit 127.0.0.1 HTTP port is supported.');
  }
  return u.origin;
}

export function textOnly(message) {
  return (message?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join(String.fromCharCode(10));
}

export function findRequest(requests, marker) {
  const matches = requests.filter(r => textOnly(r.userMessage).includes(marker));
  if (matches.length > 1) throw new Error('Duplicate matching requests; manual review required.');
  return matches[0];
}

export function inspectRequest(request, acknowledgement) {
  if (!request) return { status: 'not-observed' };
  const reply = textOnly(request.assistantMessage);
  const ack = reply.trimStart().startsWith(acknowledgement);
  return {
    requestId: request.id, requestState: request.state, reply,
    status: request.state === 'completed' ? (ack ? 'acknowledged' : 'completed-without-ack')
      : ['failed', 'error', 'cancelled', 'canceled'].includes(request.state) ? 'failed' : 'pending',
  };
}

export function targetPage(targets, executable) {
  const normalized = executable.split(String.fromCharCode(92)).join('/');
  const expected = normalized.slice(0, normalized.lastIndexOf('/')) + '/resources/app.asar/renderer/index.html';
  return targets.find(t => {
    try {
      const u = new URL(t.url);
      const pathname = decodeURIComponent(u.pathname).slice(1);
      return t.type === 'page' && u.protocol === 'file:' && pathname.toLowerCase() === expected.toLowerCase();
    } catch { return false; }
  });
}
