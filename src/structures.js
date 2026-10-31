// Procedural low-poly structure library. Each builder returns a THREE.Group whose
// local +Y is up, base at y = 0, "front" facing local +Z, sized in world units.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { R, latLonToDir, tangentFrame } from './planet.js';
import { buildVolcano, buildRoad, buildWoodland } from './featureMeshes.js';
import { buildCoaster } from './coaster.js';
import { buildCatapult } from './catapult.js';
import { buildGraffitiGarden } from './graffiti.js';
import { buildMushroomTree } from './mushroomTree.js';
import { buildComputer } from './computer.js';
import { buildOrganStage } from './organStage.js';
import { buildBlueprint } from './blueprint.js';

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const CYL = (seg = 8) => geo('cyl' + seg, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg));
const CONE = (seg = 8) => geo('cone' + seg, () => new THREE.ConeGeometry(0.5, 1, seg));
const SPHERE = () => geo('sphere', () => new THREE.SphereGeometry(0.5, 10, 7));
const PYR = () => geo('pyr', () => { const g = new THREE.ConeGeometry(0.7071, 1, 4); g.rotateY(Math.PI / 4); return g; });

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });
}
function mesh(g, m, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.rotation.y = ry;
  return o;
}
function shade(color, f) { return color.clone().multiplyScalar(f); }
const ROOF = new THREE.Color(0x8c3b2a);
const WOOD = new THREE.Color(0x6b4a2b);
const STONE = new THREE.Color(0x8d8a80);
const LEAF = new THREE.Color(0x2f7a32);
const LEAF2 = new THREE.Color(0x4f9a3a);

// ---------------------------------------------------------------- pieces
function house(color, rng, w = 4, d = 5, h = 3) {
  const g = new THREE.Group();
  g.add(mesh(BOX(), mat(color), 0, h / 2, 0, w, h, d));
  const roof = mesh(PYR(), mat(ROOF), 0, h + 1.2, 0, w * 1.15, 2.4, d * 1.15);
  g.add(roof);
  return g;
}
function tree(rng, kind = 'pine') {
  const g = new THREE.Group();
  const s = 0.8 + rng() * 0.6;
  g.add(mesh(CYL(6), mat(WOOD), 0, 1.5 * s, 0, 0.6 * s, 3 * s, 0.6 * s));
  if (kind === 'pine') {
    g.add(mesh(CONE(7), mat(LEAF), 0, 4.5 * s, 0, 3.2 * s, 5 * s, 3.2 * s));
    g.add(mesh(CONE(7), mat(shade(LEAF, 1.15)), 0, 6.5 * s, 0, 2.4 * s, 4 * s, 2.4 * s));
  } else {
    g.add(mesh(SPHERE(), mat(LEAF2), 0, 4.5 * s, 0, 4 * s, 3.6 * s, 4 * s));
  }
  return g;
}
function towerPiece(color, r = 2, h = 12, crenel = true) {
  const g = new THREE.Group();
  g.add(mesh(CYL(10), mat(color), 0, h / 2, 0, r * 2, h, r * 2));
  if (crenel) {
    g.add(mesh(CYL(10), mat(shade(color, 0.85)), 0, h + 0.5, 0, r * 2.4, 1, r * 2.4));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(mesh(BOX(), mat(shade(color, 0.8)), Math.cos(a) * r * 1.05, h + 1.5, Math.sin(a) * r * 1.05, 0.8, 1, 0.8));
    }
  } else {
    g.add(mesh(CONE(10), mat(ROOF), 0, h + 2, 0, r * 2.6, 4, r * 2.6));
  }
  return g;
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
// Spheres strung along a curve with a tapering radius (necks, tails, trunks).
function beads(group, curve, count, r0, r1, m) {
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const p = curve.getPoint(t);
    const r = r0 + (r1 - r0) * t;
    group.add(mesh(SPHERE(), m, p.x, p.y, p.z, r * 2, r * 2, r * 2));
  }
}

