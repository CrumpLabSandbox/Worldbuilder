// Meshes that accompany terrain features: volcano lava and smoke, roads with
// tunnels, and instanced woodland.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, tangentFrame, latLonToDir } from './planet.js';
import { mulberry32 } from './noise.js';

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Group sitting on the surface at `dir`, local +Y up, +Z north... returns helpers
function anchoredGroup(dir, alt) {
  const group = new THREE.Group();
  group.position.copy(dir).multiplyScalar(R + alt);
  const { east, north, up } = tangentFrame(dir);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const invQ = group.quaternion.clone().invert();
  return { group, toLocal, invQ };
}

// Collects transformed copies of unit primitives, merged per material at the end.
class PartBin {
  constructor(toLocal) { this.toLocal = toLocal; this.parts = new Map(); this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); }
  put(key, geo, centre, right, up, fwd, sx, sy, sz) {
    this.m4.makeBasis(right, up, fwd);
    this.q.setFromRotationMatrix(this.m4);
    this.s.set(sx, sy, sz);
    this.m4.compose(centre, this.q, this.s).premultiply(this.toLocal);
    this.add(key, geo.clone().applyMatrix4(this.m4));
  }
  add(key, geo) { if (!this.parts.has(key)) this.parts.set(key, []); this.parts.get(key).push(geo); }
  build(group, mats) {
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mats[key]);
      mesh.name = key;
      group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------- volcano
export function buildVolcano(rec, planet, feature) {
  const floor = planet.elevation(feature.center);
  const { group } = anchoredGroup(feature.center, floor);
  const rc = feature.rc;
  // lava lake
  const lavaMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff3a00, emissiveIntensity: 2.2, roughness: 0.6 });
  const lava = new THREE.Mesh(new THREE.CircleGeometry(rc * 0.62, 48), lavaMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = 4;
  group.add(lava);
  const crustMat = new THREE.MeshStandardMaterial({ color: 0x2a1410, roughness: 1, flatShading: true });
  const rng = mulberry32(hashString(rec.id || 'volcano'));
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, r = rng() * rc * 0.45;
    const c = new THREE.Mesh(new THREE.CircleGeometry(2 + rng() * 5, 6), crustMat);
    c.rotation.x = -Math.PI / 2; c.rotation.z = rng() * 6;
    c.position.set(Math.cos(a) * r, 4.1, Math.sin(a) * r);
    group.add(c);
  }
  const glow = new THREE.PointLight(0xff7a30, 6000, 0, 2);
  glow.position.y = 25;
  group.add(glow);
  // smoke plume
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const puffs = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshStandardMaterial({ color: 0x6f6b68, transparent: true, opacity: 0.5, depthWrite: false, roughness: 1, flatShading: true }));
    m.userData.phase = i / 16;
    m.userData.jitter = [rng() - 0.5, rng() - 0.5];
    group.add(m);
    puffs.push(m);
  }
  let clock = 0;
  group.userData.update = (dt) => {
    clock += dt;
    lavaMat.emissiveIntensity = 2.0 + Math.sin(clock * 2.3) * 0.35 + Math.sin(clock * 5.1) * 0.15;
    glow.intensity = 6000 * (0.85 + 0.15 * Math.sin(clock * 3.1));
    for (const p of puffs) {
      p.userData.phase = (p.userData.phase + dt * 0.025) % 1;
      const t = p.userData.phase, [jx, jz] = p.userData.jitter;
      p.position.set(jx * 30 + t * 90, feature.cd + 10 + t * 300, jz * 30 + t * 30);
      p.scale.setScalar(14 + t * 70);
      p.material.opacity = 0.5 * (1 - t) * Math.min(1, t * 8);
    }
  };
  group.userData.update(0);
  group.userData.labelPos = new THREE.Vector3(0, feature.cd + 45, 0);
  group.userData.labelRange = 6000;
  return group;
}

