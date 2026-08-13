import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const profileUrl = new URL(
  '../examples/computelabs-codex-monitor/config.json',
  import.meta.url,
);

test('Compute Labs monitor profile accepts mentions and bot-owned task threads only', () => {
  const profile = JSON.parse(fs.readFileSync(profileUrl, 'utf8'));

  assert.equal(profile.enabled, true);
  assert.ok(Object.keys(profile.groups).length > 0);
  for (const group of Object.values(profile.groups)) {
    assert.equal(group.mode, 'task');
  }
});
