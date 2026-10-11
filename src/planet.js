import * as THREE from 'three';
import { SimplexNoise, mulberry32 } from './noise.js';

export const R = 10000; // sea-level radius in world units (1 unit ≈ 1 m)
const DEG = Math.PI / 180;

// --- coordinate helpers -------------------------------------------------
// lon 0 → +Z, lon 90E → +X, lat 90N → +Y
export function latLonToDir(lat, lon, out = new THREE.Vector3()) {
  const la = lat * DEG, lo = lon * DEG;
  const c = Math.cos(la);
  return out.set(c * Math.sin(lo), Math.sin(la), c * Math.cos(lo));
}
export function dirToLatLon(v) {
  const len = v.length() || 1;
  const lat = Math.asin(THREE.MathUtils.clamp(v.y / len, -1, 1)) / DEG;
  let lon = Math.atan2(v.x, v.z) / DEG;
  return { lat, lon };
}
export function formatLat(lat) { return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`; }
export function formatLon(lon) { return `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`; }
export function wrapLon(lon) { return ((lon + 540) % 360) - 180; }

// Local tangent frame at a direction: east, north, up.
export function tangentFrame(dir, east = new THREE.Vector3(), north = new THREE.Vector3()) {
  const up = dir.clone().normalize();
  east.set(up.z, 0, -up.x);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  north.crossVectors(up, east).normalize();
  return { east, north, up };
}

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function mixColor(out, a, b, t) {
  out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t);
  return out;
}

const C = {
  deep: [0.03, 0.10, 0.26],
  shallow: [0.16, 0.45, 0.52],
  sand: [0.86, 0.80, 0.58],
  grass: [0.36, 0.60, 0.26],
  savanna: [0.68, 0.66, 0.34],
  desert: [0.84, 0.72, 0.44],
  forest: [0.16, 0.40, 0.18],
  tundra: [0.52, 0.56, 0.44],
  rock: [0.46, 0.42, 0.38],
  snow: [0.95, 0.96, 0.98],
};

export class Planet {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.noise = new SimplexNoise(this.seed);
    this.noise2 = new SimplexNoise((this.seed * 7919 + 13) >>> 0);
    const r = mulberry32(this.seed ^ 0x9e3779b9);
    this.off = [r() * 100, r() * 100, r() * 100];
    this.maxHeight = 320; // tallest mountain in units above sea level
    this.seaDepth = 160;
    this.features = [];
    this.featureMax = 0;
    this._cv = new THREE.Vector3();
  }

  // --- terrain features (volcanoes, roads, woodland tints) ---------------
  setFeatures(list) {
    this.features = list;
    this.featureMax = list.reduce((m, f) => Math.max(m, f.maxHeight || 0), 0);
  }
  maxElevation() { return this.maxHeight + this.featureMax; }
  featureById(id) { return this.features.find((f) => f.id === id); }
  // terrain triangle should be cut away (tunnel mouths)
  isHole(dir, elev) {
    for (const f of this.features) if (f.hole && dir.dot(f.center) > f.cosBound && f.hole(dir, elev)) return true;
    return false;
  }
  holeBounds() {
    return this.features.filter((f) => f.hole && f.tunnels && f.tunnels.length).map((f) => ({ center: f.center, ang: Math.acos(f.cosBound) }));
  }
  // keep a position inside any tunnel it is in; true if it was in one
  constrainTunnels(pos) {
    for (const f of this.features) if (f.constrain && f.constrain(pos)) return true;
    return false;
  }
  inTunnel(pos) { return this.features.some((f) => f.inTunnel && f.inTunnel(pos)); }
  tunnelFloor(pos) {
    for (const f of this.features) { const v = f.floorAt && f.floorAt(pos); if (v != null) return v; }
    return null;
  }
  volcanoHeightAt(dir) {
    let h = 0;
    for (const f of this.features) if (f.kind === 'volcano' && dir.dot(f.center) > f.cosBound) h += f.profile(dir);
    return h;
  }
  // distance to the nearest road or coaster footprint
  clearance(dir) {
    let c = Infinity;
    for (const f of this.features) if ((f.kind === 'road' || f.kind === 'coaster') && dir.dot(f.center) > f.cosBound) c = Math.min(c, f.clearance(dir));
    return c;
  }
  insideOtherWoods(dir, id) {
    return this.features.some((f) => f.kind === 'woods' && f.id !== id && f.contains(dir, 0.8));
  }
  roadClearance(dir) {
    let c = Infinity;
    for (const f of this.features) if (f.kind === 'road' && dir.dot(f.center) > f.cosBound) c = Math.min(c, f.clearance(dir));
    return c;
  }

  // Raw shape in roughly [-1, 1]; > 0 is land. maxFreq limits noise octaves
  // (in cycles per unit of the unit sphere) for level-of-detail meshes.
  _shape(x, y, z, maxFreq = Infinity) {
    const n = this.noise, o = this.off;
    const px = x + o[0], py = y + o[1], pz = z + o[2];
    const cont = n.fbm(px * 1.1, py * 1.1, pz * 1.1, 4, 2.0, 0.55, maxFreq / 1.1);
    const land = cont * 1.15 - 0.08;
    const detail = n.fbm(px * 4.5, py * 4.5, pz * 4.5, 6, 2.1, 0.5, maxFreq / 4.5);
    const ridge = n.ridged(px * 3.2, py * 3.2, pz * 3.2, 5, 2.0, 0.5, maxFreq / 3.2);
    const mountMask = smoothstep(0.02, 0.32, land) * smoothstep(-0.3, 0.5, this.noise2.noise3(px * 1.6, py * 1.6, pz * 1.6));
    let h = land + detail * 0.22 + (ridge - 0.45) * mountMask * 0.9;
    // fine surface detail (hills, bumps) only matters close up
    if (maxFreq > 60) {
      h += this.noise2.fbm(px * 60, py * 60, pz * 60, 4, 2.3, 0.45, maxFreq / 60) * 0.03 * (0.3 + 0.7 * smoothstep(0, 0.15, h));
    }
    return h;
  }

  // Elevation in units relative to sea level (negative = seabed depth),
  // including terrain features (only the first `upto` of them if given).
  elevation(dir, maxFreq = Infinity, upto) {
    let h = this._baseElevation(dir, maxFreq);
    const fs = this.features;
    const n = upto ?? fs.length;
    for (let i = 0; i < n; i++) {
      const f = fs[i];
      if (f.elev && dir.dot(f.center) > f.cosBound) h = f.elev(dir, h);
    }
    return h;
  }

  _baseElevation(dir, maxFreq = Infinity) {
    const h = this._shape(dir.x, dir.y, dir.z, maxFreq);
    if (h >= 0) {
      const t = Math.min(1, h / 0.9);
      return Math.pow(t, 1.35) * this.maxHeight;
    }
    const t = Math.min(1, -h / 0.8);
    return -Math.pow(t, 0.8) * this.seaDepth;
  }

  // Terrain radius (including seabed) and ground radius (max with sea).
  terrainRadius(dir) { return R + this.elevation(dir); }
  groundRadius(dir) { return R + Math.max(0, this.elevation(dir)); }

  // Moisture in [0,1] for biome variation.
  moisture(x, y, z) {
    const o = this.off;
    return 0.5 + 0.5 * this.noise2.fbm(x * 2.2 + o[1], y * 2.2 + o[2], z * 2.2 + o[0], 3, 2.0, 0.5);
  }

  color(x, y, z, h, out) {
    const lat = Math.asin(THREE.MathUtils.clamp(y, -1, 1)) / DEG;
    const latT = Math.abs(lat) / 90;
    const o = this.off;
    const jitter = this.noise2.noise3(x * 12 + o[2], y * 12, z * 12) * 0.08;
    const temp = 1 - Math.pow(latT, 2.2) - Math.max(0, h) / 420 + jitter; // ~1 warm, 0 freezing
    if (h <= 0) {
      const d = THREE.MathUtils.clamp(-h / this.seaDepth, 0, 1);
      return mixColor(out, C.shallow, C.deep, Math.pow(d, 0.6));
    }
    const m = this.moisture(x, y, z);
    const tmp = [0, 0, 0];
    if (h < 6) {
      mixColor(out, C.sand, C.grass, smoothstep(3, 6, h));
    } else if (h < 110) {
      // lowlands: dry → desert/savanna, wet → grass/forest
      const dry = mixColor([0, 0, 0], C.desert, C.savanna, smoothstep(0.15, 0.4, m));
      const wet = mixColor([0, 0, 0], C.grass, C.forest, smoothstep(0.5, 0.85, m + jitter));
      mixColor(out, dry, wet, smoothstep(0.3, 0.55, m));
      mixColor(out, out, mixColor(tmp, C.forest, C.rock, smoothstep(50, 110, h)), smoothstep(40, 110, h) * 0.8);
    } else if (h < 200) {
      mixColor(out, C.forest, C.rock, smoothstep(110, 180, h));
    } else {
      mixColor(out, C.rock, C.snow, smoothstep(200, 260, h));
    }
    // cold climates
    if (temp < 0.45) {
      mixColor(out, out, C.tundra, smoothstep(0.45, 0.3, temp) * 0.8);
    }
    if (temp < 0.25) {
      mixColor(out, out, C.snow, smoothstep(0.25, 0.1, temp));
    }
    if (this.features.length) {
      const v = this._cv.set(x, y, z);
      for (let i = this.features.length - 1; i >= 0; i--) {
        const f = this.features[i];
        if (f.color && v.dot(f.center) > f.cosBound) f.color(v, h, out);
      }
    }
    return out;
  }

  // --- geometry ---------------------------------------------------------
  buildOcean() {
    const geo = new THREE.SphereGeometry(R, 512, 256);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1d6fcf, transparent: true, opacity: 0.78, roughness: 0.25, metalness: 0.05,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ocean';
    mesh.renderOrder = 1;
    return mesh;
  }

  buildAtmosphere() {
    const geo = new THREE.SphereGeometry(R * 1.09, 96, 48);
    const mat = new THREE.ShaderMaterial({
      uniforms: { c: { value: 0.6 }, p: { value: 4.5 }, glowColor: { value: new THREE.Color(0x4fa8ff) } },
      vertexShader: `
        varying vec3 vNormal; varying vec3 vPos;
        void main() { vNormal = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vPos = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform float c; uniform float p; uniform vec3 glowColor;
        varying vec3 vNormal; varying vec3 vPos;
        void main() {
          vec3 viewDir = normalize(-vPos);
          float intensity = pow(max(0.0, c - dot(vNormal, viewDir)), p);
          gl_FragColor = vec4(glowColor, 1.0) * intensity;
        }`,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'atmosphere';
    return mesh;
  }

  buildClouds() {
    const w = 1024, h = 512;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const n = this.noise2;
    const o = this.off;
    for (let y = 0; y < h; y++) {
      const lat = (0.5 - y / h) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < w; x++) {
        const lon = (x / w) * Math.PI * 2;
        const px = cl * Math.sin(lon), py = sl, pz = cl * Math.cos(lon);
        let v = n.fbm(px * 7 + o[2] * 3, py * 7, pz * 7, 5, 2.3, 0.55);
        v = smoothstep(0.18, 0.62, v + 0.05);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(v * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.SphereGeometry(R * 1.045, 192, 96);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: tex, transparent: true, opacity: 0.85, depthWrite: false, roughness: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'clouds';
    mesh.renderOrder = 2;
    return mesh;
  }

  buildGrid() {
    const pts = [];
    const majorPts = [];
    const lift = 4;
    const d = new THREE.Vector3();
    const add = (arr, lat, lon) => {
      latLonToDir(lat, lon, d);
      const r = this.groundRadius(d) + lift;
      arr.push(d.x * r, d.y * r, d.z * r);
    };
    for (let lat = -75; lat <= 75; lat += 15) {
      const arr = lat === 0 ? majorPts : pts;
      for (let lon = -180; lon < 180; lon += 1) { add(arr, lat, lon); add(arr, lat, lon + 1); }
    }
    for (let lon = -180; lon < 180; lon += 15) {
      const arr = lon === 0 ? majorPts : pts;
      for (let lat = -90; lat < 90; lat += 1) { add(arr, lat, lon); add(arr, lat + 1, lon); }
    }
    const group = new THREE.Group();
    const mk = (arr, color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true }));
    };
    group.add(mk(pts, 0xffffff, 0.25));
    group.add(mk(majorPts, 0xffd166, 0.7));
    group.name = 'grid';
    return group;
  }
}