// ---------------------------------------------------------------- road + tunnels
export function buildRoad(rec, planet, feature) {
  const f = feature;
  const mid = f.dirAt(f.L / 2);
  const { group, toLocal } = anchoredGroup(mid, 0);
  const bin = new PartBin(toLocal);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const frame = (t) => {
    const up = f.dirAt(t);
    const fwd = new THREE.Vector3().crossVectors(f.axis, up).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    return { up, fwd, right, base: up.clone().multiplyScalar(R + f.roadAt(t)) };
  };
  // road deck, lane markings
  const seg = 8;
  const nSeg = Math.max(1, Math.ceil(f.L / seg));
  const sl = f.L / nSeg;
  for (let i = 0; i < nSeg; i++) {
    const t0 = i * sl, t1 = (i + 1) * sl;
    const p0 = frame(t0).base, p1 = frame(t1).base;
    const fwd = p1.clone().sub(p0); const len = fwd.length(); fwd.normalize();
    const up = f.dirAt((t0 + t1) / 2); up.addScaledVector(fwd, -up.dot(fwd)).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const c = p0.clone().add(p1).multiplyScalar(0.5);
    bin.put('asphalt', box, c.clone().addScaledVector(up, 0.1), right, up, fwd, f.width, 0.5, len * 1.02);
    for (const side of [-1, 1]) bin.put('white', box, c.clone().addScaledVector(up, 0.36).addScaledVector(right, side * (f.width / 2 - 0.45)), right, up, fwd, 0.22, 0.04, len * 1.02);
    if (i % 2 === 0) bin.put('yellow', box, c.clone().addScaledVector(up, 0.36), right, up, fwd, 0.25, 0.04, len * 0.55);
  }
  // tunnels: arched shell, ceiling lights, portal facades
  const hw = f.th * 0.5;
  const prof = [[-f.tw / 2, -0.4], [-f.tw / 2, hw]];
  for (let k = 1; k < 12; k++) { const a = Math.PI - (k / 12) * Math.PI; prof.push([Math.cos(a) * f.tw / 2, hw + Math.sin(a) * (f.th - hw)]); }
  prof.push([f.tw / 2, hw], [f.tw / 2, -0.4]);
  const archShape = (inset) => {
    const s = new THREE.Path();
    s.moveTo(-f.tw / 2 + inset, -0.6);
    s.lineTo(-f.tw / 2 + inset, hw);
    s.absellipse(0, hw, f.tw / 2 - inset, f.th - hw - inset, Math.PI, 0, true);
    s.lineTo(f.tw / 2 - inset, -0.6);
    s.lineTo(-f.tw / 2 + inset, -0.6);
    return s;
  };
  for (const tn of f.tunnels) {
    const tA = tn.t0 - 1.5, tB = tn.t1 + 1.5;
    const rings = Math.max(2, Math.ceil((tB - tA) / 6));
    const P = prof.length;
    const verts = new Float32Array((rings + 1) * P * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i <= rings; i++) {
      const t = tA + ((tB - tA) * i) / rings;
      const fr = frame(t);
      for (let j = 0; j < P; j++) {
        v.copy(fr.base).addScaledVector(fr.right, prof[j][0]).addScaledVector(fr.up, prof[j][1]).applyMatrix4(toLocal);
        verts.set([v.x, v.y, v.z], (i * P + j) * 3);
      }
    }
    const idx = [];
    for (let i = 0; i < rings; i++) for (let j = 0; j < P - 1; j++) {
      const a = i * P + j, b = a + 1, c = a + P, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    shell.setIndex(idx);
    shell.computeVertexNormals();
    bin.add('shell', shell);
    // lights along the crown, and a curb walkway on each side
    for (let t = tn.t0 + 6; t < tn.t1 - 3; t += 16) {
      const fr = frame(t);
      bin.put('light', box, fr.base.clone().addScaledVector(fr.up, f.th - 0.35), fr.right, fr.up, fr.fwd, 0.9, 0.2, 3.2);
      for (const side of [-1, 1]) bin.put('light', box, fr.base.clone().addScaledVector(fr.up, hw - 0.5).addScaledVector(fr.right, side * (f.tw / 2 - 0.15)), fr.right, fr.up, fr.fwd, 0.15, 0.25, 1.2);
    }
    for (let t = tn.t0 - 1.5; t < tn.t1 + 1.5; t += 6) {
      // follow the road's slope: orient each curb along the chord between its ends
      const p0 = frame(t).base, p1 = frame(t + 6).base;
      const fwd = p1.clone().sub(p0); const len = fwd.length(); fwd.normalize();
      const up = f.dirAt(t + 3); up.addScaledVector(fwd, -up.dot(fwd)).normalize();
      const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
      const c = p0.clone().add(p1).multiplyScalar(0.5);
      for (const side of [-1, 1]) bin.put('curb', box, c.clone().addScaledVector(up, 0.35).addScaledVector(right, side * (f.tw / 2 - 1)), right, up, fwd, 1.9, 0.7, len * 1.02);
    }
    // portal facades (stone frame with an arched opening)
    const outer = new THREE.Shape();
    const W = f.tw / 2 + 8, Ht = f.th + 8;
    outer.moveTo(-W, -2); outer.lineTo(W, -2); outer.lineTo(W, Ht); outer.lineTo(-W, Ht); outer.lineTo(-W, -2);
    outer.holes.push(archShape(0));
    const facadeGeo = new THREE.ExtrudeGeometry(outer, { depth: 3.5, bevelEnabled: false, curveSegments: 16 });
    // trim ring: outer arch out, inner arch back, as one polygon
    const outerArc = new THREE.Path(); outerArc.moveTo(-f.tw / 2 - 1.6, -0.6); outerArc.lineTo(-f.tw / 2 - 1.6, hw);
    outerArc.absellipse(0, hw, f.tw / 2 + 1.6, f.th - hw + 1.6, Math.PI, 0, true); outerArc.lineTo(f.tw / 2 + 1.6, -0.6);
    const innerPts = archShape(0).getPoints(16).filter((p) => p.y > -0.55).reverse();
    const ringShape = new THREE.Shape([...outerArc.getPoints(16), new THREE.Vector2(f.tw / 2, -0.6), ...innerPts, new THREE.Vector2(-f.tw / 2, -0.6)]);
    const ringGeo = new THREE.ExtrudeGeometry(ringShape, { depth: 4.2, bevelEnabled: false, curveSegments: 16 });
    for (const [t, outward] of [[tn.t0 + 1, -1], [tn.t1 - 1, 1]]) {
      const fr = frame(t);
      const z = fr.fwd.clone().multiplyScalar(outward);
      const x = new THREE.Vector3().crossVectors(fr.up, z).normalize();
      const m = new THREE.Matrix4().makeBasis(x, fr.up, z).setPosition(fr.base).premultiply(toLocal);
      bin.add('stone', facadeGeo.clone().applyMatrix4(m));
      bin.add('trim', ringGeo.clone().applyMatrix4(m));
    }
    facadeGeo.dispose(); ringGeo.dispose();
  }
  bin.build(group, {
    asphalt: new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.95 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.8 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.8 }),
    shell: new THREE.MeshStandardMaterial({ color: 0x8c8780, roughness: 0.95, side: THREE.DoubleSide }),
    curb: new THREE.MeshStandardMaterial({ color: 0x9a958d, roughness: 0.9 }),
    light: new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe2a0, emissiveIntensity: 2.0 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xb3aa9a, emissive: 0x2a2620, roughness: 0.95, flatShading: true }),
    trim: new THREE.MeshStandardMaterial({ color: 0xd2c8b4, emissive: 0x332e26, roughness: 0.9, flatShading: true }),
  });
  box.dispose();
  // label above the first tunnel's entrance, or the road's start
  const lt = f.tunnels.length ? f.tunnels[0].t0 : 0;
  const fr = frame(lt);
  group.userData.labelPos = fr.base.clone().addScaledVector(fr.up, f.th + 14).applyMatrix4(toLocal);
  group.userData.labelRange = 2500;
  return group;
}

