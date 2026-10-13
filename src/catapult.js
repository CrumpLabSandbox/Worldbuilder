// The catapult: a giant trebuchet on a raised pad, a pen of ammunition in
// several sizes, ballistic flight under the planet's (radial) gravity with a
// little air drag, bounces, splashes, splats, and a predicted-trajectory arc.
import * as THREE from 'three';
import { R, latLonToDir, tangentFrame, dirToLatLon } from './planet.js';
import { mulberry32 } from './noise.js';

const G = 9.81;
const DEG = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------- terrain pad
export class CatapultFeature {
  constructor(rec, planet) {
    this.id = rec.id; this.rec = rec; this.kind = 'site';
    this.planet = planet;
    this.center = latLonToDir(rec.lat, rec.lon);
    this.pad = rec.pad ?? 50;
    this.band = rec.band ?? 28;
    this.target = planet.elevation(this.center) + (rec.raise ?? 5);
    this.heading = rec.heading ?? 0;
    this.lane = rec.lane ?? 450;            // length of the tree-free firing lane
    this.laneHalf = rec.laneWidth ?? 32;    // half-angle of the lane, degrees
    const fr = tangentFrame(this.center); this.east = fr.east.clone(); this.north = fr.north.clone();
    this.cosBound = Math.cos((Math.max(this.lane, this.pad + this.band) + 40) / R);
    this.maxHeight = 0;
  }
  dist(dir) { return Math.acos(clamp(dir.dot(this.center), -1, 1)) * R; }
  elev(dir, h) {
    let k = 1 - smooth(this.pad, this.pad + this.band, this.dist(dir));
    if (k <= 0) return h;
    // fade out before any road so the hill never buries it
    if (this.rec.yieldToRoads !== false) k *= smooth(10, 30, this.planet.roadClearance(dir));
    return h + (this.target - h) * k;
  }
  // trees keep well back, and a firing lane down the heading stays open
  clearance(dir) {
    const d = this.dist(dir);
    if (d < this.lane) {
      const v = dir.clone().addScaledVector(this.center, -dir.dot(this.center));
      const b = Math.atan2(v.dot(this.east), v.dot(this.north)) / DEG;
      let off = Math.abs(((b - this.heading + 540) % 360) - 180);
      if (off < this.laneHalf + 6 * (1 - d / this.lane)) return 0;
    }
    return Math.max(0, d - (this.pad + 22));
  }
}

// ---------------------------------------------------------------- ammunition
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
function vcolSphere(seg, colorFn, scale = [1, 1, 1]) {
  const g = new THREE.SphereGeometry(0.5, seg, Math.max(6, seg / 2)).toNonIndexed();
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let t = 0; t < pos.count; t += 3) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += pos.getX(t + k); y += pos.getY(t + k); z += pos.getZ(t + k); }
    colorFn(x / 3, y / 3, z / 3, c);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (t + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.scale(...scale);
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };

