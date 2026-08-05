import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const DEFAULT_DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function eventPath(directory, eventKey) {
  const digest = crypto.createHash('sha256').update(eventKey, 'utf8').digest('hex');
  return path.join(directory, digest);
}

export function claimEvent(directory, eventKey, now = Date.now()) {
  if (typeof eventKey !== 'string' || !eventKey || eventKey.length > 512) {
    throw new Error('event key must be a non-empty string no longer than 512 characters');
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(eventPath(directory, eventKey), `${now}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

export function pruneEvents(
  directory,
  { now = Date.now(), ttlMs = DEFAULT_DEDUP_TTL_MS } = {},
) {
  if (!fs.existsSync(directory)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(directory)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const file = path.join(directory, name);
    const stat = fs.statSync(file);
    if (!stat.isFile() || now - stat.mtimeMs <= ttlMs) continue;
    fs.unlinkSync(file);
    removed += 1;
  }
  return removed;
}

