// Ashland: a reservoir in an autumn forest, drawn after the game of the same name.
// The record's lat/lon, alt and heading are the view over the park; the lake lies
// `ahead` metres along that heading, with the rust-coloured ground, the trees and a
// dusk sky round it. A giant park gate on the near shore is the way in: a trail runs
// through it to the dock, and walking through it leaves for the game at `url`.
//
// Like the University, colours are baked into the model (see Bag), so the park keeps
// its painted look whatever the planet's sun is doing. The sky is a dome that follows
// the viewer and fades away as they leave. Local axes: y up, -z along the heading.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { R, latLonToDir, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';
import { Bag, baked } from './university.js';
import { gardenCtx } from './graffiti.js';

const DEG = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function mix(out, c, t) { out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t; }
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

const LAKE = 520, BANK = 34;            // the lake's size, and how far back its bank rises
const FLAT = 1700, FLAT_BAND = 1200;    // the park's gentle ground, then back to the hills
const TINT = 3000, TINT_BAND = 1300;    // how far the autumn colours reach
const FOREST = 2400;
const GATE_BACK = 170;                  // the gate, back from the near shore
const TRAIL_BACK = 520;                 // where the trail starts, back from the near shore

const RUST = [0.40, 0.145, 0.05], RUST2 = [0.55, 0.26, 0.07], MOSS = [0.25, 0.23, 0.07], EARTH = [0.20, 0.075, 0.03], DUSK = [0.47, 0.33, 0.30];
const LEAVES = {
  maple: [0xc2301f, 0xd8421f, 0xe2612a, 0xb3261f, 0xe8872c, 0xef9a2e],
  birch: [0xf2bf45, 0xf6d36a, 0xeeaa35],
  pine: [0x1f4a33, 0x265a3b, 0x1a3f2e],
};

export class AshlandFeature {
  constructor(rec, planet) {
    this.id = rec.id; this.rec = rec; this.kind = 'site';
    this.noise = planet.noise2;
    this.level = rec.level ?? 46;
    this.ahead = rec.ahead ?? 1250;
    const view = latLonToDir(rec.lat, rec.lon), { east, north } = tangentFrame(view);
    const h = (rec.heading ?? 0) * DEG, a = this.ahead / R;
    const out = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    this.center = view.clone().multiplyScalar(Math.cos(a)).addScaledVector(out, Math.sin(a)).normalize();
    // along the heading at the lake, and to the right of it
    this.fwd = this.center.clone().multiplyScalar(Math.cos(a)).sub(view).divideScalar(Math.sin(a)).normalize();
    this.right = new THREE.Vector3().crossVectors(this.fwd, this.center).normalize();
    this.cosBound = Math.cos((TINT + TINT_BAND + 60) / R);
    this.maxHeight = 0;
    this.gateZ = this.shore(Math.PI) + GATE_BACK;
  }
  // distance from the lake's centre, and bearing from the heading
  polar(dir) {
    const d = Math.acos(clamp(dir.dot(this.center), -1, 1)) * R;
    return { d, th: Math.atan2(dir.dot(this.right), dir.dot(this.fwd)) };
  }
  // the lake's shoreline, with a wooded point reaching in from the far side
  shore(th) {
    const dt = Math.atan2(Math.sin(th - 0.28), Math.cos(th - 0.28)), w = dt / 0.2;
    return LAKE * (1 + 0.2 * Math.sin(2 * th + 1) + 0.11 * Math.sin(3 * th + 0.6) + 0.06 * Math.sin(5 * th + 2) - 0.62 * Math.exp(-w * w));
  }
  // the trail wanders a little, and goes through the gate on the centre line
  trailX(z) { return 26 * Math.sin((z - this.gateZ) / 130); }
  dirAt(x, z) {
    const v = this.right.clone().multiplyScalar(x).addScaledVector(this.fwd, -z), d = v.length();
    if (d < 1e-6) return this.center.clone();
    return this.center.clone().multiplyScalar(Math.cos(d / R)).addScaledVector(v.divideScalar(d), Math.sin(d / R)).normalize();
  }
  elev(dir, h) {
    const { d, th } = this.polar(dir);
    const k = 1 - smooth(FLAT, FLAT + FLAT_BAND, d);
    if (k <= 0) return h;
    const land = this.level + 6 + 6 * this.noise.noise3(dir.x * 42, dir.y * 42, dir.z * 42);
    const s = d - this.shore(th), ground = h + (land - h) * k;
    if (s >= BANK) return ground;
    if (s >= 0) return this.level + (ground - this.level) * smooth(0, BANK, s);
    return this.level - 1 - Math.min(7, -s * 0.2); // shallow enough to fly over without a seabed in view
  }
  color(dir, h, out) {
    const { d, th } = this.polar(dir), w = 1 - smooth(TINT, TINT + TINT_BAND, d);
    if (w <= 0) return;
    const n = 0.5 + 0.5 * this.noise.noise3(dir.x * 120, dir.y * 120, dir.z * 120);
    const c = [RUST[0], RUST[1], RUST[2]];
    mix(c, RUST2, smooth(0.45, 0.8, n));
    mix(c, MOSS, smooth(0.5, 0.2, n) * 0.7);
    mix(c, EARTH, 1 - smooth(BANK * 0.3, BANK * 1.6, d - this.shore(th)));
    mix(c, DUSK, smooth(FOREST * 0.8, TINT, d));
    mix(out, c, w);
  }
  // trees and chat builds both stay out of the park
  clearance(dir) { return Math.max(0, this.polar(dir).d - FOREST); }
}

