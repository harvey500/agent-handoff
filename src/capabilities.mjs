const keys = ['list', 'read', 'create', 'openVisible', 'send', 'replies', 'sourceCapture', 'activate'];
export function adapterCapabilities(declared = {}) {
  return Object.fromEntries(keys.map(key => [key, declared[key] === true]));
}
export const desktopCapabilities = adapterCapabilities({
  list: true, read: true, create: true, openVisible: true, send: true, replies: true, activate: true,
});
export function requireCapability(status, operation) {
  if (status.capabilities?.[operation] !== true) {
    throw new Error(`${status.adapter} does not support ${operation} in this transport. ${status.reason || ''}`.trim());
  }
}
