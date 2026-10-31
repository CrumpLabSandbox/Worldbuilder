// The Mirror Sea: what the organist sees from the bench. A sunset sky with a huge
// sun behind the painting, a calm sea and far rock stacks, with the temple doubled
// in the water. It has its own ground and sky, so it shows only while seated:
// from outside it would be a dome over the world.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const ramp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 195, 195, 195, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const INK = new THREE.LineBasicMaterial({ color: 0x1a1512 });
export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, toneMapped: false, ...extra });
const flat = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
const HAZE = '#f7a98e';
const hazed = (color, d, span) => new THREE.Color(color).lerp(new THREE.Color(HAZE), Math.min(0.8, Math.abs(d) / span)).getHex();

// Ink the hard edges of a mesh.
export function ink(mesh, angle = 28) {
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), INK);
  lines.position.copy(mesh.position); lines.quaternion.copy(mesh.quaternion); lines.scale.copy(mesh.scale);
  mesh.parent.add(lines);
  return mesh;
}
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Sky dome, seen from inside. Straight ahead (-z) is 3/4 across the texture; the
// lower half is the upper half mirrored, and shows through the water.
function buildSky(g, rng) {
  const tex = canvasTexture(2048, 1024, (c, w, h) => {
    const up = c.createLinearGradient(0, h * 0.325, 0, h * 0.5);
    [[0, '#2b1a5e'], [0.4, '#a23b79'], [0.8, '#f7a98e'], [1, '#ffd39a']].forEach(([p, col]) => up.addColorStop(p, col));
    c.fillStyle = up; c.fillRect(0, 0, w, h / 2);
    const sunX = w * 0.75, sunY = h * 0.435, r = 118;
    c.fillStyle = '#ffe2a4'; c.beginPath(); c.arc(sunX, sunY, r, 0, 7); c.fill();
    c.strokeStyle = 'rgba(162,59,121,.55)'; c.lineWidth = 1;
    c.save(); c.beginPath(); c.arc(sunX, sunY, r, 0, 7); c.clip();
    for (let i = 0; i < 26; i++) { c.beginPath(); c.arc(sunX - r * 0.7, sunY + r * 0.5, r * 0.75 + i * r * 0.07, 0, 7); c.stroke(); }
    c.restore();
    c.strokeStyle = 'rgba(255,214,180,.72)'; c.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const x = rng() * w, y = h * (0.26 + rng() * 0.22), len = 30 + rng() * 150;
      c.lineWidth = 1.5 + rng() * 7;
      c.beginPath(); c.moveTo(x - len, y); c.lineTo(x + len, y); c.stroke();
    }
    c.save(); c.translate(0, h); c.scale(1, -1); c.drawImage(c.canvas, 0, 0, w, h / 2, 0, 0, w, h / 2); c.restore();
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5200, 48, 32), flat(0xffffff, { map: tex, side: THREE.BackSide, depthWrite: false }));
  dome.renderOrder = -1;
  g.add(dome);
}

function buildStacks(g) {
  for (const [x, z, r, h] of [[-2600, -3200, 620, 900], [2700, -3800, 760, 1200], [-1500, -4300, 500, 800], [1500, -4600, 560, 1000], [3800, -2100, 420, 520], [-3700, -2000, 380, 460]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r, h, 7), toon(hazed('#6d3f86', z, 7000)));
    m.position.set(x, h / 2, z);
    g.add(m);
    ink(m);
  }
}
function buildPosts(g) {
  const post = toon(0x2b1a5e);
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) {
    const h = 56 + i * 2, m = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, h, 8), post);
    m.position.set(s * 96, h / 2, -240 - i * 44);
    g.add(m);
    ink(m);
  }
}
// Ruled ripples that drift across the water.
function buildWater(g, rng) {
  const base = canvasTexture(1024, 1024, (c, w, h) => {
    const r = c.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(43,26,94,.8)'); r.addColorStop(0.1, 'rgba(162,59,121,.42)'); r.addColorStop(0.3, 'rgba(208,87,127,.16)'); r.addColorStop(1, 'rgba(255,211,154,.08)');
    c.fillStyle = r; c.fillRect(0, 0, w, h);
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(5200, 64).rotateX(-Math.PI / 2), flat(0xffffff, { map: base, transparent: true, depthWrite: false }));
  water.position.y = 0.4;
  g.add(water);
  const lines = canvasTexture(512, 512, (c, w, h) => {
    c.strokeStyle = 'rgba(255,235,210,.75)'; c.lineCap = 'round';
    for (let i = 0; i < 170; i++) {
      const x = rng() * w, y = rng() * h, l = 8 + rng() * 40;
      c.lineWidth = 0.8 + rng() * 1.4;
      c.beginPath(); c.moveTo(x - l, y); c.lineTo(x + l, y); c.stroke();
    }
  });
  lines.wrapS = lines.wrapT = THREE.RepeatWrapping;
  lines.repeat.set(9, 26);
  const ripples = new THREE.Mesh(new THREE.CircleGeometry(5200, 64).rotateX(-Math.PI / 2), flat(0xffffff, { map: lines, transparent: true, depthWrite: false, opacity: 0.75 }));
  ripples.position.y = 0.8;
  g.add(ripples);
  return lines;
}

// `monument` (the temple and painting) is doubled upside down under the water.
export function buildMirrorSea(monument) {
  const g = new THREE.Group(), rng = mulberry32(790);
  buildSky(g, rng);
  const mirrored = new THREE.Group();
  mirrored.scale.y = -1;
  mirrored.add(monument.clone());
  buildStacks(mirrored);
  buildPosts(mirrored);
  g.add(mirrored);
  buildStacks(g);
  buildPosts(g);
  const ripples = buildWater(g, rng);
  g.userData.update = (dt) => { ripples.offset.x += dt * 0.012; ripples.offset.y += dt * 0.02; };
  return g;
}

// Give the stage the same drawn look: flat toon colour and ink outlines.
export function inkOver(stage, skip) {
  const meshes = [];
  const walk = (o) => { if (skip.includes(o)) return; if (o.isMesh) meshes.push(o); for (const c of o.children) walk(c); };
  walk(stage);
  const swaps = new Map();
  for (const m of meshes) {
    const src = m.material;
    if (!src?.isMeshStandardMaterial) continue;
    if (!swaps.has(src)) swaps.set(src, toon(src.color.getHex(), { side: src.side }));
    m.material = swaps.get(src);
    if (!m.isInstancedMesh && m.geometry.attributes.position.count < 400) ink(m);
  }
}
