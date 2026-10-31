// The Orbitakt launchpad: a drum machine the size of a cathedral, propped on rock
// mushrooms in a pale desert, drawn in flat colour and ink like a Moebius plate.
// Its four rows of pads are Orbitakt's own tracks, and they run a sparse pattern
// to themselves, moving the kick, the cymbals, the snare and the gong as they go.
// A lone traveller waits on the ring in front of it: that's where the visitor
// leaves from (see orbitaktTeleport.js).
//
// The record's lat/lon is the ring and its heading points at the machine. Colours
// are baked (a fixed sun, three flat tones) so it keeps its drawn look whatever
// the time of day. The model faces -z, where that sun is, and is then turned round
// so it faces the ring: inside it, the viewer's left is +x.
import * as THREE from 'three';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';
import { Bag } from './university.js';

const DEG = Math.PI / 180;
export const ORBITAKT_URL = 'https://samuelling.github.io/Orbitakt/play/';
export const STEP = 0.16; // seconds per sixteenth
// The tracks of the real thing: which satellites play what, in a sparse dub pattern.
export const TRACKS = [
  { name: 'NAV', voice: 'deep kick', color: 0xe0604a, steps: 'x......x..x.....' },
  { name: 'LEO', voice: 'rimshot', color: 0xe3b23c, steps: '...x.......x..x.' },
  { name: 'SWARM', voice: 'metal hat', color: 0x3fa3a0, steps: '..x...x...x...xx' },
  { name: 'BELT', voice: 'gated hat', color: 0x8f6fc4, steps: '....x.......x...' },
];
const SAND = 0xf1dcae, PEACH = 0xf0b48c, CORAL = 0xe0705a, TEAL = 0x4aa7a2, MINT = 0xb4e0d0;
const MUSTARD = 0xe3b23c, LILAC = 0xbba0d6, VIOLET = 0x5b4a8a, CREAM = 0xf8efd8, INK = 0x16110e;
const DECK_W = 300, DECK_D = 150, DECK_Y = 84, DECK_Z = 190, TILT = -0.42, PITCH = 14;

const inkLines = new THREE.LineBasicMaterial({ color: INK });
const glow = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
function lines(parent, points, material = inkLines) {
  const m = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)), material);
  parent.add(m);
  return m;
}
function canvasPlane(w, h, px, draw) {
  const c = document.createElement('canvas');
  c.width = px; c.height = Math.round(px * h / w);
  draw(c.getContext('2d'), c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
}

// A rock mushroom: thin foot, swollen neck, flared cap, with hatching up its shaded
// side. It can lean, as they do.
export function rock(bag, hatch, rng, { x, z, y = 0, h, r, color, cap = color, lean = 0, leanAt = 0 }) {
  const j = () => 0.92 + rng() * 0.16;
  const stem = [[r * 0.8, 0], [r * 0.5 * j(), h * 0.28], [r * 0.4 * j(), h * 0.6], [r * 0.56 * j(), h * 0.76]];
  const top = [[r * 0.56, h * 0.76], [r * 1.2 * j(), h * 0.86], [r * 1.05, h * 0.94], [r * 0.5, h], [0.01, h * 1.015]];
  const axis = new THREE.Vector3(Math.cos(leanAt), 0, Math.sin(leanAt));
  const shape = (pts) => {
    const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(Math.max(a, 0.01), b)), 11);
    g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(axis, lean));
    return g;
  };
  bag.add(shape(stem), color, { x, y, z });
  bag.add(shape(top), cap, { x, y, z });
  // hatching on the side that faces the viewer, away from the sun's bright edge
  const stroke = new THREE.Vector3();
  const at = (p, a) => stroke.set(Math.sin(a) * p[0], p[1], Math.cos(a) * p[0]).applyAxisAngle(axis, lean).add(new THREE.Vector3(x, y, z)).toArray();
  for (let i = 0; i < 46 * Math.min(2, h / 90 + 0.5); i++) {
    const a = 0.2 + rng() * 1.5 + (rng() < 0.5 ? Math.PI * 0.86 : Math.PI * 1.3), t = rng() * 0.7, len = 0.05 + rng() * 0.14;
    const seg = (u) => { const k = u / 0.76 * 3, n = Math.min(2, Math.floor(k)), f = k - n; return [stem[n][0] + (stem[n + 1][0] - stem[n][0]) * f, stem[n][1] + (stem[n + 1][1] - stem[n][1]) * f]; };
    hatch.push(...at(seg(t), a), ...at(seg(Math.min(0.76, t + len)), a));
  }
}

