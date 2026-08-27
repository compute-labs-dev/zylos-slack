import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');

function functionBody(name, nextMarker) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `unable to isolate ${name}`);
  return source.slice(start, end);
}

test('Slack intake acknowledges accepted messages before optional context I/O', () => {
  const dm = functionBody('handleDM', '// ── Group Message Handler');
  const group = functionBody('handleGroupMessage', '// ── C4 Integration');

  for (const [name, body] of [['DM', dm], ['group', group]]) {
    const reaction = body.indexOf("await addReaction(event.channel, event.ts, 'hourglass_flowing_sand')");
    assert.ok(reaction >= 0, `${name} handler must add the responding reaction`);
    for (const optionalIo of ['await getUserName(', 'await downloadFile(', 'await fetchThread(']) {
      const io = body.indexOf(optionalIo);
      if (io >= 0) {
        assert.ok(reaction < io, `${name} reaction must precede ${optionalIo}`);
      }
    }
  }
});