// ---------------------------------------------------------------- the trees
const crown = (parts) => baked(mergeGeometries(parts.map((p) => p.toNonIndexed())), 0xffffff);
const lobe = (r, detail, x, y, z, sy = 1) => { const g = new THREE.IcosahedronGeometry(r, detail); g.deleteAttribute('uv'); return g.scale(1, sy, 1).translate(x, y, z); };
const tier = (r, h, y) => { const g = new THREE.ConeGeometry(r, h, 7, 1, true); g.deleteAttribute('uv'); return g.translate(0, y, 0); };

function buildForest(rec, f, planet, toLocal) {
  const list = { maple: [], birch: [], pine: [] };
  const rng = mulberry32(hash(rec.id)), dir = new THREE.Vector3();
  const attempts = rec.count ?? 30000, n = planet.noise2, rest = f.shore(Math.PI);
  for (let i = 0; i < attempts; i++) {
    const r = FOREST * Math.sqrt(rng()), th = rng() * Math.PI * 2;
    const x = Math.sin(th) * r, z = -Math.cos(th) * r;
    if (r - f.shore(th) < BANK * 1.3) continue;
    if (z > rest - 30 && z < rest + TRAIL_BACK + 40 && Math.abs(x - f.trailX(z)) < 34) continue;
    if (Math.hypot(x, z - f.gateZ) < 150 || Math.hypot(x - 150, z - f.gateZ - 30) < 80) continue;
    dir.copy(f.dirAt(x, z));
    const clump = n.noise3(dir.x * 110 + 5, dir.y * 110, dir.z * 110);
    if (rng() > smooth(-0.7, -0.25, clump) * (1 - smooth(FOREST * 0.86, FOREST, r))) continue;
    const elev = planet.elevation(dir);
    if (elev < 2.5) continue;
    const patch = n.noise3(dir.x * 70 + 9, dir.y * 70, dir.z * 70) * 0.5 + 0.5, roll = rng() + (patch - 0.5) * 0.6;
    const kind = roll < 0.3 ? 'pine' : roll < 0.42 ? 'birch' : 'maple';
    const h = kind === 'pine' ? 52 + rng() * 34 : kind === 'birch' ? 36 + rng() * 12 : 38 + rng() * 16;
    const palette = LEAVES[kind];
    list[kind].push({
      pos: dir.clone().multiplyScalar(R + elev - 0.4).applyMatrix4(toLocal.matrix), up: dir.clone().applyQuaternion(toLocal.quaternion),
      h, w: 1.05 + rng() * 0.35, yaw: rng() * Math.PI * 2, color: palette[Math.floor(rng() * palette.length)],
    });
  }
  const geos = {
    maple: crown([lobe(0.34, 1, 0, 0.66, 0, 0.92), lobe(0.23, 0, 0.19, 0.5, 0.08)]),
    birch: crown([lobe(0.27, 1, 0, 0.7, 0, 1.2)]),
    pine: crown([tier(0.2, 0.42, 0.34), tier(0.155, 0.38, 0.56), tier(0.105, 0.36, 0.76)]),
  };
  const group = new THREE.Group(), all = [...list.maple, ...list.birch, ...list.pine];
  const unitUp = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), s = new THREE.Vector3(), col = new THREE.Color();
  const setM = (t) => { q.setFromUnitVectors(unitUp, t.up); qy.setFromAxisAngle(unitUp, t.yaw); q.multiply(qy); s.set(t.h * t.w, t.h, t.h * t.w); m.compose(t.pos, q, s); };
  const mat = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  for (const kind of Object.keys(list)) {
    const trees = list[kind];
    if (!trees.length) continue;
    const mesh = new THREE.InstancedMesh(geos[kind], mat(), trees.length);
    trees.forEach((t, i) => { setM(t); mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.set(t.color)); });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  const trunks = new THREE.InstancedMesh(baked(new THREE.CylinderGeometry(0.03, 0.05, 0.6, 5, 1, true).translate(0, 0.3, 0), 0xffffff), mat(), all.length);
  all.forEach((t, i) => {
    setM(t); trunks.setMatrixAt(i, m);
    trunks.setColorAt(i, col.set(list.birch.includes(t) ? 0xefe8da : 0x5a3a24));
  });
  trunks.computeBoundingSphere();
  group.add(trunks);
  group.userData.treeCount = all.length;
  return group;
}

