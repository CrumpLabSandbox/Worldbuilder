// The Graffiti Garden: a plaza of concrete installations painted in classic
// graffiti styles: bubble throw-ups, wildstyle with arrows and spikes, chrome
// 3D blockbusters, crowns, spray cans, starbursts, a drippy alien eye, a
// monoline tag, and painted mural walls. Built lazily when you come near.
import * as THREE from 'three';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import optimerBold from 'three/examples/fonts/optimer_bold.typeface.json';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';
import { paint, chrome, outline, concreteMaterial, concreteTexture, muralTexture, envMap, ctx as paintCtx } from './graffitiPaint.js';

export const gardenCtx = { viewer: null, set renderer(r) { paintCtx.renderer = r; } };
let FONTS = null;
const fonts = () => FONTS || (FONTS = { helv: new Font(helvetikerBold), optimer: new Font(optimerBold) });

const WHITE_SHINE = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.2 });
const BLACK = 0x111111, WHITE = 0xf4f4f4;

// ---------------------------------------------------------------- helpers
function inside(pt, shapes) {
  const test = (poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  for (const s of shapes) {
    if (test(s.getPoints(6)) && !s.holes.some((h) => test(h.getPoints(6)))) return true;
  }
  return false;
}
// a point well inside the glyph, near its top-left
function shinePoint(shapes, bb, margin) {
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
  for (let fy = 0.12; fy < 0.6; fy += 0.04) for (let fx = 0.1; fx < 0.7; fx += 0.04) {
    const p = new THREE.Vector2(bb.min.x + w * fx, bb.max.y - h * fy);
    if ([[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dy]) => inside(new THREE.Vector2(p.x + dx, p.y + dy), shapes))) return p;
  }
  return null;
}
function addShine(mesh, p, z, size) {
  const dash = new THREE.Mesh(new THREE.CapsuleGeometry(size * 0.022, size * 0.12, 4, 10), WHITE_SHINE);
  dash.position.set(p.x, p.y - size * 0.02, z); dash.rotation.z = 0.25; dash.scale.z = 0.4;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.026, 10, 8), WHITE_SHINE);
  dot.position.set(p.x + size * 0.03, p.y - size * 0.15, z); dot.scale.z = 0.4;
  mesh.add(dash, dot);
}
function addDrips(mesh, geo, mat, size, rng, count, frontZ) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, pos = geo.attributes.position;
  const cands = [];
  for (let i = 0; i < pos.count; i += 3) { const y = pos.getY(i), z = pos.getZ(i); if (y < bb.min.y + size * 0.05 && z > frontZ) cands.push(i); }
  for (let k = 0; k < count && cands.length; k++) {
    const i = cands[Math.floor(rng() * cands.length)];
    const r = size * (0.022 + rng() * 0.022), len = size * (0.08 + rng() * 0.2);
    const d = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
    d.position.set(pos.getX(i), pos.getY(i) - len / 2 + r, pos.getZ(i) - r);
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r * 1.45, 14, 10), mat);
    blob.position.set(d.position.x, d.position.y - len / 2 - r * 0.6, d.position.z);
    mesh.add(d, blob);
  }
}
const piece = () => { const g = new THREE.Group(); g.userData.piece = true; return g; };
function plinth(w, h, d, seed, y = 0) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(0.8, h * 0.3)), concreteMaterial(seed % 4 + 11, { w: 1024, h: 1024, tagCount: 12, repeat: [Math.max(1, Math.round(w / 14)), 1] }));
  m.position.y = y - h / 2;
  return m;
}
function sparkleShape(r) {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 2; const rr = i % 2 ? r * 0.24 : r; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
  s.closePath();
  return s;
}
function sparkle(r, depth = 0.4) {
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sparkleShape(r), { depth, bevelEnabled: true, bevelThickness: r * 0.08, bevelSize: r * 0.06, bevelSegments: 3 }).center(), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.2 }));
  return m;
}

// ---------------------------------------------------------------- lettering
function glyphAdvance(font, ch, size) { const gl = font.data.glyphs[ch] || font.data.glyphs['?']; return gl.ha * size / font.data.resolution; }
// lay letters out by their real extents: each starts `overlap` before the last one ends
function spacer(overlap) {
  let cursor = 0, first = true;
  return {
    place(geo) { geo.computeBoundingBox(); const bb = geo.boundingBox; const x = first ? -bb.min.x : cursor - bb.min.x - overlap; first = false; cursor = x + bb.max.x; return x; },
    space(w) { cursor += w; },
    get width() { return cursor; },
  };
}

