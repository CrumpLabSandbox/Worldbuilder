// The Walking University: a whole campus on six jointed legs. It waits crouched on
// its island; when someone goes in it gets up and walks, the world gives way to
// endless salt flats, and they fly in through a lit window high in the clock tower
// and land in the Chair's office, whose window really looks out over the campus as
// it strides along. ChairQuest itself runs in a frame laid over the office.
//
// Colours are baked into the model (a fixed sun, three flat tones), so it keeps
// its drawn look whatever time of day it is on the planet. The university faces
// -z, which is the record's heading, and walks that way. Everything here is in
// model units; the model is scaled down by SCALE to fit the island.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';

const DEG = Math.PI / 180;
export const SCALE = 0.6;
const DECK = 950;                       // top of the deck
const HIP_Y = 880, THIGH = 1000, SHIN = 1000;
const STRIDE = 300, CYCLE = 7, DUTY = 0.6; // a slow walk: feet stay down 60% of the time
const SPEED = STRIDE / (DUTY * CYCLE);  // ground speed at full walk
const CROUCH = 190;                     // how far the deck sits down when at rest
// [hip x, hip z, foot x, foot z, knee lean, tripod gait phase]; the front pair reach
// far forward, mantis-like, where the office window can watch their knees
const LEGS = [[-260, -700, -760, -1500, -0.5, 0], [260, -700, 760, -1500, -0.5, 0.5], [-420, -60, -990, -60, 0, 0.5], [420, -60, 990, -60, 0, 0], [-260, 700, -760, 1400, 0.5, 0], [260, 700, 760, 1400, 0.5, 0.5]];
const SKY = 16000, GROUND = 15000;      // the salt flats' extent
const WINDOW_Y = 1240, WINDOW_Z = -176; // the lit window the visitor flies in through
const ROOM = { y: 1215, z: -232, w: 52, h: 26, d: 34 }; // the office, a bay on the tower's front; its window wall is at z = ROOM.z

const SUN = new THREE.Vector3(-0.4, 0.62, -0.65).normalize();
const INK = new THREE.LineBasicMaterial({ color: 0x16110e });
const flat = (extra = {}) => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, ...extra });

// Colour a geometry with three flat tones of `color`, by how each face meets the sun.
export function baked(geometry, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  const n = g.attributes.normal, count = n.count, col = new Float32Array(count * 3);
  const base = new THREE.Color(color), v = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    v.fromBufferAttribute(n, i).add(new THREE.Vector3().fromBufferAttribute(n, i + 1)).add(new THREE.Vector3().fromBufferAttribute(n, i + 2)).normalize();
    const d = v.dot(SUN), t = d > 0.35 ? 1 : d > -0.2 ? 0.82 : 0.62;
    for (let k = 0; k < 3; k++) col.set([base.r * t, base.g * t, base.b * t], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

// Collects shapes, then merges them into one mesh, with ink over the ones that want it.
export class Bag {
  constructor() { this.solid = []; this.inked = []; }
  add(geometry, color, { x = 0, y = 0, z = 0, ry = 0, ink = true } = {}) {
    geometry.rotateY(ry).translate(x, y, z);
    const g = baked(geometry, color);
    this.solid.push(g);
    if (ink) this.inked.push(g);
    return this;
  }
  box(w, h, d, color, x, y, z, ry = 0, ink = true) { return this.add(new THREE.BoxGeometry(w, h, d), color, { x, y, z, ry, ink }); }
  // a turned shape: points are [radius, height]
  lathe(points, color, x, y, z, seg = 12, ink = true) {
    return this.add(new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.01), h)), seg), color, { x, y, z, ink });
  }
  build(parent) {
    const mesh = new THREE.Mesh(mergeGeometries(this.solid), flat());
    parent.add(mesh);
    if (this.inked.length) {
      const edges = this.inked.map((g) => new THREE.EdgesGeometry(g, 34));
      parent.add(new THREE.LineSegments(mergeGeometries(edges), INK));
      for (const e of edges) e.dispose();
    }
    return mesh;
  }
}
const dome = (r, h, base = 0, k = 7) => Array.from({ length: k + 1 }, (_, i) => { const t = (i / k) * Math.PI / 2; return [Math.cos(t) * r, base + Math.sin(t) * h]; });

