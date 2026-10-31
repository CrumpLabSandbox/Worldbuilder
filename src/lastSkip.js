// Last Skip: a moonstone amphitheatre stepping down into the sea. Water runs down
// its aisles, cairns of giant skipping stones crown the rim, a halo of stones turns
// over the stage and a moon gate stands in the water. Trying it skips a stone out
// through the gate and across the sea, and the camera chases it; then the visitor
// is taken to the game. The site faces -z, the record's heading, out to sea.
import * as THREE from 'three';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';

const DEG = Math.PI / 180;
const TIERS = 12, TREAD = 24, RISE = 10, STAGE = 100;  // the seating steps
const RIM_R = STAGE + TIERS * TREAD, RIM_Y = TIERS * RISE;
const ARC = 110;                                       // degrees either side of the back
const PLINTH_Z = -70, GATE_Z = -300;
const WINDUP = 0.8, SINK = 0.5;
const HOPS = [340, 270, 220, 175, 140, 110, 85, 60, 40, 25, 15]; // metres, each shorter than the last
const CHASE_BACK = 150, CHASE_UP = 34;

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
const STONE = std(0xb9b4ac), GOLD = std(0xd9b24a, { metalness: 0.7, roughness: 0.35, flatShading: false });
const MOONSTONE = 0xe8e2d4, LAPIS = 0x3f5f9e, PALE_GOLD = 0xdcc27e;

function add(parent, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// A skipping stone: a flattened, slightly lumpy pebble.
const pebble = (() => {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, rng = mulberry32(11);
  const dents = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!dents.has(key)) dents.set(key, 0.9 + rng() * 0.16);
    const k = dents.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.3, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
})();

// The seating, stair by stair: treads of moonstone, risers of lapis, a gold band every third.
function buildSeating(g) {
  const pts = [[STAGE, -24], [STAGE, 0]];
  for (let i = 0; i < TIERS; i++) {
    const r = STAGE + i * TREAD, y = (i + 1) * RISE;
    pts.push([r, y], [r + TREAD, y]);
  }
  pts.push([RIM_R + 14, RIM_Y], [RIM_R + 30, -24]);
  const v2 = pts.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(v2, 72, -ARC * DEG, 2 * ARC * DEG).toNonIndexed();
  geo.computeVertexNormals();
  const n = geo.attributes.normal, p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const tier = Math.round((p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 / RISE);
    c.set(Math.abs(n.getY(i)) < 0.5 ? LAPIS : tier % 3 === 0 ? PALE_GOLD : MOONSTONE);
    for (let k = 0; k < 3; k++) c.toArray(col, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  add(g, geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
  // the cut ends of the seating
  const end = new THREE.ShapeGeometry(new THREE.Shape(v2));
  for (const phi of [-ARC, ARC]) add(g, end, std(MOONSTONE, { side: THREE.DoubleSide })).rotation.y = (phi - 90) * DEG;
  // a colonnade round the rim, carrying a gold beam
  const cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(4, 5.5, 62, 10), std(MOONSTONE, { flatShading: false }), 25);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 25; i++) {
    const a = (-ARC + (2 * ARC * i) / 24) * DEG;
    cols.setMatrixAt(i, m.makeTranslation(Math.sin(a) * (RIM_R + 7), RIM_Y + 31, Math.cos(a) * (RIM_R + 7)));
  }
  g.add(cols);
  const beam = [[RIM_R, RIM_Y + 62], [RIM_R + 14, RIM_Y + 62], [RIM_R + 14, RIM_Y + 69], [RIM_R, RIM_Y + 69], [RIM_R, RIM_Y + 62]];
  add(g, new THREE.LatheGeometry(beam.map(([r, y]) => new THREE.Vector2(r, y)), 72, -ARC * DEG, 2 * ARC * DEG), GOLD);
}

// The stage, and broad round steps going down under the sea.
function buildStage(g) {
  const steps = [[STAGE, 0], [125, -4], [150, -8], [178, -12], [210, -18]];
  steps.forEach(([r, y], i) => add(g, new THREE.CylinderGeometry(r, r, 30, 72), std(i % 2 ? 0xd3cbb8 : MOONSTONE, { flatShading: false }), 0, y - 15, 0));
  add(g, new THREE.TorusGeometry(STAGE, 1.6, 8, 96).rotateX(Math.PI / 2), GOLD, 0, 0.4, 0);
  add(g, new THREE.CylinderGeometry(36, 36, 1, 48), new THREE.MeshBasicMaterial({ color: 0x7fe9f2, toneMapped: false }), 0, 0.4, 0);
  add(g, new THREE.TorusGeometry(37, 2.2, 8, 48).rotateX(Math.PI / 2), GOLD, 0, 1, 0);
}

// One flowing strip of water, from (r0, y0) to (r1, y1) along the aisle at angle phi.
function ribbon(g, material, phi, r0, y0, r1, y1, w = 15) {
  const geo = new THREE.BufferGeometry(), len = Math.hypot(r1 - r0, y1 - y0) / 60;
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, y0, r0, w / 2, y0, r0, -w / 2, y1, r1, w / 2, y1, r1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, len, 1, len], 2));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  add(g, geo, material).rotation.y = phi * DEG;
}
function waterTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d'), rng = mulberry32(5);
  ctx.fillStyle = '#39b7dc';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = 'rgba(225,250,255,.8)';
  for (let i = 0; i < 26; i++) ctx.fillRect(rng() * 60, rng() * 256, 2 + rng() * 4, 18 + rng() * 40);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// A balanced stack of giant stones. The top one or two float, and return for bobbing.
