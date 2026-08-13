import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyGroupMessage } from '../src/lib/group-routing.js';

test('task mode accepts mentions and active task threads only', () => {
  assert.equal(classifyGroupMessage({
    mode: 'task', isMention: true, isOwner: false, hasActiveTaskThread: false,
  }), 'mention');
  assert.equal(classifyGroupMessage({
    mode: 'task', isMention: false, isOwner: false, hasActiveTaskThread: true,
  }), 'task-thread');
  assert.equal(classifyGroupMessage({
    mode: 'task', isMention: false, isOwner: false, hasActiveTaskThread: false,
  }), 'ignore');
});

test('task mode does not let owner status bypass thread ownership', () => {
  assert.equal(classifyGroupMessage({
    mode: 'task', isMention: false, isOwner: true, hasActiveTaskThread: false,
  }), 'ignore');
});

test('legacy modes retain their explicit behavior', () => {
  assert.equal(classifyGroupMessage({
    mode: 'mention', isMention: false, isOwner: false, hasActiveTaskThread: true,
  }), 'ignore');
  assert.equal(classifyGroupMessage({
    mode: 'mention', isMention: false, isOwner: true, hasActiveTaskThread: false,
  }), 'owner');
  assert.equal(classifyGroupMessage({
    mode: 'smart', isMention: false, isOwner: false, hasActiveTaskThread: false,
  }), 'smart');
});
