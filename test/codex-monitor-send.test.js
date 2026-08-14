import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from '../scripts/codex-monitor-send.js';

test('bot sender accepts a configured root task message', () => {
  assert.deepEqual(
    parseArgs(['--channel', 'C0BNXPB86RW', '--task', 'AX-143', '--ttl-days', '7']),
    { channel: 'C0BNXPB86RW', task: 'AX-143', 'ttl-days': '7', ttlMs: 604800000 },
  );
});

test('bot sender validates channel, thread, task, and TTL', () => {
  assert.throws(() => parseArgs(['--channel', '../bad', '--task', 'AX-143']), /channel/);
  assert.throws(() => parseArgs(['--channel', 'C0BNXPB86RW']), /task/);
  assert.throws(() => parseArgs([
    '--channel', 'C0BNXPB86RW', '--task', 'AX-143', '--thread-ts', '../../bad',
  ]), /thread-ts/);
  assert.throws(() => parseArgs([
    '--channel', 'C0BNXPB86RW', '--task', 'AX-143', '--ttl-days', '91',
  ]), /at most 90/);
  assert.throws(() => parseArgs([
    '--channel', 'C0BNXPB86RW', '--task', 'bad\nlabel',
  ]), /printable/);
  assert.throws(() => parseArgs([
    '--channel', 'C0BNXPB86RW', '--task', 'AX-143',
    '--thread-ts', '1786645179.152059', '--ttl-days', '7',
  ]), /new task root/);
});
