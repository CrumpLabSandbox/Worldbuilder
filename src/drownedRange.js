// The Drowned Range, the way in to Ecphory: in that game you cross a luminous Sea of
// the Present whose islands are the summits of a drowned mountain range, the past.
// Here the range stands in its own bowl, inked and sunlit, out of a sea of points of
// light like the game's mnemic substance. Inside the ring of peaks the sky is its own
// too. Going in is a short film: out of the bowl, down to someone walking the causeway,
// through their eyes to a portal that sweeps them through as the scene comes apart,
// and on to Ecphory itself. The great peak stands along the record's heading (-z).
import * as THREE from 'three';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';
import { Bag } from './university.js';

const DEG = Math.PI / 180;
const SKY = 3400;                 // the ring's own sky, and how far in it starts
const SEA = 3300, WATER = 8;      // the sea's reach and height above the levelled ground
const SUN = new THREE.Vector3(-0.82, 0.4, 0.4).normalize();
const WARM = { lit: 0xfbe3b0, mid: 0xeeb078, dark: 0xd6714e };
const CORAL = { lit: 0xf0b184, mid: 0xcc8466, dark: 0xb76a58 };
const FAR = { lit: 0x9fd0c8, mid: 0x8cc2c4, dark: 0x7fb6c0 };
const SHARED = {
  uTime: { value: 0 }, uSwell: { value: 6 }, uPull: { value: 0 }, uRing: { value: 0 },
  uPortal: { value: new THREE.Vector3(0, 0, 0) }, uDissolve: { value: 0 }, uFade: { value: 1 },
};
// Peaks and their ink come apart in small blocks, nearest the portal first.
const SOLID = /* glsl */ `
  varying vec3 vP; uniform float uDissolve; uniform vec3 uPortal;
  float cut() { vec3 c = floor(vP / 16.0); float n = fract(sin(dot(c, vec3(127.1, 311.7, 74.7))) * 43758.5453); return n + length(vP - uPortal) / 4200.0 - uDissolve * 1.7; }`;