// ---------------------------------------------------------------- the desert
function buildDesert(bag, hatch, rng) {
  bag.lathe([[350, 0], [344, 2.2], [0.1, 2.6]], SAND, 0, 0, 0, 64, false);
  // stepping slabs from the ring up to the machine
  for (let i = 0; i < 7; i++) bag.box(26 - i, 1.4, 12, i % 2 ? PEACH : CREAM, 0, 3, 52 + i * 14, 0);
  // rings of tall rocks round the plate, leaving the ring's view of the machine open
  const ring = [
    [-300, -60, 170, 34, PEACH, CORAL], [-320, 70, 120, 26, LILAC, VIOLET], [310, 40, 210, 40, CORAL, MUSTARD], [330, -110, 110, 24, PEACH, TEAL],
    [-200, 330, 290, 46, LILAC, CORAL], [250, 300, 330, 52, PEACH, VIOLET], [-300, 240, 200, 36, TEAL, MINT], [340, 200, 150, 30, MUSTARD, CORAL],
    [-110, -300, 130, 28, LILAC, MUSTARD], [150, -310, 170, 32, TEAL, PEACH], [-240, -230, 90, 22, CORAL, CREAM],
  ];
  ring.forEach(([x, z, h, r, color, cap], i) => rock(bag, hatch, rng, { x, z, h, r, color, cap, lean: 0.05 + (i % 3) * 0.06, leanAt: i * 1.7 }));
  // sand strokes, ruled across the ground
  for (let i = 0; i < 420; i++) {
    const a = rng() * Math.PI * 2, d = 44 + rng() * 290, x = Math.cos(a) * d, z = Math.sin(a) * d, l = 3 + rng() * 14;
    if (Math.abs(x) < 165 && z > 90 && z < 280) continue;
    hatch.push(x - l, 2.8, z, x + l, 2.8, z + rng() * 2);
  }
}

// The ring the traveller leaves from, and its rings of light.
function buildRing(g, bag) {
  bag.lathe([[40, 0], [39, 3], [33, 3.2], [33, 3.6], [22, 3.7], [0.1, 3.9]], TEAL, 0, 0, 0, 40);
  bag.lathe([[20, 3.7], [20, 4], [16, 4.1], [0.1, 4.1]], CREAM, 0, 0, 0, 40);
  const glows = [];
  for (const [r, w] of [[8, 0.5], [13, 0.5], [18, 0.7]]) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r + w, 64).rotateX(-Math.PI / 2), glow(MUSTARD, { transparent: true }));
    m.position.y = 4.3;
    g.add(m);
    glows.push(m);
  }
  return glows;
}

