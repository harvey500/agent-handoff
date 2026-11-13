// One owner per MCP connection; no detached helper or copied caller identity.
export function inboundLifecycle(start, closeStore, enabled = false) {
  let bridge, starting, stopped = false, error = null, retryAt = 0;
  return {
    async ensure(adapter) {
      if (!enabled || stopped) return false;
      if (bridge) return true;
      if (Date.now()<retryAt) return false;
      starting ??= Promise.resolve().then(()=>start(adapter)).then(close => { bridge = close; error=null; return true; })
        .catch(cause=>{error=cause.message;retryAt=Date.now()+5000;return false;}).finally(() => { starting = null; });
      return starting;
    },
    status() { return {enabled,ready:!!bridge&&!stopped,error}; },
    async close() {
      if (stopped) return;
      stopped = true;
      try { await starting; } catch { /* Failed startup owns no bridge. */ }
      try { await bridge?.(); } finally { closeStore(); }
    },
  };
}
