export function isExplicitMention(text, botId) {
  if (!botId || typeof text !== 'string') return false;
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)]
    .some(match => match[1] === botId);
}

export const GROUP_MODES = ['mention', 'smart', 'observe'];

// Group admission applies to every sender. Owner authority for DMs and
// workflow actions does not grant access to another agent's conversations.
export function classifyGroupMessage({ config, event, botUserId }) {
  const policy = config.groupPolicy || 'allowlist';
  if (!['open', 'allowlist'].includes(policy)) return 'ignore';
  const group = config.groups?.[event.channel];
  if (policy === 'allowlist' && !group) return 'ignore';
  if (group?.allowFrom?.length > 0 && !group.allowFrom.includes(event.user)) {
    return 'ignore';
  }

  const mode = group?.mode || 'mention';
  if (!GROUP_MODES.includes(mode)) return 'ignore';
  const isMention = isExplicitMention(event.text, botUserId);
  const peers = config.peerBotUserIds || [];
  if (!Array.isArray(peers)) return 'ignore';
  if (!isMention && peers.some(id => isExplicitMention(event.text, id))) return 'ignore';
  if (isMention) return 'mention';
  // observe: record the message as context for a later mention, never dispatch it.
  return mode === 'smart' || mode === 'observe' ? mode : 'ignore';
}

// A :bug: from an internal member on a human top-level message in an observe
// channel hands that message to the agent as a bug report.
export const BUG_REACTION = 'bug';

export function isBugReaction({ config, event }) {
  const group = config.groups?.[event?.item?.channel];
  return event?.reaction === BUG_REACTION && event.item.type === 'message'
    && group?.mode === 'observe' && Array.isArray(group.allowFrom) && group.allowFrom.includes(event.user);
}

/** The once-per-message key of a reported message, or null when it is not a
 * human top-level message from an allowed member of that channel. */
export function bugReportKey({ config, event, message }) {
  const { channel, ts } = event.item;
  const allowFrom = config.groups?.[channel]?.allowFrom || [];
  if (!message || message.ts !== ts || (message.thread_ts && message.thread_ts !== ts)
      || message.bot_id || (message.subtype && message.subtype !== 'file_share')
      || !allowFrom.includes(message.user)) return null;
  return `bug-report:${channel}:${ts}`;
}
