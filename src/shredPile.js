// The Shred Pile: the far end of the Shred Hole's vortex portal
// (https://samuelling.github.io/Tunnel/). Whatever falls through the portal under the Shred Hole
// comes out of a matching portal hanging in the sky here and lands on a growing heap.
//
// The server keeps the drops (server/shredDrops.js); this polls for them, supersizes the pieces
// (they are real-size convex hulls: a duck chunk is a few centimetres) and lets them fall.
// The heap is a height field that accepts each piece's volume and slumps to an angle of repose,
// so pieces stack instead of interpenetrating. Old drops are rebuilt into the same heap on load
// (seeded by drop id, so everyone sees the same pile), new ones fall out of the sky as they arrive.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';

const DEG = Math.PI / 180;
const PILE_R = 64;                 // heap area radius (m)
const CELLS = 64, CELL = (PILE_R * 2) / CELLS;
const REPOSE = Math.tan(38 * DEG); // steepest slope the heap holds
const PORTAL_ALT = 150, PORTAL_R = 28;
const GRAV = 9.81 * 2.2;           // a bit brisker than real so the long fall stays watchable
const POLL = 6, POLL_MAX = 60;     // seconds between mailbox checks; the pile naps when nothing arrives
const COMPACT_AT = 32;             // heap height (m) that brings the compactor
const BALE_SQUASH = 0.22;          // a bale keeps ~22% of the heap's loose volume

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.canvas = cv;
  return t;
}

