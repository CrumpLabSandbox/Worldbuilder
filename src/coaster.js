// Roller coasters. A coaster record describes a one-way route in a local plan
// frame anchored at (lat, lon) facing `heading`: F metres forward, L metres to
// the right, h metres above the ground. Waypoints are [F, L, h]; elements
// ({loop}, {corkscrew}, {helix}) are expanded between the waypoints around them.
//
// CoasterFeature computes the track (a smooth spline that follows the planet's
// curvature, banks into turns and keeps clear of the ground); buildCoaster
// makes the track, supports, stations and a train you can ride.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, latLonToDir, tangentFrame } from './planet.js';

const G = 9.81;
const clamp = THREE.MathUtils.clamp;

export class CoasterFeature {
  constructor(rec, planet) {
    this.id = rec.id; this.rec = rec; this.kind = 'coaster';
    this.maxHeight = 0;
    const origin = latLonToDir(rec.lat, rec.lon);
    this.origin = origin;
    const { east, north } = tangentFrame(origin);
    const hd = (rec.heading || 0) * Math.PI / 180;
    this.Fdir = north.clone().multiplyScalar(Math.cos(hd)).addScaledVector(east, Math.sin(hd));
    this.Ldir = north.clone().multiplyScalar(-Math.sin(hd)).addScaledVector(east, Math.cos(hd));
    const ground = (f, l) => Math.max(0, planet.elevation(this.planDir(f, l)));

    // ---- expand the route into control points (plan coords + absolute height)
    const ctrl = []; // { f, l, z, up: [s, q, z] in element frame or null, d: [df, dl] }
    const path = rec.path;
    const wp = (e) => Array.isArray(e);
    const liftEnd = rec.liftEnd ?? -1;
    let liftCtrl = -1;
    for (let k = 0; k < path.length; k++) {
      const e = path[k];
      if (wp(e)) {
        ctrl.push({ f: e[0], l: e[1], z: ground(e[0], e[1]) + e[2], up: null });
        if (k === liftEnd) liftCtrl = ctrl.length - 1;
        continue;
      }
      // element: starts at the previous control point, heads toward the next waypoint
      const P = ctrl[ctrl.length - 1];
      const next = path.slice(k + 1).find(wp);
      let df = next[0] - P.f, dl = next[1] - P.l;
      const dn = Math.hypot(df, dl); df /= dn; dl /= dn;
      const rf = -dl, rl = df; // right of travel in the plan
      const pts = [];
      if (e.loop) {
        const r = e.loop / 2, w = e.offset ?? 4, n = 16;
        pts.push([12, 0, 0, null]);
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          pts.push([25 + r * Math.sin(a), w * (i / n), r * (1 - Math.cos(a)), [-Math.sin(a), 0, Math.cos(a)]]);
        }
        pts.push([40, w, 0, null]);
      } else if (e.corkscrew) {
        const len = e.corkscrew, rho = e.radius ?? 6, n = 14, side = e.side ?? 1;
        pts.push([8, 0, 0, null]);
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          pts.push([10 + len * (i / n), -side * rho * Math.sin(a), rho * (1 - Math.cos(a)), [0, side * Math.sin(a), Math.cos(a)]]);
        }
        pts.push([len + 18, 0, 0, null]);
      } else if (e.helix) {
        const rad = e.helix, turns = e.turns ?? 1, drop = e.drop ?? 15, side = e.side ?? 1, n = Math.ceil(turns * 12);
        // circle centred to the side of the entry point, entered tangentially
        for (let i = 1; i <= n; i++) {
          const a = (i / n) * turns * Math.PI * 2;
          pts.push([rad * Math.sin(a), side * rad * (1 - Math.cos(a)), -drop * (i / n), null]);
        }
      }
      for (const [s, q, z, up] of pts) {
        ctrl.push({ f: P.f + df * s + rf * q, l: P.l + dl * s + rl * q, z: P.z + z, up: up ? [df * up[0] + rf * up[1], dl * up[0] + rl * up[1], up[2]] : null });
      }
    }
    this.ctrlCount = ctrl.length;

    // ---- spline through the control points in world space
    const ctrlWorld = ctrl.map((c) => this.planDir(c.f, c.l).multiplyScalar(R + c.z));
    const curve = new THREE.CatmullRomCurve3(ctrlWorld, false, 'centripetal', 0.5);
    curve.arcLengthDivisions = ctrl.length * 40;
    const length = curve.getLength();
    const ds = 1.5;
    const N = Math.ceil(length / ds);
    const P = [], seg = [], frac = [];
    for (let i = 0; i <= N; i++) {
      const t = curve.getUtoTmapping(i / N);
      P.push(curve.getPoint(t));
      const p = (ctrl.length - 1) * t, ip = Math.min(ctrl.length - 2, Math.floor(p));
      seg.push(ip); frac.push(p - ip);
    }
    const explicit = (i) => ctrl[seg[i]].up || ctrl[seg[i] + 1].up;
    // keep plain track clear of the ground (raise and smooth, never lower)
    const z = P.map((p) => p.length() - R);
    const gnd = P.map((p) => Math.max(0, planet.elevation(p.clone().normalize())));
    // stations keep their designed height; open track keeps 3 m of clearance
    const stLen = rec.stationLength ?? 60;
    const totalApprox = curve.getLength();
    const minClear = (i) => { const s = (i / N) * totalApprox; return s < stLen + 15 || s > totalApprox - stLen - 15 ? 0.8 : 3; };
    let zz = z.map((v, i) => (explicit(i) ? v : Math.max(v, gnd[i] + minClear(i))));
    for (let it = 0; it < 4; it++) {
      const nz = zz.slice();
      for (let i = 0; i <= N; i++) {
        if (explicit(i)) continue;
        let s = 0, c = 0;
        for (let k = Math.max(0, i - 4); k <= Math.min(N, i + 4); k++) { s += zz[k]; c++; }
        nz[i] = minClear(i) < 1 ? zz[i] : Math.max(zz[i], s / c);
      }
      zz = nz;
    }
    for (let i = 0; i <= N; i++) P[i].setLength(R + zz[i]);
    // tangents
    const T = P.map((p, i) => P[Math.min(N, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize());
    // banking from horizontal curvature
    const heading = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const up = P[i].clone().normalize();
      const { east: e, north: n } = tangentFrame(up);
      heading[i] = Math.atan2(T[i].dot(e), T[i].dot(n));
    }
    const kap = new Float32Array(N + 1);
    for (let i = 1; i < N; i++) {
      let d = heading[i + 1] - heading[i - 1];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      kap[i] = d / (2 * ds);
    }
    const kapS = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - 8); k <= Math.min(N, i + 8); k++) { s += kap[k]; c++; }
      kapS[i] = s / c;
    }
    const U = [];
    for (let i = 0; i <= N; i++) {
      const radial = P[i].clone().normalize();
      const right = new THREE.Vector3().crossVectors(T[i], radial).normalize();
      const steep = Math.abs(T[i].dot(radial));
      const bank = clamp(Math.atan(30 * kapS[i]), -1.15, 1.15) * (1 - THREE.MathUtils.smoothstep(steep, 0.5, 0.85));
      const auto = radial.clone().multiplyScalar(Math.cos(bank)).addScaledVector(right, Math.sin(bank));
      const toWorld = (c) => {
        if (!c.up) return auto;
        const v = this.Fdir.clone().multiplyScalar(c.up[0]).addScaledVector(this.Ldir, c.up[1]);
        v.addScaledVector(radial, -v.dot(radial));
        return v.addScaledVector(radial, c.up[2]).normalize();
      };
      const a = toWorld(ctrl[seg[i]]), b = toWorld(ctrl[seg[i] + 1]);
      const u = a.clone().lerp(b, frac[i]);
      if (u.lengthSq() < 1e-6) u.copy(auto);
      u.addScaledVector(T[i], -u.dot(T[i])).normalize();
      U.push(u);
    }
    this.P = P; this.T = T; this.U = U; this.N = N; this.ds = ds; this.length = N * ds;
    this.z = zz;
    this.maxZ = Math.max(...zz);
    // the lift ends where the named waypoint is
    let liftS = 0;
    if (liftCtrl >= 0) { for (let i = 0; i <= N; i++) if (seg[i] >= liftCtrl) { liftS = i * ds; break; } }
    this.liftS = liftS;
    this.stationLen = rec.stationLength ?? 60;
    // ride speed: energy from the highest track nearby, so the train slows over crests
    const v = new Float32Array(N + 1);
    const win = Math.round(260 / ds);
    for (let i = 0; i <= N; i++) {
      let m = -Infinity;
      for (let k = Math.max(0, i - win); k <= Math.min(N, i + win); k += 3) m = Math.max(m, zz[k]);
      v[i] = clamp(Math.sqrt(Math.max(0, 2 * G * (m + 6 - zz[i]))), 9, 34);
    }
    const vs = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - 15); k <= Math.min(N, i + 15); k++) { s += v[k]; c++; }
      vs[i] = s / c;
    }
    this.speed = vs;
    // footprint grid (plan coords, 20 m cells) for keeping trees off the track
    this.cell = 20;
    this.grid = new Map();
    for (let i = 0; i <= N; i += 2) {
      const { f, l } = this.toPlan(P[i].clone().normalize());
      const key = `${Math.floor(f / this.cell)},${Math.floor(l / this.cell)}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push([f, l]);
    }
    this.center = this.planDir(0, 0);
    let maxD = 0;
    for (let i = 0; i <= N; i += 20) maxD = Math.max(maxD, P[i].clone().normalize().angleTo(origin));
    this.center = origin;
    this.cosBound = Math.cos(maxD + 60 / R);
  }

  planDir(f, l) {
    const d = Math.hypot(f, l);
    if (d < 1e-9) return this.origin.clone();
    const v = this.Fdir.clone().multiplyScalar(f / d).addScaledVector(this.Ldir, l / d);
    return this.origin.clone().multiplyScalar(Math.cos(d / R)).addScaledVector(v, Math.sin(d / R));
  }
  toPlan(dir) {
    const a = Math.acos(clamp(dir.dot(this.origin), -1, 1)) * R;
    const f = dir.dot(this.Fdir), l = dir.dot(this.Ldir);
    const n = Math.hypot(f, l) || 1;
    return { f: (f / n) * a, l: (l / n) * a };
  }
  // distance from the track's footprint (metres)
  clearance(dir) {
    const { f, l } = this.toPlan(dir);
    const cf = Math.floor(f / this.cell), cl = Math.floor(l / this.cell);
    let best = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = this.grid.get(`${cf + a},${cl + b}`);
      if (list) for (const [pf, pl] of list) best = Math.min(best, Math.hypot(pf - f, pl - l));
    }
    return best;
  }
  // frame at distance s along the track
  frameAt(s, out = {}) {
    const x = clamp(s / this.ds, 0, this.N - 1e-6);
    const i = Math.floor(x), t = x - i, j = Math.min(this.N, i + 1);
    out.pos = (out.pos || new THREE.Vector3()).copy(this.P[i]).lerp(this.P[j], t);
    out.tan = (out.tan || new THREE.Vector3()).copy(this.T[i]).lerp(this.T[j], t).normalize();
    out.up = (out.up || new THREE.Vector3()).copy(this.U[i]).lerp(this.U[j], t);
    out.up.addScaledVector(out.tan, -out.up.dot(out.tan)).normalize();
    out.right = (out.right || new THREE.Vector3()).crossVectors(out.tan, out.up).normalize();
    return out;
  }
  speedAt(s) { return this.speed[clamp(Math.round(s / this.ds), 0, this.N)]; }
}

// ---------------------------------------------------------------- meshes
function tubeAlong(f, i0, i1, step, offRight, offUp, radius, sides, toLocal, colorAt) {
  const rings = [];
  for (let i = i0; i <= i1; i += step) rings.push(Math.min(i, f.N));
  if (rings[rings.length - 1] !== Math.min(i1, f.N)) rings.push(Math.min(i1, f.N));
  const pos = new Float32Array(rings.length * sides * 3), col = new Float32Array(rings.length * sides * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  rings.forEach((i, r) => {
    const right = new THREE.Vector3().crossVectors(f.T[i], f.U[i]).normalize();
    const centre = f.P[i].clone().addScaledVector(right, offRight).addScaledVector(f.U[i], offUp);
    colorAt(i, c);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      v.copy(centre).addScaledVector(right, Math.cos(a) * radius).addScaledVector(f.U[i], Math.sin(a) * radius).applyMatrix4(toLocal);
      pos.set([v.x, v.y, v.z], (r * sides + k) * 3);
      col.set([c.r, c.g, c.b], (r * sides + k) * 3);
    }
  });
  const idx = [];
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < sides; k++) {
    const a = r * sides + k, b = r * sides + ((k + 1) % sides), cc = a + sides, d = b + sides;
    idx.push(a, b, cc, b, d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const CAR_COLORS = [0xff3b6b, 0xffc229, 0x29d3ff, 0x9b5cff, 0x4dff8a];

export function buildCoaster(rec, planet, f) {
  const group = new THREE.Group();
  group.position.copy(f.origin).multiplyScalar(R + Math.max(0, planet.elevation(f.origin)));
  const { east, north, up } = tangentFrame(f.origin);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const invQ = group.quaternion.clone().invert();

  // track colour drifts from crimson to violet to neon cyan as it heads out
  const stops = [new THREE.Color(rec.color || '#e0322c'), new THREE.Color('#9b3cff'), new THREE.Color('#19f0d8')];
  const colorAt = (i, c) => {
    const t = (i / f.N) * 2;
    const k = Math.min(1, Math.floor(t));
    return c.copy(stops[k]).lerp(stops[k + 1], t - k);
  };
  const parts = [];
  parts.push(tubeAlong(f, 0, f.N, 1, 0.62, 0, 0.2, 6, toLocal, colorAt));
  parts.push(tubeAlong(f, 0, f.N, 1, -0.62, 0, 0.2, 6, toLocal, colorAt));
  parts.push(tubeAlong(f, 0, f.N, 2, 0, -0.75, 0.38, 6, toLocal, (i, c) => colorAt(i, c).multiplyScalar(0.8)));
  const trackMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 });
  const trackGeo = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  group.add(new THREE.Mesh(trackGeo, trackMat));

  // cross-ties and supports, merged
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const ties = [], supports = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const place = (list, geo, centre, right, upv, fwd, sx, sy, sz) => {
    m4.makeBasis(right, upv, fwd); q.setFromRotationMatrix(m4); sc.set(sx, sy, sz);
    m4.compose(centre, q, sc).premultiply(toLocal);
    list.push(geo.clone().applyMatrix4(m4));
  };
  for (let i = 0; i <= f.N; i += 2) {
    const right = new THREE.Vector3().crossVectors(f.T[i], f.U[i]).normalize();
    place(ties, box, f.P[i].clone().addScaledVector(f.U[i], -0.3), right, f.U[i], f.T[i], 1.5, 0.18, 0.25);
    place(ties, box, f.P[i].clone().addScaledVector(f.U[i], -0.55), right, f.U[i], f.T[i], 0.2, 0.5, 0.2);
  }
  for (let i = 0; i <= f.N; i += 8) {
    const radial = f.P[i].clone().normalize();
    if (f.U[i].dot(radial) < 0.55) continue; // inverted or sideways: self-supporting
    const s = i * f.ds;
    if (s < f.stationLen + 4 || s > f.length - f.stationLen - 4) continue;
    const bottom = f.P[i].clone().addScaledVector(f.U[i], -1.1);
    const gnd = Math.max(0, planet.elevation(radial)) - 1;
    const h = bottom.length() - R - gnd;
    if (h < 1.5) continue;
    const tw = h > 25 ? 1.3 : 0.8;
    const fwd = f.T[i].clone().addScaledVector(radial, -f.T[i].dot(radial)).normalize();
    const side = new THREE.Vector3().crossVectors(fwd, radial).normalize();
    const mid = radial.clone().multiplyScalar(R + gnd + h / 2);
    place(supports, cyl, mid, side, radial, fwd, tw, h, tw);
    place(supports, box, radial.clone().multiplyScalar(R + gnd + 0.4), side, radial, fwd, tw * 2.6, 0.8, tw * 2.6);
  }
  const tieGeo = mergeGeometries(ties); ties.forEach((g) => g.dispose());
  group.add(new THREE.Mesh(tieGeo, new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.7 })));
  if (supports.length) {
    const supGeo = mergeGeometries(supports); supports.forEach((g) => g.dispose());
    group.add(new THREE.Mesh(supGeo, new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.6, metalness: 0.2 })));
  }

  // stations at both ends: platforms either side, roof on pillars
  const stationParts = { deck: [], roof: [], post: [] };
  const station = (s0, s1) => {
    for (let s = s0; s < s1; s += 6) {
      const fr = f.frameAt(s + 3);
      const radial = fr.pos.clone().normalize();
      const fwd = fr.tan.clone().addScaledVector(radial, -fr.tan.dot(radial)).normalize();
      const side = new THREE.Vector3().crossVectors(fwd, radial).normalize();
      for (const sd of [-1, 1]) {
        place(stationParts.deck, box, fr.pos.clone().addScaledVector(side, sd * 3.2).addScaledVector(radial, -0.5), side, radial, fwd, 3.6, 1.2, 6.05);
        if ((Math.round((s - s0) / 6)) % 2 === 0) place(stationParts.post, box, fr.pos.clone().addScaledVector(side, sd * 4.6).addScaledVector(radial, 3), side, radial, fwd, 0.4, 6, 0.4);
      }
      place(stationParts.roof, box, fr.pos.clone().addScaledVector(radial, 6.2), side, radial, fwd, 11, 0.5, 6.05);
    }
  };
  station(0, f.stationLen);
  station(f.length - f.stationLen, f.length);
  const stMats = {
    deck: new THREE.MeshStandardMaterial({ color: 0xb9b2a5, roughness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xff4f6d, roughness: 0.7 }),
    post: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  };
  for (const k of Object.keys(stationParts)) {
    const g = mergeGeometries(stationParts[k]); stationParts[k].forEach((x) => x.dispose());
    group.add(new THREE.Mesh(g, stMats[k]));
  }
  box.dispose(); cyl.dispose();

  // ---- train
  const cars = [];
  const carCount = rec.cars ?? 5, gap = 3.3;
  for (let c = 0; c < carCount; c++) {
    const car = new THREE.Group();
    const color = new THREE.Color(CAR_COLORS[c % CAR_COLORS.length]);
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.8 });
    const add = (geo, mat, x, y, zz, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, zz); m.scale.set(sx, sy, sz); car.add(m); };
    const B = new THREE.BoxGeometry(1, 1, 1);
    add(B, body, 0, 0.75, 0, 1.9, 0.7, 2.7);
    add(B, dark, 0, 1.2, -0.45, 1.6, 0.25, 0.9);
    add(B, body, 0, 1.45, -0.95, 1.7, 0.6, 0.25);
    add(B, dark, 0, 1.2, 0.75, 1.6, 0.25, 0.9);
    add(B, body, 0, 1.45, 0.25, 1.7, 0.6, 0.25);
    if (c === 0) add(new THREE.ConeGeometry(0.9, 1.4, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), body, 0, 0.75, 2.0, 1, 0.6, 1);
    for (const sx of [-0.7, 0.7]) for (const sz of [-0.9, 0.9]) add(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 8).rotateZ(Math.PI / 2), dark, sx, 0.25, sz, 1, 1, 1);
    group.add(car);
    cars.push(car);
  }
  const startS = f.stationLen * 0.75; // front car's stop in the start station
  const endS = f.length - f.stationLen * 0.3;
  const state = { mode: 'dwell', timer: 4, s: startS, v: 0 };
  const fr = {};
  const basis = new THREE.Matrix4();
  const placeCars = () => {
    cars.forEach((car, c) => {
      f.frameAt(state.s - c * gap, fr);
      car.position.copy(fr.pos).applyMatrix4(toLocal);
      const x = fr.right.clone().negate().applyQuaternion(invQ);
      const y = fr.up.clone().applyQuaternion(invQ), zz = fr.tan.clone().applyQuaternion(invQ);
      basis.makeBasis(x, y, zz);
      car.quaternion.setFromRotationMatrix(basis);
    });
  };
  const api = {
    feature: f,
    riding: false,
    onRideEnd: null,
    // put a rider in the front car and dispatch now
    // the rider sits in the front car, which is hidden so the view down the track is clear
    board() { api.riding = true; cars[0].visible = false; state.mode = 'dwell'; state.timer = 1.5; state.s = startS; },
    dismount() { api.riding = false; cars[0].visible = true; },
    stationPoint() { return f.frameAt(startS).pos.clone(); },
    endPoint() { return f.frameAt(endS).pos.clone(); },
    // rider's eye: position, look target, up (world space)
    eye(out) {
      f.frameAt(state.s + 0.3, fr);
      const ahead = f.frameAt(state.s + 6, {});
      out.pos.copy(fr.pos).addScaledVector(fr.up, 1.9).addScaledVector(fr.tan, 0.4);
      out.target.copy(ahead.pos).addScaledVector(ahead.up, 1.6);
      out.up.copy(fr.up);
      out.speed = state.v;
      return out;
    },
  };
  let clock = 0;
  group.userData.update = (dt) => {
    clock += dt;
    if (state.mode === 'dwell') {
      state.v = 0;
      state.timer -= dt;
      if (state.timer <= 0) state.mode = 'run';
    } else if (state.mode === 'run') {
      let v;
      if (state.s < f.stationLen) v = Math.min(6, (state.v || 0) + dt * 3);   // roll out of the station
      else if (state.s < f.liftS) v = 6;                                      // chain lift
      else v = f.speedAt(state.s);
      const toEnd = endS - state.s;
      if (toEnd < 160) v = Math.min(v, Math.max(1.5, toEnd * 0.12));          // brake run
      state.v += (v - state.v) * Math.min(1, dt * 3);
      state.s += state.v * dt;
      if (state.s >= endS) {
        state.s = endS; state.mode = 'end'; state.timer = 5;
        if (api.riding) { api.dismount(); if (api.onRideEnd) api.onRideEnd(api); }
      }
    } else if (state.mode === 'end') {
      state.v = 0;
      state.timer -= dt;
      if (state.timer <= 0) { state.mode = 'dwell'; state.timer = 6; state.s = startS; }
    }
    placeCars();
  };
  placeCars();
  group.userData.coaster = api;
  const lbl = f.frameAt(f.stationLen / 2);
  group.userData.labelPos = lbl.pos.clone().addScaledVector(lbl.up, 12).applyMatrix4(toLocal);
  group.userData.labelRange = 3500;
  return group;
}
