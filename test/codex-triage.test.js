import test from 'node:test';
import assert from 'node:assert/strict';

import { codexChildEnv, promptFor, runCodex, settings } from '../scripts/codex-triage.js';

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

test('triage disables tools and ignores ambient Codex config and rules', async () => {
  const config = settings({
    CODEX_TRIAGE_ROOT: process.cwd(),
    CODEX_TRIAGE_BIN: process.execPath,
    CODEX_TRIAGE_ARGS_JSON: JSON.stringify([
      '-e',
      "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify(process.argv.slice(1))))",
    ]),
  });

  const args = JSON.parse(await runCodex(config, 'test prompt'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.deepEqual(args.slice(args.indexOf('--disable'), args.indexOf('--disable') + 2), ['--disable', 'shell_tool']);
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.ok(args.includes('approval_policy="never"'));
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

test('triage treats the Slack thread as authoritative over unrelated foreground work', () => {
  const prompt = promptFor({
    source: 'slack',
    endpoint: 'C123|type:group|msg:1780000001.000200|thread:1780000000.000100',
    content: '<current-message>\n<group-context>\nbot: Issue #500 owner PATCH finding\n</group-context>\nThis one is confusing\n</current-message>',
  });

  assert.match(prompt, /Slack thread is the authoritative context/);
  assert.match(prompt, /Never fill missing context from another active task, PR, worktree, or session/);
  assert.match(prompt, /current behavior/);
  assert.match(prompt, /what remains allowed/);
  assert.doesNotMatch(prompt, /monitored channel: C0BNXPB86RW/);
});

test('triage child environment excludes provider and Slack credentials', () => {
  const childEnv = codexChildEnv({
    HOME: '/safe/home',
    PATH: '/safe/bin',
    TMPDIR: '/tmp/safe',
    SSL_CERT_FILE: '/safe/ca.pem',
    SLACK_BOT_TOKEN: 'secret-slack',
    GITHUB_TOKEN: 'secret-github',
    JIRA_API_TOKEN: 'secret-jira',
    OPENAI_API_KEY: 'secret-openai',
  });

  assert.deepEqual(childEnv, {
    HOME: '/safe/home',
    PATH: '/safe/bin',
    TMPDIR: '/tmp/safe',
    SSL_CERT_FILE: '/safe/ca.pem',
  });
});

test('triage child environment can isolate HOME and CODEX_HOME from the Slack runtime', () => {
  const childEnv = codexChildEnv({
    HOME: '/runtime/with-secrets',
    CODEX_HOME: '/runtime/with-sessions',
    PATH: '/safe/bin',
  }, {
    home: '/isolated/home',
    codexHome: '/isolated/codex-home',
  });

  assert.deepEqual(childEnv, {
    HOME: '/isolated/home',
    CODEX_HOME: '/isolated/codex-home',
    PATH: '/safe/bin',
  });
});
