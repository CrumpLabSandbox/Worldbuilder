// Terrain features: structures that reshape or recolour the planet itself.
//  - VolcanoFeature: adds a cone with a crater and radial gullies to the height field.
//  - RoadFeature: grades a corridor to a smooth road profile (cuttings and
//    embankments) and bores tunnels wherever the ground rises far above it.
//  - WoodsFeature: tints the ground under a woodland to forest floor.
// Planet.elevation() applies them in order; features only see those before them.
import * as THREE from 'three';
import { R, latLonToDir, tangentFrame } from './planet.js';

const clamp = THREE.MathUtils.clamp;
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function mix(out, c, t) { out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t; }

const BASALT = [0.20, 0.19, 0.19];
const ASH = [0.43, 0.40, 0.37];
const SCORIA = [0.42, 0.20, 0.12];
const CRATER = [0.16, 0.08, 0.05];
const FOREST_FLOOR = [0.14, 0.31, 0.12];
const FOREST_FLOOR2 = [0.22, 0.36, 0.14];

export class VolcanoFeature {
  constructor(rec, planet) {
    this.id = rec.id; this.rec = rec; this.kind = 'volcano';
    this.center = latLonToDir(rec.lat, rec.lon);
    this.Rb = rec.radius ?? 600;
    this.H = rec.height ?? 420;
    this.rc = rec.crater ?? 70;
    this.cd = rec.craterDepth ?? 60;
    this.cosBound = Math.cos(this.Rb / R);
    const { east, north } = tangentFrame(this.center);
    this.e = east.clone(); this.n = north.clone();
    this.noise = planet.noise2;
    this.rimH = this.H * Math.pow(1 - this.rc / this.Rb, 1.8);
    this.maxHeight = this.H + 30;
  }
  dist(dir) { return Math.acos(clamp(dir.dot(this.center), -1, 1)) * R; }
  // Height added above the underlying terrain.
  profile(dir) {
    const r = this.dist(dir);
    if (r >= this.Rb) return 0;
    if (r < this.rc) { const u = r / this.rc; return this.rimH - this.cd * (1 - u * u * u * u); }
    const s = 1 - r / this.Rb;
    let p = this.H * Math.pow(s, 1.8);
    const th = Math.atan2(dir.dot(this.e), dir.dot(this.n));
    const g = this.noise.noise3(Math.cos(th) * 7 + 11, Math.sin(th) * 7, r * 0.006);
    p += (0.35 - Math.abs(g)) * 26 * Math.sin(Math.PI * Math.min(1, s * 1.15));
    return Math.max(0, p);
  }
  elev(dir, h) { return h + this.profile(dir); }
  color(dir, h, out) {
    const r = this.dist(dir);
    if (r >= this.Rb) return;
    const s = 1 - r / this.Rb;
    const w = smooth(0.12, 0.42, s);
    if (w <= 0) return;
    const n = this.noise.noise3(dir.x * 900, dir.y * 900, dir.z * 900);
    const c = [BASALT[0], BASALT[1], BASALT[2]];
    mix(c, ASH, smooth(-0.2, 0.6, n) * smooth(0.25, 0.7, s));
    mix(c, SCORIA, smooth(this.rc * 1.35, this.rc * 0.95, r));
    mix(c, CRATER, smooth(this.rc * 0.95, this.rc * 0.6, r));
    mix(out, c, w);
  }
}

