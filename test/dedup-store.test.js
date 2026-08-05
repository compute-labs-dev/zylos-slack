import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { claimEvent, pruneEvents } from '../src/lib/dedup-store.js';

test('durable event claim is exactly once and stores no message content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zylos-slack-dedup-'));
  try {
    assert.equal(claimEvent(directory, 'C123-1.2', 1234), true);
    assert.equal(claimEvent(directory, 'C123-1.2', 1235), false);
    const entries = fs.readdirSync(directory);
    assert.equal(entries.length, 1);
    assert.match(entries[0], /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(directory, entries[0]), 'utf8'), '1234\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('pruning removes only expired dedup files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zylos-slack-prune-'));
  try {
    claimEvent(directory, 'old', 1);
    claimEvent(directory, 'new', 2);
    const [first, second] = fs.readdirSync(directory).sort();
    fs.utimesSync(path.join(directory, first), new Date(1_000), new Date(1_000));
    fs.utimesSync(path.join(directory, second), new Date(9_000), new Date(9_000));
    fs.writeFileSync(path.join(directory, 'README'), 'keep');

    assert.equal(pruneEvents(directory, { now: 10_000, ttlMs: 5_000 }), 1);
    assert.equal(fs.existsSync(path.join(directory, 'README')), true);
    assert.equal(fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

