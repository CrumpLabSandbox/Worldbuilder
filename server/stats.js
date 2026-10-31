// Visitor stats, kept on the server: one small JSON file per day in DATA_DIR/stats.
// The game sends batches of named counts; nothing about a person is stored. A
// visitor is a hash of their address with a secret salt and the date, so it can't
// be followed from one day to the next, and a finished day keeps only its totals.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const NAMES = new Set(['click', 'near', 'enter', 'arrive', 'out', 'visit', 'go', 'play', 'dwell']);
const PLACE_NAMES = new Set(['near', 'enter', 'arrive', 'out', 'visit', 'play', 'dwell']); // details must be real places
const DETAIL = /^[a-z0-9][a-z0-9._-]{0,39}$/i, SESSION = /^[a-z0-9]{8,24}$/i;
const MAX_DETAILS = 200;     // distinct details per name, per day
const MAX_SESSIONS = 20000;  // per day
const MAX_FROM = 100;
const CELLS = 72 * 36;       // the heat map: 5 degree squares
const PER_HOUR = 240;        // batches from one address
export const DURATIONS = [['under 30 s', 30], ['30 s to 2 min', 120], ['2 to 10 min', 600], ['10 to 30 min', 1800], ['over 30 min', Infinity]];

const today = () => new Date().toISOString().slice(0, 10);
const blank = (date) => ({ date, visitors: 0, ids: {}, sessions: {}, visits: 0, phone: 0, computer: 0, from: {}, events: {}, grid: {}, secs: 0, durations: DURATIONS.map(() => 0) });
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const bucket = (secs) => DURATIONS.findIndex(([, top]) => secs < top);