// Little dark windows wrapped round a tower.
function windows(bag, x, y, z, r0, r1, y0, y1, rows, cols, color) {
  for (let j = 0; j < rows; j++) {
    const t = (j + 0.5) / rows, r = r0 + (r1 - r0) * t, h = ((y1 - y0) / rows) * 0.55;
    for (let i = 0; i < cols; i++) {
      const a = ((i + (j % 2) * 0.5) / cols) * Math.PI * 2;
      bag.add(new THREE.BoxGeometry(((Math.PI * 2 * r) / cols) * 0.45, h, 2), color, { x: x + Math.sin(a) * r, y: y + y0 + (y1 - y0) * t, z: z + Math.cos(a) * r, ry: a, ink: false });
    }
  }
}

// ---------------------------------------------------------------- the campus
function buildCampus(body) {
  const bag = new Bag(), rng = mulberry32(73), rand = (a, b) => a + rng() * (b - a);
  // the deck: a great shallow bowl with a pale rim
  bag.lathe([[0.1, 660], [280, 660], [720, 790], [960, 870]], 0xb85128, 0, 0, 0, 26);
  bag.lathe([[960, 870], [980, 950], [0.1, 950]], 0xf2e2b8, 0, 0, 0, 26);
  const walls = [0xf4e7c0, 0xe8b24a, 0x4aa9bd, 0xe8765a, 0xf4e7c0], slate = 0x222a55;
  let placed = 0;
  for (let i = 0; i < 400 && placed < 46; i++) {
    const a = rng() * Math.PI * 2, d = 880 * Math.sqrt(rng()), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (d < 260) continue;
    if (Math.abs(x) < 210 && z < 0) continue; // an avenue for the view from the office
    const tall = 90 + rng() * rng() * 620 * (1 - d / 1200), w = rand(44, 110), c = walls[placed++ % 5];
    if (placed % 4 === 0) {
      const hall = tall * 0.45 + 40, deep = w * 1.4;
      bag.box(w * 2.2, hall, deep, c, x, DECK + hall / 2, z, a);
      bag.add(new THREE.ConeGeometry(w * 1.5, w * 1.1, 4).rotateY(Math.PI / 4), slate, { x, y: DECK + hall + w * 0.55, z, ry: a });
      continue;
    }
    bag.lathe([[w, 0], [w * 0.82, tall], [w * 1.3, tall + 12], [w * 1.08, tall + 22]], c, x, DECK, z, 10);
    bag.lathe(dome(w * 0.92, w * 0.8), slate, x, DECK + tall + 22, z, 10);
    windows(bag, x, DECK, z, w * 0.98, w * 0.86, 14, tall * 0.92, Math.max(2, Math.round(tall / 50)), 10, slate);
  }
  // the clock tower's base; its top stays separate, since the office replaces it
  bag.lathe([[190, 0], [150, 620]], 0xf4e7c0, 0, DECK, 0, 18);
  windows(bag, 0, DECK, 0, 192, 152, 40, 590, 9, 22, slate);
  for (const [x, z] of [[-170, 240], [150, 310]]) bag.lathe([[34, 0], [26, 620], [34, 650]], slate, x, 1050, z, 8);
  bag.build(body);

  const top = new THREE.Group(), spire = new Bag();
  spire.lathe([[150, 0], [100, 240], [180, 280], [160, 360]], 0xf4e7c0, 0, DECK + 620, 0, 18);
  spire.lathe(dome(140, 130), 0xe8765a, 0, DECK + 980, 0, 18);
  spire.build(top);
  const lit = new THREE.Shape();
  lit.moveTo(-28, -30); lit.lineTo(-28, 8); lit.absarc(0, 8, 28, Math.PI, 0, true); lit.lineTo(28, -30); lit.closePath();
  const pane = new THREE.Mesh(new THREE.ShapeGeometry(lit), new THREE.MeshBasicMaterial({ color: 0xffd76a, toneMapped: false, side: THREE.DoubleSide }));
  pane.position.set(0, WINDOW_Y, WINDOW_Z);
  pane.rotation.y = Math.PI;
  top.add(pane);
  body.add(top);
  return top;
}

