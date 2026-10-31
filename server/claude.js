// In-game builder chat: Claude reads where the player is and places structures
// through tools. Tools only ever produce validated data records; no code runs.
import Anthropic from '@anthropic-ai/sdk';
import { CATALOG, TYPES, FEATURE_OPTIONS } from './catalog.js';
import { distanceM } from './worldStore.js';
import { SHAPES, SHAPE_NAMES, LIMITS } from '../src/blueprintSpec.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'medium';
const MAX_LOOPS = 10;          // model calls per player message
const MAX_PLACES = 12;         // structures (catalogue pieces or blueprints) per player message
const MAX_HISTORY = 60;        // messages kept per conversation before it restarts
const SESSION_TTL = 2 * 3600e3;
const M_PER_DEG = (2 * Math.PI * 10000) / 360; // planet radius is 10 km

const SYSTEM = `You are the builder in Worldbuilder, a browser game where players fly around a small procedurally generated planet. Players chat with you to get things built in the shared world, which everyone playing sees.

How the world works:
- The planet's radius is 10 km. One degree of latitude is ${M_PER_DEG.toFixed(1)} m. One degree of longitude is ${M_PER_DEG.toFixed(1)} m × cos(latitude).
- Latitude runs −90 (south) to 90 (north); longitude −180 (west) to 180 (east).
- Heading is degrees clockwise from north (0 = north, 90 = east). A structure's front faces its heading.
- Mountains reach about 320 m; seas are up to 160 m deep. Structures sit on the ground or float on the sea.
- To place something d metres north and e metres east of (lat, lon): lat + d / ${M_PER_DEG.toFixed(1)}, lon + e / (${M_PER_DEG.toFixed(1)} × cos(lat)).

Structure types you can place (sizes at scale 1):
${TYPES.map((t) => `- ${t}: ${CATALOG[t]}`).join('\n')}

How to work:
- Each message starts with a [Game context] note: where the player is and, if they picked one, a selected spot. "Here" means the selected spot if there is one, otherwise just ahead of the player.
- Use check_ground before building to make sure spots are on land (or on water for ships), and find_structures to avoid stacking things on top of existing ones.
- Compose bigger requests from several pieces, e.g. a harbour town from a town, a lighthouse on the shore, and ships on the water. Place at most ${MAX_PLACES} structures per request.
- Give structures short, fitting names and pleasant colours (#rrggbb). Scale runs from 0.5 to 4.
- You can only remove structures that were built through this chat (find_structures marks them). Use that to move or undo things the player asks about.
- Use catalogue structures when they genuinely fit (a town, a castle, ships). For anything else (animals, vehicles, giant objects, signs, statues of particular things, pixel art) design a blueprint rather than substituting an unrelated catalogue piece.
- Keep replies to one to three short sentences: say what you built and where. Don't list coordinates unless asked.

Blueprints (build_blueprint) are your own designs made of basic shapes and/or voxels:
- Frame: metres, origin on the ground at the blueprint's lat/lon. +y is up, +z is the front (it faces the heading), +x is to the right of someone standing in front of it looking at it. Each shape's "at" is its centre.
- Shapes (each fills a box of the given size before rotating):
${SHAPE_NAMES.map((n) => `  - ${n}: ${SHAPES[n]}`).join('\n')}
- "rot" is degrees about x, then y, then z. A cylinder lying along x is rot [0, 0, 90]; a wheel facing sideways is a cylinder with rot [0, 0, 90].
- "glow" makes a shape (or voxel colour) light up: eyes, windows at night, screens, lava, lamps.
- Voxels give the blocky / pixel look: a cube edge "size", a "palette" of colours, and "cells" [x, y, z, colourIndex] on an integer grid. Cell [0, 0, 0] sits on the ground at the origin; cell [x, y, z] is centred at (x·size, y·size + size/2, z·size). An upright picture (a pixel portrait, a sign) uses x and y with z = 0, so it faces the front. Shapes and voxels can be mixed in one blueprint.
- Scale: players fly, so make things read from the air. A person-sized statue would vanish; 20-300 m is typical, and "really large" means 150 m or more. Keep the base at y = 0 and sink it a few metres (slightly negative y) on sloping ground so nothing floats. Blueprints sit on the terrain at their anchor and don't reshape it, so check_ground and pick a flat-ish spot. "alt" raises the whole blueprint, e.g. onto something else.
- Work like a sculptor: block out the big masses first, then the features that make it recognisable (ears, eyes, windows, wheels, trim), overlapping parts slightly so it reads as solid. Use colour contrast for detail. For a recognisable silhouette, think about proportions before writing coordinates.
- Limits per blueprint: ${LIMITS.parts} shapes, ${LIMITS.cells} voxels, ${LIMITS.palette} palette colours, everything within ${LIMITS.reach} m of the anchor horizontally and ${LIMITS.height} m high, no single shape over ${LIMITS.partSize} m. Big scenes can use several blueprints. A very large voxel build is a lot of output, so prefer bigger voxels over more of them.
- Decline anything hateful or obscene, including names.`;

