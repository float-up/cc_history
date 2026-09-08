const state = {
  sessions: [],
  selectedId: decodeURIComponent(location.hash.slice(1)),
  session: null,
  sessionQuery: '',
  contentQuery: '',
  loadToken: 0,
  renderedAnswers: new Map(),
  streamTimer: null,
  followStream: true,
  realtimeTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  sidebar: $('#sidebar'), sessionList: $('#sessionList'), sessionSearch: $('#sessionSearch'),
  sessionCount: $('#sessionCount'), refreshButton: $('#refreshButton'), sourcePath: $('#sourcePath'),
  connectionDot: $('#connectionDot'), connectionText: $('#connectionText'), emptyState: $('#emptyState'),
  sessionView: $('#sessionView'), sessionTitle: $('#sessionTitle'), sessionDetails: $('#sessionDetails'),
  turnCount: $('#turnCount'), lastUpdated: $('#lastUpdated'), conversation: $('#conversation'),
  contentSearch: $('#contentSearch'), copyAllButton: $('#copyAllButton'), exportAllButton: $('#exportAllButton'),
  toast: $('#toast'), openSidebar: $('#openSidebar'), closeSidebar: $('#closeSidebar'),
  sidebarBackdrop: $('#sidebarBackdrop'), newContentButton: $('#newContentButton'),
  previousMessageButton: $('#previousMessageButton'), nextMessageButton: $('#nextMessageButton'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function inlineMarkdown(value) {
  const code = [];
  let output = escapeHtml(value).replace(/`([^`]+)`/g, (_, text) => {
    code.push(`<code>${text}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });
  output = output
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>');
  return output.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderCodeBlock(code, language = '') {
  return `<div class="code-block">
    <div class="code-header"><span>${escapeHtml(language || 'code')}</span><button type="button" class="copy-code">复制代码</button></div>
    <pre><code>${escapeHtml(code)}</code></pre>
  </div>`;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').replaceAll('\r\n', '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = '';
  let inCode = false;
  let codeFence = '';
  let codeLanguage = '';
  let codeLines = [];

  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${inlineMarkdown(paragraph.join('\n')).replaceAll('\n', '<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = '';
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([^\s]*)/);
    if (fence) {
      if (inCode && fence[1][0] === codeFence[0]) {
        html.push(renderCodeBlock(codeLines.join('\n'), codeLanguage));
        codeLines = []; codeFence = ''; codeLanguage = ''; inCode = false;
      } else if (!inCode) {
        closeParagraph(); closeList();
        inCode = true; codeFence = fence[1]; codeLanguage = fence[2] || '';
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (!line.trim()) { closeParagraph(); closeList(); continue; }

    const nextLine = lines[index + 1] || '';
    if (line.includes('|') && isTableDivider(nextLine)) {
      closeParagraph(); closeList();
      const headers = splitTableRow(line);
      const alignment = splitTableRow(nextLine).map((cell) => {
        if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
        if (cell.endsWith(':')) return 'right';
        return 'left';
      });
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell, cellIndex) => `<th class="align-${alignment[cellIndex] || 'left'}">${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td class="align-${alignment[cellIndex] || 'left'}">${inlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (heading) {
      closeParagraph(); closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      closeParagraph(); closeList(); html.push('<hr>');
    } else if (unordered || ordered) {
      closeParagraph();
      const wanted = unordered ? 'ul' : 'ol';
      if (list !== wanted) { closeList(); list = wanted; html.push(`<${list}>`); }
      const content = (unordered || ordered)[1];
      const task = unordered && content.match(/^\[([ xX])\]\s+(.+)$/);
      html.push(task
        ? `<li class="task-item"><input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}><span>${inlineMarkdown(task[2])}</span></li>`
        : `<li>${inlineMarkdown(content)}</li>`);
    } else if (quote) {
      closeParagraph(); closeList(); html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
    } else {
      closeList(); paragraph.push(line);
    }
  }
  if (inCode) html.push(renderCodeBlock(codeLines.join('\n'), codeLanguage));
  closeParagraph(); closeList();
  return html.join('');
}

function formatRelative(dateString) {
  if (!dateString) return '未知时间';
  const date = new Date(dateString);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (!Number.isFinite(seconds)) return dateString;
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  const ranges = [[86400 * 365, 'year'], [86400 * 30, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [amount, unit] of ranges) {
    if (Math.abs(seconds) >= amount) return formatter.format(Math.round(seconds / amount), unit);
  }
  return formatter.format(seconds, 'second');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 1800);
}

async function copyText(text, successMessage = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text; document.body.append(textarea); textarea.select();
    document.execCommand('copy'); textarea.remove();
  }
  showToast(successMessage);
}

function saveMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function renderSessionList() {
  const query = state.sessionQuery.trim().toLowerCase();
  const sessions = state.sessions.filter((session) =>
    `${session.title} ${session.project} ${session.cwd} ${session.preview}`.toLowerCase().includes(query));
  elements.sessionCount.textContent = query ? `${sessions.length} / ${state.sessions.length} 个会话` : `${sessions.length} 个会话`;
  if (!sessions.length) {
    elements.sessionList.innerHTML = `<div class="list-empty">${state.sessions.length ? '没有匹配的会话' : '没有找到 Claude Code 会话'}</div>`;
    return;
  }
  elements.sessionList.innerHTML = sessions.map((session) => `
    <button class="session-item ${session.id === state.selectedId ? 'active' : ''}" data-session-id="${escapeHtml(session.id)}">
      <div class="session-item-title">${escapeHtml(session.title)}</div>
      <div class="session-item-preview">${escapeHtml(session.preview || '暂无用户消息')}</div>
      <div class="session-item-meta">
        <span class="project-pill">${escapeHtml(session.project || 'unknown')}</span>
        <span>${session.turnCount} turns</span><span>·</span><span>${escapeHtml(formatRelative(session.updatedAt))}</span>
      </div>
    </button>`).join('');
}

function answerCard(turn, index) {
  if (!turn.answer && !turn.tools.length) return '';
  const displayedAnswer = state.renderedAnswers.has(turn.id) ? state.renderedAnswers.get(turn.id) : turn.answer;
  const isStreaming = displayedAnswer !== turn.answer;
  const toolCounts = turn.tools.reduce((counts, tool) => {
    counts[tool.name] = (counts[tool.name] || 0) + 1; return counts;
  }, {});
  const tools = Object.entries(toolCounts).map(([name, count]) =>
    `<span class="tool-chip">${escapeHtml(name)}${count > 1 ? ` ×${count}` : ''}</span>`).join('');
  return `<article class="message assistant" data-nav-message="answer" data-answer-turn="${index}">
    <div class="avatar">C</div>
    <div class="message-card">
      <div class="message-label"><span>Claude${turn.model ? ` · ${escapeHtml(turn.model)}` : ''}</span>
        <div class="message-actions">
          <button class="mini-button toggle-raw" data-turn="${index}">源码</button>
          <button class="mini-button copy-answer" data-turn="${index}">复制 MD</button>
          <button class="mini-button save-answer" data-turn="${index}">保存</button>
        </div>
      </div>
      ${turn.answer ? `<div class="markdown rendered-content${isStreaming ? ' streaming' : ''}">${renderMarkdown(displayedAnswer)}</div><pre class="raw-markdown hidden">${escapeHtml(displayedAnswer)}</pre>` : '<div class="markdown tool-running"><span></span>Claude 正在执行工具…</div>'}
      ${tools ? `<details class="tool-summary"><summary>${turn.tools.length} 次工具调用</summary><div class="tool-list">${tools}</div></details>` : ''}
    </div>
  </article>`;
}

function prepareRenderedAnswers(session, animate) {
  const liveIds = new Set(session.turns.map((turn) => turn.id));
  for (const id of state.renderedAnswers.keys()) {
    if (!liveIds.has(id)) state.renderedAnswers.delete(id);
  }

  let hasNewContent = false;
  for (const turn of session.turns) {
    if (!animate) {
      state.renderedAnswers.set(turn.id, turn.answer);
      continue;
    }
    if (!state.renderedAnswers.has(turn.id)) state.renderedAnswers.set(turn.id, '');
    const displayed = state.renderedAnswers.get(turn.id);
    if (!turn.answer.startsWith(displayed)) state.renderedAnswers.set(turn.id, turn.answer);
    else if (displayed !== turn.answer) hasNewContent = true;
  }
  return hasNewContent;
}

function streamPendingAnswers() {
  if (state.streamTimer || !state.session) return;

  const tick = () => {
    state.streamTimer = null;
    let hasPending = false;
    state.session.turns.forEach((turn, index) => {
      const displayed = state.renderedAnswers.get(turn.id) || '';
      if (displayed === turn.answer || !turn.answer.startsWith(displayed)) return;
      const remaining = turn.answer.length - displayed.length;
      const chunkSize = Math.max(2, Math.ceil(remaining / 80));
      const nextAnswer = turn.answer.slice(0, displayed.length + chunkSize);
      state.renderedAnswers.set(turn.id, nextAnswer);
      hasPending = hasPending || nextAnswer !== turn.answer;

      const card = elements.conversation.querySelector(`[data-answer-turn="${index}"]`);
      const rendered = card?.querySelector('.rendered-content');
      const raw = card?.querySelector('.raw-markdown');
      if (rendered) {
        rendered.innerHTML = renderMarkdown(nextAnswer);
        rendered.classList.toggle('streaming', nextAnswer !== turn.answer);
      }
      if (raw) raw.textContent = nextAnswer;
    });

    if (state.followStream) elements.conversation.scrollTop = elements.conversation.scrollHeight;
    updateConversationNavigation();
    if (hasPending) state.streamTimer = setTimeout(tick, 20);
  };

  state.streamTimer = setTimeout(tick, 20);
}

function renderConversation() {
  if (!state.session) return;
  const query = state.contentQuery.trim().toLowerCase();
  const visible = state.session.turns.map((turn, index) => ({ turn, index })).filter(({ turn }) =>
    !query || `${turn.prompt}\n${turn.answer}`.toLowerCase().includes(query));
  if (!visible.length) {
    elements.conversation.innerHTML = '<div class="no-results">当前会话中没有匹配内容</div>';
    requestAnimationFrame(updateConversationNavigation);
    streamPendingAnswers();
    return;
  }
  elements.conversation.innerHTML = visible.map(({ turn, index }) => `
    <section class="turn">
      <div class="turn-index">INTERACTION ${String(index + 1).padStart(2, '0')}</div>
      ${turn.prompt ? `<article class="message user" data-nav-message="question">
        <div class="avatar">U</div>
        <div class="message-card">
          <div class="message-label"><span>You · ${escapeHtml(formatRelative(turn.timestamp))}</span>
            <button class="mini-button copy-prompt" data-turn="${index}">复制</button>
          </div>
          <div class="markdown">${renderMarkdown(turn.prompt)}</div>
        </div>
      </article>` : ''}
      ${answerCard(turn, index)}
    </section>`).join('');
  requestAnimationFrame(updateConversationNavigation);
  streamPendingAnswers();
}

function navigationTargets() {
  const containerRect = elements.conversation.getBoundingClientRect();
  return [...elements.conversation.querySelectorAll('[data-nav-message]')].map((element) => ({
    element,
    top: element.getBoundingClientRect().top - containerRect.top + elements.conversation.scrollTop,
  }));
}

function updateConversationNavigation() {
  const targets = navigationTargets();
  const previousCursor = elements.conversation.scrollTop + 16;
  const nextCursor = elements.conversation.scrollTop + 48;
  const atTop = elements.conversation.scrollTop <= 2;
  const atBottom = elements.conversation.scrollTop + elements.conversation.clientHeight >= elements.conversation.scrollHeight - 2;
  elements.previousMessageButton.disabled = atTop || !targets.some((target) => target.top < previousCursor - 4);
  elements.nextMessageButton.disabled = atBottom || !targets.some((target) => target.top > nextCursor);
}

function jumpToMessage(direction) {
  const targets = navigationTargets();
  const previousCursor = elements.conversation.scrollTop + 16;
  const nextCursor = elements.conversation.scrollTop + 48;
  const target = direction < 0
    ? targets.filter((item) => item.top < previousCursor - 4).at(-1)
    : targets.find((item) => item.top > nextCursor);
  if (!target) return;

  elements.conversation.querySelector('.nav-target')?.classList.remove('nav-target');
  target.element.classList.add('nav-target');
  elements.conversation.scrollTo({ top: Math.max(0, target.top - 14), behavior: 'smooth' });
  setTimeout(() => target.element.classList.remove('nav-target'), 850);
}

function renderSelected() {
  const session = state.session;
  if (!session) {
    elements.emptyState.classList.remove('hidden');
    elements.sessionView.classList.add('hidden');
    return;
  }
  elements.emptyState.classList.add('hidden');
  elements.sessionView.classList.remove('hidden');
  elements.sessionTitle.textContent = session.title;
  elements.sessionDetails.innerHTML = `
    <span title="${escapeHtml(session.cwd)}">${escapeHtml(session.cwd || session.project)}</span>
    <span>${escapeHtml(session.model || 'Claude')}</span>
    <span>${formatBytes(session.fileSize)}</span>`;
  elements.turnCount.textContent = `${session.turnCount} 次交互`;
  elements.lastUpdated.textContent = `更新于 ${formatRelative(session.updatedAt)}`;
  renderConversation();
}

async function loadSessions() {
  try {
    const response = await fetch('/api/sessions');
    if (!response.ok) throw new Error('会话列表加载失败');
    state.sessions = (await response.json()).sessions;
    renderSessionList();
    if (state.selectedId && state.sessions.some((session) => session.id === state.selectedId)) {
      await loadSession(state.selectedId, true);
    }
  } catch (error) {
    elements.sessionList.innerHTML = `<div class="list-empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadSession(id, isUpdate = false) {
  const token = ++state.loadToken;
  const wasNearBottom = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight < 100;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('会话加载失败');
    const session = (await response.json()).session;
    if (token !== state.loadToken) return;
    const sameSession = state.session?.id === session.id;
    const sessionChanged = sameSession && state.session.fileSize !== session.fileSize;
    if (!sameSession) {
      clearTimeout(state.streamTimer);
      state.streamTimer = null;
      state.renderedAnswers.clear();
    }
    const hasNewContent = prepareRenderedAnswers(session, isUpdate && sameSession);
    state.followStream = wasNearBottom;
    state.selectedId = id; state.session = session;
    location.hash = encodeURIComponent(id);
    renderSessionList(); renderSelected();
    closeSidebar();
    if (isUpdate && wasNearBottom) elements.conversation.scrollTop = elements.conversation.scrollHeight;
    else if (isUpdate && (hasNewContent || sessionChanged)) elements.newContentButton.classList.remove('hidden');
    else if (!isUpdate) elements.conversation.scrollTop = 0;
  } catch (error) {
    showToast(error.message);
  }
}

async function getExportMarkdown() {
  const response = await fetch(`/api/sessions/${encodeURIComponent(state.selectedId)}/export`);
  if (!response.ok) throw new Error('导出失败');
  return response.text();
}

function openSidebar() {
  elements.sidebar.classList.add('open'); elements.sidebarBackdrop.classList.add('show');
}
function closeSidebar() {
  elements.sidebar.classList.remove('open'); elements.sidebarBackdrop.classList.remove('show');
}

function scheduleRealtimeRefresh() {
  clearTimeout(state.realtimeTimer);
  state.realtimeTimer = setTimeout(loadSessions, 60);
}

function connectEvents() {
  const events = new EventSource('/api/events');
  events.addEventListener('ready', () => {
    elements.connectionDot.classList.add('connected'); elements.connectionText.textContent = '实时更新已连接';
  });
  events.addEventListener('sessions', scheduleRealtimeRefresh);
  events.onerror = () => {
    elements.connectionDot.classList.remove('connected'); elements.connectionText.textContent = '正在重新连接';
  };
}

async function initialize() {
  try {
    const config = await fetch('/api/config').then((response) => response.json());
    elements.sourcePath.textContent = config.source;
    if (!config.exists) elements.connectionText.textContent = '数据目录不存在';
  } catch {}
  await loadSessions();
  connectEvents();
}

elements.sessionList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-session-id]');
  if (item) loadSession(item.dataset.sessionId);
});
elements.sessionSearch.addEventListener('input', (event) => { state.sessionQuery = event.target.value; renderSessionList(); });
elements.contentSearch.addEventListener('input', (event) => { state.contentQuery = event.target.value; renderConversation(); });
elements.refreshButton.addEventListener('click', () => loadSessions());
elements.conversation.addEventListener('click', (event) => {
  const codeButton = event.target.closest('.copy-code');
  if (codeButton) {
    copyText(codeButton.closest('.code-block')?.querySelector('code')?.textContent || '', '代码已复制');
    return;
  }
  const button = event.target.closest('[data-turn]');
  if (!button || !state.session) return;
  const turn = state.session.turns[Number(button.dataset.turn)];
  if (button.classList.contains('copy-answer')) copyText(turn.answer, '回答已复制为 Markdown');
  if (button.classList.contains('copy-prompt')) copyText(turn.prompt, '问题已复制');
  if (button.classList.contains('save-answer')) saveMarkdown(turn.answer, `${state.session.title}-回答-${Number(button.dataset.turn) + 1}.md`);
  if (button.classList.contains('toggle-raw')) {
    const card = button.closest('.message-card');
    card.querySelector('.rendered-content')?.classList.toggle('hidden');
    card.querySelector('.raw-markdown')?.classList.toggle('hidden');
    button.textContent = button.textContent === '源码' ? '预览' : '源码';
  }
});
elements.copyAllButton.addEventListener('click', async () => {
  try { await copyText(await getExportMarkdown(), '完整会话已复制'); } catch (error) { showToast(error.message); }
});
elements.exportAllButton.addEventListener('click', () => {
  if (state.selectedId) location.href = `/api/sessions/${encodeURIComponent(state.selectedId)}/export`;
});
elements.openSidebar.addEventListener('click', openSidebar);
elements.closeSidebar.addEventListener('click', closeSidebar);
elements.sidebarBackdrop.addEventListener('click', closeSidebar);
elements.newContentButton.addEventListener('click', () => {
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
  elements.newContentButton.classList.add('hidden');
});
elements.previousMessageButton.addEventListener('click', () => jumpToMessage(-1));
elements.nextMessageButton.addEventListener('click', () => jumpToMessage(1));
elements.conversation.addEventListener('scroll', () => {
  const nearBottom = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight < 100;
  state.followStream = nearBottom;
  if (nearBottom) elements.newContentButton.classList.add('hidden');
  updateConversationNavigation();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); elements.sessionSearch.focus(); openSidebar();
  }
});
window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && id !== state.selectedId) loadSession(id);
});

initialize();
