// The Paper Machine, for Sam's Metamers (LLM, the Large Ling Model): a mainframe in a
// pale Moebius clearing that eats its own forest. A jointed saw fells a tree, the log
// rides a belt into the mill, reams come out of the rollers and go up a ramp into the
// mainframe's hopper, and its printer throws Sam's papers out on to stacks the size of
// office blocks. It all runs on one clock, `flow`, so a tree falling, a log leaving and
// a ream arriving are the same beat. Running the machine (a ten second show) winds that
// clock up and follows one tree all the way through, then a page comes out of the
// printer and fills the screen, and the visitor is on the website.
//
// The record's lat/lon is the middle of the clearing and its heading points past the
// viewpoint at the mainframe. Like the Orbitakt launchpad the colours are baked and the
// model faces -z, where the fixed sun is, then is turned round: the viewer's left is +x.
import * as THREE from 'three';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';
import { Bag } from './university.js';
import { rock } from './orbitakt.js';

const DEG = Math.PI / 180;
export const PAPER_URL = 'https://samuelling.github.io/LargeLingModel/';
const SAND = 0xf1dcae, PEACH = 0xf0b48c, CORAL = 0xe0705a, TEAL = 0x4aa7a2, MINT = 0xb4e0d0, MOSS = 0x6fae7d;
const MUSTARD = 0xe3b23c, LILAC = 0xbba0d6, VIOLET = 0x5b4a8a, CREAM = 0xf8efd8, BARK = 0x8a5a44, INK = 0x16110e;
const PAPER = 0xfbf6ea;

const CYCLE = 6;       // seconds of flow from one felled tree to the next
const SPACING = 70;    // metres of belt between logs
const SHEET = 0.8;     // seconds of flow between sheets
const SHEETS = 14;     // sheets in the air
const TREE = new THREE.Vector3(330, 0, -180), SAW_BASE = new THREE.Vector3(395, 0, -180);
const MILL_IN = 70, MILL_OUT = 250;     // the z where the belt enters and leaves the mill
const PRINTER = new THREE.Vector3(-70, 22, 196);
const LENGTH = 10, FLASH = 0.7;         // the show, and the white-out at the end of it
const STACKS = [ // x, z, height, turn
  [-200, -60, 95, 0.1], [-260, 40, 70, -0.2], [-170, 90, 120, 0.25], [-300, -130, 60, 0.4], [-240, 170, 85, -0.1], [-340, 90, 100, 0.15], [-120, -170, 45, -0.3],
  [-20, -230, 30, 0.2], [40, -120, 55, -0.15], [62, 30, 80, 0.3], [110, 120, 65, -0.25], [-340, -30, 45, 0], [66, 214, 96, 0.1], [-250, 262, 110, -0.2],
];
// Real papers, from the Ling Lab's publications page, for the title pages on the stacks.
const PAPERS = [
  ['Attention alters appearance', 2004], ['When sustained attention impairs perception', 2006], ['How attention extracts objects from noise', 2013],
  ['Visual memories bypass normalization', 2018], ['Elevated arousal levels enhance contrast perception', 2017], ['Normalizing population receptive fields', 2021],
  ['Luminance potentiates human visuocortical responses', 2020], ['Temporal attention selectively enhances target features', 2021],
  ['Normalization regulates competition for visual awareness', 2012], ['Attention alters population spatial frequency tuning', 2025],
  ['Differential cortical and subcortical visual processing with eyes shut', 2024], ['Cortex-specific inversion of visual responses during sleep', 2026],
];
const CAPTIONS = [[0.2, 'It starts with a tree.'], [2.6, 'The mill makes it paper.'], [5.3, 'Fifty-three papers in the hopper.'], [7.4, 'The machine prints a new one.'], [9, '']];

// How far through the tree's cycle the show should be, in its first two seconds.
const FELL = [[0, 0.33], [0.6, 0.34], [1.1, 0.5], [1.7, 0.74], [2, 1]];
function felling(t) {
  const i = Math.max(0, FELL.findIndex(([at]) => at > t) - 1), [a, x] = FELL[i], [b, y] = FELL[i + 1] || FELL[i];
  return b > a ? x + ((y - x) * (t - a)) / (b - a) : y;
}

