import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseReviewFindingAdmissionValue,
  recordReviewFindingAdmission,
  reviewFindingAdmissionSettings,
} from '../src/lib/review-finding-admission.js';

const NOW = '2026-09-05T18:00:00.000Z';
const ACTION_TS = '1788627600.000100';
const SCOPE_REVISION = 'a'.repeat(64);
const SCOPE_ISSUED_AT = '2026-09-05T16:55:00.000Z';

function value(overrides = {}) {
  return JSON.stringify({
    v: 2,
    action: 'approve',
    taskId: 'task-approval',
    findingId: 'finding-checkout',
    repo: 'compute-labs-dev/web-app',
    scopeRevision: SCOPE_REVISION,
    scopeIssuedAt: SCOPE_ISSUED_AT,
    expectedDecisionVersion: 0,
    allowedActions: ['resume', 'start', 'push', 'create-pr', 'finish'],
    ...overrides,
  });
}

function payload(overrides = {}) {
  return {
    api_app_id: 'AREVIEWER',
    team: { id: 'TCOMPUTE' },
    user: { id: 'UAPPROVER', username: 'mutable-name' },
    channel: { id: 'CDECISIONS' },
    message: { ts: '1788627500.000100' },
    response_url: 'https://hooks.slack.com/actions/secret',
    trigger_id: 'secret-trigger',
    token: 'legacy-verification-token',
    actions: [{
      action_id: 'review_finding_approve',
      action_ts: ACTION_TS,
      value: value(),
    }],
    ...overrides,
  };
}

test('admission protocol is opt-in and uses one fixed configured directory', () => {
  assert.deepEqual(reviewFindingAdmissionSettings({
    env: {},
    dataDir: '/tmp/zylos/components/slack',
    connectionMode: 'socket',
  }), {
    enabled: false,
    directory: '/tmp/zylos/components/slack/review-finding-admissions',
    policyVersion: null,
  });

  assert.deepEqual(reviewFindingAdmissionSettings({
    env: {
      REVIEW_FINDING_ADMISSION_PROTOCOL: 'required',
      REVIEW_FINDING_ADMISSIONS_DIR: '/var/lib/zylos/reviewer-admissions',
      REVIEW_FINDING_ADMISSION_POLICY_VERSION: 'reviewer-approvers-v3',
    },
    dataDir: '/tmp/zylos/components/slack',
    connectionMode: 'socket',
  }), {
    enabled: true,
    directory: '/var/lib/zylos/reviewer-admissions',
    policyVersion: 'reviewer-approvers-v3',
  });

  assert.throws(() => reviewFindingAdmissionSettings({
    env: { REVIEW_FINDING_ADMISSION_PROTOCOL: 'required' },
    dataDir: '/tmp/zylos/components/slack',
    connectionMode: 'webhook',
  }), /requires Slack Socket Mode/);
});

test('v2 card value carries scoped intent and old cards require refresh', () => {
  assert.deepEqual(parseReviewFindingAdmissionValue(value()), {
    version: 2,
    action: 'approve',
    taskId: 'task-approval',
    findingId: 'finding-checkout',
    repo: 'compute-labs-dev/web-app',
    scopeRevision: SCOPE_REVISION,
    scopeIssuedAt: SCOPE_ISSUED_AT,
    expectedDecisionVersion: 0,
    allowedActions: ['create-pr', 'finish', 'push', 'resume', 'start'],
  });
  assert.throws(() => parseReviewFindingAdmissionValue(JSON.stringify({
    v: 1,
    action: 'approve',
    taskId: 'task-approval',
    githubIssueUrl: 'https://github.com/compute-labs-dev/web-app/issues/77',
  })), /refresh the finding card/i);
  assert.throws(() => parseReviewFindingAdmissionValue(value({ scopeIssuedAt: undefined })), /refresh the finding card/i);
});

test('authenticated action admission is private, deterministic, and sanitized', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-finding-admission-'));
  const first = recordReviewFindingAdmission({
    directory,
    payload: payload(),
    action: payload().actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'socket',
    observedAt: NOW,
  });

  assert.match(first.id, /^slack-[a-f0-9]{40}$/);
  assert.equal(first.replayed, false);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(first.file).mode & 0o777, 0o600);
  const storedText = fs.readFileSync(first.file, 'utf8');
  const stored = JSON.parse(storedText);
  assert.equal(stored.id, first.id);
  assert.equal(stored.authenticatedTransport, 'slack_socket_mode');
  assert.equal(stored.taskId, 'task-approval');
  assert.equal(stored.repo, 'compute-labs-dev/web-app');
  assert.equal(stored.scopeRevision, SCOPE_REVISION);
  assert.equal(stored.scopeIssuedAt, SCOPE_ISSUED_AT);
  assert.equal(stored.expectedDecisionVersion, 0);
  assert.equal(stored.actorId, 'UAPPROVER');
  assert.equal(stored.policyVersion, 'reviewer-approvers-v3');
  assert.equal(stored.sourceEvent.actionTs, ACTION_TS);
  assert.equal(stored.payloadSha256.length, 64);
  assert.equal(stored.recordSha256.length, 64);
  assert.doesNotMatch(storedText, /response_url|trigger_id|hooks\.slack\.com|secret-trigger|verification-token|mutable-name/);

  const replay = recordReviewFindingAdmission({
    directory,
    payload: payload(),
    action: payload().actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'socket',
    observedAt: NOW,
  });
  assert.equal(replay.id, first.id);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.record, first.record);
});

