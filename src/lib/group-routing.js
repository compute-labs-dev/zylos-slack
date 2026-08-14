export function classifyGroupMessage({
  mode,
  isMention,
  isOwner,
  hasActiveTaskThread,
}) {
  if (isMention) return 'mention';
  if (mode === 'task') {
    return hasActiveTaskThread ? 'task-thread' : 'ignore';
  }
  if (mode === 'smart') return 'smart';
  if (mode === 'mention' && isOwner) return 'owner';
  return 'ignore';
}