// Each builder returns a group about 1 unit across, centred on the origin.
export const AMMO = [
  { id: 'boulder', label: 'Boulder', emoji: '🪨', sizes: [1.5, 3, 6], density: 0.9, drag: 0.3, bounce: 0.15, colors: [0x8a8580, 0x6e6a66],
    build: () => {
      const g = new THREE.IcosahedronGeometry(0.5, 1);
      const rng = mulberry32(7); const p = g.attributes.position; const v = new THREE.Vector3();
      const seen = new Map();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = v.toArray().map((n) => n.toFixed(3)).join(); if (!seen.has(k)) seen.set(k, 0.82 + rng() * 0.3); v.multiplyScalar(seen.get(k)); p.setXYZ(i, v.x, v.y, v.z); }
      g.computeVertexNormals();
      return new THREE.Group().add(new THREE.Mesh(g, std(0x8a8580)));
    } },
  { id: 'barrel', label: 'Barrel', emoji: '🛢️', sizes: [1.2, 2.4], density: 0.8, drag: 0.6, bounce: 0.3, float: true, colors: [0x8b5a2b, 0x3a3a3a],
    build: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.9, 14), std(0x8b5a2b)));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 14), std(0x3a3a3a, { metalness: 0.6 })));
      for (const y of [-0.3, 0.3]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 14), std(0x3a3a3a, { metalness: 0.6 })); r.position.y = y; g.add(r); }
      return g;
    } },
  { id: 'crate', label: 'Crate', emoji: '📦', sizes: [1.4, 2.8], density: 0.7, drag: 0.7, bounce: 0.25, float: true, colors: [0xc49a5a, 0x8a6a3a],
    build: () => {
      const g = new THREE.Group();
      const wood = std(0xc49a5a), dark = std(0x8a6a3a);
      g.add(box(0.7, 0.7, 0.7, wood));
      for (const s of [-1, 1]) { g.add(box(0.72, 0.08, 0.72, dark, 0, s * 0.33, 0)); g.add(box(0.08, 0.72, 0.72, dark, s * 0.33, 0, 0)); }
      return g;
    } },
  { id: 'melon', label: 'Watermelon', emoji: '🍉', sizes: [0.8, 1.8], density: 1, drag: 0.5, bounce: 0, fragile: true, colors: [0xe8313c, 0x2f8a2f, 0x1d5a1d],
    build: () => new THREE.Group().add(new THREE.Mesh(vcolSphere(18, (x, y, z, c) => c.set(Math.sin(Math.atan2(y, z) * 8) > 0 ? 0x2f8a2f : 0x1d5a1d), [1.15, 0.85, 0.85]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }))) },
  { id: 'pumpkin', label: 'Pumpkin', emoji: '🎃', sizes: [1.2, 3], density: 0.9, drag: 0.5, bounce: 0, fragile: true, colors: [0xff8a1c, 0xffb347, 0x3a7a2a],
    build: () => {
      const g = new THREE.SphereGeometry(0.5, 24, 12); const p = g.attributes.position; const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const a = Math.atan2(v.z, v.x); const k = 1 + 0.07 * Math.cos(a * 10); p.setXYZ(i, v.x * k, v.y * 0.72, v.z * k); }
      g.computeVertexNormals();
      const grp = new THREE.Group().add(new THREE.Mesh(g, std(0xff8a1c, { flatShading: false, roughness: 0.6 })));
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.18, 6), std(0x3a7a2a)); stem.position.y = 0.42; grp.add(stem);
      return grp;
    } },
  { id: 'cow', label: 'Cow', emoji: '🐄', sizes: [2.6], density: 1, drag: 0.8, bounce: 0.3, colors: [0xf4f1ea, 0x222222], cry: 'Moooooo!',
    build: () => {
      const g = new THREE.Group(); const white = std(0xf4f1ea), black = std(0x222222), pink = std(0xf2a7b5);
      g.add(box(0.36, 0.3, 0.62, white, 0, 0.05, 0));
      g.add(box(0.37, 0.12, 0.2, black, 0, 0.12, -0.1)); g.add(box(0.2, 0.14, 0.15, black, 0.1, 0.0, 0.18));
      g.add(box(0.22, 0.22, 0.24, white, 0, 0.16, 0.38)); g.add(box(0.2, 0.1, 0.06, pink, 0, 0.1, 0.51));
      for (const s of [-1, 1]) { g.add(box(0.04, 0.08, 0.04, std(0xddd6c0), s * 0.09, 0.3, 0.36)); g.add(box(0.08, 0.04, 0.06, black, s * 0.14, 0.24, 0.36)); }
      for (const x of [-0.12, 0.12]) for (const z of [-0.22, 0.22]) g.add(box(0.08, 0.22, 0.08, white, x, -0.2, z));
      g.add(box(0.03, 0.2, 0.03, white, 0, 0.0, -0.33));
      g.position.y = 0.05;
      return new THREE.Group().add(g);
    } },
  { id: 'duck', label: 'Rubber duck', emoji: '🦆', sizes: [1.2, 4], density: 0.5, drag: 1.2, bounce: 0.55, float: true, colors: [0xffd21c, 0xff8a1c],
    build: () => {
      const g = new THREE.Group(); const y = std(0xffd21c, { flatShading: false, roughness: 0.4 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 12), y); body.scale.set(1, 0.7, 1.25); body.position.y = -0.12; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), y); head.position.set(0, 0.22, 0.24); g.add(head);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 10).rotateX(Math.PI / 2), std(0xff8a1c)); beak.position.set(0, 0.2, 0.48); beak.scale.y = 0.6; g.add(beak);
      for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), std(0x111111)); e.position.set(s * 0.1, 0.29, 0.42); g.add(e); }
      return g;
    } },
  { id: 'ball', label: 'Beach ball', emoji: '🏐', sizes: [2, 8], density: 0.15, drag: 4, bounce: 0.8, float: true, colors: [0xff3b3b, 0xffffff, 0x2b7bff, 0xffd21c],
    build: () => {
      const cols = [0xff3b3b, 0xffffff, 0x2b7bff, 0xffd21c, 0x2bd96b, 0xffffff];
      return new THREE.Group().add(new THREE.Mesh(vcolSphere(24, (x, y, z, c) => { if (Math.abs(y) > 0.47) return c.set(0xffffff); c.set(cols[Math.floor(((Math.atan2(z, x) / (Math.PI * 2)) + 1) * 6) % 6]); }), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 })));
    } },
  { id: 'anvil', label: 'Anvil', emoji: '⚒️', sizes: [1.2], density: 3, drag: 0.2, bounce: 0.05, colors: [0x2c2f36],
    build: () => {
      const g = new THREE.Group(); const iron = std(0x2c2f36, { metalness: 0.8, roughness: 0.35 });
      g.add(box(0.5, 0.16, 0.34, iron, 0, -0.28, 0)); g.add(box(0.22, 0.24, 0.2, iron, 0, -0.08, 0));
      g.add(box(0.8, 0.2, 0.3, iron, 0, 0.12, 0));
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 8).rotateZ(Math.PI / 2), iron); horn.position.set(0.55, 0.14, 0); g.add(horn);
      return g;
    } },
  { id: 'orb', label: 'Alien orb', emoji: '🔮', sizes: [2.5], density: 0.4, drag: 0.6, bounce: 0.65, float: true, colors: [0xff3ad1, 0x19f0d8],
    build: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), new THREE.MeshStandardMaterial({ color: 0xff3ad1, emissive: 0xff3ad1, emissiveIntensity: 1.2, roughness: 0.3 })));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 32).rotateX(1.2), new THREE.MeshStandardMaterial({ color: 0x19f0d8, emissive: 0x19f0d8, emissiveIntensity: 1.5 }));
      g.add(ring);
      return g;
    } },
];
const SIZE_NAMES = ['S', 'M', 'L', 'XL'];
export function sizeLabel(def, i) {
  const n = def.sizes.length;
  if (n === 1) return '';
  return (n === 2 ? ['S', 'L'] : ['S', 'M', 'L', 'XL'])[i] ?? '';
}
const ammoById = Object.fromEntries(AMMO.map((a) => [a.id, a]));
const builtCache = new Map();
export function makeAmmo(id, size) {
  const def = ammoById[id];
  if (!builtCache.has(id)) builtCache.set(id, def.build());
  const g = builtCache.get(id).clone(true);
  g.scale.setScalar(size);
  return g;
}
// heavier, bigger things leave the arm slower
export function speedFactor(def, size) {
  return clamp(Math.pow(2 / size, 0.35), 0.45, 1.25) / Math.pow(def.density, 0.12);
}

