// The ThingSynth stage: a round platform, and far down a long avenue the painting
// Golden Pyramid With Tunnel Celebration in a gold frame on a stepped temple, and a
// Hammond-style console with a Leslie speaker whose rotors turn. The 17 keys are
// the ones ThingSynth plays from a computer keyboard, and giant cognitive hands
// play them. The organist sits at the +z side and looks along -z, the record's
// heading, down a long avenue at the painting.
import * as THREE from 'three';
import { R, tangentFrame } from './planet.js';
import { buildMirrorSea, inkOver } from './stageScenes.js';
import { OrganHands } from './organHands.js';
import { KEY_HEIGHT } from './hands/instrument/layout.js';

const DEG = Math.PI / 180;
export const PAINTING_URL = './stage/golden-pyramid-with-tunnel-celebration.jpg';
const PAINTING = 760;              // metres square, the whole image
const TIERS = 11, TIER = 27;       // the temple's steps
const PAINTING_BOTTOM = TIERS * TIER + 18;
const PAINTING_Z = -1560;          // across open water, for a grand view from the seat
const ORGAN_Z = 70;
const HAND_SCALE = 600;            // the 10 white keys span about 114 m

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });
const WALNUT = std(0xa66a35, { roughness: 0.45 }), WALNUT_DARK = std(0x6f4522, { roughness: 0.5 });
const GOLD = std(0xd4a437, { metalness: 0.75, roughness: 0.35 });
const BLACK = std(0x15130f, { roughness: 0.35 }), CHROME = std(0xc9ccd2, { metalness: 0.85, roughness: 0.3 });
const glow = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
function box(parent, w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(parent, r1, r2, h, material, x, y, z, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// many boxes of one geometry: [x, y, z, w, h, d, colour?]
function boxes(parent, list, material) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  list.forEach(([x, y, z, w, h, d, color], i) => {
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, m);
    if (color != null) mesh.setColorAt(i, c.set(color));
  });
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------- platform
function buildPlatform(g) {
  cyl(g, 228, 232, 6, std(0x2c1b12, { roughness: 0.6 }), 0, 3, 0, 72);
  cyl(g, 214, 214, 0.6, std(0x6e4a2c, { roughness: 0.4 }), 0, 6.2, 0, 72);
  // a pale causeway running from the stage to the temple
  box(g, 150, 1.6, -PAINTING_Z - 700, std(0xf4dfc4, { roughness: 0.9 }), 0, 1, PAINTING_Z / 2 - 350);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(229, 1.4, 8, 96).rotateX(Math.PI / 2), GOLD);
  trim.position.y = 6;
  g.add(trim);
}

// ---------------------------------------------------------------- painting
function buildPainting(g) {
  const y = PAINTING_BOTTOM + PAINTING / 2, z = PAINTING_Z;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  new THREE.TextureLoader().load(PAINTING_URL, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    mat.map = tex;
    mat.needsUpdate = true;
  });
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(PAINTING, PAINTING), mat);
  canvas.position.set(0, y, z);
  g.add(canvas);
  box(g, PAINTING + 4, PAINTING + 4, 3, std(0x101010), 0, y, z - 2);
  // the frame: four gold bars with an inner lip
  const t = 16, o = PAINTING / 2 + t / 2;
  for (const [w, h, x, yy] of [[PAINTING + 2 * t, t, 0, y + o], [PAINTING + 2 * t, t, 0, y - o], [t, PAINTING, -o, y], [t, PAINTING, o, y]]) {
    box(g, w, h, 12, GOLD, x, yy, z);
  }
  const lip = 3, l = PAINTING / 2 + lip / 2;
  for (const [w, h, x, yy] of [[PAINTING, lip, 0, y + l - lip], [PAINTING, lip, 0, y - l + lip], [lip, PAINTING, -l + lip, y], [lip, PAINTING, l - lip, y]]) {
    box(g, w, h, 3, WALNUT_DARK, x, yy, z + 3);
  }
  return { center: canvas.position.clone(), size: PAINTING };
}

// ---------------------------------------------------------------- temple
// A stepped temple carrying the painting, with twin ranks of spires on each side.
function buildTemple(g) {
  const z = PAINTING_Z, a = std(0xefd2b8, { roughness: 0.8 }), b = std(0xc98a7c, { roughness: 0.8 });
  for (let i = 0; i < TIERS; i++) box(g, 1500 - i * 76, TIER, 1000 - i * 60, i % 2 ? b : a, 0, TIER * (i + 0.5), z);
  const purple = std(0x7a4a93), lilac = std(0xa56aa8), gold = std(0xffb347);
  for (const x of [-1020, -780, 780, 1020]) {
    for (let k = 0; k < 4; k++) cyl(g, 80 - k * 15, 96 - k * 15, 170, k % 2 ? purple : lilac, x, 85 + k * 170, z + 260, 8);
    cyl(g, 0, 22, 340, gold, x, 850, z + 260, 8);
  }
}

