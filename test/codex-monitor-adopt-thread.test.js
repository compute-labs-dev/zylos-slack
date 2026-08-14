import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs,
  validateLegacyParent,
} from '../scripts/codex-monitor-adopt-thread.js';

const THREAD_TS = '1786574361.203089';
const AUTHOR = 'U06TDSQR7BJ';
const NOW = 1786706000 * 1000;

test('legacy adopter requires an exact channel, parent, task, and author', () => {
  assert.deepEqual(
    parseArgs([
      '--channel', 'C0BNXPB86RW',
      '--thread-ts', THREAD_TS,
      '--task', 'AX-143',
      '--expected-author', AUTHOR,
    ]),
    {
      channel: 'C0BNXPB86RW',
      'thread-ts': THREAD_TS,
      task: 'AX-143',
      'expected-author': AUTHOR,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    },
  );
});

test('legacy adopter validates identifiers and uses a shorter TTL ceiling', () => {
  assert.throws(() => parseArgs([
    '--channel', '../bad', '--thread-ts', THREAD_TS,
    '--task', 'AX-143', '--expected-author', AUTHOR,
  ]), /channel/);
  assert.throws(() => parseArgs([
    '--channel', 'C0BNXPB86RW', '--thread-ts', '../../bad',
    '--task', 'AX-143', '--expected-author', AUTHOR,
  ]), /thread-ts/);
  assert.throws(() => parseArgs([
    '--channel', 'C0BNXPB86RW', '--thread-ts', THREAD_TS,
    '--task', 'AX-143', '--expected-author', 'not-a-user',
  ]), /expected-author/);
  assert.throws(() => parseArgs([
    '--channel', 'C0BNXPB86RW', '--thread-ts', THREAD_TS,
    '--task', 'AX-143', '--expected-author', AUTHOR, '--ttl-days', '31',
  ]), /at most 30/);
});

test('legacy adopter accepts only the expected recent human parent', () => {
  const parent = { ts: THREAD_TS, user: AUTHOR, text: 'not persisted' };
  assert.equal(validateLegacyParent([parent], {
    threadTs: THREAD_TS,
    expectedAuthor: AUTHOR,
    now: NOW,
  }), parent);

  assert.throws(() => validateLegacyParent([
    { ...parent, user: 'U087PB76PB7' },
  ], { threadTs: THREAD_TS, expectedAuthor: AUTHOR, now: NOW }), /author/);
  assert.throws(() => validateLegacyParent([
    { ...parent, bot_id: 'B0123' },
  ], { threadTs: THREAD_TS, expectedAuthor: AUTHOR, now: NOW }), /author/);
  assert.throws(() => validateLegacyParent([
    { ...parent, thread_ts: '1786574000.000001' },
  ], { threadTs: THREAD_TS, expectedAuthor: AUTHOR, now: NOW }), /reply/);
  assert.throws(() => validateLegacyParent([], {
    threadTs: THREAD_TS,
    expectedAuthor: AUTHOR,
    now: NOW,
  }), /parent/);
});

test('legacy adopter rejects dormant and future parents', () => {
  const parent = { ts: THREAD_TS, user: AUTHOR };
  assert.throws(() => validateLegacyParent([parent], {
    threadTs: THREAD_TS,
    expectedAuthor: AUTHOR,
    now: Number(THREAD_TS.split('.')[0]) * 1000 + 31 * 24 * 60 * 60 * 1000,
  }), /older than 30 days/);
  assert.throws(() => validateLegacyParent([
    { ts: '1786707000.000001', user: AUTHOR },
  ], {
    threadTs: '1786707000.000001',
    expectedAuthor: AUTHOR,
    now: 1786706000 * 1000,
  }), /future/);
});
