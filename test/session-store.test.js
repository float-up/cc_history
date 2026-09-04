const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionStore, parseSession, sessionToMarkdown } = require('../lib/session-store');

function fixture(records) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-session-viewer-'));
  const project = path.join(root, '-tmp-demo');
  fs.mkdirSync(project);
  const file = path.join(project, 'session-1.jsonl');
  fs.writeFileSync(file, `${records.map(JSON.stringify).join('\n')}\n{unfinished`);
  return { root, file };
}

const records = [
  { type: 'user', sessionId: 'session-1', uuid: 'u1', timestamp: '2026-01-01T10:00:00Z', cwd: '/tmp/demo', message: { role: 'user', content: 'Build **this**' } },
  { type: 'assistant', sessionId: 'session-1', timestamp: '2026-01-01T10:00:01Z', message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'First part.' }] } },
  { type: 'assistant', sessionId: 'session-1', timestamp: '2026-01-01T10:00:02Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file: 'a.js' } }] } },
  { type: 'user', sessionId: 'session-1', timestamp: '2026-01-01T10:00:03Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'secret output' }] } },
  { type: 'assistant', sessionId: 'session-1', timestamp: '2026-01-01T10:00:04Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
  { type: 'user', isMeta: true, sessionId: 'session-1', message: { role: 'user', content: [{ type: 'text', text: 'system metadata' }] } },
  { type: 'ai-title', aiTitle: 'Demo session', sessionId: 'session-1' },
];

test('parses human turns while grouping assistant text and tools', () => {
  const { file } = fixture(records);
  const session = parseSession(file);
  assert.equal(session.id, 'session-1');
  assert.equal(session.title, 'Demo session');
  assert.equal(session.turnCount, 1);
  assert.equal(session.turns.length, 1);
  assert.equal(session.turns[0].prompt, 'Build **this**');
  assert.equal(session.turns[0].answer, 'First part.\n\nDone.');
  assert.deepEqual(session.turns[0].tools, [{ name: 'Read', input: { file: 'a.js' } }]);
  assert.equal(session.turns[0].model, 'claude-test');
});

test('lists summaries and exports clean Markdown', () => {
  const { root } = fixture(records);
  const store = new SessionStore(root);
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].preview, 'Build **this**');

  const markdown = sessionToMarkdown(store.get('session-1'));
  assert.match(markdown, /^# Demo session\n\n- Session:/);
  assert.match(markdown, /## 1\. User\n\nBuild \*\*this\*\*/);
  assert.match(markdown, /## 1\. Claude\n\nFirst part\.\n\nDone\./);
  assert.doesNotMatch(markdown, /secret output|system metadata/);
});
