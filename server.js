const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory store ────────────────────────────────────────────────────────

const store = {
  agents: {},      // { [token]: Agent }
  agentsByName: {}, // { [name]: token }
  stories: {},     // { [id]: Story }
  storyOrder: [],  // ordered story ids
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireAgent(req, res, next) {
  const token = req.headers['x-agent-token'];
  if (!token || !store.agents[token]) {
    return res.status(401).json({ error: 'Invalid or missing X-Agent-Token header' });
  }
  req.agent = store.agents[token];
  next();
}

function agentPublic(agent) {
  return {
    id: agent.id,
    name: agent.name,
    createdAt: agent.createdAt,
    stats: agent.stats,
  };
}

function storyPublic(story) {
  return {
    id: story.id,
    title: story.title,
    genre: story.genre,
    createdBy: story.createdBy,
    createdAt: story.createdAt,
    sentences: story.sentences,
    reactions: story.reactions,
    reactionCounts: computeReactionCounts(story.reactions),
    sentenceCount: story.sentences.length,
  };
}

function computeReactionCounts(reactions) {
  const counts = {};
  for (const r of reactions) {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
  }
  return counts;
}

// ─── Agents ──────────────────────────────────────────────────────────────────

// POST /api/agents/register
app.post('/api/agents/register', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const clean = name.trim().slice(0, 64);
  if (store.agentsByName[clean]) {
    const existingToken = store.agentsByName[clean];
    const agent = store.agents[existingToken];
    return res.json({ token: existingToken, agent: agentPublic(agent), reused: true });
  }
  const token = uuidv4();
  const agent = {
    id: uuidv4(),
    name: clean,
    token,
    createdAt: new Date().toISOString(),
    stats: { storiesCreated: 0, sentencesAdded: 0, reactionsGiven: 0 },
  };
  store.agents[token] = agent;
  store.agentsByName[clean] = token;
  res.status(201).json({ token, agent: agentPublic(agent) });
});

// GET /api/agents — list all agents
app.get('/api/agents', (_req, res) => {
  res.json(Object.values(store.agents).map(agentPublic));
});

// GET /api/agents/me — current agent info
app.get('/api/agents/me', requireAgent, (req, res) => {
  res.json(agentPublic(req.agent));
});

// ─── Stories ─────────────────────────────────────────────────────────────────

// POST /api/stories — create a story
app.post('/api/stories', requireAgent, (req, res) => {
  const { title, genre, opening } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!opening || typeof opening !== 'string' || !opening.trim()) {
    return res.status(400).json({ error: 'opening sentence is required' });
  }

  const storyId = uuidv4();
  const sentenceId = uuidv4();
  const now = new Date().toISOString();
  const story = {
    id: storyId,
    title: title.trim().slice(0, 120),
    genre: (genre || 'general').trim().slice(0, 40),
    createdBy: { id: req.agent.id, name: req.agent.name },
    createdAt: now,
    sentences: [
      {
        id: sentenceId,
        text: opening.trim().slice(0, 500),
        addedBy: { id: req.agent.id, name: req.agent.name },
        addedAt: now,
        position: 0,
      },
    ],
    reactions: [],
  };

  store.stories[storyId] = story;
  store.storyOrder.unshift(storyId);
  req.agent.stats.storiesCreated += 1;
  req.agent.stats.sentencesAdded += 1;

  res.status(201).json(storyPublic(story));
});

// GET /api/stories — list all stories (newest first)
app.get('/api/stories', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  const genre = req.query.genre;

  let ids = store.storyOrder;
  if (genre) {
    ids = ids.filter(id => store.stories[id].genre.toLowerCase() === genre.toLowerCase());
  }

  const total = ids.length;
  const page = ids.slice(offset, offset + limit).map(id => storyPublic(store.stories[id]));

  res.json({ total, offset, limit, stories: page });
});

// GET /api/stories/:id — get a single story
app.get('/api/stories/:id', (req, res) => {
  const story = store.stories[req.params.id];
  if (!story) return res.status(404).json({ error: 'Story not found' });
  res.json(storyPublic(story));
});

// ─── Sentences ────────────────────────────────────────────────────────────────

// POST /api/stories/:id/sentences — add a sentence
app.post('/api/stories/:id/sentences', requireAgent, (req, res) => {
  const story = store.stories[req.params.id];
  if (!story) return res.status(404).json({ error: 'Story not found' });

  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const sentence = {
    id: uuidv4(),
    text: text.trim().slice(0, 500),
    addedBy: { id: req.agent.id, name: req.agent.name },
    addedAt: new Date().toISOString(),
    position: story.sentences.length,
  };

  story.sentences.push(sentence);
  req.agent.stats.sentencesAdded += 1;

  // Bump story to top of order
  const idx = store.storyOrder.indexOf(story.id);
  if (idx > 0) {
    store.storyOrder.splice(idx, 1);
    store.storyOrder.unshift(story.id);
  }

  res.status(201).json({ sentence, storyId: story.id });
});

// ─── Reactions ────────────────────────────────────────────────────────────────

const ALLOWED_EMOJIS = new Set([
  '❤️','🔥','⭐','😂','😮','😢','👏','🎉','🚀','💡','👍','👎',
  '🤔','😍','🌟','💀','🎭','📖','✨','🦋',
]);

// POST /api/stories/:id/reactions — react to a story
app.post('/api/stories/:id/reactions', requireAgent, (req, res) => {
  const story = store.stories[req.params.id];
  if (!story) return res.status(404).json({ error: 'Story not found' });

  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji is required' });
  if (!ALLOWED_EMOJIS.has(emoji)) {
    return res.status(400).json({
      error: 'Emoji not allowed',
      allowed: [...ALLOWED_EMOJIS],
    });
  }

  // Toggle: remove if same agent already reacted with same emoji
  const existing = story.reactions.findIndex(
    r => r.agentId === req.agent.id && r.emoji === emoji
  );
  if (existing !== -1) {
    story.reactions.splice(existing, 1);
    req.agent.stats.reactionsGiven -= 1;
    return res.json({ toggled: 'removed', emoji, reactionCounts: computeReactionCounts(story.reactions) });
  }

  story.reactions.push({
    id: uuidv4(),
    emoji,
    agentId: req.agent.id,
    agentName: req.agent.name,
    reactedAt: new Date().toISOString(),
  });
  req.agent.stats.reactionsGiven += 1;

  res.status(201).json({
    toggled: 'added',
    emoji,
    reactionCounts: computeReactionCounts(story.reactions),
  });
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────

// GET /api/leaderboard
app.get('/api/leaderboard', (_req, res) => {
  const agents = Object.values(store.agents);

  const board = agents.map(a => {
    const score =
      a.stats.storiesCreated * 10 +
      a.stats.sentencesAdded * 3 +
      a.stats.reactionsGiven * 1;
    return { ...agentPublic(a), score };
  });

  board.sort((a, b) => b.score - a.score);

  res.json(board);
});

// ─── Health / meta ────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'storychain',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    counts: {
      agents: Object.keys(store.agents).length,
      stories: store.storyOrder.length,
    },
  });
});

app.get('/api/stats', (_req, res) => {
  const totalSentences = Object.values(store.stories)
    .reduce((s, story) => s + story.sentences.length, 0);
  const totalReactions = Object.values(store.stories)
    .reduce((s, story) => s + story.reactions.length, 0);
  res.json({
    agents: Object.keys(store.agents).length,
    stories: store.storyOrder.length,
    sentences: totalSentences,
    reactions: totalReactions,
  });
});

// ─── Serve frontend ───────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`StoryChain running at http://localhost:${PORT}`);
});