const solid = (extra, fragment) => new THREE.ShaderMaterial({
  side: THREE.DoubleSide, uniforms: { uDissolve: SHARED.uDissolve, uPortal: SHARED.uPortal, ...extra },
  vertexShader: `#include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 color; varying vec3 vP; varying vec3 vC;
    void main() { vP = position; vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `#include <logdepthbuf_pars_fragment>
    ${SOLID}
    varying vec3 vC;
    ${fragment}`,
});
const flat = () => solid({}, `void main() {
  #include <logdepthbuf_fragment>
  float c = cut(); if (c < 0.0) discard;
  gl_FragColor = vec4(mix(vec3(0.6, 0.8, 1.0), vC, smoothstep(0.0, 0.08, c)), 1.0);
  #include <colorspace_fragment>
}`);
const inkOf = (hex) => { const col = new THREE.Color(hex); return solid({ uCol: { value: col } }, `uniform vec3 uCol; void main() {
  #include <logdepthbuf_fragment>
  if (cut() < 0.0) discard;
  gl_FragColor = vec4(uCol, 1.0);
  #include <colorspace_fragment>
}`); };
const INK = inkOf(0x14100e), SOFT_INK = inkOf(0x4d8c98);
const STONE_INK = new THREE.LineBasicMaterial({ color: 0x14100e });

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Collects jagged inked peaks into one mesh and two sets of lines. Each face takes
// one of three flat colours by how it meets the sun, and shadowed faces are hatched.
class Peaks {
  constructor() { this.pos = []; this.col = []; this.ink = []; this.soft = []; }
  add(rng, cx, cz, radius, height, palette, soft = false) {
    const SEG = 30, RINGS = 22, sink = 260, pts = [];
    const a = rng() * 6.3, b = rng() * 6.3, c = rng() * 6.3;
    for (let j = 0; j <= RINGS; j++) {
      const t = j / RINGS, row = [], y = -sink + (height + sink) * t, wob = 1 - t;
      for (let i = 0; i < SEG; i++) {
        const th = (i / SEG) * Math.PI * 2;
        // ridges running up the mountain, jagged by the ring
        const ridge = 1 + 0.34 * Math.sin(3 * th + a + t * 1.4) + 0.17 * Math.sin(7 * th + b) + 0.1 * Math.sin(11 * th + c + t * 3) + 0.05 * Math.sin(19 * th + a + b);
        const r = radius * (1 - t) ** 1.35 * ridge * (1 + (rng() - 0.5) * 0.16);
        row.push(new THREE.Vector3(cx + Math.sin(th) * r, y + (rng() - 0.5) * height * 0.018 * wob, cz + Math.cos(th) * r));
      }
      pts.push(row);
    }
    const lines = soft ? this.soft : this.ink;
    const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const tri = (p, q, s) => {
      n.crossVectors(e1.subVectors(q, p), e2.subVectors(s, p)).normalize();
      const d = n.dot(SUN), hex = d > 0.22 ? palette.lit : d > 0 ? palette.mid : palette.dark, col = new THREE.Color(hex);
      for (const v of [p, q, s]) { this.pos.push(v.x, v.y, v.z); this.col.push(col.r, col.g, col.b); }
      return d;
    };
    for (let j = 0; j < RINGS; j++) for (let i = 0; i < SEG; i++) {
      const p = pts[j][i], q = pts[j][(i + 1) % SEG], s = pts[j + 1][(i + 1) % SEG], u = pts[j + 1][i];
      const d = tri(p, q, s);
      tri(p, s, u);
      // ridge line, with every few rings a line of strata
      lines.push(p.x, p.y, p.z, u.x, u.y, u.z);
      if (j % 3 === 0 && j) lines.push(p.x, p.y, p.z, q.x, q.y, q.z);
      if (d < 0 && !soft) for (let k = 1; k < 7; k++) {
        const f = k / 7;
        lines.push(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, p.z + (q.z - p.z) * f, u.x + (s.x - u.x) * f, u.y + (s.y - u.y) * f, u.z + (s.z - u.z) * f);
      }
    }
  }
  build(parent) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    parent.add(new THREE.Mesh(geo, flat()));
    for (const [list, mat] of [[this.ink, INK], [this.soft, SOFT_INK]]) {
      if (!list.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(list.length), 3));
      parent.add(new THREE.LineSegments(g, mat));
    }
  }
}

function buildRange(parent, rng) {
  const peaks = new Peaks();
  peaks.add(rng, 0, -1620, 1400, 1650, WARM);                             // the great peak
  for (const [x, z, r, h] of [[-1280, -1080, 860, 800], [1300, -1160, 900, 900], [-640, -1160, 620, 520], [660, -1180, 640, 580]]) peaks.add(rng, x, z, r, h, CORAL);
  for (let i = 0; i < 11; i++) {                                         // the rest of the ring, round behind you
    const a = Math.PI * (0.42 + (i / 10) * 1.16), r = 2000 + rng() * 240, h = 420 + rng() * 420;
    peaks.add(rng, Math.sin(a) * r, -Math.cos(a) * r, 640 + rng() * 200, h, CORAL);
  }
  for (const [x, z, r, h] of [[-2000, -2300, 1000, 780], [2100, -2400, 1040, 700], [-900, -2650, 840, 660], [1000, -2700, 880, 580]]) peaks.add(rng, x, z, r, h, FAR, true);
  peaks.build(parent);
  return peaks;
}

// Engrams left on the ridges of the great peak: pale standing stones, softly lit.
function buildStones(range) {
  const parent = new THREE.Group();
  parent.name = 'stones';
  range.add(parent);
  const spots = [[-300, 300, -1000], [-190, 560, -1180], [-110, 780, -1300], [-40, 1000, -1420], [200, 640, -1200], [320, 400, -1060], [430, 220, -940], [-500, 170, -880]];
  const stone = new THREE.MeshBasicMaterial({ color: 0xf3e8cf, toneMapped: false });
  const halo = canvasTexture(64, 64, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,240,210,.6)'); g.addColorStop(1, 'rgba(255,240,210,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  });
  const glow = new THREE.SpriteMaterial({ map: halo, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  for (const [x, y, z] of spots) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(14, 62, 10), stone);
    m.position.set(x, y + 28, z);
    parent.add(m);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), STONE_INK));
    const s = new THREE.Sprite(glow);
    s.position.set(x, y + 76, z + 8);
    s.scale.setScalar(70);
    parent.add(s);
  }
}

// The ring's sky, seen from inside. Straight ahead (-z) is 3/4 across the texture.
function buildSky(parent, rng) {
  const tex = canvasTexture(2048, 1024, (c, w, h) => {
    const up = c.createLinearGradient(0, 0, 0, h / 2);
    [[0, '#07505f'], [0.42, '#0b6f86'], [0.72, '#55c3b4'], [0.9, '#f6dfa6'], [1, '#f6a877']].forEach(([p, col]) => up.addColorStop(p, col));
    c.fillStyle = up; c.fillRect(0, 0, w, h / 2);
    c.fillStyle = '#f6a877'; c.fillRect(0, h / 2, w, h / 2);
    const x = w * 0.84, y = h * 0.24, r = 62;
    c.strokeStyle = 'rgba(11,93,114,.32)'; c.lineWidth = 1;
    for (let i = 0; i < 90; i++) { const a = (i / 90) * 6.283; c.beginPath(); c.moveTo(x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2); c.lineTo(x + Math.cos(a) * r * 4.4, y + Math.sin(a) * r * 4.4); c.stroke(); }
    c.fillStyle = '#fff3cf'; c.strokeStyle = '#0b5d72'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke();
    c.save(); c.clip(); c.lineWidth = 1; for (let i = 0; i < 24; i++) { c.beginPath(); c.arc(x - r * 0.7, y + r * 0.5, r * 0.75 + i * r * 0.07, 0, 7); c.stroke(); } c.restore();
    for (let i = 0; i < 4; i++) { c.lineWidth = 2; c.beginPath(); c.ellipse(x, y, r * (1.5 + i * 0.16), r * (0.26 + i * 0.03), -0.3, 0, 7); c.stroke(); }
    for (let i = 0; i < 24; i++) {
      const cx = rng() * w, cy = h * (0.2 + rng() * 0.2), wide = 50 + rng() * 110, tall = 16 + rng() * 26, n = 5 + Math.floor(rng() * 4);
      c.beginPath(); c.moveTo(cx - wide, cy);
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, q = (wide / n) * (1.2 + rng() * 0.4), px = cx - wide + 2 * wide * t, py = cy - Math.sin(t * Math.PI) * tall; c.quadraticCurveTo(px - q, py - q * 1.5, px + q, py - q * 0.2); }
      c.lineTo(cx + wide, cy); c.closePath();
      c.fillStyle = '#fff4dc'; c.fill(); c.strokeStyle = '#0b6f86'; c.lineWidth = 1.6; c.stroke();
    }
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY, 40, 24), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, toneMapped: false }));
  dome.renderOrder = -1; // first, so the planet's stars stay behind it
  parent.add(dome);
  return dome;
}

// ---------------------------------------------------------------- the substance
// After Ecphory's own: one height for the slick skin and the points, slow swells that
// sparkle where they crest, and rings that run out from the portal as it opens.
const HEIGHT = /* glsl */ `
  uniform float uTime, uSwell, uRing;
  uniform vec3 uPortal;
  float subHeight(vec2 p, out float crest) {
    vec2 q = p * 0.34;
    float s = 0.5 * sin(q.x * 0.045 + uTime * 0.35) + 0.35 * sin(q.y * 0.06 - uTime * 0.28)
      + 0.2 * sin((q.x + q.y) * 0.11 + uTime * 0.6) + 0.08 * sin(q.x * 0.4 - q.y * 0.33 + uTime * 1.1);
    float r = length(p - uPortal.xz), w = sin(r * 0.03 - uTime * 3.2), a = uRing * exp(-r / 700.0);
    crest = smoothstep(0.42, 0.95, s) + max(0.0, w) * a * 0.09;
    return uSwell * s + a * w;
  }`;

function buildSurface(parent) {
  const geo = new THREE.PlaneGeometry(SEA * 2, SEA * 2, 300, 300).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: SHARED,
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      ${HEIGHT}
      varying vec3 vP; varying float vC;
      void main() { float c; float h = subHeight(position.xz, c); vP = vec3(position.x, h, position.z); vC = c;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, h, position.z, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      varying vec3 vP; varying float vC; uniform float uFade;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(cross(dFdx(vP), dFdy(vP))); if (n.y < 0.0) n = -n;
        float r = length(vP.xz) / ${SEA.toFixed(1)};
        vec3 deep = mix(vec3(0.012, 0.024, 0.16), vec3(0.05, 0.09, 0.42), smoothstep(0.1, 0.62, r));
        float sheen = pow(1.0 - abs(n.y), 2.2) * 2.2 + vC * 0.1;
        float line = 1.0 - smoothstep(0.0, 0.05, abs(fract(vP.y * 0.42) - 0.5));
        vec3 col = deep + vec3(0.1, 0.2, 0.62) * sheen + vec3(0.1, 0.17, 0.42) * line * 0.5;
        gl_FragColor = vec4(col * uFade, 0.9 * smoothstep(0.0, 0.3, uFade + 0.0001));
      }`,
  });
  mat.extensions = { derivatives: true };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  parent.add(mesh);
}

