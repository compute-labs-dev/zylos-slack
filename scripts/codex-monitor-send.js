#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getConfig, DATA_DIR } from '../src/lib/config.js';
import { fetchBotIdentity, initClient } from '../src/lib/client.js';
import { sendLongMessage } from '../src/lib/message.js';
import {
  CHANNEL_PATTERN,
  registerTaskThread,
  THREAD_TS_PATTERN,
} from '../src/lib/task-thread-store.js';

const MAX_MESSAGE_BYTES = 64 * 1024;
const TASK_THREADS_DIR = path.join(DATA_DIR, 'task-threads');

function usage() {
  return 'Usage: codex-monitor-send.js --channel C123 --task TASK [--thread-ts TS] [--ttl-days N] < message';
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--channel', '--task', '--thread-ts', '--ttl-days'].includes(flag)) {
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
  result.task = String(result.task || '').trim();
  if (!result.task) throw new Error('--task is required');
  if (result.task.length > 160 || /[\u0000-\u001f\u007f]/.test(result.task)) {
    throw new Error('--task must be 1-160 printable characters');
  }
  if (result['thread-ts'] && !THREAD_TS_PATTERN.test(result['thread-ts'])) {
    throw new Error('--thread-ts must be a canonical Slack timestamp');
  }
  if (result['ttl-days'] !== undefined) {
    if (result['thread-ts']) {
      throw new Error('--ttl-days applies only to a new task root');
    }
    const days = Number(result['ttl-days']);
    if (!Number.isFinite(days) || days <= 0 || days > 90) {
      throw new Error('--ttl-days must be greater than 0 and at most 90');
    }
    result.ttlMs = days * 24 * 60 * 60 * 1000;
  }
  return result;
}

function readMessage() {
  const message = fs.readFileSync(0, 'utf8').trim();
  if (!message) throw new Error('message on stdin is required');
  if (Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error(`message exceeds ${MAX_MESSAGE_BYTES} bytes`);
  }
  return message;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');

  const config = getConfig();
  const configuredGroup = config.groups?.[options.channel];
  if (!configuredGroup) throw new Error('channel is not configured for the monitor');
  if (!options['thread-ts'] && configuredGroup.mode !== 'task') {
    throw new Error('new task roots require task mode for the configured channel');
  }

  initClient(token);
  const identity = await fetchBotIdentity({ log: false });
  const response = await sendLongMessage(options.channel, readMessage(), {
    thread_ts: options['thread-ts'],
    useMarkdown: config.message?.useMarkdown ?? true,
  });
  const messageTs = response?.ts;
  if (!THREAD_TS_PATTERN.test(messageTs || '')) {
    throw new Error('Slack did not return a canonical message timestamp');
  }

  const threadTs = options['thread-ts'] || messageTs;
  if (!options['thread-ts']) {
    registerTaskThread(TASK_THREADS_DIR, {
      channel: options.channel,
      threadTs,
      task: options.task,
      ttlMs: options.ttlMs,
    });
  }

  const workspaceUrl = String(config.workspaceUrl || '').replace(/\/+$/, '');
  const link = /^https:\/\/[a-z0-9-]+\.slack\.com$/i.test(workspaceUrl)
    ? `${workspaceUrl}/archives/${options.channel}/p${messageTs.replace('.', '')}`
    : null;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    bot_user_id: identity.userId,
    channel: options.channel,
    message_ts: messageTs,
    thread_ts: threadTs,
    task: options.task,
    message_link: link,
  })}\n`);
}

export { parseArgs };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[codex-monitor-send] ${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  });
}
