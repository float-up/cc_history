const fs = require('node:fs');
const path = require('node:path');

function findSessionFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(root, project.name);
    for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(projectPath, entry.name));
      }
    }
  }
  return files;
}

function readRecords(file) {
  const text = fs.readFileSync(file, 'utf8');
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Claude Code may be writing the final JSONL line while we read it.
    }
  }
  return records;
}

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim();
}

function isHumanMessage(record) {
  if (record.type !== 'user' || record.isMeta || record.isSidechain) return false;
  const content = record.message?.content;
  if (Array.isArray(content) && content.every((block) => block?.type === 'tool_result')) return false;
  return Boolean(textFromContent(content));
}

function getToolUses(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block?.type === 'tool_use')
    .map((block) => ({ name: block.name || 'tool', input: block.input ?? {} }));
}

function parseSession(file) {
  const records = readRecords(file);
  const stat = fs.statSync(file);
  const fallbackId = path.basename(file, '.jsonl');
  let id = fallbackId;
  let title = '';
  let cwd = '';
  let startedAt = '';
  let updatedAt = stat.mtime.toISOString();
  let model = '';
  const turns = [];
  let currentTurn = null;

  for (const record of records) {
    id = record.sessionId || record.session_id || id;
    if (record.aiTitle) title = record.aiTitle;
    if (!cwd && record.cwd) cwd = record.cwd;
    if (record.timestamp) {
      if (!startedAt) startedAt = record.timestamp;
      updatedAt = record.timestamp;
    }

    if (isHumanMessage(record)) {
      currentTurn = {
        id: record.uuid || `turn-${turns.length + 1}`,
        prompt: textFromContent(record.message.content),
        answer: '',
        timestamp: record.timestamp || '',
        model: '',
        tools: [],
      };
      turns.push(currentTurn);
      continue;
    }

    if (record.type !== 'assistant' || record.isSidechain) continue;
    if (!currentTurn) {
      currentTurn = {
        id: record.uuid || 'turn-1', prompt: '', answer: '',
        timestamp: record.timestamp || '', model: '', tools: [],
      };
      turns.push(currentTurn);
    }
    const message = record.message || {};
    const answerPart = textFromContent(message.content);
    if (answerPart) currentTurn.answer += `${currentTurn.answer ? '\n\n' : ''}${answerPart}`;
    const tools = getToolUses(message.content);
    if (tools.length) currentTurn.tools.push(...tools);
    if (message.model) {
      currentTurn.model = message.model;
      model = message.model;
    }
  }

  const firstPrompt = turns.find((turn) => turn.prompt)?.prompt || '';
  if (!title) title = firstPrompt.split('\n')[0].slice(0, 80) || `Session ${id.slice(0, 8)}`;

  return {
    id,
    title,
    cwd,
    project: cwd ? path.basename(cwd) : path.basename(path.dirname(file)),
    startedAt,
    updatedAt,
    model,
    turnCount: turns.filter((turn) => turn.prompt).length,
    fileSize: stat.size,
    turns,
  };
}

function sessionSummary(session) {
  const firstPrompt = session.turns.find((turn) => turn.prompt)?.prompt || '';
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    project: session.project,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    model: session.model,
    turnCount: session.turnCount,
    fileSize: session.fileSize,
    preview: firstPrompt.replace(/\s+/g, ' ').slice(0, 140),
  };
}

function escapeMarkdownHeading(text) {
  return String(text || '').replace(/\r?\n/g, ' ').trim();
}

function sessionToMarkdown(session) {
  const lines = [`# ${escapeMarkdownHeading(session.title)}`, '', `- Session: \`${session.id}\``];
  if (session.cwd) lines.push(`- Project: \`${session.cwd}\``);
  if (session.startedAt) lines.push(`- Started: ${session.startedAt}`);
  if (session.updatedAt) lines.push(`- Updated: ${session.updatedAt}`);
  lines.push('');

  session.turns.forEach((turn, index) => {
    if (turn.prompt) lines.push(`## ${index + 1}. User`, '', turn.prompt, '');
    if (turn.answer) lines.push(`## ${index + 1}. Claude`, '', turn.answer, '');
  });
  return `${lines.join('\n').trim()}\n`;
}

class SessionStore {
  constructor(root) {
    this.root = root;
    this.cache = new Map();
  }

  index() {
    return findSessionFiles(this.root).map((file) => ({
      file,
      id: path.basename(file, '.jsonl'),
      stat: fs.statSync(file),
    }));
  }

  readFileCached(item) {
    const key = `${item.stat.size}:${item.stat.mtimeMs}`;
    const cached = this.cache.get(item.file);
    if (cached?.key === key) return cached.session;
    const session = parseSession(item.file);
    this.cache.set(item.file, { key, session });
    return session;
  }

  list() {
    const found = this.index();
    const liveFiles = new Set(found.map((item) => item.file));
    for (const file of this.cache.keys()) {
      if (!liveFiles.has(file)) this.cache.delete(file);
    }
    return found
      .map((item) => sessionSummary(this.readFileCached(item)))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  get(id) {
    const item = this.index().find((candidate) => candidate.id === id);
    return item ? this.readFileCached(item) : null;
  }

  fingerprint() {
    return this.index()
      .map((item) => `${item.id}:${item.stat.size}:${item.stat.mtimeMs}`)
      .sort()
      .join('|');
  }
}

module.exports = {
  SessionStore,
  findSessionFiles,
  parseSession,
  sessionSummary,
  sessionToMarkdown,
  textFromContent,
};