// Bubble throw-up: inflated letters, double outline, fade with dots, drips, shines.
function puffyWord(o) {
  const g = piece(); const rng = mulberry32(o.seed || 1); const font = o.font || fonts().helv;
  const size = o.size, depth = o.depth ?? size * 0.22, bevel = o.bevel ?? size * 0.085;
  const mat = paint({ stops: o.stops, yMin: -size * 0.1, yMax: size * 1.05, dots: o.dots, stripes: o.stripes, sharp: o.sharp ?? 0.25 });
  const sp = spacer(size * (o.overlap ?? 0.05)); const letters = [];
  [...o.text].forEach((ch, i) => {
    if (ch === ' ') { sp.space(size * 0.4); return; }
    const geo = new TextGeometry(ch, { font, size, depth, curveSegments: o.curve ?? 12, bevelEnabled: true, bevelThickness: bevel * 1.5, bevelSize: bevel, bevelSegments: o.bevelSeg ?? 6 });
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(sp.place(geo), size * (o.bounce ?? 0.05) * Math.sin(i * 1.7 + (o.seed || 0)) + bevel, (i % 2) * depth * 0.25);
    m.rotation.z = (rng() - 0.5) * (o.tilt ?? 0.12);
    m.castShadow = m.receiveShadow = true;
    outline(m, o.rings || [[WHITE, bevel * 0.9], [BLACK, bevel * 0.45]]);
    const shapes = font.generateShapes(ch, size);
    const spt = shinePoint(shapes, geo.boundingBox, size * 0.06);
    if (spt) addShine(m, spt, depth + bevel * 1.5 + 0.05, size);
    addDrips(m, geo, mat, size, rng, o.drips ?? 2, depth * 0.6);
    g.add(m); letters.push(m);
  });
  const cursor = sp.width;
  for (const m of letters) m.position.x -= cursor / 2;
  g.userData.size = { w: cursor, h: size * 1.15 };
  return g;
}

// Wildstyle: slanted, overlapping, sharp letters with arrows and spikes.
function arrowShape(p0, ang, len, bend, w) {
  const dir = new THREE.Vector2(Math.cos(ang), Math.sin(ang)), nrm = new THREE.Vector2(-dir.y, dir.x);
  const p2 = p0.clone().addScaledVector(dir, len), p1 = p0.clone().addScaledVector(dir, len * 0.5).addScaledVector(nrm, bend * len);
  const N = 18, left = [], right = [];
  let tangent = dir.clone();
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    const p = new THREE.Vector2(a * p0.x + b * p1.x + c * p2.x, a * p0.y + b * p1.y + c * p2.y);
    tangent = new THREE.Vector2(2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x), 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y)).normalize();
    const n = new THREE.Vector2(-tangent.y, tangent.x), ww = w * (1 - 0.35 * t);
    left.push(p.clone().addScaledVector(n, ww)); right.push(p.clone().addScaledVector(n, -ww));
  }
  const n = new THREE.Vector2(-tangent.y, tangent.x), end = new THREE.Vector2().addVectors(left[N], right[N]).multiplyScalar(0.5);
  const s = new THREE.Shape([...left, end.clone().addScaledVector(n, w * 1.9), end.clone().addScaledVector(tangent, w * 2.6), end.clone().addScaledVector(n, -w * 1.9), ...right.reverse()]);
  return s;
}
function wildWord(o) {
  const g = piece(); const rng = mulberry32(o.seed || 7); const font = o.font || fonts().helv;
  const size = o.size, depth = o.depth ?? size * 0.28;
  const face = paint({ stops: o.stops, yMin: -size * 0.15, yMax: size * 1.1, stripes: o.stripes, sharp: 0.18, wave: 1.6 });
  const side = paint({ stops: o.sideStops || ['#12002b', '#3a0a6a'], yMin: 0, yMax: size, sharp: 0.5, wave: 0 });
  const arrowMat = paint({ stops: o.arrowStops, yMin: -size * 0.3, yMax: size * 1.4, sharp: 0.2 });
  const shear = new THREE.Matrix4().set(1, o.slant ?? 0.32, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const sp = spacer(size * (o.overlap ?? 0.1)); const placed = [];
  [...o.text].forEach((ch, i) => {
    const sc = 0.88 + rng() * 0.3;
    const geo = new TextGeometry(ch, { font, size: size * sc, depth, curveSegments: 6, bevelEnabled: true, bevelThickness: size * 0.02, bevelSize: size * 0.015, bevelSegments: 2 });
    geo.applyMatrix4(shear); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, [face, side]);
    m.position.set(sp.place(geo), (rng() - 0.3) * size * 0.16, i % 2 ? depth * 0.35 : 0);
    m.rotation.z = (rng() - 0.5) * 0.3;
    m.castShadow = m.receiveShadow = true;
    outline(m, [[WHITE, size * 0.05], [BLACK, size * 0.025]]);
    g.add(m);
    const pts = font.generateShapes(ch, size * sc).flatMap((s) => s.getPoints(4)).map((p) => new THREE.Vector3(p.x + (o.slant ?? 0.32) * p.y, p.y, 0));
    placed.push({ m, pts });
  });
  const cursor = sp.width;
  for (const P of placed) P.m.position.x -= cursor / 2;
  g.updateMatrixWorld(true);
  // arrows sprout from extreme points of the outer letters, spikes from the middle ones
  const world = (P, p) => p.clone().applyMatrix4(P.m.matrix);
  const extreme = (P, fn) => P.pts.reduce((best, p) => (fn(world(P, p)) > fn(world(P, best)) ? p : best), P.pts[0]);
  const arrows = [];
  const first = placed[0], last = placed[placed.length - 1];
  arrows.push([world(first, extreme(first, (v) => -v.x + v.y * 0.6)), Math.PI * 0.85, size * 0.85, -0.35]);
  arrows.push([world(last, extreme(last, (v) => v.x + v.y * 0.5)), Math.PI * 0.18, size * 0.95, 0.3]);
  arrows.push([world(last, extreme(last, (v) => v.x - v.y)), -Math.PI * 0.15, size * 0.6, -0.4]);
  if (placed.length > 2) { const mid = placed[1]; arrows.push([world(mid, extreme(mid, (v) => v.y)), Math.PI * 0.62, size * 0.7, 0.4]); }
  for (const [p, ang, len, bend] of arrows) {
    const sh = arrowShape(new THREE.Vector2(p.x - Math.cos(ang) * size * 0.12, p.y - Math.sin(ang) * size * 0.12), ang, len, bend, size * 0.075);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: depth * 0.8, bevelEnabled: true, bevelThickness: size * 0.025, bevelSize: size * 0.02, bevelSegments: 3, curveSegments: 6 });
    const m = new THREE.Mesh(geo, arrowMat); m.position.z = depth * 0.1; m.castShadow = true;
    outline(m, [[WHITE, size * 0.045], [BLACK, size * 0.022]]);
    g.add(m);
  }
  // spikes ("kicks") off middle letters
  for (let k = 1; k < placed.length - 1; k++) {
    const P = placed[k];
    const pb = world(P, extreme(P, (v) => -v.y + v.x * 0.3));
    const tri = new THREE.Shape([new THREE.Vector2(pb.x - size * 0.08, pb.y + size * 0.1), new THREE.Vector2(pb.x + size * 0.1, pb.y + size * 0.06), new THREE.Vector2(pb.x + size * 0.02, pb.y - size * 0.3)]);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: depth * 0.7, bevelEnabled: false }), arrowMat); m.castShadow = true;
    outline(m, [[BLACK, size * 0.02]]);
    g.add(m);
  }
  g.userData.size = { w: cursor, h: size * 1.4 };
  return g;
}