// ---------------------------------------------------------------- the gate
function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 288;
  const x = c.getContext('2d');
  x.fillStyle = '#c8552f'; x.fillRect(0, 0, 1024, 288);
  x.strokeStyle = '#f6e7cf'; x.lineWidth = 7; x.strokeRect(20, 20, 984, 248);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#f6e7cf';
  x.font = '132px Georgia, "Times New Roman", serif';
  if ('letterSpacing' in x) x.letterSpacing = '20px';
  x.fillText('ASHLAND', 522, 118);
  x.fillStyle = '#f4c04e';
  x.font = '40px Georgia, "Times New Roman", serif';
  if ('letterSpacing' in x) x.letterSpacing = '14px';
  x.fillText('EXPLORE. EXPLOIT.', 519, 222);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// A timber gate on stone piers, about 120 m high, with room to fly under the sign.
// It faces +z, back along the heading, the way visitors come.
function buildGate() {
  const g = new THREE.Group(), bag = new Bag(), rng = mulberry32(1880);
  const LOG = 0x7a4a2a, DARK = 0x54301c, STONE = 0xa89a8c, ROOF = 0x2c5a44, OPT = { ink: false };
  const log = (r0, r1, len, x, y, z, rz = 0, c = LOG) => bag.add(new THREE.CylinderGeometry(r0, r1, len, 8).rotateZ(rz), c, { x, y, z, ...OPT });
  for (const side of [-1, 1]) {
    const px = side * 76;
    bag.lathe([[25, 0], [22, 26], [26, 29], [19, 33]], STONE, px, 0, 0, 7, false);
    log(9, 11.5, 112, px, 86, 0);
    log(4.5, 4.5, 44, side * 60, 90, -7, side * 0.72);              // a knee brace, behind the sign
    bag.add(new THREE.BoxGeometry(8, 10, 8), 0xffc75e, { x: px, y: 66, z: 15, ...OPT }); // a lantern
    bag.box(11, 2, 11, DARK, px, 72, 15, 0, false);
    bag.box(11, 2, 11, DARK, px, 60, 15, 0, false);
    // low stone walls curving out into the trees
    for (let i = 0; i < 16; i++) {
      const a = 0.08 * i, d = 108 + i * 22, sz = 11 + rng() * 7;
      const stone = new THREE.IcosahedronGeometry(sz, 0).scale(1, 0.72, 1);
      bag.add(stone, i % 3 ? STONE : 0x8d8173, { x: side * d * Math.cos(a), y: sz * 0.45, z: d * Math.sin(a) - 12, ry: rng() * 6, ...OPT });
    }
    // the roof's two slopes
    bag.add(new THREE.BoxGeometry(112, 5, 44).rotateZ(-side * 0.32), ROOF, { x: side * 53, y: 134 - 0, z: 0, ...OPT });
    bag.add(new THREE.BoxGeometry(112, 2, 46).rotateZ(-side * 0.32), 0x3d7a5c, { x: side * 53, y: 137.5, z: 0, ...OPT });
  }
  log(8.5, 8.5, 190, 0, 112, 0, Math.PI / 2);
  log(6, 6, 158, 0, 74, 0, Math.PI / 2, DARK);
  bag.box(136, 36, 5, DARK, 0, 93, 0, 0, false);
  for (const x of [-52, 52]) log(1.4, 1.4, 6, x, 112, 3, 0, 0x222222);
  bag.build(g);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(128, 32), new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false }));
  sign.position.set(0, 93, 2.7);
  const back = sign.clone();
  back.position.z = -2.7; back.rotation.y = Math.PI;
  g.add(sign, back);
  return g;
}

