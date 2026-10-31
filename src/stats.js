// Anonymous visitor counts: named events go to the game's own server in small
// batches, with no text, names or positions beyond coarse 5 degree map squares.
// Copies running locally send nothing (add ?stats=test to try it).
const live = new URLSearchParams(location.search).get('stats') === 'test'
  || !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|.*\.local$)/.test(location.hostname);
const sid = Math.random().toString(36).slice(2, 12).padEnd(8, '0');
const pending = new Map();   // 'name detail' -> count
const grid = new Map();      // map square -> count
const nearby = new Set();    // places already counted this visit
const onceOnly = new Set();
let secs = 0, first = true;

export function track(name, detail, n = 1) {
  if (!live) return;
  const k = `${name} ${detail}`;
  pending.set(k, (pending.get(k) || 0) + n);
}
export function trackOnce(name, detail) {
  const k = `${name} ${detail}`;
  if (!onceOnly.has(k)) { onceOnly.add(k); track(name, detail); }
}

export function sendStats() {
  if (!live || (!first && !pending.size && !grid.size && !secs)) return;
  const ev = [...pending].slice(0, 80).map(([k, n]) => { pending.delete(k); return [...k.split(' '), n]; });
  const body = { sid, secs, ev, grid: [...grid] };
  if (first) {
    let from = '';
    try { from = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* no referrer */ }
    Object.assign(body, { device: navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches ? 'phone' : 'computer', from: from === location.hostname ? '' : from });
  }
  const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
  if (navigator.sendBeacon('api/stats', blob)) { first = false; secs = 0; grid.clear(); }
}

// `where()` gives { lat, lon, alt } and `places()` the world's published places.
export function startStats({ where, places, dirOf }) {
  if (!live) return;
  let last = null, tick = 0;
  setInterval(() => {
    if (document.hidden) return;
    secs += 2;
    const p = where();
    if (!p) return;
    if (last && Math.hypot(p.lat - last.lat, p.lon - last.lon) > 0.01 && Math.hypot(p.lat - last.lat, p.lon - last.lon) < 12) track('go', 'flying', 2);
    last = p;
    if (++tick % 5 === 0) {
      const cell = Math.min(35, Math.floor((p.lat + 90) / 5)) * 72 + Math.min(71, Math.floor((p.lon + 180) / 5));
      grid.set(cell, (grid.get(cell) || 0) + 1);
    }
    if (p.alt > 2500) return;
    const me = dirOf(p);
    for (const s of places()) {
      if (nearby.has(s.id)) continue;
      if (me.dot(dirOf(s)) > 0.96) { nearby.add(s.id); track('near', s.id); } // within about 3 km
    }
  }, 2000);
  setTimeout(sendStats, 6000);
  setInterval(sendStats, 30000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) sendStats(); });
  window.addEventListener('pagehide', sendStats);
  // every named button and link, so new ones count without further work
  document.addEventListener('click', (e) => { const b = e.target.closest?.('button[id], a[id]'); if (b) track('click', b.id); }, true);
}
