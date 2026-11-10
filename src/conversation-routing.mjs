const names = new Map([
  ['workbuddy', 'workbuddy'], ['workbuddy ai', 'workbuddy'],
  ['claude', 'claude'], ['claude desktop', 'claude'],
  ['codex', 'codex'], ['codex desktop', 'codex'],
]);
const identity = value => String(value || '').toLowerCase().replace(/^local_/, '');
export function sourceAdapter(source) {
  const named = names.get(source.application.trim().toLowerCase());
  if (source.adapter && named && source.adapter !== named) throw new Error('Source application and adapter disagree.');
  return source.adapter || named;
}
export function sameConversation(row, id) {
  return [row.id, row.nativeId].filter(Boolean).some(value => identity(value) === identity(id));
}
export function conversationScope(task, target, catalog) {
  if (!task || sourceAdapter(task.source) !== target) return { kind: 'cross-client', items: catalog.items };
  const matches = catalog.items.filter(row => sameConversation(row, task.source.conversationId));
  if (matches.length !== 1) throw new Error('Cannot uniquely verify the source conversation in this account; no same-client handoff was sent.');
  const source = matches[0];
  return { kind: 'same-client', source, items: catalog.items.filter(row =>
    !sameConversation(row, source.id) && !(source.nativeId && sameConversation(row, source.nativeId))) };
}
export function assertDestination(scope, conversationId) {
  if (scope.source && (sameConversation(scope.source, conversationId) ||
      !scope.items.some(row => sameConversation(row, conversationId)))) {
    throw new Error('Same-client handoff requires a different verified conversation; refusing self-delivery or an unknown destination.');
  }
}
