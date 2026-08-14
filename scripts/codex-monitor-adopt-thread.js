#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';

import { getClient, fetchBotIdentity, initClient } from '../src/lib/client.js';
import { getConfig, DATA_DIR } from '../src/lib/config.js';
import {
  CHANNEL_PATTERN,
  registerTaskThread,
  THREAD_TS_PATTERN,
} from '../src/lib/task-thread-store.js';

const DEFAULT_TTL_DAYS = 7;
const MAX_TTL_DAYS = 30;
const MAX_PARENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const TASK_THREADS_DIR = path.join(DATA_DIR, 'task-threads');
const USER_PATTERN = /^U[A-Z0-9]+$/;

function usage() {
  return 'Usage: codex-monitor-adopt-thread.js --channel C123 --thread-ts TS --task TASK --expected-author U123 [--ttl-days N]';
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (![
      '--channel',
      '--thread-ts',
      '--task',
      '--expected-author',
      '--ttl-days',
    ].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    result[flag.slice(2)] = value;
    index += 1;
  }

  if (!CHANNEL_PATTERN.test(result.channel || '')) {
    throw new Error('--channel must be a Slack channel ID');
  }
  if (!THREAD_TS_PATTERN.test(result['thread-ts'] || '')) {
    throw new Error('--thread-ts must be a canonical Slack timestamp');
  }
  if (!USER_PATTERN.test(result['expected-author'] || '')) {
    throw new Error('--expected-author must be a Slack user ID');
  }
  result.task = String(result.task || '').trim();
  if (!result.task) throw new Error('--task is required');
  if (result.task.length > 160 || /[\u0000-\u001f\u007f]/.test(result.task)) {
    throw new Error('--task must be 1-160 printable characters');
  }

  const days = result['ttl-days'] === undefined
    ? DEFAULT_TTL_DAYS
    : Number(result['ttl-days']);
  if (!Number.isFinite(days) || days <= 0 || days > MAX_TTL_DAYS) {
    throw new Error(`--ttl-days must be greater than 0 and at most ${MAX_TTL_DAYS}`);
  }
  result.ttlMs = days * 24 * 60 * 60 * 1000;
  return result;
}

function validateLegacyParent(
  messages,
  { threadTs, expectedAuthor, now = Date.now() },
) {
  if (!Array.isArray(messages)) throw new Error('Slack returned an invalid thread');
  const parent = messages.find(message => message?.ts === threadTs);
  if (!parent) throw new Error('Slack did not return the requested thread parent');
  if (parent.thread_ts && parent.thread_ts !== threadTs) {
    throw new Error('requested timestamp is a reply, not a thread parent');
  }
  if (parent.bot_id || parent.user !== expectedAuthor) {
    throw new Error('thread parent author does not match --expected-author');
  }

  const parentMs = Number(threadTs.split('.')[0]) * 1000;
  if (!Number.isFinite(parentMs)) throw new Error('invalid thread parent timestamp');
  if (parentMs > now + MAX_FUTURE_SKEW_MS) {
    throw new Error('thread parent timestamp is in the future');
  }
  if (now - parentMs > MAX_PARENT_AGE_MS) {
    throw new Error('legacy thread parent is older than 30 days');
  }
  return parent;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');

  const config = getConfig();
  const configuredGroup = config.groups?.[options.channel];
  if (!configuredGroup || configuredGroup.mode !== 'task') {
    throw new Error('channel is not configured in task mode');
  }

  initClient(token);
  const identity = await fetchBotIdentity({ log: false });
  const response = await getClient().conversations.replies({
    channel: options.channel,
    ts: options['thread-ts'],
    inclusive: true,
    limit: 1,
  });
  validateLegacyParent(response.messages, {
    threadTs: options['thread-ts'],
    expectedAuthor: options['expected-author'],
  });

  const record = registerTaskThread(TASK_THREADS_DIR, {
    channel: options.channel,
    threadTs: options['thread-ts'],
    task: options.task,
    ttlMs: options.ttlMs,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    bot_user_id: identity.userId,
    channel: record.channel,
    thread_ts: record.thread_ts,
    task: record.task,
    expected_author: options['expected-author'],
    expires_at: record.expires_at,
  })}\n`);
}

export { parseArgs, validateLegacyParent };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[codex-monitor-adopt-thread] ${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  });
}