// Chrome blockbuster: deep 3D letters, mirror faces, painted sides, glints.
function chromeWord(o) {
  const g = piece(); const rng = mulberry32(o.seed || 3); const font = o.font || fonts().helv;
  const size = o.size, depth = o.depth ?? size * 0.55;
  const face = chrome(o.tint ?? 0xeef3ff, 0.06);
  const side = paint({ stops: o.sideStops, yMin: 0, yMax: size, sharp: 0.3, metal: 0.3, rough: 0.25 });
  const sp = spacer(size * (o.overlap ?? -0.03)); const letters = [];
  [...o.text].forEach((ch, i) => {
    const geo = new TextGeometry(ch, { font, size, depth, curveSegments: 14, bevelEnabled: true, bevelThickness: size * 0.03, bevelSize: size * 0.025, bevelSegments: 4 });
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, [face, side]);
    m.position.set(sp.place(geo), Math.abs(Math.sin(i * 1.3)) * size * 0.06, 0);
    m.rotation.z = (rng() - 0.5) * 0.08;
    m.castShadow = m.receiveShadow = true;
    outline(m, [[BLACK, size * 0.022]]);
    g.add(m); letters.push(m);
    if (i % 2 === 0) { const st = sparkle(size * 0.09); st.position.set(geo.boundingBox.max.x * 0.8, size * 0.92, depth + size * 0.05); m.add(st); }
  });
  const cursor = sp.width;
  for (const m of letters) m.position.x -= cursor / 2;
  g.userData.size = { w: cursor, h: size * 1.1 };
  return g;
}