// The ranger's cabin by the gate, and a neat pile of logs.
function buildCabin() {
  const g = new THREE.Group(), bag = new Bag(), OPT = { ink: false };
  bag.box(60, 32, 42, 0xa8562e, 0, 16, 0, 0, false);
  bag.box(11, 20, 2, 0x4a2a1a, -8, 10, 21.5, 0, false);
  bag.box(14, 11, 2, 0xffd27a, 16, 18, 21.5, 0, false);
  bag.add(new THREE.CylinderGeometry(1, 1, 70, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2).scale(1, 16, 28), 0x2c5a44, { y: 40, ...OPT });
  bag.box(8, 34, 8, 0x8d8173, 18, 46, -8, 0, false);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
    bag.add(new THREE.CylinderGeometry(3.6, 3.6, 34, 7).rotateX(Math.PI / 2), i % 2 ? 0x8a5a34 : 0x70462a, { x: -58 + i * 7.4 + row * 3.7, y: 3.6 + row * 6.4, z: 6, ...OPT });
  }
  bag.build(g);
  return g;
}

// The dock, on piles, running out from the end of the trail, and two rowboats.
function buildDock() {
  const g = new THREE.Group(), bag = new Bag(), OPT = { ink: false };
  for (let i = 0; i < 12; i++) bag.box(20, 1.2, 6.2, i % 2 ? 0x96683e : 0x8a5c36, 0, 3, -i * 7 - 4, 0, false);
  for (let i = 0; i < 5; i++) for (const x of [-9, 9]) bag.add(new THREE.CylinderGeometry(1, 1, 8, 6), 0x54301c, { x, y: 1.6, z: -i * 20 - 6, ...OPT });
  for (const [x, z, ry, c] of [[34, -64, 0.5, 0xc8552f], [-40, -96, -0.9, 0xeadfc8]]) {
    bag.add(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(7, 4.5, 21), c, { x, y: 2.8, z, ry, ...OPT });
    bag.add(new THREE.BoxGeometry(11, 0.9, 30), 0x54301c, { x, y: 2.5, z, ry, ...OPT });
  }
  bag.build(g);
  return g;
}

