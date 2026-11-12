import { I18N } from './i18n.js';

const $ = (s) => document.querySelector(s);
const els = {
  chat: $('#chat'), messages: $('#messages'), welcome: $('#welcome'), suggestions: $('#suggestions'),
  form: $('#composer'), input: $('#input'), send: $('#send-btn'),
  theme: $('#theme-btn'), newChat: $('#new-chat-btn'),
};

const state = {
  lang: localStorage.getItem('lang') || 'vi', // Vietnamese by default
  theme: localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  history: [],
  busy: false,
};
const t = (k) => I18N[state.lang][k];

// ---------- Language & theme ----------
function applyLang() {
  document.documentElement.lang = state.lang;
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  document.querySelectorAll('.lang-switch button').forEach((b) => b.setAttribute('aria-checked', b.dataset.lang === state.lang));
  els.suggestions.innerHTML = '';
  t('suggestions').forEach((q) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'suggestion'; b.textContent = q;
    b.onclick = () => ask(q);
    els.suggestions.appendChild(b);
  });
}
document.querySelectorAll('.lang-switch button').forEach((b) =>
  b.addEventListener('click', () => { state.lang = b.dataset.lang; localStorage.setItem('lang', state.lang); applyLang(); }));

function applyTheme() { document.documentElement.dataset.theme = state.theme; }
els.theme.onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', state.theme); applyTheme(); };

els.newChat.onclick = () => {
  if (state.busy) return;
  state.history = []; els.messages.innerHTML = ''; els.welcome.hidden = false; els.input.focus();
};

// ---------- Minimal safe Markdown with robust HTML entity escaping & XSS disarm ----------
const esc = (s) =>
  String(s ?? '')
    // Disarm any javascript: or vbscript: or data: URL pseudo-protocols
    .replace(/(?:java|vb)script\s*:/gi, 'blocked-protocol:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked-protocol:')
    // Disarm HTML inline event attributes (e.g., onerror=, onload=, onclick=)
    .replace(/\b(on[a-z]{3,})\s*=/gi, 'data-blocked-$1=')
    // Escape all dangerous HTML characters to strict entity representations
    .replace(/[&<>"'`/]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
    }[c]));
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, nums) => {
      return nums
        .split(/\s*,\s*/)
        .map((n) => `<button type="button" class="cite-pill" data-cite="${n}" title="Nguồn [${n}]">[${n}]</button>`)
        .join('');
    });
}
function markdown(src) {
  const lines = esc(src).split('\n');
  let html = '', list = null, para = [];
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { flushPara(); closeList(); html += `<h3>${inline(m[1])}</h3>`; continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      flushPara();
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list !== type) { closeList(); html += `<${type}>`; list = type; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    closeList(); para.push(line);
  }
  flushPara(); closeList();
  return html;
}

// ---------- Messages ----------
function addMessage(role, content = '') {
  els.welcome.hidden = true;
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  if (role === 'bot') wrap.innerHTML = '<div class="avatar">HR</div>';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'user') bubble.textContent = content;
  wrap.appendChild(bubble);
  els.messages.appendChild(wrap);
  scrollDown();
  return { wrap, bubble };
}
const scrollDown = () => (els.chat.scrollTop = els.chat.scrollHeight);

function renderSources(bubble, sources) {
  if (!sources?.length) return;
  const d = document.createElement('details');
  d.className = 'sources';
  d.innerHTML = `<summary>${esc(t('sources'))} (${sources.length})</summary><ul>${sources
    .map(
      (s) => `<li id="source-${s.id}" data-id="${s.id}">
      <div class="source-header">
        <span class="source-badge">[${s.id}]</span>
        <span class="source-title">${esc(s.title)}</span>
      </div>
      <small class="source-category">${esc(s.category)}</small>
      ${s.excerpt ? `<blockquote class="source-excerpt">“${esc(s.excerpt)}”</blockquote>` : ''}
    </li>`
    )
    .join('')}</ul>`;
  bubble.appendChild(d);
}

function addCopy(bubble, getText) {
  const tools = document.createElement('div');
  tools.className = 'msg-tools';
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = '⧉ ' + t('copy');
  b.onclick = async () => { await navigator.clipboard.writeText(getText()); b.textContent = '✓ ' + t('copied'); setTimeout(() => (b.textContent = '⧉ ' + t('copy')), 1500); };
  tools.appendChild(b);
  bubble.appendChild(tools);
}