// ---------------------------------------------------------------- alien flora
// Vivid colours; glowing parts emit their own instance colour.
const ALIEN_PALETTE = [
  [1.0, 0.18, 0.75], [0.1, 0.95, 1.0], [0.62, 1.0, 0.15], [0.62, 0.25, 1.0],
  [1.0, 0.52, 0.08], [1.0, 0.3, 0.45], [1.0, 0.92, 0.2], [0.1, 0.85, 0.6],
];
function glowMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor * 0.55;\n#endif');
  };
  return m;
}
const unit = (fn) => { let g = null; return () => (g || (g = fn())); };
const helixCurve = (turns, r0, r1) => new (class extends THREE.Curve {
  getPoint(t, out = new THREE.Vector3()) { const a = t * turns * Math.PI * 2, r = r0 + (r1 - r0) * t; return out.set(Math.cos(a) * r, t, Math.sin(a) * r); }
})();
const ALIEN_SPECIES = [
  { name: 'shroom', min: 7, max: 20, parts: unit(() => [
    { geo: new THREE.CylinderGeometry(0.05, 0.09, 0.62, 8).translate(0, 0.31, 0), tint: 'pale' },
    { geo: new THREE.SphereGeometry(0.36, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.6, 0), glow: true },
    { geo: new THREE.CylinderGeometry(0.33, 0.33, 0.03, 14).translate(0, 0.6, 0), tint: 'second', glow: true },
  ]) },
  { name: 'crystal', min: 8, max: 28, parts: unit(() => {
    const shards = [];
    const spec = [[0, 0, 0, 1], [0.12, 0, 0.5, 0.62], [-0.1, 0.05, -0.6, 0.55], [0.05, -0.12, 2.2, 0.48], [-0.06, 0.1, 1.2, 0.4]];
    for (const [x, zz, tilt, h] of spec) shards.push(new THREE.OctahedronGeometry(0.5, 0).scale(0.13, h, 0.13).translate(0, h * 0.5, 0).rotateX(x).rotateZ(zz).rotateY(tilt));
    return [{ geo: mergeGeometries(shards), glow: true }];
  }) },
  { name: 'tendril', min: 10, max: 26, parts: unit(() => [
    { geo: new THREE.TubeGeometry(helixCurve(2.5, 0.12, 0.03), 60, 0.035, 6), tint: 'second' },
    { geo: new THREE.SphereGeometry(0.11, 10, 8).translate(Math.cos(2.5 * Math.PI * 2) * 0.03, 1.02, Math.sin(2.5 * Math.PI * 2) * 0.03), glow: true },
  ]) },
  { name: 'orbs', min: 9, max: 24, parts: unit(() => [
    { geo: new THREE.CylinderGeometry(0.015, 0.04, 1, 6).translate(0, 0.5, 0), tint: 'dark' },
    { geo: mergeGeometries([
      new THREE.SphereGeometry(0.12, 12, 10).translate(0, 1.04, 0),
      new THREE.SphereGeometry(0.08, 10, 8).translate(0.12, 0.78, 0.02),
      new THREE.SphereGeometry(0.06, 10, 8).translate(-0.1, 0.62, -0.05),
    ]), glow: true },
  ]) },
  { name: 'pod', min: 6, max: 16, parts: unit(() => {
    const prof = [[0, 0], [0.28, 0.05], [0.4, 0.25], [0.36, 0.5], [0.18, 0.72], [0.1, 0.85], [0.16, 0.95], [0.12, 1.0], [0, 0.97]].map(([x, y]) => new THREE.Vector2(x, y));
    return [
      { geo: new THREE.LatheGeometry(prof, 12) },
      { geo: new THREE.TorusGeometry(0.385, 0.03, 6, 20).rotateX(Math.PI / 2).translate(0, 0.3, 0), glow: true, tint: 'second' },
    ];
  }) },
  { name: 'coral', min: 6, max: 18, parts: unit(() => {
    const arms = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, tilt = 0.25 + (i % 3) * 0.18, h = 0.7 + (i % 2) * 0.3;
      arms.push(new THREE.ConeGeometry(0.06, h, 6).translate(0, h / 2, 0).rotateZ(tilt).rotateY(a));
      arms.push(new THREE.SphereGeometry(0.07, 8, 6).translate(0, h, 0).rotateZ(tilt).rotateY(a));
    }
    return [{ geo: mergeGeometries(arms), glow: true }];
  }) },
];

