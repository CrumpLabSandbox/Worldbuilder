// The Drowned Range, the way in to Ecphory: in that game you cross a luminous Sea of
// the Present whose islands are the summits of a drowned mountain range, the past.
// Here the range stands in its own bowl, inked and sunlit, out of a sea of points of
// light like the game's mnemic substrate. Inside the ring of peaks the sky is its own
// too. Going in breaks the view itself up into those points, and the page goes on to
// Ecphory. The great peak stands along the record's heading (-z).
import * as THREE from 'three';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';

const DEG = Math.PI / 180;
const SKY = 3400;                 // the ring's own sky, and how far in it starts
const SEA = 3300, WATER = 8;      // the sea's reach and height above the levelled ground
const SUN = new THREE.Vector3(-0.82, 0.4, 0.4).normalize();
const INK = new THREE.LineBasicMaterial({ color: 0x14100e });
const SOFT_INK = new THREE.LineBasicMaterial({ color: 0x4d8c98 });
const WARM = { lit: 0xfbe3b0, mid: 0xeeb078, dark: 0xd6714e };
const CORAL = { lit: 0xf0b184, mid: 0xcc8466, dark: 0xb76a58 };
const FAR = { lit: 0x9fd0c8, mid: 0x8cc2c4, dark: 0x7fb6c0 };
const flat = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });

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
}

// Engrams left on the ridges of the great peak: pale standing stones, softly lit.
function buildStones(parent) {
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
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), INK));
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
}

