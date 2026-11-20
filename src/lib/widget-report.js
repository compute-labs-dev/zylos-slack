// A "New bug report" the in-product feedback widget posts (FIX-3c). The
// widget's server writes the heading, severity and the signed-in submitter's
// email before any text the submitter typed, so only those fixed positions are
// read; anything else is not a widget bug report. Role and Page are never read.
const SEVERITY = '(?:critical|high|medium|low)';
const EMAIL = '[^\\s<>|*]+@[^\\s<>|*]+';
const FROM_VALUE = new RegExp(`^(?:<mailto:(${EMAIL})\\|(${EMAIL})>|(${EMAIL}))$`);

function email(value) {
  const match = String(value || '').match(FROM_VALUE);
  if (!match || (match[1] && match[1] !== match[2])) return null;
  return (match[1] || match[3]).toLowerCase();
}

/** The From email of a top-level widget bug report in an observe channel whose
 * `widgetBot` (`{ botId, userId }`) is configured, or null. */
export function widgetBugReportEmail({ config, event }) {
  const group = config.groups?.[event?.channel];
  const bot = group?.widgetBot;
  if (group?.mode !== 'observe' || !bot?.botId || !bot?.userId) return null;
  if (event.bot_id !== bot.botId || event.user !== bot.userId) return null;
  if ((event.thread_ts && event.thread_ts !== event.ts) || (event.subtype && event.subtype !== 'file_share')) return null;
  // With a screenshot: the report is the file's comment, one field per line.
  const lines = String(event.text || '').split('\n');
  if (lines[0] === '*New bug report*' && lines[1] === '' && new RegExp(`^\\*Severity:\\* ${SEVERITY}$`).test(lines[2] || '')) {
    return email((lines[3] || '').match(/^\*From:\* (.+)$/)?.[1]);
  }
  // Without one: a header block, then a section whose first fields are Severity and From.
  const [header, details] = Array.isArray(event.blocks) ? event.blocks : [];
  if (header?.type === 'header' && header.text?.text === 'New bug report' && details?.type === 'section'
      && new RegExp(`^\\*Severity:\\*\\n${SEVERITY}$`).test(details.fields?.[0]?.text || '')) {
    return email((details.fields?.[1]?.text || '').match(/^\*From:\*\n(.+)$/)?.[1]);
  }
  return null;
}

/** The report as the agent, the channel log and the history read it, with the
 * From email replaced by the resolved reporter's mention. Without a screenshot
 * the top-level text is only the title, so the blocks' text is used. Page and
 * Role stay as posted. */
export function widgetReportText(event, reporterId) {
  const from = `<@${reporterId}>`;
  const blocks = Array.isArray(event.blocks) ? event.blocks : [];
  if (blocks[0]?.type !== 'header') {
    const lines = String(event.text || '').split('\n');
    lines[3] = `*From:* ${from}`;
    return lines.join('\n');
  }
  return blocks.flatMap((block, index) => [block.text?.text, ...(block.fields || [])
    .map((field, position) => (index === 1 && position === 1 ? `*From:*\n${from}` : field?.text))])
    .filter(value => typeof value === 'string' && value).join('\n');
}

/** A current full member of this workspace, read from the live lookup.
 * Twin of zylos-cl-config's internalMemberIds (scripts/ops/refresh-slack-allow-from.mjs),
 * which builds allowFrom and decides admission: keep the two the same. */
export function isCurrentFullMember(user, teamId) {
  return Boolean(user?.id) && Boolean(teamId) && user.team_id === teamId && !user.deleted && !user.is_bot && !user.is_app_user
    && user.id !== 'USLACKBOT' && !user.is_restricted && !user.is_ultra_restricted && !user.is_stranger;
}