// ---------------------------------------------------------------- the machine
function buildMachine(model, hatch, rng) {
  const deck = new THREE.Group();
  deck.position.set(0, DECK_Y, DECK_Z);
  deck.rotation.x = TILT;
  model.add(deck);
  const bag = new Bag();
  bag.box(DECK_W, 14, DECK_D, CREAM, 0, -7, 0);
  bag.box(DECK_W + 6, 7, DECK_D + 6, CORAL, 0, -16, 0);
  bag.box(DECK_W + 10, 18, 10, MUSTARD, 0, 0, DECK_D / 2 + 4);
  bag.box(10, 12, DECK_D + 6, VIOLET, DECK_W / 2 + 6, -3, 0);
  bag.box(10, 12, DECK_D + 6, VIOLET, -DECK_W / 2 - 6, -3, 0);

  // the sixteen steps of the four tracks
  const cols = 16, gap = PITCH, size = 11.4;
  const rowZ = (row) => -DECK_D / 2 + 15 + row * gap, colX = (col) => (cols / 2 - 0.5 - col) * gap - 16;
  const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(size, 2.6, size), glow(0xffffff), cols * TRACKS.length);
  const m = new THREE.Matrix4(), rim = [];
  TRACKS.forEach((_, row) => {
    for (let col = 0; col < cols; col++) {
      const x = colX(col), z = rowZ(row), s = size / 2, y = 1.4;
      m.setPosition(x, 0.8, z);
      pads.setMatrixAt(row * cols + col, m);
      rim.push(x - s, y, z - s, x + s, y, z - s, x + s, y, z - s, x + s, y, z + s, x + s, y, z + s, x - s, y, z + s, x - s, y, z + s, x - s, y, z - s);
    }
  });
  deck.add(pads);
  lines(deck, rim);

  // track names, hand-lettered down the left
  TRACKS.forEach((t, row) => {
    const label = canvasPlane(36, 12, 256, (c, w, h) => {
      c.fillStyle = `#${t.color.toString(16).padStart(6, '0')}`;
      c.font = '900 italic 66px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(t.name, w / 2, h / 2);
    });
    label.rotation.set(-Math.PI / 2, 0, Math.PI, 'XYZ');
    label.position.set(colX(0) + 34, 0.3, rowZ(row));
    deck.add(label);
  });
  // the name plate
  const title = canvasPlane(150, 26, 1024, (c, w, h) => {
    c.fillStyle = '#16110e'; c.font = '900 italic 150px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ORBITAKT', w / 2, h * 0.54);
  });
  title.rotation.set(-Math.PI / 2, 0, Math.PI, 'XYZ');
  title.position.set(70, 0.3, 54);
  deck.add(title);
  // knobs
  for (let i = 0; i < 6; i++) bag.lathe([[9, 0], [8.4, 7], [5, 9], [0.1, 9.4]], i % 2 ? VIOLET : CORAL, -24 - i * 21, 0, 50, 14);

  // the radar: a sweep round the sky, with the satellites flashing as it passes
  const c = document.createElement('canvas');
  c.width = c.height = 320;
  const screen = new THREE.CanvasTexture(c);
  screen.colorSpace = THREE.SRGBColorSpace;
  const radar = new THREE.Mesh(new THREE.CircleGeometry(26, 40), glow(0xffffff, { map: screen }));
  radar.rotation.set(-Math.PI / 2, 0, Math.PI, 'XYZ');
  radar.position.set(colX(0) + 34, 0.4, 42);
  deck.add(radar);
  bag.lathe([[29, 0], [29, 2], [26, 2], [26, 0.1]], MUSTARD, radar.position.x, 0, 42, 40);
  const blips = Array.from({ length: 26 }, () => ({ a: rng() * Math.PI * 2, d: 0.2 + rng() * 0.72, t: Math.floor(rng() * 4) }));
  const sweep = c.getContext('2d');
  const drawRadar = (angle) => {
    const w = c.width, m2 = w / 2;
    sweep.fillStyle = '#123f4a'; sweep.fillRect(0, 0, w, w);
    sweep.strokeStyle = '#3f8f8c'; sweep.lineWidth = 2;
    for (const r of [0.33, 0.66, 0.98]) { sweep.beginPath(); sweep.arc(m2, m2, m2 * r, 0, 7); sweep.stroke(); }
    const g = sweep.createConicGradient(angle - Math.PI / 2, m2, m2);
    g.addColorStop(0, 'rgba(180,224,208,0)'); g.addColorStop(0.9, 'rgba(180,224,208,0)'); g.addColorStop(1, 'rgba(180,224,208,.75)');
    sweep.fillStyle = g; sweep.fillRect(0, 0, w, w);
    for (const b of blips) {
      const lag = ((angle - b.a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), f = Math.max(0, 1 - lag * 1.2);
      sweep.fillStyle = `#${TRACKS[b.t].color.toString(16).padStart(6, '0')}`;
      sweep.beginPath(); sweep.arc(m2 + Math.sin(b.a) * b.d * m2, m2 - Math.cos(b.a) * b.d * m2, 5 + f * 11, 0, 7); sweep.fill();
    }
    screen.needsUpdate = true;
  };
  drawRadar(0);
  return { deck, pads, drawRadar, hit: bag.build(deck) }; // the whole machine is clickable
}