// ---------------------------------------------------------------- the water
function waterTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d'), rng = mulberry32(44);
  x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 520; i++) {
    const px = rng() * 512, py = rng() * 512, len = 8 + rng() * 34;
    x.strokeStyle = rng() < 0.55 ? 'rgba(255,255,255,.9)' : 'rgba(150,170,190,.55)';
    x.lineWidth = 1 + rng() * 1.4;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + len, py + len * 0.42); x.stroke();
  }
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = '#d6dde4'; x.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
function buildLake(f, toLocal) {
  const SIDES = 220, RINGS = 9, count = SIDES * (RINGS + 1) + 1;
  const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2), col = new Float32Array(count * 3), index = [];
  const c = new THREE.Color(), teal = new THREE.Color(0x74a5a6), deep = new THREE.Color(0x6d7f93), rose = new THREE.Color(0x8f8a9c);
  const put = (k, x, z, t) => {
    const p = f.dirAt(x, z).multiplyScalar(R + f.level).applyMatrix4(toLocal.matrix);
    pos.set([p.x, p.y, p.z], k * 3);
    uv.set([x / 170, z / 170], k * 2);
    c.copy(deep).lerp(rose, smooth(-300, 500, x + z * 0.4)).lerp(teal, smooth(0.72, 0.97, t) * 0.85);
    col.set([c.r, c.g, c.b], k * 3);
  };
  put(0, 0, 0, 0);
  for (let j = 0; j <= RINGS; j++) for (let i = 0; i < SIDES; i++) {
    const th = (i / SIDES) * Math.PI * 2, t = (j + 1) / (RINGS + 1), r = t * (f.shore(th) + 14);
    put(1 + j * SIDES + i, Math.sin(th) * r, -Math.cos(th) * r, t);
  }
  for (let i = 0; i < SIDES; i++) {
    const n = (i + 1) % SIDES;
    index.push(0, 1 + i, 1 + n);
    for (let j = 0; j < RINGS; j++) {
      const a = 1 + j * SIDES + i, b = 1 + j * SIDES + n, d = a + SIDES, e = b + SIDES;
      index.push(a, d, e, a, e, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  const tex = waterTexture();
  const lake = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, toneMapped: false, side: THREE.DoubleSide }));
  lake.userData.tex = tex;
  return lake;
}
// Ribbon laid along the ground through pairs of [left, right] points.
function ribbon(pairs, material) {
  const pos = new Float32Array(pairs.length * 6), index = [];
  pairs.forEach(([a, b], i) => {
    pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    if (i) { const k = i * 2; index.push(k - 2, k - 1, k, k, k - 1, k + 1); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  return new THREE.Mesh(geo, material);
}

// ---------------------------------------------------------------- the sky
function skyTexture() {
  const W = 2048, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d'), rng = mulberry32(1875);
  const Y = (e) => H * (0.5 - e / 180);   // elevation in degrees to canvas height
  const sky = x.createLinearGradient(0, Y(90), 0, Y(-12));
  sky.addColorStop(0, '#83abc4'); sky.addColorStop(0.45, '#a3b3c4'); sky.addColorStop(0.72, '#d3a8a4'); sky.addColorStop(0.9, '#e6b4a0'); sky.addColorStop(1, '#efc8a6');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  // long flat clouds, each with a bright edge on top
  const cloud = (cx, e, w, h, colour, rim) => {
    const blobs = [];
    for (let i = 0; i < 9; i++) blobs.push([cx + (rng() - 0.5) * w, Y(e) + (rng() - 0.5) * h, w * (0.14 + rng() * 0.22), h * (0.25 + rng() * 0.3)]);
    for (const [fill, dy] of [[rim, -3.5], [colour, 0]]) {
      x.fillStyle = fill;
      for (const shift of [-W, 0, W]) for (const [bx, by, rx, ry] of blobs) { x.beginPath(); x.ellipse(bx + shift, by + dy, rx, ry, 0, 0, 7); x.fill(); }
    }
  };
  for (let i = 0; i < 16; i++) cloud(rng() * W, 22 + rng() * 34, 240 + rng() * 300, 34 + rng() * 40, '#dba4a0', '#f7e7cf');
  for (let i = 0; i < 12; i++) cloud(rng() * W, 8 + rng() * 11, 200 + rng() * 280, 10 + rng() * 14, '#7f9db4', '#c7bdc0');
  // far hills in the haze, behind the real ones
  for (const [top, colour] of [[6.5, '#c8a79d'], [4.2, '#b5988f'], [2, '#a58b7e']]) {
    x.fillStyle = colour;
    x.beginPath(); x.moveTo(0, H);
    const a = rng() * 6, b = rng() * 6;
    for (let px = 0; px <= W; px += 8) {
      const t = (px / W) * Math.PI * 2;
      x.lineTo(px, Y(top + 1.3 * Math.sin(t * 5 + a) + 0.8 * Math.sin(t * 13 + b) + 0.35 * Math.sin(t * 31 + a)));
    }
    x.lineTo(W, H); x.closePath(); x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- leaves on the wind
function buildLeaves(count = 150) {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 1.7), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }), count);
  const rng = mulberry32(9), col = new THREE.Color(), colours = [...LEAVES.maple, ...LEAVES.birch];
  const list = Array.from({ length: count }, (_, i) => {
    mesh.setColorAt(i, col.set(colours[i % colours.length]));
    return { x: (rng() - 0.5) * 460, y: rng() * 160, z: (rng() - 0.5) * 420, fall: 5 + rng() * 6, phase: rng() * 6.3, spin: 0.8 + rng() * 2 };
  });
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  let t = 0;
  mesh.userData.blow = (dt) => {
    t += dt;
    list.forEach((l, i) => {
      l.y -= l.fall * dt;
      if (l.y < 0.5) l.y += 160;
      dummy.position.set(l.x + Math.sin(t * 0.5 + l.phase) * 22, l.y, l.z + Math.cos(t * 0.4 + l.phase) * 14);
      dummy.rotation.set(t * l.spin + l.phase, t * l.spin * 0.7, l.phase);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  mesh.userData.blow(0);
  return mesh;
}

// ---------------------------------------------------------------- putting it together
export function buildAshland(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.level);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.center, f.fwd.clone().negate()));
  site.updateMatrixWorld(true);
  const toLocal = { matrix: site.matrixWorld.clone().invert(), quaternion: site.quaternion.clone().invert() };
  const v = new THREE.Vector3();
  // a point on the ground at x, z, with its own up, in the site's frame
  const ground = (x, z, lift = 0) => {
    const dir = f.dirAt(x, z);
    return { pos: dir.clone().multiplyScalar(planet.groundRadius(dir) + lift).applyMatrix4(toLocal.matrix), up: dir.applyQuaternion(toLocal.quaternion) };
  };
  const stand = (obj, x, z, ry = 0, lift = 0) => {
    const g = ground(x, z, lift);
    obj.position.copy(g.pos);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), g.up).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry));
    site.add(obj);
    return obj;
  };

  const forest = buildForest(rec, f, planet, toLocal);
  site.add(forest);
  const lake = buildLake(f, toLocal);
  site.add(lake);

  // the white edge of the water, right round the shore
  const foam = [];
  for (let i = 0; i <= 260; i++) {
    const th = (i / 260) * Math.PI * 2, r = f.shore(th);
    const at = (d) => f.dirAt(Math.sin(th) * d, -Math.cos(th) * d).multiplyScalar(R + f.level + 0.4).applyMatrix4(toLocal.matrix);
    foam.push([at(r - 5), at(r + 2.5)]);
  }
  site.add(ribbon(foam, new THREE.MeshBasicMaterial({ color: 0xf5ead8, toneMapped: false, side: THREE.DoubleSide })));

  // the trail, from the woods through the gate to the dock
  const rest = f.shore(Math.PI), path = [];
  for (let z = rest + TRAIL_BACK; z >= rest - 4; z -= 7) {
    const x = f.trailX(z);
    path.push([ground(x - 9, z, 0.9).pos, ground(x + 9, z, 0.9).pos]);
  }
  site.add(ribbon(path, new THREE.MeshBasicMaterial({ color: 0x8e6039, toneMapped: false, side: THREE.DoubleSide })));

  const gate = stand(buildGate(), 0, f.gateZ);
  stand(buildCabin(), 150, f.gateZ + 30, -0.3);
  const leaves = stand(buildLeaves(), 0, f.gateZ + 30);
  // the dock sits on the water, not the bank
  const dock = stand(buildDock(), f.trailX(rest), rest);
  dock.position.copy(f.dirAt(f.trailX(rest), rest).multiplyScalar(R + f.level).applyMatrix4(toLocal.matrix));

  // the dusk sky, centred on the viewer so it stays at the horizon
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(30000, 48, 24),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false, fog: false }),
  );
  dome.frustumCulled = false;
  dome.visible = false;
  dome.renderOrder = 0.5;     // over the stars and the atmosphere, under the sea and clouds
  site.add(dome);

  // an invisible shape for clicking on the gate
  const hit = new THREE.Mesh(new THREE.BoxGeometry(200, 150, 60));
  hit.position.y = 75;
  hit.visible = false;
  gate.add(hit);

  site.userData.update = (dt) => {
    const eye = gardenCtx.viewer && gardenCtx.viewer();
    if (!eye) return;
    const d = eye.angleTo(f.center) * R, alt = eye.length() - R;
    const o = (1 - smooth(3400, 6000, d)) * (1 - smooth(1400, 3000, alt));
    dome.visible = o > 0.01;
    if (dome.visible) {
      dome.material.opacity = o;
      dome.position.copy(v.copy(eye).applyMatrix4(toLocal.matrix));
    }
    forest.visible = d < 9000;       // the far side of the planet needn't draw it
    if (d < 4000) lake.userData.tex.offset.x += dt * 0.012;
    leaves.visible = d < 2600;
    if (leaves.visible) leaves.userData.blow(dt);
  };
  site.userData.labelPos = ground(0, f.gateZ, 170).pos.clone();
  site.userData.labelRange = 7000;
  site.userData.forest = forest;

  const world = (x, z, lift) => ground(x, z, lift).pos.applyMatrix4(site.matrixWorld);
  site.userData.ashland = {
    site, hit, url: rec.url,
    center: gate.position.clone().applyMatrix4(site.matrixWorld),
    up: f.dirAt(0, f.gateZ),
    // the visitor's way in: down to the trail and through under the sign
    path(from) {
      const z = f.gateZ;
      return new THREE.CatmullRomCurve3([from.clone(), world(0, z + 300, 95), world(0, z + 130, 40), world(0, z, 34), world(f.trailX(z - 80), z - 80, 26), world(f.trailX(z - 150), z - 150, 20)]);
    },
    view: () => ({ lat: rec.lat, lon: rec.lon, alt: rec.alt ?? 350, heading: rec.heading ?? 0, pitch: rec.pitch ?? -14 }),
  };
  return site;
}