// ---------------------------------------------------------------- legs
const unitTube = (r0, r1) => { const g = new THREE.CylinderGeometry(r1, r0, 1, 10); g.translate(0, 0.5, 0); return g; };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
function placeBone(m, from, to) {
  _d.subVectors(to, from);
  m.scale.set(1, _d.length(), 1);
  m.position.copy(from);
  m.quaternion.setFromUnitVectors(Y, _d.normalize());
}
function buildLeg(parent, thighGeo, shinGeo, thighEdges, shinEdges, jointGeo, footGeo) {
  const leg = {};
  const part = (geo, edges) => { const m = new THREE.Mesh(geo, flat()); m.add(new THREE.LineSegments(edges, INK)); parent.add(m); return m; };
  leg.thigh = part(thighGeo, thighEdges);
  leg.shin = part(shinGeo, shinEdges);
  leg.knee = new THREE.Mesh(jointGeo, flat());
  leg.foot = new THREE.Mesh(footGeo, flat());
  leg.foot.add(new THREE.LineSegments(new THREE.EdgesGeometry(footGeo, 34), INK));
  parent.add(leg.knee, leg.foot);
  return leg;
}

// ---------------------------------------------------------------- the salt flats
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function cloud(c, rng, x, y, w, h) {
  const n = 5 + Math.floor(rng() * 4);
  c.beginPath(); c.moveTo(x - w, y);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, r = (w / n) * (1.2 + rng() * 0.4), cx = x - w + 2 * w * t, cy = y - Math.sin(t * Math.PI) * h * (0.7 + rng() * 0.4);
    c.quadraticCurveTo(cx - r, cy - r * 1.6, cx + r, cy - r * 0.2);
  }
  c.lineTo(x + w, y); c.closePath();
  c.fillStyle = '#fbfdf6'; c.fill();
  c.strokeStyle = '#2a5fae'; c.lineWidth = 2; c.stroke();
}
function buildFlats() {
  const g = new THREE.Group(), rng = mulberry32(731);
  const sky = canvasTexture(2048, 1024, (c, w, h) => {
    const up = c.createLinearGradient(0, 0, 0, h / 2);
    [[0, '#0d3f9a'], [0.45, '#1f6fd0'], [0.8, '#8fd0f2'], [1, '#f4f7ea']].forEach(([p, col]) => up.addColorStop(p, col));
    c.fillStyle = up; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) cloud(c, rng, rng() * w, h * (0.3 + rng() * 0.19), 40 + rng() * 90, 16 + rng() * 26);
  });
  const dome_ = new THREE.Mesh(new THREE.SphereGeometry(SKY, 40, 24), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, toneMapped: false, depthWrite: false }));
  dome_.renderOrder = -1;
  g.add(dome_);
  // cracked salt, in tiles that scroll under the walking feet
  const tile = 1800;
  const salt = canvasTexture(1024, 1024, (c, w, h) => {
    c.fillStyle = '#f6f1e2'; c.fillRect(0, 0, w, h);
    const cells = 7, s = w / cells;
    c.strokeStyle = '#b4bcb8'; c.lineWidth = 3.5; c.lineJoin = 'round';
    // a wrapping hex crack pattern, with jittered corners shared across edges
    const jit = [...Array(cells * 2 * cells)].map(() => [(rng() - 0.5) * s * 0.3, (rng() - 0.5) * s * 0.3]);
    const pt = (i, j) => { const J = jit[((j + 2 * cells) % (2 * cells)) * cells + ((i + cells) % cells)]; return [(i + (j % 2 ? 0.5 : 0)) * s + J[0], j * s * 0.5 + J[1]]; };
    for (let j = -1; j <= cells * 2; j++) for (let i = -1; i <= cells; i++) {
      const a = pt(i, j), b = pt(i + (j % 2 ? 1 : 0), j + 1), e = pt(i + (j % 2 ? 0 : -1), j + 1);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.moveTo(a[0], a[1]); c.lineTo(e[0], e[1]); c.stroke();
    }
  });
  salt.wrapS = salt.wrapT = THREE.RepeatWrapping;
  salt.repeat.set((GROUND * 2) / tile, (GROUND * 2) / tile);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(GROUND, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: salt, toneMapped: false }));
  // CircleGeometry's uvs only span 0..1 across it, which suits the repeat above
  g.add(ground);
  // the campus's shadow, always under it
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(980, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9db8d2, toneMapped: false, transparent: true, opacity: 0.75, depthWrite: false }));
  shadow.scale.set(1.2, 1, 0.8);
  shadow.position.set(260, 1, -200);
  g.add(shadow);
  // old footprints trailing away behind it
  const prints = canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#c7cdc9'; c.strokeStyle = '#8f9a98'; c.lineWidth = 3;
    c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.42, h * 0.2, 0, 0, 7); c.fill(); c.stroke();
  });
  prints.wrapT = THREE.RepeatWrapping;
  const printLen = 11000, step = STRIDE / DUTY;
  prints.repeat.set(1, printLen / step);
  const trails = [];
  for (const x of [-990, -760, 760, 990]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(170, printLen).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: prints, transparent: true, toneMapped: false, depthWrite: false }));
    t.position.set(x, 1.5, 1000 + printLen / 2);
    g.add(t);
    trails.push(t);
  }
  // far mesas that drift slowly past, so the whole landscape moves
  const bag = new Bag(), mesas = [];
  const mesaGroup = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const r = 500 + rng() * 800, h = 160 + rng() * 420, m = new THREE.Mesh(baked(new THREE.CylinderGeometry(r * 0.55, r, h, 8), 0xa9b6dc), flat());
    const side = i % 2 ? 1 : -1;
    m.position.set(side * (4200 + rng() * 6000), h / 2, -12000 + (i / 14) * 24000);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 34), new THREE.LineBasicMaterial({ color: 0x7687b8 })));
    mesaGroup.add(m);
    mesas.push(m);
  }
  g.add(mesaGroup);
  // stragglers hurrying after the campus with their luggage
  for (const [x, z] of [[-1180, 1150], [-1140, 1190], [-1095, 1130], [-1040, 1210], [-1000, 1160]]) {
    bag.add(new THREE.ConeGeometry(11, 42, 8), 0x16110e, { x, y: 21, z, ink: false });
    bag.add(new THREE.SphereGeometry(7, 8, 6), 0xf5d7a8, { x, y: 46, z, ink: false });
  }
  bag.box(30, 20, 20, 0xe8b24a, -960, 10, 1180);
  bag.build(g);
  return {
    group: g,
    walk(dz) {
      salt.offset.y = (salt.offset.y + (dz / (GROUND * 2)) * salt.repeat.y) % 1;
      prints.offset.y = (prints.offset.y - dz / step) % 1;
      for (const m of mesas) { m.position.z += dz * 0.5; if (m.position.z > 12000) m.position.z -= 24000; }
    },
  };
}

