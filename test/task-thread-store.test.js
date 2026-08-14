import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  isActiveTaskThread,
  pruneTaskThreads,
  readActiveTaskThread,
  registerTaskThread,
} from '../src/lib/task-thread-store.js';

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zylos-task-threads-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('registers only the exact task thread without storing message content', t => {
  const directory = temporaryDirectory(t);
  const createdAt = Date.parse('2026-08-13T12:00:00Z');

  registerTaskThread(directory, {
    channel: 'C0BNXPB86RW',
    threadTs: '1786645179.152059',
    task: 'AX-143 PR review',
    ttlMs: 60_000,
    createdAt,
  });

  assert.equal(
    isActiveTaskThread(directory, 'C0BNXPB86RW', '1786645179.152059', {
      now: createdAt + 1,
    }),
    true,
  );
  assert.equal(
    isActiveTaskThread(directory, 'C0BNXPB86RW', '1786645179.999999', {
      now: createdAt + 1,
    }),
    false,
  );
  const files = fs.readdirSync(directory);
  assert.equal(files.length, 1);
  const persisted = fs.readFileSync(path.join(directory, files[0]), 'utf8');
  assert.doesNotMatch(persisted, /message|conversation|reply/i);
  assert.equal(fs.statSync(path.join(directory, files[0])).mode & 0o777, 0o600);
});

test('expired, malformed, and cross-channel records fail closed', t => {
  const directory = temporaryDirectory(t);
  const createdAt = Date.parse('2026-08-13T12:00:00Z');
  registerTaskThread(directory, {
    channel: 'C0BNXPB86RW',
    threadTs: '1786645179.152059',
    task: 'AX-143',
    ttlMs: 1_000,
    createdAt,
  });

  assert.equal(
    readActiveTaskThread(directory, 'C0BNXPB86RW', '1786645179.152059', {
      now: createdAt + 1_000,
    }),
    null,
  );
  assert.equal(
    isActiveTaskThread(directory, 'C0828UQRLG6', '1786645179.152059', {
      now: createdAt + 1,
    }),
    false,
  );
  assert.equal(isActiveTaskThread(directory, '../escape', '../../etc/passwd'), false);

  fs.writeFileSync(path.join(directory, 'malformed.json'), '{not-json', { mode: 0o600 });
  assert.equal(pruneTaskThreads(directory, { now: createdAt + 1_000 }), 2);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('rejects invalid registration input before writing', t => {
  const directory = temporaryDirectory(t);
  assert.throws(() => registerTaskThread(directory, {
    channel: '../outside',
    threadTs: '1786645179.152059',
    task: 'AX-143',
  }), /Slack channel ID/);
  assert.throws(() => registerTaskThread(directory, {
    channel: 'C0BNXPB86RW',
    threadTs: '../../escape',
    task: 'AX-143',
  }), /canonical Slack timestamp/);
  assert.throws(() => registerTaskThread(directory, {
    channel: 'C0BNXPB86RW',
    threadTs: '1786645179.152059',
    task: 'bad\nlabel',
  }), /printable/);
  assert.deepEqual(fs.readdirSync(directory), []);
});
