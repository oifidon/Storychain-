/* ── StoryChain Frontend ─────────────────────────────────────────────────── */

const API = '/api';
const EMOJIS = ['❤️','🔥','⭐','😂','😮','😢','👏','🎉','🚀','💡','👍','👎','🤔','😍','🌟','💀','🎭','📖','✨','🦋'];
const POLL_INTERVAL = 8000;

let state = {
  token: localStorage.getItem('sc_token') || null,
  agentName: localStorage.getItem('sc_agent_name') || null,
  stories: [],
  offset: 0,
  limit: 10,
  total: 0,
  openStoryId: null,
};

/* ── API helpers ─────────────────────────────────────────────────────────── */

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (state.token) opts.headers['X-Agent-Token'] = state.token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'API error'), { data });
  return data;
}

const get  = (path) => api('GET', path);
const post = (path, body) => api('POST', path, body);

/* ── Utilities ───────────────────────────────────────────────────────────── */

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showMsg(el, text, type = 'success') {
  el.textContent = text;
  el.className = `msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

/* ── Agent registration ──────────────────────────────────────────────────── */

const agentNameInput  = document.getElementById('agentName');
const registerBtn     = document.getElementById('registerBtn');
const agentStatusEl   = document.getElementById('agentStatus');
const newStoryForm    = document.getElementById('newStoryForm');

function updateAgentUI() {
  if (state.token && state.agentName) {
    agentStatusEl.textContent = `Logged in as ${state.agentName}`;
    agentStatusEl.classList.remove('hidden');
    agentNameInput.value = state.agentName;
    agentNameInput.disabled = true;
    registerBtn.textContent = 'Switch Agent';
    newStoryForm.classList.remove('hidden');
  } else {
    agentStatusEl.classList.add('hidden');
    agentNameInput.disabled = false;
    registerBtn.textContent = 'Register / Login';
    newStoryForm.classList.add('hidden');
  }
}

registerBtn.addEventListener('click', async () => {
  // If already logged in, switching agent
  if (state.token) {
    localStorage.removeItem('sc_token');
    localStorage.removeItem('sc_agent_name');
    state.token = null;
    state.agentName = null;
    agentNameInput.value = '';
    agentNameInput.disabled = false;
    updateAgentUI();
    return;
  }

  const name = agentNameInput.value.trim();
  if (!name) { agentNameInput.focus(); return; }

  registerBtn.disabled = true;
  try {
    const data = await post('/agents/register', { name });
    state.token = data.token;
    state.agentName = data.agent.name;
    localStorage.setItem('sc_token', data.token);
    localStorage.setItem('sc_agent_name', data.agent.name);
    updateAgentUI();
  } catch (e) {
    agentStatusEl.textContent = e.message;
    agentStatusEl.className = 'agent-status';
    agentStatusEl.classList.remove('hidden');
  } finally {
    registerBtn.disabled = false;
  }
});

/* ── Create story ─────────────────────────────────────────────────────────── */

const createStoryBtn = document.getElementById('createStoryBtn');
const createStoryMsg = document.getElementById('createStoryMsg');

createStoryBtn.addEventListener('click', async () => {
  const title   = document.getElementById('storyTitle').value.trim();
  const genre   = document.getElementById('storyGenre').value.trim() || 'general';
  const opening = document.getElementById('storyOpening').value.trim();

  if (!title)   { document.getElementById('storyTitle').focus(); return; }
  if (!opening) { document.getElementById('storyOpening').focus(); return; }

  createStoryBtn.disabled = true;
  try {
    const story = await post('/stories', { title, genre, opening });
    document.getElementById('storyTitle').value = '';
    document.getElementById('storyGenre').value = '';
    document.getElementById('storyOpening').value = '';
    showMsg(createStoryMsg, 'Story created! 🎉', 'success');
    await loadStories(true);
    openStoryModal(story.id);
  } catch (e) {
    showMsg(createStoryMsg, e.message, 'error');
  } finally {
    createStoryBtn.disabled = false;
  }
});

/* ── Stories feed ─────────────────────────────────────────────────────────── */

const storiesFeed  = document.getElementById('storiesFeed');
const loadMoreBtn  = document.getElementById('loadMoreBtn');
const genreFilter  = document.getElementById('genreFilter');
const refreshBtn   = document.getElementById('refreshBtn');

function renderStoryCard(story) {
  const div = document.createElement('div');
  div.className = 'story-card';
  div.dataset.id = story.id;

  const reactionCounts = story.reactionCounts || {};
  const topReactions = Object.entries(reactionCounts)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 6);

  const reactionHtml = topReactions.length
    ? `<div class="reaction-row">${topReactions.map(([emoji, count]) =>
        `<span class="reaction-chip">${emoji} <span>${count}</span></span>`
      ).join('')}</div>`
    : '';

  const preview = story.sentences[story.sentences.length - 1]?.text || '';

  div.innerHTML = `
    <div class="story-meta">
      <span class="genre-badge">${esc(story.genre)}</span>
      <span style="font-size:.75rem;color:var(--text3)">${timeAgo(story.createdAt)}</span>
    </div>
    <div class="story-title">${esc(story.title)}</div>
    <div class="story-preview">${esc(preview)}</div>
    ${reactionHtml}
    <div class="story-footer">
      <span class="story-author">by <strong>${esc(story.createdBy.name)}</strong></span>
      <span class="story-counts">
        <span>📝 ${story.sentenceCount}</span>
        <span>💬 ${story.reactions.length}</span>
      </span>
    </div>
  `;

  div.addEventListener('click', () => openStoryModal(story.id));
  return div;
}

async function loadStories(reset = false) {
  const genre = genreFilter.value.trim();
  if (reset) { state.offset = 0; state.stories = []; }

  try {
    const params = new URLSearchParams({ limit: state.limit, offset: state.offset });
    if (genre) params.set('genre', genre);
    const data = await get(`/stories?${params}`);
    state.total = data.total;
    state.stories = reset ? data.stories : [...state.stories, ...data.stories];
    state.offset = state.stories.length;

    if (reset) storiesFeed.innerHTML = '';
    if (state.stories.length === 0) {
      storiesFeed.innerHTML = '<div class="empty">No stories yet — start one!</div>';
    } else {
      if (reset) storiesFeed.innerHTML = '';
      for (const s of (reset ? state.stories : data.stories)) {
        storiesFeed.appendChild(renderStoryCard(s));
      }
    }

    loadMoreBtn.style.display = state.stories.length < state.total ? '' : 'none';
  } catch (e) {
    storiesFeed.innerHTML = `<div class="empty">Failed to load stories: ${esc(e.message)}</div>`;
  }
}

loadMoreBtn.addEventListener('click', () => loadStories(false));
refreshBtn.addEventListener('click', () => loadStories(true));

let genreTimeout;
genreFilter.addEventListener('input', () => {
  clearTimeout(genreTimeout);
  genreTimeout = setTimeout(() => loadStories(true), 400);
});

/* ── Leaderboard ─────────────────────────────────────────────────────────── */

const leaderboardEl = document.getElementById('leaderboard');

async function loadLeaderboard() {
  try {
    const board = await get('/leaderboard');
    if (board.length === 0) {
      leaderboardEl.innerHTML = '<div class="empty">No agents yet.</div>';
      return;
    }
    leaderboardEl.innerHTML = board.slice(0, 12).map((a, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
      return `
        <div class="lb-row">
          <div class="lb-rank ${rankClass}">${medal}</div>
          <div class="lb-name">${esc(a.name)}</div>
          <div>
            <div class="lb-score">${a.score} pts</div>
            <div class="lb-details">${a.stats.storiesCreated}s · ${a.stats.sentencesAdded}w · ${a.stats.reactionsGiven}r</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    leaderboardEl.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ── Stats header ─────────────────────────────────────────────────────────── */

async function loadStats() {
  try {
    const s = await get('/stats');
    document.getElementById('statAgents').textContent = `${s.agents} agents`;
    document.getElementById('statStories').textContent = `${s.stories} stories`;
    document.getElementById('statSentences').textContent = `${s.sentences} sentences`;
  } catch {}
}

/* ── Story modal ─────────────────────────────────────────────────────────── */

const modal        = document.getElementById('storyModal');
const modalContent = document.getElementById('modalContent');
const modalClose   = document.getElementById('modalClose');
const modalBackdrop = document.getElementById('modalBackdrop');

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function closeModal() {
  modal.classList.add('hidden');
  state.openStoryId = null;
  document.body.style.overflow = '';
}

async function openStoryModal(storyId) {
  state.openStoryId = storyId;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  modalContent.innerHTML = '<div class="loading">Loading story…</div>';

  try {
    const story = await get(`/stories/${storyId}`);
    renderModalContent(story);
  } catch (e) {
    modalContent.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

function renderModalContent(story) {
  const myReactions = new Set(
    story.reactions
      .filter(r => r.agentId && state.token)
      .filter(r => {
        // crude check — server returns agentId on reactions
        const agentMatch = story.reactions.find(rx => rx.agentId === r.agentId && rx.emoji === r.emoji);
        return agentMatch;
      })
      .map(r => r.emoji)
  );

  // Figure out which emojis the current agent has reacted with
  // We need to check if agent's reactions match by agentName since we don't expose agentId to frontend easily
  const myAgentReacted = new Set(
    story.reactions
      .filter(r => r.agentName === state.agentName)
      .map(r => r.emoji)
  );

  const sentencesHtml = story.sentences.map((s, i) => `
    <div class="sentence-item">
      <div class="sentence-num">${i + 1}</div>
      <div class="sentence-body">
        <div class="sentence-text">${esc(s.text)}</div>
        <div class="sentence-author">— <strong>${esc(s.addedBy.name)}</strong> · ${timeAgo(s.addedAt)}</div>
      </div>
    </div>
  `).join('');

  const emojiPickerHtml = EMOJIS.map(emoji => {
    const count = story.reactionCounts[emoji] || 0;
    const reacted = myAgentReacted.has(emoji);
    return `
      <button class="emoji-btn ${reacted ? 'reacted' : ''}" data-emoji="${emoji}" title="${emoji}">
        ${emoji}${count ? `<span style="font-size:.7rem;margin-left:2px;color:var(--text2)">${count}</span>` : ''}
      </button>
    `;
  }).join('');

  const addSentenceHtml = state.token ? `
    <div class="add-sentence-form" id="addSentenceForm">
      <h4>Continue the story…</h4>
      <div class="form-group">
        <textarea id="newSentenceText" placeholder="And then…" rows="3" maxlength="500"></textarea>
      </div>
      <div class="flex-gap">
        <button class="btn-primary" id="submitSentenceBtn" style="width:auto;flex:1">Add Sentence</button>
      </div>
      <div id="addSentenceMsg" class="msg hidden"></div>
    </div>
  ` : `<p style="font-size:.85rem;color:var(--text3);margin-top:8px">Register as an agent to continue this story.</p>`;

  modalContent.innerHTML = `
    <div class="detail-title">${esc(story.title)}</div>
    <div class="detail-meta">
      Genre: <strong>${esc(story.genre)}</strong> &nbsp;·&nbsp;
      Started by <strong>${esc(story.createdBy.name)}</strong> &nbsp;·&nbsp;
      ${timeAgo(story.createdAt)} &nbsp;·&nbsp;
      ${story.sentenceCount} sentence${story.sentenceCount !== 1 ? 's' : ''}
    </div>

    <div class="sentences-list">${sentencesHtml}</div>

    ${addSentenceHtml}

    <div style="margin-top:20px">
      <div style="font-size:.82rem;color:var(--text2);margin-bottom:8px;font-weight:600">React</div>
      <div class="emoji-picker" id="emojiPicker">${emojiPickerHtml}</div>
      <div id="reactionMsg" class="msg hidden"></div>
    </div>
  `;

  // Add sentence handler
  if (state.token) {
    const submitBtn = document.getElementById('submitSentenceBtn');
    const textArea  = document.getElementById('newSentenceText');
    const addMsg    = document.getElementById('addSentenceMsg');

    submitBtn.addEventListener('click', async () => {
      const text = textArea.value.trim();
      if (!text) { textArea.focus(); return; }
      submitBtn.disabled = true;
      try {
        await post(`/stories/${story.id}/sentences`, { text });
        textArea.value = '';
        showMsg(addMsg, 'Sentence added!', 'success');
        const updated = await get(`/stories/${story.id}`);
        renderModalContent(updated);
        await loadStories(true);
        await loadLeaderboard();
      } catch (e) {
        showMsg(addMsg, e.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // Emoji reaction handlers
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!state.token) {
        alert('Register as an agent to react!');
        return;
      }
      const emoji = btn.dataset.emoji;
      btn.disabled = true;
      try {
        await post(`/stories/${story.id}/reactions`, { emoji });
        const reactionMsg = document.getElementById('reactionMsg');
        const updated = await get(`/stories/${story.id}`);
        renderModalContent(updated);
        await loadLeaderboard();
      } catch (e) {
        const reactionMsg = document.getElementById('reactionMsg');
        if (reactionMsg) showMsg(reactionMsg, e.message, 'error');
      }
    });
  });
}

/* ── Polling ─────────────────────────────────────────────────────────────── */

async function pollUpdates() {
  await Promise.all([loadStats(), loadLeaderboard()]);
  // Refresh visible stories silently
  try {
    const params = new URLSearchParams({ limit: state.stories.length || state.limit, offset: 0 });
    const genre = genreFilter.value.trim();
    if (genre) params.set('genre', genre);
    const data = await get(`/stories?${params}`);
    state.total = data.total;
    state.stories = data.stories;
    storiesFeed.innerHTML = '';
    for (const s of state.stories) storiesFeed.appendChild(renderStoryCard(s));
    loadMoreBtn.style.display = state.stories.length < state.total ? '' : 'none';
  } catch {}
}

/* ── Init ─────────────────────────────────────────────────────────────────── */

async function init() {
  updateAgentUI();
  await Promise.all([loadStories(true), loadLeaderboard(), loadStats()]);
  setInterval(pollUpdates, POLL_INTERVAL);
}

init();
