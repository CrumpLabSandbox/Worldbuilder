// The Super Mushroom Tree: a colossal fungal tree with a fluted, twisting stem,
// buttress roots, branches ending in their own caps, bracket shelves spiralling
// up the trunk, a vast spotted canopy with glowing gills, swaying
// bioluminescent tendrils, drifting spores and a fairy ring at its feet.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';

const C = (h) => new THREE.Color(h);

// Vertex-coloured physical material; the per-vertex `aGlow` makes parts emit
// their own colour. Optional sway (for tendrils) via `aSway`/`aPhase`.
function glowMat({ rough = 0.45, clearcoat = 0.6, glow = 1.4, sway = false, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: rough, clearcoat, clearcoatRoughness: 0.3, side });
  const u = { uTime: { value: 0 }, uGlowK: { value: glow } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = `uniform float uTime; attribute float aGlow; varying float vGlow;${sway ? ' attribute float aSway; attribute float aPhase;' : ''}\n` +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  vGlow = aGlow;${sway ? '\n  transformed.x += sin(uTime * 0.7 + aPhase) * aSway * 0.07;\n  transformed.z += cos(uTime * 0.55 + aPhase * 1.3) * aSway * 0.07;' : ''}`);
    sh.fragmentShader = 'uniform float uGlowK; varying float vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor * vGlow * uGlowK;');
  };
  return m;
}
function withAttrs(geo, color, glow = 0) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3), g = new Float32Array(n);
  const cc = C(color);
  for (let i = 0; i < n; i++) { c.set([cc.r, cc.g, cc.b], i * 3); g[i] = glow; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(g, 1));
  return geo;
}

// Tube along a curve with radius r(t, theta) and colour/glow per vertex.
function sculptTube(curve, segs, radial, radiusFn, paintFn, { capEnd = true } = {}) {
  const frames = curve.computeFrenetFrames(segs, false);
  const N = (segs + 1) * (radial + 1);
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), glow = new Float32Array(N), uv = new Float32Array(N * 2);
  const p = new THREE.Vector3(), v = new THREE.Vector3(), out = { c: new THREE.Color(), g: 0 };
  let k = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const nrm = frames.normals[i], bin = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const r = radiusFn(t, th);
      v.copy(nrm).multiplyScalar(Math.cos(th)).addScaledVector(bin, Math.sin(th));
      pos.set([p.x + v.x * r, p.y + v.y * r, p.z + v.z * r], k * 3);
      paintFn(t, th, out);
      col.set([out.c.r, out.c.g, out.c.b], k * 3); glow[k] = out.g; uv.set([j / radial, t], k * 2);
      k++;
    }
  }
  const idx = [];
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (capEnd) {
    const end = curve.getPointAt(1), rr = radiusFn(1, 0);
    const cap = withAttrs(new THREE.SphereGeometry(rr, radial, 8).translate(end.x, end.y, end.z), '#000000', 0);
    paintFn(1, 0, out);
    const cc = cap.attributes.color; for (let i = 0; i < cc.count; i++) cc.setXYZ(i, out.c.r, out.c.g, out.c.b);
    const parts = [g.toNonIndexed(), cap.toNonIndexed()];
    for (const x of parts) x.deleteAttribute('normal');
    const merged = mergeGeometries(parts);
    merged.computeVertexNormals();
    return merged;
  }
  return g;
}

// A mushroom cap whose stem joins at the origin; dome up, gills below.
function mushroomCap(Rc, pal, rng, opts = {}) {
  const grp = new THREE.Group();
  const h = Rc * (opts.dome ?? 0.24);
  const rs = Rc * 0.1;
  const top = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N, r = Rc * t;
    let y = h * (1 - Math.pow(t, 2.3));
    y -= h * 0.45 * Math.pow(Math.max(0, (t - 0.8) / 0.2), 2); // rim curls under
    top.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const under = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; const r = Rc * 0.985 - (Rc * 0.985 - rs) * t; under.push(new THREE.Vector2(r, -h * 0.45 + h * 0.4 * t - h * 0.06 * Math.sin(t * Math.PI))); }
  const seg = opts.segments ?? 160;
  const topGeo = new THREE.LatheGeometry(top.map((p) => p).reverse(), seg);
  const tp = topGeo.attributes.position, tc = new Float32Array(tp.count * 3), tg = new Float32Array(tp.count);
  const cc = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const r = Math.hypot(tp.getX(i), tp.getZ(i)) / Rc, a = Math.atan2(tp.getZ(i), tp.getX(i));
    const band = r + 0.025 * Math.sin(a * 9) ;
    if (band < 0.45) cc.copy(C(pal.top[0])).lerp(C(pal.top[1]), band / 0.45);
    else cc.copy(C(pal.top[1])).lerp(C(pal.top[2]), Math.min(1, (band - 0.45) / 0.5));
    cc.multiplyScalar(0.92 + 0.12 * Math.sin(a * 23 + r * 40));
    tc.set([cc.r, cc.g, cc.b], i * 3); tg[i] = 0.06 + (r > 0.94 ? 0.5 : 0);
  }
  topGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3)); topGeo.setAttribute('aGlow', new THREE.BufferAttribute(tg, 1));
  topGeo.computeVertexNormals();
  const underGeo = new THREE.LatheGeometry(under, seg);
  const up = underGeo.attributes.position, uc = new Float32Array(up.count * 3), ug = new Float32Array(up.count);
  for (let i = 0; i < up.count; i++) {
    const r = Math.hypot(up.getX(i), up.getZ(i)) / Rc, a = Math.atan2(up.getZ(i), up.getX(i));
    const stripe = Math.pow(0.5 + 0.5 * Math.cos(a * (opts.gills ?? 220)), 6);
    cc.copy(C(pal.under)).lerp(C(pal.gill), stripe * 0.8);
    uc.set([cc.r, cc.g, cc.b], i * 3); ug[i] = 0.15 + stripe * 1.2 * (0.4 + r * 0.6);
  }
  underGeo.setAttribute('color', new THREE.BufferAttribute(uc, 3)); underGeo.setAttribute('aGlow', new THREE.BufferAttribute(ug, 1));
  underGeo.computeVertexNormals();
  const capMat = glowMat({ rough: 0.35, clearcoat: 0.8, glow: 1 });
  const underMat = glowMat({ rough: 0.7, clearcoat: 0, glow: 1.3, side: THREE.DoubleSide });
  const topM = new THREE.Mesh(topGeo, capMat), underM = new THREE.Mesh(underGeo, underMat);
  grp.add(topM, underM);
  // gill fins hanging below the cap
  const fins = [];
  const nf = opts.fins ?? 120;
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * Math.PI * 2;
    const r0 = rs * 1.4, r1 = Rc * 0.93;
    const f = new THREE.PlaneGeometry(r1 - r0, h * 0.12).translate((r0 + r1) / 2, -h * 0.12, 0).rotateY(-a);
    fins.push(withAttrs(f, pal.gill, 1));
  }
  const finM = new THREE.Mesh(mergeGeometries(fins), glowMat({ rough: 0.6, clearcoat: 0, glow: 1.1, side: THREE.DoubleSide }));
  grp.add(finM);
  // glowing rim
  const rim = new THREE.Mesh(withAttrs(new THREE.TorusGeometry(Rc * 0.985, Rc * 0.012, 10, seg).rotateX(Math.PI / 2).translate(0, -h * 0.43, 0), pal.rim, 2.2), glowMat({ glow: 1.2 }));
  grp.add(rim);
  // raised spots on the dome
  const spots = [];
  const ns = opts.spots ?? 60;
  for (let i = 0; i < ns; i++) {
    const t = Math.sqrt(rng()) * 0.86, a = rng() * Math.PI * 2;
    const r = Rc * t;
    const y = h * (1 - Math.pow(t, 2.3));
    const dy = -h * 2.3 * Math.pow(t, 1.3) / Rc; // slope dy/dr
    const nrm = new THREE.Vector3(-dy * Math.cos(a), 1, -dy * Math.sin(a)).normalize();
    const s = Rc * (0.025 + rng() * 0.05) * (1 - t * 0.4);
    const geo = new THREE.SphereGeometry(1, 16, 10).scale(s, s * 0.32, s);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm));
    geo.translate(Math.cos(a) * r, y + s * 0.05, Math.sin(a) * r);
    spots.push(withAttrs(geo, pal.spot, pal.spotGlow ?? 0.8));
  }
  if (spots.length) grp.add(new THREE.Mesh(mergeGeometries(spots), glowMat({ rough: 0.3, clearcoat: 1, glow: 1 })));
  grp.userData.h = h;
  for (const m of [topM, underM]) { m.castShadow = true; m.receiveShadow = true; }
  return grp;
}

export function buildMushroomTree(rec, planet) {
  const rng = mulberry32(rec.seed ?? 4242);
  const H = rec.height ?? 320;
  const center = new THREE.Vector3();
  { const d = rec.lat * Math.PI / 180, l = rec.lon * Math.PI / 180; center.set(Math.cos(d) * Math.sin(l), Math.sin(d), Math.cos(d) * Math.cos(l)); }
  const base = planet.elevation(center);
  const group = new THREE.Group();
  group.position.copy(center).multiplyScalar(R + base);
  const fr = tangentFrame(center);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.east, fr.up, fr.north.clone().negate()));
  group.updateMatrixWorld(true);
  // terrain height (relative to the base) at a local x, z
  const groundAt = (x, z) => {
    const v = new THREE.Vector3(x, 0, z).applyMatrix4(group.matrixWorld).normalize();
    return planet.elevation(v) - base;
  };
  const glowing = [];

  // ---- stem: fluted, twisting, flaring at the foot, with glowing veins
  const lean = rec.lean ?? 0.05;
  const spine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -8, 0), new THREE.Vector3(H * 0.02, H * 0.22, -H * 0.015), new THREE.Vector3(-H * lean * 0.6, H * 0.5, H * 0.02),
    new THREE.Vector3(H * lean * 0.4, H * 0.75, -H * lean * 0.5), new THREE.Vector3(H * lean * 0.8, H * 0.93, -H * lean * 0.2),
  ], false, 'centripetal');
  const rb = H * 0.08, rt = H * 0.042;
  const stemR = (t, th) => {
    let r = rb + (rt - rb) * Math.pow(t, 0.6);
    r *= 1 + 1.15 * Math.exp(-t * 16);                                  // buttress flare
    const flute = Math.abs(Math.sin(th * 7 + t * Math.PI * 2.6));
    r *= 1 + 0.07 * flute + 0.025 * Math.sin(th * 23 - t * 40);          // twisting flutes
    return r;
  };
  const stemPaint = (t, th, out) => {
    const flute = Math.abs(Math.sin(th * 7 + t * Math.PI * 2.6));
    out.c.copy(C('#4a2a6a')).lerp(C('#e6dcff'), Math.min(1, 0.25 + t * 1.6)).lerp(C('#b7a2ef'), 0.4 * (1 - flute));
    const vein = Math.pow(Math.max(0, Math.sin(th * 3 - t * 26 + Math.sin(t * 9) * 1.5)), 40);
    if (vein > 0.05) out.c.lerp(C('#2ef5ff'), vein);
    out.g = vein * 1.6 + (t < 0.05 ? 0 : 0.03);
  };
  const stemGeo = sculptTube(spine, 220, 112, stemR, stemPaint, { capEnd: false });
  const stemMat = glowMat({ rough: 0.55, clearcoat: 0.35, glow: 1.2 });
  const stem = new THREE.Mesh(stemGeo, stemMat); stem.castShadow = stem.receiveShadow = true;
  group.add(stem); glowing.push(stemMat);
  const rootMat = glowMat({ rough: 0.6, clearcoat: 0.2, glow: 1.2 });
  // ---- buttress roots
  const roots = [];
  const nr = rec.roots ?? 11;
  for (let i = 0; i < nr; i++) {
    const a = (i / nr) * Math.PI * 2 + rng() * 0.3;
    const len = H * (0.18 + rng() * 0.12);
    const dx = Math.cos(a), dz = Math.sin(a);
    const p0 = new THREE.Vector3(dx * rb * 1.2, 10 + rng() * 10, dz * rb * 1.2);
    const p3x = dx * len, p3z = dz * len;
    const pts = [p0, new THREE.Vector3(dx * len * 0.35, 12 + rng() * 6, dz * len * 0.35), new THREE.Vector3(dx * len * 0.7 + dz * len * 0.08, groundAt(dx * len * 0.7, dz * len * 0.7) + 3, dz * len * 0.7 - dx * len * 0.08), new THREE.Vector3(p3x, groundAt(p3x, p3z) - 5, p3z)];
    const curve = new THREE.CatmullRomCurve3(pts);
    const r0 = rb * (0.32 + rng() * 0.12);
    roots.push(sculptTube(curve, 64, 28, (t) => r0 * (1 - t * 0.85) + 0.8, (t, th, out) => {
      out.c.copy(C('#3a2050')).lerp(C('#8a6ab8'), 0.3 + 0.3 * Math.sin(th * 5 + t * 8));
      const v = Math.pow(Math.max(0, Math.sin(th * 2 + t * 30)), 50); out.c.lerp(C('#2ef5ff'), v); out.g = v * 1.5;
    }));
  }
  const rootsM = new THREE.Mesh(mergeGeometries(roots), rootMat); rootsM.castShadow = rootsM.receiveShadow = true;
  group.add(rootsM); glowing.push(rootMat);

  // ---- branches ending in their own caps
  const palettes = [
    { top: ['#ff9d00', '#ff6a00', '#ffd23a'], under: '#3a1400', gill: '#ffe680', rim: '#fff3a0', spot: '#fff8d0' },
    { top: ['#4dff3a', '#9bff3a', '#e0ff8a'], under: '#0b2a10', gill: '#b6ff1a', rim: '#d6ff7a', spot: '#ffffff' },
    { top: ['#00b3ff', '#19e3ff', '#b5fbff'], under: '#04203a', gill: '#7df9ff', rim: '#ffffff', spot: '#ffffff' },
    { top: ['#7a2cff', '#9b5cff', '#e0b3ff'], under: '#16052e', gill: '#ff7ad9', rim: '#ff7ad9', spot: '#fff3a0' },
    { top: ['#b0000a', '#e8191e', '#ff4a3a'], under: '#f2e6d8', gill: '#fff5e8', rim: '#ffffff', spot: '#ffffff', spotGlow: 0.35 }, // classic toadstool
    { top: ['#ff2ea6', '#ff6ad5', '#ffd0f0'], under: '#2a0420', gill: '#2ef5ff', rim: '#2ef5ff', spot: '#ffffff' },
    { top: ['#00d48a', '#19f0b0', '#c0ffe8'], under: '#022a1e', gill: '#7dff3a', rim: '#ffe600', spot: '#ffe600' },
  ];
  const branches = [];
  const nb = rec.branches ?? 7;
  const caps = [];
  for (let i = 0; i < nb; i++) {
    const t = 0.3 + (i / (nb - 1)) * 0.42 + (rng() - 0.5) * 0.04;
    const a = i * 2.39996 + rng() * 0.3; // golden angle
    const sp = spine.getPointAt(t);
    const dx = Math.cos(a), dz = Math.sin(a);
    const reach = H * (0.2 + rng() * 0.14) * (1 - (t - 0.3) * 0.6);
    const rise = H * (0.06 + rng() * 0.08);
    const end = new THREE.Vector3(sp.x + dx * reach, Math.min(sp.y + rise, H * 0.74), sp.z + dz * reach);
    const curve = new THREE.CatmullRomCurve3([
      sp.clone().add(new THREE.Vector3(dx * rt * 0.4, -H * 0.02, dz * rt * 0.4)),
      new THREE.Vector3(sp.x + dx * reach * 0.4, sp.y + rise * 0.05, sp.z + dz * reach * 0.4),
      new THREE.Vector3(sp.x + dx * reach * 0.8, sp.y + rise * 0.55, sp.z + dz * reach * 0.8),
      end,
    ]);
    const br0 = rt * (0.55 + rng() * 0.2);
    branches.push(sculptTube(curve, 72, 40, (tt, th) => (br0 * (1 - tt * 0.6) + 1) * (1 + 0.06 * Math.abs(Math.sin(th * 5 + tt * 9))), stemPaint));
    const pal = palettes[i % palettes.length];
    const cap = mushroomCap(H * (0.07 + rng() * 0.06), pal, rng, { segments: 128, fins: 72, spots: pal.spotGlow ? 28 : 18, dome: 0.3 + rng() * 0.12 });
    cap.position.copy(end);
    cap.rotation.y = rng() * 6;
    group.add(cap); caps.push(cap);
  }
  const branchM = new THREE.Mesh(mergeGeometries(branches), stemMat); branchM.castShadow = branchM.receiveShadow = true;
  group.add(branchM);

  // ---- bracket shelves spiralling up the stem
  const shelves = [];
  for (let i = 0; i < (rec.shelves ?? 26); i++) {
    const t = 0.08 + (i / 26) * 0.6;
    const a = i * 1.1 + rng() * 0.4;
    const sp = spine.getPointAt(t);
    const rr = stemR(t, a) * 0.92;
    const s = H * (0.018 + rng() * 0.025);
    const prof = [];
    for (let k = 0; k <= 10; k++) { const q = k / 10; prof.push(new THREE.Vector2(Math.max(0.01, s * q), s * 0.32 * (1 - q * q) - s * 0.05 * q)); }
    const g = new THREE.LatheGeometry(prof.reverse(), 24, -Math.PI / 2, Math.PI);
    const p = g.attributes.position, c = new Float32Array(p.count * 3), gl = new Float32Array(p.count);
    const ca = C(['#ff7a1a', '#19e3ff', '#ffe600', '#ff2ea6', '#7dff3a'][i % 5]), cb = C('#2a0a3a');
    for (let k = 0; k < p.count; k++) { const q = Math.hypot(p.getX(k), p.getZ(k)) / s; const band = 0.5 + 0.5 * Math.sin(q * 18); const cc = cb.clone().lerp(ca, 0.35 + 0.65 * band * q); c.set([cc.r, cc.g, cc.b], k * 3); gl[k] = q > 0.92 ? 1.4 : band * q * 0.35; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
    g.rotateY(-a).translate(sp.x + Math.cos(a) * rr, sp.y, sp.z + Math.sin(a) * rr);
    shelves.push(g);
  }
  const shelfMat = glowMat({ rough: 0.4, clearcoat: 0.6, glow: 1, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(mergeGeometries(shelves), shelfMat));

  // ---- the great canopy
  const top = spine.getPointAt(1);
  const Rc = rec.capRadius ?? H * 0.5;
  const crown = mushroomCap(Rc, { top: ['#d1006a', '#ff3fa4', '#8f2cff'], under: '#14042e', gill: '#2ef5ff', rim: '#2ef5ff', spot: '#fff3a0', spotGlow: 1 }, rng, { segments: 256, fins: 240, spots: 90, gills: 300, dome: 0.27 });
  crown.position.copy(top); group.add(crown);

  // ---- bioluminescent tendrils hanging from the canopy and branch caps (sway in the shader)
  const tendrils = [];
  const addTendril = (x, y, z, len, color, phase) => {
    const pts = [];
    for (let k = 0; k <= 8; k++) { const q = k / 8; pts.push(new THREE.Vector3(x + Math.sin(q * 5 + phase) * len * 0.04, y - q * len, z + Math.cos(q * 4 + phase) * len * 0.04)); }
    const g = sculptTube(new THREE.CatmullRomCurve3(pts), 40, 6, (q) => 0.55 * (1 - q * 0.6) + 0.1, (q, th, out) => { out.c.set(color); out.g = 0.7 + q * 0.8; });
    const bulb = withAttrs(new THREE.SphereGeometry(1.6, 12, 10).translate(pts[8].x, pts[8].y, pts[8].z), color, 2.2);
    for (const gg of [g, bulb]) {
      const n = gg.attributes.position.count, sw = new Float32Array(n), ph = new Float32Array(n);
      for (let k = 0; k < n; k++) { sw[k] = Math.max(0, y - gg.attributes.position.getY(k)); ph[k] = phase; }
      gg.setAttribute('aSway', new THREE.BufferAttribute(sw, 1)); gg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      if (gg.index) tendrils.push(gg.toNonIndexed()); else tendrils.push(gg);
    }
  };
  const tcols = ['#2ef5ff', '#ff7ad9', '#b6ff1a', '#ffe600', '#9b5cff'];
  const ch = crown.userData.h;
  for (let i = 0; i < (rec.tendrils ?? 70); i++) {
    const a = rng() * Math.PI * 2, r = Rc * (0.35 + rng() * 0.6);
    addTendril(top.x + Math.cos(a) * r, top.y - ch * 0.35, top.z + Math.sin(a) * r, H * (0.08 + rng() * 0.22), tcols[i % tcols.length], rng() * 6.28);
  }
  for (const cap of caps) {
    for (let i = 0; i < 6; i++) { const a = rng() * 6.28, r = cap.userData.h * 2.4 * (0.5 + rng() * 0.5); addTendril(cap.position.x + Math.cos(a) * r, cap.position.y - cap.userData.h * 0.4, cap.position.z + Math.sin(a) * r, H * (0.03 + rng() * 0.06), tcols[(i + 2) % tcols.length], rng() * 6.28); }
  }
  for (const g of tendrils) if (g.attributes.normal) g.deleteAttribute('normal');
  for (const g of tendrils) { if (g.attributes.uv) g.deleteAttribute('uv'); }
  const tGeo = mergeGeometries(tendrils); tGeo.computeVertexNormals();
  const tMat = glowMat({ rough: 0.3, clearcoat: 0.5, glow: 1.2, sway: true });
  group.add(new THREE.Mesh(tGeo, tMat)); glowing.push(tMat);

  // ---- drifting spores
  const ns = rec.spores ?? 2600;
  const sp = new Float32Array(ns * 3), sc = new Float32Array(ns * 3), cc = new THREE.Color();
  for (let i = 0; i < ns; i++) {
    const a = rng() * Math.PI * 2, r = Rc * 1.25 * Math.sqrt(rng()), y = H * (0.15 + rng() * 1.0);
    sp.set([top.x + Math.cos(a) * r, y, top.z + Math.sin(a) * r], i * 3);
    cc.set(tcols[i % tcols.length]); sc.set([cc.r, cc.g, cc.b], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  // soft round glow sprite for each spore
  const sc2 = document.createElement('canvas'); sc2.width = sc2.height = 64;
  const sx = sc2.getContext('2d'); const gr = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  sx.fillStyle = gr; sx.fillRect(0, 0, 64, 64);
  const sporeTex = new THREE.CanvasTexture(sc2);
  const sporeMat = new THREE.PointsMaterial({ size: 3.2, map: sporeTex, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const su = { uTime: { value: 0 } };
  sporeMat.onBeforeCompile = (sh) => { sh.uniforms.uTime = su.uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y += mod(uTime * 2.0 + position.x * 0.37 + position.z * 0.21, 60.0) - 30.0;\n  transformed.x += sin(uTime * 0.3 + position.y * 0.05) * 6.0;'); };
  const spores = new THREE.Points(sg, sporeMat); spores.frustumCulled = false; group.add(spores);

  // ---- fairy ring of glowing mushrooms at the foot
  const small = [];
  for (let i = 0; i < (rec.ring ?? 46); i++) {
    const a = (i / 46) * Math.PI * 2 + rng() * 0.1, r = H * 0.33 + rng() * H * 0.06;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = groundAt(x, z) - 0.5;
    const s = 3 + rng() * 6, col = tcols[i % tcols.length];
    small.push(withAttrs(new THREE.CylinderGeometry(s * 0.08, s * 0.12, s * 0.7, 10).translate(x, y + s * 0.35, z), '#efe6ff', 0.1));
    small.push(withAttrs(new THREE.SphereGeometry(s * 0.42, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(x, y + s * 0.68, z), col, 1.2));
  }
  for (const g of small) { g.deleteAttribute('uv'); }
  group.add(new THREE.Mesh(mergeGeometries(small.map((g) => g.toNonIndexed())), glowMat({ glow: 1 })));

  // animate tendril sway and spores
  let clock = 0;
  group.userData.update = (dt) => {
    clock += dt;
    tMat.userData.u.uTime.value = clock;
    su.uTime.value = clock;
    spores.rotation.y += dt * 0.004;
  };
  group.userData.labelPos = new THREE.Vector3(top.x, H + 30, top.z);
  group.userData.labelRange = 9000;
  return group;
}