export class RoadFeature {
  constructor(rec, planet) {
    this.id = rec.id; this.rec = rec; this.kind = 'road';
    this.width = rec.width ?? 9;
    this.tw = rec.tunnelWidth ?? this.width + 4;
    this.th = rec.tunnelHeight ?? 9;
    this.bank = rec.bank ?? 12;
    this.grade = rec.grade ?? 0.08;
    this.a = latLonToDir(rec.lat, rec.lon);
    this.b = latLonToDir(rec.lat2, rec.lon2);
    this.axis = new THREE.Vector3().crossVectors(this.a, this.b).normalize();
    this.fwd0 = new THREE.Vector3().crossVectors(this.axis, this.a).normalize();
    this.L = this.a.angleTo(this.b) * R;
    this.center = this.a.clone().add(this.b).normalize();
    this.cosBound = Math.cos(this.L / 2 / R + (this.bank + this.tw + 10) / R);
    this.maxHeight = 0;
    // sample the route
    const n = Math.max(2, Math.ceil(this.L / 4));
    this.n = n; this.ds = this.L / n;
    const base = new Float32Array(n + 1), full = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const d = this.dirAt(i * this.ds);
      base[i] = Math.max(0.5, planet.elevation(d, Infinity, 0)); // terrain without features
      full[i] = planet.elevation(d);                                // with earlier features
    }
    // smooth (moving average ±40 m) then limit the grade both ways
    const win = Math.max(1, Math.round(40 / this.ds));
    const road = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      let sum = 0, cnt = 0;
      for (let k = Math.max(0, i - win); k <= Math.min(n, i + win); k++) { sum += base[k]; cnt++; }
      road[i] = sum / cnt;
    }
    const g = this.grade * this.ds;
    for (let i = 1; i <= n; i++) road[i] = clamp(road[i], road[i - 1] - g, road[i - 1] + g);
    for (let i = n - 1; i >= 0; i--) road[i] = clamp(road[i], road[i + 1] - g, road[i + 1] + g);
    this.road = road;
    // tunnels wherever the ground stands well above the road
    const need = this.th + 3;
    const tunnels = [];
    let start = -1;
    for (let i = 0; i <= n + 1; i++) {
      const deep = i <= n && full[i] - road[i] > need;
      if (deep && start < 0) start = i;
      if (!deep && start >= 0) { tunnels.push([start, i - 1]); start = -1; }
    }
    const merged = [];
    for (const t of tunnels) {
      const last = merged[merged.length - 1];
      if (last && t[0] - last[1] < 6) last[1] = t[1]; else merged.push([...t]);
    }
    this.tunnels = merged.filter(([s, e]) => (e - s) * this.ds > 30).map(([s, e]) => ({ t0: s * this.ds, t1: e * this.ds }));
  }
  dirAt(t) { return this.a.clone().applyAxisAngle(this.axis, t / R); }
  roadAt(t) {
    const f = clamp(t / this.ds, 0, this.n);
    const i = Math.min(this.n - 1, Math.floor(f));
    return this.road[i] + (this.road[i + 1] - this.road[i]) * (f - i);
  }
  // lateral offset x and along-track distance t (metres)
  local(dir) {
    return { x: Math.asin(clamp(dir.dot(this.axis), -1, 1)) * R, t: Math.atan2(dir.dot(this.fwd0), dir.dot(this.a)) * R };
  }
  tunnelAt(t, margin = 0) {
    for (const tn of this.tunnels) if (t >= tn.t0 - margin && t <= tn.t1 + margin) return tn;
    return null;
  }
  elev(dir, h) {
    const { x, t } = this.local(dir);
    const ax = Math.abs(x);
    if (ax > this.width / 2 + 1 + this.bank || t < -this.bank || t > this.L + this.bank) return h;
    if (this.tunnelAt(t)) return h; // the mountain stays above a tunnel
    const k = (1 - smooth(this.width / 2 + 1, this.width / 2 + 1 + this.bank, ax)) * smooth(-this.bank, 0, t) * smooth(this.L + this.bank, this.L, t);
    return h + (this.roadAt(t) - 0.05 - h) * k;
  }
  // terrain triangles to drop so tunnel mouths are open
  hole(dir, elev) {
    if (!this.tunnels.length) return false;
    const { x, t } = this.local(dir);
    if (Math.abs(x) > this.tw / 2 + 0.4) return false;
    if (!this.tunnelAt(t, 1)) return false;
    return elev < this.roadAt(t) + this.th + 0.4;
  }
  // distance from the road's centre line, or Infinity beyond its ends
  clearance(dir) {
    const { x, t } = this.local(dir);
    if (t < -5 || t > this.L + 5) return Infinity;
    return Math.abs(x);
  }
  // keep a camera inside a tunnel; returns true when it is in one
  constrain(pos) {
    if (!this.tunnels.length) return false;
    const r = pos.length();
    const dir = pos.clone().divideScalar(r);
    const { x, t } = this.local(dir);
    const tn = this.tunnelAt(t, 1);
    if (!tn || Math.abs(x) > this.tw / 2 + 2) return false;
    const road = this.roadAt(t);
    const alt = r - R;
    if (alt > road + this.th + 1) return false;
    const newAlt = clamp(alt, road + 1.6, road + this.th - 1.2);
    let nx = x;
    if (t >= tn.t0 && t <= tn.t1) nx = clamp(x, -(this.tw / 2 - 1.2), this.tw / 2 - 1.2);
    if (nx !== x) {
      const perp = dir.clone().addScaledVector(this.axis, -dir.dot(this.axis)).normalize();
      dir.copy(perp).multiplyScalar(Math.cos(nx / R)).addScaledVector(this.axis, Math.sin(nx / R));
    }
    pos.copy(dir).multiplyScalar(R + newAlt);
    return true;
  }
  // road level under a position inside a tunnel, else null
  floorAt(pos) {
    if (!this.tunnels.length) return null;
    const r = pos.length();
    const { x, t } = this.local(pos.clone().divideScalar(r));
    if (!this.tunnelAt(t, 1) || Math.abs(x) > this.tw / 2 + 2) return null;
    const road = this.roadAt(t);
    return r - R < road + this.th + 1 ? road : null;
  }
  inTunnel(pos) {
    if (!this.tunnels.length) return false;
    const r = pos.length();
    const dir = pos.clone().divideScalar(r);
    const { x, t } = this.local(dir);
    const tn = this.tunnelAt(t);
    return !!tn && Math.abs(x) < this.tw / 2 && r - R < this.roadAt(t) + this.th;
  }
}