// ---------------------------------------------------------------- woodland
export function buildWoodland(rec, planet, feature) {
  const center = feature.center;
  const { group, toLocal, invQ } = anchoredGroup(center, planet.elevation(center));
  const radius = feature.radius;
  const attempts = rec.count ?? Math.round(Math.PI * radius * radius / 180);
  const rng = mulberry32(hashString(rec.id || 'woods'));
  const { east, north } = tangentFrame(center);
  const noise = planet.noise2;
  const trees = { pine: [], broad: [], poplar: [] };
  const alien = Object.fromEntries(ALIEN_SPECIES.map((sp) => [sp.name, []]));
  const alienOrigin = rec.alien ? latLonToDir(rec.alien.lat, rec.alien.lon) : null;
  const dir = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i < attempts; i++) {
    const r = radius * Math.sqrt(rng()), th = rng() * Math.PI * 2;
    const a = r / R;
    dir.copy(center).multiplyScalar(Math.cos(a)).addScaledVector(tmp.copy(east).multiplyScalar(Math.cos(th)).addScaledVector(north, Math.sin(th)), Math.sin(a)).normalize();
    // clumps and clearings, thinning toward the edge
    const clump = noise.noise3(dir.x * 140 + 5, dir.y * 140, dir.z * 140);
    let p = THREE.MathUtils.smoothstep(clump, -0.45, 0.1) * (1 - THREE.MathUtils.smoothstep(r, radius * 0.75, radius));
    const elev = planet.elevation(dir);
    if (elev < 2.5) continue;
    if (planet.clearance(dir) < (rec.roadGap ?? 9)) continue;
    if (rec.alien && planet.insideOtherWoods(dir, rec.id)) continue;
    const vh = planet.volcanoHeightAt(dir);
    p *= 1 - THREE.MathUtils.smoothstep(vh, 25, 70);
    if (rng() > p) continue;
    const pos = dir.clone().multiplyScalar(R + elev - 0.4).applyMatrix4(toLocal);
    const up = dir.clone().applyQuaternion(invQ);
    // alien flora takes over with distance from the alien origin
    if (alienOrigin) {
      const d = dir.angleTo(alienOrigin) * R;
      const wAlien = THREE.MathUtils.smoothstep(d, rec.alien.start ?? 300, rec.alien.full ?? 1200);
      if (rng() < wAlien) {
        const patch = noise.noise3(dir.x * 60 + 3, dir.y * 60, dir.z * 60) * 0.5 + 0.5;
        const sp = ALIEN_SPECIES[Math.min(ALIEN_SPECIES.length - 1, Math.floor(((patch * 1.6 + rng() * 0.6) % 1) * ALIEN_SPECIES.length))];
        const hue = ALIEN_PALETTE[Math.floor(rng() * ALIEN_PALETTE.length)];
        const h = sp.min + rng() * (sp.max - sp.min) * (0.6 + 0.4 * wAlien);
        alien[sp.name].push({ pos, up, h, w: 0.8 + rng() * 0.4, yaw: rng() * Math.PI * 2, color: hue, color2: ALIEN_PALETTE[Math.floor(rng() * ALIEN_PALETTE.length)] });
        continue;
      }
    }
    const kindRoll = rng() + elev / 400;
    const kind = kindRoll > 0.62 ? 'pine' : kindRoll > 0.16 ? 'broad' : 'poplar';
    const h = kind === 'pine' ? 14 + rng() * 12 : kind === 'broad' ? 10 + rng() * 8 : 15 + rng() * 8;
    trees[kind].push({ pos, up, h, w: 0.85 + rng() * 0.3, yaw: rng() * Math.PI * 2, shade: rng() });
  }
  const unitUp = new THREE.Vector3(0, 1, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.035, 0.055, 0.42, 6).translate(0, 0.21, 0);
  const geos = {
    pine: mergeGeometries([
      new THREE.ConeGeometry(0.26, 0.55, 7).translate(0, 0.45, 0),
      new THREE.ConeGeometry(0.18, 0.42, 7).translate(0, 0.75, 0),
    ]),
    broad: new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.85, 1).translate(0, 0.62, 0),
    poplar: new THREE.SphereGeometry(1, 8, 6).scale(0.13, 0.4, 0.13).translate(0, 0.6, 0),
  };
  const palette = {
    pine: [[0.10, 0.27, 0.15], [0.14, 0.34, 0.19]],
    broad: [[0.20, 0.42, 0.14], [0.33, 0.55, 0.20]],
    poplar: [[0.26, 0.50, 0.18], [0.36, 0.58, 0.22]],
  };
  const all = [...trees.pine, ...trees.broad, ...trees.poplar];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), s = new THREE.Vector3();
  const setM = (t) => { q.setFromUnitVectors(unitUp, t.up); qy.setFromAxisAngle(unitUp, t.yaw); q.multiply(qy); s.set(t.h * t.w, t.h, t.h * t.w); m.compose(t.pos, q, s); };
  if (all.length) {
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3e26, roughness: 1, flatShading: true }), all.length);
    all.forEach((t, i) => { setM(t); trunks.setMatrixAt(i, m); });
    trunks.computeBoundingSphere();
    group.add(trunks);
  }
  const col = new THREE.Color();
  for (const kind of Object.keys(trees)) {
    const list = trees[kind];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geos[kind], new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), list.length);
    const [c0, c1] = palette[kind];
    list.forEach((t, i) => {
      setM(t); mesh.setMatrixAt(i, m);
      col.setRGB(c0[0] + (c1[0] - c0[0]) * t.shade, c0[1] + (c1[1] - c0[1]) * t.shade, c0[2] + (c1[2] - c0[2]) * t.shade);
      mesh.setColorAt(i, col);
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  let alienCount = 0;
  for (const sp of ALIEN_SPECIES) {
    const list = alien[sp.name];
    if (!list.length) continue;
    alienCount += list.length;
    for (const part of sp.parts()) {
      const mesh = new THREE.InstancedMesh(part.geo, part.glow ? glowMaterial() : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, flatShading: true }), list.length);
      list.forEach((t, i) => {
        setM(t); mesh.setMatrixAt(i, m);
        const base = part.tint === 'second' ? t.color2 : t.color;
        col.setRGB(base[0], base[1], base[2]);
        if (part.tint === 'pale') col.lerp(new THREE.Color(0.92, 0.9, 1), 0.65);
        if (part.tint === 'dark') col.multiplyScalar(0.35);
        mesh.setColorAt(i, col);
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  group.userData.alienCount = alienCount;
  group.userData.treeCount = all.length;
  group.userData.labelPos = new THREE.Vector3(0, 40, 0);
  group.userData.labelRange = 3000;
  return group;
}