// Points of light gathered into globules, sparkling on the crests. As the portal
// draws them in they spiral towards it and are gone.
function buildMotes(parent, rng) {
  const N = 26000, pos = new Float32Array(N * 3), tint = new Float32Array(N * 3), seed = new Float32Array(N), size = new Float32Array(N);
  const tints = [[0.62, 0.76, 1], [0.5, 0.92, 0.96], [0.8, 0.68, 1], [1, 0.96, 0.84], [1, 1, 1]];
  const globs = Array.from({ length: 150 }, () => { const a = rng() * 6.283, r = SEA * 0.62 * Math.sqrt(rng()); return [Math.sin(a) * r, Math.cos(a) * r, 16 + rng() * rng() * 110]; });
  for (let i = 0; i < N; i++) {
    let x, z;
    if (i % 2) { const d = globs[i % globs.length], s = d[2] * Math.sqrt(rng()), a = rng() * 6.283; x = d[0] + Math.sin(a) * s; z = d[1] + Math.cos(a) * s; }
    else { const a = rng() * 6.283, r = SEA * 0.62 * Math.sqrt(rng()); x = Math.sin(a) * r; z = Math.cos(a) * r; }
    pos.set([x, 1 + rng() * 2.5, z], i * 3);
    tint.set(tints[Math.floor(rng() * tints.length)], i * 3);
    seed[i] = rng();
    size[i] = 2.2 + rng() * rng() * 7;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: SHARED,
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      ${HEIGHT}
      attribute vec3 tint; attribute float seed; attribute float size; uniform float uPull; varying vec3 vTint; varying float vA;
      void main() {
        float c; float h = subHeight(position.xz, c);
        vec3 p = vec3(position.x, position.y + h, position.z);
        float k = clamp(uPull * (1.8 - seed) - length(p.xz - uPortal.xz) / 5200.0, 0.0, 1.0); k = k * k * (3.0 - 2.0 * k);
        if (k > 0.0) {                // swept in, turning as it goes
          vec2 d = p.xz - uPortal.xz; float a = k * (4.0 + seed * 5.0), s = sin(a), e = cos(a);
          d = vec2(e * d.x - s * d.y, s * d.x + e * d.y) * (1.0 - k);
          p = vec3(uPortal.x + d.x, mix(p.y, uPortal.y - ${WATER.toFixed(1)}, k), uPortal.z + d.y);
        }
        vTint = tint; vA = (0.32 + 0.45 * (0.5 + 0.5 * sin(uTime * (0.4 + seed * 0.9) + seed * 40.0)) + c * 0.9) * (1.0 - k * k);
        vec4 m = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(size * (1.0 + c * 0.7) * 3000.0 / -m.z, 2.0, 46.0); gl_Position = projectionMatrix * m;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      varying vec3 vTint; varying float vA;
      void main() {
        #include <logdepthbuf_fragment>
        float d = length(gl_PointCoord - 0.5) * 2.0, a = 1.0 - smoothstep(0.0, 1.0, d);
        gl_FragColor = vec4(mix(vTint, vec3(1.0), a * a), a * a * vA);
      }`,
  });
  const motes = new THREE.Points(geo, mat);
  motes.position.y = WATER;
  motes.frustumCulled = false;
  motes.renderOrder = 2;
  parent.add(motes);
}

// As the scene comes apart the peaks shed these: their own colours, turning to light.
function buildDust(parent, rng, pos, col) {
  const N = 30000, tris = pos.length / 9, at = new Float32Array(N * 3), tint = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = Math.floor(rng() * tris) * 9;
    let a = rng(), b = rng();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    for (let k = 0; k < 3; k++) at[i * 3 + k] = pos[t + k] + (pos[t + 3 + k] - pos[t + k]) * a + (pos[t + 6 + k] - pos[t + k]) * b;
    for (let k = 0; k < 3; k++) tint[i * 3 + k] = col[t + k];
    seed[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(at, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: SHARED,
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 tint; attribute float seed; uniform float uDissolve, uTime; uniform vec3 uPortal; varying vec3 vT; varying float vA;
      void main() {
        float go = clamp((uDissolve * 1.7 - seed * 0.5 - length(position - uPortal) / 4200.0) * 2.2, 0.0, 1.0);
        vec3 to = uPortal + vec3(sin(seed * 90.0), cos(seed * 70.0), 0.0) * 70.0;
        vec3 p = mix(position, to, go * go * go) + vec3(sin(seed * 50.0 + uTime), 2.0, cos(seed * 80.0)) * go * (1.0 - go) * 340.0;
        vT = mix(tint, mix(vec3(0.5, 0.75, 1.0), vec3(1.0), seed), smoothstep(0.1, 0.7, go));
        vA = smoothstep(0.0, 0.08, go) * (1.0 - smoothstep(0.8, 1.0, go));
        vec4 m = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(26.0 * 800.0 / -m.z, 2.0, 30.0) * (0.5 + seed); gl_Position = projectionMatrix * m;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      varying vec3 vT; varying float vA;
      void main() {
        #include <logdepthbuf_fragment>
        float d = length(gl_PointCoord - 0.5) * 2.0, a = 1.0 - smoothstep(0.0, 1.0, d); gl_FragColor = vec4(vT, a * vA);
      }`,
  });
  const dust = new THREE.Points(geo, mat);
  dust.frustumCulled = false;
  dust.visible = false;
  dust.renderOrder = 3;
  parent.add(dust);
  return dust;
}