export class WoodsFeature {
  constructor(rec, planet) {
    this.id = rec.id; this.rec = rec; this.kind = 'woods';
    this.center = latLonToDir(rec.lat, rec.lon);
    this.radius = rec.radius ?? 400;
    this.cosBound = Math.cos(this.radius / R);
    this.noise = planet.noise2;
    this.maxHeight = 0;
  }
  color(dir, h, out) {
    if (h < 2) return;
    const r = Math.acos(clamp(dir.dot(this.center), -1, 1)) * R;
    const w = 0.85 * (1 - smooth(this.radius * 0.7, this.radius, r)) * smooth(2, 5, h);
    if (w <= 0) return;
    const c = [FOREST_FLOOR[0], FOREST_FLOOR[1], FOREST_FLOOR[2]];
    mix(c, FOREST_FLOOR2, 0.5 + 0.5 * this.noise.noise3(dir.x * 300, dir.y * 300, dir.z * 300));
    mix(out, c, w);
  }
}

export const FEATURE_TYPES = new Set(['volcano', 'road', 'woodland']);

// Build features from structure records. Volcanoes first, then roads (which
// tunnel through them), then woodland tints.
export function createFeatures(records, planet) {
  planet.setFeatures([]);
  const volcs = records.filter((r) => r.type === 'volcano').map((r) => new VolcanoFeature(r, planet));
  planet.setFeatures(volcs);
  const roads = [];
  for (const r of records.filter((x) => x.type === 'road' && x.lat2 != null)) {
    roads.push(new RoadFeature(r, planet));
    planet.setFeatures([...volcs, ...roads]);
  }
  const woods = records.filter((r) => r.type === 'woodland').map((r) => new WoodsFeature(r, planet));
  return [...volcs, ...roads, ...woods];
}