const inkLines = new THREE.LineBasicMaterial({ color: INK });
const glow = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
function lines(parent, points, material = inkLines) {
  const m = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)), material);
  parent.add(m);
  return m;
}
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function wrap(c, text, x, y, width, leading) {
  let line = '';
  for (const word of text.split(' ')) {
    if (line && c.measureText(`${line} ${word}`).width > width) { c.fillText(line, x, y); y += leading; line = word; } else line = line ? `${line} ${word}` : word;
  }
  c.fillText(line, x, y);
  return y + leading;
}
// A title page, drawn into a w by h box at (x, y).
function titlePage(c, x, y, w, h, [title, year], rng) {
  const u = w / 100;
  c.fillStyle = '#fbf6ea'; c.fillRect(x, y, w, h);
  c.fillStyle = '#16110e'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.font = `900 italic ${9 * u}px Georgia, serif`;
  const after = wrap(c, title, x + w / 2, y + 22 * u, 84 * u, 11 * u);
  c.font = `${4.6 * u}px Georgia, serif`;
  c.fillText(`Sam Ling and colleagues, ${year}`, x + w / 2, after + 2 * u);
  c.fillStyle = '#6b6258';
  for (let r = after + 12 * u; r < y + h - 10 * u; r += 5 * u) {
    const half = rng() < 0.12 ? 0.5 : 1;
    c.fillRect(x + 10 * u, r, 80 * u * half * (0.86 + rng() * 0.14), 1.7 * u);
  }
}

// ---------------------------------------------------------------- the belt
function beltCurve() {
  return new THREE.CatmullRomCurve3([
    [302, 14, -180], [262, 14, -176], [232, 14, -110], [222, 14, -20], [220, 14, 60], [220, 14, 150], [220, 14, 250],
    [190, 14, 282], [134, 30, 310], [86, 72, 334], [62, 134, 350],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'catmullrom', 0.35);
}
function buildBelt(bag, curve) {
  const steps = 84, len = curve.getLength(), a = new THREE.Vector3(), b = new THREE.Vector3(), m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), tip = new THREE.Vector3(), fwd = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    curve.getPointAt(i / steps, a); curve.getPointAt((i + 1) / steps, b);
    if (a.z > MILL_IN && a.z < MILL_OUT && a.y < 20) continue; // indoors
    fwd.subVectors(b, a); const l = fwd.length(); fwd.normalize();
    side.crossVectors(up, fwd).normalize(); tip.crossVectors(fwd, side);
    m.makeBasis(side, tip, fwd).setPosition(a.clone().lerp(b, 0.5));
    bag.add(new THREE.BoxGeometry(24, 2, l + 0.4).applyMatrix4(m), i % 2 ? VIOLET : 0x6b5a9c, { y: -2 });
    if (i % 4 === 0) bag.box(4, a.y, 4, MUSTARD, a.x, a.y / 2 - 2, a.z);
  }
  return len;
}

// ---------------------------------------------------------------- the forest
function pine(bag, x, z, h, color) {
  bag.lathe([[h * 0.05, 0], [h * 0.035, h * 0.4]], BARK, x, 0, z, 6, false);
  for (let i = 0; i < 3; i++) bag.lathe([[h * (0.26 - i * 0.05), h * (0.24 + i * 0.22)], [0.1, h * (0.62 + i * 0.19)]], color, x, 0, z, 7);
}
function buildForest(bag, rng) {
  const colors = [TEAL, MOSS, MINT, TEAL, MOSS, MUSTARD];
  let n = 0;
  for (let tries = 0; tries < 1200 && n < 230; tries++) {
    const x = 240 + rng() * 380, z = -420 + rng() * 840;
    if (Math.hypot(x, z) > 615) continue;
    if (x < 450 && z > -320 && z < -70) continue;  // already felled
    if (x < 305 && z > -60 && z < 320) continue;   // belt and mill
    pine(bag, x, z, 42 + rng() * 34, colors[Math.floor(rng() * colors.length)]);
    n++;
  }
  // what's left of the trees it has already eaten
  for (let i = 0; i < 26; i++) {
    const x = 270 + rng() * 170, z = -300 + rng() * 215;
    if (Math.abs(z + 180) < 34 && x < 410) continue;
    bag.lathe([[3.6, 0], [3, 3], [0.1, 3.2]], BARK, x, 0, z, 7);
  }
}

