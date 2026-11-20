import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { bugReportKey, classifyGroupMessage, isBugReaction, isExplicitMention, rootHandoffKey } from '../src/lib/group-routing.js';
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
const c4 = slice('function endpointTarget(', '// ── Typing Indicator');

function harness({ message = report, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-report-')), realC4 = false } = {}) {
  const deliveries = [];
  const execs = [];
  const logs = [];
  const timers = [];
  const context = vm.createContext({
    config, classifyGroupMessage, isBugReaction, bugReportKey, rootHandoffKey, claimEvent, HANDOFF_DIR: dir,
    getBotUserId: () => SWE, chatHistories: new Map(), console: { log() {}, warn: line => logs.push(line), error: line => logs.push(line) },
    addReaction: async () => {}, removeReaction: async () => {}, trackTyping: () => {},
    getUserName: async id => ({ [NICK]: 'Nick', [WARREN]: 'Warren' })[id] || id,
    downloadFile: async () => '/fake/attachment',
    fetchThread: async (channel, ts) => (message && channel === FEEDBACK && ts === message.ts ? [message] : []),
    slackThreadContextMessages: replies => replies, slackMessageText: m => m.text,
    logMessage: () => {}, buildEndpoint: (...parts) => parts.filter(Boolean).join('|'),
    sendToAgent: (...args) => deliveries.push(args),
    // The real C4 path, with the subprocess replaced: C4 accepts the send but its answer is lost.
    receiverSettings: null, C4_RECEIVE: '/c4-receive.js', typingTrackers: new Map(),
    exec: (cmd, options, callback) => { execs.push(cmd); callback(Object.assign(new Error(`Command failed: ${cmd}`), { code: 1, stdout: cmd }), cmd); },
    setTimeout: fn => { timers.push(fn); },
  });
  vm.runInContext(handlers, context);
  if (realC4) { vm.runInContext(c4, context); deliveries.length = 0; }
  const runTimers = () => { while (timers.length) timers.shift()(); };
  return { deliveries, execs, logs, dir, runTimers,
    react: (user, extra = {}) => context.handleBugReaction({ type: 'reaction_added', user, reaction: 'bug',
      item: { type: 'message', channel: FEEDBACK, ts: ROOT_TS }, item_user: NICK, event_ts: String(Math.random()), ...extra }),
    // What the message and app_mention events call for a message that mentions the bot.
    mention: text => context.handleGroupMessage({ ...report, channel: FEEDBACK, text }, true) };
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
    ['an app post without a bot id', h => h.react(NICK), { ...report, app_id: 'A0SOMEAPP' }],
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

test('a root a mention already handed over is not handed over again by a :bug:, even after its mention is edited away', async () => {
  const edited = { ...report, text: 'Onboarding will not let people delete the default numbers (edited)' };
  const h = harness({ message: edited });
  await h.mention(`<@${SWE}> ${report.text}`);
  await h.react(WARREN);
  assert.equal(h.deliveries.length, 1);
});

test('an explicit mention still reaches the agent after a :bug: report', async () => {
  const h = harness();
  await h.react(WARREN);
  await h.mention(`<@${SWE}> any update on this?`);
  assert.equal(h.deliveries.length, 2);
});

test('a claimed report gets exactly one C4 attempt when its answer is lost; an ordinary mention keeps its retry', async () => {
  const reported = harness({ realC4: true });
  await reported.react(WARREN);
  reported.runTimers();
  assert.equal(reported.execs.length, 1);
  assert.ok(reported.execs[0].includes('Onboarding will not let people delete'), 'the command carries the report text');
  assert.deepEqual(reported.logs.filter(line => /may not have reached the agent/.test(line)),
    ['[slack] A claimed report may not have reached the agent (exit 1); it is not sent again. An explicit mention hands it over.']);
  assert.ok(!reported.logs.some(line => /Onboarding|c4-receive|--content/.test(line)), 'neither the command nor the report text is logged');
  const mentioned = harness({ realC4: true });
  await mentioned.mention(`<@${SWE}> please look`);
  mentioned.runTimers();
  assert.equal(mentioned.execs.length, 2, 'deployed mention behaviour is unchanged');
});