// ---------------------------------------------------------------- the office
function buildOffice() {
  const room = new THREE.Group(), bag = new Bag(), rng = mulberry32(8);
  const { w, h, d } = ROOM, tan = 0xc9a66b, wood = 0x7a4a2b, dark = 0x5a361c, frame = 0x16110e;
  // the window wall, with a tall arched opening cut out of it
  const open = 21, spring = 13;
  const wall = new THREE.Shape();
  wall.moveTo(-w / 2, 0); wall.lineTo(w / 2, 0); wall.lineTo(w / 2, h); wall.lineTo(-w / 2, h); wall.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-open, 1); hole.lineTo(open, 1); hole.lineTo(open, spring);
  hole.absellipse(0, spring, open, h - spring - 1.2, 0, Math.PI, false); hole.lineTo(-open, 1);
  wall.holes.push(hole);
  bag.add(new THREE.ShapeGeometry(wall, 32), tan, { ink: false }); // faces +z, into the room
  // mullions
  for (const x of [-10.5, 0, 10.5]) bag.box(0.5, h - 3, 0.5, frame, x, h / 2 - 0.2, 0.2, 0, false);
  for (const y of [spring - 5, spring]) bag.box(open * 2, 0.5, 0.5, frame, 0, y, 0.2, 0, false);
  bag.box(open * 2 + 1.4, 0.6, 1.6, wood, 0, 0.8, 0.8);             // sill
  bag.box(w, 0.4, d, dark, 0, -0.2, d / 2, 0, false);               // floor
  bag.box(w, 0.4, d, 0xe9dcbc, 0, h + 0.2, d / 2, 0, false);        // ceiling
  bag.box(w, h, 0.4, tan, 0, h / 2, d, 0, false);                   // back wall
  // shelves of binders down both sides
  for (const s of [-1, 1]) {
    bag.box(0.4, h, d, tan, s * (w / 2 + 0.2), h / 2, d / 2, 0, false);
    for (let y = 2; y < h - 3; y += 5) {
      bag.box(3.6, 0.35, d - 2, wood, s * (w / 2 - 1.8), y, d / 2);
      for (let z = 1.6; z < d - 2;) {
        const t = 0.7 + rng() * 1.1, ht = 2.8 + rng() * 1.3;
        bag.box(2.8, ht, t, [0x7a2e2e, 0x22314a, 0xc9a66b, 0x3f6b5a, 0xe9e1cb][Math.floor(rng() * 5)], s * (w / 2 - 1.9), y + 0.18 + ht / 2, z + t / 2);
        z += t + 0.05;
      }
    }
  }
  // the desk, with the department's paperwork
  bag.box(24, 0.8, 8, dark, 0, 4.8, 19);
  for (const [x, z] of [[-11, 16], [11, 16], [-11, 22], [11, 22]]) bag.box(1, 4.4, 1, wood, x, 2.2, z);
  bag.box(4.4, 1.4, 3.2, 0xc9a66b, 8, 5.9, 18);
  bag.box(4.2, 0.5, 3, 0xe9e1cb, 8, 6.8, 18);
  bag.lathe([[0.75, 0], [0.9, 1.5]], 0x7a2e2e, -8, 5.2, 18, 12);
  bag.build(room);
  room.position.set(0, ROOM.y, ROOM.z);
  room.visible = false;
  return room;
}

