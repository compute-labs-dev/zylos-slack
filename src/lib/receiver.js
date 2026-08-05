import { spawn } from 'child_process';
import path from 'path';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_QUEUE = 20;
const MAX_QUEUE = 100;

function boundedTimeout(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(parsed, MAX_TIMEOUT_MS);
}

function parseArgs(raw) {
  if (!raw) return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('SLACK_RECEIVER_ARGS_JSON must be a JSON array');
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('SLACK_RECEIVER_ARGS_JSON must contain only strings');
  }
  return value;
}

function boundedQueue(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_QUEUE;
  return Math.min(parsed, MAX_QUEUE);
}

function failureMention(value) {
  if (!value) return null;
  if (!/^U[A-Z0-9]+$/.test(value)) {
    throw new Error('SLACK_RECEIVER_FAILURE_MENTION must be a Slack user ID');
  }
  return value;
}

export function receiverSettingsFromEnv(env = process.env) {
  const command = env.SLACK_RECEIVER_COMMAND?.trim();
  if (!command) return null;
  if (command.includes('\0')) {
    throw new Error('SLACK_RECEIVER_COMMAND contains an invalid NUL byte');
  }
  if (!path.isAbsolute(command)) {
    throw new Error('SLACK_RECEIVER_COMMAND must be an absolute path');
  }
  return {
    command,
    args: parseArgs(env.SLACK_RECEIVER_ARGS_JSON),
    timeoutMs: boundedTimeout(env.SLACK_RECEIVER_TIMEOUT_MS),
    maxQueue: boundedQueue(env.SLACK_RECEIVER_MAX_QUEUE),
    failureMention: failureMention(env.SLACK_RECEIVER_FAILURE_MENTION),
  };
}

export class ReceiverQueue {
  constructor(run, { maxQueue = DEFAULT_MAX_QUEUE } = {}) {
    if (typeof run !== 'function') throw new Error('receiver queue requires a run function');
    this.run = run;
    this.maxQueue = maxQueue;
    this.active = false;
    this.pending = [];
  }

  enqueue(payload) {
    if (this.pending.length >= this.maxQueue) {
      return Promise.reject(new Error(`receiver queue is full (${this.maxQueue})`));
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ payload, resolve, reject });
      this.drain();
    });
  }

  drain() {
    if (this.active) return;
    const item = this.pending.shift();
    if (!item) return;
    this.active = true;
    Promise.resolve()
      .then(() => this.run(item.payload))
      .then(item.resolve, item.reject)
      .finally(() => {
        this.active = false;
        this.drain();
      });
  }
}

export function runReceiver(settings, payload, { spawnImpl = spawn } = {}) {
  if (!settings?.command) {
    return Promise.reject(new Error('receiver command is required'));
  }

  return new Promise((resolve, reject) => {
    const child = spawnImpl(settings.command, settings.args || [], {
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    const capture = (current, chunk, streamName) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(reject, new Error(`receiver ${streamName} exceeded ${MAX_OUTPUT_BYTES} bytes`));
        return current;
      }
      return next;
    };

    child.stdout.on('data', chunk => {
      stdout = capture(stdout, chunk, 'stdout');
    });
    child.stderr.on('data', chunk => {
      stderr = capture(stderr, chunk, 'stderr');
    });
    child.on('error', error => finish(reject, error));
    child.on('close', code => {
      if (code !== 0) {
        finish(reject, new Error(`receiver failed with exit code ${code}`));
        return;
      }
      finish(resolve, stdout.trim());
    });

    child.stdin.on('error', error => finish(reject, error));
    child.stdin.end(`${JSON.stringify(payload)}\n`);

    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(reject, new Error(`receiver timed out after ${settings.timeoutMs}ms`));
    }, settings.timeoutMs);
    timer.unref?.();
  });
}