export class Stats {
  constructor({ dir, places = () => new Set() }) {
    this.dir = dir;
    this.places = places;     // () => Set of place ids the game may report
    this.dirty = false;
    this.seen = new Map();    // address -> [count, hour], for the rate limit
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true });
    const saltFile = path.join(this.dir, 'salt');
    try { this.salt = fs.readFileSync(saltFile, 'utf8'); }
    catch { this.salt = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(saltFile, this.salt, { mode: 0o600 }); }
    this.day = this._read(today()) || blank(today());
    this.timer = setInterval(() => this.flush(), 30000);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.flush(); }

  _file(date) { return path.join(this.dir, `${date}.json`); }
  _read(date) { try { return JSON.parse(fs.readFileSync(this._file(date), 'utf8')); } catch { return null; } }
  flush() {
    if (!this.dirty) return;
    const tmp = `${this._file(this.day.date)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.day));
    fs.renameSync(tmp, this._file(this.day.date));
    this.dirty = false;
  }
  // A new day starts: the last one keeps its totals and loses its visitor ids.
  _roll() {
    if (this.day.date === today()) return;
    this.day = this._final(this.day);
    this.dirty = true;
    this.flush();
    this.day = this._read(today()) || blank(today());
  }
  _final(d) {
    if (!d.ids && !d.sessions) return d;
    const { ids, sessions, ...rest } = d;
    const durations = [...(d.durations || DURATIONS.map(() => 0))];
    for (const s of Object.values(sessions || {})) durations[bucket(s)]++;
    return { ...rest, durations };
  }

  add(name, detail, n = 1) {
    this._roll();
    const list = (this.day.events[name] ||= {});
    if (!(detail in list) && Object.keys(list).length >= MAX_DETAILS) return;
    bump(list, detail, n);
    this.dirty = true;
  }

  // One batch from the game: { sid, device, from, secs, ev: [[name, detail, n]], grid: [[cell, n]] }
  record(ip, body) {
    if (!body || typeof body !== 'object' || !SESSION.test(body.sid || '')) return false;
    const hour = Math.floor(Date.now() / 3600e3), seen = this.seen.get(ip);
    if (seen?.[1] === hour && seen[0] >= PER_HOUR) return false;
    if (this.seen.size > 50000) this.seen.clear();
    this.seen.set(ip, seen?.[1] === hour ? [seen[0] + 1, hour] : [1, hour]);
    this._roll();
    const d = this.day;
    if (!(body.sid in d.sessions)) {
      if (Object.keys(d.sessions).length >= MAX_SESSIONS) return false;
      d.sessions[body.sid] = 0;
      d.visits++;
      bump(d, body.device === 'phone' ? 'phone' : 'computer');
      const from = typeof body.from === 'string' && DETAIL.test(body.from) ? body.from.toLowerCase() : 'direct';
      if (from in d.from || Object.keys(d.from).length < MAX_FROM) bump(d.from, from);
    }
    const who = crypto.createHash('sha256').update(`${this.salt}:${d.date}:${ip}`).digest('hex').slice(0, 12);
    if (!d.ids[who]) { d.ids[who] = 1; d.visitors++; }
    const secs = Math.min(Math.max(0, Math.round(+body.secs) || 0), 600);
    d.sessions[body.sid] += secs;
    d.secs += secs;
    const places = this.places();
    for (const e of (Array.isArray(body.ev) ? body.ev : []).slice(0, 80)) {
      if (!Array.isArray(e)) continue;
      const [name, detail, n] = e, count = Math.min(Math.max(1, Math.round(+n) || 1), 1000);
      if (!NAMES.has(name) || typeof detail !== 'string' || !DETAIL.test(detail)) continue;
      if (PLACE_NAMES.has(name) && !places.has(detail)) continue;
      this.add(name, detail, count);
    }
    for (const g of (Array.isArray(body.grid) ? body.grid : []).slice(0, 200)) {
      if (Array.isArray(g) && Number.isInteger(g[0]) && g[0] >= 0 && g[0] < CELLS) bump(d.grid, g[0], Math.min(Math.max(1, Math.round(+g[1]) || 1), 100));
    }
    this.dirty = true;
    return true;
  }

  // Totals for the last `days` days (0 for all of them), plus each day's headline numbers.
  summary(days = 30) {
    this._roll();
    this.flush();
    let dates = fs.readdirSync(this.dir).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
    if (days) { const from = new Date(Date.now() - (days - 1) * 86400e3).toISOString().slice(0, 10); dates = dates.filter((d) => d >= from); }
    const t = { perDay: [], visitors: 0, visits: 0, phone: 0, computer: 0, secs: 0, from: {}, events: {}, grid: {}, durations: DURATIONS.map(() => 0) };
    for (const date of dates) {
      const d = date === this.day.date ? this._final(this.day) : this._read(date);
      if (!d) continue;
      t.perDay.push({ date, visitors: d.visitors, visits: d.visits });
      for (const k of ['visitors', 'visits', 'phone', 'computer', 'secs']) t[k] += d[k] || 0;
      for (const [k, n] of Object.entries(d.from || {})) bump(t.from, k, n);
      for (const [k, n] of Object.entries(d.grid || {})) bump(t.grid, k, n);
      for (const [name, list] of Object.entries(d.events || {})) for (const [k, n] of Object.entries(list)) bump((t.events[name] ||= {}), k, n);
      d.durations?.forEach((n, i) => { t.durations[i] += n; });
    }
    return t;
  }
}

// ---------------------------------------------------------------- the page
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Math.round(n || 0).toLocaleString('en-US');
const clock = (secs) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)} h` : secs >= 60 ? `${Math.round(secs / 60)} min` : `${Math.round(secs)} s`);
const sorted = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
const card = (label, value, note = '') => `<div class="card"><div class="v">${value}</div><div class="l">${label}</div>${note ? `<div class="n">${note}</div>` : ''}</div>`;
function table(heads, rows, empty = 'Nothing yet.') {
  if (!rows.length) return `<p class="none">${empty}</p>`;
  return `<table><tr>${heads.map((h, i) => `<th${i ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}
function bars(rows) {
  if (!rows.length) return '<p class="none">Nothing yet.</p>';
  const top = Math.max(...rows.map((r) => r[1]), 1);
  return `<div class="bars">${rows.map(([k, n]) => `<div class="bar"><span class="k">${esc(k)}</span><span class="t"><i style="width:${(100 * n) / top}%"></i></span><span class="c">${num(n)}</span></div>`).join('')}</div>`;
}
function dayChart(perDay) {
  const rows = perDay.slice(-60);
  if (!rows.length) return '<p class="none">No visitors yet.</p>';
  const W = 900, H = 170, top = Math.max(...rows.map((d) => d.visitors), 1), w = W / rows.length;
  const rects = rows.map((d, i) => {
    const h = (d.visitors / top) * (H - 26);
    return `<rect x="${(i * w + 1).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${Math.max(1, w - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${d.date}: ${d.visitors} visitors, ${d.visits} visits</title></rect>`;
  }).join('');
  const tick = (d, i) => `<text x="${i ? W : 0}" y="${H - 3}" text-anchor="${i ? 'end' : 'start'}">${d.date}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${rects}${tick(rows[0], 0)}${rows.length > 1 ? tick(rows[rows.length - 1], 1) : ''}<text x="${W}" y="11" text-anchor="end">peak ${num(top)}</text></svg>`;
}
function heatMap(grid, marks) {
  const cell = 12, W = 72 * cell, H = 36 * cell, top = Math.max(...Object.values(grid), 1);
  const rects = Object.entries(grid).map(([k, n]) => {
    const c = +k, x = c % 72, y = 35 - Math.floor(c / 72);
    return `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#ffc94d" opacity="${(0.15 + 0.85 * Math.sqrt(n / top)).toFixed(2)}"/>`;
  }).join('');
  const dots = marks.map((p) => `<circle cx="${(((p.lon + 180) / 360) * W).toFixed(1)}" cy="${(((90 - p.lat) / 180) * H).toFixed(1)}" r="3"><title>${esc(p.name)}</title></circle>`).join('');
  return `<svg class="map" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0b1220"/>${rects}${dots}</svg>`;
}

const CSS = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#080d18;color:#dfe6f2;font:15px/1.45 system-ui,-apple-system,sans-serif;padding:24px 16px 60px}
main{max-width:980px;margin:auto}h1{font-size:24px;margin:0 0 2px}h2{font-size:17px;margin:34px 0 10px;color:#ffc94d}p.sub,.none{color:#8a97ad}
nav{margin:10px 0 18px}nav a{color:#8fc1ff;margin-right:14px;text-decoration:none}nav a.on{color:#fff;font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.card{background:#111a2c;border-radius:8px;padding:12px 14px}.v{font-size:26px;font-weight:700}.l{color:#a9b5c9;font-size:13px}.n{color:#74819a;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:#8a97ad;font-weight:500;border-bottom:1px solid #26324a;padding:5px 6px}td{border-bottom:1px solid #18223a;padding:5px 6px}.r{text-align:right;font-variant-numeric:tabular-nums}
.bars{display:grid;gap:5px}.bar{display:grid;grid-template-columns:minmax(120px,240px) 1fr 70px;gap:8px;align-items:center;font-size:14px}.k{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.t{background:#111a2c;height:14px;border-radius:3px;overflow:hidden}.t i{display:block;height:100%;background:#4d9fff}.c{text-align:right;font-variant-numeric:tabular-nums}
svg{display:block;width:100%;height:auto}.chart rect{fill:#4d9fff}.chart text{fill:#8a97ad;font-size:11px}.map{border-radius:8px}.map circle{fill:#ff6a3d;stroke:#fff;stroke-width:.6}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 28px}footer{margin-top:40px;color:#74819a;font-size:13px}`;

const CLICK_NAMES = { 'intro-start': 'Start exploring', 'intro-more': 'Learn more', 'about-start': 'Start exploring (About)', 'btn-ride': 'Ride the coaster', 'btn-dial': 'Dial in to the BBS', 'btn-type': 'Type on the computer', 'btn-organ': 'Play the organ', 'btn-university': 'Enter the University', 'uni-window': 'Look out the window', 'uni-leave': 'Leave the office', 'btn-hands': 'About Cognitive Hands', 'organ-hands': 'About the hands (organ)', 'type-hands': 'About the hands (typing)', 'hands-link': 'Go to Cognitive Hands' };

// `world` is the published world file; `issue` is the November list.
export function statsPage(s, { days, key, world, issue }) {
  const ev = s.events, names = new Map((world?.structures || []).map((p) => [p.id, p.name || p.id]));
  const place = (id) => esc(names.get(id) || id);
  const link = (d, label) => `<a class="${days === d ? 'on' : ''}" href="?key=${encodeURIComponent(key)}&days=${d}">${label}</a>`;
  const avg = s.visits ? s.secs / s.visits : 0;
  const pieces = (issue?.pieces || []).map((p) => {
    const id = p.place || (names.has(p.id) ? p.id : null);
    const n = (name) => num(id ? ev[name]?.[id] : 0);
    const out = p.id === 'cognitive-hands' ? num(ev.click?.['hands-link']) : n('out'); // its link is on an info card, at two places
    return [`${esc(p.title)}${id ? '' : ' <span class="none">(no place yet)</span>'}`, n('near'), n('enter'), n('arrive'), out, id ? clock(ev.dwell?.[id] || 0) : '0 s'];
  });
  const chat = ev.chat || {};
  const clicks = sorted(ev.click).slice(0, 25).map(([k, n]) => [CLICK_NAMES[k] || k, n]);
  const go = ev.go || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Worldbuilder stats</title><style>${CSS}</style></head><body><main>
<h1>Worldbuilder stats</h1><p class="sub">Anonymous counts from worlds.megazine.org</p>
<nav>${link(7, '7 days')}${link(30, '30 days')}${link(0, 'All time')}</nav>
<div class="cards">
${card('Visitors', num(s.visitors), 'each person once per day, added up')}${card('Visits', num(s.visits))}${card('Average visit', clock(avg))}${card('Total time', clock(s.secs))}${card('On phones', `${s.visits ? Math.round((100 * s.phone) / s.visits) : 0}%`, `${num(s.phone)} phone, ${num(s.computer)} computer`)}
</div>
<h2>Visitors per day</h2>${dayChart(s.perDay)}
<h2>November issue</h2>${table(['Piece', 'Came near', 'Went in', 'Arrived', 'Left for the piece', 'Time inside'], pieces)}
<h2>Where people went</h2>${bars(sorted(ev.near).slice(0, 25).map(([k, n]) => [names.get(k) || k, n]))}
<h2>Where people flew</h2>${heatMap(s.grid, world?.structures?.filter((p) => p.lat != null) || [])}
<p class="sub">Brighter squares had more time spent in them. Dots are the published places.</p>
<div class="two"><div><h2>Top clicks</h2>${bars(clicks)}</div>
<div><h2>Getting around</h2>${bars([['Visit place menu', go.menu || 0], ['Double-click on the globe', go['double-click'] || 0], ['Catapult shots', go.catapult || 0], ['Coaster rides', go.coaster || 0], ['Visits using a gamepad', go.gamepad || 0]].filter((r) => r[1]))}<p class="sub">Minutes flying by hand: ${num((go.flying || 0) / 60)}</p>
<h2>Played from the menu</h2>${bars(sorted(ev.visit).slice(0, 12).map(([k, n]) => [names.get(k) || k, n]))}</div></div>
<div class="two"><div><h2>Claude chat</h2>${table(['', 'Count'], [['Messages', num(chat.sent)], ['Things built', num(chat.built)], ['Things removed', num(chat.removed)], ['Rate limited', num(chat.limited)], ['Failed', num(chat.failed)], ['Input tokens', num(chat['input-tokens'])], ['Output tokens', num(chat['output-tokens'])]])}</div>
<div><h2>How long people stayed</h2>${bars(DURATIONS.map(([label], i) => [label, s.durations[i]]))}<h2>Came from</h2>${bars(sorted(s.from).slice(0, 12))}</div></div>
<footer>Finished days keep totals only. Times can run a little behind, as the game reports in every 30 seconds.</footer>
</main></body></html>`;
}