// The tree the saw is working on. Its pivot is where it's cut; it falls to -x.
function buildTree(model) {
  const stump = new Bag(), g = new THREE.Group(), trunk = new Bag(), crown = new Bag(), h = 60;
  stump.lathe([[4, 0], [3.4, 8], [0.1, 8.2]], BARK, TREE.x, 0, TREE.z, 8);
  stump.build(model);
  g.position.set(TREE.x, 8, TREE.z);
  model.add(g);
  trunk.lathe([[3.4, 0], [1.2, h]], BARK, 0, 0, 0, 8, false);
  trunk.build(g);
  const top = new THREE.Group();
  for (let i = 0; i < 3; i++) crown.lathe([[17 - i * 3.6, 14 + i * 14], [0.1, 38 + i * 11]], TEAL, 0, 0, 0, 8);
  crown.build(top);
  g.add(top);
  return { g, top };
}
// A column, an arm, and on the end of the arm a saw with its guard.
function buildSaw(model, bag) {
  bag.lathe([[16, 0], [10, 8], [7, 28], [7, 30]], CORAL, SAW_BASE.x, 0, SAW_BASE.z, 10);
  const arm = new THREE.Group();
  arm.position.set(SAW_BASE.x, 26, SAW_BASE.z);
  model.add(arm);
  const a = new Bag();
  a.box(70, 7, 8, MUSTARD, -35, 0, 0);
  a.box(10, 22, 6, VIOLET, -65, -9, 0);
  a.build(arm);
  const blade = new THREE.Group();
  blade.position.set(-65, -18, 0);
  arm.add(blade);
  const b = new Bag();
  b.add(new THREE.CylinderGeometry(15, 15, 1, 24), MINT, {});
  for (let i = 0; i < 18; i++) {
    const t = (i / 18) * Math.PI * 2;
    b.add(new THREE.ConeGeometry(2.2, 5, 4).rotateZ(-Math.PI / 2).rotateY(-t), CREAM, { x: Math.cos(t) * 16, z: Math.sin(t) * 16, ink: false });
  }
  b.build(blade);
  return { arm, blade };
}

// ---------------------------------------------------------------- the mill
function buildMill(model, bag, rng) {
  const x = 190, w = 120, z0 = MILL_IN, z1 = 190;
  bag.box(w, 58, z1 - z0, PEACH, x, 29, (z0 + z1) / 2);
  bag.box(w + 8, 6, z1 - z0 + 8, CORAL, x, 60, (z0 + z1) / 2);
  // a sawtooth roof, and the mouth the logs go in by
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(30, 0), new THREE.Vector2(0, 26)]);
    const g = new THREE.ExtrudeGeometry(p, { depth: w, bevelEnabled: false }).rotateY(-Math.PI / 2).rotateY(Math.PI);
    bag.add(g, LILAC, { x: x + w / 2 - w, y: 63, z: z0 + i * 30 + 2 });
  }
  bag.box(36, 28, 3, INK, 220, 16, z0 - 1, 0, false);
  for (let i = 0; i < 5; i++) bag.box(12, 22, 2, MUSTARD, x - 50 + i * 12, 32, z0 - 1, 0, false);
  const steam = [];
  for (const [sx, sz, h] of [[140, 96, 150], [146, 152, 118]]) {
    bag.lathe([[22, 58], [13, 110], [11, h], [13, h + 3], [8, h + 3]], CREAM, sx, 0, sz, 14);
    bag.lathe([[14, h - 18], [14, h - 10]], CORAL, sx, 0, sz, 14, false);
    steam.push(new THREE.Vector3(sx, h + 6, sz));
  }
  // the open end: pulp becomes a web across the rollers, and the web is cut into reams
  bag.box(70, 6, 62, VIOLET, 220, 3, 220);
  bag.box(30, 2, 60, PAPER, 220, 21, 220, 0, false);
  for (const s of [-1, 1]) bag.box(5, 30, 66, CORAL, 220 + s * 26, 15, 220);
  const roller = new THREE.CylinderGeometry(7, 7, 46, 12).rotateZ(Math.PI / 2);
  const rollers = [];
  const b = new Bag();
  b.add(roller, TEAL, {});
  for (let i = 0; i < 4; i++) { // stripes show them turning
    b.add(new THREE.BoxGeometry(47, 1, 1.4), MINT, { y: i % 2 ? (i - 2) * 7 : 0, z: i % 2 ? 0 : (i - 1) * 7, ink: false });
  }
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    g.position.set(220, i % 2 ? 29 : 14, 198 + i * 9);
    if (i === 0) b.build(g); else for (const c of rollers[0].children) g.add(c.clone());
    model.add(g);
    rollers.push(g);
  }
  // steam, puffs on a loop up from both stacks
  const puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xfff8ea, toneMapped: false }), 20);
  puffs.frustumCulled = false;
  puffs.userData.jitter = Array.from({ length: 20 }, () => rng() * Math.PI * 2);
  model.add(puffs);
  return { rollers, steam, puffs };
}