function cairn(g, x, y, z, size, count, rng, floaters) {
  const group = new THREE.Group(), bob = [];
  group.position.set(x, y, z);
  g.add(group);
  let h = 0;
  for (let i = 0; i < count; i++) {
    const s = size * (1 - (0.5 * i) / count) * (0.88 + rng() * 0.2), up = i >= count - 2;
    if (up) h += size * 0.45;
    const m = add(group, pebble, up ? std(0x8fdbe6, { emissive: 0x2a8ea3, emissiveIntensity: 0.7 }) : STONE, (rng() - 0.5) * size * 0.14, h + s * 0.2, (rng() - 0.5) * size * 0.14);
    m.scale.setScalar(s);
    m.rotation.set((rng() - 0.5) * 0.14, rng() * 6.3, (rng() - 0.5) * 0.14);
    if (up) { m.userData.y = m.position.y; m.userData.t = rng() * 6.3; bob.push(m); }
    h += s * 0.42;
  }
  floaters.push(...bob);
  return h;
}

export function buildLastSkip(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const h = (rec.heading ?? 0) * DEG;
  const g = new THREE.Group();                    // faces -z, out to sea
  g.rotation.y = -h;
  site.add(g);
  const seaY = -f.target;

  buildSeating(g);
  buildStage(g);

  // water pouring down the aisles to the pool in the middle of the stage
  const water = waterTexture();
  const flow = new THREE.MeshBasicMaterial({ map: water, toneMapped: false, side: THREE.DoubleSide });
  for (const phi of [-84, -42, 0, 42, 84]) {
    ribbon(g, flow, phi, 36, 1.1, STAGE - 2, 1.1);
    ribbon(g, flow, phi, STAGE - 2, 1.1, STAGE, 13);
    ribbon(g, flow, phi, STAGE, 13, RIM_R - TREAD, RIM_Y + 3);
  }

  // cairns: along the rim, and two in the sea carrying the moon gate
  const rng = mulberry32(66), floaters = [];
  for (const [a, size, n] of [[-ARC, 44, 9], [-55, 34, 7], [0, 46, 10], [55, 34, 7], [ARC, 44, 9]]) {
    cairn(g, Math.sin(a * DEG) * (RIM_R + 8), RIM_Y + 69, Math.cos(a * DEG) * (RIM_R + 8), size, n, rng, floaters);
  }
  for (const side of [-1, 1]) cairn(g, side * 126, seaY - 16, GATE_Z, 34, 13, rng, floaters);
  const gate = add(g, new THREE.TorusGeometry(116, 4.5, 12, 96), GOLD, 0, 100, GATE_Z);

  // the plinth and its heap of skipping stones
  add(g, new THREE.CylinderGeometry(19, 23, 9, 8), std(LAPIS), 0, 4.5, PLINTH_Z);
  for (let i = 0; i < 13; i++) {
    const a = rng() * 6.3, r = Math.sqrt(rng()) * 11, s = 4 + rng() * 2;
    const m = add(g, pebble, STONE, Math.cos(a) * r, 10 + (1 - r / 11) * 4 + rng() * 1.5, PLINTH_Z + Math.sin(a) * r);
    m.scale.setScalar(s);
    m.rotation.set((rng() - 0.5) * 0.5, rng() * 6.3, (rng() - 0.5) * 0.5);
  }

  // the halo of stones turning over the stage
  const halo = new THREE.Group();
  halo.position.set(0, 58, 0);
  halo.rotation.x = 0.16;
  g.add(halo);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, r = 64 + (i % 3) * 7;
    const m = add(halo, pebble, i % 4 ? STONE : std(0x8fdbe6, { emissive: 0x2a8ea3, emissiveIntensity: 0.7 }), Math.cos(a) * r, Math.sin(a * 3) * 7, Math.sin(a) * r);
    m.scale.setScalar(6 + (i % 4));
    m.rotation.y = -a;
  }

  // an invisible shape for clicking on the stones
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(84, 84, 90, 16));
  hit.position.y = 45;
  hit.visible = false;
  g.add(hit);

  // ---------------------------------------------------------------- the skip
  const axis = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
  // a point d metres out along the sea and alt above it, following the planet's curve
  const dirAt = (d, out = new THREE.Vector3()) => out.copy(f.center).multiplyScalar(Math.cos(d / R)).addScaledVector(axis, Math.sin(d / R));
  const at = (d, alt, out = new THREE.Vector3()) => dirAt(d, out).multiplyScalar(R + alt);

  const stone = add(site, pebble, std(0xcfeef2, { emissive: 0x53d6e6, emissiveIntensity: 0.9 }));
  stone.scale.setScalar(6);
  stone.visible = false;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9ff0ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.scale.setScalar(5);
  stone.add(glow);
  const ringGeo = new THREE.RingGeometry(0.84, 1, 48).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 24 }, () => {
    const m = add(site, ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.visible = false;
    m.userData.age = 0;
    return m;
  });
  const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _u = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const inverse = site.quaternion.clone().invert();
  function splash(d, big) {
    dirAt(d, _u).applyQuaternion(inverse);
    at(d, 0.5, _p);
    site.worldToLocal(_p);
    for (const [delay, size] of [[0, big], [0.14, big * 0.6]]) {
      const m = rings.find((r) => !r.visible);
      if (!m) return;
      m.position.copy(_p);
      m.quaternion.setFromUnitVectors(Y, _u);
      Object.assign(m.userData, { age: -delay, size });
      m.visible = true;
    }
  }
  function updateRings(dt) {
    for (const m of rings) {
      if (!m.visible) continue;
      const k = (m.userData.age += dt) / 0.9;
      m.material.opacity = k < 0 ? 0 : 0.85 * (1 - k);
      m.scale.setScalar(m.userData.size * (0.12 + Math.max(0, k)));
      if (k >= 1) m.visible = false;
    }
  }

  // hop by hop: where each starts and how long it takes, slowing as the stone tires
  let done = -PLINTH_Z, clock = 0;
  const hops = HOPS.map((len, i) => {
    const time = len / (760 * 0.93 ** i), hop = { from: done, len, start: clock, time, lift: Math.max(1.2, len * 0.1) };
    done += len; clock += time;
    return hop;
  });
  const flightTime = clock, landing = done;

  site.userData.update = (dt) => {
    water.offset.y -= dt * 1.1;
    halo.rotation.y += dt * 0.22;
    gate.rotation.z += dt * 0.05;
    for (const m of floaters) { m.userData.t += dt * 0.7; m.position.y = m.userData.y + Math.sin(m.userData.t) * 2.5; m.rotation.y += dt * 0.2; }
    updateRings(dt);
  };
  site.userData.labelPos = new THREE.Vector3(0, RIM_Y + 150, 0);
  site.userData.labelRange = 9000;

  const toWorld = (v) => v.clone().applyMatrix4(g.matrixWorld);
  site.userData.lastSkip = {
    site,
    hit,
    url: rec.url,
    center: site.position.clone(),
    // start the throw from wherever the camera is now
    play(camera) {
      const look = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(300).add(camera.position);
      return { t: 0, hop: 0, camFrom: camera.position.clone(), lookFrom: look, camD: -60, landed: false };
    },
    // one frame of the skip: returns true once the stone has sunk
    step(s, dt, camera) {
      s.t += dt;
      const fly = s.t - WINDUP;
      let d, alt;
      if (fly < 0) {
        d = -PLINTH_Z; alt = f.target + 22;
      } else if (fly < flightTime) {
        while (fly > hops[s.hop].start + hops[s.hop].time) { s.hop++; splash(hops[s.hop].from, 20 + hops[s.hop].len * 0.1); }
        const hop = hops[s.hop], k = (fly - hop.start) / hop.time;
        d = hop.from + hop.len * k;
        alt = 4 * hop.lift * k * (1 - k) + (s.hop ? 0.6 : (1 - k) * (f.target + 22));
      } else {
        if (!s.landed) { s.landed = true; splash(landing, 30); }
        d = landing; alt = 0.6 - (fly - flightTime) * 14;
      }
      stone.visible = true;
      stone.position.copy(site.worldToLocal(at(d, alt, _p)));
      stone.rotation.y += dt * 26;
      // the stone skims flat; the camera chases it out over the water
      camera.up.copy(dirAt(s.camD, _u));
      const chase = Math.max(-60, d - CHASE_BACK);
      s.camD += (chase - s.camD) * (1 - Math.exp(-6 * dt));
      at(s.camD, CHASE_UP, _q);
      const windup = THREE.MathUtils.smoothstep(s.t, 0, WINDUP * 0.9);
      camera.position.copy(s.camFrom).lerp(_q, windup);
      camera.lookAt(_q.copy(s.lookFrom).lerp(at(d, alt, _p), windup));
      return fly >= flightTime + SINK;
    },
    reset() { stone.visible = false; for (const m of rings) m.visible = false; },
    // up on the rim, looking down the steps and out to sea
    view() {
      const pos = toWorld(new THREE.Vector3(0, RIM_Y + 60, RIM_R - 40));
      return { pos, look: toWorld(new THREE.Vector3(0, 10, -420)).sub(pos).normalize() };
    },
  };
  return site;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d'), grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
