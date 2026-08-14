import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const CHANNEL_PATTERN = /^[CG][A-Z0-9]+$/;
const THREAD_TS_PATTERN = /^\d{10,16}\.\d{6}$/;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function validateChannel(channel) {
  if (!CHANNEL_PATTERN.test(channel || '')) {
    throw new Error('task thread channel must be a Slack channel ID');
  }
}

function validateThreadTs(threadTs) {
  if (!THREAD_TS_PATTERN.test(threadTs || '')) {
    throw new Error('task thread timestamp must be a canonical Slack timestamp');
  }
}

function boundedTtlMs(value) {
  if (value === undefined) return DEFAULT_TTL_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('task thread TTL must be a positive number');
  }
  return Math.min(value, MAX_TTL_MS);
}

function safeTaskLabel(value) {
  const label = String(value || '').trim();
  if (!label || label.length > 160 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error('task label must be 1-160 printable characters');
  }
  return label;
}

function recordPath(directory, channel, threadTs) {
  validateChannel(channel);
  validateThreadTs(threadTs);
  return path.join(directory, `${channel}-${threadTs.replace('.', '_')}.json`);
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

export function registerTaskThread(
  directory,
  { channel, threadTs, task, ttlMs, createdAt = Date.now() },
) {
  validateChannel(channel);
  validateThreadTs(threadTs);
  const label = safeTaskLabel(task);
  const boundedTtl = boundedTtlMs(ttlMs);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    throw new Error('task thread creation time must be a positive timestamp');
  }
  ensureDirectory(directory);

  const record = {
    version: 1,
    channel,
    thread_ts: threadTs,
    task: label,
    created_at: new Date(createdAt).toISOString(),
    expires_at: new Date(createdAt + boundedTtl).toISOString(),
  };
  const destination = recordPath(directory, channel, threadTs);
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return record;
}

export function readActiveTaskThread(
  directory,
  channel,
  threadTs,
  { now = Date.now() } = {},
) {
  let source;
  try {
    source = recordPath(directory, channel, threadTs);
  } catch {
    return null;
  }

  try {
    const record = JSON.parse(fs.readFileSync(source, 'utf8'));
    const expiresAt = Date.parse(record.expires_at);
    if (
      record.version !== 1
      || record.channel !== channel
      || record.thread_ts !== threadTs
      || !Number.isFinite(expiresAt)
      || expiresAt <= now
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function isActiveTaskThread(directory, channel, threadTs, options) {
  return readActiveTaskThread(directory, channel, threadTs, options) !== null;
}

export function pruneTaskThreads(directory, { now = Date.now() } = {}) {
  if (!fs.existsSync(directory)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.json')) continue;
    const source = path.join(directory, name);
    try {
      const record = JSON.parse(fs.readFileSync(source, 'utf8'));
      const expiresAt = Date.parse(record.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        fs.unlinkSync(source);
        removed += 1;
      }
    } catch {
      fs.unlinkSync(source);
      removed += 1;
    }
  }
  return removed;
}

export {
  CHANNEL_PATTERN,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  THREAD_TS_PATTERN,
};