test('same authenticated event key with changed payload is rejected', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-finding-admission-mismatch-'));
  const original = payload();
  recordReviewFindingAdmission({
    directory,
    payload: original,
    action: original.actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'socket',
    observedAt: NOW,
  });
  const changed = payload({
    actions: [{
      ...original.actions[0],
      value: value({ scopeRevision: 'b'.repeat(64) }),
    }],
  });
  assert.throws(() => recordReviewFindingAdmission({
    directory,
    payload: changed,
    action: changed.actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'socket',
    observedAt: NOW,
  }), /event id was already admitted with different content/);
});

test('raw payload and malformed scoped values cannot become admissions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-finding-admission-forged-'));
  assert.throws(() => recordReviewFindingAdmission({
    directory,
    payload: payload({ team: null }),
    action: payload().actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'socket',
    observedAt: NOW,
  }), /team id is required/);
  const unsupported = payload({
    actions: [{ ...payload().actions[0], value: value({ allowedActions: ['shell'] }) }],
  });
  assert.throws(() => recordReviewFindingAdmission({
    directory,
    payload: unsupported,
    action: unsupported.actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'socket',
    observedAt: NOW,
  }), /unsupported allowed action/);
  assert.throws(() => recordReviewFindingAdmission({
    directory,
    payload: payload(),
    action: payload().actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'webhook',
    observedAt: NOW,
  }), /requires Slack Socket Mode/);

  const issuedAfterAction = payload({
    actions: [{
      ...payload().actions[0],
      value: value({ scopeIssuedAt: '2026-09-05T17:05:00.000Z' }),
    }],
  });
  assert.throws(() => recordReviewFindingAdmission({
    directory,
    payload: issuedAfterAction,
    action: issuedAfterAction.actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'socket',
    observedAt: NOW,
  }), /predates the approved scope issuance/);

  const invalidDecisionVersion = payload({
    actions: [{
      ...payload().actions[0],
      value: value({ expectedDecisionVersion: 1.5 }),
    }],
  });
  assert.throws(() => recordReviewFindingAdmission({
    directory,
    payload: invalidDecisionVersion,
    action: invalidDecisionVersion.actions[0],
    policyVersion: 'reviewer-approvers-v3',
    connectionMode: 'socket',
    observedAt: NOW,
  }), /expectedDecisionVersion must be a non-negative integer/);
});

for (const [actionName, decision] of [['defer', 'deferred'], ['redirect', 'redirected']]) {
  test(`${actionName} admission binds the visible revisit condition to its authenticated event`, t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finding-disposition-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const nextObservation = 'The next checkout trace has been attached to the linked issue.';
    const action = { action_id: `review_finding_${actionName}`, action_ts: ACTION_TS,
      value: value({ action: actionName, nextObservation }) };
    const admitted = recordReviewFindingAdmission({ directory, payload: payload({ actions: [action] }), action,
      policyVersion: 'reviewer-approvers-v3', connectionMode: 'socket', observedAt: NOW });
    assert.equal(admitted.record.decision, decision);
    assert.equal(admitted.record.sourceEvent.nextObservation, nextObservation);
    assert.equal(admitted.record.sourceEvent.expectedDecisionVersion, '0');
    const changed = { ...action, value: value({ action: actionName, nextObservation: 'Different condition.' }) };
    assert.throws(() => recordReviewFindingAdmission({ directory, payload: payload({ actions: [changed] }), action: changed,
      policyVersion: 'reviewer-approvers-v3', connectionMode: 'socket', observedAt: NOW }), /different content/);
  });
}

test('defer without a revisit condition and mismatched action IDs are rejected', t => {
  assert.throws(() => parseReviewFindingAdmissionValue(value({ action: 'defer' })), /explicit next observation/);
  assert.throws(() => parseReviewFindingAdmissionValue(value({ action: 'approve', nextObservation: 'Anything.' })), /condition is invalid/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finding-disposition-reject-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const action = { action_id: 'review_finding_approve', action_ts: ACTION_TS, value: value({ action: 'redirect' }) };
  assert.throws(() => recordReviewFindingAdmission({ directory, payload: payload({ actions: [action] }), action,
    policyVersion: 'reviewer-approvers-v3', connectionMode: 'socket', observedAt: NOW }), /action id does not match/);
});