// ---------------------------------------------------------------- put together
export function buildUniversity(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const g = new THREE.Group();                    // faces -z, along the heading
  g.rotation.y = -(rec.heading ?? 0) * DEG;
  g.scale.setScalar(SCALE);
  site.add(g);

  const body = new THREE.Group();                 // deck, campus and office: bobs as it walks
  g.add(body);
  const top = buildCampus(body), office = buildOffice();
  body.add(office);

  const thighGeo = baked(unitTube(54, 42), 0xd6622d), shinGeo = baked(unitTube(44, 20), 0xe8b24a);
  const thighEdges = new THREE.EdgesGeometry(thighGeo, 30), shinEdges = new THREE.EdgesGeometry(shinGeo, 30);
  const jointGeo = baked(new THREE.SphereGeometry(62, 10, 8), 0x222a55);
  const footGeo = baked(new THREE.LatheGeometry([[120, 0], [100, 34], [42, 64], [0.01, 64]].map(([r, h]) => new THREE.Vector2(r, h)), 10), 0x222a55);
  const legs = LEGS.map(([x, z, fx, fz, lean, phase]) => ({ ...buildLeg(g, thighGeo, shinGeo, thighEdges, shinEdges, jointGeo, footGeo), x, z, fx, fz, phase, kneeDir: new THREE.Vector3(lean ? 0 : Math.sign(x) * 0.15, 1, lean) }));

  const flats = buildFlats();
  flats.group.visible = false;
  g.add(flats.group);

  // an invisible shape for clicking on the whole campus
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(1000, 500, 1500, 16));
  hit.position.y = 900;
  hit.visible = false;
  g.add(hit);

  // ---- the walk
  let phase = 0, walk = 0, target = 0, stand = 0, standTarget = 0, onFlats = false, travelled = 0;
  const hip = new THREE.Vector3(), foot = new THREE.Vector3(), knee = new THREE.Vector3(), dir = new THREE.Vector3(), bend = new THREE.Vector3();
  function poseLegs() {
    const bob = Math.sin(phase * Math.PI * 4) * 12 * walk, sway = Math.sin(phase * Math.PI * 2) * 0.012 * walk;
    body.position.y = bob - CROUCH * (1 - stand);
    body.rotation.z = sway;
    body.rotation.x = Math.cos(phase * Math.PI * 2) * 0.006 * walk;
    for (const leg of legs) {
      const p = (phase + leg.phase) % 1, stride = STRIDE * walk;
      let dz, lift = 0;
      if (p < DUTY) dz = -stride / 2 + stride * (p / DUTY); // down on the ground, sliding back under the body
      else { const s = (p - DUTY) / (1 - DUTY); dz = stride / 2 - stride * s; lift = Math.sin(s * Math.PI) * 170 * walk; }
      foot.set(leg.fx, lift, leg.fz + dz);
      hip.set(leg.x, HIP_Y + body.position.y, leg.z);
      // two-bone leg with the knee standing high and out, like a crane fly's
      dir.subVectors(foot, hip);
      const dist = Math.min(dir.length(), THIGH + SHIN - 1);
      dir.normalize();
      const along = (THIGH * THIGH - SHIN * SHIN + dist * dist) / (2 * dist), out = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
      bend.copy(leg.kneeDir).addScaledVector(dir, -dir.dot(leg.kneeDir)).normalize();
      knee.copy(hip).addScaledVector(dir, along).addScaledVector(bend, out);
      placeBone(leg.thigh, hip, knee);
      placeBone(leg.shin, knee, _b.copy(foot));
      leg.knee.position.copy(knee);
      leg.foot.position.copy(foot);
    }
  }
  poseLegs();
  site.updateMatrixWorld(true);

  site.userData.update = (dt) => {
    walk += Math.sign(target - walk) * Math.min(Math.abs(target - walk), dt / 2.5);
    stand += Math.sign(standTarget - stand) * Math.min(Math.abs(standTarget - stand), dt / 2.4);
    if (walk <= 0 && stand === standTarget) return;
    phase = (phase + (dt / CYCLE) * (walk > 0 ? 1 : 0)) % 1;
    const dz = SPEED * walk * dt;
    if (onFlats) flats.walk(dz);
    else { travelled += dz; g.position.set(Math.sin(g.rotation.y) * -travelled, 0, Math.cos(g.rotation.y) * -travelled).multiplyScalar(SCALE); }
    poseLegs();
  };
  site.userData.labelPos = new THREE.Vector3(0, 1300, 0);
  site.userData.labelRange = 9000;

  const toWorld = (v) => v.clone().applyMatrix4(body.matrixWorld);
  const seat = new THREE.Vector3(0, ROOM.y + 13, ROOM.z + 27), gaze = new THREE.Vector3(0, ROOM.y + 7, ROOM.z);
  site.userData.university = {
    site,
    hit,
    url: rec.url,
    center: site.position.clone(),
    start() { target = 1; standTarget = 1; },
    stop() { target = 0; standTarget = 0; walk = 0; stand = 0; phase = 0; travelled = 0; g.position.set(0, 0, 0); poseLegs(); site.updateMatrixWorld(true); },
    setScene(on) { flats.group.visible = on; onFlats = on; if (on) { travelled = 0; g.position.set(0, 0, 0); } site.updateMatrixWorld(true); },
    setOffice(on) { office.visible = on; top.visible = !on; },
    seat() { body.updateWorldMatrix(true, false); return { pos: toWorld(seat), look: toWorld(gaze) }; },
    towerTop: () => toWorld(new THREE.Vector3(0, WINDOW_Y, 0)),
    // the world up here, and the visitor's flight path in through the lit window
    up: up.clone(),
    path(from) {
      const inv = new THREE.Matrix4().copy(body.matrixWorld).invert(), start = from.clone().applyMatrix4(inv);
      const pts = [start, new THREE.Vector3(start.x * 0.7 - 500, 760, start.z * 0.4 - 500), new THREE.Vector3(-1500, 1300, -1100), new THREE.Vector3(-300, 1700, -2100), new THREE.Vector3(0, WINDOW_Y + 60, -900), new THREE.Vector3(0, WINDOW_Y, WINDOW_Z)];
      return new THREE.CatmullRomCurve3(pts);
    },
    localToWorld: toWorld,
    windowPoint: new THREE.Vector3(0, WINDOW_Y, WINDOW_Z),
    // a good place to stand to see it all
    view() {
      const pos = new THREE.Vector3(-2300, 260, 3000).applyMatrix4(g.matrixWorld), look = new THREE.Vector3(0, 900, 0).applyMatrix4(g.matrixWorld).sub(pos).normalize();
      return { pos, look };
    },
  };
  return site;
}
