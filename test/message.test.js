import test from 'node:test';
import assert from 'node:assert/strict';

import { initClient } from '../src/lib/client.js';
import { sendLongMessage } from '../src/lib/message.js';

test('markdown-enabled messages always use Slack mrkdwn blocks', async () => {
  const client = initClient('xoxb-test-token');
  const calls = [];
  client.chat.postMessage = async params => {
    calls.push(params);
    return { ok: true, ts: '1786645936.431789' };
  };

  const response = await sendLongMessage(
    'C0BNXPB86RW',
    '*Formatted title*\n\nBody text',
    { useMarkdown: true },
  );

  assert.equal(response.ts, '1786645936.431789');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].blocks[0].text.type, 'mrkdwn');
  assert.equal(calls[0].blocks[0].text.text, '*Formatted title*\n\nBody text');
});
