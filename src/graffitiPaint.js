// Paint and concrete for the graffiti garden: spray-paint materials with
// banded colour fades (computed per pixel in the piece's own frame), cartoon
// outline hulls, an environment map for gloss and chrome, and high-resolution
// canvas textures for concrete and painted murals.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mulberry32 } from './noise.js';

export const ctx = { renderer: null, env: null };
// Classic graffiti-chrome environment: deep blue sky fading to a bright horizon
// line, warm desert ground below, plus a few soft light panels for glints.
function chromeEnvScene() {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float y = vP.y;
        vec3 top = vec3(0.02, 0.10, 0.45), mid = vec3(0.35, 0.75, 1.0), hor = vec3(1.6, 1.55, 1.4);
        vec3 g0 = vec3(0.55, 0.32, 0.12), g1 = vec3(0.08, 0.05, 0.04);
        vec3 c = y > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.12, y)), top, smoothstep(0.12, 0.9, y))
                         : mix(mix(hor * 0.9, g0, smoothstep(0.0, 0.05, -y)), g1, smoothstep(0.05, 0.7, -y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(sky);
  const panel = (x, y, z, w, h, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m); };
  panel(20, 30, 15, 14, 6, 4); panel(-25, 22, -10, 8, 8, 3); panel(5, 12, -30, 20, 3, 2.5);
  return scene;
}
export function envMap() {
  if (!ctx.env && ctx.renderer) {
    const pm = new THREE.PMREMGenerator(ctx.renderer);
    ctx.env = pm.fromScene(chromeEnvScene(), 0.02).texture;
    pm.dispose();
  }
  return ctx.env;
}
void RoomEnvironment;

const col = (c) => (c instanceof THREE.Color ? c : new THREE.Color(c));

