// World definitions and persistence.
// Repo worlds live in public/worlds/*.json (editable in git). The server layers
// shared edits on top (structures built through the Claude chat, seen by everyone),
// and the browser keeps a private local overlay (added/removed structures) per
// world. Local worlds created with "New world" or "Import" live entirely in
// localStorage.

const LS = {
  overlay: (id) => `wb:overlay:${id}`,
  local: (id) => `wb:world:${id}`,
  localList: 'wb:localWorlds',
  last: 'wb:lastWorld',
};

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('localStorage write failed', e); }
}
function lsDel(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

export function randomSeed() { return Math.floor(Math.random() * 0xffffffff) >>> 0; }
export function newId(prefix = 's') { return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`; }

export const DEFAULT_SPAWN = { lat: 20, lon: 0, alt: 26000, heading: 0, pitch: -89 };

export class WorldStore {
  constructor() {
    this.repoWorlds = [];
    this.current = null;   // { id, name, seed, spawn, structures, kind: 'repo' | 'local', description }
    this.base = null;      // the repo world as loaded from file (for reset)
    this.shared = null;    // shared edits from the server: { version, added, removed }
  }

  // Shared edits for a world; with `known`, null when that version is still current.
  async fetchShared(id, known = null) {
    try {
      const q = known != null ? `?known=${known}` : '';
      const res = await fetch(`./api/worlds/${encodeURIComponent(id)}/edits${q}`, { cache: 'no-store' });
      if (res.ok) { const data = await res.json(); return data.unchanged ? null : data; }
    } catch { /* no server (static hosting): shared edits are simply unavailable */ }
    return null;
  }

  async init() {
    try {
      const res = await fetch('./worlds/index.json', { cache: 'no-cache' });
      this.repoWorlds = await res.json();
    } catch (e) {
      console.warn('No worlds index found', e);
      this.repoWorlds = [];
    }
  }

  localWorlds() { return lsGet(LS.localList, []); }

  listWorlds() {
    return [
      ...this.repoWorlds.map((w) => ({ id: w.id, name: w.name, kind: 'repo' })),
      ...this.localWorlds().map((w) => ({ id: w.id, name: w.name, kind: 'local' })),
    ];
  }

  lastWorldId() { return lsGet(LS.last, null); }

  async load(id) {
    const repo = this.repoWorlds.find((w) => w.id === id);
    if (repo) {
      const res = await fetch(`./worlds/${repo.file}`, { cache: 'no-cache' });
      const base = await res.json();
      this.base = { ...base, structures: base.structures || [] };
      this.shared = (await this.fetchShared(id)) || { version: 0, added: [], removed: [] };
      const overlay = lsGet(LS.overlay(id), { added: [], removed: [] });
      const removed = new Set([...(overlay.removed || []), ...this.shared.removed]);
      const structures = [
        ...this.sharedBase().filter((s) => !removed.has(s.id)),
        ...(overlay.added || []),
      ];
      this.current = { id, kind: 'repo', name: base.name || repo.name, seed: base.seed >>> 0, spawn: base.spawn || DEFAULT_SPAWN, description: base.description || '', structures };
    } else {
      const local = lsGet(LS.local(id), null);
      if (!local) throw new Error(`World ${id} not found`);
      this.base = null;
      this.shared = null;
      this.current = { ...local, kind: 'local', structures: local.structures || [], spawn: local.spawn || DEFAULT_SPAWN };
    }
    lsSet(LS.last, id);
    return this.current;
  }

  // The published structures plus everything built through the shared chat.
  sharedBase() {
    const removed = new Set(this.shared?.removed || []);
    return [...this.base.structures.filter((s) => !removed.has(s.id)), ...(this.shared?.added || [])];
  }

  // Bring in newer shared edits. Returns what changed so the scene can follow,
  // or null when nothing did.
  applyShared(edits) {
    const w = this.current;
    if (!w || w.kind !== 'repo' || !edits || edits.version === this.shared?.version) return null;
    const before = new Map(this.sharedBase().map((s) => [s.id, s]));
    this.shared = edits;
    const after = new Map(this.sharedBase().map((s) => [s.id, s]));
    const added = [...after.values()].filter((s) => !before.has(s.id));
    const removed = [...before.keys()].filter((id) => !after.has(id));
    const gone = new Set(removed);
    w.structures = [...w.structures.filter((s) => !gone.has(s.id)), ...added];
    return added.length || removed.length ? { added, removed } : null;
  }

  // Persist the current world (overlay for repo worlds, whole world for local ones).
  save() {
    const w = this.current;
    if (!w) return;
    if (w.kind === 'repo') {
      const shared = this.sharedBase();
      const baseIds = new Set(shared.map((s) => s.id));
      const currentIds = new Set(w.structures.map((s) => s.id));
      const added = w.structures.filter((s) => !baseIds.has(s.id));
      const removed = shared.filter((s) => !currentIds.has(s.id)).map((s) => s.id);
      lsSet(LS.overlay(w.id), { added, removed });
    } else {
      lsSet(LS.local(w.id), { id: w.id, name: w.name, seed: w.seed, spawn: w.spawn, description: w.description, structures: w.structures });
    }
  }

  hasLocalChanges() {
    const w = this.current;
    if (!w) return false;
    if (w.kind === 'repo') {
      const o = lsGet(LS.overlay(w.id), null);
      return !!(o && ((o.added && o.added.length) || (o.removed && o.removed.length)));
    }
    return w.structures.length > 0;
  }

  // Reset: repo world → drop overlay; local world → clear all structures.
  async reset() {
    const w = this.current;
    if (!w) return null;
    if (w.kind === 'repo') {
      lsDel(LS.overlay(w.id));
      return this.load(w.id);
    }
    w.structures = [];
    this.save();
    return w;
  }

  createLocal({ name, seed, structures = [], spawn = DEFAULT_SPAWN, description = '' }) {
    const id = `local_${seed >>> 0}_${Date.now().toString(36)}`;
    const world = { id, name, seed: seed >>> 0, spawn, description, structures };
    lsSet(LS.local(id), world);
    const list = this.localWorlds();
    list.push({ id, name });
    lsSet(LS.localList, list);
    return id;
  }

  deleteLocal(id) {
    lsDel(LS.local(id));
    lsSet(LS.localList, this.localWorlds().filter((w) => w.id !== id));
  }

  addStructure(rec) {
    rec.id = rec.id || newId();
    this.current.structures.push(rec);
    this.save();
    return rec;
  }

  removeStructure(id) {
    this.current.structures = this.current.structures.filter((s) => s.id !== id);
    this.save();
  }

  exportJSON() {
    const w = this.current;
    return JSON.stringify({ name: w.name, seed: w.seed, description: w.description, spawn: w.spawn, structures: w.structures }, null, 2);
  }

  importJSON(text) {
    const data = JSON.parse(text);
    if (typeof data.seed !== 'number') throw new Error('World file needs a numeric "seed"');
    const name = data.name || `Imported ${new Date().toLocaleDateString()}`;
    return this.createLocal({ name, seed: data.seed, structures: data.structures || [], spawn: data.spawn || DEFAULT_SPAWN, description: data.description || '' });
  }
}