const num = { type: 'number' };
const TOOLS = [
  {
    name: 'check_ground',
    description: 'Check the terrain at up to 20 points. Returns each point\'s elevation in metres (negative means sea of that depth) and whether it is land or sea.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['points'],
      properties: { points: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['lat', 'lon'], properties: { lat: num, lon: num } } } },
    },
  },
  {
    name: 'find_structures',
    description: 'List structures within radius_m metres of a point, nearest first, with their ids, types, names, positions and whether this chat built them (and can therefore remove them).',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['lat', 'lon', 'radius_m'],
      properties: { lat: num, lon: num, radius_m: num },
    },
  },
  {
    name: 'place_structure',
    description: 'Build one structure in the shared world. Returns the new structure\'s id.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['type', 'lat', 'lon', 'heading', 'scale', 'color', 'name', 'lat2', 'lon2', 'radius', 'height'],
      properties: {
        type: { type: 'string', enum: TYPES },
        lat: num, lon: num,
        heading: { type: 'number', description: 'Degrees clockwise from north.' },
        scale: { type: 'number', description: '0.5 to 4.' },
        color: { type: 'string', description: 'Main colour as #rrggbb.' },
        name: { type: ['string', 'null'], description: 'Short label shown in the world, or null.' },
        lat2: { type: ['number', 'null'], description: 'Bridges only: the far end. Otherwise null.' },
        lon2: { type: ['number', 'null'], description: 'Bridges only: the far end. Otherwise null.' },
        radius: { type: ['number', 'null'], description: 'volcano or woodland only, in metres. Otherwise null.' },
        height: { type: ['number', 'null'], description: 'volcano or mushroomtree only, in metres. Otherwise null.' },
      },
    },
  },
  {
    name: 'build_blueprint',
    description: 'Build your own design from basic shapes and/or a voxel grid (see the system prompt for the frame and shapes). Returns its id and measured size.',
    eager_input_streaming: true, // blueprints can be long; stream them as they are written
    input_schema: {
      type: 'object', additionalProperties: false, required: ['lat', 'lon', 'heading', 'name'],
      properties: {
        lat: num, lon: num,
        heading: { type: 'number', description: 'Degrees clockwise from north that the front (+z) faces.' },
        alt: { type: 'number', description: 'Optional metres to raise the whole blueprint above the ground.' },
        name: { type: 'string', description: 'Short label shown in the world.' },
        parts: {
          type: 'array', description: `Up to ${LIMITS.parts} shapes.`,
          items: {
            type: 'object', additionalProperties: false, required: ['shape', 'at', 'size', 'color'],
            properties: {
              shape: { type: 'string', enum: SHAPE_NAMES },
              at: { type: 'array', items: num, description: '[x, y, z] centre in metres.' },
              size: { type: 'array', items: num, description: '[width x, height y, depth z] in metres.' },
              rot: { type: 'array', items: num, description: 'Optional [x, y, z] rotation in degrees.' },
              color: { type: 'string', description: '#rrggbb' },
              glow: { type: 'boolean' },
            },
          },
        },
        voxels: {
          type: 'object', additionalProperties: false, required: ['size', 'palette', 'cells'],
          properties: {
            size: { type: 'number', description: `Cube edge in metres (${LIMITS.voxel[0]}-${LIMITS.voxel[1]}).` },
            palette: { type: 'array', items: { type: 'string' }, description: `Up to ${LIMITS.palette} #rrggbb colours.` },
            cells: { type: 'array', items: { type: 'array', items: { type: 'integer' } }, description: `Up to ${LIMITS.cells} [x, y, z, colourIndex].` },
            glow: { type: 'array', items: { type: 'integer' }, description: 'Optional palette indices that glow.' },
          },
        },
      },
    },
  },
  {
    name: 'remove_structure',
    description: 'Remove a structure that was built through this chat, by id.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
  },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapLon = (lon) => ((lon + 540) % 360) - 180;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const newId = () => `c_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const round = (v, d = 5) => +v.toFixed(d);

export class BuilderChat {
  constructor(store, { log } = {}) {
    this.store = store;
    this.log = log || (() => {});
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
    this.sessions = new Map(); // sessionId -> { worldId, messages, updated }
  }

  get enabled() { return !!this.client; }

  _session(id, worldId) {
    const now = Date.now();
    for (const [k, s] of this.sessions) if (now - s.updated > SESSION_TTL) this.sessions.delete(k);
    let s = this.sessions.get(id);
    let restarted = false;
    if (!s || s.worldId !== worldId || s.messages.length > MAX_HISTORY) {
      restarted = !!s;
      s = { worldId, messages: [] };
      this.sessions.set(id, s);
    }
    s.updated = now;
    return { session: s, restarted };
  }

  // Runs one player message to completion. Returns { reply, changes }.
  async chat({ sessionId, worldId, text, context }) {
    const { session, restarted } = this._session(sessionId, worldId);
    const turn = { worldId, places: 0, changes: [] };
    const mark = session.messages.length;
    try {
      return await this._turn(session, turn, restarted, text, context);
    } catch (e) {
      // drop this unfinished turn so a half-done tool exchange can't poison the next request
      session.messages.length = mark;
      if (turn.changes.length) e.changes = turn.changes;
      throw e;
    }
  }

  async _turn(session, turn, restarted, text, context) {
    const { worldId } = turn;
    // history is append-only: earlier turns (and their thinking blocks) are never edited
    session.messages.push({ role: 'user', content: `${describeContext(context, this.store, worldId)}\n\n${text}` });

    let reply = '';
    let usage = { input: 0, output: 0, cacheRead: 0 };
    let jsonRetries = 0;
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      // streamed, so long blueprints don't run into request timeouts
      const stream = this.client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        system: SYSTEM,
        tools: TOOLS,
        messages: session.messages,
        output_config: { effort: EFFORT },
        cache_control: { type: 'ephemeral' },
        // on a safety decline, the API retries on a suitable fallback model
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      let response;
      try {
        response = await stream.finalMessage();
        jsonRetries = 0;
      } catch (e) {
        // a streamed tool input that isn't valid JSON: ask again (API errors are rethrown)
        if (e instanceof Anthropic.APIError || jsonRetries++ >= 2) throw e;
        loop--;
        continue;
      }
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens || 0;
      session.messages.push({ role: 'assistant', content: response.content });
      const said = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (said) reply = said;

      if (response.stop_reason === 'refusal') { reply = "Sorry, I can't help with that one."; break; }
      if (response.stop_reason === 'pause_turn') continue;
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (!toolUses.length || (response.stop_reason !== 'tool_use' && response.stop_reason !== 'max_tokens')) break;

      const results = [];
      for (const t of toolUses) {
        let content, isError = false;
        try {
          // a tool call cut off by the output limit parses as a partial object: never run it
          if (response.stop_reason === 'max_tokens') throw new Error('Your output was cut off before this call finished, so nothing was built. Split the design into smaller blueprints or use bigger voxels.');
          content = JSON.stringify(await this._runTool(t.name, t.input, turn));
        } catch (e) { content = e.message; isError = true; }
        results.push({ type: 'tool_result', tool_use_id: t.id, content, is_error: isError });
      }
      session.messages.push({ role: 'user', content: results });
      if (loop === MAX_LOOPS - 1) reply ||= 'That took more steps than I am allowed for one request. Here is what I managed so far.';
    }
    if (!reply) reply = turn.changes.length ? 'Done.' : "I wasn't able to do that.";
    if (restarted) reply = `(Started a fresh conversation.) ${reply}`;
    this.log({ worldId, text, reply, changes: turn.changes, usage });
    return { reply, changes: turn.changes };
  }

  async _runTool(name, input, turn) {
    const { store } = this;
    const worldId = turn.worldId;
    if (name === 'check_ground') {
      return (input.points || []).slice(0, 20).map((p) => {
        if (!finite(p.lat) || !finite(p.lon)) return { error: 'invalid point' };
        const e = store.elevation(worldId, clamp(p.lat, -90, 90), wrapLon(p.lon));
        return { lat: p.lat, lon: p.lon, elevation_m: Math.round(e), surface: e > 0 ? 'land' : 'sea' };
      });
    }
    if (name === 'find_structures') {
      const at = { lat: input.lat, lon: input.lon };
      const radius = clamp(finite(input.radius_m) ? input.radius_m : 200, 1, 20000);
      return (await store.structures(worldId))
        .map((s) => ({ s, d: distanceM(at, s) }))
        .filter((x) => x.d <= radius)
        .sort((a, b) => a.d - b.d)
        .slice(0, 40)
        .map(({ s, d }) => ({ id: s.id, type: s.type, name: s.name ?? null, lat: s.lat, lon: s.lon, distance_m: Math.round(d), built_by_chat: s.createdBy === 'claude' }));
    }
    if (name === 'place_structure') {
      if (turn.places >= MAX_PLACES) throw new Error(`Limit of ${MAX_PLACES} structures per request reached.`);
      const rec = validateStructure(input);
      keepClear(store, worldId, rec);
      turn.places += 1;
      await store.add(worldId, rec);
      turn.changes.push({ op: 'add', structure: rec });
      return { id: rec.id, placed: true };
    }
    if (name === 'build_blueprint') {
      if (turn.places >= MAX_PLACES) throw new Error(`Limit of ${MAX_PLACES} structures per request reached.`);
      const rec = validateBlueprint(input);
      keepClear(store, worldId, rec);
      turn.places += 1;
      await store.add(worldId, rec);
      turn.changes.push({ op: 'add', structure: rec });
      return { id: rec.id, placed: true, shapes: rec.parts.length, voxels: rec.voxels?.cells.length || 0, ...rec.extent };
    }
    if (name === 'remove_structure') {
      const s = (await store.structures(worldId)).find((x) => x.id === input.id);
      if (!s) throw new Error('No structure with that id.');
      if (s.createdBy !== 'claude') throw new Error('That structure is part of the published world and can only be removed by the game developer.');
      await store.remove(worldId, s.id);
      turn.changes.push({ op: 'remove', id: s.id });
      return { removed: s.id };
    }
    throw new Error(`Unknown tool ${name}`);
  }
}

function validateStructure(input) {
  if (!TYPES.includes(input.type)) throw new Error(`Unknown type ${input.type}.`);
  if (!finite(input.lat) || !finite(input.lon)) throw new Error('lat and lon must be numbers.');
  const rec = {
    id: newId(),
    type: input.type,
    lat: round(clamp(input.lat, -90, 90)),
    lon: round(wrapLon(input.lon)),
    heading: round(((finite(input.heading) ? input.heading : 0) % 360 + 360) % 360, 1),
    scale: round(clamp(finite(input.scale) ? input.scale : 1, 0.5, 4), 2),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#c8b89a',
    createdBy: 'claude',
    createdAt: new Date().toISOString(),
  };
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
  if (name) rec.name = name;
  if (input.type === 'bridge' && finite(input.lat2) && finite(input.lon2)) {
    rec.lat2 = round(clamp(input.lat2, -90, 90));
    rec.lon2 = round(wrapLon(input.lon2));
    if (distanceM(rec, { lat: rec.lat2, lon: rec.lon2 }) > 3000) throw new Error('Bridges can be at most 3 km long.');
  }
  for (const opt of FEATURE_OPTIONS[input.type] || []) {
    if (finite(input[opt])) rec[opt] = Math.round(clamp(input[opt], opt === 'height' ? 40 : 50, opt === 'height' ? 600 : 1500));
  }
  return rec;
}

// Published set pieces that chat builds keep clear of, in metres from their centre.
const RESERVED = { computer: 260, organstage: 2500, university: 1300, nightwindow: 800, drownedrange: 3000, orbitakt: 520, lastskip: 1100, papermachine: 900, ashland: 3000, comicstatue: 700 }; // the stage's avenue runs a long way
function keepClear(store, worldId, at) {
  for (const s of store.base(worldId)?.structures || []) {
    const clear = RESERVED[s.type];
    if (clear && distanceM(at, s) < clear) throw new Error(`That spot is on ${s.name}, which needs to stay clear. Build at least ${clear} m from its centre.`);
  }
}

const COLOR = /^#[0-9a-f]{6}$/i;
const vec3 = (v, what) => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) throw new Error(`${what} must be three numbers.`);
  return v.map((x) => round(x, 2));
};

// Check a blueprint against the limits and return the record to store.
function validateBlueprint(input) {
  if (!finite(input.lat) || !finite(input.lon)) throw new Error('lat and lon must be numbers.');
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const vox = input.voxels || null;
  if (!parts.length && !(vox && Array.isArray(vox.cells) && vox.cells.length)) throw new Error('A blueprint needs some parts or voxels.');
  if (parts.length > LIMITS.parts) throw new Error(`Too many shapes (${parts.length}); the limit is ${LIMITS.parts}.`);
  let reach = 0, top = 0, bottom = 0;
  const extend = (x, y, z, r) => { reach = Math.max(reach, Math.hypot(x, z) + r); top = Math.max(top, y + r); bottom = Math.min(bottom, y - r); };
  const outParts = parts.map((p, i) => {
    if (!SHAPE_NAMES.includes(p.shape)) throw new Error(`Part ${i}: unknown shape "${p.shape}".`);
    const at = vec3(p.at, `Part ${i} "at"`), size = vec3(p.size, `Part ${i} "size"`);
    if (size.some((v) => v <= 0 || v > LIMITS.partSize)) throw new Error(`Part ${i}: sizes must be between 0 and ${LIMITS.partSize} m.`);
    if (!COLOR.test(p.color || '')) throw new Error(`Part ${i}: color must be #rrggbb.`);
    const out = { shape: p.shape, at, size, color: p.color };
    if (p.rot != null) { const rot = vec3(p.rot, `Part ${i} "rot"`); if (rot.some((v) => v !== 0)) out.rot = rot; }
    if (p.glow === true) out.glow = true;
    extend(at[0], at[1], at[2], Math.hypot(...size) / 2);
    return out;
  });
  let outVox = null;
  if (vox && Array.isArray(vox.cells) && vox.cells.length) {
    const size = vox.size;
    if (!finite(size) || size < LIMITS.voxel[0] || size > LIMITS.voxel[1]) throw new Error(`Voxel size must be ${LIMITS.voxel[0]}-${LIMITS.voxel[1]} m.`);
    const palette = Array.isArray(vox.palette) ? vox.palette : [];
    if (!palette.length || palette.length > LIMITS.palette || !palette.every((c) => COLOR.test(c))) throw new Error(`The voxel palette needs 1-${LIMITS.palette} #rrggbb colours.`);
    if (vox.cells.length > LIMITS.cells) throw new Error(`Too many voxels (${vox.cells.length}); the limit is ${LIMITS.cells}. Use bigger voxels.`);
    const seen = new Set();
    const cells = [];
    for (const c of vox.cells) {
      if (!Array.isArray(c) || c.length !== 4 || !c.every(Number.isInteger)) throw new Error('Each voxel cell must be four integers [x, y, z, colourIndex].');
      if (c[3] < 0 || c[3] >= palette.length) throw new Error(`Voxel colour index ${c[3]} is not in the palette.`);
      const key = `${c[0]},${c[1]},${c[2]}`;
      if (seen.has(key)) continue; // later duplicates are ignored
      seen.add(key);
      cells.push(c);
      extend(c[0] * size, c[1] * size + size / 2, c[2] * size, size * 0.87);
    }
    const glow = Array.isArray(vox.glow) ? vox.glow.filter((g) => Number.isInteger(g) && g >= 0 && g < palette.length) : [];
    outVox = { size: round(size, 2), palette, cells };
    if (glow.length) outVox.glow = glow;
  }
  if (reach > LIMITS.reach) throw new Error(`The design reaches ${Math.round(reach)} m from its anchor; the limit is ${LIMITS.reach} m. Make it smaller or split it up.`);
  if (top > LIMITS.height) throw new Error(`The design is ${Math.round(top)} m tall; the limit is ${LIMITS.height} m.`);
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
  const rec = {
    id: newId(),
    type: 'blueprint',
    lat: round(clamp(input.lat, -90, 90)),
    lon: round(wrapLon(input.lon)),
    heading: round((((finite(input.heading) ? input.heading : 0) % 360) + 360) % 360, 1),
    parts: outParts,
    createdBy: 'claude',
    createdAt: new Date().toISOString(),
  };
  if (outVox) rec.voxels = outVox;
  if (finite(input.alt) && input.alt > 0) rec.alt = round(Math.min(input.alt, 600), 1);
  if (name) rec.name = name;
  // reported back to Claude, not stored
  Object.defineProperty(rec, 'extent', { value: { reach_m: Math.round(reach), height_m: Math.round(top), lowest_m: Math.round(bottom) }, enumerable: false });
  return rec;
}

function describeContext(ctx, store, worldId) {
  const lines = [`[Game context] World: ${store.base(worldId)?.name || worldId}.`];
  const p = ctx && ctx.player;
  if (p && finite(p.lat) && finite(p.lon)) {
    lines.push(`Player is at lat ${p.lat.toFixed(5)}, lon ${p.lon.toFixed(5)}, ${Math.round(p.alt ?? 0)} m above the ground, facing heading ${Math.round(p.heading ?? 0)}°.`);
  }
  const s = ctx && ctx.spot;
  if (s && finite(s.lat) && finite(s.lon)) {
    const e = store.elevation(worldId, s.lat, s.lon);
    lines.push(`Selected spot: lat ${s.lat.toFixed(5)}, lon ${s.lon.toFixed(5)} (${e > 0 ? `land, ${Math.round(e)} m up` : `sea, ${Math.round(-e)} m deep`}).`);
  } else {
    lines.push('No spot selected.');
  }
  return lines.join(' ');
}
