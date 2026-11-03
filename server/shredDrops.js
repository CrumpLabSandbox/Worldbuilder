// The Shred Pile's mailbox. The Shred Hole (https://samuelling.github.io/Tunnel/) posts a
// "debris drop" whenever something falls through its portal; the game polls for new drops and
// drops the pieces out of the sky portal onto the pile. Drops are kept in DATA_DIR as JSON lines.
//
// Debris Drop v1 (lengths in metres, colours #rrggbb):
// { v: 1, id, at, source: "shred-hole",
//   object: { name, icon, verdict, quip, mass },
//   spray, colors: [...],
//   pieces: [{ c, i, m, p: [x,y,z,…] hull points, q: [x,y,z,w], o: [x,y,z], v: [vx,vy,vz] }],
//   particles: { count, colors } }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const KEEP = 400;           // drops remembered (the pile is rebuilt from these)
const MAX_PIECES = 120, MAX_PAYLOAD_PIECES = 400;   // a payload = several objects sent in one go
const MAX_POINTS = 48;

const hex = (s, d) => (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s) ? s : d);
const num = (v, d, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const str = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').slice(0, n) : '');

// Validate and normalise an incoming drop. Returns null if it is unusable.
export function cleanDrop(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.pieces)) return null;
  const pieces = [];
  for (const p of d.pieces.slice(0, d.payload ? MAX_PAYLOAD_PIECES : MAX_PIECES)) {
    if (!p || !Array.isArray(p.p)) continue;
    const pts = p.p.slice(0, MAX_POINTS * 3).map((v) => num(v, 0, -5, 5));
    if (pts.length < 12) continue;
    const q = Array.isArray(p.q) && p.q.length === 4 ? p.q.map((v) => num(v, 0, -1, 1)) : [0, 0, 0, 1];
    pieces.push({
      c: hex(p.c, '#999999'), i: hex(p.i, hex(p.c, '#999999')),
      m: num(p.m, 0.1, 0.0001, 5000),
      p: pts.slice(0, pts.length - (pts.length % 3)),
      q, o: Array.isArray(p.o) ? p.o.slice(0, 3).map((v) => num(v, 0, -5, 5)) : [0, 0, 0],
      v: Array.isArray(p.v) ? p.v.slice(0, 3).map((v) => num(v, 0, -80, 80)) : [0, -10, 0],
    });
  }
  if (!pieces.length) return null;
  const o = d.object || {};
  return {
    v: 1,
    id: crypto.randomUUID(),
    at: Date.now(),
    source: str(d.source, 40) || 'shred-hole',
    object: { name: str(o.name, 40) || 'Something', icon: str(o.icon, 8) || '✨', verdict: str(o.verdict, 40), quip: str(o.quip, 200), mass: num(o.mass, 1, 0, 1e5) },
    ...(d.payload ? { payload: true, objects: (Array.isArray(d.objects) ? d.objects : []).slice(0, 60).map((x) => ({ name: str(x?.name, 40), icon: str(x?.icon, 8), verdict: str(x?.verdict, 40), mass: num(x?.mass, 0, 0, 1e5), pieces: num(x?.pieces, 0, 0, 1000) })) } : {}),
    spray: str(d.spray, 16),
    colors: (Array.isArray(d.colors) ? d.colors : []).slice(0, 8).map((c) => hex(c, '#cccccc')),
    pieces,
    particles: { count: num(d.particles?.count, 0, 0, 1e5), colors: (d.particles?.colors || []).slice(0, 4).map((c) => hex(c, '#cccccc')) },
  };
}

export class ShredDrops {
  constructor({ dir }) {
    this.file = path.join(dir, 'shred-drops.jsonl');
    this.drops = [];
  }

  init() {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      for (const l of lines.slice(-KEEP)) { try { this.drops.push(JSON.parse(l)); } catch { /* skip a bad line */ } }
    } catch { /* no drops yet */ }
  }

  add(raw) {
    const d = cleanDrop(raw);
    if (!d) return null;
    // keep times strictly increasing so "since" polling never misses one
    const last = this.drops[this.drops.length - 1];
    if (last && d.at <= last.at) d.at = last.at + 1;
    this.drops.push(d);
    fs.appendFile(this.file, JSON.stringify(d) + '\n', () => {});
    if (this.drops.length > KEEP * 1.5) {
      this.drops = this.drops.slice(-KEEP);
      fs.writeFile(this.file, this.drops.map((x) => JSON.stringify(x)).join('\n') + '\n', () => {});
    }
    return d;
  }

  since(t) {
    t = +t || 0;
    return this.drops.filter((d) => d.at > t).slice(-KEEP);
  }
}