// ---------------------------------------------------------------- the mainframe
function buildMainframe(model) {
  const bag = new Bag(), W = 72, Y0 = 8, H = 122, Z = 310, D = 110, cabinets = 7, x0 = 54;
  const cabX = (i) => x0 - W * (i + 0.5);
  const doors = [TEAL, CORAL, TEAL, CREAM, TEAL, CORAL, TEAL];
  bag.box(W * cabinets + 16, Y0, D + 16, VIOLET, x0 - (W * cabinets) / 2, Y0 / 2, Z + D / 2);
  for (let i = 0; i < cabinets; i++) {
    bag.box(W - 3, H, D, doors[i], cabX(i), Y0 + H / 2, Z + D / 2);
    bag.box(W - 3, 12, D + 2, MUSTARD, cabX(i), Y0 + H + 6, Z + D / 2);
    bag.box(W - 14, 4, 2, INK, cabX(i), Y0 + 12, Z - 0.5, 0, false);
  }
  // the hopper the reams drop into
  bag.lathe([[12, 0], [30, 30], [33, 30], [33, 26]], LILAC, 44, Y0 + H + 12, 362, 4);

  // rows of lamps on the odd cabinets
  const rows = 9, cols = 9, spots = [];
  for (const i of [1, 3, 5]) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) spots.push([cabX(i) - 24 + c * 6, Y0 + 26 + r * 10]);
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 6, 1), glow(0xffffff), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, y], i) => { m.setPosition(x, y, Z - 0.8); lamps.setMatrixAt(i, m); lamps.setColorAt(i, new THREE.Color(0xffffff)); });
  model.add(lamps);

  // tape reels on the even cabinets, in pairs
  const reels = [], proto = new THREE.Group(), r = new Bag();
  r.add(new THREE.CylinderGeometry(15, 15, 2, 24).rotateX(Math.PI / 2), CREAM, {});
  r.add(new THREE.CylinderGeometry(5, 5, 3, 16).rotateX(Math.PI / 2), VIOLET, {});
  for (let i = 0; i < 3; i++) r.add(new THREE.BoxGeometry(2.4, 18, 1).rotateZ((i / 3) * Math.PI * 2).translate(Math.sin((i / 3) * Math.PI * 2) * -6, Math.cos((i / 3) * Math.PI * 2) * 6, 1.4), INK, { ink: false });
  r.build(proto);
  for (const i of [0, 2, 4, 6]) for (const [dx, y] of [[-16, 96], [16, 96], [-16, 56], [16, 56]]) {
    const reel = proto.clone();
    reel.position.set(cabX(i) + dx, Y0 + y, Z - 1.6);
    model.add(reel);
    reels.push(reel);
  }

  // the name on top, and a green screen in the middle of it all
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(290, 56), new THREE.MeshBasicMaterial({
    map: canvasTexture(1400, 270, (c, w, h) => {
      c.fillStyle = '#f8efd8'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#e0705a'; c.lineWidth = 16; c.strokeRect(12, 12, w - 24, h - 24);
      c.fillStyle = '#16110e'; c.textAlign = 'center';
      c.font = '900 italic 170px Georgia, serif'; c.fillText('METAMERS', w / 2, 160);
      c.font = '700 54px Georgia, serif'; c.fillText('LLM · the Large Ling Model', w / 2, 240);
    }), toneMapped: false, side: THREE.DoubleSide,
  }));
  sign.rotation.y = Math.PI;
  sign.position.set(-70, Y0 + H + 44, Z + 30);
  model.add(sign);
  bag.box(4, 40, 4, INK, -190, Y0 + H + 30, Z + 30, 0, false);
  bag.box(4, 40, 4, INK, 50, Y0 + H + 30, Z + 30, 0, false);

  const cv = document.createElement('canvas');
  cv.width = 640; cv.height = 300;
  const screen = new THREE.CanvasTexture(cv);
  screen.colorSpace = THREE.SRGBColorSpace;
  const c = cv.getContext('2d');
  const say = (rows2) => {
    c.fillStyle = '#123f2f'; c.fillRect(0, 0, 640, 300);
    c.fillStyle = '#9ff2b8'; c.font = '700 44px monospace'; c.textAlign = 'left';
    rows2.forEach((t, i) => c.fillText(t, 30, 66 + i * 62));
    screen.needsUpdate = true;
  };
  const crt = new THREE.Mesh(new THREE.PlaneGeometry(58, 27), glow(0xffffff, { map: screen }));
  crt.rotation.y = Math.PI;
  crt.position.set(cabX(3), Y0 + 78, Z - 1);
  model.add(crt);

  // the printer, with continuous paper feeding down to it from the machine
  const px = PRINTER.x, pz = PRINTER.z;
  bag.box(150, 34, 72, CREAM, px, 17, pz + 30);
  bag.box(156, 8, 78, CORAL, px, 37, pz + 30);
  bag.box(90, 6, 8, INK, px, 22, pz - 7, 0, false);
  const web = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-40, 60, 310, 40, 60, 310, 40, 41, 240, -40, 60, 310, 40, 41, 240, -40, 41, 240].map((v, i) => (i % 3 === 0 ? v + px : v)), 3));
  bag.add(web, PAPER, { ink: false });
  const fan = [];
  for (let y = 42; y < 60; y += 3) { const z = 240 + ((y - 41) / 19) * 70; fan.push(px - 40, y, z, px + 40, y, z); }
  lines(model, fan, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.4 }));
  const carriage = new THREE.Group(), cb = new Bag();
  cb.box(14, 7, 8, VIOLET, 0, 0, 0);
  cb.build(carriage);
  carriage.position.set(px, 44, pz + 30);
  model.add(carriage);

  const mesh = bag.build(model);
  return { mesh, lamps, reels, say, carriage, count: spots.length };
}

