import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { bugReportKey, classifyGroupMessage, isBugReaction } from '../src/lib/group-routing.js';
import { claimEvent } from '../src/lib/dedup-store.js';

const SWE = 'U0B7K6V2LTG';
const NICK = 'U0744HVT3JS';
const WARREN = 'U07SE1AN4BB';
const OUTSIDER = 'UOUTSIDE1';
const FEEDBACK = 'C0B7EKUAK33';
const ROOT_TS = '1794570738.681749';
const config = {
  groupPolicy: 'allowlist',
  peerBotUserIds: [],
  groups: {
    [FEEDBACK]: { mode: 'observe', allowFrom: [NICK, WARREN], name: 'financing-platform-feedback' },
    C0B7ETGHA1H: { mode: 'smart', allowFrom: [NICK, WARREN], name: 'cl-swe-agent' },
  },
  message: { context_messages: 10 },
};
const report = { ts: ROOT_TS, user: NICK, text: 'Onboarding will not let people delete the default numbers' };

// The production handlers, run without Bolt or Slack: handleBugReaction is what
// the reaction_added event calls, and it hands over to handleGroupMessage.
const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const slice = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `cannot isolate ${from}`);
  return source.slice(start, end);
};
const handlers = slice('async function handleBugReaction(', '// ── C4 Integration');

function harness({ message = report, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-report-')) } = {}) {
  const deliveries = [];
  const context = {
    config, classifyGroupMessage, isBugReaction, bugReportKey, claimEvent, BUG_REPORT_DIR: dir,
    getBotUserId: () => SWE, chatHistories: new Map(), console: { log() {}, warn() {}, error() {} },
    addReaction: async () => {}, removeReaction: async () => {}, trackTyping: () => {},
    getUserName: async id => ({ [NICK]: 'Nick', [WARREN]: 'Warren' })[id] || id,
    downloadFile: async () => '/fake/attachment',
    fetchThread: async (channel, ts) => (message && channel === FEEDBACK && ts === message.ts ? [message] : []),
    slackThreadContextMessages: replies => replies, slackMessageText: m => m.text,
    logMessage: () => {}, buildEndpoint: (...parts) => parts.filter(Boolean).join('|'),
    sendToAgent: (...args) => deliveries.push(args),
  };
  const handle = vm.runInNewContext(`${handlers}; handleBugReaction`, context);
  return { deliveries, dir, react: (user, extra = {}) => handle({ type: 'reaction_added', user, reaction: 'bug',
    item: { type: 'message', channel: FEEDBACK, ts: ROOT_TS }, item_user: NICK, event_ts: String(Math.random()), ...extra }) };
}

test('the reaction_added event is wired to the bug-report handler', () => {
  assert.match(source, /app\.event\('reaction_added', async \(\{ event \}\) => handleBugReaction\(event\)\)/);
});

test('an internal member\'s :bug: on a human top-level message reaches the agent as a report', async () => {
  const h = harness();
  await h.react(WARREN);
  assert.equal(h.deliveries.length, 1);
  const [, endpoint, content] = h.deliveries[0];
  assert.equal(endpoint, `${FEEDBACK}|group|${ROOT_TS}`);
  assert.match(content, /Nick said: <current-message>\n.*Onboarding will not let people delete the default numbers/s);
  assert.match(content, /Warren marked this message :bug: as a bug report for you/);
  assert.match(content, /A reaction approves no merge or release/);
});

test('a :bug: starts the report at most once: Slack retry, a second person, remove and re-add, restart', async () => {
  const h = harness();
  await h.react(NICK);
  await h.react(NICK); // Slack redelivers the same reaction
  await Promise.all([h.react(WARREN), h.react(NICK)]); // two people react at the same moment
  await h.react(WARREN); // removed and added again
  await harness({ dir: h.dir }).react(NICK); // after a restart: the claim is on disk
  assert.equal(h.deliveries.length, 1);
});

test('nothing else starts a report', async () => {
  const cases = [
    ['another reaction', h => h.react(NICK, { reaction: 'eyes' })],
    ['a reactor outside the channel allow list', h => h.react(OUTSIDER)],
    ['a channel that is not in observe mode', h => h.react(NICK, { item: { type: 'message', channel: 'C0B7ETGHA1H', ts: ROOT_TS } })],
    ['a thread reply', h => h.react(NICK), { ...report, thread_ts: '1794570000.000001' }],
    ['a bot post such as the public widget', h => h.react(NICK), { ...report, user: undefined, bot_id: 'B0WIDGET' }],
    ['a message by someone outside the allow list', h => h.react(NICK), { ...report, user: OUTSIDER }],
    ['a message that already @mentioned the agent', h => h.react(NICK), { ...report, text: `<@${SWE}> onboarding is broken` }],
    ['a message that cannot be read', h => h.react(NICK), null],
  ];
  for (const [name, act, message] of cases) {
    const h = harness(message === undefined ? {} : { message });
    await act(h);
    assert.equal(h.deliveries.length, 0, name);
  }
});