// ---------------------------------------------------------------- builders
export const STRUCTURES = {
  house: { label: 'House', build: (c, rng) => house(c, rng) },
  hut: {
    label: 'Hut', build: (c, rng) => {
      const g = new THREE.Group();
      g.add(mesh(CYL(8), mat(c), 0, 1.2, 0, 3.5, 2.4, 3.5));
      g.add(mesh(CONE(8), mat(new THREE.Color(0xb59a5a)), 0, 3.6, 0, 4.6, 2.6, 4.6));
      return g;
    },
  },
  village: {
    label: 'Village', build: (c, rng) => {
      const g = new THREE.Group();
      const n = 6 + Math.floor(rng() * 5);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, r = 4 + rng() * 14;
        const h = house(shade(c, 0.85 + rng() * 0.3), rng, 3 + rng() * 2, 3.5 + rng() * 2.5, 2.5 + rng());
        h.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        h.rotation.y = rng() * Math.PI * 2;
        g.add(h);
      }
      for (let i = 0; i < 5; i++) {
        const t = tree(rng, 'round'); const a = rng() * Math.PI * 2, r = 16 + rng() * 8;
        t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.add(t);
      }
      return g;
    },
  },
  town: {
    label: 'Town', build: (c, rng) => {
      const g = new THREE.Group();
      const size = 5;
      for (let i = -size; i <= size; i++) for (let j = -size; j <= size; j++) {
        if (rng() < 0.25) continue;
        const h = 3 + rng() * 10;
        const b = mesh(BOX(), mat(shade(c, 0.8 + rng() * 0.4)), i * 6, h / 2, j * 6, 4 + rng(), h, 4 + rng());
        g.add(b);
      }
      const t = towerPiece(shade(c, 0.9), 2.5, 30, false); g.add(t);
      return g;
    },
  },
  city: {
    label: 'City', build: (c, rng) => {
      const g = new THREE.Group();
      const size = 8;
      for (let i = -size; i <= size; i++) for (let j = -size; j <= size; j++) {
        if (rng() < 0.15) continue;
        const dist = Math.hypot(i, j) / size;
        const h = 4 + rng() * 8 + Math.max(0, 1 - dist) * 50 * rng();
        g.add(mesh(BOX(), mat(shade(c, 0.75 + rng() * 0.5), { metalness: 0.2, roughness: 0.6 }), i * 7, h / 2, j * 7, 4.5 + rng() * 1.5, h, 4.5 + rng() * 1.5));
      }
      return g;
    },
  },
  tower: { label: 'Tower', build: (c) => towerPiece(c, 2.5, 18, true) },
  castle: {
    label: 'Castle', build: (c, rng) => {
      const g = new THREE.Group();
      const w = 28, wallH = 7;
      const m = mat(c);
      g.add(mesh(BOX(), m, 0, wallH / 2, w / 2, w, wallH, 2));
      g.add(mesh(BOX(), m, 0, wallH / 2, -w / 2, w, wallH, 2));
      g.add(mesh(BOX(), m, w / 2, wallH / 2, 0, 2, wallH, w));
      g.add(mesh(BOX(), m, -w / 2, wallH / 2, 0, 2, wallH, w));
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const t = towerPiece(shade(c, 0.9), 3, 14, true); t.position.set(x * w / 2, 0, z * w / 2); g.add(t);
      }
      const keep = towerPiece(shade(c, 0.95), 5, 22, true); g.add(keep);
      const gate = mesh(BOX(), mat(WOOD), 0, 2.5, w / 2, 5, 5, 2.4); g.add(gate);
      return g;
    },
  },
  lighthouse: {
    label: 'Lighthouse', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(CYL(10), mat(new THREE.Color(0xf2f2f2)), 0, 9, 0, 5, 18, 5));
      for (let i = 0; i < 3; i++) g.add(mesh(CYL(10), mat(new THREE.Color(0xd33a2a)), 0, 3 + i * 6, 0, 5.1, 2, 5.1));
      g.add(mesh(CYL(10), mat(new THREE.Color(0xffe680), { emissive: 0xffd040, emissiveIntensity: 1.2 }), 0, 19.5, 0, 3.5, 3, 3.5));
      g.add(mesh(CONE(10), mat(new THREE.Color(0x333333)), 0, 22, 0, 4.5, 2, 4.5));
      return g;
    },
  },
  windmill: {
    label: 'Windmill', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(CYL(8), mat(c), 0, 5, 0, 5, 10, 4));
      g.add(mesh(CONE(8), mat(ROOF), 0, 11, 0, 5.5, 2.5, 5.5));
      const hub = new THREE.Group(); hub.position.set(0, 9, 2.6); hub.name = 'spin';
      for (let i = 0; i < 4; i++) {
        const b = mesh(BOX(), mat(new THREE.Color(0xe8dcc0)), 0, 4, 0, 1.2, 8, 0.2);
        const holder = new THREE.Group(); holder.rotation.z = (i / 4) * Math.PI * 2; holder.add(b); hub.add(holder);
      }
      g.add(hub);
      return g;
    },
  },
  temple: {
    label: 'Temple', build: (c) => {
      const g = new THREE.Group();
      const m = mat(c);
      g.add(mesh(BOX(), m, 0, 0.75, 0, 22, 1.5, 14));
      g.add(mesh(BOX(), m, 0, 2, 0, 20, 1, 12));
      for (let i = 0; i < 6; i++) for (const z of [-4.5, 4.5]) g.add(mesh(CYL(10), m, -8 + i * 3.2, 6.5, z, 1.2, 8, 1.2));
      g.add(mesh(BOX(), m, 0, 11, 0, 20, 1.2, 12));
      g.add(mesh(PYR(), mat(shade(c, 0.9)), 0, 13, 0, 20, 2.8, 12));
      return g;
    },
  },
  pyramid: {
    label: 'Pyramid', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(PYR(), mat(c), 0, 10, 0, 30, 20, 30));
      g.add(mesh(PYR(), mat(new THREE.Color(0xf0d060), { metalness: 0.5, roughness: 0.3 }), 0, 20.5, 0, 2.5, 1.6, 2.5));
      return g;
    },
  },
  obelisk: {
    label: 'Obelisk', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(BOX(), mat(c), 0, 0.5, 0, 5, 1, 5));
      const shaft = mesh(CYL(4), mat(c), 0, 11, 0, 1.6, 20, 1.6); shaft.rotation.y = Math.PI / 4; shaft.geometry = geo('obelisk', () => new THREE.CylinderGeometry(0.3, 0.6, 1, 4));
      g.add(shaft);
      g.add(mesh(PYR(), mat(shade(c, 0.9)), 0, 21.6, 0, 1.4, 1.4, 1.4));
      return g;
    },
  },
  dome: {
    label: 'Dome', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(CYL(16), mat(c), 0, 3, 0, 16, 6, 16));
      g.add(mesh(geo('halfSphere', () => new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mat(shade(c, 1.1), { metalness: 0.3, roughness: 0.5 }), 0, 6, 0, 16, 16, 16));
      return g;
    },
  },
  tree: { label: 'Tree', build: (c, rng) => tree(rng, rng() < 0.5 ? 'pine' : 'round') },
  forest: {
    label: 'Forest', build: (c, rng) => {
      const g = new THREE.Group();
      const kind = rng() < 0.5 ? 'pine' : 'round';
      for (let i = 0; i < 40; i++) {
        const t = tree(rng, kind); const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 28;
        t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); t.rotation.y = rng() * 6; g.add(t);
      }
      return g;
    },
  },
  farm: {
    label: 'Farm', build: (c, rng) => {
      const g = new THREE.Group();
      g.add(house(c, rng, 4, 6, 3));
      const barn = house(new THREE.Color(0xa33a2a), rng, 6, 9, 4); barn.position.set(12, 0, 2); g.add(barn);
      for (let i = 0; i < 3; i++) g.add(mesh(BOX(), mat(new THREE.Color(i % 2 ? 0x9bb54a : 0xc9a84c)), -14 + i * 0, 0.15, -14 - i * 7, 24, 0.3, 6));
      return g;
    },
  },
  beacon: {
    label: 'Beacon', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(CYL(6), mat(STONE), 0, 1, 0, 4, 2, 4));
      g.add(mesh(CYL(6), mat(new THREE.Color(0xcccccc), { metalness: 0.6, roughness: 0.4 }), 0, 15, 0, 0.6, 28, 0.6));
      g.add(mesh(SPHERE(), mat(c, { emissive: c, emissiveIntensity: 2 }), 0, 30, 0, 3, 3, 3));
      return g;
    },
  },
  flag: {
    label: 'Flag', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(CYL(6), mat(new THREE.Color(0xdddddd)), 0, 5, 0, 0.3, 10, 0.3));
      g.add(mesh(BOX(), mat(c, { side: THREE.DoubleSide }), 2.2, 8.5, 0, 4.4, 2.6, 0.08));
      return g;
    },
  },
  wall: {
    label: 'Wall (40 long)', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(BOX(), mat(c), 0, 3, 0, 40, 6, 2.5));
      for (let i = 0; i < 9; i++) g.add(mesh(BOX(), mat(shade(c, 0.85)), -20 + i * 5, 6.6, 0, 2, 1.2, 2.7));
      return g;
    },
  },
  bridge: {
    label: 'Bridge (60 long)', span: true, build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(BOX(), mat(c), 0, 5.5, 0, 60, 1, 6));
      for (let i = 0; i < 5; i++) g.add(mesh(BOX(), mat(shade(c, 0.85)), -24 + i * 12, 2.5, 0, 2.5, 6, 6));
      for (const z of [-2.8, 2.8]) g.add(mesh(BOX(), mat(shade(c, 0.8)), 0, 6.6, z, 60, 1.2, 0.3));
      return g;
    },
  },
  ship: {
    label: 'Ship', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(BOX(), mat(WOOD), 0, 1, 0, 6, 2, 16));
      g.add(mesh(BOX(), mat(shade(WOOD, 1.2)), 0, 2.5, -4, 5, 1.2, 6));
      g.add(mesh(CYL(6), mat(WOOD), 0, 9, 1, 0.5, 14, 0.5));
      g.add(mesh(BOX(), mat(c, { side: THREE.DoubleSide }), 0, 10, 1.3, 8, 6, 0.1));
      return g;
    },
  },
  monolith: {
    label: 'Monolith', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(BOX(), mat(new THREE.Color(0x111111), { metalness: 0.9, roughness: 0.2 }), 0, 9, 0, 4, 18, 1));
      return g;
    },
  },
  arch: {
    label: 'Arch', build: (c) => {
      const g = new THREE.Group();
      g.add(mesh(BOX(), mat(c), -7, 7, 0, 3, 14, 3));
      g.add(mesh(BOX(), mat(c), 7, 7, 0, 3, 14, 3));
      g.add(mesh(BOX(), mat(shade(c, 0.9)), 0, 15, 0, 20, 3, 3.5));
      return g;
    },
  },
  dinosaur: {
    label: 'Dinosaur monument', build: (c) => {
      const g = new THREE.Group();
      const bronze = mat(c, { metalness: 0.2, roughness: 0.45 });
      const dark = mat(shade(c, 0.7), { metalness: 0.2, roughness: 0.55 });
      // stepped stone plinth (long axis along local Z, the facing direction)
      g.add(mesh(BOX(), mat(STONE), 0, 1.5, 0, 26, 3, 48));
      g.add(mesh(BOX(), mat(shade(STONE, 0.9)), 0, 4, 0, 20, 2, 40));
      g.add(mesh(BOX(), mat(new THREE.Color(0xd9b24c), { metalness: 0.7, roughness: 0.3 }), 0, 1.8, 24.2, 10, 2, 0.4)); // plaque
      // sauropod, modelled with the head toward +X then turned to face +Z
      const d = new THREE.Group();
      const y0 = 5;
      d.add(mesh(SPHERE(), bronze, 0, y0 + 12, 0, 22, 12, 11));                    // body
      d.add(mesh(SPHERE(), dark, 0, y0 + 16.5, 0, 14, 6, 7));                        // back ridge
      for (const [x, z] of [[6.5, 3.6], [6.5, -3.6], [-6.5, 3.6], [-6.5, -3.6]]) {
        d.add(mesh(CYL(8), bronze, x, y0 + 4.5, z, 3.6, 9, 3.6));                    // legs
        d.add(mesh(CYL(8), dark, x, y0 + 0.6, z, 4.2, 1.2, 4.2));                    // feet
      }
      const neck = new THREE.CatmullRomCurve3([v3(9, y0 + 14, 0), v3(14, y0 + 19, 0), v3(17.5, y0 + 27, 0), v3(19.5, y0 + 35, 0)]);
      beads(d, neck, 12, 3.4, 1.7, bronze);
      d.add(mesh(SPHERE(), bronze, 22, y0 + 36.5, 0, 6.5, 3.6, 3.4));              // head
      d.add(mesh(SPHERE(), dark, 24.5, y0 + 35.6, 0, 2.6, 1.6, 2.8));               // snout
      for (const z of [-1.4, 1.4]) d.add(mesh(SPHERE(), mat(new THREE.Color(0x111111)), 22.5, y0 + 37.4, z, 0.7, 0.7, 0.7)); // eyes
      const tail = new THREE.CatmullRomCurve3([v3(-9, y0 + 12.5, 0), v3(-16, y0 + 11, 1), v3(-23, y0 + 8, 3.5), v3(-30, y0 + 5.5, 7), v3(-35, y0 + 4.5, 10)]);
      beads(d, tail, 16, 3.6, 0.7, bronze);
      d.rotation.y = -Math.PI / 2; // head faces +Z (the structure's heading)
      g.add(d);
      return g;
    },
  },
  // Terrain features: these reshape or recolour the ground and place themselves.
  volcano: {
    label: 'Volcano', feature: true,
    place: (rec, planet) => buildVolcano(rec, planet, planet.featureById(rec.id)),
  },
  woodland: {
    label: 'Woodland', feature: true,
    place: (rec, planet) => buildWoodland(rec, planet, planet.featureById(rec.id)),
  },
  mushroomtree: {
    label: 'Super mushroom tree', feature: true,
    place: (rec, planet) => buildMushroomTree(rec, planet),
  },
  organstage: {
    label: 'Organ stage', feature: true, menu: false,
    place: (rec, planet) => buildOrganStage(rec, planet, planet.featureById(rec.id)),
  },
  computer: {
    label: 'BBS computer', feature: true, menu: false,
    place: (rec, planet) => buildComputer(rec, planet, planet.featureById(rec.id)),
  },
  graffiti: {
    label: 'Graffiti garden', feature: true, menu: false,
    place: (rec, planet) => buildGraffitiGarden(rec, planet, planet.featureById(rec.id)),
  },
  catapult: {
    label: 'Catapult', feature: true,
    place: (rec, planet) => buildCatapult(rec, planet, planet.featureById(rec.id)),
  },
  coaster: {
    label: 'Roller coaster', feature: true, menu: false,
    place: (rec, planet) => buildCoaster(rec, planet, planet.featureById(rec.id)),
  },
  road: {
    label: 'Road', feature: true, menu: false,
    place: (rec, planet) => buildRoad(rec, planet, planet.featureById(rec.id)),
  },
  // free-form designs from basic shapes and voxels (made through the Claude chat)
  blueprint: { label: 'Blueprint', menu: false, build: (c, rng, rec) => buildBlueprint(rec) },
  statue: {
    label: 'Statue', build: (c) => {
      const g = new THREE.Group();
      const m = mat(c, { metalness: 0.4, roughness: 0.5 });
      g.add(mesh(BOX(), mat(STONE), 0, 1.5, 0, 6, 3, 6));
      g.add(mesh(BOX(), m, 0, 7, 0, 2.6, 8, 1.6));
      g.add(mesh(SPHERE(), m, 0, 12.2, 0, 2.2, 2.2, 2.2));
      g.add(mesh(BOX(), m, 2.2, 8.5, 0.4, 1, 6, 1));
      g.add(mesh(BOX(), m, -2, 6.5, 0, 1, 5, 1));
      return g;
    },
  },
};