// ---------------------------------------------------------------- the paper
function buildStacks(model, bag, hatch, rng) {
  const atlas = canvasTexture(2048, 2048, (c) => {
    PAPERS.forEach((p, i) => titlePage(c, (i % 4) * 512, Math.floor(i / 4) * 680, 512, 680, p, rng));
  });
  const page = 1 / 4, tall = 680 / 2048, tops = [];
  const rim = (w, d, y, turn, x, z) => { // one line round a block, so its side reads as sheets
    const pts = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([a, b]) => [x + a * Math.cos(turn) + b * Math.sin(turn), z - a * Math.sin(turn) + b * Math.cos(turn)]);
    for (let i = 0; i < 4; i++) hatch.push(pts[i][0], y, pts[i][1], pts[(i + 1) % 4][0], y, pts[(i + 1) % 4][1]);
  };
  const landing = STACKS.map(([x, z, h, turn], i) => {
    // a stack is a few great bundles, none quite square on the one below
    const blocks = 3 + Math.floor(h / 40), w = 34, d = 46;
    let y = 3, top = turn, tx = x, tz = z;
    for (let b = 0; b < blocks; b++) {
      const bh = (h / blocks), ry = turn + (rng() - 0.5) * 0.3;
      tx = x + (rng() - 0.5) * 7; tz = z + (rng() - 0.5) * 7;
      bag.box(w * 2, bh, d * 2, PAPER, tx, y + bh / 2, tz, ry);
      for (let k = 3; k < bh; k += 3.5) rim(w, d, y + k, ry, tx, tz);
      y += bh; top = ry;
    }
    const col = i % 4, row = Math.floor((i % 12) / 4);
    const g = new THREE.PlaneGeometry(w * 2 - 3, d * 2 - 3).rotateX(-Math.PI / 2).rotateY(Math.PI + top).translate(tx, y + 0.25, tz);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) * page, 1 - (row + 1 - uv.getY(k)) * tall);
    tops.push(g);
    return new THREE.Vector3(tx, y + 1, tz);
  });
  const merged = new THREE.BufferGeometry();
  const pos = [], uvs = [];
  for (const g of tops) { const n = g.toNonIndexed(); pos.push(...n.attributes.position.array); uvs.push(...n.attributes.uv.array); }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  model.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false })));

  // loose sheets everywhere
  for (let i = 0; i < 150; i++) {
    const a = rng() * Math.PI * 2, r = 40 + rng() * 480, x = Math.cos(a) * r - 80, z = Math.sin(a) * r;
    if (x > 200 || Math.hypot(x, z) > 600) continue;
    bag.box(9, 0.3, 12, PAPER, x, 3 + rng() * 0.4, z, rng() * 6, false);
  }
  return landing;
}