// The surface: deep blue, brightening to the horizon, under which the peaks reflect.
function buildWater(parent) {
  const tex = canvasTexture(1024, 1024, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    [[0, 'rgba(7,11,52,.96)'], [0.3, 'rgba(12,22,96,.93)'], [0.44, 'rgba(24,42,150,.88)'], [0.56, 'rgba(63,95,216,.8)'], [1, 'rgba(63,95,216,.85)']].forEach(([p, col]) => g.addColorStop(p, col));
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(SEA, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  water.position.y = WATER;
  water.renderOrder = 1;
  parent.add(water);
}

// The mnemic substrate: points of light that breathe, thicker in drifts.
function buildMotes(parent, rng) {
  const N = 22000, pos = new Float32Array(N * 3), tint = new Float32Array(N * 3), phase = new Float32Array(N), size = new Float32Array(N);
  const tints = [[0.62, 0.76, 1], [0.5, 0.92, 0.96], [0.8, 0.68, 1], [1, 0.96, 0.84], [1, 1, 1]];
  const drifts = Array.from({ length: 40 }, () => { const a = rng() * 6.283, r = 1500 * Math.sqrt(rng()); return [Math.sin(a) * r, Math.cos(a) * r]; });
  for (let i = 0; i < N; i++) {
    let x, z;
    if (i % 3 === 0) { const d = drifts[i % drifts.length], s = 30 + rng() * 150, a = rng() * 6.283; x = d[0] + Math.sin(a) * s * rng(); z = d[1] + Math.cos(a) * s * rng(); }
    else { const a = rng() * 6.283, r = SEA * 0.62 * Math.sqrt(rng()); x = Math.sin(a) * r; z = Math.cos(a) * r; }
    pos.set([x, WATER + 1 + rng() * 5, z], i * 3);
    tint.set(tints[Math.floor(rng() * tints.length)], i * 3);
    phase[i] = rng();
    size[i] = 2.5 + rng() * rng() * 7;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 tint; attribute float phase; attribute float size; uniform float time; varying vec3 vTint; varying float vA;
      void main() { vTint = tint; vA = 0.5 + 0.5 * sin(time * (0.4 + phase * 0.9) + phase * 40.0);
        vec4 p = modelViewMatrix * vec4(position.x, position.y + sin(time * 0.5 + phase * 30.0) * 1.6, position.z, 1.0);
        gl_PointSize = clamp(size * 3200.0 / -p.z, 2.5, 40.0); gl_Position = projectionMatrix * p;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      varying vec3 vTint; varying float vA;
      void main() { 
        #include <logdepthbuf_fragment>
        float d = length(gl_PointCoord - 0.5) * 2.0; float a = 1.0 - smoothstep(0.0, 1.0, d); gl_FragColor = vec4(mix(vTint, vec3(1.0), a * a), a * a * (0.35 + 0.65 * vA)); }`,
  });
  const motes = new THREE.Points(geo, mat);
  motes.frustumCulled = false;
  motes.renderOrder = 2;
  parent.add(motes);
  return mat;
}

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
  buildRange(range, rng);
  buildStones(range);
  // what shows only inside the ring: the sky, and the range doubled in the sea
  const inside = new THREE.Group();
  inside.visible = false;
  g.add(inside);
  buildSky(inside, rng);
  const mirrored = new THREE.Group();
  mirrored.scale.y = -1;
  mirrored.position.y = WATER * 2;
  mirrored.add(range.clone());
  inside.add(mirrored);
  buildWater(g);
  const motes = buildMotes(g, rng);

  site.userData.update = (dt) => { motes.uniforms.time.value += dt; };
  site.userData.labelPos = new THREE.Vector3(0, 1600, 0);
  site.userData.labelRange = 12000;
  site.updateMatrixWorld(true);

  const toWorld = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
  site.userData.drownedRange = {
    site,
    url: rec.url,
    center: site.position.clone(),
    setInside(on) { inside.visible = on; },
    view: () => {
      const pos = toWorld(0, 170, 620);
      return { pos, look: toWorld(0, 480, -1560).sub(pos).normalize() };
    },
  };
  return site;
}

// Break whatever is on screen up into points of light. `source` is a canvas holding
// the view; `done` runs once the screen has settled on the dark of Ecphory's title.
export function dissolveToLight(source, done) {
  const W = window.innerWidth, H = window.innerHeight;
  const view = document.createElement('canvas');
  view.id = 'mn-dissolve';
  view.width = W; view.height = H;
  document.body.append(view);
  const ctx = view.getContext('2d');
  const snap = document.createElement('canvas');
  snap.width = W; snap.height = H;
  const sc = snap.getContext('2d', { willReadFrequently: true });
  sc.drawImage(source, 0, 0, W, H);
  const px = sc.getImageData(0, 0, W, H).data;
  const sprite = (hex) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const q = c.getContext('2d'), g = q.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, '#fff'); g.addColorStop(0.28, hex); g.addColorStop(1, 'rgba(0,0,0,0)');
    q.fillStyle = g; q.fillRect(0, 0, 32, 32);
    return c;
  };
  const glows = ['#96beff', '#78e6f0', '#c8aaff', '#fff0d2'].map(sprite);
  const cell = Math.max(7, Math.round(Math.sqrt((W * H) / 6000)));
  const rng = mulberry32(417), cells = [];
  for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
    const i = (Math.floor(y + cell / 2) * W + Math.floor(x + cell / 2)) * 4;
    cells.push({
      x, y, c: `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`, done: false,
      // the front sweeps across and up, ragged at the edge
      at: 0.04 + 0.5 * (1 - x / W) + 0.14 * (y / H) + rng() * 0.2,
      rise: 40 + rng() * H * 0.34, drift: (rng() - 0.5) * 70, size: 5 + rng() * 15, glow: glows[Math.floor(rng() * 4)], beat: rng() * 6,
    });
  }
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#050717'); sky.addColorStop(0.6, '#0d1a70'); sky.addColorStop(1, '#070b34');
  const start = performance.now(), length = 6500;
  const frame = () => {
    const t = (performance.now() - start) / length;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    for (const p of cells) if (!p.done && t >= p.at) { p.done = true; sc.clearRect(p.x, p.y, cell, cell); }
    ctx.drawImage(snap, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of cells) {
      if (!p.done) continue;
      const a = Math.min(1, (t - p.at) / 0.3), e = a * a * (3 - 2 * a), x = p.x + p.drift * e, y = p.y - p.rise * e;
      if (a < 0.35) { ctx.globalAlpha = 1; ctx.fillStyle = p.c; ctx.fillRect(x, y, cell, cell); }
      ctx.globalAlpha = (0.5 + 0.5 * Math.sin(t * 40 + p.beat)) * 0.6 + 0.3 * e;
      ctx.drawImage(p.glow, x - p.size / 2, y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (t > 0.86) { ctx.globalAlpha = Math.min(1, (t - 0.86) / 0.12); ctx.fillStyle = '#03050c'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    if (t < 1) requestAnimationFrame(frame); else done();
  };
  requestAnimationFrame(frame);
}
