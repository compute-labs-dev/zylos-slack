import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REVIEW_FINDING_ADMISSION_SCHEMA_VERSION = 1;

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SLACK_ID_PATTERN = /^[A-Z][A-Z0-9]{1,63}$/;
const SLACK_TS_PATTERN = /^[1-9][0-9]{8,15}(?:\.[0-9]{1,12})?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REPO_PATTERN = /^compute-labs-dev\/[A-Za-z0-9_.-]+$/;
const POLICY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ADMISSION_ACTIONS = new Set(['resume', 'start', 'push', 'create-pr', 'finish',
  'resume-task', 'start-task', 'push-branch', 'finish-task']);
const DECISIONS = {
  review_finding_approve: 'approved',
  review_finding_reject: 'rejected',
  review_finding_redirect: 'redirected',
  review_finding_defer: 'deferred',
};

function normalizedPrimitive(value) {
  if (value == null) return null;
  return String(value).trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return normalizedPrimitive(value);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonical(value[key])])
      .filter(([, item]) => item != null && item !== ''),
  );
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function requiredString(value, label, pattern = null) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} is required`);
  if (pattern && !pattern.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function parseObservedAt(value) {
  const result = requiredString(value, 'admission observation time');
  const timestamp = Date.parse(result);
  if (!Number.isFinite(timestamp)) throw new Error('admission observation time is invalid');
  return new Date(timestamp).toISOString();
}

function providerTimeFromSlackTs(value) {
  const slackTs = requiredString(value, 'Slack action timestamp', SLACK_TS_PATTERN);
  const milliseconds = Math.floor(Number(slackTs) * 1000);
  if (!Number.isFinite(milliseconds)) throw new Error('Slack action timestamp is invalid');
  return new Date(milliseconds).toISOString();
}

function scopeIssuedAt(value) {
  const timestamp = requiredString(value, 'review finding scope issuance time');
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new Error('review finding scope issuance time is invalid');
  return new Date(milliseconds).toISOString();
}

function normalizeAllowedActions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('review finding admission allowedActions must be a non-empty array');
  }
  const actions = [...new Set(value.map(item => requiredString(item, 'review finding admission allowed action').toLowerCase()))].sort();
  for (const action of actions) {
    if (!ADMISSION_ACTIONS.has(action)) throw new Error(`unsupported allowed action: ${action}`);
  }
  return actions;
}

function actionNameFromId(actionId) {
  const action = requiredString(actionId, 'review finding action id');
  if (!DECISIONS[action]) throw new Error(`unsupported review finding action id: ${action}`);
  return action.replace('review_finding_', '');
}

export function reviewFindingAdmissionSettings({ env = process.env, config = {}, dataDir, connectionMode } = {}) {
  const configured = config.reviewFindingAdmissions || {};
  const mode = String(env.REVIEW_FINDING_ADMISSION_PROTOCOL ?? configured.mode ?? 'off').trim().toLowerCase();
  if (!['off', 'required'].includes(mode)) {
    throw new Error('REVIEW_FINDING_ADMISSION_PROTOCOL must be off or required');
  }
  const defaultDirectory = path.join(requiredString(dataDir, 'Slack data directory'), 'review-finding-admissions');
  const configuredDirectory = String(env.REVIEW_FINDING_ADMISSIONS_DIR || configured.directory || defaultDirectory);
  if (!path.isAbsolute(configuredDirectory)) throw new Error('review finding admissions directory must be absolute');
  const directory = path.resolve(configuredDirectory);
  if (mode === 'off') return { enabled: false, directory, policyVersion: null };
  if (connectionMode !== 'socket') throw new Error('review finding admission protocol requires Slack Socket Mode');
  const policyVersion = requiredString(
    env.REVIEW_FINDING_ADMISSION_POLICY_VERSION || configured.policyVersion,
    'review finding admission policy version',
    POLICY_VERSION_PATTERN,
  );
  return { enabled: true, directory, policyVersion };
}

// Scoped Slack card value v2 requires taskId, repo, scopeRevision,
// scopeIssuedAt, expectedDecisionVersion, and allowedActions. scopeIssuedAt is the trusted publisher's
// issuance time for approvalScopeVersion and is deliberately separate from the
// material scope hash.
export function parseReviewFindingAdmissionValue(value) {
  let parsed;
  if (typeof value === 'string' && value.length > 4096) throw new Error('review finding Slack action value is too large');
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error('review finding Slack action value must be JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('review finding Slack action value is required');
  }
  if (Number(parsed.v) !== 2) {
    throw new Error('This finding card predates scoped approval; refresh the finding card before approving it.');
  }
  if (parsed.branch != null || parsed.worktree != null || parsed.worktreeDir != null) {
    throw new Error('review finding Slack action value must not contain branch or worktree paths');
  }
  const action = requiredString(parsed.action, 'review finding action').toLowerCase();
  if (!['approve', 'reject', 'redirect', 'defer'].includes(action)) throw new Error(`unsupported review finding action: ${action}`);
  const nextObservation = parsed.nextObservation == null ? null : requiredString(parsed.nextObservation, 'next observation condition');
  if (nextObservation != null && (!['defer', 'redirect'].includes(action)
      || typeof parsed.nextObservation !== 'string' || nextObservation.length > 1000 || /[\r\n]/.test(nextObservation))) {
    throw new Error('next observation condition is invalid for this review finding action');
  }
  if (action === 'defer' && !nextObservation) throw new Error('Defer requires an explicit next observation condition; refresh the finding card.');
  const repo = requiredString(parsed.repo, 'review finding repository');
  if (!REPO_PATTERN.test(repo)) throw new Error('review finding repository must be a canonical Compute Labs repo');
  const scopeRevision = requiredString(parsed.scopeRevision, 'review finding scope revision');
  if (!SHA256_PATTERN.test(scopeRevision)) throw new Error('review finding scope revision must be a SHA-256 hash');
  if (parsed.scopeIssuedAt == null || parsed.scopeIssuedAt === '') {
    throw new Error('This finding card predates scope issuance evidence; refresh the finding card before approving it.');
  }
  if (!Number.isInteger(parsed.expectedDecisionVersion) || parsed.expectedDecisionVersion < 0) {
    throw new Error('review finding expectedDecisionVersion must be a non-negative integer');
  }
  return {
    version: 2,
    action,
    taskId: requiredString(parsed.taskId, 'review finding task id', TASK_ID_PATTERN),
    findingId: parsed.findingId == null || parsed.findingId === ''
      ? null
      : requiredString(parsed.findingId, 'review finding id', TASK_ID_PATTERN),
    repo,
    scopeRevision,
    scopeIssuedAt: scopeIssuedAt(parsed.scopeIssuedAt),
    expectedDecisionVersion: parsed.expectedDecisionVersion,
    allowedActions: normalizeAllowedActions(parsed.allowedActions),
    ...(nextObservation ? { nextObservation } : {}),
  };
}

function ensurePrivateDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('review finding admissions path must be a real directory');
  } else {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(directory, 0o700);
}

function validateExistingRecord(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('existing review finding admission must be a regular file');
  if ((stat.mode & 0o077) !== 0) throw new Error('existing review finding admission is not private');
  if (stat.size > 64 * 1024) throw new Error('existing review finding admission is too large');
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('existing review finding admission is invalid JSON');
  }
  const { recordSha256, ...unsigned } = record || {};
  if (!SHA256_PATTERN.test(String(recordSha256 || '')) || sha256(unsigned) !== recordSha256) {
    throw new Error('existing review finding admission record hash mismatch');
  }
  return record;
}

function writeAtomicPrivateRecord(directory, record) {
  const target = path.join(directory, `${record.id}.json`);
  const temporary = path.join(directory, `.${record.id}.${process.pid}.${randomUUID()}.tmp`);
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  let fd = null;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.linkSync(temporary, target);
    fs.unlinkSync(temporary);
    const directoryFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    return { file: target, replayed: false, record };
  } catch (error) {
    if (fd != null) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch {}
    if (error?.code !== 'EEXIST') throw error;
    const existing = validateExistingRecord(target);
    if (existing.id !== record.id
      || existing.payloadSha256 !== record.payloadSha256
      || existing.policyVersion !== record.policyVersion) {
      throw new Error('review finding action event id was already admitted with different content');
    }
    return { file: target, replayed: true, record: existing };
  }
}

function matchingPayloadAction(payload, action) {
  const actionId = requiredString(action?.action_id, 'review finding action id');
  const actionTs = requiredString(action?.action_ts, 'Slack action timestamp', SLACK_TS_PATTERN);
  const value = requiredString(action?.value, 'review finding action value');
  const matching = Array.isArray(payload?.actions)
    && payload.actions.some(candidate => candidate?.action_id === actionId
      && candidate?.action_ts === actionTs
      && candidate?.value === value);
  if (!matching) throw new Error('review finding action does not match the authenticated Slack payload');
  return { actionId, actionTs, value };
}

export function recordReviewFindingAdmission({
  directory,
  payload,
  action,
  policyVersion,
  connectionMode,
  observedAt = new Date().toISOString(),
} = {}) {
  if (connectionMode !== 'socket') throw new Error('review finding admission requires Slack Socket Mode');
  if (!payload || typeof payload !== 'object') throw new Error('authenticated Slack action payload is required');
  const { actionId, actionTs, value } = matchingPayloadAction(payload, action);
  const parsedValue = parseReviewFindingAdmissionValue(value);
  if (parsedValue.action !== actionNameFromId(actionId)) {
    throw new Error('review finding action id does not match the scoped card value');
  }
  const teamId = requiredString(payload.team?.id, 'Slack team id', SLACK_ID_PATTERN);
  const appId = requiredString(payload.api_app_id, 'Slack app id', SLACK_ID_PATTERN);
  const actorId = requiredString(payload.user?.id, 'Slack actor id', SLACK_ID_PATTERN);
  const channelId = requiredString(payload.channel?.id || payload.container?.channel_id, 'Slack channel id', SLACK_ID_PATTERN);
  const messageTs = requiredString(payload.message?.ts || payload.container?.message_ts, 'Slack message timestamp', SLACK_TS_PATTERN);
  const resolvedPolicyVersion = requiredString(policyVersion, 'review finding admission policy version', POLICY_VERSION_PATTERN);
  const resolvedObservedAt = parseObservedAt(observedAt);
  const providerTimestamp = providerTimeFromSlackTs(actionTs);
  if (Date.parse(providerTimestamp) < Date.parse(parsedValue.scopeIssuedAt)) {
    throw new Error('Slack review finding action predates the approved scope issuance');
  }
  const cardPayloadSha256 = sha256(value);
  const sourceEvent = canonical({
    actionId,
    actionTs,
    actorId,
    appId,
    allowedActions: parsedValue.allowedActions,
    cardPayloadSha256,
    channelId,
    findingId: parsedValue.findingId,
    expectedDecisionVersion: parsedValue.expectedDecisionVersion,
    messageTs,
    policyVersion: resolvedPolicyVersion,
    providerTimestamp,
    repo: parsedValue.repo,
    scopeRevision: parsedValue.scopeRevision,
    scopeIssuedAt: parsedValue.scopeIssuedAt,
    taskId: parsedValue.taskId,
    teamId,
    transport: 'socket_mode',
    ...(parsedValue.nextObservation ? { nextObservation: parsedValue.nextObservation } : {}),
  });
  const id = `slack-${sha256({ teamId, appId, actionTs }).slice(0, 40)}`;
  const unsigned = {
    schemaVersion: REVIEW_FINDING_ADMISSION_SCHEMA_VERSION,
    id,
    authenticatedTransport: 'slack_socket_mode',
    status: 'active',
    decision: DECISIONS[actionId],
    teamId,
    appId,
    actorId,
    channelId,
    messageTs,
    actionId,
    actionTs,
    providerTimestamp,
    observedAt: resolvedObservedAt,
    policyVersion: resolvedPolicyVersion,
    taskId: parsedValue.taskId,
    findingId: parsedValue.findingId,
    expectedDecisionVersion: parsedValue.expectedDecisionVersion,
    repo: parsedValue.repo,
    scopeRevision: parsedValue.scopeRevision,
    scopeIssuedAt: parsedValue.scopeIssuedAt,
    allowedActions: parsedValue.allowedActions,
    cardPayloadSha256,
    sourceEvent,
    payloadSha256: sha256(sourceEvent),
  };
  const record = { ...unsigned, recordSha256: sha256(unsigned) };
  const resolvedDirectory = path.resolve(requiredString(directory, 'review finding admissions directory'));
  ensurePrivateDirectory(resolvedDirectory);
  return { id, ...writeAtomicPrivateRecord(resolvedDirectory, record) };
}