// ---------------------------------------------------------------- the kit
// Each piece is built round its own origin, so it can be bounced as a whole.
function piece(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function buildKick(model, bag, hatch, rng) {
  const r = 68, x = 232, y = 92, z = 214;
  rock(bag, hatch, rng, { x, z, h: 40, r: 42, color: PEACH, cap: TEAL });
  const kick = piece(model, x, y + 2, z);
  const b = new Bag();
  const drum = (w, rad, color, off) => b.add(new THREE.CylinderGeometry(rad, rad, w, 36).rotateX(Math.PI / 2), color, { z: off });
  drum(58, r - 2, CORAL, 0);
  drum(6, r, CREAM, -30);
  drum(6, r, CREAM, 30);
  drum(1, r - 5, CREAM, -33.5);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    b.box(4, 4, 62, MUSTARD, Math.cos(a) * r, Math.sin(a) * r, 0, 0);
  }
  // a little planet on the batter head, for the drummer who isn't there
  b.add(new THREE.CylinderGeometry(24, 24, 1.2, 28).rotateX(Math.PI / 2), TEAL, { z: -34.5 });
  b.add(new THREE.TorusGeometry(40, 1.6, 6, 48).rotateX(1.2), VIOLET, { z: -35 });
  b.build(kick);
  return kick;
}
function buildSnare(model, bag, hatch, rng) {
  const x = -236, z = 216;
  rock(bag, hatch, rng, { x, z, h: 120, r: 38, color: TEAL, cap: MINT, lean: 0.06, leanAt: 2 });
  const snare = piece(model, x, 136, z);
  const b = new Bag();
  b.lathe([[50, -11], [50, 11]], CREAM, 0, 0, 0, 30);
  b.lathe([[53, -13], [53, -9], [0.1, -9]], MUSTARD, 0, 0, 0, 30);
  b.lathe([[53, 9], [53, 13], [0.1, 13]], MUSTARD, 0, 0, 0, 30);
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.box(3, 24, 3, VIOLET, Math.cos(a) * 52, 0, Math.sin(a) * 52); }
  b.build(snare);
  return snare;
}
const cymbal = (b, r, y, color) => {
  b.lathe([[r, y], [r * 0.25, y + r * 0.12], [r * 0.2, y + r * 0.2], [0.1, y + r * 0.2]], color, 0, 0, 0, 28);
  b.lathe([[r, y], [r * 0.25, y + r * 0.1], [0.1, y + r * 0.1]], color, 0, -0.01, 0, 28, false);
};
function buildHats(model, bag) {
  const x = 96, z = 330, top = 300;
  bag.lathe([[16, 0], [6, 30], [3.4, 120], [2.2, top - 80]], VIOLET, x, 0, z, 10);
  bag.box(2.4, 80, 2.4, CREAM, x, top - 44, z);
  const under = new Bag(), over = new Bag();
  cymbal(under, 62, 0, MUSTARD);
  under.build(piece(model, x, top - 34, z));
  const lid = piece(model, x, top - 22, z);
  cymbal(over, 62, 0, MUSTARD);
  over.build(lid);
  return lid;
}
function buildGong(model, bag, hatch, rng) {
  const x = -86, z = 342, h = 250, w = 130;
  rock(bag, hatch, rng, { x: x - w, z, h, r: 34, color: PEACH, cap: VIOLET, lean: -0.12, leanAt: Math.PI / 2 * 0 });
  rock(bag, hatch, rng, { x: x + w, z, h, r: 30, color: CORAL, cap: VIOLET, lean: 0.12, leanAt: 0 });
  bag.box(w * 2.5, 12, 18, VIOLET, x, h - 8, z);
  for (const s of [-1, 1]) bag.box(1.6, 44, 1.6, INK, x + s * 40, h - 34, z);
  const gong = piece(model, x, h - 40, z);
  const b = new Bag();
  b.add(new THREE.CylinderGeometry(96, 96, 7, 40).rotateX(Math.PI / 2), MUSTARD, { y: -96 });
  b.add(new THREE.CylinderGeometry(30, 34, 11, 28).rotateX(Math.PI / 2), CORAL, { y: -96 });
  b.build(gong);
  return gong;
}
// The dish on its stalk, turning clockwise as the sweep does.
function buildDish(model, bag) {
  const x = -8, z = 300, y = 340;
  bag.lathe([[20, 0], [7, 40], [4, 200], [7, y - 8], [14, y]], TEAL, x, 0, z, 10);
  const dish = piece(model, x, y, z);
  const b = new Bag();
  b.add(new THREE.LatheGeometry([[0.1, 0], [22, 2], [42, 9], [58, 22]].map(([a, h]) => new THREE.Vector2(a, h)), 22).rotateX(-0.9), CREAM, {});
  b.box(2, 54, 2, INK, 0, 22, -19, 0, false);
  b.build(dish);
  return dish;
}
// A pterosaur on a long slow circle, because something always is.
function buildGlider(model) {
  const g = piece(model, 0, 0, 0), b = new Bag(), L = new Bag(), Rr = new Bag();
  b.add(new THREE.ConeGeometry(2.6, 26, 7).rotateX(Math.PI / 2), CORAL, {});
  b.add(new THREE.ConeGeometry(1.2, 15, 6).rotateX(-Math.PI / 2 - 0.25), CREAM, { y: 2, z: 18 });
  b.build(g);
  const wing = (s) => {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 9, 0, 0, -10, s * 42, 0, -5, s * 42, 0, -5, 0, 0, -10, 0, 0, 9, 0, 0, -10, s * 42, 0, -5, 0, 0, 9, s * 42, 0, -5, 0, 0, 9, 0, 0, -10], 3));
    return shape;
  };
  const left = new THREE.Group(), right = new THREE.Group();
  L.add(wing(1), TEAL, {}); L.build(left);
  Rr.add(wing(-1), TEAL, {}); Rr.build(right);
  g.add(left, right);
  return { g, left, right };
}