// Glossy spray paint. `stops` (2-4 colours) fade bottom to top between yMin and
// yMax in the piece's frame, with wavy band edges; optional polka dots or
// diagonal stripes in the upper bands.
export function paint({ stops, yMin = 0, yMax = 10, wave = 1, waveFreq = 0.45, sharp = 0.3, dots = null, stripes = null, metal = 0.05, rough = 0.32, clearcoat = 1, emissive = 0.2 }) {
  const s = stops.map(col);
  while (s.length < 4) s.push(s[s.length - 1]);
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: metal, roughness: rough, clearcoat, clearcoatRoughness: 0.18, envMap: envMap(), envMapIntensity: 0.5 });
  const u = {
    uStops: { value: s.slice(0, 4) }, uN: { value: Math.min(4, stops.length) },
    uYMin: { value: yMin }, uYMax: { value: yMax }, uWave: { value: wave }, uWaveF: { value: waveFreq }, uSharp: { value: sharp },
    uDots: { value: new THREE.Vector4(dots ? dots.spacing : 1, dots ? dots.radius : 0, dots ? dots.from : 2, dots ? 1 : 0) },
    uDotCol: { value: col(dots ? dots.color : 0xffffff) },
    uStripes: { value: new THREE.Vector4(stripes ? stripes.spacing : 1, stripes ? stripes.width : 0, stripes ? stripes.from : 2, stripes ? 1 : 0) },
    uStripeCol: { value: col(stripes ? stripes.color : 0xffffff) },
    uEmit: { value: emissive },
    uToPaint: { value: new THREE.Matrix4() },
  };
  m.userData.paint = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform mat4 uToPaint;\nvarying vec3 vPaint;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPaint = (uToPaint * modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `uniform vec3 uStops[4]; uniform float uN, uYMin, uYMax, uWave, uWaveF, uSharp, uEmit;
uniform vec4 uDots, uStripes; uniform vec3 uDotCol, uStripeCol; varying vec3 vPaint;
vec3 gStop(float i) { return i < 0.5 ? uStops[0] : i < 1.5 ? uStops[1] : i < 2.5 ? uStops[2] : uStops[3]; }
` + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
  float gt = (vPaint.y - uYMin) / max(0.001, uYMax - uYMin);
  gt += uWave * (0.035 * sin(vPaint.x * uWaveF + vPaint.z * 0.3) + 0.015 * sin(vPaint.x * uWaveF * 3.1));
  gt = clamp(gt, 0.0, 1.0);
  float gs = gt * (uN - 1.0);
  float gi = min(floor(gs), uN - 2.0);
  float gf = smoothstep(0.5 - uSharp, 0.5 + uSharp, gs - gi);
  vec3 gc = mix(gStop(gi), gStop(gi + 1.0), gf);
  if (uDots.w > 0.5 && gt > uDots.z) {
    vec2 cell = fract(vPaint.xy / uDots.x + vec2(0.5 * floor(vPaint.y / uDots.x), 0.0)) - 0.5;
    gc = mix(gc, uDotCol, 1.0 - smoothstep(uDots.y - 0.03, uDots.y + 0.03, length(cell)));
  }
  if (uStripes.w > 0.5 && gt > uStripes.z) {
    float sd = fract((vPaint.x + vPaint.y) / uStripes.x);
    gc = mix(gc, uStripeCol, step(sd, uStripes.y));
  }
  vec4 diffuseColor = vec4(gc, opacity);`).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gc * uEmit;');
  };
  return m;
}

// Chrome: mirror metal with a faint tint.
export function chrome(tint = 0xe9eef8, rough = 0.08) {
  return new THREE.MeshPhysicalMaterial({ color: tint, metalness: 1, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.05, envMap: envMap(), envMapIntensity: 1.25 });
}

// Cartoon outline: the same shape pushed out along smooth normals, back faces only.
export function hullMaterial(color, width) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uW = { value: width };
    sh.vertexShader = 'uniform float uW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(normal) * uW;');
  };
  return m;
}
export function hullGeometry(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  return merged;
}
// add outline hulls (outer first) to a mesh
export function outline(mesh, rings = [[0x111111, 0.35]]) {
  const hg = hullGeometry(mesh.geometry);
  for (const [color, w] of rings) {
    const h = new THREE.Mesh(hg, hullMaterial(color, w));
    h.castShadow = false; h.receiveShadow = false;
    h.userData.hull = true;
    mesh.add(h);
  }
  return mesh;
}

// ---------------------------------------------------------------- canvas textures
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = ctx.renderer ? Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()) : 1;
  return t;
}
const NEON = ['#ff2ea6', '#19e3ff', '#b6ff1a', '#ffe600', '#ff7a1a', '#9b5cff', '#ffffff', '#ff3b3b'];

function concreteBase(g, w, h, rng, tone = 150) {
  g.fillStyle = `rgb(${tone},${tone - 3},${tone - 8})`;
  g.fillRect(0, 0, w, h);
  // mottling
  for (let i = 0; i < 260; i++) {
    const x = rng() * w, y = rng() * h, r = 20 + rng() * 140;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const d = rng() < 0.5 ? 0 : 255;
    gr.addColorStop(0, `rgba(${d},${d},${d},${0.035 + rng() * 0.05})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // grit
  const img = g.getImageData(0, 0, w, h), px = img.data;
  for (let i = 0; i < px.length; i += 4) { const n = (rng() - 0.5) * 34; px[i] += n; px[i + 1] += n; px[i + 2] += n; }
  g.putImageData(img, 0, 0);
  // pores and formwork seams
  for (let i = 0; i < w * h / 900; i++) { g.fillStyle = `rgba(40,40,40,${0.25 + rng() * 0.3})`; g.beginPath(); g.arc(rng() * w, rng() * h, 0.6 + rng() * 1.8, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(60,60,60,0.35)'; g.lineWidth = 2;
  for (let y = h / 3; y < h; y += h / 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (rng() - 0.5) * 3); g.stroke(); }
  for (let y = h / 6; y < h; y += h / 3) for (let x = w / 8; x < w; x += w / 4) { g.fillStyle = 'rgba(50,50,50,0.5)'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  // rain streaks
  for (let i = 0; i < 40; i++) { const x = rng() * w; const gr = g.createLinearGradient(x, 0, x, h * (0.3 + rng() * 0.6)); gr.addColorStop(0, 'rgba(30,30,30,0.18)'); gr.addColorStop(1, 'rgba(30,30,30,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + rng() * 6, h); }
}
function drip(g, x, y, len, width, color) {
  g.strokeStyle = color; g.lineCap = 'round'; g.lineWidth = width;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 2, y + len); g.stroke();
  g.fillStyle = color; g.beginPath(); g.arc(x, y + len, width * 0.85, 0, 7); g.fill();
}
function sparkle(g, x, y, r, color = '#ffffff') {
  g.fillStyle = color; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const rr = i % 2 ? r * 0.18 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
function tags(g, w, h, rng, count = 14) {
  for (let i = 0; i < count; i++) {
    const c = NEON[Math.floor(rng() * NEON.length)];
    const x = rng() * w * 0.9, y = h * 0.15 + rng() * h * 0.75, s = 30 + rng() * 70;
    g.strokeStyle = c; g.lineWidth = 3 + rng() * 6; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(x, y);
    let px = x, py = y;
    const n = 4 + Math.floor(rng() * 6);
    for (let k = 0; k < n; k++) { const nx = px + s * (0.3 + rng() * 0.6), ny = y + (rng() - 0.5) * s; g.bezierCurveTo(px + s * 0.5, py - s * rng(), nx - s * 0.4, ny + s * rng(), nx, ny); px = nx; py = ny; }
    g.stroke();
    // swoosh underline + star or crown
    g.lineWidth *= 0.7; g.beginPath(); g.moveTo(x - 10, y + s * 0.6); g.quadraticCurveTo((x + px) / 2, y + s * 0.9, px + 20, y + s * 0.4); g.stroke();
    if (rng() < 0.5) sparkle(g, px + 25, y - s * 0.4, 10 + rng() * 10, c);
    else { g.beginPath(); g.moveTo(x, y - s * 0.5); g.lineTo(x + 8, y - s * 0.9); g.lineTo(x + 16, y - s * 0.6); g.lineTo(x + 24, y - s * 0.95); g.lineTo(x + 32, y - s * 0.5); g.stroke(); }
    if (rng() < 0.6) drip(g, x + s * rng(), y + 4, 10 + rng() * 40, 3, c);
  }
}
export function concreteTexture(seed, { w = 1024, h = 1024, tagCount = 10, tone = 150, repeat = [1, 1] } = {}) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(w, h);
  concreteBase(g, w, h, rng, tone);
  if (tagCount) tags(g, w, h, rng, tagCount);
  return tex(c, repeat);
}
export function concreteMaterial(seed, opts = {}) {
  return new THREE.MeshStandardMaterial({ map: concreteTexture(seed, opts), roughness: 0.92, metalness: 0, envMap: envMap(), envMapIntensity: 0.25 });
}

// ---- mural: a full graffiti piece painted onto concrete with real letterforms
function shapePath(shapes, sx, sy, ox, oy) {
  const p = new Path2D();
  for (const s of shapes) {
    for (const loop of [s.getPoints(10), ...s.holes.map((h) => h.getPoints(10))]) {
      loop.forEach((pt, i) => { const x = ox + pt.x * sx, y = oy - pt.y * sy; if (i) p.lineTo(x, y); else p.moveTo(x, y); });
      p.closePath();
    }
  }
  return p;
}
export function muralTexture(font, spec, seed = 1) {
  const W = spec.w || 2048, H = spec.h || 768;
  const rng = mulberry32(seed);
  const [c, g] = canvas(W, H);
  concreteBase(g, W, H, rng, spec.tone ?? 140);
  // spray clouds behind the piece
  for (const [i, cc] of (spec.clouds || ['#9b5cff', '#19e3ff', '#ff2ea6']).entries()) {
    for (let k = 0; k < 6; k++) {
      const x = W * (0.15 + 0.7 * rng()), y = H * (0.3 + 0.4 * rng()), r = H * (0.25 + 0.3 * rng());
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, cc + 'aa'); gr.addColorStop(1, cc + '00');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    void i;
  }
  tags(g, W, H, rng, 8);
  // letters, each with its own bounce and tilt
  const text = spec.text;
  let size = spec.size || H * 0.5;
  { // shrink to fit the wall
    let a = 0; for (const ch of text) { const gl = font.data.glyphs[ch] || font.data.glyphs['?']; a += gl.ha * (size / font.data.resolution) * (spec.tight ?? 0.86); }
    const room = W * (spec.character ? 0.72 : 0.86);
    if (a > room) size *= room / a;
  }
  const res = font.data.resolution, scale = size / (font.data.boundingBox.yMax - font.data.boundingBox.yMin) * 1.3;
  let adv = 0; const glyphs = [];
  for (const ch of text) { const gl = font.data.glyphs[ch] || font.data.glyphs['?']; glyphs.push({ ch, x: adv }); adv += gl.ha * (size / res) * (spec.tight ?? 0.86); }
  const total = adv;
  const ox = (W - total) / 2 + (spec.dx || 0), oy = H * (spec.baseline ?? 0.72);
  const paths = glyphs.map((gl, i) => {
    if (gl.ch === ' ') return null;
    const shapes = font.generateShapes(gl.ch, size);
    const bounce = Math.sin(i * 1.9 + seed) * H * (spec.bounce ?? 0.04);
    const rot = (rng() - 0.5) * (spec.tilt ?? 0.16);
    return { p: shapePath(shapes, 1, 1, 0, 0), x: ox + gl.x, y: oy + bounce, rot };
  }).filter(Boolean);
  void scale;
  const each = (fn) => { for (const L of paths) { g.save(); g.translate(L.x, L.y); g.rotate(L.rot); fn(L.p); g.restore(); } };
  // 3D extrusion
  const ext = spec.extrude ?? 26, [edx, edy] = spec.extrudeDir || [1, 1];
  for (let k = ext; k > 0; k -= 2) { g.save(); g.translate(edx * k, edy * k); each((p) => { g.fillStyle = spec.extrudeColor || '#2a0a4a'; g.fill(p, 'evenodd'); g.lineWidth = 6; g.strokeStyle = spec.extrudeColor || '#2a0a4a'; g.stroke(p); }); g.restore(); }
  // outlines: white then black
  g.lineJoin = 'round';
  each((p) => { g.lineWidth = spec.outerWidth ?? 44; g.strokeStyle = spec.outer || '#ffffff'; g.stroke(p); });
  each((p) => { g.lineWidth = spec.innerWidth ?? 22; g.strokeStyle = spec.inner || '#111111'; g.stroke(p); });
  // fill: fade
  const fade = g.createLinearGradient(0, -size * 0.95, 0, size * 0.05); // letter-local coordinates
  const stops = spec.fill || ['#ffe600', '#ff7a1a', '#ff2ea6', '#7a2cff'];
  stops.forEach((s, i) => fade.addColorStop(i / (stops.length - 1), s));
  each((p) => { g.fillStyle = fade; g.fill(p, 'evenodd'); });
  // pattern inside the letters (bubbles and stripes), clipped
  each((p) => {
    g.save(); g.clip(p, 'evenodd');
    if (spec.pattern === 'stripes') { g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 10; for (let x = -H; x < W; x += 36) { g.beginPath(); g.moveTo(x, -H); g.lineTo(x + H * 2, H * 2); g.stroke(); } }
    else { for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.3})`; g.beginPath(); g.arc((rng() - 0.2) * size, -rng() * size, 4 + rng() * 18, 0, 7); g.fill(); } }
    // cracked fade band
    g.fillStyle = spec.band || 'rgba(25,227,255,0.9)';
    g.beginPath(); g.moveTo(-50, -size * 0.42);
    for (let x = -50; x < size * 1.4; x += 28) g.lineTo(x, -size * 0.42 + (x / 28 % 2 ? 18 : -18));
    g.lineTo(size * 1.4, -size * 0.52); g.lineTo(-50, -size * 0.52); g.closePath(); g.fill();
    g.restore();
  });
  // shines and drips
  each(() => {
    g.strokeStyle = '#ffffff'; g.lineCap = 'round'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(size * 0.12, -size * 0.78); g.lineTo(size * 0.12, -size * 0.6); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(size * 0.12, -size * 0.52, 5, 0, 7); g.fill();
  });
  for (let k = 0; k < (spec.drips ?? 18); k++) {
    const L = paths[Math.floor(rng() * paths.length)];
    drip(g, L.x + size * (0.1 + rng() * 0.5), L.y + 4, 20 + rng() * H * 0.18, 6 + rng() * 6, stops[stops.length - 1]);
  }
  // arrows flying off the piece
  for (let k = 0; k < (spec.arrows ?? 2); k++) {
    const left = k % 2 === 0;
    const x0 = left ? ox - 10 : ox + total - 40, y0 = oy - size * (0.3 + rng() * 0.4);
    const x1 = left ? x0 - W * 0.09 : x0 + W * 0.1, y1 = y0 - H * (0.12 + rng() * 0.18);
    for (const [lw, cc] of [[38, '#ffffff'], [24, '#111111'], [12, spec.arrowColor || '#19e3ff']]) {
      g.strokeStyle = cc; g.lineWidth = lw; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, y0 + H * 0.12, x1, y1); g.stroke();
      const a = Math.atan2(y1 - (y0 + H * 0.12), x1 - (x0 + x1) / 2);
      g.fillStyle = cc; g.beginPath();
      const hs = 30 + lw * 0.6;
      g.moveTo(x1 + Math.cos(a) * hs, y1 + Math.sin(a) * hs);
      g.lineTo(x1 + Math.cos(a + 2.4) * hs, y1 + Math.sin(a + 2.4) * hs);
      g.lineTo(x1 + Math.cos(a - 2.4) * hs, y1 + Math.sin(a - 2.4) * hs); g.closePath(); g.fill();
    }
  }
  if (spec.character === 'alien') {
    const cx = spec.charX ?? W * 0.1, cy = H * 0.5, r = H * 0.26;
    g.lineWidth = 16; g.strokeStyle = '#111';
    g.fillStyle = '#7dff3a'; g.beginPath(); g.ellipse(cx, cy, r * 0.8, r, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#111'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * r * 0.33, cy - r * 0.1, r * 0.22, r * 0.38, s * 0.5, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * r * 0.28, cy - r * 0.28, r * 0.06, 0, 7); g.fill(); }
    g.strokeStyle = '#111'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy + r * 0.45, r * 0.18, 0.2, Math.PI - 0.2); g.stroke();
    for (let k = 0; k < 4; k++) drip(g, cx + (k - 1.5) * r * 0.35, cy + r * 0.85, 20 + rng() * 60, 9, '#7dff3a');
  }
  for (let k = 0; k < (spec.sparkles ?? 10); k++) sparkle(g, W * rng(), H * (0.05 + rng() * 0.5), 12 + rng() * 26);
  return tex(c);
}