const portalMaterial = (uniforms) => new THREE.ShaderMaterial({
  uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    varying vec2 vUv; uniform float uTime; uniform float uPulse;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      float sw = a - 3.2 / (r + 0.18) + uTime * 1.4;
      float arms = 0.5 + 0.5 * sin(sw * 4.0 + noise(vec2(sw * 1.5, r * 6.0 - uTime)) * 3.0);
      float fil = noise(vec2(cos(sw) * 3.0 + uTime * 0.3, r * 9.0 - uTime * 1.2));
      vec3 deep = vec3(0.06, 0.0, 0.14), violet = vec3(0.55, 0.12, 1.0), cyan = vec3(0.2, 0.95, 1.0);
      vec3 c = mix(deep, violet, arms * smoothstep(1.0, 0.25, r));
      c = mix(c, cyan, pow(arms * fil, 3.0) * smoothstep(0.95, 0.4, r) * 1.4);
      c = mix(c, vec3(0.92, 0.98, 1.0), smoothstep(0.24, 0.0, r) * (0.6 + uPulse));   // the far side shines through
      c += (violet * 1.6 + vec3(0.3)) * smoothstep(0.82, 0.97, r) * smoothstep(1.0, 0.96, r);
      gl_FragColor = vec4(c * (1.25 + uPulse), smoothstep(1.0, 0.94, r));
    }`,
});

// A debris piece: convex hull of its points (scaled), coloured from skin to insides.
function pieceGeometry(pc, scale) {
  const pts = [];
  for (let i = 0; i + 2 < pc.p.length; i += 3) pts.push(new THREE.Vector3(pc.p[i], pc.p[i + 1], pc.p[i + 2]));
  let ext = 0;
  for (const v of pts) ext = Math.max(ext, v.length());
  const s = Math.min(scale, 16 / Math.max(ext, 1e-3));         // no single piece bigger than ~32 m
  for (const v of pts) v.multiplyScalar(s);
  let g;
  try { g = new ConvexGeometry(pts); } catch { return null; }
  const pos = g.attributes.position;
  if (!pos || pos.count < 12) { g.dispose(); return null; }
  g.computeBoundingSphere();
  const r = g.boundingSphere.radius, cen = g.boundingSphere.center;
  const outer = new THREE.Color(pc.c), inner = new THREE.Color(pc.i), col = new THREE.Color(), v = new THREE.Vector3();
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = Math.min(1, v.distanceTo(cen) / (r || 1));
    col.copy(inner).lerp(outer, t * t);
    cols.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  g.computeBoundingBox();
  const sz = g.boundingBox.getSize(new THREE.Vector3());
  return { geo: g, radius: r, half: Math.min(sz.x, sz.y, sz.z) / 2, volume: sz.x * sz.y * sz.z * 0.5 };
}

export function buildShredPile(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const g = new THREE.Group();
  g.rotation.y = -(rec.heading ?? 0) * DEG;
  site.add(g);
  const SCALE = rec.debrisScale ?? 18;   // Shred Hole pieces are real-size; here they arrive big, but not instant-mountain big

  // ---- the yard: a scorched landing zone, a ring of hazard posts, the sign board
  const yard = new THREE.Mesh(new THREE.CircleGeometry(PILE_R + 14, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    map: canvasTexture(512, 512, (c, w, h) => {
      const gr = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
      gr.addColorStop(0, '#2b2430'); gr.addColorStop(0.7, '#4a4038'); gr.addColorStop(1, 'rgba(90,80,70,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${20 + Math.random() * 60},${15 + Math.random() * 40},${30 + Math.random() * 50},0.25)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    }),
    transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  yard.position.y = 1.2;
  g.add(yard);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf2b311, roughness: 0.6, flatShading: true });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.6, flatShading: true });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, x = Math.cos(a) * (PILE_R + 10), z = Math.sin(a) * (PILE_R + 10);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 7, 8), i % 2 ? postMat : stripeMat);
    post.position.set(x, 3.5, z); g.add(post);
  }
  const board = canvasTexture(1024, 640, () => {});
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(48, 30), new THREE.MeshStandardMaterial({ map: board, roughness: 0.7, side: THREE.DoubleSide }));
  boardMesh.position.set(0, 26, PILE_R + 26);
  boardMesh.rotation.y = Math.PI;
  g.add(boardMesh);
  for (const x of [-20, 20]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 26, 1.6), stripeMat); leg.position.set(x, 13, PILE_R + 26.5); g.add(leg); }
  const log = [];
  function drawBoard() {
    const c = board.userData.canvas.getContext('2d'), w = 1024, h = 640;
    c.fillStyle = '#f2b311'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#111'; c.lineWidth = 16; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#111'; c.textAlign = 'center';
    c.font = '900 92px Impact, "Arial Black", sans-serif'; c.fillText('THE SHRED PILE', w / 2, 112);
    c.font = '700 30px "Arial Black", sans-serif'; c.fillText('FRESH FROM THE SHRED HOLE · VIA VORTEX PORTAL', w / 2, 158);
    c.textAlign = 'left'; c.font = '600 34px system-ui, sans-serif';
    if (!log.length) c.fillText('Nothing yet. Go and shred something.', 60, 260);
    log.slice(0, 7).forEach((d, i) => {
      const mins = Math.max(0, Math.round((Date.now() - d.at) / 60000));
      const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
      c.fillText(`${d.object.icon} ${d.object.name} — ${d.object.verdict || 'arrived'} · ${d.pieces.length} pcs · ${ago}`, 60, 240 + i * 52);
    });
    c.textAlign = 'right'; c.font = '700 26px "Arial Black", sans-serif';
    c.fillText(`${total.pieces.toLocaleString()} PIECES · ${total.kg.toFixed(1)} KG OF REAL-WORLD MASS`, w - 50, h - 40);
    c.textAlign = 'left';
    const tags = [bales.length ? `${bales.length} BALE${bales.length === 1 ? '' : 'S'} COMPACTED` : '', pollEvery >= 30 ? '💤 NAPPING' : ''].filter(Boolean);
    if (tags.length) c.fillText(tags.join(' · '), 50, h - 40);
    board.needsUpdate = true;
  }

  // ---- the sky portal
  const portal = new THREE.Group();
  portal.position.y = PORTAL_ALT;
  g.add(portal);
  const uniforms = { uTime: { value: 0 }, uPulse: { value: 0 } };
  const disc = new THREE.Mesh(new THREE.CircleGeometry(PORTAL_R, 96).rotateX(Math.PI / 2), portalMaterial(uniforms));
  portal.add(disc);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b0a4a, emissive: 0x9b4dff, emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.3 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_R + 1, 1.3, 12, 96).rotateX(Math.PI / 2), rimMat);
  portal.add(rim);
  const runes = new THREE.Group(); portal.add(runes);
  const runeMat = new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0x40e0ff, emissiveIntensity: 1.3, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), runeMat);
    const a = (i / 12) * Math.PI * 2; m.position.set(Math.cos(a) * (PORTAL_R + 7), 0, Math.sin(a) * (PORTAL_R + 7)); runes.add(m);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_R * 0.8, PILE_R * 0.7, PORTAL_ALT, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x8b5cff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = PORTAL_ALT / 2; g.add(beam);
  const light = new THREE.PointLight(0x9b5cff, 3, 420, 1.2); light.position.y = PORTAL_ALT - 8; g.add(light);

  // ---- the heap
  const H = new Float32Array(CELLS * CELLS);
  const cellOf = (x, z) => [Math.floor((x + PILE_R) / CELL), Math.floor((z + PILE_R) / CELL)];
  function heightAt(x, z) {
    const fx = (x + PILE_R) / CELL - 0.5, fz = (z + PILE_R) / CELL - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const at = (a, b) => (a < 0 || b < 0 || a >= CELLS || b >= CELLS ? 0 : H[b * CELLS + a]);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  }
  function deposit(x, z, vol, rad) {
    const [ci, cj] = cellOf(x, z), n = Math.max(1, Math.ceil(rad / CELL));
    let wsum = 0;
    const cells = [];
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) continue;
      const dx = (i + 0.5) * CELL - PILE_R - x, dz = (j + 0.5) * CELL - PILE_R - z, d = Math.hypot(dx, dz);
      if (d > rad + CELL) continue;
      const w = 1 - d / (rad + CELL); cells.push([j * CELLS + i, w]); wsum += w;
    }
    for (const [k, w] of cells) H[k] += (vol / (CELL * CELL)) * (w / (wsum || 1)) * 0.7;
    // slump: let over-steep neighbours shed material outward, a few local passes
    for (let pass = 0; pass < 3; pass++) {
      for (let j = Math.max(1, cj - n - 3); j < Math.min(CELLS - 1, cj + n + 4); j++) {
        for (let i = Math.max(1, ci - n - 3); i < Math.min(CELLS - 1, ci + n + 4); i++) {
          const k = j * CELLS + i;
          for (const kk of [k + 1, k - 1, k + CELLS, k - CELLS]) {
            const diff = H[k] - H[kk] - CELL * REPOSE;
            if (diff > 0) { H[k] -= diff / 2; H[kk] += diff / 2; }
          }
        }
      }
    }
  }

  const pieceMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.05 });
  const pileGroup = new THREE.Group(); g.add(pileGroup);
  const total = { pieces: 0, kg: 0 };
  const seen = new Set();
  let lastAt = 0;

  // rebuild an old drop straight into the heap (no animation), merged into one mesh
  function settleDrop(d) {
    const rng = mulberry32(hashString(d.id));
    const cx = (rng() - 0.5) * PILE_R * 0.5, cz = (rng() - 0.5) * PILE_R * 0.5;
    const geos = [];
    for (const pc of d.pieces) {
      const pg = pieceGeometry(pc, SCALE);
      if (!pg) continue;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (6 + Math.sqrt(d.pieces.length) * 2.5);
      const x = THREE.MathUtils.clamp(cx + Math.cos(a) * r, -PILE_R * 0.9, PILE_R * 0.9), z = THREE.MathUtils.clamp(cz + Math.sin(a) * r, -PILE_R * 0.9, PILE_R * 0.9);
      const y = heightAt(x, z) + pg.half * 0.7;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.3, rng() * 6.3, rng() * 6.3)), new THREE.Vector3(1, 1, 1));
      geos.push(pg.geo.applyMatrix4(m));
      deposit(x, z, pg.volume, pg.radius);
    }
    addMerged(geos);
    note(d);
    logHeap(d);
    maybeCompact(false);
  }
  function addMerged(geos) {
    if (!geos.length) return;
    const merged = mergeGeometries(geos.map((x) => x.toNonIndexed ? (x.index ? x.toNonIndexed() : x) : x));
    geos.forEach((x) => x.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, pieceMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    pileGroup.add(mesh);
  }
  function note(d) {
    total.pieces += d.pieces.length; total.kg += d.object.mass || 0;
    log.unshift(d); if (log.length > 20) log.pop();
  }

  // ---- the compactor: when the heap gets tall, a giant press squashes it into a bale and the
  // bale is stacked in the brick yard beside the pile. Replayed in drop order on load, so everyone
  // sees the same bales (for the drops the mailbox still remembers).
  const bales = [];
  const baleGroup = new THREE.Group(); g.add(baleGroup);
  const colTop = [0, 0, 0, 0];
  const BALE_COLS = [[PILE_R + 34, -22], [PILE_R + 34, 22], [PILE_R + 78, -22], [PILE_R + 78, 22]];
  let heapLog = { pieces: 0, kg: 0, colors: [], drops: 0 };
  function heapMax() { let m = 0; for (let i = 0; i < H.length; i++) if (H[i] > m) m = H[i]; return m; }
  function heapVolume() { let v = 0; for (let i = 0; i < H.length; i++) v += H[i]; return v * CELL * CELL; }
  function baleTexture(colors, n) {
    return canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#2a2622'; c.fillRect(0, 0, w, h);
      const cols = colors.length ? colors : ['#888888', '#aa8866', '#666666'];
      const rnd = mulberry32(n * 7919 + 13);
      for (let i = 0; i < 420; i++) {
        c.fillStyle = cols[Math.floor(rnd() * cols.length)];
        c.globalAlpha = 0.55 + rnd() * 0.45;
        const x = rnd() * w, y = rnd() * h, bw = 6 + rnd() * 30, bh = 3 + rnd() * 10;
        c.save(); c.translate(x, y); c.rotate((rnd() - 0.5) * 0.7); c.fillRect(-bw / 2, -bh / 2, bw, bh); c.restore();
      }
      c.globalAlpha = 1; c.fillStyle = '#15171a';
      for (const y of [0.3, 0.7]) c.fillRect(0, h * y - 4, w, 8);          // steel straps
      c.fillStyle = '#f2b311'; c.fillRect(w - 92, h - 40, 84, 30);
      c.fillStyle = '#111'; c.font = '900 20px Impact, sans-serif'; c.fillText(`BALE ${n}`, w - 86, h - 18);
    });
  }
  function addBale(info, from) {
    const n = bales.length + 1;
    const side = THREE.MathUtils.clamp(Math.cbrt(info.volume * BALE_SQUASH), 6, 40);
    const col = (n - 1) % 4;
    const [bx, bz] = BALE_COLS[col];
    const y = colTop[col] + side / 2;
    colTop[col] += side;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(side, side, side), new THREE.MeshStandardMaterial({ map: baleTexture(info.colors, n), roughness: 0.85, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.rotation.y = (mulberry32(n)() - 0.5) * 0.25;
    baleGroup.add(mesh);
    const target = new THREE.Vector3(bx, y, bz);
    if (from) { mesh.position.copy(from); baleMoves.push({ mesh, from: from.clone(), to: target, t: 0 }); }
    else mesh.position.copy(target);
    bales.push({ n, side, ...info });
    return mesh;
  }
  function clearHeap() {
    H.fill(0);
    for (const m of [...pileGroup.children]) { if (falling.some((p) => p.mesh === m)) continue; pileGroup.remove(m); m.geometry.dispose(); }
    pileGroup.scale.y = 1;
  }
  function takeHeap() {
    const info = { volume: heapVolume(), pieces: heapLog.pieces, kg: heapLog.kg, colors: heapLog.colors.slice(0, 8), drops: heapLog.drops };
    heapLog = { pieces: 0, kg: 0, colors: [], drops: 0 };
    return info;
  }
  function logHeap(d) {
    heapLog.pieces += d.pieces.length; heapLog.kg += d.object?.mass || 0; heapLog.drops++;
    for (const c of d.colors || []) if (!heapLog.colors.includes(c)) heapLog.colors.push(c);
  }
  // the press, built once, shown while it works
  const press = new THREE.Group(); press.visible = false; g.add(press);
  const pressMat = new THREE.MeshStandardMaterial({ map: canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#f2b311'; c.fillRect(0, 0, w, h); c.fillStyle = '#16161a';
    for (let i = -h; i < w; i += 48) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 24, 0); c.lineTo(i + 24 + h, h); c.lineTo(i + h, h); c.fill(); }
  }), roughness: 0.5, metalness: 0.4 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(PILE_R * 1.9, 5, PILE_R * 1.9), pressMat);
  plate.castShadow = true; press.add(plate);
  const rodMat = new THREE.MeshStandardMaterial({ color: 0xd6dbe0, metalness: 0.9, roughness: 0.25 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 300, 16), rodMat);
    rod.position.set(x * PILE_R * 0.7, 152.5, z * PILE_R * 0.7); press.add(rod);
  }
  const baleMoves = [];
  let compacting = null;   // { t, top }
  function maybeCompact(animate) {
    if (compacting || heapMax() < COMPACT_AT) return;
    if (!animate) { const info = takeHeap(); clearHeap(); addBale(info); return; }
    compacting = { t: 0, top: heapMax() };
    press.visible = true; press.position.y = compacting.top + 90;
  }
  function stepCompactor(dt) {
    for (let i = baleMoves.length - 1; i >= 0; i--) {
      const m = baleMoves[i]; m.t = Math.min(1, m.t + dt / 2.5);
      const e = m.t * m.t * (3 - 2 * m.t);
      m.mesh.position.lerpVectors(m.from, m.to, e); m.mesh.position.y += Math.sin(e * Math.PI) * 25;
      if (m.t >= 1) baleMoves.splice(i, 1);
    }
    if (!compacting) return;
    const C = compacting; C.t += dt;
    const top = C.top;
    if (C.t < 2.6) {                                   // down it comes
      const k = C.t / 2.6, y = (top + 90) * (1 - k * k) + 2.5 * k * k;
      press.position.y = y;
      pileGroup.scale.y = THREE.MathUtils.clamp((y - 2.5) / top, 0.08, 1);
    } else if (!C.done) {                              // CRUNCH: the heap becomes a bale
      C.done = true;
      const info = takeHeap(); clearHeap();
      C.bale = addBale(info, new THREE.Vector3(0, 0, 0));
      C.bale.position.y = C.bale.geometry.parameters.height / 2;
      baleMoves.pop();                                 // it waits under the press first
      C.baleFrom = C.bale.position.clone();
      for (let k = 0; k < 140; k++) { const a = Math.random() * 6.283, r = Math.random() * PILE_R * 0.8; emitP(Math.cos(a) * r, 2, Math.sin(a) * r, Math.cos(a) * 14, 6 + Math.random() * 10, Math.sin(a) * 14, '#8a7a68', 2 + Math.random() * 2); }
      drawBoard();
    } else if (C.t < 5) {                              // and up it goes
      const k = (C.t - 3) / 2;
      if (k > 0) press.position.y = 2.5 + k * k * (top + 120);
    } else {
      press.visible = false;
      const b = bales[bales.length - 1], col = (b.n - 1) % 4, [bx, bz] = BALE_COLS[col];
      baleMoves.push({ mesh: C.bale, from: C.baleFrom, to: new THREE.Vector3(bx, colTop[col] - b.side / 2, bz), t: 0 });
      compacting = null;
    }
  }

  // ---- arrivals: pieces fall out of the portal
  const falling = [];     // { mesh, vel, spin, axis, half, radius, volume, drop }
  const arriving = [];    // queued pieces still to emerge, spaced out a little
  const pending = new Map(); // drop id -> { geos, left }
  function arrive(d) {
    note(d);
    logHeap(d);
    drawBoard();
    uniforms.uPulse.value = 1.5;
    const rng = mulberry32(hashString(d.id));
    pending.set(d.id, { geos: [], left: 0 });
    d.pieces.forEach((pc, k) => arriving.push({ pc, d, at: k * 0.04 + rng() * 0.3, rng }));
    burst(d.colors?.length ? d.colors : ['#ffffff'], 160);
  }
  let emergeClock = 0;
  function emerge(dt) {
    emergeClock += dt;
    while (arriving.length && arriving[0].at <= emergeClock) {
      const { pc, d, rng } = arriving.shift();
      const pg = pieceGeometry(pc, SCALE);
      if (!pg) continue;
      const mesh = new THREE.Mesh(pg.geo, pieceMat);
      mesh.castShadow = true;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * PORTAL_R * 0.55;
      mesh.position.set(Math.cos(a) * r, PORTAL_ALT - 2, Math.sin(a) * r);
      if (pc.q) mesh.quaternion.set(pc.q[0], pc.q[1], pc.q[2], pc.q[3]).normalize();
      pileGroup.add(mesh);
      const v = pc.v || [0, -10, 0];
      // keep its exit velocity (down, plus the vortex's swirl), slightly exaggerated
      const vel = new THREE.Vector3(v[0] * 1.5 - Math.sin(a) * 8, Math.min(-4, v[1] * 1.2), v[2] * 1.5 + Math.cos(a) * 8);
      falling.push({ mesh, vel, axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), spin: 1 + rng() * 5, half: pg.half, radius: pg.radius, volume: pg.volume, drop: d.id });
      pending.get(d.id).left++;
    }
    if (!arriving.length) emergeClock = 0;
  }
  function fall(dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const p = falling[i], m = p.mesh;
      p.vel.y -= GRAV * dt;
      p.vel.multiplyScalar(Math.exp(-0.15 * dt));
      m.position.addScaledVector(p.vel, dt);
      m.rotateOnAxis(p.axis, p.spin * dt);
      // keep it over the yard
      const rr = Math.hypot(m.position.x, m.position.z);
      if (rr > PILE_R * 0.92) { m.position.x *= PILE_R * 0.92 / rr; m.position.z *= PILE_R * 0.92 / rr; p.vel.x *= -0.3; p.vel.z *= -0.3; }
      const floor = heightAt(m.position.x, m.position.z) + p.half * 0.7;
      if (m.position.y <= floor) {
        if (p.vel.y < -14 && !p.bounced) { // one tumbling bounce, then it stays
          p.bounced = true; m.position.y = floor; p.vel.y *= -0.25; p.vel.x *= 0.5; p.vel.z *= 0.5; p.spin *= 0.6;
          puff(m.position, 10);
          continue;
        }
        m.position.y = floor;
        deposit(m.position.x, m.position.z, p.volume, p.radius);
        falling.splice(i, 1);
        const pend = pending.get(p.drop);
        m.updateMatrix();
        pend.geos.push(m.geometry.clone().applyMatrix4(m.matrix));
        pileGroup.remove(m); m.geometry.dispose();
        if (--pend.left <= 0 && !arriving.some((a) => a.d.id === p.drop)) { addMerged(pend.geos); pending.delete(p.drop); maybeCompact(true); }
      }
    }
  }

  // ---- a little confetti out of the portal, and dust where things land
  const NP = 1200;
  const pPos = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pLife = new Float32Array(NP);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  points.frustumCulled = false;
  g.add(points);
  let pNext = 0;
  function emitP(x, y, z, vx, vy, vz, color, life) {
    const i = pNext; pNext = (pNext + 1) % NP;
    pPos.set([x, y, z], i * 3); pVel.set([vx, vy, vz], i * 3); pLife[i] = life;
    const c = new THREE.Color(color); pCol.set([c.r, c.g, c.b], i * 3);
  }
  function burst(colors, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, r = Math.random() * PORTAL_R * 0.8;
      emitP(Math.cos(a) * r, PORTAL_ALT - 1, Math.sin(a) * r, -Math.sin(a) * 6 + (Math.random() - 0.5) * 4, -Math.random() * 6, Math.cos(a) * 6 + (Math.random() - 0.5) * 4, colors[k % colors.length], 9 + Math.random() * 5);
    }
  }
  function puff(p, n) {
    for (let k = 0; k < n; k++) emitP(p.x, p.y, p.z, (Math.random() - 0.5) * 10, Math.random() * 7, (Math.random() - 0.5) * 10, '#8a7a68', 1.5 + Math.random());
  }
  function stepParticles(dt) {
    for (let i = 0; i < NP; i++) {
      if (pLife[i] <= 0) { pPos[i * 3 + 1] = -1e4; continue; }
      pLife[i] -= dt;
      pVel[i * 3 + 1] -= 3 * dt;
      for (let k = 0; k < 3; k++) { pVel[i * 3 + k] *= Math.exp(-0.6 * dt); pPos[i * 3 + k] += pVel[i * 3 + k] * dt; }
      const fl = heightAt(pPos[i * 3], pPos[i * 3 + 2]) + 0.4;
      if (pPos[i * 3 + 1] < fl) { pPos[i * 3 + 1] = fl; pVel[i * 3] = pVel[i * 3 + 1] = pVel[i * 3 + 2] = 0; }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // ---- the mailbox
  const sources = () => {
    const list = ['./api/shred/drops'];
    let relay = rec.relay || '';
    try {
      const q = new URLSearchParams(location.search).get('shredRelay');
      if (q) localStorage.setItem('shredRelay', q);
      relay = localStorage.getItem('shredRelay') || relay;
    } catch { /* storage blocked */ }
    if (relay) list.push(relay.replace(/\/$/, ''));
    return list;
  };
  let pollClock = POLL, pollEvery = POLL, first = true, busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    const got = [];
    await Promise.all(sources().map(async (url) => {
      try {
        const r = await fetch(`${url}?since=${first ? 0 : lastAt}`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (Array.isArray(j.drops)) got.push(...j.drops);
      } catch { /* that mailbox isn't reachable from here */ }
    }));
    got.sort((a, b) => a.at - b.at);
    let fresh = 0;
    for (const d of got) {
      const key = d.id || `${d.at}:${d.object?.name}`;
      if (seen.has(key) || !Array.isArray(d.pieces)) continue;
      seen.add(key);
      lastAt = Math.max(lastAt, d.at || 0);
      fresh++;
      if (first) settleDrop(d); else arrive(d);
    }
    if (!first) {
      const was = pollEvery;
      pollEvery = fresh ? POLL : Math.min(POLL_MAX, pollEvery * 1.5);
      if ((was >= 30) !== (pollEvery >= 30)) drawBoard();
    }
    if (first) drawBoard();
    first = false;
    busy = false;
  }

  drawBoard();
  let t = 0;
  site.userData.update = (dt) => {
    dt = Math.min(dt, 0.1);
    t += dt;
    uniforms.uTime.value = t;
    uniforms.uPulse.value *= Math.exp(-1.5 * dt);
    runes.rotation.y = t * 0.25;
    runes.children.forEach((m, i) => { m.rotation.x = t + i; m.position.y = Math.sin(t * 1.3 + i) * 3; });
    rimMat.emissiveIntensity = 1.4 + 0.4 * Math.sin(t * 2) + uniforms.uPulse.value;
    light.intensity = 3 + 2 * uniforms.uPulse.value;
    beam.material.opacity = 0.04 + 0.05 * uniforms.uPulse.value;
    // only check the mailbox when someone is within sight of the pile (or it has never been read)
    pollClock += dt;
    if (pollClock >= pollEvery && !document.hidden) { pollClock = 0; poll(); }
    if (arriving.length) emerge(dt);
    if (falling.length) fall(dt);
    stepCompactor(dt);
    stepParticles(dt);
  };

  site.userData.labelPos = new THREE.Vector3(0, PORTAL_ALT + 40, 0);
  site.userData.labelRange = 7000;
  const toWorld = (v) => v.clone().applyMatrix4(g.matrixWorld);
  site.userData.shredPile = {
    site, center: site.position.clone(),
    stats: total,
    bales,
    compactNow: () => { if (heapMax() > 1) { compacting = { t: 0, top: Math.max(heapMax(), 8) }; press.visible = true; press.position.y = compacting.top + 90; } },
    view() {
      const pos = toWorld(new THREE.Vector3(-40, 70, -175));          // the heap and the brick yard
      return { pos, look: toWorld(new THREE.Vector3(40, 14, 0)).sub(pos).normalize() };
    },
    // for testing from the console: worldbuilder.structure('shred-pile').userData.shredPile.arrive(drop)
    arrive,
  };
  return site;
}