// ---------------------------------------------------------------- physics
const _up = new THREE.Vector3();
// advance one body; returns null while flying, else 'land' | 'water'
function stepBody(b, dt, planet) {
  const r = b.pos.length();
  _up.copy(b.pos).divideScalar(r);
  const sp = b.vel.length();
  const k = (0.00025 * b.drag) / Math.max(0.5, b.radius);
  b.vel.addScaledVector(_up, -G * dt).addScaledVector(b.vel, -k * sp * dt);
  b.pos.addScaledVector(b.vel, dt);
  const r2 = b.pos.length();
  _up.copy(b.pos).divideScalar(r2);
  const elev = planet.elevation(_up);
  const ground = R + Math.max(0, elev);
  if (r2 - b.radius * 0.8 <= ground) return elev < 0 ? 'water' : 'land';
  return null;
}
function terrainNormal(planet, dir) {
  const { east, north } = tangentFrame(dir);
  const d = 1.5 / R;
  const h = (v) => planet.elevation(dir.clone().addScaledVector(v, d).normalize());
  const hx = (h(east) - h(east.clone().negate())) / 3, hy = (h(north) - h(north.clone().negate())) / 3;
  return dir.clone().addScaledVector(east, -hx).addScaledVector(north, -hy).normalize();
}

// where something landed, in words
export function describePlace(planet, dir) {
  const e = planet.elevation(dir);
  for (const f of planet.features) {
    if (f.kind === 'coaster' && dir.dot(f.center) > f.cosBound && f.clearance(dir) < 25) return `right by the ${f.rec.name || 'coaster'}`;
  }
  for (const f of planet.features) {
    if (f.kind === 'road' && dir.dot(f.center) > f.cosBound && f.clearance(dir) < 12) return `on the ${f.rec.name || 'road'}`;
    if (f.kind === 'volcano' && f.dist(dir) < f.Rb) return f.dist(dir) < f.rc ? `in the crater of ${f.rec.name || 'the volcano'}` : `on the slopes of ${f.rec.name || 'the volcano'}`;
  }
  if (e < 0) return 'in the water';
  for (const f of planet.features) if (f.kind === 'woods' && f.contains(dir)) return `in ${f.rec.name || 'the woods'}`;
  return 'on open ground';
}