// The traveller: a small cloaked figure in a tall hat. Its materials are its own,
// so the teleport can clip it away. Stands 3.3 m tall.
function buildTraveller(g) {
  const t = new THREE.Group(), b = new Bag();
  t.position.y = 4.1;
  b.lathe([[0.75, 0], [0.62, 1.1], [0.36, 2.15], [0.28, 2.3]], TEAL, 0, 0, 0, 12);
  b.add(new THREE.SphereGeometry(0.26, 10, 8), CREAM, { y: 2.46 });
  b.lathe([[0.48, 2.6], [0.2, 2.68], [0.02, 3.3]], CORAL, 0, 0, 0, 10);
  b.box(0.22, 0.14, 1.1, MUSTARD, 0.05, 2.14, 0.45, 0); // scarf, blowing out behind
  b.lathe([[0.04, 0], [0.04, 2.9]], VIOLET, 0.62, 0, -0.1, 5, false); // staff
  b.build(t);
  g.add(t);
  return t;
}

// ---------------------------------------------------------------- placing it
export function buildOrbitakt(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const g = new THREE.Group();
  g.rotation.y = -(rec.heading ?? 0) * DEG; // the ring looks along the heading, at the machine
  site.add(g);
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  g.add(model);

  const rng = mulberry32(7451), bag = new Bag(), hatch = [];
  buildDesert(bag, hatch, rng);
  const glows = buildRing(model, bag);
  const machine = buildMachine(model, hatch, rng);
  for (const [x, z, h, r, c] of [[-120, 170, 70, 26, PEACH], [120, 170, 70, 26, CORAL], [0, 236, 88, 30, LILAC]]) rock(bag, hatch, rng, { x, z, h, r, color: c, cap: c });
  const kick = buildKick(model, bag, hatch, rng), snare = buildSnare(model, bag, hatch, rng);
  const hats = buildHats(model, bag), gong = buildGong(model, bag, hatch, rng), dish = buildDish(model, bag);
  const glider = buildGlider(model);
  const traveller = buildTraveller(model);
  bag.build(model);
  lines(model, hatch, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.7 }));
  site.updateMatrixWorld(true);

  const col = new THREE.Color(), dim = TRACKS.map((t) => new THREE.Color(t.color).lerp(new THREE.Color(CREAM), 0.72));
  const lit = TRACKS.map(() => new Array(16).fill(0));
  const env = [0, 0, 0, 0];
  const paint = (step) => {
    TRACKS.forEach((t, row) => {
      for (let i = 0; i < 16; i++) {
        const on = t.steps[i] === 'x';
        if (i === step && on) { lit[row][i] = 1; env[row] = 1; }
        col.copy(dim[row]).lerp(col.clone().set(t.color), on ? 0.55 + 0.45 * lit[row][i] : 0);
        if (i === step) col.lerp(col.clone().set(0xffffff), 0.75);
        else col.lerp(col.clone().set(0xffffff), lit[row][i] * 0.55);
        machine.pads.setColorAt(row * 16 + i, col);
      }
    });
    machine.pads.instanceColor.needsUpdate = true;
  };
  paint(0);
  let t = 0, clock = 0, step = -1, angle = 0, seen = false, sinceRadar = 0, driven = false;
  machine.pads.onBeforeRender = () => { seen = true; };

  site.userData.update = (dt) => {
    t += dt;
    if (!seen) return; // nothing to move while it's out of view
    seen = false;
    if (!driven) {
      clock += dt;
      const s = Math.floor(clock / STEP) % 16;
      if (s !== step) { step = s; paint(step); }
    }
    for (let r = 0; r < 4; r++) { env[r] = Math.max(0, env[r] - dt * (r === 0 ? 5 : 7)); for (let i = 0; i < 16; i++) lit[r][i] = Math.max(0, lit[r][i] - dt * 3.5); }
    kick.scale.setScalar(1 + env[0] * 0.05);
    for (const [i, m] of glows.entries()) { m.scale.setScalar(1 + env[0] * 0.07 * (i + 1)); m.material.opacity = 0.45 + env[0] * 0.55; }
    snare.position.y = 136 + env[1] * 6;
    hats.position.y = 278 + (1 - env[2]) * 10;
    gong.rotation.x = Math.sin(t * 1.6) * 0.05 * (0.4 + env[3]);
    angle = (t * 1.05) % (Math.PI * 2);
    dish.rotation.y = -angle;
    sinceRadar += dt;
    if (sinceRadar > 0.08) { sinceRadar = 0; machine.drawRadar(angle); }
    const a = t * 0.09;
    glider.g.position.set(Math.cos(a) * 340, 250 + Math.sin(t * 0.3) * 24, 90 + Math.sin(a) * 340);
    glider.g.rotation.set(0, -a + Math.PI, 0);
    glider.left.rotation.z = Math.sin(t * 1.3) * 0.28;
    glider.right.rotation.z = -Math.sin(t * 1.3) * 0.28;
  };
  site.userData.labelPos = new THREE.Vector3(0, 420, -190);
  site.userData.labelRange = 6000;

  const toWorld = (v) => v.clone().applyMatrix4(g.matrixWorld);
  const axes = new THREE.Matrix4().extractRotation(g.matrixWorld);
  site.userData.orbitakt = {
    site,
    url: rec.url || ORBITAKT_URL,
    hit: machine.hit,
    traveller,
    center: site.position.clone(),
    // the ring's frame in world space: the base of the traveller, and which way is which
    frame: {
      origin: toWorld(new THREE.Vector3(0, 4.1, 0)),
      fwd: new THREE.Vector3(0, 0, -1).applyMatrix4(axes),
      up: new THREE.Vector3(0, 1, 0).applyMatrix4(axes),
      right: new THREE.Vector3(1, 0, 0).applyMatrix4(axes),
    },
    // the teleport takes over the clock, so the pads play what the visitor hears
    drive(on) { driven = on; },
    playStep(s) { paint(s); },
    // a camera pose in the site's frame (+z is back from the ring, away from the machine)
    view(x = 0, y = 62, z = 215, tx = 0, ty = 96, tz = -170) {
      const pos = toWorld(new THREE.Vector3(x, y, z));
      return { pos, look: toWorld(new THREE.Vector3(tx, ty, tz)).sub(pos).normalize() };
    },
  };
  return site;
}
