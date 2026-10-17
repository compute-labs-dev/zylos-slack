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

test('fetchThread pages through long threads and keeps the parent plus the newest replies', async () => {
  const { initClient, getClient } = await import('../src/lib/client.js');
  const { fetchThread } = await import('../src/lib/message.js');
  initClient('xoxb-test-not-a-token');
  const parent = { ts: '100.000', text: 'Issue #783 release thread' };
  const replies = Array.from({ length: 30 }, (_, i) => ({ ts: `${101 + i}.000`, text: `reply ${i + 1}` }));
  const pages = [
    { messages: [parent, ...replies.slice(0, 15)], response_metadata: { next_cursor: 'page2' } },
    { messages: [parent, ...replies.slice(15)], response_metadata: { next_cursor: '' } },
  ];
  const requests = [];
  getClient().conversations.replies = async params => {
    requests.push(params);
    return params.cursor === 'page2' ? pages[1] : pages[0];
  };

  const current = replies.at(-1).ts;
  const fetched = await fetchThread('C1', parent.ts, 11, { includeParent: true });
  const context = slackThreadContextMessages(fetched, current, 10).map(message => message.text);

  assert.deepEqual(requests.map(r => [r.ts, r.limit, r.cursor]), [['100.000', 200, undefined], ['100.000', 200, 'page2']]);
  assert.deepEqual(context, ['Issue #783 release thread', ...replies.slice(20, 29).map(r => r.text)]);
  assert.equal((await fetchThread('C1', parent.ts, 3)).map(m => m.text).join(','), 'reply 28,reply 29,reply 30');
});

test('fetchThread stops at the page bound and keeps the newest replies it read', async () => {
  const { getClient } = await import('../src/lib/client.js');
  const { fetchThread } = await import('../src/lib/message.js');
  let calls = 0;
  getClient().conversations.replies = async () => {
    calls += 1;
    return { messages: [{ ts: '1.0', text: 'parent' }, { ts: `${calls + 1}.0`, text: `page ${calls}` }],
      response_metadata: { next_cursor: 'more' } };
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const fetched = await fetchThread('C1', '1.0', 2, { includeParent: true, maxPages: 3 });
    assert.equal(calls, 3);
    assert.deepEqual(fetched.map(m => m.text), ['parent', 'page 2', 'page 3']);
  } finally {
    console.warn = warn;
  }
});
