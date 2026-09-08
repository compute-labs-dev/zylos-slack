import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { classifyGroupMessage, isExplicitMention } from '../src/lib/group-routing.js';

const AX = 'U06TDSQR7BJ';
const SWE = 'U0B7K6V2LTG';
const REVIEWER = 'U0B7QTWJA8L';
const FEEDBACK = 'C0B7EKUAK33';
const REVIEW_CHANNEL = 'C0B7HTYD1MK';
const threadTs = '1788534474.656419';
const reviewerConfig = {
  owner: { bound: true, user_id: AX },
  groupPolicy: 'allowlist',
  peerBotUserIds: [SWE],
  groups: { [REVIEW_CHANNEL]: { mode: 'mention', allowFrom: [AX], name: 'reviewer' } },
  message: { context_messages: 10 },
};
const sweConfig = {
  owner: { bound: false, user_id: '' },
  groupPolicy: 'allowlist',
  peerBotUserIds: [REVIEWER],
  groups: { [FEEDBACK]: { mode: 'smart', allowFrom: [], name: 'feedback' } },
  message: { context_messages: 10 },
};
const event = { channel: FEEDBACK, user: AX, ts: '1788841088.060489', thread_ts: threadTs,
  text: 'I authorize a systematic fix' };

// Exercise the production handler without starting Bolt or contacting providers.
const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const start = source.indexOf('async function handleGroupMessage(');
const end = source.indexOf('// ── C4 Integration', start);
assert.ok(start >= 0 && end > start);
const handlerSource = source.slice(start, end);

function harness(config, botUserId) {
  const calls = [];
  const deliveries = [];
  const context = {
    config, classifyGroupMessage, getBotUserId: () => botUserId,
    chatHistories: new Map(), console,
    addReaction: async () => calls.push('reaction'),
    removeReaction: async () => calls.push('removeReaction'),
    trackTyping: () => calls.push('typing'),
    getUserName: async () => { calls.push('user'); return 'AX'; },
    downloadFile: async () => { calls.push('download'); return '/fake/attachment'; },
    fetchThread: async () => { calls.push('thread'); return [{ ts: threadTs, user: AX, text: 'Issue #531' }]; },
    slackThreadContextMessages: replies => replies,
    slackMessageText: message => message.text,
    logMessage: () => calls.push('log'),
    buildEndpoint: (channel, type, msg, thread) => [channel, type, msg, thread].join('|'),
    sendToAgent: (...args) => { calls.push('dispatch'); deliveries.push(args); },
  };
  return { calls, deliveries, handle: vm.runInNewContext('(' + handlerSource + ')', context) };
}

test('AX cannot bypass reviewer channel admission, even with an explicit mention', async () => {
  for (const text of [event.text, '<@' + SWE + '> please verify', '<@' + REVIEWER + '> please verify']) {
    const h = harness(reviewerConfig, REVIEWER);
    await h.handle({ ...event, text, files: [{ name: 'context.png' }] }, true);
    assert.deepEqual(h.calls, [], 'rejected channel must do no reaction, download, history or dispatch');
  }
});

test('reviewer ignores AX addressing SWE or continuing without an explicit reviewer mention', async () => {
  for (const text of ['<@' + SWE + '|SWE> please verify', event.text]) {
    const h = harness(reviewerConfig, REVIEWER);
    await h.handle({ ...event, channel: REVIEW_CHANNEL, text });
    assert.deepEqual(h.calls, []);
  }
});

test('explicit reviewer mention in its configured scope preserves addressing and thread', async () => {
  const h = harness(reviewerConfig, REVIEWER);
  const text = '<@' + REVIEWER + '|Reviewer> please review with <@' + AX + '>';
  await h.handle({ ...event, channel: REVIEW_CHANNEL, text }, true);
  assert.equal(h.deliveries.length, 1);
  assert.ok(h.deliveries[0][1].endsWith('|' + threadTs));
  assert.ok(h.deliveries[0][2].includes(text));
  assert.ok(h.deliveries[0][2].includes('Issue #531'));
  assert.equal(h.calls[0], 'reaction');
});

test('SWE accepts ordinary continuation and human mentions in its feedback thread', async () => {
  for (const text of [event.text, '<@' + AX + '> the analysis message is still wrong']) {
    const h = harness(sweConfig, SWE);
    await h.handle({ ...event, user: 'U0744HVT3JS', text });
    assert.equal(h.deliveries.length, 1);
    assert.ok(h.deliveries[0][1].endsWith('|' + threadTs));
    assert.ok(h.deliveries[0][2].includes(text));
  }
});

test('smart mode ignores messages explicitly addressed only to a peer bot', async () => {
  const h = harness({ ...sweConfig, owner: { user_id: AX } }, SWE);
  await h.handle({ ...event, text: '<@' + REVIEWER + '|Reviewer> please verify' });
  assert.deepEqual(h.calls, []);
});

test('explicitly including this bot remains admissible alongside a peer mention', async () => {
  const h = harness(sweConfig, SWE);
  await h.handle({ ...event, text: '<@' + SWE + '> coordinate with <@' + REVIEWER + '>' });
  assert.equal(h.deliveries.length, 1);
});

test('disabled groups and sender restrictions also apply to owners', async () => {
  for (const config of [
    { ...reviewerConfig, groupPolicy: 'disabled' },
    { ...reviewerConfig, groups: { [REVIEW_CHANNEL]: { mode: 'mention', allowFrom: ['UOTHER'] } } },
  ]) {
    const h = harness(config, REVIEWER);
    await h.handle({ ...event, channel: REVIEW_CHANNEL, text: '<@' + REVIEWER + '> verify' }, true);
    assert.deepEqual(h.calls, []);
  }
});

test('explicit mention matching accepts Slack piped form and rejects another identity', () => {
  assert.equal(isExplicitMention('<@' + SWE + '>', SWE), true);
  assert.equal(isExplicitMention('<@' + SWE + '|SWE agent>', SWE), true);
  assert.equal(isExplicitMention('<@' + SWE + '2>', SWE), false);
  assert.equal(isExplicitMention('<@' + REVIEWER + '>', SWE), false);
  assert.equal(isExplicitMention('SWE please verify', SWE), false);
});
