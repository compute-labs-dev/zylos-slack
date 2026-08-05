import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ReceiverQueue, receiverDeliveryTarget, receiverSettingsFromEnv, runReceiver,
} from '../src/lib/receiver.js';

test('receiver settings are opt-in and parse args without a shell', () => {
  assert.equal(receiverSettingsFromEnv({}), null);
  assert.deepEqual(receiverSettingsFromEnv({
    SLACK_RECEIVER_COMMAND: '/usr/bin/node',
    SLACK_RECEIVER_ARGS_JSON: '["script.js","--safe"]',
    SLACK_RECEIVER_TIMEOUT_MS: '1234',
  }), {
    command: '/usr/bin/node',
    args: ['script.js', '--safe'],
    timeoutMs: 1234,
    maxQueue: 20,
    failureMention: null,
  });
  assert.throws(
    () => receiverSettingsFromEnv({
      SLACK_RECEIVER_COMMAND: '/usr/bin/node',
      SLACK_RECEIVER_ARGS_JSON: 'script.js --unsafe',
    }),
    /JSON array/,
  );
  assert.throws(
    () => receiverSettingsFromEnv({ SLACK_RECEIVER_COMMAND: 'node' }),
    /absolute path/,
  );
  assert.throws(
    () => receiverSettingsFromEnv({
      SLACK_RECEIVER_COMMAND: '/usr/bin/node',
      SLACK_RECEIVER_FAILURE_MENTION: '@ax',
    }),
    /Slack user ID/,
  );
});

test('receiver queue serializes runs and rejects excess waiting work', async () => {
  const releases = [];
  const starts = [];
  const queue = new ReceiverQueue(payload => new Promise(resolve => {
    starts.push(payload);
    releases.push(resolve);
  }), { maxQueue: 1 });

  const first = queue.enqueue('first');
  await new Promise(resolve => setImmediate(resolve));
  const second = queue.enqueue('second');
  await assert.rejects(queue.enqueue('third'), /queue is full/);
  assert.deepEqual(starts, ['first']);

  releases.shift()('one');
  assert.equal(await first, 'one');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, ['first', 'second']);
  releases.shift()('two');
  assert.equal(await second, 'two');
});

test('receiver responses stay in-thread by default', () => {
  assert.deepEqual(receiverDeliveryTarget({
    channel: 'C123',
    messageTs: '1780000000.000100',
    threadTs: '1780000000.000100',
  }, {}), {
    channel: 'C123',
    messageTs: '1780000000.000100',
    threadTs: '1780000000.000100',
    prefix: '',
  });
});

test('receiver responses can be routed out of a monitored source channel', () => {
  assert.deepEqual(receiverDeliveryTarget({
    channel: 'C0828UQRLG6',
    messageTs: '1780000000.000100',
    threadTs: '1780000000.000100',
  }, {
    workspaceUrl: 'https://computelabs.slack.com/',
    groups: {
      C0828UQRLG6: { responseChannel: 'C0BNXPB86RW' },
    },
  }), {
    channel: 'C0BNXPB86RW',
    messageTs: '1780000000.000100',
    threadTs: undefined,
    prefix: '*Read-only triage from <#C0828UQRLG6>* — <https://computelabs.slack.com/archives/C0828UQRLG6/p1780000000000100|source message>\n\n',
  });

  assert.throws(() => receiverDeliveryTarget({ channel: 'C123' }, {
    groups: { C123: { responseChannel: 'not-a-channel' } },
  }), /invalid receiver response channel/);
});

test('receiver receives JSON over stdin and returns bounded stdout', async () => {
  const output = await runReceiver({
    command: process.execPath,
    args: ['-e', [
      "let input='';",
      "process.stdin.on('data', chunk => input += chunk);",
      "process.stdin.on('end', () => process.stdout.write(JSON.parse(input).content));",
    ].join('')],
    timeoutMs: 2_000,
  }, {
    source: 'slack',
    endpoint: 'C123|type:group|msg:1.2',
    content: 'literal $(touch /tmp/never-run)',
  });

  assert.equal(output, 'literal $(touch /tmp/never-run)');
});

test('receiver timeout terminates a stuck child', async () => {
  await assert.rejects(
    runReceiver({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 25,
    }, { source: 'slack', endpoint: 'C123', content: 'x' }),
    /timed out/,
  );
});