// ---------------------------------------------------------------- sculptures
function puffyShape(shape, depth, bevel, mat, rings) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel * 1.4, bevelSize: bevel, bevelSegments: 7, curveSegments: 24 });
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true;
  if (rings) outline(m, rings);
  return m;
}
function crown(h) {
  const g = piece();
  const s = new THREE.Shape();
  const w = h * 0.62;
  s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w * 1.05, h * 0.62); s.lineTo(w * 0.55, h * 0.3); s.lineTo(0, h * 0.82); s.lineTo(-w * 0.55, h * 0.3); s.lineTo(-w * 1.05, h * 0.62); s.closePath();
  const gold = paint({ stops: ['#a35400', '#ffb300', '#ffe680', '#fffbe0'], yMin: 0, yMax: h * 0.8, metal: 0.65, rough: 0.22, sharp: 0.35 });
  const m = puffyShape(s, h * 0.12, h * 0.05, gold, [[WHITE, h * 0.035], [BLACK, h * 0.018]]);
  m.position.z = -h * 0.06; g.add(m);
  const jewel = (x, y, r, c) => { const j = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.05, metalness: 0.1, clearcoat: 1, envMap: envMap(), transmission: 0 })); j.position.set(x, y, h * 0.12); j.castShadow = true; outline(j, [[BLACK, r * 0.12]]); g.add(j); };
  jewel(-w * 1.05, h * 0.68, h * 0.07, 0xff2ea6); jewel(0, h * 0.9, h * 0.09, 0x19e3ff); jewel(w * 1.05, h * 0.68, h * 0.07, 0xb6ff1a);
  for (const x of [-0.6, 0, 0.6]) jewel(x * w, h * 0.13, h * 0.045, 0xff3b3b);
  g.userData.size = { w: w * 2.3, h };
  return g;
}
function starburst(r, text) {
  const g = piece(); const rng = mulberry32(5);
  const s = new THREE.Shape(); const n = 14;
  for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2; const rr = i % 2 ? r * (0.6 + rng() * 0.08) : r * (0.92 + rng() * 0.16); const x = Math.cos(a) * rr, y = Math.sin(a) * rr + r; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
  s.closePath();
  const mat = paint({ stops: ['#ff6a00', '#ffb300', '#fff200'], yMin: 0, yMax: r * 2, sharp: 0.25, stripes: { spacing: 2.2, width: 0.25, from: 0.0, color: '#ffd400' } });
  g.add(puffyShape(s, r * 0.12, r * 0.05, mat, [[BLACK, r * 0.03]]));
  const word = puffyWord({ text, size: r * 0.62, depth: r * 0.1, bevel: r * 0.05, stops: ['#7a0018', '#ff1e3c', '#ff6b8a'], drips: 1, tilt: 0.2, bounce: 0.08, seed: 9 });
  word.position.set(0, r * 0.7, r * 0.22); word.rotation.z = 0.08; g.add(word);
  g.userData.size = { w: r * 2.2, h: r * 2.2 };
  return g;
}
function heart(sz) {
  const g = piece();
  const s = new THREE.Shape(); const k = sz / 10;
  s.moveTo(0, 0); s.bezierCurveTo(-1 * k, 2 * k, -10 * k, 6 * k, -9 * k, 11 * k); s.bezierCurveTo(-8 * k, 15 * k, -2 * k, 16 * k, 0, 12 * k);
  s.bezierCurveTo(2 * k, 16 * k, 8 * k, 15 * k, 9 * k, 11 * k); s.bezierCurveTo(10 * k, 6 * k, 1 * k, 2 * k, 0, 0);
  const mat = paint({ stops: ['#8a0040', '#ff1e6e', '#ff8fb8'], yMin: 0, yMax: 15 * k, dots: { spacing: 1.6, radius: 0.18, from: 0.62, color: '#ffffff' } });
  g.add(puffyShape(s, 2.4 * k, 1.1 * k, mat, [[WHITE, 0.8 * k], [BLACK, 0.4 * k]]));
  // arrow through it
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * k, 0.35 * k, 26 * k, 16), chrome(0xffd27a, 0.15));
  shaft.rotation.z = -1.0; shaft.position.set(0, 8 * k, 1.8 * k); shaft.castShadow = true; g.add(shaft);
  // shaft runs along (sin 1, cos 1) through (0, 8k): head at the upper right, fletching lower left
  const dir = new THREE.Vector2(Math.sin(1), Math.cos(1));
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.3 * k, 3.2 * k, 20), chrome(0xffd27a, 0.1));
  head.rotation.z = -1.0; head.position.set(dir.x * 14.6 * k, 8 * k + dir.y * 14.6 * k, 1.8 * k); head.castShadow = true;
  outline(head, [[BLACK, 0.2 * k]]);
  g.add(head);
  for (const d of [-1, 1]) {
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.25 * k, 2.8 * k, 1.4 * k), new THREE.MeshPhysicalMaterial({ color: 0x19e3ff, roughness: 0.3, clearcoat: 1 }));
    fl.rotation.z = -1.0; fl.rotation.y = d * 0.5;
    fl.position.set(-dir.x * 11.5 * k, 8 * k - dir.y * 11.5 * k, 1.8 * k + d * 0.5 * k); g.add(fl);
  }
  g.userData.size = { w: 20 * k, h: 16 * k };
  return g;
}
function curlyArrow(sz) {
  const g = piece(); const k = sz / 20;
  const pts = [[-16, 1, 0], [-11, 5, 2], [-7, 11, 1], [-9, 16, -2], [-14, 14, -2], [-12, 9, 1], [-5, 7, 2], [1, 9, 1], [4, 15, -1], [1, 19, -2], [-2, 16, 0], [2, 12, 2], [9, 12, 2], [14, 15, 0], [17, 19, -1]].map(([x, y, z]) => new THREE.Vector3(x * k, y * k + 1.5 * k, z * k));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const mat = paint({ stops: ['#00e5ff', '#2b5bff', '#9b3cff', '#ff2ea6'], yMin: 0, yMax: 20 * k, sharp: 0.3 });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 320, 1.15 * k, 20, false), mat); tube.castShadow = tube.receiveShadow = true;
  outline(tube, [[WHITE, 0.55 * k], [BLACK, 0.28 * k]]);
  g.add(tube);
  const end = curve.getPoint(1), tan = curve.getTangent(1);
  const head = new THREE.Mesh(new THREE.ConeGeometry(2.8 * k, 5 * k, 24), mat);
  head.position.copy(end).addScaledVector(tan, 2.2 * k);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan); head.castShadow = true;
  outline(head, [[WHITE, 0.55 * k], [BLACK, 0.28 * k]]);
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.15 * k, 20, 14), mat); cap.position.copy(curve.getPoint(0)); g.add(cap);
  g.userData.size = { w: 36 * k, h: 22 * k };
  return g;
}
function bolt(sz) {
  const g = piece(); const k = sz / 20;
  const s = new THREE.Shape([[2, 20], [9, 20], [5, 12], [10, 12], [-3, -2], [1, 9], [-4, 9]].map(([x, y]) => new THREE.Vector2(x * k, y * k + 2 * k)));
  const mat = paint({ stops: ['#ff9d00', '#fff200', '#ffffff'], yMin: 0, yMax: 22 * k, sharp: 0.2, emissive: 0.15 });
  g.add(puffyShape(s, 2 * k, 0.9 * k, mat, [[BLACK, 0.45 * k]]));
  const word = puffyWord({ text: 'ZAP!', size: 6 * k, bevel: 0.5 * k, depth: 1.2 * k, stops: ['#1b00ff', '#19e3ff', '#d6fbff'], drips: 1, tilt: 0.25, seed: 4 });
  word.position.set(8 * k, 13 * k, 3.5 * k); word.rotation.z = 0.2; g.add(word);
  g.userData.size = { w: 22 * k, h: 22 * k };
  return g;
}
function sprayCan(h) {
  const g = piece(); const r = h * 0.22;
  const prof = [[0, 0], [r * 0.92, 0], [r, r * 0.06], [r, h * 0.78], [r * 0.93, h * 0.84], [r * 0.7, h * 0.9], [r * 0.38, h * 0.93], [r * 0.36, h * 0.95]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = paint({ stops: ['#2a2a35', '#ff2ea6', '#ff2ea6', '#ffe600'], yMin: 0, yMax: h * 0.95, sharp: 0.05, wave: 0, metal: 0.35, rough: 0.2, stripes: { spacing: h * 0.08, width: 0.12, from: 0.82, color: '#ffffff' } });
  const can = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), body); can.castShadow = can.receiveShadow = true;
  outline(can, [[BLACK, h * 0.008]]);
  g.add(can);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, h * 0.012, 12, 96).rotateX(Math.PI / 2), chrome()); ring.position.y = h * 0.02; g.add(ring);
  // label sleeve
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 2048, 512);
  x.font = '900 300px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  for (const off of [0, 1024]) { x.lineWidth = 34; x.strokeStyle = '#111'; x.strokeText('SPRAY', 512 + off, 270); const gr = x.createLinearGradient(0, 120, 0, 420); gr.addColorStop(0, '#19e3ff'); gr.addColorStop(1, '#7a2cff'); x.fillStyle = gr; x.fillText('SPRAY', 512 + off, 270); }
  for (let i = 0; i < 26; i++) { const xx = Math.random() * 2048; x.strokeStyle = '#ff2ea6'; x.lineWidth = 10; x.lineCap = 'round'; x.beginPath(); x.moveTo(xx, 470); x.lineTo(xx, 470 + Math.random() * 40); x.stroke(); }
  const lt = new THREE.CanvasTexture(c); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 8;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.3, 96, 1, true), new THREE.MeshPhysicalMaterial({ map: lt, roughness: 0.3, clearcoat: 1, envMap: envMap() }));
  label.position.y = h * 0.42; g.add(label);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.26, h * 0.07, 32), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1 })); cap.position.y = h * 0.985; g.add(cap);
  const nozzle = new THREE.Mesh(new THREE.BoxGeometry(r * 0.2, r * 0.14, r * 0.34), new THREE.MeshStandardMaterial({ color: 0x111111 })); nozzle.position.set(0, h * 1.02, r * 0.18); g.add(nozzle);
  // the spray: a cone of mist and puffs drifting out the front
  const mist = new THREE.Group(); mist.position.set(0, h * 1.02, r * 0.38); g.add(mist);
  const puffs = [];
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({ color: [0xff2ea6, 0xff6ad5, 0xffe600][i % 3], transparent: true, opacity: 0.45, roughness: 1, depthWrite: false }));
    p.userData.t = i / 14; mist.add(p); puffs.push(p);
  }
  g.userData.animate = (dt) => {
    for (const p of puffs) {
      p.userData.t = (p.userData.t + dt * 0.12) % 1; const t = p.userData.t;
      p.position.set(Math.sin(t * 9) * r * 0.2, Math.sin(t * 5) * r * 0.15 + t * r * 0.3, t * h * 0.55);
      p.scale.setScalar(r * (0.12 + t * 0.6)); p.material.opacity = 0.5 * (1 - t);
    }
  };
  // a long drip down the side
  const dripMat = new THREE.MeshPhysicalMaterial({ color: 0xff2ea6, roughness: 0.15, clearcoat: 1, envMap: envMap() });
  for (const [ang, len] of [[0.3, h * 0.45], [-0.25, h * 0.3], [0.05, h * 0.62]]) {
    const d = new THREE.Mesh(new THREE.CapsuleGeometry(h * 0.012, len, 6, 12), dripMat);
    d.position.set(Math.sin(ang) * r * 1.02, h * 0.82 - len / 2, Math.cos(ang) * r * 1.02); g.add(d);
  }
  const pool = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 40).rotateX(-Math.PI / 2), dripMat); pool.position.set(r * 0.4, 0.06, r * 1.4); g.add(pool);
  g.userData.size = { w: r * 2, h };
  return g;
}
function eyeball(rad) {
  const g = piece();
  const ballY = rad * 1.9;
  // alien stalk
  const stalkMat = new THREE.MeshPhysicalMaterial({ color: 0x5dff2a, roughness: 0.2, clearcoat: 1, envMap: envMap(), emissive: 0x0f3a00 });
  const stalkCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(rad * 0.25, ballY * 0.35, -rad * 0.1), new THREE.Vector3(-rad * 0.15, ballY * 0.7, rad * 0.05), new THREE.Vector3(0, ballY - rad * 0.6, 0)]);
  const stalk = new THREE.Mesh(new THREE.TubeGeometry(stalkCurve, 64, rad * 0.22, 20), stalkMat); stalk.castShadow = true;
  outline(stalk, [[BLACK, rad * 0.03]]);
  g.add(stalk);
  for (let i = 1; i < 5; i++) { const t = i / 5; const ring = new THREE.Mesh(new THREE.TorusGeometry(rad * 0.24, rad * 0.04, 10, 28), new THREE.MeshPhysicalMaterial({ color: 0xff2ea6, emissive: 0x5a0030, roughness: 0.2, clearcoat: 1 })); ring.position.copy(stalkCurve.getPoint(t)); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), stalkCurve.getTangent(t)); g.add(ring); }
  const white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, clearcoat: 1, envMap: envMap() });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(rad, 96, 64), white); ball.position.y = ballY; ball.castShadow = true;
  outline(ball, [[BLACK, rad * 0.04]]);
  g.add(ball);
  // iris and pupil as a coloured cap facing front
  const cap = new THREE.SphereGeometry(rad * 1.004, 96, 48, 0, Math.PI * 2, 0, 0.62);
  const p = cap.attributes.position, c = new Float32Array(p.count * 3), cc = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const th = Math.acos(THREE.MathUtils.clamp(p.getY(i) / (rad * 1.004), -1, 1));
    const az = Math.atan2(p.getZ(i), p.getX(i));
    if (th < 0.2) cc.set(0x050505); else if (th < 0.56) { cc.set(0x19e3ff).lerp(new THREE.Color(0x7dff3a), (th - 0.2) / 0.36); cc.multiplyScalar(0.8 + 0.3 * Math.sin(az * 26)); } else cc.set(0x0b3a2a);
    c.set([cc.r, cc.g, cc.b], i * 3);
  }
  cap.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const iris = new THREE.Mesh(cap, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.05, clearcoat: 1, envMap: envMap(), emissive: 0x062a22 }));
  iris.rotation.x = Math.PI / 2; iris.position.y = ballY; g.add(iris);
  const glint = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.09, 16, 12), WHITE_SHINE); glint.position.set(-rad * 0.22, ballY + rad * 0.25, rad * 0.97); g.add(glint);
  // lashes on top, glowing drips hanging from underneath
  for (let i = 0; i < 9; i++) {
    const a = -0.9 + i * 0.225;
    const l = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.05, rad * 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    l.position.set(Math.sin(a) * rad * 0.92, ballY + Math.cos(a) * rad * 0.92 + rad * 0.1, rad * 0.35);
    l.rotation.z = -a; l.rotation.x = 0.4; g.add(l);
  }
  for (let i = 0; i < 7; i++) {
    const a = -1.1 + i * 0.37, len = rad * (0.25 + ((i * 7) % 4) * 0.12);
    const x = Math.sin(a) * rad * 0.62, z = Math.cos(a) * rad * 0.62;
    const y0 = ballY - Math.sqrt(Math.max(0, rad * rad - x * x - z * z)) + rad * 0.04;
    const d = new THREE.Mesh(new THREE.CapsuleGeometry(rad * 0.05, len, 6, 12), stalkMat);
    d.position.set(x, y0 - len / 2, z); g.add(d);
  }
  g.userData.size = { w: rad * 2, h: ballY + rad };
  return g;
}
function tagScribble(sz) {
  const g = piece(); const k = sz / 20;
  const pts = [[-17, 5], [-14, 13], [-12, 4], [-9, 11], [-7, 3], [-4, 12], [-2, 4], [0, 9], [2, 5], [3, 12], [5, 4], [8, 9], [6, 11], [10, 6], [13, 10], [11, 4], [15, 6]].map(([x, y], i) => new THREE.Vector3(x * k, y * k + 4 * k, Math.sin(i * 1.3) * 0.8 * k));
  const gold = chrome(0xffc94a, 0.12);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.6), 400, 0.55 * k, 14), gold); tube.castShadow = true;
  outline(tube, [[BLACK, 0.18 * k]]);
  g.add(tube);
  const sw = [[-19, 2], [-8, 0.5], [6, 1.5], [18, 4.5]].map(([x, y]) => new THREE.Vector3(x * k, y * k + 4 * k, 0));
  const swoosh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sw), 120, 0.45 * k, 12), gold); g.add(swoosh);
  const cr = crown(5 * k); cr.position.set(-14 * k, 15.5 * k, 0); cr.rotation.z = 0.25; g.add(cr);
  const st = sparkle(1.8 * k); st.position.set(17.5 * k, 12 * k, 0); g.add(st);
  for (const x of [-12, 0, 12]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * k, 0.25 * k, 5 * k, 10), chrome(0x888888, 0.3)); post.position.set(x * k, 2.5 * k, -0.5 * k); g.add(post); }
  g.userData.size = { w: 38 * k, h: 22 * k };
  return g;
}
function muralWall(text, spec, seed) {
  const g = piece();
  const W = spec.wallW || 34, H = spec.wallH || 12;
  const front = new THREE.MeshPhysicalMaterial({ map: muralTexture(fonts().helv, { text, w: 2048, h: Math.round(2048 * H / W), ...spec }, seed), roughness: 0.75, clearcoat: 0.25, envMap: envMap(), envMapIntensity: 0.3 });
  const conc = concreteMaterial(seed + 50, { w: 1024, h: 512, tagCount: 14, repeat: [1, 1] });
  const plain = concreteMaterial(seed + 90, { w: 512, h: 512, tagCount: 0 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(W, H, 1.4), [plain, plain, plain, plain, front, conc]);
  wall.position.y = H / 2; wall.castShadow = wall.receiveShadow = true; g.add(wall);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.5, 2), plain); cap.position.y = H + 0.25; g.add(cap);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, H + 0.6, 2.4), plain); b.position.set(s * (W / 2 + 0.5), H / 2, 0); b.castShadow = true; g.add(b); }
  g.userData.size = { w: W, h: H };
  return g;
}
function gateway(width) {
  const g = piece();
  const H = 16;
  const conc = concreteMaterial(77, { w: 1024, h: 1024, tagCount: 16 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new RoundedBoxGeometry(4, H, 4, 3, 0.5), conc); p.position.set(s * width / 2, H / 2, 0); p.castShadow = true; g.add(p); }
  const beamFront = new THREE.MeshPhysicalMaterial({ map: muralTexture(fonts().helv, { text: 'GRAFFITI GARDEN', w: 2048, h: 256, size: 160, baseline: 0.8, extrude: 10, outerWidth: 22, innerWidth: 11, fill: ['#ffffff', '#ffe600', '#ff7a1a'], drips: 10, arrows: 0, sparkles: 6, bounce: 0.03, tight: 0.9 }, 3), roughness: 0.7 });
  const beamBack = new THREE.MeshPhysicalMaterial({ map: muralTexture(fonts().helv, { text: 'STAY WILD', w: 2048, h: 256, size: 190, baseline: 0.84, extrude: 10, outerWidth: 22, innerWidth: 11, fill: ['#b6ff1a', '#19e3ff', '#9b5cff'], drips: 8, arrows: 0, sparkles: 6 }, 4), roughness: 0.7 });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 4, 3.6, 3), [conc, conc, conc, conc, beamBack, beamFront]);
  beam.position.y = H + 1.6; beam.castShadow = true; g.add(beam);
  const cr = crown(6); cr.position.set(0, H + 3.4, 0); g.add(cr);
  g.userData.size = { w: width + 4, h: H + 9 };
  return g;
}
function neonPost(color, h = 10) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, h, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.7, roughness: 0.4 })); pole.position.y = h / 2; pole.castShadow = true; g.add(pole);
  const neon = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, h * 0.6, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 })); neon.position.set(0.45, h * 0.55, 0); g.add(neon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 10, 32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 })); ring.position.y = h + 0.4; g.add(ring);
  return g;
}

