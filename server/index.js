// Worldbuilder server: serves the built game, the shared world edits, and the
// Claude builder chat. Configure with environment variables:
//   ANTHROPIC_API_KEY     enables the chat (keep it in Coolify / .env, never in the repo)
//   PORT                  default 3000
//   DATA_DIR              where shared edits and the chat log are stored (default ./data)
//   CLAUDE_MODEL          default claude-opus-5-5
//   CLAUDE_EFFORT         low | medium | high (default medium)
//   CHAT_LIMIT_PER_HOUR   messages per visitor per hour (default 30)
//   CHAT_LIMIT_PER_DAY    messages for the whole site per day (default 500)
//   STATS_KEY             password for the /stats page (no key, no page)
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { WorldStore } from './worldStore.js';
import { BuilderChat } from './claude.js';
import { Stats, statsPage } from './stats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = +(process.env.PORT || 3000);
const PER_HOUR = +(process.env.CHAT_LIMIT_PER_HOUR || 30);
const PER_DAY = +(process.env.CHAT_LIMIT_PER_DAY || 500);

const store = new WorldStore({ dataDir: DATA_DIR, worldsDirs: [path.join(DIST, 'worlds'), path.join(ROOT, 'public', 'worlds')] });
await store.init();

const logFile = path.join(DATA_DIR, 'chat-log.jsonl');
const stats = new Stats({ dir: path.join(DATA_DIR, 'stats'), places: () => new Set((store.base('home')?.structures || []).map((s) => s.id)) });
stats.init();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stats.stop(); process.exit(0); });
const chat = new BuilderChat(store, {
  log: (entry) => {
    fs.appendFile(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', () => {});
    for (const c of entry.changes || []) stats.add('chat', c.op === 'remove' ? 'removed' : 'built');
    if (entry.usage?.input_tokens) stats.add('chat', 'input-tokens', entry.usage.input_tokens);
    if (entry.usage?.output_tokens) stats.add('chat', 'output-tokens', entry.usage.output_tokens);
  },
});

// ---- rate limits (in memory; reset on restart)
const hits = new Map(); // visitor hash -> timestamps in the last hour
let day = { date: '', count: 0 };
const address = (req) => req.get('cf-connecting-ip') || req.get('x-forwarded-for')?.split(',')[0].trim() || req.socket.remoteAddress || '';
function visitor(req) {
  return crypto.createHash('sha256').update(address(req)).digest('hex').slice(0, 16);
}
function allow(who) {
  const today = new Date().toISOString().slice(0, 10);
  if (day.date !== today) day = { date: today, count: 0 };
  if (day.count >= PER_DAY) return 'The builder has reached its limit for today. Try again tomorrow.';
  const now = Date.now();
  const list = (hits.get(who) || []).filter((t) => now - t < 3600e3);
  if (list.length >= PER_HOUR) return 'You have sent a lot of requests this hour. Give it a little while and try again.';
  list.push(now); hits.set(who, list); day.count += 1;
  return null;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/api/config', (req, res) => res.json({ chat: chat.enabled }));

app.get('/api/worlds/:id/edits', async (req, res) => {
  if (!store.has(req.params.id)) return res.status(404).json({ error: 'Unknown world' });
  res.set('Cache-Control', 'no-store');
  const edits = await store.getEdits(req.params.id);
  // the game polls with the version it has; only send everything when it changed
  if (req.query.known != null && +req.query.known === edits.version) return res.json({ version: edits.version, unchanged: true });
  res.json(edits);
});

app.post('/api/chat', async (req, res) => {
  const { worldId, sessionId, message, context } = req.body || {};
  if (!chat.enabled) return res.status(503).json({ error: 'The builder chat is not set up on this server.' });
  if (!store.has(worldId)) return res.status(400).json({ error: 'The builder only works in the shared worlds.' });
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || text.length > 1000) return res.status(400).json({ error: 'Messages must be 1 to 1000 characters.' });
  if (typeof sessionId !== 'string' || !/^[a-z0-9-]{8,64}$/i.test(sessionId)) return res.status(400).json({ error: 'Bad session.' });
  const who = visitor(req);
  const blocked = allow(who);
  if (blocked) { stats.add('chat', 'limited'); return res.status(429).json({ error: blocked }); }
  stats.add('chat', 'sent');
  try {
    const out = await chat.chat({ sessionId: `${who}:${sessionId}`, worldId, text, context });
    res.json({ ...out, edits: await store.getEdits(worldId) });
  } catch (e) {
    console.error('chat failed', e);
    stats.add('chat', 'failed');
    const busy = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError;
    res.status(busy ? 503 : 500).json({
      error: busy ? 'Claude is busy right now. Try again in a moment.' : 'Something went wrong talking to Claude.',
      edits: await store.getEdits(worldId),
    });
  }
});

// ---- visitor stats
app.post('/api/stats', (req, res) => { stats.record(address(req), req.body); res.status(204).end(); });
const sameKey = (a, b) => {
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
};
app.get('/stats', (req, res) => {
  const key = process.env.STATS_KEY;
  if (!key || !sameKey(req.query.key ?? '', key)) return res.status(404).type('text').send('Not found');
  const days = req.query.days === '7' ? 7 : req.query.days === '0' ? 0 : 30;
  let issue = null;
  for (const dir of [DIST, path.join(ROOT, 'public')]) {
    try { issue = JSON.parse(fs.readFileSync(path.join(dir, 'issues', 'november.json'), 'utf8')); break; } catch { /* try the next */ }
  }
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.type('html').send(statsPage(stats.summary(days), { days, key, world: store.base('home'), issue }));
});

// ---- the built game
app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(DIST, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.get('/{*path}', (req, res, next) => (req.path.startsWith('/api/') ? next() : res.sendFile(path.join(DIST, 'index.html'))));

app.listen(PORT, () => console.log(`Worldbuilder on :${PORT} (chat ${chat.enabled ? 'on' : 'off: no ANTHROPIC_API_KEY'}, data in ${DATA_DIR})`));