// ---------------------------------------------------------------- organ
function buildOrgan(g) {
  const organ = new THREE.Group();
  organ.position.set(0, 6, ORGAN_Z);
  g.add(organ);
  const W = 156, D = 90, TOP = 104;
  box(organ, W, 52, D, WALNUT, 0, 70, -24);              // cabinet, under the keys
  box(organ, W, 46, 48, WALNUT, 0, TOP + 16, -46);       // the raised back
  box(organ, W + 8, 5, 58, WALNUT_DARK, 0, TOP + 41, -46); // lid
  for (const s of [-1, 1]) {
    box(organ, 8, 50, D + 28, WALNUT_DARK, s * (W / 2 + 2), TOP - 6, -10); // cheek blocks
    box(organ, 14, 62, 24, WALNUT_DARK, s * 58, 31, -24);                  // lyre legs
    box(organ, 56, 6, 34, WALNUT_DARK, s * 58, 3, -24);
  }
  box(organ, W, 8, 66, BLACK, 0, TOP - 4, 4);            // key bed
  const hands = new OrganHands(HAND_SCALE);
  hands.group.position.set(0, TOP + KEY_HEIGHT * HAND_SCALE, 2);
  organ.add(hands.group);
  // two sets of nine drawbars, coloured like the real thing
  const bars = [];
  const colours = [0x6b2f1f, 0x6b2f1f, 0xf1ece0, 0xf1ece0, 0x15130f, 0xf1ece0, 0x15130f, 0x15130f, 0xf1ece0];
  for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) {
    const x = sx * (12 + i * 6.6), out = 4 + ((i * 7 + (sx > 0 ? 3 : 5)) % 6) * 2.4;
    bars.push([x, TOP + 22, -22 + out / 2, 3.6, 3.6, out + 2, colours[i]]);
    bars.push([x, TOP + 22, -21 + out, 5, 6, 2.6, colours[i]]);
  }
  boxes(organ, bars, std(0xffffff, { roughness: 0.4 }));
  box(organ, 128, 12, 1.6, CHROME, 0, TOP + 22, -21.8);
  const tabs = [];
  for (let i = 0; i < 8; i++) tabs.push([-68 + i * 4.8 - (i > 3 ? 0 : 0), TOP + 8, -21.5, 3.4, 6, 2.4, i % 3 ? 0xf1ece0 : 0xc8352b]);
  boxes(organ, tabs, std(0xffffff));
  cyl(organ, 1.8, 1.8, 2, glow(0xff5a3a), 68, TOP + 8, -21.5, 12).rotation.x = Math.PI / 2;

  // Leslie speaker: louvred cabinet, spinning horn on top and drum below
  const leslie = new THREE.Group();
  leslie.position.set(160, 6, ORGAN_Z - 30);
  g.add(leslie);
  box(leslie, 78, 168, 58, WALNUT, 0, 84, 0);
  box(leslie, 84, 5, 64, WALNUT_DARK, 0, 170, 0);
  for (const y of [40, 132]) box(leslie, 62, 56, 2, BLACK, 0, y, 29);
  const louvres = [];
  for (const y of [40, 132]) for (let i = -2; i <= 2; i++) louvres.push([0, y + i * 10, 30.5, 62, 3, 1.6]);
  boxes(leslie, louvres, WALNUT_DARK);
  const horn = new THREE.Group();
  horn.position.set(0, 132, 12);
  leslie.add(horn);
  cyl(horn, 3, 3, 18, CHROME, 0, 0, 0, 12);
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(9, 28, 16, 1, true).rotateZ(s * Math.PI / 2), CHROME);
    h.material.side = THREE.DoubleSide;
    h.position.set(-s * 16, 3, 0);
    horn.add(h);
  }
  const drum = new THREE.Group();
  drum.position.set(0, 40, 12);
  leslie.add(drum);
  cyl(drum, 22, 22, 26, std(0x8a6a3a), 0, 0, 0, 24);
  box(drum, 46, 4, 4, CHROME, 0, 0, 0);
  return { organ, horn, drum, hands };
}

// Place the stage on its levelled site. `f` is the site feature.
export function buildOrganStage(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const g = new THREE.Group();
  g.rotation.y = -(rec.heading ?? 0) * DEG; // the organist looks along the heading
  site.add(g);

  buildPlatform(g);
  const monument = new THREE.Group();
  g.add(monument);
  const painting = buildPainting(monument);
  buildTemple(monument);
  const { horn, drum, hands } = buildOrgan(g);
  inkOver(g, [hands.group]);
  // the Mirror Sea shows only while seated
  const scene = buildMirrorSea(monument);
  scene.visible = false;
  g.add(scene);
  site.updateMatrixWorld(true);

  site.userData.update = (dt) => { if (scene.visible) scene.userData.update(dt); hands.update(dt); horn.rotation.y += dt * 1.1; drum.rotation.y -= dt * 0.8; };
  site.userData.labelPos = new THREE.Vector3(0, 320, 0);
  site.userData.labelRange = 9000;
  const toWorld = (v) => v.clone().applyMatrix4(g.matrixWorld);
  site.userData.organStage = {
    site,
    painting,
    hands,
    center: site.position.clone(),
    setScene(on) { scene.visible = on; },
    // world-space corners of the painting: top left, top right, bottom right, bottom left
    corners() {
      const h = PAINTING / 2, c = painting.center;
      return [[-h, h], [h, h], [h, -h], [-h, -h]].map(([x, y]) => toWorld(new THREE.Vector3(c.x + x, c.y + y, c.z)));
    },
    seatView(aspect) {
      // back off on narrow screens so the keyboards still fit
      const k = Math.max(1, 1.2 / aspect);
      return this.view(0, 285 + 90 * (k - 1), 90 + 300 * k, 0, 270, 90);
    },
    // a camera pose in the stage's frame, in world space
    view(x, y, z, tx, ty, tz) {
      const pos = toWorld(new THREE.Vector3(x, y, z));
      return { pos, look: toWorld(new THREE.Vector3(tx, ty, tz)).sub(pos).normalize() };
    },
  };
  return site;
}