// ---------------------------------------------------------------- the way in
const PATH_FAR = 1950, PORTAL_Z = 150, PORTAL_Y = 96, PORTAL_R = 150;
const EYE = 25, START_Z = 600, WALK = 17;

function buildCauseway(parent, rng) {
  const bag = new Bag();
  for (let z = PATH_FAR, i = 0; z > PORTAL_Z - 40; i++) {
    const long = 22 + rng() * 10;
    bag.box(30 + rng() * 6, 6, long, i % 2 ? 0xf3e8cf : 0xe2c79c, (rng() - 0.5) * 4, 13, z, (rng() - 0.5) * 0.06);
    z -= long + 3;
  }
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) bag.box(9, 26, 7, 0xf3e8cf, s * 34, 26, PATH_FAR - i * 150, 0);
  bag.build(parent);
}

// The one who walks in: a cloaked figure with a small light.
function buildWalker(parent) {
  const g = new THREE.Group(), bag = new Bag();
  bag.add(new THREE.ConeGeometry(7, 22, 10), 0x1a2238, { y: 11 });
  bag.add(new THREE.SphereGeometry(3, 10, 8), 0xf5d7a8, { y: 24 });
  bag.add(new THREE.CylinderGeometry(0.5, 0.5, 30, 6), 0x14100e, { x: 8, y: 15 });
  bag.build(g);
  const halo = canvasTexture(64, 64, (c, w) => {
    const r = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, '#fff'); r.addColorStop(0.3, 'rgba(255,240,200,.7)'); r.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = r; c.fillRect(0, 0, w, w);
  });
  const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  lamp.position.set(8, 31, 0);
  lamp.scale.setScalar(16);
  g.add(lamp);
  g.position.set(0, 16, START_Z);
  g.visible = false;
  parent.add(g);
  return g;
}

