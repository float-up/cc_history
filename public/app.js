const state = {
  sessions: [],
  selectedId: decodeURIComponent(location.hash.slice(1)),
  session: null,
  sessionQuery: '',
  contentQuery: '',
  loadToken: 0,
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

function renderMarkdown(markdown) {
  const lines = String(markdown || '').replaceAll('\r\n', '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = '';
  let inCode = false;
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

  for (const line of lines) {
    const fence = line.match(/^```\s*([^\s]*)/);
    if (fence) {
      closeParagraph(); closeList();
      if (inCode) {
        html.push(`<pre><code${codeLanguage ? ` data-language="${escapeHtml(codeLanguage)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = []; codeLanguage = ''; inCode = false;
      } else {
        inCode = true; codeLanguage = fence[1] || '';
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (!line.trim()) { closeParagraph(); closeList(); continue; }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
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
      html.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
    } else if (quote) {
      closeParagraph(); closeList(); html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
    } else {
      closeList(); paragraph.push(line);
    }
  }
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
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
  const toolCounts = turn.tools.reduce((counts, tool) => {
    counts[tool.name] = (counts[tool.name] || 0) + 1; return counts;
  }, {});
  const tools = Object.entries(toolCounts).map(([name, count]) =>
    `<span class="tool-chip">${escapeHtml(name)}${count > 1 ? ` ×${count}` : ''}</span>`).join('');
  return `<article class="message assistant">
    <div class="avatar">C</div>
    <div class="message-card">
      <div class="message-label"><span>Claude${turn.model ? ` · ${escapeHtml(turn.model)}` : ''}</span>
        <div class="message-actions">
          <button class="mini-button toggle-raw" data-turn="${index}">源码</button>
          <button class="mini-button copy-answer" data-turn="${index}">复制 MD</button>
          <button class="mini-button save-answer" data-turn="${index}">保存</button>
        </div>
      </div>
      ${turn.answer ? `<div class="markdown rendered-content">${renderMarkdown(turn.answer)}</div><pre class="raw-markdown hidden">${escapeHtml(turn.answer)}</pre>` : '<div class="markdown"><em>Claude 正在执行工具…</em></div>'}
      ${tools ? `<details class="tool-summary"><summary>${turn.tools.length} 次工具调用</summary><div class="tool-list">${tools}</div></details>` : ''}
    </div>
  </article>`;
}

function renderConversation() {
  if (!state.session) return;
  const query = state.contentQuery.trim().toLowerCase();
  const visible = state.session.turns.map((turn, index) => ({ turn, index })).filter(({ turn }) =>
    !query || `${turn.prompt}\n${turn.answer}`.toLowerCase().includes(query));
  if (!visible.length) {
    elements.conversation.innerHTML = '<div class="no-results">当前会话中没有匹配内容</div>';
    return;
  }
  elements.conversation.innerHTML = visible.map(({ turn, index }) => `
    <section class="turn">
      <div class="turn-index">INTERACTION ${String(index + 1).padStart(2, '0')}</div>
      ${turn.prompt ? `<article class="message user">
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
    const previousHeight = elements.conversation.scrollHeight;
    state.selectedId = id; state.session = session;
    location.hash = encodeURIComponent(id);
    renderSessionList(); renderSelected();
    closeSidebar();
    if (isUpdate && wasNearBottom) elements.conversation.scrollTop = elements.conversation.scrollHeight;
    else if (isUpdate && elements.conversation.scrollHeight > previousHeight) elements.newContentButton.classList.remove('hidden');
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

function connectEvents() {
  const events = new EventSource('/api/events');
  events.addEventListener('ready', () => {
    elements.connectionDot.classList.add('connected'); elements.connectionText.textContent = '实时更新已连接';
  });
  events.addEventListener('sessions', () => loadSessions());
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
elements.conversation.addEventListener('scroll', () => {
  const nearBottom = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight < 100;
  if (nearBottom) elements.newContentButton.classList.add('hidden');
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