export const STRUCTURE_TYPES = Object.keys(STRUCTURES).filter((k) => STRUCTURES[k].menu !== false);

// ---------------------------------------------------------------- long spans
// A bridge between two points (rec.lat/lon → rec.lat2/lon2) that follows the
// planet's curvature. It extends `landing` metres inland past each end and
// ramps down to the ground there. Piers reach down to the seabed.
// Returns a group positioned at the midpoint, local +Y = up at the midpoint.
export function buildSpan(rec, planet) {
  const color = new THREE.Color(rec.color || '#b8b2a6');
  const width = rec.width || 10;
  const deckH = rec.deckHeight || 6;      // metres above sea level over water
  const landing = rec.landing ?? 45;      // metres inland past each end
  const slope = 0.15;                     // ramp gradient
  const a = latLonToDir(rec.lat, rec.lon), b = latLonToDir(rec.lat2, rec.lon2);
  const axis = new THREE.Vector3().crossVectors(a, b).normalize();
  const span = a.angleTo(b) * R;
  const total = span + 2 * landing;
  const start = a.clone().applyAxisAngle(axis, -landing / R);
  const step = 10;
  const n = Math.max(2, Math.ceil(total / step));
  const ds = total / n;
  // sample path: direction, ground altitude (>= 0 over water), seabed elevation
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const dir = start.clone().applyAxisAngle(axis, (i * ds) / R);
    const elev = planet.elevation(dir);
    pts.push({ dir, elev, ground: Math.max(0, elev), u: Math.min(i * ds, total - i * ds) });
  }
  const g0 = pts[0].ground, g1 = pts[n].ground;
  pts.forEach((p, i) => {
    const endGround = i * ds < total / 2 ? g0 : g1; // ground level at the nearer end
    const ramp = Math.min(deckH, endGround + 0.3 + slope * p.u);
    p.deck = Math.max(p.ground + 0.3, ramp);
  });
  const mid = a.clone().add(b).normalize();
  const group = new THREE.Group();
  group.position.copy(mid).multiplyScalar(R);
  const { east, north, up } = tangentFrame(mid);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const parts = { deck: [], rail: [], pier: [], lamp: [], glow: [] };
  const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), q = new THREE.Quaternion();
  // place a unit primitive: centre (world), basis (right, up, fwd), size
  const put = (list, geo, centre, right, upv, fwd, sx, sy, sz) => {
    m4.makeBasis(right, upv, fwd);
    q.setFromRotationMatrix(m4);
    sc.set(sx, sy, sz);
    m4.compose(centre, q, sc).premultiply(toLocal);
    list.push(geo.clone().applyMatrix4(m4));
  };
  const world = (p, alt) => p.dir.clone().multiplyScalar(R + alt);
  for (let i = 0; i < n; i++) {
    const p0 = world(pts[i], pts[i].deck), p1 = world(pts[i + 1], pts[i + 1].deck);
    const fwd = p1.clone().sub(p0); const len = fwd.length(); fwd.normalize();
    const upv = pts[i].dir.clone().add(pts[i + 1].dir).normalize();
    upv.addScaledVector(fwd, -upv.dot(fwd)).normalize();
    const right = new THREE.Vector3().crossVectors(upv, fwd).normalize();
    const c = p0.clone().add(p1).multiplyScalar(0.5);
    put(parts.deck, box, c.clone().addScaledVector(upv, -0.6), right, upv, fwd, width, 1.2, len * 1.03);
    for (const side of [-1, 1]) put(parts.rail, box, c.clone().addScaledVector(right, side * (width / 2 - 0.15)).addScaledVector(upv, 0.55), right, upv, fwd, 0.3, 1.1, len * 1.03);
  }
  // piers every 40 m where the deck is clear of the ground; lamps every 50 m
  for (let i = 0; i <= n; i++) {
    const p = pts[i], dist = i * ds;
    const { east: e2, north: n2, up: u2 } = tangentFrame(p.dir);
    const nextDir = pts[Math.min(n, i + 1)].dir, prevDir = pts[Math.max(0, i - 1)].dir;
    const fwd = nextDir.clone().sub(prevDir); fwd.addScaledVector(u2, -fwd.dot(u2)).normalize();
    const right = new THREE.Vector3().crossVectors(u2, fwd).normalize();
    if (Math.round(dist / ds) % Math.round(40 / ds) === 0 && p.deck - Math.max(p.elev, p.ground) > 1.2) {
      const bottom = Math.min(p.elev, p.ground) - 2, top = p.deck - 1.2;
      for (const side of [-1, 1]) {
        const base = world(p, (bottom + top) / 2).addScaledVector(right, side * width * 0.28);
        put(parts.pier, cyl, base, right, u2, fwd, 2.4, top - bottom, 2.4);
      }
      put(parts.pier, box, world(p, top - 0.6), right, u2, fwd, width * 0.85, 1.2, 2.6); // pier cap
    }
    if (i % Math.round(50 / ds) === 0 && i > 0 && i < n) {
      const side = (Math.round(i / Math.round(50 / ds)) % 2) ? 1 : -1;
      const base = world(p, p.deck).addScaledVector(right, side * (width / 2 - 0.4));
      put(parts.lamp, cyl, base.clone().addScaledVector(u2, 3), right, u2, fwd, 0.25, 6, 0.25);
      put(parts.glow, box, base.clone().addScaledVector(u2, 6.2).addScaledVector(right, -side * 0.6), right, u2, fwd, 1.4, 0.4, 0.8);
    }
  }
  // gateway arches where the bridge meets each shore
  for (const shoreDist of [landing, total - landing]) {
    const i = Math.round(shoreDist / ds), p = pts[i];
    const { up: u2 } = tangentFrame(p.dir);
    const fwd = pts[Math.min(n, i + 1)].dir.clone().sub(pts[Math.max(0, i - 1)].dir); fwd.addScaledVector(u2, -fwd.dot(u2)).normalize();
    const right = new THREE.Vector3().crossVectors(u2, fwd).normalize();
    for (const side of [-1, 1]) put(parts.pier, box, world(p, p.deck + 7).addScaledVector(right, side * (width / 2 + 1)), right, u2, fwd, 2, 14, 2);
    put(parts.pier, box, world(p, p.deck + 14.5), right, u2, fwd, width + 4, 2, 2.4);
  }
  const mats = {
    deck: new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 }),
    rail: new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.75), flatShading: true, roughness: 0.8 }),
    pier: new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.85), flatShading: true, roughness: 0.9 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd27a, emissiveIntensity: 1.5 }),
  };
  for (const k of Object.keys(parts)) {
    if (!parts[k].length) continue;
    const merged = mergeGeometries(parts[k], false);
    parts[k].forEach((gg) => gg.dispose());
    merged.computeBoundingSphere();
    group.add(new THREE.Mesh(merged, mats[k]));
  }
  box.dispose(); cyl.dispose();
  group.userData.record = rec;
  group.userData.labelHeight = deckH + 18;
  group.userData.length = total;
  return group;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Build a structure group from a record { id, type, color, scale, name }.
export function buildStructure(rec) {
  const def = STRUCTURES[rec.type] || STRUCTURES.flag;
  const color = new THREE.Color(rec.color || '#c8b89a');
  const rng = mulberry32(hashString(rec.id || rec.name || rec.type));
  const g = def.build(color, rng, rec);
  const s = rec.scale || 1;
  g.scale.setScalar(s);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  g.userData.record = rec;
  return g;
}