function buildGround(bag, hatch, rng) {
  bag.lathe([[640, 0], [632, 2.2], [0.1, 2.6]], SAND, 0, 0, 0, 72, false);
  const ring = [
    [-520, 130, 220, 40, PEACH, CORAL], [-470, 330, 300, 52, LILAC, VIOLET], [-250, 520, 260, 44, CORAL, MUSTARD], [-40, 560, 340, 56, PEACH, VIOLET],
    [190, 540, 240, 40, TEAL, MINT], [-560, -110, 150, 30, TEAL, CORAL], [-430, -300, 120, 26, LILAC, MUSTARD],
  ];
  ring.forEach(([x, z, h, r, color, cap], i) => rock(bag, hatch, rng, { x, z, h, r, color, cap, lean: 0.05 + (i % 3) * 0.06, leanAt: i * 1.7 }));
  for (let i = 0; i < 300; i++) {
    const a = rng() * Math.PI * 2, d = 30 + rng() * 590, x = Math.cos(a) * d, z = Math.sin(a) * d, l = 3 + rng() * 14;
    if (x > 240) continue;
    hatch.push(x - l, 2.8, z, x + l, 2.8, z + rng() * 2);
  }
}

// ---------------------------------------------------------------- placing it
export function buildPaperMachine(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const g = new THREE.Group();
  g.rotation.y = -(rec.heading ?? 0) * DEG;
  site.add(g);
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  g.add(model);

  const rng = mulberry32(5300), bag = new Bag(), hatch = [];
  buildGround(bag, hatch, rng);
  buildForest(bag, rng);
  const curve = beltCurve(), belt = buildBelt(bag, curve);
  const tree = buildTree(model), saw = buildSaw(model, bag);
  const mill = buildMill(model, bag, rng);
  const frame = buildMainframe(model);
  const landing = buildStacks(model, bag, hatch, rng);
  bag.build(model);
  lines(model, hatch, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 }));
  site.updateMatrixWorld(true);

  // one log and one ream for every place on the belt
  const logBag = new Bag(), logProto = new THREE.Group();
  logBag.add(new THREE.CylinderGeometry(3.4, 2.4, 56, 9).rotateX(Math.PI / 2), BARK, { ink: false });
  logBag.add(new THREE.CylinderGeometry(3.3, 3.3, 0.5, 9).rotateX(Math.PI / 2), PEACH, { z: 28 });
  logBag.build(logProto);
  const reamBag = new Bag(), reamProto = new THREE.Group();
  reamBag.box(30, 12, 22, PAPER, 0, 0, 0);
  reamBag.box(30.6, 12.6, 7, CORAL, 0, 0, 0);
  reamBag.build(reamProto);
  const items = Array.from({ length: Math.ceil(belt / SPACING) + 1 }, () => {
    const log = logProto.clone(), ream = reamProto.clone();
    model.add(log, ream);
    return { log, ream };
  });

  // sheets in the air
  const sheetTex = canvasTexture(128, 170, (c, w, h) => titlePage(c, 0, 0, w, h, ['', ''], rng));
  const sheets = new THREE.InstancedMesh(new THREE.PlaneGeometry(18, 24), new THREE.MeshBasicMaterial({ map: sheetTex, side: THREE.DoubleSide, toneMapped: false }), SHEETS);
  sheets.frustumCulled = false;
  model.add(sheets);
  const flight = Array.from({ length: SHEETS }, (_, i) => ({ to: landing[i % landing.length], spin: 2 + rng() * 3, side: rng() < 0.5 ? -1 : 1 }));

  const palette = [TEAL, CORAL, MUSTARD, MINT, CREAM].map((c) => new THREE.Color(c)), off = new THREE.Color(0x2a2a3a);
  const along = new THREE.Vector3(0, 0, 1), tilt = new THREE.Euler(), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), w = new THREE.Vector3(), s3 = new THREE.Vector3();
  let flow = 0, sinceLamps = 1, seen = true, show = null, rate = 1;
  frame.mesh.onBeforeRender = () => { seen = true; };

  // Everything is a function of flow; only the lamps and reels need the time step too.
  const pose = (dt) => {
    const cycle = flow / CYCLE, k = cycle - Math.floor(cycle), n = Math.floor(cycle);

    // grow, get cut, fall, have its top taken off
    const grown = smooth(0, 0.3, k), cut = smooth(0.34, 0.5, k), fall = smooth(0.5, 0.74, k) ** 2, strip = smooth(0.76, 0.9, k);
    tree.g.scale.setScalar(0.04 + 0.96 * grown);
    tree.g.rotation.z = fall * Math.PI / 2;
    tree.g.position.y = 8 + fall * 6;
    tree.top.scale.setScalar(1 - strip);
    tree.top.visible = strip < 1;
    tree.g.visible = k < 0.995;
    saw.arm.rotation.y = 0.85 - 1.7 * cut + 1.7 * smooth(0.6, 0.98, k);
    saw.arm.position.y = 26 + 22 * (1 - smooth(0.2, 0.36, k) + smooth(0.56, 0.7, k));
    saw.blade.rotation.y += dt * (cut > 0 && cut < 1 ? 30 : 9) * Math.max(rate, 1);

    // the belt
    items.forEach((it, i) => {
      const u = ((i + k) * SPACING) / belt;
      it.log.visible = false; it.ream.visible = false;
      if (u >= 1) return;
      curve.getPointAt(u, v);
      const part = v.z < MILL_IN - 4 ? it.log : v.z > MILL_OUT ? it.ream : null;
      if (!part) return;
      part.visible = true;
      part.position.copy(v); part.position.y += part === it.log ? 3.4 : 6;
      curve.getTangentAt(u, w);
      part.quaternion.setFromUnitVectors(along, w);
    });
    const spin = flow * 3;
    mill.rollers.forEach((r, i) => { r.rotation.x = i % 2 ? -spin : spin; });
    for (let i = 0; i < 20; i++) {
      const a = (flow * 0.12 + i / 20) % 1, from = mill.steam[i % 2], j = mill.puffs.userData.jitter[i];
      v.set(from.x + Math.sin(j) * a * 34 + a * a * 60, from.y + a * 150, from.z + Math.cos(j) * a * 34);
      mx.compose(v, q.identity(), s3.setScalar(6 + a * 26 * (1 - a * a * a)));
      mill.puffs.setMatrixAt(i, mx);
    }
    mill.puffs.instanceMatrix.needsUpdate = true;

    // the mainframe: tapes turn, lamps chatter, and it all gets frantic in a show
    frame.reels.forEach((r, i) => { r.rotation.z += dt * (i % 3 === 0 ? -1 : 1) * (0.9 + (i % 5) * 0.3) * Math.min(rate, 5) * 1.4; });
    sinceLamps += dt;
    if (sinceLamps > (show ? 0.05 : 0.22)) {
      sinceLamps = 0;
      for (let i = 0; i < frame.count; i++) if (rng() < 0.3) frame.lamps.setColorAt(i, rng() < (show ? 0.8 : 0.45) ? palette[Math.floor(rng() * 5)] : off);
      frame.lamps.instanceColor.needsUpdate = true;
    }
    frame.carriage.position.x = PRINTER.x + Math.sin(flow * 7) * 60;

    // the sheets: a long floating arc from the printer to a stack
    for (let i = 0; i < SHEETS; i++) {
      const a = ((flow + i * SHEET) % (SHEETS * SHEET)) / (SHEETS * SHEET), fl = flight[i], e = a * (2 - a);
      v.lerpVectors(PRINTER, fl.to, e);
      v.y += Math.sin(a * Math.PI) * (90 + i * 6);
      v.x += Math.sin(a * 9 + i) * 8 * (1 - a) * fl.side;
      tilt.set(-Math.PI / 2 + Math.sin(a * fl.spin * 4) * 0.9 * (1 - a), a * fl.spin * fl.side, Math.cos(a * fl.spin * 3) * 0.6 * (1 - a));
      mx.compose(v, q.setFromEuler(tilt), s3.setScalar(a > 0.985 ? 0 : 1));
      sheets.setMatrixAt(i, mx);
    }
    sheets.instanceMatrix.needsUpdate = true;
    return n;
  };
  frame.say(['METAMERS (LLM)', 'READY.', '53 PAPERS IN HOPPER.']);
  pose(0);

  site.userData.update = (dt) => {
    if (!seen && !show) return;
    seen = false;
    if (!show) { flow += dt; rate = 1; }
    pose(dt);
  };
  site.userData.labelPos = new THREE.Vector3(0, 300, -340);
  site.userData.labelRange = 6000;

  const toWorld = (p) => p.clone().applyMatrix4(model.matrixWorld);
  const axes = new THREE.Matrix4().extractRotation(g.matrixWorld);
  const upWorld = new THREE.Vector3(0, 1, 0).applyMatrix4(axes);
  const VIEWPOINT = new THREE.Vector3(0, rec.viewAlt ?? 200, -(rec.viewBack ?? 420));
  const aim = new THREE.PerspectiveCamera(); // a camera, so lookAt points its -z

  // The camera, in model space, as the show goes on.
  const shot = (t, hero, pos, look) => {
    curve.getPointAt(Math.min(1, hero / belt), v);
    const out = smooth(0, 60, v.z) * (1 - smooth(230, 300, v.z)); // out alongside the mill while the hero's inside
    pos.set(v.x - 30 - 130 * out, v.y + 34 + 90 * out, v.z - 62);
    look.copy(v).setZ(v.z + 26);
    const wait = smooth(2.1, 2.9, t);
    pos.lerp(w.set(248, 30, -262), 1 - wait);
    look.lerp(s3.set(322, 30, -180), 1 - wait);
    const front = smooth(6.8, 8, t);
    pos.lerp(w.set(-70, 50, 44), front);
    look.lerp(s3.set(-70, 58, 320), front);
  };

  site.userData.paperMachine = {
    site,
    url: rec.url || PAPER_URL,
    hit: frame.mesh,
    center: toWorld(new THREE.Vector3()),
    view() {
      const pos = toWorld(VIEWPOINT);
      return { pos, look: toWorld(new THREE.Vector3(0, 46, 270)).sub(pos).normalize() };
    },
    start(camera, caption) {
      // jump to a tree that's just grown, so it falls once the camera gets there
      const zero = (Math.floor(flow / CYCLE) + 2) * CYCLE;
      const paper = PAPERS[Math.floor(Math.random() * PAPERS.length)];
      const tex = canvasTexture(1024, 1366, (c, w2, h) => titlePage(c, 0, 0, w2, h, paper, rng));
      const page = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.33), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthTest: false, transparent: true }));
      page.visible = false; page.renderOrder = 10;
      site.parent.add(page);
      show = { t: 0, zero, from: camera.position.clone(), fromQ: camera.quaternion.clone(), page, caption, line: 0 };
      flow = zero - CYCLE * (1 - felling(0));
    },
    // returns true when the page has filled the screen
    step(dt, camera) {
      show.t += dt;
      const { t, zero } = show;
      // the tree is cut and falls in the first two seconds; then the hero rides the belt
      const k = Math.min(1, (t - 2) / 5.2), hero = t < 2 ? 0 : belt * (0.25 * k + 0.75 * smooth(0, 1, k));
      const next = t < 2 ? zero - CYCLE * (1 - felling(t)) : zero + (hero / SPACING) * CYCLE + Math.max(0, t - 7.2) * 6;
      rate = (next - flow) / Math.max(dt, 1e-3);
      flow = next;
      if (show.line < CAPTIONS.length && t >= CAPTIONS[show.line][0]) show.caption(CAPTIONS[show.line++][1]);
      if (t > 6.5 && !show.printing) { show.printing = true; frame.say(['GENERATING PAPER', 'DERIVATIVE OUTPUT', '> PRINTING...']); }

      const p = new THREE.Vector3(), l = new THREE.Vector3();
      shot(t, hero, p, l);
      const wp = toWorld(p), wl = toWorld(l);
      aim.position.copy(wp); aim.up.copy(upWorld); aim.lookAt(wl);
      const e = smooth(0, 0.9, t);
      camera.up.copy(upWorld);
      camera.position.lerpVectors(show.from, wp, e);
      camera.quaternion.slerpQuaternions(show.fromQ, aim.quaternion, e);

      // the last sheet comes straight for the camera
      if (t > 8.2) {
        const a = smooth(8.2, 9.6, t) ** 2, d = 0.5 + camera.near, fill = 2.6 * d * Math.tan((camera.fov * DEG) / 2) * Math.max(1, camera.aspect);
        const here = camera.position.clone().add(new THREE.Vector3(0, 0, -d).applyQuaternion(camera.quaternion));
        const { page } = show;
        page.visible = true;
        page.position.lerpVectors(toWorld(PRINTER), here, a);
        page.quaternion.copy(camera.quaternion);
        page.rotateZ((1 - a) * 1.4);
        page.scale.setScalar(THREE.MathUtils.lerp(26, fill, a));
      }
      return t >= LENGTH;
    },
    get flash() { return show ? smooth(LENGTH - FLASH, LENGTH, show.t) : 0; },
    stop() {
      if (!show) return;
      show.page.parent?.remove(show.page);
      show.page.material.map.dispose(); show.page.material.dispose(); show.page.geometry.dispose();
      show.caption('');
      frame.say(['METAMERS (LLM)', 'READY.', '53 PAPERS IN HOPPER.']);
      show = null;
    },
  };
  return site;
}