// ---------------------------------------------------------------- the garden
export function buildGraffitiGarden(rec, planet, f) {
  const group = new THREE.Group();
  group.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  group.updateMatrixWorld(true);
  const entrance = (rec.entrance ?? 0) * Math.PI / 180; // bearing of the gateway from the centre
  let built = false;
  const animated = [];
  const sparkles = [];

  const build = () => {
    built = true;
    const pad = f.pad, Rg = R + f.target;
    // paving: a spherical cap so it hugs the curved ground
    const theta = pad / Rg;
    const pave = new THREE.SphereGeometry(Rg + 0.06, 128, 48, 0, Math.PI * 2, 0, theta);
    pave.translate(0, -Rg, 0);
    const pp = pave.attributes.position, uv = pave.attributes.uv;
    for (let i = 0; i < pp.count; i++) uv.setXY(i, pp.getX(i) / 24, pp.getZ(i) / 24);
    const paving = new THREE.Mesh(pave, new THREE.MeshStandardMaterial({ map: concreteTexture(31, { w: 1024, h: 1024, tagCount: 0, tone: 170 }), roughness: 0.95, envMap: envMap(), envMapIntensity: 0.2 }));
    paving.receiveShadow = true; group.add(paving);
    // floor rosette
    const c = document.createElement('canvas'); c.width = c.height = 2048; const x = c.getContext('2d');
    x.translate(1024, 1024);
    const ringCols = ['#ff2ea6', '#ffe600', '#19e3ff', '#9b5cff', '#b6ff1a'];
    for (let i = 0; i < 5; i++) { x.lineWidth = 46; x.strokeStyle = ringCols[i]; x.beginPath(); x.arc(0, 0, 980 - i * 70, 0, 7); x.stroke(); }
    for (let i = 0; i < 24; i++) { x.save(); x.rotate((i / 24) * Math.PI * 2); x.fillStyle = ringCols[i % 5]; x.beginPath(); x.moveTo(-60, -560); x.lineTo(0, -320); x.lineTo(60, -560); x.closePath(); x.fill(); x.lineWidth = 10; x.strokeStyle = '#111'; x.stroke(); x.restore(); }
    x.fillStyle = '#111'; x.beginPath(); x.arc(0, 0, 300, 0, 7); x.fill();
    x.lineWidth = 30; x.strokeStyle = '#fff'; x.stroke();
    x.font = '900 120px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const ring = ' WORLDBUILDER ✦ GRAFFITI GARDEN ✦ STAY WILD ✦';
    for (let i = 0; i < ring.length; i++) { x.save(); x.rotate((i / ring.length) * Math.PI * 2); x.translate(0, -650); x.fillStyle = '#fff'; x.strokeStyle = '#111'; x.lineWidth = 14; x.strokeText(ring[i], 0, 0); x.fillText(ring[i], 0, 0); x.restore(); }
    for (let i = 0; i < 8; i++) { x.save(); x.rotate(i * Math.PI / 4); x.fillStyle = '#ffe600'; x.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const rr = k % 2 ? 30 : 110; x.lineTo(Math.cos(a) * rr, -180 + Math.sin(a) * rr); } x.fill(); x.restore(); }
    const rt = new THREE.CanvasTexture(c); rt.colorSpace = THREE.SRGBColorSpace; rt.anisotropy = 8;
    const rose = new THREE.Mesh(new THREE.CircleGeometry(38, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rt, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    rose.position.y = 0.12; rose.rotation.y = -entrance; rose.receiveShadow = true; group.add(rose);

    // place a piece on the ring: angle from the entrance (deg), radius, facing the centre
    const place = (obj, angDeg, r, lift = 0) => {
      const b = entrance + angDeg * Math.PI / 180;
      const px = Math.sin(b) * r, pz = -Math.cos(b) * r;
      obj.position.set(px, lift - (r * r) / (2 * Rg), pz);
      obj.rotation.y = r > 0.1 ? Math.atan2(-px, -pz) : -entrance + Math.PI;
      group.add(obj);
      return obj;
    };
    const onPlinth = (pc, w, d, h, seed) => { const holder = new THREE.Group(); holder.add(plinth(w, h, d, seed, h)); pc.position.y = h; holder.add(pc); return holder; };

    const wild = wildWord({ text: 'WILD', size: 24, stops: ['#c4002a', '#ff3d00', '#ff9a00', '#fff35a'], arrowStops: ['#0030ff', '#0096ff', '#3ff0ff'], stripes: { spacing: 3.5, width: 0.12, from: 0.75, color: '#fff3b0' }, seed: 11 });
    place(onPlinth(wild, 92, 18, 2.6, 1), 180, 100);
    const boom = puffyWord({ text: 'BOOM', size: 19, stops: ['#4b1bff', '#ff2ea6', '#ff8a1c', '#ffe600'], dots: { spacing: 1.7, radius: 0.16, from: 0.72, color: '#ffffff' }, seed: 2 });
    place(onPlinth(boom, 70, 16, 2.2, 2), 130, 100);
    const dream = chromeWord({ text: 'DREAM', size: 16, sideStops: ['#0b0b6a', '#2b5bff', '#9b3cff', '#ff2ea6'], seed: 5, font: fonts().optimer });
    place(onPlinth(dream, 84, 16, 2.2, 3), 230, 100);
    place(onPlinth(crown(26), 36, 14, 4, 4), 82, 102);
    place(onPlinth(sprayCan(30), 18, 18, 1.6, 5), 278, 102);
    place(onPlinth(starburst(12, 'POW!'), 30, 12, 2, 6), 42, 104);
    place(onPlinth(heart(26), 30, 12, 2, 7), 318, 104);
    place(onPlinth(curlyArrow(26), 44, 12, 1.6, 8), 116, 56);
    place(onPlinth(eyeball(7), 14, 14, 3, 9), 244, 56);
    place(onPlinth(tagScribble(26), 52, 10, 1.4, 10), 300, 56);
    place(onPlinth(bolt(24), 28, 10, 2, 11), 62, 56);
    place(muralWall('ALIEN', { fill: ['#eaffc0', '#b6ff1a', '#2bd96b', '#0b6a3a'], character: 'alien', charX: 260, dx: 160, clouds: ['#9b5cff', '#ff2ea6', '#19e3ff'], extrudeColor: '#2a0a4a' }, 21), -24, 132);
    place(muralWall('STARFALL', { fill: ['#ffffff', '#ffe600', '#ff2ea6', '#9b3cff'], clouds: ['#19e3ff', '#2b5bff', '#ff7a1a'], extrudeColor: '#0b0b3a', pattern: 'stripes', sparkles: 24 }, 22), 24, 132);
    place(muralWall('WORLDBUILDER', { wallW: 44, fill: ['#d6fbff', '#19e3ff', '#2b5bff', '#1b00a0'], clouds: ['#ff2ea6', '#ffe600', '#b6ff1a'], extrudeColor: '#3a0018', size: 300, arrows: 2 }, 23), 106, 140);
    place(muralWall('KING', { fill: ['#fff3b0', '#ffb300', '#ff6a00', '#a33000'], clouds: ['#ff2ea6', '#9b5cff', '#19e3ff'], extrudeColor: '#111', size: 420, arrows: 2, pattern: 'stripes' }, 24), 254, 140);
    place(gateway(18), 0, pad - 6);
    // sparkles ring the centre, neon posts ring the plaza, benches by the rosette
    for (let i = 0; i < 8; i++) {
      const hgt = 3 + (i % 3) * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, hgt, 8), chrome(0xcccccc, 0.2)); post.position.y = hgt / 2;
      const st = sparkle(1.6 + (i % 2)); st.position.y = hgt + 1.6;
      const holder = new THREE.Group(); holder.add(post, st);
      place(holder, i * 45 + 22.5, 26); sparkles.push(st);
    }
    const neonCols = [0xff2ea6, 0x19e3ff, 0xb6ff1a, 0xffe600, 0x9b5cff, 0xff7a1a];
    for (let i = 0; i < 18; i++) if (Math.abs(((i * 20 + 10 + 180) % 360) - 180) > 14) place(neonPost(neonCols[i % 6]), i * 20 + 10, 116);
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new RoundedBoxGeometry(7, 0.9, 2.2, 3, 0.3), concreteMaterial(60 + i, { w: 512, h: 256, tagCount: 4 })); b.position.y = 0.45; b.castShadow = b.receiveShadow = true; const h = new THREE.Group(); h.add(b); place(h, i * 60, 44); }

    // paint frames, shadows
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (o.userData.animate) animated.push(o);
      if (!o.isMesh) return;
      if (!o.userData.hull) { o.castShadow = true; o.receiveShadow = true; }
      let p = o; while (p && !p.userData.piece) p = p.parent;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.userData.paint) m.userData.paint.uToPaint.value.copy((p || group).matrixWorld).invert();
      }
    });
  };

  group.userData.update = (dt) => {
    if (!built) {
      const v = gardenCtx.viewer && gardenCtx.viewer();
      if (v && v.distanceTo(group.position) < (rec.buildRange ?? 3500)) build();
      return;
    }
    for (const o of animated) o.userData.animate(dt);
    for (const s of sparkles) s.rotation.y += dt * 0.8;
  };
  group.userData.forceBuild = () => { if (!built) build(); };
  group.userData.labelPos = new THREE.Vector3(0, 40, 0);
  group.userData.labelRange = 4000;
  return group;
}