function buildPortal(parent) {
  const g = new THREE.Group();
  g.position.set(0, PORTAL_Y, PORTAL_Z);
  const uniforms = { uTime: SHARED.uTime, uOpen: { value: 0 } };
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms,
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      varying vec2 vP; uniform float uTime, uOpen;
      float n(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vP), a = atan(vP.y, vP.x);
        vec3 col = mix(vec3(0.75, 0.88, 1.0), vec3(0.02, 0.04, 0.22), smoothstep(0.0, 0.5, r));
        for (float i = 0.0; i < 4.0; i++) {
          float rr = fract(r * (1.0 + i * 0.5) - uTime * (0.16 + i * 0.05)), turn = a + uTime * (0.3 + i * 0.1) + r * 5.0;
          vec2 cell = vec2(floor(turn * (9.0 + i * 5.0)), floor(rr * 16.0) + i * 7.0);
          float s = step(0.86, n(cell)) * smoothstep(0.5, 0.0, abs(fract(turn * (9.0 + i * 5.0)) - 0.5)) * smoothstep(0.5, 0.2, abs(fract(rr * 16.0) - 0.5));
          col += s * vec3(0.6, 0.8, 1.0) * (0.5 + r);
        }
        col += vec3(0.25, 0.4, 0.95) * pow(r, 5.0) * 1.6;
        gl_FragColor = vec4(col, uOpen * (1.0 - smoothstep(0.985, 1.0, r)));
      }`,
  }));
  disc.renderOrder = 4;
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.016, 12, 128), new THREE.MeshBasicMaterial({ color: 0xfff2cc, toneMapped: false, transparent: true }));
  ring.renderOrder = 5;
  g.add(ring);
  const outer = new THREE.Mesh(new THREE.TorusGeometry(1.09, 0.012, 8, 128), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, toneMapped: false, transparent: true }));
  g.add(outer);
  g.visible = false;
  parent.add(g);
  return { g, uniforms, ring, outer };
}

// Inside the portal: Ecphory's plunge, a long tube of stars streaming past.
function buildPlunge(parent, rng) {
  const N = 9000, L = 2400, pos = new Float32Array(N * 3), tint = new Float32Array(N * 3), size = new Float32Array(N);
  const tints = [[0.17, 0.23, 0.6], [0.35, 0.23, 0.66], [0.17, 0.54, 0.66], [0.78, 0.84, 1], [1, 1, 1], [0.62, 0.9, 1]];
  for (let i = 0; i < N; i++) {
    const a = rng() * 6.283, r = 22 + rng() ** 0.7 * 240;
    pos.set([Math.cos(a) * r, PORTAL_Y + Math.sin(a) * r, PORTAL_Z - 20 - rng() * L], i * 3);
    tint.set(tints[Math.floor(rng() * tints.length)], i * 3);
    size[i] = 3 + rng() * 9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uOn: { value: 0 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 tint; attribute float size; varying vec3 vT;
      void main() { vT = tint; vec4 m = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * 900.0 / -m.z, 1.5, 44.0); gl_Position = projectionMatrix * m;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      varying vec3 vT; uniform float uOn;
      void main() {
        #include <logdepthbuf_fragment>
        float d = length(gl_PointCoord - 0.5) * 2.0, a = 1.0 - smoothstep(0.0, 1.0, d); gl_FragColor = vec4(mix(vT, vec3(1.0), a * a), a * a * uOn);
      }`,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.visible = false;
  p.renderOrder = 6;
  parent.add(p);
  return { p, mat };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildDrownedRange(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const g = new THREE.Group();
  g.rotation.y = -(rec.heading ?? 0) * DEG;
  site.add(g);

  const rng = mulberry32(1923);
  const range = new THREE.Group();
  g.add(range);
  const peaks = buildRange(range, rng);
  buildStones(range);
  // what shows only inside the ring: the sky, and the range doubled in the sea
  const inside = new THREE.Group();
  inside.visible = false;
  g.add(inside);
  const dome = buildSky(inside, rng);
  const mirrored = new THREE.Group();
  mirrored.scale.y = -1;
  mirrored.position.y = WATER * 2;
  mirrored.add(range.clone());
  inside.add(mirrored);
  buildSurface(g);
  buildMotes(g, rng);
  buildCauseway(g, rng);
  const dust = buildDust(g, rng, peaks.pos, peaks.col);
  const walker = buildWalker(g);
  const portal = buildPortal(g);
  const plunge = buildPlunge(g, rng);
  SHARED.uPortal.value.set(0, PORTAL_Y, PORTAL_Z);

  site.userData.update = (dt) => { SHARED.uTime.value += dt; };
  site.userData.labelPos = new THREE.Vector3(0, 1600, 0);
  site.userData.labelRange = 12000;
  site.updateMatrixWorld(true);

  const toWorld = (v) => v.clone().applyMatrix4(g.matrixWorld);
  const toLocal = (v) => v.clone().applyMatrix4(new THREE.Matrix4().copy(g.matrixWorld).invert());
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  site.userData.drownedRange = {
    site,
    url: rec.url,
    center: site.position.clone(),
    setInside(on) { inside.visible = on; },
    view: () => {
      const pos = toWorld(V(0, 170, 760));
      return { pos, look: toWorld(V(0, 480, -1560)).sub(pos).normalize() };
    },
    // The way in, as one shot: `camera` is flown from where it stands; `step(t)` returns
    // false once it's over. Pull out of the bowl, come back down to the walker on the
    // causeway, into their eyes, the portal, through it, and the whole scene goes.
    film(camera) {
      const from = toLocal(camera.position), ahead = new THREE.Vector3(); camera.getWorldDirection(ahead);
      const lookFrom = toLocal(camera.position.clone().addScaledVector(ahead, 400));
      const walkerAt = (t) => START_Z - WALK * Math.max(0, t - 2);
      const shots = [
        { t: 0, pos: from, look: lookFrom },
        { t: 3.4, pos: V(-420, 1250, 2300), look: V(0, 300, -700) },
        { t: 5.4, pos: V(-170, 300, walkerAt(5.4) + 420), look: V(0, 40, walkerAt(5.4) - 160) },
        { t: 7.2, pos: V(16, 44, walkerAt(7.2) + 62), look: V(0, 40, walkerAt(7.2) - 200) },
        { t: 8.7, pos: V(0, 16 + EYE, walkerAt(8.7)), look: V(0, 16 + EYE + 6, PORTAL_Z) },
      ];
      const path = new THREE.CatmullRomCurve3(shots.map((s) => s.pos), false, 'centripetal');
      const aim = new THREE.CatmullRomCurve3(shots.map((s) => s.look), false, 'centripetal');
      const fov = camera.fov;
      const pos = new THREE.Vector3(), look = new THREE.Vector3();
      walker.visible = true;
      dust.visible = true;
      camera.up.copy(up);
      return {
        length: 17,
        step(t) {
          if (t < 8.7) {
            let i = 0;
            while (i < shots.length - 2 && t > shots[i + 1].t) i++;
            const k = smooth(0, 1, (t - shots[i].t) / (shots[i + 1].t - shots[i].t)) * 0.5 + ((t - shots[i].t) / (shots[i + 1].t - shots[i].t)) * 0.5, u = (i + k) / (shots.length - 1);
            path.getPoint(u, pos);
            aim.getPoint(u, look);
          }
          // the walker keeps walking, until the camera is behind their eyes
          const z = walkerAt(t), stride = Math.sin(t * 5.6);
          walker.position.set(0, 16 + Math.abs(stride) * 0.9, z);
          walker.rotation.z = stride * 0.03;
          walker.visible = t < 8.45;
          if (t >= 8.7) {
            const eye = 16 + EYE + Math.abs(stride) * 1.1;
            const sweep = smooth(12.2, 13.7, t), fall = smooth(13.7, 16.4, t);
            pos.set(0, THREE.MathUtils.lerp(eye, PORTAL_Y, sweep), THREE.MathUtils.lerp(z, PORTAL_Z - 30, sweep * sweep) - fall * 2200);
            look.set(0, THREE.MathUtils.lerp(eye + 8, PORTAL_Y, smooth(10, 12.6, t)), pos.z - 400);
          }
          camera.position.copy(toWorld(pos));
          camera.up.copy(up);
          camera.lookAt(toWorld(look));
          camera.fov = fov + 44 * smooth(12, 13.6, t) - 20 * smooth(13.6, 16, t);
          camera.updateProjectionMatrix();
          // the substance stirs, the portal opens, and everything is drawn into it
          const open = smooth(9, 11.2, t);
          portal.g.visible = open > 0 && t < 14.4;
          portal.g.scale.setScalar(Math.max(0.001, PORTAL_R * open * (1 + 0.1 * Math.sin(open * 9.42) * (1 - open))));
          portal.uniforms.uOpen.value = open;
          SHARED.uSwell.value = 6 + 13 * smooth(8.6, 12.6, t);
          SHARED.uRing.value = 26 * open;
          SHARED.uPull.value = smooth(10.6, 13.8, t);
          SHARED.uDissolve.value = smooth(11.2, 15, t);
          SHARED.uFade.value = 1 - smooth(13.2, 14.8, t);
          dome.material.color.setScalar(1 - smooth(12.2, 14.6, t));
          g.traverse((o) => { if (o.name === 'stones') o.visible = t < 12.9; });
          plunge.p.visible = t > 13.2;
          plunge.mat.uniforms.uOn.value = smooth(13.2, 14.2, t) * (1 - smooth(15.6, 16.8, t));
          return t < this.length;
        },
        stop() {
          camera.fov = fov;
          camera.updateProjectionMatrix();
          camera.up.set(0, 1, 0);
          walker.visible = false;
          dust.visible = false;
          portal.g.visible = false;
          plunge.p.visible = false;
          SHARED.uSwell.value = 6; SHARED.uRing.value = 0; SHARED.uPull.value = 0; SHARED.uDissolve.value = 0; SHARED.uFade.value = 1;
          dome.material.color.setScalar(1);
          g.traverse((o) => { if (o.name === 'stones') o.visible = true; });
        },
      };
    },
  };
  return site;
}
