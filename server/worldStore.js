// Shared world edits, stored as one JSON file per world in DATA_DIR. The repo's
// world files (public/worlds) stay the published base; edits made through the
// chat are layered on top for everyone: { version, added: [...], removed: [ids] }.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Planet, R, latLonToDir } from '../src/planet.js';

export class WorldStore {
  constructor({ dataDir, worldsDirs }) {
    this.dataDir = dataDir;
    this.worldsDirs = worldsDirs; // where the published world files live (first that exists wins)
    this.edits = new Map();       // worldId -> edits
    this.bases = new Map();       // worldId -> parsed world file
    this.planets = new Map();     // seed -> Planet (for ground checks)
    this.writing = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    for (const dir of this.worldsDirs) {
      try {
        const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8'));
        for (const w of index) this.bases.set(w.id, JSON.parse(await fs.readFile(path.join(dir, w.file), 'utf8')));
        break;
      } catch { /* try the next directory */ }
    }
    if (!this.bases.size) console.warn('No published worlds found in', this.worldsDirs.join(', '));
  }

  has(worldId) { return this.bases.has(worldId); }
  base(worldId) { return this.bases.get(worldId); }

  _file(worldId) { return path.join(this.dataDir, `${worldId.replace(/[^a-z0-9_-]/gi, '')}.json`); }

  async getEdits(worldId) {
    if (!this.edits.has(worldId)) {
      let edits = { version: 0, added: [], removed: [] };
      try { edits = JSON.parse(await fs.readFile(this._file(worldId), 'utf8')); } catch { /* none yet */ }
      this.edits.set(worldId, edits);
    }
    return this.edits.get(worldId);
  }

  // All structures currently in the world (published base + shared edits).
  async structures(worldId) {
    const edits = await this.getEdits(worldId);
    const removed = new Set(edits.removed);
    return [...(this.base(worldId)?.structures || []).filter((s) => !removed.has(s.id)), ...edits.added];
  }

  async update(worldId, fn) {
    const edits = await this.getEdits(worldId);
    const result = fn(edits);
    edits.version += 1;
    // serialise writes; write to a temp file then rename so a crash never leaves half a file
    this.writing = this.writing.then(async () => {
      const file = this._file(worldId), tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(edits, null, 1));
      await fs.rename(tmp, file);
    }).catch((e) => console.error('Saving world edits failed', e));
    await this.writing;
    return result;
  }

  add(worldId, rec) { return this.update(worldId, (e) => { e.added.push(rec); return rec; }); }

  remove(worldId, id) {
    return this.update(worldId, (e) => {
      const i = e.added.findIndex((s) => s.id === id);
      if (i >= 0) e.added.splice(i, 1);
      else e.removed.push(id);
    });
  }

  planet(worldId) {
    const seed = this.base(worldId).seed >>> 0;
    if (!this.planets.has(seed)) this.planets.set(seed, new Planet(seed));
    return this.planets.get(seed);
  }

  // Terrain height in metres at a point (negative = sea depth). Ignores volcanoes etc.
  elevation(worldId, lat, lon) { return this.planet(worldId).elevation(latLonToDir(lat, lon)); }
}

export function distanceM(a, b) {
  return latLonToDir(a.lat, a.lon).angleTo(latLonToDir(b.lat, b.lon)) * R;
}