// ---------- Ask ----------
async function ask(question) {
  question = question.trim();
  if (!question || state.busy) return;
  state.busy = true; updateSend();
  els.input.value = ''; autosize();

  addMessage('user', question);
  const { wrap, bubble } = addMessage('bot');
  bubble.innerHTML = `<span class="typing"><span class="dots"><span></span><span></span><span></span></span>${esc(t('thinking'))}</span>`;

  const content = document.createElement('div');
  let text = '', sources = [], started = false;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, language: state.lang, history: state.history }),
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'delta') {
          if (!started) { bubble.innerHTML = ''; bubble.appendChild(content); started = true; }
          text += ev.text;
          content.innerHTML = markdown(text);
          scrollDown();
        } else if (ev.type === 'sources') {
          sources = ev.sources;
          wrap._sources = sources;
        } else if (ev.type === 'refused') wrap.classList.add('refused');
        else if (ev.type === 'error') { wrap.classList.add('error'); text = ev.text; bubble.textContent = text; }
      }
    }
  } catch (err) {
    console.error(err);
    wrap.classList.add('error');
    text = t('networkError');
    bubble.textContent = text;
  }

  if (!wrap.classList.contains('error')) {
    wrap._sources = sources;
    renderSources(bubble, sources);
    addCopy(bubble, () => text);
    state.history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
    state.history = state.history.slice(-10);
  }
  scrollDown();
  state.busy = false; updateSend();
  els.input.focus();
}

// ---------- Citations Popover & Click Handling ----------
let activePopover = null;
function closePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
}

document.addEventListener('click', (e) => {
  const pill = e.target.closest('.cite-pill');
  if (pill) {
    e.stopPropagation();
    const citeId = pill.dataset.cite;
    const msgWrap = pill.closest('.msg');
    const sources = msgWrap?._sources || [];
    const src = sources.find((s) => String(s.id) === String(citeId));

    // Also highlight the corresponding item in sources list below
    const details = msgWrap?.querySelector('details.sources');
    if (details) {
      details.open = true;
      const targetLi = details.querySelector(`li[data-id="${citeId}"]`);
      if (targetLi) {
        targetLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        targetLi.classList.add('source-highlight');
        setTimeout(() => targetLi.classList.remove('source-highlight'), 2000);
      }
    }

    if (!src) return;
    if (activePopover && activePopover._anchor === pill) {
      closePopover();
      return;
    }
    closePopover();

    const popover = document.createElement('div');
    popover.className = 'cite-popover';
    popover._anchor = pill;
    popover.innerHTML = `
      <div class="cite-popover-header">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          <span class="source-badge">[${src.id}]</span>
          <span class="cite-popover-title">${esc(src.title)}</span>
        </div>
        <button type="button" class="cite-popover-close" aria-label="Close">✕</button>
      </div>
      <small class="source-category">${esc(src.category)}</small>
      ${src.excerpt ? `<div class="cite-popover-excerpt">“${esc(src.excerpt)}”</div>` : ''}
    `;
    popover.querySelector('.cite-popover-close').onclick = (ev) => {
      ev.stopPropagation();
      closePopover();
    };
    popover.onclick = (ev) => ev.stopPropagation();

    document.body.appendChild(popover);
    activePopover = popover;

    // Position popover relative to pill
    const rect = pill.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    let top = rect.top - popRect.height - 8;
    if (top < 10) top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - popRect.width / 2;
    if (left < 10) left = 10;
    if (left + popRect.width > window.innerWidth - 10) left = window.innerWidth - popRect.width - 10;

    popover.style.top = `${top + window.scrollY}px`;
    popover.style.left = `${left + window.scrollX}px`;
    return;
  }

  if (activePopover && !e.target.closest('.cite-popover')) {
    closePopover();
  }
});
window.addEventListener('resize', closePopover);
window.addEventListener('scroll', closePopover, true);

// ---------- Composer ----------
function autosize() { els.input.style.height = 'auto'; els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px'; updateSend(); }
function updateSend() { els.send.disabled = state.busy || !els.input.value.trim(); }
els.input.addEventListener('input', autosize);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(els.input.value); }
});
els.form.addEventListener('submit', (e) => { e.preventDefault(); ask(els.input.value); });

applyTheme();
applyLang();
els.input.focus();
