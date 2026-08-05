import test from 'node:test';
import assert from 'node:assert/strict';

import { runCodex, settings } from '../scripts/codex-triage.js';

test('triage can launch Codex through an absolute Node command and script argument', async () => {
  const config = settings({
    CODEX_TRIAGE_ROOT: process.cwd(),
    CODEX_TRIAGE_BIN: process.execPath,
    CODEX_TRIAGE_ARGS_JSON: JSON.stringify([
      '-e',
      "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('ok'))",
    ]),
  });

  assert.equal(config.binary, process.execPath);
  assert.equal(config.binaryArgs[0], '-e');
  assert.equal(await runCodex(config, 'test prompt'), 'ok');
});

test('triage rejects malformed command arguments', () => {
  assert.throws(() => settings({
    CODEX_TRIAGE_ROOT: process.cwd(),
    CODEX_TRIAGE_ARGS_JSON: 'not-json',
  }), /valid JSON/);
  assert.throws(() => settings({
    CODEX_TRIAGE_ROOT: process.cwd(),
    CODEX_TRIAGE_ARGS_JSON: '{"unsafe":"shape"}',
  }), /array of strings/);
});
