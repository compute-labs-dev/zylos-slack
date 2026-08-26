import test from 'node:test';
import assert from 'node:assert/strict';

import { slackMessageText, slackThreadContextMessages } from '../src/lib/message.js';

test('Slack thread context recovers a finding identity from attachment fallback', () => {
  const message = {
    text: '',
    attachments: [{
      fallback: 'Finding: [AGT] Owner-authorized deal PATCH. Details: https://github.com/compute-labs-dev/computelabs-financing-platform/issues/500.',
      blocks: [],
    }],
  };

  assert.equal(
    slackMessageText(message),
    'Finding: [AGT] Owner-authorized deal PATCH. Details: https://github.com/compute-labs-dev/computelabs-financing-platform/issues/500.',
  );
});

test('Slack thread context falls back to Block Kit text before media placeholder', () => {
  const message = {
    text: '',
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: '*Issue #500* Owner-authorized deal PATCH' },
    }],
  };

  assert.equal(slackMessageText(message), '*Issue #500* Owner-authorized deal PATCH');
  assert.equal(slackMessageText({ files: [{ id: 'F123' }] }), '(media)');
});

test('Slack thread context always keeps the parent finding identity', () => {
  const messages = [
    { ts: '1', text: 'Issue #500 owner PATCH finding' },
    { ts: '2', text: 'reply one' },
    { ts: '3', text: 'reply two' },
    { ts: '4', text: 'reply three' },
    { ts: '5', text: 'current terse question' },
  ];

  assert.deepEqual(
    slackThreadContextMessages(messages, '5', 3).map(message => message.ts),
    ['1', '3', '4'],
  );
});
