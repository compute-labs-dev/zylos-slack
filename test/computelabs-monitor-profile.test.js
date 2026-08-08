import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const profileUrl = new URL(
  '../examples/computelabs-codex-monitor/config.json',
  import.meta.url,
);

test('Compute Labs monitor profile is opt-in and never consumes ordinary channel messages', () => {
  const profile = JSON.parse(fs.readFileSync(profileUrl, 'utf8'));

  assert.equal(profile.enabled, false);
  assert.ok(Object.keys(profile.groups).length > 0);
  for (const group of Object.values(profile.groups)) {
    assert.equal(group.mode, 'mention');
  }
});