// ---------------------------------------------------------------- the trebuchet
export function buildCatapult(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  site.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(site.matrixWorld).invert();
  const invQ = site.quaternion.clone().invert();
  const baseHeading = rec.heading ?? 0;

  const wood = std(0x7a5230), darkWood = std(0x5a3a20), iron = std(0x3a3d44, { metalness: 0.7, roughness: 0.45 }), stone = std(0x8f877a);
  // stone platform
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(18, 19, 1.2, 28), stone); plat.position.y = 0.6; site.add(plat);
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(18.2, 0.35, 6, 48).rotateX(Math.PI / 2), std(0xc9b98f)); ringM.position.y = 1.2; site.add(ringM);

  // catapult body (faces local -Z), turned by the aim
  const cat = new THREE.Group(); cat.position.y = 1.2; site.add(cat);
  const beam = (a, b, t, mat = wood) => {
    const d = b.clone().sub(a), len = d.length();
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, len, t), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    cat.add(m); return m;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const x of [-4, 4]) beam(V(x, 2.1, -11), V(x, 2.1, 11), 1.1);
  for (const z of [-9, -3, 3, 9]) beam(V(-4.5, 2.1, z), V(4.5, 2.1, z), 0.9, darkWood);
  for (const x of [-5, 5]) for (const z of [-8, 8]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 16).rotateZ(Math.PI / 2), darkWood); w.position.set(x, 1.6, z); cat.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.8, 8).rotateZ(Math.PI / 2), iron); hub.position.set(x, 1.6, z); cat.add(hub);
  }
  for (const x of [-3.4, 3.4]) {
    beam(V(x, 2.6, -6.5), V(x, 14.2, 0), 1);
    beam(V(x, 2.6, 6.5), V(x, 14.2, 0), 1);
    beam(V(x, 7, -3.9), V(x, 7, 3.9), 0.7, darkWood);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 8.4, 12).rotateZ(Math.PI / 2), iron); axle.position.set(0, 14, 0); cat.add(axle);
  const winch = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 7, 12).rotateZ(Math.PI / 2), darkWood); winch.position.set(0, 3.2, 9); cat.add(winch);

  // throwing arm: long end along +Z (19 m), short end -Z (7 m), pivot at axle
  const pivot = new THREE.Group(); pivot.position.set(0, 14, 0); cat.add(pivot);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 26), wood); arm.position.z = 6; pivot.add(arm);
  for (const z of [-5, 3, 12]) { const band = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.25, 0.3), iron); band.position.z = z; pivot.add(band); }
  const cupAxis = new THREE.Vector3(0, Math.cos(40 * DEG), -Math.sin(40 * DEG));
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.2, 1.2, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x5a3a20, side: THREE.DoubleSide, roughness: 0.9 }));
  cup.position.set(0, 0, 19).addScaledVector(cupAxis, 0.6);
  cup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cupAxis);
  pivot.add(cup);
  const cupBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.2, 14), new THREE.MeshStandardMaterial({ color: 0x5a3a20 }));
  cupBase.position.set(0, 0, 19); cupBase.quaternion.copy(cup.quaternion); pivot.add(cupBase);
  const cw = new THREE.Group(); cw.position.set(0, 0, -7); pivot.add(cw);
  const cwBox = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), std(0x4a4a4e, { metalness: 0.4 })); cwBox.position.y = -3.6; cw.add(cwBox);
  for (const s of [-1, 1]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 0.3), iron); strap.position.set(s * 1.5, -0.9, 0); cw.add(strap); }
  const loaded = new THREE.Group(); loaded.position.set(0, 0, 19); pivot.add(loaded);

  // ---- ammunition pen (behind and to the left of the base heading)
  const penGroup = new THREE.Group();
  penGroup.rotation.y = -baseHeading * DEG;
  site.add(penGroup);
  const pen = new THREE.Group(); pen.position.set(-30, 1.2, 12); penGroup.add(pen);
  const PW = 32, PD = 24;
  const fence = std(0xb08850);
  for (let x = -PW / 2; x <= PW / 2 + 0.01; x += 2) for (const z of [-PD / 2, PD / 2]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 0.3), fence); post.position.set(x, 0.9, z); pen.add(post); }
  for (let z = -PD / 2; z <= PD / 2 + 0.01; z += 2) for (const x of [-PW / 2, PW / 2]) { if (x > 0 && Math.abs(z) < 3) continue; const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 0.3), fence); post.position.set(x, 0.9, z); pen.add(post); }
  for (const y of [0.7, 1.5]) {
    for (const z of [-PD / 2, PD / 2]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(PW, 0.18, 0.12), fence); rail.position.set(0, y, z); pen.add(rail); }
    for (const [z0, z1] of [[-PD / 2, PD / 2]]) { const rl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, PD), fence); rl.position.set(-PW / 2, y, (z0 + z1) / 2); pen.add(rl); }
    for (const zc of [-(PD / 2 + 3) / 2, (PD / 2 + 3) / 2]) { const rr = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, PD / 2 - 3), fence); rr.position.set(PW / 2, y, zc); pen.add(rr); }
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(PW, 0.15, PD), std(0x9c8a64)); floor.position.y = 0.05; pen.add(floor);
  const sign = new THREE.Group(); sign.position.set(PW / 2 + 1.5, 0, -4); pen.add(sign);
  sign.add(box(0.25, 3.2, 0.25, fence, 0, 1.6, 0)); sign.add(box(0.2, 1.4, 3.6, std(0x6a4526), 0, 3.2, 0));
  // lay out every ammo type and size in rows, biggest first
  const items = [];
  for (const def of AMMO) def.sizes.forEach((size, si) => items.push({ def, size, si }));
  items.sort((a, b) => b.size - a.size);
  const penPicks = [];
  let x = -PW / 2 + 1.2, z = -PD / 2 + 1.2, rowDepth = 0;
  for (const it of items) {
    const w = it.size + 1.2;
    if (x + w > PW / 2 - 0.8) { x = -PW / 2 + 1.2; z += rowDepth + 0.6; rowDepth = 0; }
    const m = makeAmmo(it.def.id, it.size);
    m.position.set(x + it.size / 2, it.size / 2 + 0.15, z + it.size / 2);
    m.rotation.y = (items.indexOf(it) * 1.7) % 6.28;
    m.traverse((o) => { o.userData.pick = { id: it.def.id, si: it.si }; });
    pen.add(m);
    penPicks.push({ mesh: m, id: it.def.id, si: it.si });
    x += w; rowDepth = Math.max(rowDepth, it.size);
  }
  const marker = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 8, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffe14a, emissive: 0xffc400, emissiveIntensity: 1.5 }));
  pen.add(marker);

  // ---- trajectory preview + landing marker (world-space line, local to site)
  const previewLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffe14a, dashSize: 6, gapSize: 4, transparent: true, opacity: 0.9 }));
  previewLine.frustumCulled = false;
  site.add(previewLine);
  const landMark = new THREE.Mesh(new THREE.TorusGeometry(6, 0.8, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe14a }));
  site.add(landMark);

  // ---- projectiles and effects
  const flying = []; const resting = []; const particles = [];
  const fx = new THREE.Group(); site.add(fx);
  const puffGeo = new THREE.IcosahedronGeometry(1, 0);
  const toSite = (worldPos, out) => out.copy(worldPos).applyMatrix4(toLocal);
  const spawnParticles = (worldPos, colors, count, speed, size, gravity = 9.81, life = 2.5, upBias = 0.6) => {
    const upv = worldPos.clone().normalize();
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0.9, flatShading: true, roughness: 1 }));
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      dir.addScaledVector(upv, upBias + Math.random() * 0.6).normalize();
      const p = { mesh: m, pos: worldPos.clone(), vel: dir.multiplyScalar(speed * (0.4 + Math.random() * 0.8)), life, max: life, size: size * (0.5 + Math.random()), gravity };
      fx.add(m); particles.push(p);
    }
  };

  const api = {
    catalog: AMMO, sizeLabel,
    selection: { id: 'boulder', si: 1 },
    power: rec.power ?? 150, angle: 45, aim: 0, follow: true,
    baseHeading, name: rec.name || 'Catapult',
    lastShot: null, onShot: null, onLand: null,
    phase: 'ready',
    site, feature: f,
    center() { return f.center.clone().multiplyScalar(R + f.target); },
    heading() { return (baseHeading + api.aim + 360) % 360; },
    current() { return ammoById[api.selection.id]; },
    currentSize() { const d = api.current(); return d.sizes[Math.min(api.selection.si, d.sizes.length - 1)]; },
    select(id, si) {
      const d = ammoById[id]; if (!d) return;
      api.selection = { id, si: Math.min(si ?? api.selection.si, d.sizes.length - 1) };
      reload(); api.refreshPreview();
    },
    // release point and velocity for the current settings (world space)
    launchState() {
      const save = pivot.rotation.x;
      pivot.rotation.x = -110 * DEG;
      cat.rotation.y = -api.heading() * DEG;
      site.updateMatrixWorld(true);
      const pos = new THREE.Vector3(0, 0, 19).applyMatrix4(pivot.matrixWorld);
      pivot.rotation.x = save; site.updateMatrixWorld(true);
      const upv = pos.clone().normalize();
      const { east: e, north: n } = tangentFrame(upv);
      const h = api.heading() * DEG, a = api.angle * DEG;
      const horiz = n.clone().multiplyScalar(Math.cos(h)).addScaledVector(e, Math.sin(h));
      const d = api.current();
      const speed = api.power * speedFactor(d, api.currentSize());
      const vel = horiz.multiplyScalar(Math.cos(a) * speed).addScaledVector(upv, Math.sin(a) * speed);
      return { pos, vel, speed };
    },
    refreshPreview() {
      const { pos, vel } = api.launchState();
      const d = api.current(), size = api.currentSize();
      const b = { pos: pos.clone(), vel: vel.clone(), radius: size / 2, drag: d.drag };
      const pts = [toSite(b.pos, new THREE.Vector3())];
      let hit = null;
      for (let t = 0; t < 180 && !hit; t += 1 / 30) {
        hit = stepBody(b, 1 / 30, planet);
        if (pts.length < 4000 && (Math.round(t * 30) % 2 === 0 || hit)) pts.push(toSite(b.pos, new THREE.Vector3()));
      }
      previewLine.geometry.dispose();
      previewLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      previewLine.computeLineDistances();
      landMark.visible = !!hit;
      if (hit) {
        const dir = b.pos.clone().normalize();
        const g = R + Math.max(0, planet.elevation(dir)) + 0.6;
        toSite(dir.clone().multiplyScalar(g), landMark.position);
        landMark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().applyQuaternion(invQ));
        const sc = clamp(dir.angleTo(f.center) * R / 300, 0.6, 4); landMark.scale.setScalar(sc);
      }
      api.predicted = hit ? { dist: b.pos.clone().normalize().angleTo(pos.clone().normalize()) * R, where: describePlace(planet, b.pos.clone().normalize()) } : null;
      cat.rotation.y = -api.heading() * DEG;
    },
    setPreviewVisible(v) { previewLine.visible = v; landMark.visible = v && !!api.predicted; },
    canFire() { return api.phase === 'ready'; },
    fire() {
      if (!api.canFire()) return false;
      api.phase = 'swing'; animT = 0;
      return true;
    },
    // the most recent flying (or just-landed) projectile, for the follow camera
    active: null,
  };

  function reload() {
    loaded.clear();
    const d = api.current(), size = api.currentSize();
    const m = makeAmmo(d.id, size);
    m.position.copy(cupAxis).multiplyScalar(size / 2 + 0.3);
    loaded.add(m);
    // selection marker in the pen
    const pick = penPicks.find((p) => p.id === d.id && p.si === api.selection.si);
    if (pick) { marker.position.set(pick.mesh.position.x, 0.25, pick.mesh.position.z); marker.scale.setScalar(size * 0.75 + 0.6); }
  }

  function release() {
    const { pos, vel } = api.launchState();
    const d = api.current(), size = api.currentSize();
    const mesh = makeAmmo(d.id, size);
    fx.add(mesh);
    const spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const body = { def: d, size, mesh, pos, vel, radius: size / 2, drag: d.drag, spinAxis, spin: (4 + Math.random() * 6) / Math.sqrt(size), quat: new THREE.Quaternion(), bounces: 0, state: 'fly', t: 0, start: pos.clone(), maxAlt: 0 };
    flying.push(body);
    api.active = body;
    loaded.clear();
    if (api.onShot) api.onShot(body);
  }

  function land(b, kind) {
    const dir = b.pos.clone().normalize();
    if (kind === 'water') {
      spawnParticles(dir.clone().multiplyScalar(R + 0.5), [0xffffff, 0xbfe6ff, 0x7cc4ff], 10 + Math.min(30, b.size * 6), 6 + b.vel.length() * 0.08, 0.6 + b.size * 0.25, 9.81, 2.2, 1.2);
      b.state = b.def.float ? 'float' : 'sink'; b.vel.set(0, 0, 0); b.t = 0;
      b.pos.copy(dir).multiplyScalar(R + (b.def.float ? b.radius * 0.4 : 0));
      return true;
    }
    const n = terrainNormal(planet, dir);
    const vn = b.vel.dot(n);
    const ground = R + Math.max(0, planet.elevation(dir));
    b.pos.copy(dir).multiplyScalar(ground + b.radius * 0.85);
    const impact = Math.abs(vn);
    if (impact > 3) spawnParticles(b.pos.clone(), [0x9c8a64, 0x7d6e52, 0xb8a888], Math.min(26, 6 + Math.round(b.size * 3 + impact * 0.1)), 3 + impact * 0.12, 0.4 + b.size * 0.3, 4, 2.2, 0.9);
    if (b.def.fragile) {
      spawnParticles(b.pos.clone(), b.def.colors, 22 + Math.round(b.size * 6), 6 + impact * 0.1, 0.15 + b.size * 0.12, 9.81, 3.5, 0.7);
      const splat = new THREE.Mesh(new THREE.CircleGeometry(b.size * 1.1, 18), new THREE.MeshStandardMaterial({ color: b.def.colors[0], roughness: 1, side: THREE.DoubleSide }));
      toSite(dir.clone().multiplyScalar(ground + 0.12), splat.position);
      splat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().applyQuaternion(invQ));
      fx.remove(b.mesh); fx.add(splat); b.mesh = splat; b.state = 'splat';
      return true;
    }
    if (vn < 0) b.vel.addScaledVector(n, -(1 + b.def.bounce) * vn);
    const vt = b.vel.clone().addScaledVector(n, -b.vel.dot(n));
    b.vel.addScaledVector(vt, -0.35);
    b.spin *= 0.6;
    b.bounces++;
    if (b.vel.length() < 2.5 || b.bounces > 7 || b.def.bounce < 0.1) { b.state = 'rest'; b.vel.set(0, 0, 0); return true; }
    return false;
  }

  function finish(b) {
    const i = flying.indexOf(b); if (i >= 0) flying.splice(i, 1);
    const dir = b.pos.clone().normalize();
    const dist = dir.angleTo(b.start.clone().normalize()) * R;
    const ll = dirToLatLon(dir);
    api.lastShot = { label: `${sizeLabel(b.def, b.def.sizes.indexOf(b.size))} ${b.def.label}`.trim(), dist, lat: ll.lat, lon: ll.lon, where: describePlace(planet, dir), state: b.state, maxAlt: b.maxAlt, time: b.flight };
    resting.push(b);
    while (resting.length > 40) { const old = resting.shift(); fx.remove(old.mesh); }
    if (api.onLand) api.onLand(api.lastShot, b);
  }

  let animT = 0;
  const COCKED = 40 * DEG, RELEASE = -110 * DEG;
  pivot.rotation.x = COCKED;
  cw.rotation.x = -COCKED;
  const tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  site.userData.update = (dt) => {
    // arm animation
    animT += dt;
    if (api.phase === 'swing') {
      const t = Math.min(1, animT / 0.55);
      pivot.rotation.x = COCKED + (RELEASE - COCKED) * t * t;
      if (t >= 1) { release(); api.phase = 'recoil'; animT = 0; }
    } else if (api.phase === 'recoil') {
      const t = animT / 0.9;
      pivot.rotation.x = RELEASE - 16 * DEG * Math.sin(Math.min(1, t) * Math.PI) * Math.exp(-t);
      if (t >= 1) { api.phase = 'rewind'; animT = 0; }
    } else if (api.phase === 'rewind') {
      const t = Math.min(1, animT / 2.2), e = t * t * (3 - 2 * t);
      pivot.rotation.x = RELEASE + (COCKED - RELEASE) * e;
      if (t >= 1) { api.phase = 'ready'; reload(); }
    }
    cw.rotation.x = -pivot.rotation.x;
    marker.rotation.y += dt * 1.5;

    // projectiles
    for (const b of flying.slice()) {
      if (b.state === 'fly') {
        const sub = Math.max(1, Math.ceil(b.vel.length() * dt / 1.5));
        const h = Math.min(dt, 0.1) / sub;
        for (let i = 0; i < sub && b.state === 'fly'; i++) {
          const hit = stepBody(b, h, planet);
          b.t += h; b.flight = b.t;
          b.maxAlt = Math.max(b.maxAlt, b.pos.length() - R);
          if (hit && land(b, hit)) { if (b.state !== 'fly') break; }
          if (b.t > 400) b.state = 'rest';
        }
        if (b.state !== 'fly') finish(b);
      }
      q.setFromAxisAngle(b.spinAxis, b.spin * dt);
      b.quat.premultiply(q);
    }
    for (const b of [...flying, ...resting]) {
      if (b.state === 'splat') continue;
      if (b.state === 'sink') { b.t += dt; b.pos.addScaledVector(b.pos.clone().normalize(), -dt * 1.2); if (b.t > 8) b.mesh.visible = false; }
      if (b.state === 'float') { b.t += dt; const upv = b.pos.clone().normalize(); b.pos.copy(upv).multiplyScalar(R + b.radius * 0.35 + Math.sin(b.t * 1.7) * 0.15); }
      toSite(b.pos, b.mesh.position);
      if (b.state === 'fly') b.mesh.quaternion.copy(invQ).multiply(b.quat);
    }
    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { fx.remove(p.mesh); p.mesh.material.dispose(); particles.splice(i, 1); continue; }
      const upv = tmp.copy(p.pos).normalize();
      p.vel.addScaledVector(upv, -p.gravity * dt).multiplyScalar(1 - 0.6 * dt);
      p.pos.addScaledVector(p.vel, dt);
      const g = R + Math.max(0, planet.elevation(upv));
      if (p.pos.length() < g + 0.1) { p.pos.setLength(g + 0.1); p.vel.multiplyScalar(0.3); }
      toSite(p.pos, p.mesh.position);
      const k = p.life / p.max;
      p.mesh.scale.setScalar(p.size * (1.4 - 0.6 * k));
      p.mesh.material.opacity = Math.min(1, k * 1.5) * 0.9;
    }
  };

  reload();
  api.refreshPreview();
  site.userData.catapult = api;
  site.userData.labelPos = new THREE.Vector3(0, 38, 0);
  site.userData.labelRange = 2500;
  return site;
}
