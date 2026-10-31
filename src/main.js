import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Planet, R, latLonToDir, dirToLatLon, tangentFrame, formatLat, formatLon, wrapLon } from './planet.js';
import { FlyControls } from './controls.js';
import { TerrainLOD } from './terrain.js';
import { createFeatures, FEATURE_TYPES } from './features.js';
import { gardenCtx } from './graffiti.js';
import { WorldStore, randomSeed, DEFAULT_SPAWN } from './world.js';
import { STRUCTURES, STRUCTURE_TYPES, buildStructure, buildSpan } from './structures.js';
import { initChat } from './chat.js';
import { ORGAN_KEYS, KEY_NOTES } from './organHands.js';
import { mountOrganKeys } from './organKeys.js';
import { track, trackOnce, sendStats, startStats } from './stats.js';
import { OrbitTeleport } from './orbitaktTeleport.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ renderer
const app = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);
renderer.localClippingEnabled = true; // the traveller evaporates from the hat down
gardenCtx.renderer = renderer;

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'fixed';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
labelRenderer.domElement.style.zIndex = '3';
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050a);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 250000);

// lights
// The sun follows the viewer (always mid-morning where you are), so there is no
// night side to get lost in. It is eased so lighting doesn't jump.
const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
sun.position.set(1, 0.45, 0.7).multiplyScalar(10000);
// only the garden's pieces cast shadows; the shadow camera follows the viewer
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 1, far: 1600 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.4;
scene.add(sun);
scene.add(sun.target);
scene.add(new THREE.AmbientLight(0x9fb4d0, 0.32));
const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x4a3a2a, 0.3);
scene.add(hemi);
const sunTarget = new THREE.Vector3(1, 0.45, 0.7).normalize();
function updateSun(dt) {
  const { east, north, up } = tangentFrame(controls.position);
  sunTarget.copy(up).addScaledVector(east, 0.55).addScaledVector(north, -0.65).normalize();
  sunDir.lerp(sunTarget, Math.min(1, dt * 1.5)).normalize();
  const ground = controls.position.clone().setLength(R + Math.max(0, planet.elevation(controls.position.clone().normalize())));
  sun.target.position.copy(ground);
  sun.position.copy(ground).addScaledVector(sunDir, 800);
  sun.target.updateMatrixWorld();
}
const sunDir = new THREE.Vector3(1, 0.45, 0.7).normalize();

// stars
{
  const n = 5000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z) * 80000;
    pos[i * 3] = Math.cos(t) * r; pos[i * 3 + 1] = z * 80000; pos[i * 3 + 2] = Math.sin(t) * r;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 120, sizeAttenuation: true, transparent: true, opacity: 0.8 })));
}

// ------------------------------------------------------------------ state
const store = new WorldStore();
let planet = null;
let planetGroup = null;   // terrain, ocean, atmosphere, clouds
let cloudMesh = null, gridGroup = null, terrain = null;
const structuresGroup = new THREE.Group();
scene.add(structuresGroup);
const structureObjects = new Map(); // id -> group
const spinners = [];
const animated = []; // objects with userData.update(dt)
let controls = null;
let buildMode = false;

function toast(msg, ms = 2200) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function showLoading(text) { $('loading-text').textContent = text; $('loading').classList.remove('hidden'); await nextFrame(); }
function hideLoading() { $('loading').classList.add('hidden'); }

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.alphaMap) m.alphaMap.dispose(); if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
}

// ------------------------------------------------------------------ picking (analytic ray march against the height field)
const _ray = new THREE.Ray();
const raycaster = new THREE.Raycaster();
function pickGround(ndcX, ndcY) {
  const origin = camera.position.clone();
  const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  _ray.set(origin, dir);
  const Rmax = R + planet.maxElevation() + 2;
  // ray-sphere intersection with bounding sphere
  const b = origin.dot(dir), c = origin.lengthSq() - Rmax * Rmax;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t0 = -b - sq, t1 = -b + sq;
  if (t1 < 0) return null;
  t0 = Math.max(t0, 0);
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  // height above ground along the ray; negative when underground
  const above = (t) => { p.copy(origin).addScaledVector(dir, t); d.copy(p).normalize(); return p.length() - planet.groundRadius(d); };
  let prev = t0;
  let a = above(prev);
  if (a < 0) return null; // camera underground - shouldn't happen
  let t = prev;
  for (let iter = 0; iter < 4000 && t <= t1; iter++) {
    // adaptive step: terrain slopes are gentle, so step a fraction of the clearance
    const step = THREE.MathUtils.clamp(a * 0.5, 1.5, 400);
    t = prev + step;
    a = above(t);
    if (a < 0) {
      let lo = prev, hi = t;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (above(mid) < 0) hi = mid; else lo = mid; }
      const tm = (lo + hi) / 2;
      p.copy(origin).addScaledVector(dir, tm);
      d.copy(p).normalize();
      const { lat, lon } = dirToLatLon(d);
      return { point: p.clone(), dir: d.clone(), lat, lon, elevation: planet.elevation(d), distance: tm };
    }
    prev = t;
  }
  return null;
}

// ------------------------------------------------------------------ structures
function isSpan(rec) { return rec.lat2 != null && rec.lon2 != null && STRUCTURES[rec.type]?.span; }

function placeStructure(rec) {
  removeStructureObject(rec.id);
  let g, labelY = 0, labelRange;
  const def = STRUCTURES[rec.type];
  if (def?.place) {
    if (def.feature && !planet.featureById(rec.id)) return null; // incomplete record (e.g. road without an end)
    g = def.place(rec, planet);
    labelRange = g.userData.labelRange ?? 3000;
  } else if (isSpan(rec)) {
    g = buildSpan(rec, planet);
    labelY = g.userData.labelHeight;
    labelRange = 3000;
  } else {
    g = buildStructure(rec);
    const dir = latLonToDir(rec.lat, rec.lon);
    const r = planet.groundRadius(dir) + (rec.alt || 0);
    g.position.copy(dir).multiplyScalar(r);
    const { east, north, up } = tangentFrame(dir);
    const h = (rec.heading || 0) * DEG;
    const fwd = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
    const box = new THREE.Box3().setFromObject(g);
    const height = box.max.clone().sub(box.min).length();
    labelY = (box.max.sub(g.position).dot(up)) / (rec.scale || 1) + 3;
    labelRange = 1500 + height * 40;
  }
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = rec.name || (def?.label ?? rec.type);
  const lo = new CSS2DObject(label);
  if (g.userData.labelPos) lo.position.copy(g.userData.labelPos); else lo.position.set(0, labelY, 0);
  g.add(lo);
  g.userData.label = lo;
  g.userData.labelRange = labelRange;
  g.traverse((o) => { if (o.name === 'spin') spinners.push(o); if (o.userData.update) animated.push(o); });
  structuresGroup.add(g);
  structureObjects.set(rec.id, g);
  return g;
}

// Terrain features changed: recompute them, regenerate terrain, re-place everything.
async function refreshFeatures() {
  await showLoading('Reshaping terrain…');
  planet.setFeatures(createFeatures(store.current.structures, planet));
  terrain.reset();
  clearStructures();
  for (const rec of store.current.structures) placeStructure(rec);
  if (gridGroup) { scene.remove(gridGroup); disposeObject(gridGroup); }
  gridGroup = planet.buildGrid();
  gridGroup.visible = $('opt-grid').checked;
  scene.add(gridGroup);
  terrain.warm(controls.position, 1500);
  hideLoading();
}
function removeStructureObject(id) {
  const g = structureObjects.get(id);
  if (!g) return;
  g.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
  structuresGroup.remove(g);
  disposeObject(g);
  structureObjects.delete(id);
  for (const list of [spinners, animated]) {
    for (let i = list.length - 1; i >= 0; i--) { let o = list[i]; while (o && o !== g) o = o.parent; if (o === g) list.splice(i, 1); }
  }
}
function clearStructures() {
  if (ride) endRide();
  if (follow) endFollow();
  if (catapult) { catapult = null; $('catapult-panel').classList.add('hidden'); }
  for (const id of [...structureObjects.keys()]) removeStructureObject(id);
  spinners.length = 0;
  animated.length = 0;
}

// ------------------------------------------------------------------ world (re)building
async function buildWorld(world, viewOverride = null) {
  await showLoading(`Generating “${world.name}” (seed ${world.seed})…`);
  clearStructures();
  if (planetGroup) { scene.remove(planetGroup); disposeObject(planetGroup); planetGroup = null; }
  if (gridGroup) { scene.remove(gridGroup); disposeObject(gridGroup); gridGroup = null; }

  planet = new Planet(world.seed);
  planet.setFeatures(createFeatures(world.structures, planet));
  planetGroup = new THREE.Group();
  if (terrain) terrain.dispose();
  terrain = new TerrainLOD(planet);
  planetGroup.add(terrain.group);
  planetGroup.add(planet.buildOcean());
  planetGroup.add(planet.buildAtmosphere());
  cloudMesh = planet.buildClouds();
  cloudMesh.visible = $('opt-clouds').checked;
  planetGroup.add(cloudMesh);
  scene.add(planetGroup);
  gridGroup = planet.buildGrid();
  gridGroup.visible = $('opt-grid').checked;
  scene.add(gridGroup);
  terrain.material.wireframe = $('opt-wire').checked;

  for (const rec of world.structures) placeStructure(rec);

  if (!controls) { controls = new FlyControls(camera, renderer.domElement, planet); controls.onTeleport = () => terrain && terrain.warm(controls.position, 1200); }
  controls.planet = planet;
  const v = viewOverride || world.spawn || DEFAULT_SPAWN;
  controls.teleport(v.lat, v.lon, v.alt, v.heading ?? 0, v.pitch ?? -35);
  updateSun(10);
  terrain.warm(controls.position, 1500);

  updateWorldPanel();
  hideLoading();
}

function updateWorldPanel() {
  const w = store.current;
  $('world-name').textContent = w.name + (w.kind === 'local' ? ' (local)' : '');
  $('world-seed').textContent = String(w.seed);
  $('world-count').textContent = `${w.structures.length} structure${w.structures.length === 1 ? '' : 's'}`;
  const sel = $('world-select');
  sel.innerHTML = '';
  for (const it of store.listWorlds()) {
    const o = document.createElement('option');
    o.value = it.id; o.textContent = `${it.name}${it.kind === 'local' ? ' (local)' : ''}`;
    if (it.id === w.id) o.selected = true;
    sel.appendChild(o);
  }
  renderStructureList();
  renderVisitMenu();
}

// The Visit place menu: every named place on this world, one click away.
function renderVisitMenu() {
  const sel = $('visit-select');
  sel.replaceChildren(new Option('Visit place…', ''));
  const name = (s) => s.name || STRUCTURES[s.type]?.label || s.type;
  const list = store.current.structures.filter((s) => s.lat != null).sort((a, b) => name(a).localeCompare(name(b)));
  const groups = [['megaZINE November', list.filter((s) => s.issue === 'november')], ['Places', list.filter((s) => s.createdBy !== 'claude' && s.issue !== 'november')], ['Built by visitors', list.filter((s) => s.createdBy === 'claude')]];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const s of items) g.append(new Option(name(s), s.id));
    sel.append(g);
  }
}

function renderStructureList() {
  const list = $('structure-list');
  list.innerHTML = '';
  const w = store.current;
  if (!w.structures.length) { list.innerHTML = '<div class="item"><span class="name" style="color:var(--muted)">Nothing built yet.</span></div>'; return; }
  for (const s of w.structures) {
    const el = document.createElement('div'); el.className = 'item';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = s.name || STRUCTURES[s.type]?.label || s.type; name.title = `${s.type} · scale ${s.scale || 1}`;
    const coords = document.createElement('span'); coords.className = 'coords'; coords.textContent = `${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`;
    const go = document.createElement('button'); go.textContent = 'Go'; go.title = 'Fly to this structure';
    go.onclick = () => flyToStructure(s);
    if (s.type === 'coaster') {
      const rb = document.createElement('button'); rb.textContent = 'Ride'; rb.title = 'Ride it from the start';
      rb.onclick = () => { const g = structureObjects.get(s.id); if (g?.userData.coaster) { startRide(g.userData.coaster); updateRideButton(); } };
      el.append(rb);
    }
    const del = document.createElement('button'); del.textContent = '×'; del.title = 'Remove';
    del.onclick = async () => {
      store.removeStructure(s.id); removeStructureObject(s.id);
      if (FEATURE_TYPES.has(s.type)) await refreshFeatures();
      updateWorldPanel(); toast('Removed');
    };
    el.append(name, coords, go, del);
    list.appendChild(el);
  }
}

// Going off to a piece's own site: count it first, as the page is about to go.
function leaveFor(place, url) { track('out', place); sendStats(); location.assign(url); }

function flyToStructure(s) {
  if (s.type === 'graffiti') {
    // stand outside the gateway on the approach road, looking in
    const b = (s.entrance ?? 0) * DEG, back = ((s.pad ?? 150) + 45) / (R * DEG);
    controls.teleport(s.lat + Math.cos(b) * back, s.lon + Math.sin(b) * back / Math.cos(s.lat * DEG), 9, ((s.entrance ?? 0) + 180) % 360, -3);
    return;
  }
  if (s.type === 'computer') {
    const c = structureObjects.get(s.id)?.userData.computer;
    if (c) { setPose(c.viewPoint(340), c.normal.clone().negate()); return; }
  }
  if (s.type === 'organstage') {
    const st = structureObjects.get(s.id)?.userData.organStage;
    if (st) { const v = st.view(0, 230, 520, 0, 200, 0); setPose(v.pos, v.look); return; }
  }
  if (s.type === 'ashland') {
    const a = structureObjects.get(s.id)?.userData.ashland;
    if (a) { const v = a.view(); controls.teleport(v.lat, v.lon, v.alt, v.heading, v.pitch); return; }
  }
  if (s.type === 'orbitakt') {
    const o = structureObjects.get(s.id)?.userData.orbitakt;
    if (o) { const v = o.view(); setPose(v.pos, v.look); return; }
  }
  if (s.type === 'university') {
    const u = structureObjects.get(s.id)?.userData.university;
    if (u) { const v = u.view(); setPose(v.pos, v.look); return; }
  }
  if (s.type === 'lastskip') {
    const ls = structureObjects.get(s.id)?.userData.lastSkip;
    if (ls) { const v = ls.view(); setPose(v.pos, v.look); return; }
  }
  if (s.type === 'comicstatue') {
    const c = structureObjects.get(s.id)?.userData.comicStatue;
    if (c) { const v = c.view(); setPose(v.pos, v.look); return; }
  }
  if (s.type === 'papermachine') {
    const pm = structureObjects.get(s.id)?.userData.paperMachine;
    if (pm) { const v = pm.view(); setPose(v.pos, v.look); return; }
  }
  if (s.type === 'catapult') {
    const h = (s.heading ?? 0) * DEG, back = 70 / (R * DEG);
    controls.teleport(s.lat - Math.cos(h) * back, s.lon - Math.sin(h) * back / Math.cos(s.lat * DEG), 30, s.heading ?? 0, -6);
    return;
  }
  if (s.type === 'coaster') {
    const g = structureObjects.get(s.id);
    const f = g?.userData.coaster?.feature;
    if (f) {
      const fr = f.frameAt(f.stationLen + 10);
      const back = fr.pos.clone().addScaledVector(fr.tan, -90).normalize();
      const ll = dirToLatLon(back);
      const { east, north } = tangentFrame(back);
      controls.teleport(ll.lat, ll.lon, 25, (Math.atan2(fr.tan.dot(east), fr.tan.dot(north)) / DEG + 360) % 360, -2);
      return;
    }
  }
  if (s.type === 'volcano' || s.type === 'woodland') {
    // stand off to the south, looking north at it
    const r = (s.type === 'volcano' ? (s.radius ?? 600) * 1.8 : (s.radius ?? 400) * 1.2);
    controls.teleport(s.lat - r / (R * DEG), s.lon, s.type === 'volcano' ? 120 : 160, 0, s.type === 'volcano' ? 2 : -12);
    return;
  }
  if (isSpan(s) || (s.type === 'road' && s.lat2 != null)) {
    // stand behind the first end, looking along the span
    const a = latLonToDir(s.lat, s.lon), b = latLonToDir(s.lat2, s.lon2);
    const axis = new THREE.Vector3().crossVectors(a, b).normalize();
    const behind = a.clone().applyAxisAngle(axis, -90 / R);
    const { east, north } = tangentFrame(behind);
    const fwd = b.clone().addScaledVector(behind, -behind.dot(b)).normalize();
    const heading = (Math.atan2(fwd.dot(east), fwd.dot(north)) / DEG + 360) % 360;
    const ll = dirToLatLon(behind);
    controls.teleport(ll.lat, ll.lon, 22, heading, -8);
    return;
  }
  if (s.type === 'blueprint') {
    // blueprints come in all sizes: stand back by their measured size
    const g = structureObjects.get(s.id);
    if (g) {
      const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).length();
      const back = Math.max(60, size * 1.1), look = g.position.clone().addScaledVector(g.position.clone().normalize(), size * 0.25);
      const { north, up } = tangentFrame(g.position);
      const pos = g.position.clone().addScaledVector(north, -back).addScaledVector(up, size * 0.45 + 12);
      setPose(pos, look.sub(pos).normalize());
      return;
    }
  }
  const dist = 45 * (s.scale || 1) + 25;
  // stand to the south of it, looking north and down
  const dlat = -(dist / (R * DEG)) * 0.9;
  controls.teleport(s.lat + dlat, s.lon, dist * 0.6, 0, -30);
}

// ------------------------------------------------------------------ coaster rides
let ride = null; // the coaster api being ridden
const eye = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(), speed: 0 };
function coasters() {
  return [...structureObjects.values()].map((g) => g.userData.coaster).filter(Boolean);
}
function nearestCoaster(maxDist = 450) {
  let best = null, bd = maxDist;
  for (const c of coasters()) {
    const d = c.stationPoint().distanceTo(controls.position);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function startRide(c) {
  if (!c) return;
  track('go', 'coaster');
  track('enter', c.feature.rec.id);
  ride = c;
  c.onRideEnd = () => endRide(true);
  c.board();
  controls.enabled = false;
  document.body.classList.add('riding');
  toast('Hold on! Esc or W/A/S/D to get off', 3500);
}
function endRide(arrived = false) {
  if (!ride) return;
  const c = ride;
  ride = null;
  c.dismount();
  // step off where the camera is, facing the same way
  const fwd = eye.target.clone().sub(eye.pos).normalize();
  const { east, north, up } = tangentFrame(eye.pos);
  controls.position.copy(eye.pos);
  if (arrived) controls.position.addScaledVector(up, 1.5);
  controls.heading = (Math.atan2(fwd.dot(east), fwd.dot(north)) / DEG + 360) % 360;
  controls.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(fwd.dot(up), -1, 1)) / DEG, -60, 60);
  controls.enabled = true;
  controls.updateCamera();
  document.body.classList.remove('riding');
  toast(arrived ? 'End of the line. Welcome to the far side.' : 'Got off the ride', 3000);
}
function updateRideButton() {
  const btn = $('btn-ride');
  if (ride) { btn.textContent = '✋ Get off'; btn.classList.remove('hidden'); return; }
  const c = follow ? null : nearestCoaster();
  if (c) { btn.textContent = `🎢 Ride ${c.feature.rec.name || 'the coaster'}`; btn.classList.remove('hidden'); }
  else btn.classList.add('hidden');
}

// ------------------------------------------------------------------ the BBS computer
// Near a BBS computer a Dial in button appears (clicking its screen works too).
// The camera glides up to face the monitor, then the real BBS opens in a frame
// lined up with the glass (or full screen when the glass would be too small).
let bbs = null; // { c, phase: 'flying' | 'online' | 'typing', then, t, from, to } while at a BBS computer
function computers() { return [...structureObjects.values()].map((g) => g.userData.computer).filter(Boolean); }
function nearestComputer(maxDist = 900) {
  let best = null, bd = maxDist;
  for (const c of computers()) { const d = c.center.distanceTo(controls.position); if (d < bd) { bd = d; best = c; } }
  return best;
}
function lookPose(pos, look) {
  const { east, north, up } = tangentFrame(pos);
  return { heading: (Math.atan2(look.dot(east), look.dot(north)) / DEG + 360) % 360, pitch: Math.asin(THREE.MathUtils.clamp(look.dot(up), -1, 1)) / DEG };
}
function setPose(pos, look) {
  const p = lookPose(pos, look);
  controls.cancelFlight();
  controls.position.copy(pos); controls.heading = p.heading; controls.pitch = p.pitch;
  controls.updateCamera();
  if (controls.onTeleport) controls.onTeleport();
}
function updateDialButton() {
  const c = !bbs && !ride && !follow ? nearestComputer() : null;
  $('computer-actions').classList.toggle('hidden', !c);
  $('btn-organ').classList.toggle('hidden', !!bbs || !!ride || !!follow || !nearestStage());
  $('btn-university').classList.toggle('hidden', !!uni || !!bbs || !!ride || !!follow || !nearestUniversity());
  $('btn-ashland').classList.toggle('hidden', !!ash || !!tele || !!uni || !!bbs || !!ride || !!follow || !nearestAshland());
  $('btn-orbitakt').classList.toggle('hidden', !!tele || !!uni || !!bbs || !!ride || !!follow || !nearestOrbitakt());
  $('btn-paper').classList.toggle('hidden', !!paper || !!ash || !!skip || !!tele || !!uni || !!bbs || !!ride || !!follow || !nearestPaperMachine());
  $('btn-skip').classList.toggle('hidden', !!skip || !!tele || !!uni || !!bbs || !!ride || !!follow || !nearestSkip());
  $('btn-comic').classList.toggle('hidden', !!skip || !!tele || !!uni || !!bbs || !!ride || !!follow || !nearestComic());
}
function organStages() { return [...structureObjects.values()].map((g) => g.userData.organStage).filter(Boolean); }
function nearestStage(maxDist = 800) {
  return organStages().find((st) => st.center.distanceTo(controls.position) < maxDist) || null;
}
// Sit at the organ: the seat sees the whole painting above both keyboards.
function sitAtOrgan(st) {
  if (bbs || !st) return;
  track('enter', 'thingsynth-stage');
  loadThingSynth();
  const touch = document.body.classList.contains('touch');
  const v = st.seatView(camera.aspect);
  if (touch) $('organ-status').textContent = '🎹 Warming up…';
  glideTo(st, v.pos, v.look, () => {
    bbs.phase = 'organ';
    document.body.classList.add('organ-on');
    showScene(st, true);
    placeOrganFrame();
  });
}
// ThingSynth runs as its own page in a frame laid over the painting. It makes the
// sound and animates the painting; the game sends it the notes and moves the hands.
let thingSynth = null, organOctave = 0, organTouch = null;
const organNotes = new Map(); // key -> sounding note
function loadThingSynth() {
  if ($('organ-frame').firstChild) return;
  const frame = document.createElement('iframe');
  frame.src = './thingsynth/index.html?embed';
  frame.title = 'ThingSynth: Golden Pyramid With Tunnel Celebration';
  frame.tabIndex = -1;
  frame.allow = 'autoplay; midi';
  $('organ-frame').append(frame);
  const wait = setInterval(() => {
    const api = frame.contentWindow?.thingsynthEmbed;
    if (!api) return;
    clearInterval(wait);
    thingSynth = api;
    document.body.classList.add('organ-live');
    placeOrganFrame();
    $('organ-status').textContent = document.body.classList.contains('touch') ? '🎹 Tap the keys, then play' : '🎹 Play A S D F G H J K L ; and W E T Y U O P · Z / X change octave';
  }, 150);
}
function placeOrganFrame() {
  if (bbs?.phase !== 'organ') return;
  const pts = bbs.c.corners().map((p) => p.project(camera));
  const xs = pts.map((p) => (p.x + 1) / 2 * innerWidth), ys = pts.map((p) => (1 - p.y) / 2 * innerHeight);
  const x = Math.min(...xs), y = Math.min(...ys);
  Object.assign($('organ-frame').style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(...xs) - x}px`, height: `${Math.max(...ys) - y}px` });
}
function organKeyDown(key) {
  trackOnce('play', 'thingsynth-stage');
  bbs.c.hands.hold(key);
  if (!thingSynth) return;
  const note = 60 + organOctave + KEY_NOTES[key];
  organNotes.set(key, note);
  const { host } = thingSynth;
  if (host.audio.running()) { host.noteOn(note, 100); return; }
  // the first key press starts the audio, then plays if the key is still down
  thingSynth.start().then(() => { if (organNotes.get(key) === note) host.noteOn(note, 100); }).catch((err) => { console.warn('organ audio', err); toast("The organ's sound couldn't start. Press a key again.", 3000); });
}
function organOctaveShift(step) {
  organOctave = THREE.MathUtils.clamp(organOctave + step, -36, 36);
  toast(organOctave ? `Octave ${organOctave > 0 ? '+' : ''}${organOctave / 12}` : 'Middle octave', 900);
}
function organKeyUp(key) {
  bbs?.c.hands.release(key);
  const note = organNotes.get(key);
  organNotes.delete(key);
  if (note != null && thingSynth) thingSynth.host.noteOff(note);
}
function showScene(st, on) {
  st.setScene(on);
  // the scene has its own ground and sky, and is the only thing in view
  if (planetGroup) planetGroup.visible = !on;
  if (gridGroup) gridGroup.visible = !on && $('opt-grid').checked;
  for (const g of structureObjects.values()) if (g !== st.site) g.visible = !on;
}
function leaveOrgan() {
  if (!bbs || bbs.phase !== 'organ') return;
  showScene(bbs.c, false);
  organTouch?.release();
  for (const k of [...bbs.c.hands.held]) organKeyUp(k);
  document.body.classList.remove('organ-on');
  organOctave = 0;
  bbs = null;
  controls.enabled = true;
  updateDialButton();
}

// ------------------------------------------------------------------ the Walking University
// Going in: the campus gets up and starts to walk, the world gives way to the salt
// flats, and the visitor flies round it and in through the lit tower window to the
// Chair's desk. The office is really up there, so its window shows the campus below.
let uni = null; // { u, phase: 'rising' | 'flying' | 'office', t, curve }
const RISE = 3, FLY = 9;
function universities() { return [...structureObjects.values()].map((g) => g.userData.university).filter(Boolean); }
function nearestUniversity(maxDist = 3200) {
  return universities().find((u) => u.center.distanceTo(controls.position) < maxDist) || null;
}
const uniFade = (on) => $('uni-fade').classList.toggle('on', on);
const uniWait = (ms) => new Promise((r) => setTimeout(r, ms));
function enterUniversity(u) {
  if (uni || bbs || !u) return;
  if (ride) endRide();
  if (follow) endFollow();
  controls.cancelFlight();
  controls.enabled = false;
  camera.getWorldDirection(_tmp);
  track('enter', 'walking-university');
  uni = { u, phase: 'rising', t: 0, from: camera.position.clone(), lookFrom: camera.position.clone().addScaledVector(_tmp, 400) };
  document.body.classList.add('uni-on');
  u.start();
  toast('The University is getting up…', 2800);
  if (!$('uni-game').firstChild) {
    // load the game early, so it's ready on the desk when the visitor lands
    const frame = document.createElement('iframe');
    frame.src = u.url;
    frame.title = 'ChairQuest';
    frame.allow = 'fullscreen';
    $('uni-game').append(frame);
  }
}
async function uniIntoScene() {
  const { u } = uni;
  uni.phase = 'fading';
  uniFade(true);
  await uniWait(420);
  showScene(u, true);
  uni.curve = u.path(camera.position);
  uni.phase = 'flying';
  uni.t = 0;
  uniFade(false);
}
async function uniIntoOffice() {
  const { u } = uni;
  uni.phase = 'fading';
  uniFade(true);
  await uniWait(420);
  u.setOffice(true);
  uni.phase = 'office';
  uni.since = performance.now();
  track('arrive', 'walking-university');
  document.body.classList.add('uni-office');
  placeUniView();
  uniFade(false);
}
function stepUniversity(dt) {
  const { u } = uni;
  uni.t += dt;
  camera.up.copy(u.up);
  if (uni.phase === 'rising') {
    const k = Math.min(1, uni.t / RISE), e = k * k * (3 - 2 * k);
    camera.position.copy(uni.from);
    camera.lookAt(_tmp.copy(uni.lookFrom).lerp(u.towerTop(), e));
    if (uni.t >= RISE) uniIntoScene();
  } else if (uni.phase === 'flying') {
    const k = Math.min(1, uni.t / FLY), e = k * k * (3 - 2 * k);
    camera.position.copy(u.localToWorld(uni.curve.getPoint(e)));
    // look at the tower, then down the last stretch at the window itself
    const ahead = u.localToWorld(uni.curve.getPoint(Math.min(1, e + 0.1)));
    camera.lookAt(_tmp.copy(u.towerTop()).lerp(ahead, THREE.MathUtils.smoothstep(e, 0.55, 0.85)));
    if (uni.t >= FLY) uniIntoOffice();
  } else if (uni.phase === 'office') {
    const s = u.seat();
    camera.position.copy(s.pos);
    camera.lookAt(s.look);
  }
  controls.position.copy(camera.position);
}
// Centre the view on whatever part of the screen the game leaves showing.
function placeUniView() {
  if (uni?.phase !== 'office') return;
  const W = window.innerWidth, H = window.innerHeight, r = $('uni-game').getBoundingClientRect();
  const gazing = document.body.classList.contains('uni-gazing'), wide = W > H;
  const x = gazing || !wide ? 0 : -r.right / 2, y = gazing || wide ? 0 : (H - r.top) / 2;
  camera.setViewOffset(W, H, x, y, W, H);
}
async function leaveUniversity() {
  if (uni?.phase !== 'office') return;
  const { u } = uni;
  track('dwell', 'walking-university', Math.round((performance.now() - uni.since) / 1000));
  uni.phase = 'fading';
  uniFade(true);
  await uniWait(420);
  document.body.classList.remove('uni-on', 'uni-office', 'uni-gazing');
  $('uni-window').textContent = '🪟 Look out the window';
  camera.clearViewOffset();
  u.setOffice(false);
  u.stop();
  showScene(u, false);
  const v = u.view();
  camera.up.set(0, 1, 0);
  setPose(v.pos, v.look);
  controls.enabled = true;
  uni = null;
  updateDialButton();
  uniFade(false);
}

// ------------------------------------------------------------------ Ashland
// Ashland is another website, so the gate welcomes the visitor and asks first; then
// the camera comes down to the trail and through under the sign, and the page goes there.
let ash = null, ashFrom = null; // { a, t, curve, left } on the way in, and the pose to come back to
const ASH_WALK = 7;
function nearestAshland(maxDist = 3200) {
  return [...structureObjects.values()].map((g) => g.userData.ashland).find((a) => a && a.center.distanceTo(controls.position) < maxDist) || null;
}
function ashlandGate(a) {
  if (ash || tele || uni || bbs || !a) return;
  track('enter', 'ashland');
  $('ash-gate').classList.remove('hidden');
  controls.enabled = false;
  $('ash-go').onclick = () => { ashlandGateClose(); walkIntoAshland(a); };
  $('ash-go').focus();
}
function ashlandGateClose() {
  $('ash-gate').classList.add('hidden');
  controls.enabled = true;
}
function walkIntoAshland(a) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { leaveFor('ashland', a.url); return; }
  if (ride) endRide();
  if (follow) endFollow();
  controls.cancelFlight();
  controls.enabled = false;
  ashFrom = { pos: controls.position.clone(), heading: controls.heading, pitch: controls.pitch };
  document.body.classList.add('ash-on');
  ash = { a, t: 0, curve: a.path(controls.position), left: false };
}
function stepAshland(dt) {
  if (ash.left) return;
  ash.t = Math.min(1, ash.t + dt / ASH_WALK);
  const k = ash.t, e = k * k * (3 - 2 * k);
  camera.up.copy(ash.a.up);
  camera.position.copy(ash.curve.getPoint(e));
  camera.lookAt(ash.curve.getPoint(Math.min(1, e + 0.05)));
  controls.position.copy(camera.position);
  $('ash-fade').style.opacity = THREE.MathUtils.smoothstep(k, 0.8, 0.97);
  if (k >= 1) { ash.left = true; leaveFor('ashland', ash.a.url); }
}
function stopAshland() {
  if (!ash) return;
  ash = null;
  document.body.classList.remove('ash-on');
  $('ash-fade').style.opacity = 0;
  camera.up.set(0, 1, 0);
  controls.position.copy(ashFrom.pos); controls.heading = ashFrom.heading; controls.pitch = ashFrom.pitch;
  controls.updateCamera();
  controls.enabled = true;
  updateDialButton();
}

// ------------------------------------------------------------------ the Orbitakt launchpad
// Orbitakt is another website, so the machine asks first; then the visitor leaves
// by way of orbit (see orbitaktTeleport.js) and the page goes there.
let tele = null, teleFrom = null, teleLeft = false; // the teleport under way, the pose to come back to, and whether the page has gone
function nearestOrbitakt(maxDist = 1600) {
  return [...structureObjects.values()].map((g) => g.userData.orbitakt).find((o) => o && o.center.distanceTo(controls.position) < maxDist) || null;
}
function orbitGate(o) {
  if (tele || uni || bbs || !o) return;
  track('enter', 'orbitakt-launchpad');
  $('orbit-gate').classList.remove('hidden');
  controls.enabled = false;
  $('orbit-go').onclick = () => { orbitGateClose(); launchOrbitakt(o); };
  $('orbit-go').focus();
}
function orbitGateClose() {
  $('orbit-gate').classList.add('hidden');
  controls.enabled = true;
}
function launchOrbitakt(o) {
  // no flight for those who'd rather not: straight there
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { leaveFor('orbitakt-launchpad', o.url); return; }
  if (ride) endRide();
  if (follow) endFollow();
  controls.cancelFlight();
  controls.enabled = false;
  teleFrom = { pos: controls.position.clone(), heading: controls.heading, pitch: controls.pitch };
  document.body.classList.add('orbit-on');
  tele = new OrbitTeleport({ scene, camera, o, caption: (text) => { $('orbit-caption').textContent = text; } });
}
function stepTeleport(dt) {
  const done = tele.step(dt);
  $('orbit-fade').style.opacity = tele.flash;
  controls.position.copy(camera.position);
  if (done) { teleLeft = true; leaveFor('orbitakt-launchpad', tele.o.url); }
}
function stopTeleport() {
  if (!tele) return;
  tele.dispose();
  tele = null; teleLeft = false;
  document.body.classList.remove('orbit-on');
  $('orbit-fade').style.opacity = 0;
  camera.up.set(0, 1, 0);
  controls.position.copy(teleFrom.pos); controls.heading = teleFrom.heading; controls.pitch = teleFrom.pitch;
  controls.updateCamera();
  controls.enabled = true;
  updateDialButton();
}

// ------------------------------------------------------------------ Comic Booklet
// The statue opens megaZINE, where the booklet is in the issue, in its own tab,
// leaving the visitor on the shore here.
function nearestComic(maxDist = 1200) {
  return [...structureObjects.values()].map((g) => g.userData.comicStatue).find((c) => c && c.center.distanceTo(controls.position) < maxDist) || null;
}
function openComic(c) { if (c) { track('out', 'comic-statue'); window.open(c.url, '_blank', 'noopener'); } }

// ------------------------------------------------------------------ Last Skip
// A stone skips out across the sea with the camera after it, the view fades, and
// the visitor goes on to the game itself.
let skip = null; // { ls, play, leaving }
function nearestSkip(maxDist = 1400) {
  return [...structureObjects.values()].map((g) => g.userData.lastSkip).find((ls) => ls && ls.center.distanceTo(controls.position) < maxDist) || null;
}
function tryLastSkip(ls) {
  if (skip || tele || uni || bbs || !ls) return;
  track('enter', 'last-skip');
  // no flight for those who'd rather not: straight there
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { leaveFor('last-skip', ls.url); return; }
  if (ride) endRide();
  if (follow) endFollow();
  controls.cancelFlight();
  controls.enabled = false;
  document.body.classList.add('skip-on');
  skip = { ls, play: ls.play(camera), leaving: false };
  updateDialButton();
}
function stepSkip(dt) {
  const done = skip.ls.step(skip.play, dt, camera);
  controls.position.copy(camera.position);
  if (done && !skip.leaving) {
    skip.leaving = true;
    uniFade(true);
    uniWait(650).then(() => leaveFor('last-skip', skip.ls.url));
  }
}
// back from the game: the browser may restore this page just as it was left
function endSkip() {
  if (!skip) return;
  const v = skip.ls.view();
  skip.ls.reset();
  skip = null;
  document.body.classList.remove('skip-on');
  camera.up.set(0, 1, 0);
  setPose(v.pos, v.look);
  controls.enabled = true;
  uniFade(false);
  updateDialButton();
}

// ------------------------------------------------------------------ the Paper Machine
// Ten seconds through the machine, from a falling tree to a printed page that fills
// the screen, then the visitor is on Metamers. It shares the Orbitakt overlay.
let paper = null; // { pm, from, left }
function nearestPaperMachine(maxDist = 1300) {
  return [...structureObjects.values()].map((g) => g.userData.paperMachine).find((pm) => pm && pm.center.distanceTo(controls.position) < maxDist) || null;
}
function runPaperMachine(pm) {
  if (paper || ash || skip || tele || uni || bbs || !pm) return;
  track('enter', 'paper-machine');
  // no flight for those who'd rather not: straight there
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { leaveFor('paper-machine', pm.url); return; }
  if (ride) endRide();
  if (follow) endFollow();
  controls.cancelFlight();
  controls.enabled = false;
  paper = { pm, from: { pos: controls.position.clone(), heading: controls.heading, pitch: controls.pitch }, left: false };
  document.body.classList.add('orbit-on');
  $('orbit-stop').onclick = stopPaperMachine;
  pm.start(camera, (text) => { $('orbit-caption').textContent = text; });
  updateDialButton();
}
function stepPaperMachine(dt) {
  const done = paper.pm.step(dt, camera);
  $('orbit-fade').style.opacity = paper.pm.flash;
  controls.position.copy(camera.position);
  if (done) { paper.left = true; leaveFor('paper-machine', paper.pm.url); }
}
function stopPaperMachine() {
  if (!paper) return;
  const { pm, from } = paper;
  pm.stop();
  paper = null;
  document.body.classList.remove('orbit-on');
  $('orbit-fade').style.opacity = 0;
  $('orbit-stop').onclick = stopTeleport;
  camera.up.set(0, 1, 0);
  controls.position.copy(from.pos); controls.heading = from.heading; controls.pitch = from.pitch;
  controls.updateCamera();
  controls.enabled = true;
  updateDialButton();
}

// glide the camera to a pose at the computer, then call `then`
function glideTo(c, to, look, then) {
  if (ride) endRide();
  if (follow) endFollow();
  bbs = { c, phase: 'flying', then, t: 0, from: controls.position.clone(), to, fromPose: { heading: controls.heading, pitch: controls.pitch }, toPose: lookPose(to, look) };
  controls.cancelFlight();
  controls.enabled = false;
  updateDialButton();
}
function dialIn(c) {
  if (!c || (bbs && bbs.phase !== 'typing')) return;
  track('enter', 'megazine-bbs');
  if (bbs) stopTyping(false);
  // stand back far enough that the whole screen fits the view
  const t = Math.tan(camera.fov * DEG / 2);
  const dist = Math.max(c.size.h / 2 / t, c.size.w / 2 / (t * camera.aspect)) * 1.04;
  glideTo(c, c.viewPoint(dist), c.normal.clone().negate(), openBBS);
  c.screen.setMode('calling');
  document.body.classList.add('bbs-calling');
}
// Sit at the giant keyboard: what the player types, the hands type.
function sitToType(c) {
  if (bbs || !c) return;
  const v = c.typingView(camera.aspect);
  glideTo(c, v.pos, v.look, startTyping);
  // focus now, while this is still the player's tap, so phones open their keyboard
  focusTypeInput();
}
function startTyping() {
  bbs.phase = 'typing';
  const { c } = bbs;
  c.screen.startTyping();
  c.hands.onType = (ch) => c.screen.typeChar(ch);
  document.body.classList.add('typing-on');
  focusTypeInput();
}
function stopTyping(restore = true) {
  if (!bbs || bbs.phase !== 'typing') return;
  bbs.c.hands.onType = null;
  bbs.c.screen.setMode('idle');
  document.body.classList.remove('typing-on');
  $('type-input').blur();
  if (restore) { bbs = null; controls.enabled = true; updateDialButton(); }
}
function focusTypeInput() {
  const el = $('type-input');
  el.value = ' '; // something for Backspace to delete, so phones report it
  el.focus({ preventScroll: true });
}
function typeKey(ch) {
  if (!bbs || bbs.phase !== 'typing') return;
  const { c } = bbs;
  if (ch === '\b' || !c.hands.press(ch)) c.screen.typeChar(ch); // no finger for it: straight to the screen
}
function stepDial(dt) {
  bbs.t = Math.min(1, bbs.t + dt / 2.2);
  const u = bbs.t < 0.5 ? 4 * bbs.t ** 3 : 1 - (-2 * bbs.t + 2) ** 3 / 2;
  controls.position.lerpVectors(bbs.from, bbs.to, u);
  const dh = ((bbs.toPose.heading - bbs.fromPose.heading + 540) % 360) - 180;
  controls.heading = (bbs.fromPose.heading + dh * u + 360) % 360;
  controls.pitch = THREE.MathUtils.lerp(bbs.fromPose.pitch, bbs.toPose.pitch, u);
  controls.updateCamera();
  if (bbs.t >= 1) bbs.then();
}
function openBBS() {
  bbs.phase = 'online';
  bbs.c.screen.setMode('online');
  document.body.classList.remove('bbs-calling');
  document.body.classList.add('bbs-on');
  const frame = document.createElement('iframe');
  frame.src = bbs.c.url;
  frame.title = 'MEGAzine BBS';
  frame.allow = 'clipboard-read; clipboard-write; fullscreen';
  $('bbs-slot').replaceChildren(frame);
  $('bbs-open').href = bbs.c.url;
  placeBBS();
  frame.focus();
}
// line the frame up with the monitor glass when it is big enough on screen
function placeBBS() {
  if (!bbs || bbs.phase !== 'online') return;
  const pts = bbs.c.corners().map((p) => p.project(camera));
  const xs = pts.map((p) => (p.x + 1) / 2 * innerWidth), ys = pts.map((p) => (1 - p.y) / 2 * innerHeight);
  const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const fits = r.w >= 560 && r.h >= 400 && r.x >= 0 && r.y >= 0 && r.x + r.w <= innerWidth && r.y + r.h <= innerHeight;
  const el = $('bbs-slot');
  el.classList.toggle('full', !fits);
  Object.assign(el.style, fits ? { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` } : { left: '', top: '', width: '', height: '' });
}
function hangUp() {
  if (!bbs) return;
  bbs.c.screen.hangUp();
  $('bbs-slot').replaceChildren();
  document.body.classList.remove('bbs-on', 'bbs-calling');
  bbs = null;
  controls.enabled = true;
  updateDialButton();
  toast('NO CARRIER', 1500);
}

// ------------------------------------------------------------------ catapults
let catapult = null;       // the catapult whose panel is open
let follow = null;         // { body, saved, hold } while the camera follows a shot
function catapults() { return [...structureObjects.values()].map((g) => g.userData.catapult).filter(Boolean); }
function nearestCatapult(maxDist = 320) {
  let best = null, bd = maxDist;
  for (const c of catapults()) { const d = c.center().distanceTo(controls.position); if (d < bd) { bd = d; best = c; } }
  return best;
}
function fmtDist(m) { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`; }
function renderCatapultPanel() {
  const c = catapult; if (!c) return;
  $('cat-name').textContent = c.name;
  const grid = $('cat-ammo');
  if (grid.dataset.for !== c.feature.id) {
    grid.dataset.for = c.feature.id;
    grid.innerHTML = '';
    for (const a of c.catalog) {
      const b = document.createElement('button');
      b.innerHTML = `${a.emoji}<span>${a.label}</span>`; b.title = a.label; b.dataset.id = a.id;
      b.onclick = () => { c.select(a.id); renderCatapultPanel(); };
      grid.appendChild(b);
    }
    $('cat-power').value = c.power; $('cat-angle').value = c.angle; $('cat-aim').value = c.aim; $('cat-follow').checked = c.follow;
  }
  for (const b of grid.children) b.classList.toggle('on', b.dataset.id === c.selection.id);
  const sizes = $('cat-sizes'); sizes.innerHTML = '';
  const def = c.current();
  def.sizes.forEach((sz, i) => {
    const b = document.createElement('button');
    b.textContent = def.sizes.length === 1 ? `${sz} m` : `${c.sizeLabel(def, i)} · ${sz} m`;
    b.classList.toggle('on', i === c.selection.si);
    b.onclick = () => { c.select(def.id, i); renderCatapultPanel(); };
    sizes.appendChild(b);
  });
  $('cat-power-v').textContent = `${c.power} m/s`;
  $('cat-angle-v').textContent = `${c.angle}°`;
  $('cat-aim-v').textContent = `${c.heading().toFixed(0)}° ${compass(c.heading())}`;
  $('cat-pred').textContent = c.predicted ? `≈ ${fmtDist(c.predicted.dist)}` : 'into orbit?';
  $('cat-pred').title = c.predicted ? `Predicted to land ${c.predicted.where}` : '';
  $('cat-fire').disabled = !c.canFire();
  const L = c.lastShot;
  $('cat-last').textContent = L ? `Last: ${L.label} flew ${fmtDist(L.dist)} (peak ${fmtDist(L.maxAlt)}), landed ${L.where} at ${L.lat.toFixed(4)}, ${L.lon.toFixed(4)}` : 'Pick something from the pen (or click it), then launch.';
}
function updateCatapultPanel() {
  const c = ride || follow ? null : nearestCatapult();
  if (c !== catapult) {
    if (catapult) catapult.setPreviewVisible(false);
    catapult = c;
    $('catapult-panel').classList.toggle('hidden', !c);
    if (c) {
      c.setPreviewVisible(true);
      c.onShot = (body) => {
        if (body.def.cry) toast(body.def.cry, 2000);
        if (c.follow) startFollow(body);
      };
      c.onLand = (shot) => {
        toast(`${shot.label} ${shot.state === 'splat' ? 'splatted' : shot.state === 'sink' ? 'sank' : shot.state === 'float' ? 'is floating' : 'landed'} ${shot.where}, ${fmtDist(shot.dist)} away`, 4000);
        renderCatapultPanel();
      };
    }
  }
  if (c) renderCatapultPanel();
}
function fireCatapult() {
  if (!catapult || !catapult.canFire()) return;
  track('go', 'catapult');
  catapult.fire();
  renderCatapultPanel();
}
function startFollow(body) {
  follow = { body, saved: { pos: controls.position.clone(), heading: controls.heading, pitch: controls.pitch }, hold: 0, cam: null };
  controls.enabled = false;
  document.body.classList.add('following');
}
function endFollow() {
  if (!follow) return;
  controls.position.copy(follow.saved.pos);
  controls.heading = follow.saved.heading; controls.pitch = follow.saved.pitch;
  controls.enabled = true;
  controls.updateCamera();
  follow = null;
  document.body.classList.remove('following');
}
function updateFollow(dt) {
  const b = follow.body;
  const pos = b.pos;
  const upv = pos.clone().normalize();
  let back = b.vel.lengthSq() > 1 ? b.vel.clone().normalize() : (follow.lastDir || upv.clone());
  follow.lastDir = back.clone();
  const dist = 22 + b.size * 4;
  const want = pos.clone().addScaledVector(back, -dist).addScaledVector(upv, 7 + b.size * 1.5);
  // never put the camera under the ground
  const wdir = want.clone().normalize();
  const g = R + Math.max(0, planet.elevation(wdir)) + 3;
  if (want.length() < g) want.setLength(g);
  if (!follow.cam) follow.cam = want.clone(); else follow.cam.lerp(want, Math.min(1, dt * 4));
  camera.position.copy(follow.cam);
  camera.up.copy(follow.cam.clone().normalize());
  camera.lookAt(pos);
  controls.position.copy(follow.cam);
  if (b.state !== 'fly') { follow.hold += dt; if (follow.hold > 3) endFollow(); }
}

// ------------------------------------------------------------------ HUD
let pickInfo = null;
function updateHUD() {
  const { lat, lon } = controls.latLon;
  const alt = controls.altitude;
  $('hud-lat').textContent = formatLat(lat);
  $('hud-lon').textContent = formatLon(wrapLon(lon));
  $('hud-alt').textContent = alt >= 1000 ? `${(alt / 1000).toFixed(2)} km` : `${alt.toFixed(1)} m`;
  $('hud-heading').textContent = `${controls.heading.toFixed(0)}° ${compass(controls.heading)}`;
  const dir = controls.position.clone().normalize();
  const e = planet.elevation(dir);
  $('hud-ground').textContent = planet.inTunnel(controls.position) ? 'in tunnel' : e > 0 ? `land +${e.toFixed(0)} m` : `sea (${(-e).toFixed(0)} m deep)`;
  $('hud-speed').textContent = ride ? `${eye.speed.toFixed(0)} m/s (riding)` : `${controls.baseSpeed().toFixed(0)} m/s`;
  $('hud-pick').textContent = pickInfo
    ? `${formatLat(pickInfo.lat)}, ${formatLon(pickInfo.lon)} · ${pickInfo.elevation > 0 ? `+${pickInfo.elevation.toFixed(0)} m` : 'water'} · ${pickInfo.distance.toFixed(0)} m away`
    : '–';
}
function compass(h) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(h / 45) % 8];
}
function positionString() {
  const { lat, lon } = controls.latLon;
  return `lat ${lat.toFixed(4)}, lon ${wrapLon(lon).toFixed(4)}, alt ${controls.altitude.toFixed(0)}, heading ${controls.heading.toFixed(0)}`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ------------------------------------------------------------------ URL state
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (!h.has('lat')) return null;
  return {
    world: h.get('w'),
    view: { lat: +h.get('lat'), lon: +h.get('lon'), alt: +(h.get('alt') ?? 500), heading: +(h.get('h') ?? 0), pitch: +(h.get('p') ?? -30) },
  };
}
function writeHash() {
  if (!controls || !store.current) return;
  const { lat, lon } = controls.latLon;
  const h = new URLSearchParams({ w: store.current.id, lat: lat.toFixed(4), lon: wrapLon(lon).toFixed(4), alt: controls.altitude.toFixed(0), h: controls.heading.toFixed(0), p: controls.pitch.toFixed(0) });
  history.replaceState(null, '', '#' + h.toString());
}

// ------------------------------------------------------------------ UI wiring
function wireUI() {
  const typeSel = $('build-type');
  for (const t of STRUCTURE_TYPES) { const o = document.createElement('option'); o.value = t; o.textContent = STRUCTURES[t].label; typeSel.appendChild(o); }
  typeSel.value = 'house';

  $('btn-copy-pos').onclick = async () => toast((await copyText(positionString())) ? `Copied: ${positionString()}` : positionString(), 4000);
  $('btn-share').onclick = async () => { writeHash(); toast((await copyText(location.href)) ? 'Link copied' : location.href, 3000); };
  $('btn-goto').onclick = () => {
    const lat = parseFloat($('goto-lat').value), lon = parseFloat($('goto-lon').value);
    if (Number.isNaN(lat) || Number.isNaN(lon)) { toast('Enter lat and lon'); return; }
    controls.teleport(THREE.MathUtils.clamp(lat, -90, 90), wrapLon(lon), Math.max(60, Math.min(controls.altitude, 400)), controls.heading, -35);
  };
  for (const id of ['goto-lat', 'goto-lon']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-goto').click(); });

  $('btn-load').onclick = async () => {
    const id = $('world-select').value;
    if (!id || id === store.current.id) return;
    await store.load(id);
    await buildWorld(store.current);
    toast(`Loaded ${store.current.name}`);
  };
  $('btn-new').onclick = async () => {
    const input = prompt('New blank world.\nEnter a seed number, or leave empty for a random seed:', '');
    if (input === null) return;
    const seed = input.trim() === '' ? randomSeed() : (Number.parseInt(input, 10) >>> 0);
    const name = prompt('Name for this world:', `World ${seed}`) || `World ${seed}`;
    const id = store.createLocal({ name, seed });
    await store.load(id);
    await buildWorld(store.current);
    toast(`New world “${name}” (seed ${seed})`);
  };
  $('btn-reset').onclick = async () => {
    const w = store.current;
    const msg = w.kind === 'repo' ? `Discard your local changes to “${w.name}” and restore it as published?` : `Remove all structures from “${w.name}”? (terrain/seed is kept)`;
    if (!confirm(msg)) return;
    const view = { ...controls.latLon, alt: controls.altitude, heading: controls.heading, pitch: controls.pitch };
    await store.reset();
    await buildWorld(store.current, view);
    toast('World reset');
  };
  $('btn-export').onclick = () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${store.current.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'world'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('btn-import').onclick = () => $('file-import').click();
  $('file-import').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const id = store.importJSON(await file.text());
      await store.load(id);
      await buildWorld(store.current);
      toast(`Imported ${store.current.name}`);
    } catch (err) { toast(`Import failed: ${err.message}`, 4000); }
    e.target.value = '';
  };

  $('build-toggle').onchange = (e) => setBuildMode(e.target.checked);
  $('cat-fire').onclick = () => fireCatapult();
  $('cat-collapse').onclick = () => { const b = $('cat-body'); b.classList.toggle('hidden'); $('cat-collapse').textContent = b.classList.contains('hidden') ? 'show' : 'hide'; };
  let previewTimer = 0;
  const onCatInput = () => {
    if (!catapult) return;
    catapult.power = +$('cat-power').value; catapult.angle = +$('cat-angle').value; catapult.aim = +$('cat-aim').value;
    clearTimeout(previewTimer); previewTimer = setTimeout(() => { catapult && catapult.refreshPreview(); renderCatapultPanel(); }, 60);
    renderCatapultPanel();
  };
  for (const id of ['cat-power', 'cat-angle', 'cat-aim']) $(id).addEventListener('input', onCatInput);
  $('cat-follow').onchange = (e) => { if (catapult) catapult.follow = e.target.checked; };
  $('btn-ride').onclick = () => { if (ride) endRide(); else startRide(nearestCoaster()); updateRideButton(); };
  $('btn-dial').onclick = () => dialIn(nearestComputer());
  $('btn-type').onclick = () => sitToType(nearestComputer());
  $('btn-organ').onclick = () => sitAtOrgan(nearestStage());
  $('btn-university').onclick = () => enterUniversity(nearestUniversity());
  $('btn-ashland').onclick = () => ashlandGate(nearestAshland());
  $('ash-stay').onclick = ashlandGateClose;
  $('ash-stop').onclick = stopAshland;
  $('ash-gate').addEventListener('pointerdown', (e) => { if (e.target === $('ash-gate')) ashlandGateClose(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) stopAshland(); });
  $('btn-orbitakt').onclick = () => orbitGate(nearestOrbitakt());
  $('orbit-stay').onclick = orbitGateClose;
  $('orbit-gate').addEventListener('pointerdown', (e) => { if (e.target === $('orbit-gate')) orbitGateClose(); });
  $('orbit-stop').onclick = stopTeleport;
  // coming back with the Back button can restore the page just as it was left
  window.addEventListener('pageshow', (e) => { if (e.persisted) stopTeleport(); });
  $('btn-skip').onclick = () => tryLastSkip(nearestSkip());
  $('btn-comic').onclick = () => openComic(nearestComic());
  window.addEventListener('pageshow', (e) => { if (e.persisted) endSkip(); });
  $('btn-paper').onclick = () => runPaperMachine(nearestPaperMachine());
  window.addEventListener('pageshow', (e) => { if (e.persisted) stopPaperMachine(); });
  $('uni-leave').onclick = leaveUniversity;
  $('uni-window').onclick = () => {
    const on = document.body.classList.toggle('uni-gazing');
    $('uni-window').textContent = on ? '📄 Back to the memo' : '🪟 Look out the window';
    placeUniView();
  };
  window.addEventListener('resize', placeUniView);
  $('organ-stand').onclick = leaveOrgan;
  window.addEventListener('keyup', (e) => { if (bbs?.phase === 'organ' && ORGAN_KEYS[e.code]) organKeyUp(ORGAN_KEYS[e.code]); });
  window.addEventListener('resize', placeOrganFrame);
  organTouch = mountOrganKeys($('organ-keys'), {
    down: (key) => { if (bbs?.phase === 'organ') organKeyDown(key); },
    up: (key) => { if (bbs?.phase === 'organ') organKeyUp(key); },
    octave: organOctaveShift,
  });
  // iPhones only let audio start on a finger lift or a click, not a finger down
  for (const type of ['touchend', 'click']) window.addEventListener(type, () => {
    if (thingSynth && bbs?.phase === 'organ' && !thingSynth.host.audio.running()) {
      thingSynth.start().catch(() => {});
      thingSynth.output.context.resume().catch(() => {});
    }
  }, { capture: true, passive: true });
  $('type-dial').onclick = () => dialIn(bbs?.c);
  $('type-stand').onclick = () => stopTyping();
  // typing goes through a hidden text field, which also brings up a phone's keyboard
  const ti = $('type-input');
  ti.addEventListener('beforeinput', (e) => {
    e.preventDefault();
    if (e.inputType === 'insertText' && e.data) for (const ch of e.data) typeKey(ch);
    else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') typeKey('\n');
    else if (e.inputType === 'deleteContentBackward') typeKey('\b');
  });
  ti.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); typeKey('\n'); }
    if (e.key === 'Escape') { e.preventDefault(); stopTyping(); }
  });
  // clicking the scene while seated keeps the keyboard focused
  renderer.domElement.addEventListener('pointerdown', () => { if (bbs?.phase === 'typing') setTimeout(focusTypeInput, 0); });
  $('bbs-hangup').onclick = hangUp;
  window.addEventListener('resize', placeBBS);
  $('visit-select').onchange = (e) => {
    const s = store.current.structures.find((x) => x.id === e.target.value);
    e.target.value = '';
    e.target.blur(); // back to flying, so the next keys steer
    if (!s || bbs) return;
    if (ride) endRide();
    if (follow) endFollow();
    track('go', 'menu');
    track('visit', s.id);
    flyToStructure(s);
    toast(s.name || STRUCTURES[s.type]?.label || s.type, 1800);
  };
  $('btn-toggle-list').onclick = () => { const l = $('structure-list'); l.classList.toggle('hidden'); $('btn-toggle-list').textContent = l.classList.contains('hidden') ? 'show' : 'hide'; };
  $('opt-grid').onchange = (e) => { if (gridGroup) gridGroup.visible = e.target.checked; };
  $('opt-clouds').onchange = (e) => { if (cloudMesh) cloudMesh.visible = e.target.checked; };
  $('opt-wire').onchange = (e) => { if (terrain) terrain.material.wireframe = e.target.checked; };
  $('opt-labels').onchange = () => { /* handled per-frame */ };

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if (!$('about').classList.contains('hidden') || document.body.classList.contains('intro-open')) return;
    if (!$('orbit-gate').classList.contains('hidden')) { if (e.code === 'Escape') orbitGateClose(); return; }
    if (skip) return;
    if (!$('ash-gate').classList.contains('hidden')) { if (e.code === 'Escape') ashlandGateClose(); return; }
    if (ash) { if (e.code === 'Escape') stopAshland(); return; }
    if (tele) { if (e.code === 'Escape') stopTeleport(); return; }
    if (paper) { if (e.code === 'Escape') stopPaperMachine(); return; }
    if (uni) { if (e.code === 'Escape') leaveUniversity(); return; }
    if (bbs?.phase === 'organ') {
      if (e.code === 'Escape') { leaveOrgan(); return; }
      const key = ORGAN_KEYS[e.code];
      if (key) { e.preventDefault(); if (!e.repeat) organKeyDown(key); }
      if ((e.code === 'KeyZ' || e.code === 'KeyX') && !e.repeat) {
        organOctaveShift(e.code === 'KeyZ' ? -12 : 12);
      }
      return;
    }
    if (e.code === 'KeyH') setHelp($('help').classList.contains('hidden'));
    if (e.code === 'KeyU') { document.body.classList.toggle('photo'); toast(document.body.classList.contains('photo') ? 'Photo mode: UI hidden (U to show)' : 'UI shown', 1500); }
    if (e.code === 'KeyG') { $('opt-grid').checked = !$('opt-grid').checked; $('opt-grid').onchange({ target: $('opt-grid') }); }
    if (e.code === 'KeyB') setBuildMode(!buildMode);
    if (bbs && e.code === 'Escape') { if (bbs.phase === 'organ') leaveOrgan(); else if (bbs.phase === 'typing') stopTyping(); else hangUp(); return; }
    if (bbs) return;
    if (ride && ['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { endRide(); updateRideButton(); return; }
    if (follow && ['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { endFollow(); return; }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && catapult) { fireCatapult(); return; }
    if (e.code === 'Escape' && buildMode) setBuildMode(false);
  });

  // pointer: hover readout + click (coords or build)
  const canvas = renderer.domElement;
  let hoverT = 0;
  canvas.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - hoverT < 80 || controls.pointerLocked) return;
    hoverT = now;
    pickInfo = pickGround((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  });
  let lastClick = null;
  canvas.addEventListener('pointerup', async (e) => {
    if (e.button !== 0 || !controls.wasClick(e)) return;
    const ndc = controls.pointerLocked ? new THREE.Vector2(0, 0) : new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    // a second click/tap close by in time and place flies there
    const now = performance.now();
    const double = lastClick && now - lastClick.t < 380 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 30;
    lastClick = double ? null : { t: now, x: e.clientX, y: e.clientY };
    if (double && !buildMode) {
      const hit = pickGround(ndc.x, ndc.y);
      if (hit) { track('go', 'double-click'); controls.flyTo(hit.lat, hit.lon); toast(`Flying to ${formatLat(hit.lat)}, ${formatLon(wrapLon(hit.lon))}`, 1800); }
      return;
    }
    if (!buildMode && !bbs && !uni && !tele && !skip && !ash) {
      const park = nearestAshland();
      if (park) {
        raycaster.setFromCamera(ndc, camera);
        const gateHit = raycaster.intersectObject(park.hit, false)[0];
        const land = gateHit && pickGround(ndc.x, ndc.y);
        if (gateHit && (!land || gateHit.distance < land.distance + 5)) { ashlandGate(park); return; }
      }
    }
    if (!buildMode && !bbs && !uni && !tele && !skip && !paper) {
      raycaster.setFromCamera(ndc, camera);
      const mainframe = nearestPaperMachine();
      const hitFrame = mainframe && raycaster.intersectObject(mainframe.hit, false)[0];
      const below = hitFrame && pickGround(ndc.x, ndc.y);
      if (hitFrame && (!below || hitFrame.distance < below.distance + 5)) { runPaperMachine(mainframe); return; }
      const stones = nearestSkip();
      if (stones && raycaster.intersectObject(stones.hit, false)[0]) { tryLastSkip(stones); return; }
      const comic = nearestComic();
      const hitComic = comic && raycaster.intersectObject(comic.hit, false)[0];
      const shore = hitComic && pickGround(ndc.x, ndc.y);
      if (hitComic && (!shore || hitComic.distance < shore.distance + 5)) { openComic(comic); return; }
      const pad = nearestOrbitakt();
      const hitPad = pad && raycaster.intersectObject(pad.hit, false)[0];
      const under = hitPad && pickGround(ndc.x, ndc.y);
      if (hitPad && (!under || hitPad.distance < under.distance + 5)) { orbitGate(pad); return; }
      const campus = nearestUniversity();
      const hitCampus = campus && raycaster.intersectObject(campus.hit, false)[0];
      const land = hitCampus && pickGround(ndc.x, ndc.y);
      if (hitCampus && (!land || hitCampus.distance < land.distance + 5)) { enterUniversity(campus); return; }
      const screens = computers().map((c) => c.screenMesh);
      const hitScreen = screens.length && raycaster.intersectObjects(screens, false)[0];
      const ground = hitScreen && pickGround(ndc.x, ndc.y);
      if (hitScreen && (!ground || hitScreen.distance < ground.distance + 5)) { // not hidden behind a hill
        dialIn(computers().find((c) => c.screenMesh === hitScreen.object));
        return;
      }
    }
    if (catapult && !buildMode) {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(catapult.site, true);
      const pick = hits.find((h) => h.object.userData.pick)?.object.userData.pick;
      if (pick) { catapult.select(pick.id, pick.si); renderCatapultPanel(); toast(`Loaded: ${catapult.current().label} (${catapult.currentSize()} m)`, 1800); return; }
    }
    const hit = pickGround(ndc.x, ndc.y);
    if (!hit) return;
    if (!buildMode && chat && chat.pick(hit)) {
      toast(`Spot picked for Claude: ${formatLat(hit.lat)}, ${formatLon(wrapLon(hit.lon))}`, 1800);
      return;
    }
    if (buildMode) {
      const rec = store.addStructure({
        type: $('build-type').value, lat: +hit.lat.toFixed(4), lon: +wrapLon(hit.lon).toFixed(4),
        heading: +$('build-heading').value, scale: +$('build-scale').value, color: $('build-color').value,
        name: $('build-name').value.trim() || undefined,
      });
      if (FEATURE_TYPES.has(rec.type)) await refreshFeatures(); else placeStructure(rec);
      updateWorldPanel();
      toast(`Built ${STRUCTURES[rec.type].label} at ${formatLat(rec.lat)}, ${formatLon(rec.lon)}`);
    } else {
      const text = `${hit.lat.toFixed(4)}, ${wrapLon(hit.lon).toFixed(4)}`;
      const ok = await copyText(text);
      toast(`${formatLat(hit.lat)}, ${formatLon(hit.lon)} · ${hit.elevation > 0 ? `elevation ${hit.elevation.toFixed(0)} m` : 'water'}${ok ? ' (copied)' : ''}`, 3500);
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });
}
// ------------------------------------------------------------------ controls card + touch controls
const HELP_KEY = 'worldbuilder.helpHidden';
// The world opens behind a small see-through card, with the full about page a
// click away (and on the About button). Flying pauses while either is open.
function setIntro(show) {
  $('intro').classList.toggle('hidden', !show);
  document.body.classList.toggle('intro-open', show);
  controls.enabled = !show;
  if (show) $('intro-start').focus({ preventScroll: true });
  else $('intro-start').blur();
}
let aboutPaused = false;
function setAbout(show) {
  $('about').classList.toggle('hidden', !show);
  if (show) {
    aboutPaused = controls.enabled;
    controls.enabled = false;
    $('about-card').scrollTop = 0;
    $('about-card').focus({ preventScroll: true });
  } else {
    if (aboutPaused) controls.enabled = true;
    aboutPaused = false;
  }
}
function setHelp(show) {
  $('help').classList.toggle('hidden', !show);
  $('btn-help').classList.toggle('hidden', show);
  document.body.classList.toggle('help-open', show);
  try { localStorage.setItem(HELP_KEY, show ? '0' : '1'); } catch { /* storage unavailable */ }
}

function wireControlsUI() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isTouch = coarse || (hasTouch && window.innerWidth < 1100);
  if (isTouch) document.body.classList.add('touch');
  // show the touch UI the first time a finger touches the canvas, even on hybrid devices
  renderer.domElement.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') document.body.classList.add('touch'); }, { passive: true });
  // iOS Safari: keep pinches and double-taps for the game rather than page zoom
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

  // controls card: shown until dismissed, then a small button brings it back
  let hidden = false;
  try { hidden = localStorage.getItem(HELP_KEY) === '1'; } catch { /* storage unavailable */ }
  setHelp(!hidden);
  $('help-close').onclick = () => setHelp(false);
  $('help-ok').onclick = () => setHelp(false);
  $('btn-help').onclick = () => setHelp(true);
  $('btn-about').onclick = () => setAbout(true);
  $('about-close').onclick = () => setAbout(false);
  $('about-start').onclick = () => setAbout(false);
  $('about').addEventListener('pointerdown', (e) => { if (e.target === $('about')) setAbout(false); });
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !$('about').classList.contains('hidden')) setAbout(false); });
  $('intro-start').onclick = () => setIntro(false);
  $('intro-more').onclick = () => { setIntro(false); setAbout(true); };
  $('intro').addEventListener('pointerdown', (e) => { if (e.target === $('intro')) setIntro(false); });
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && document.body.classList.contains('intro-open')) setIntro(false); });
  setIntro(true);
  $('hud-more').onclick = () => { const on = $('hud').classList.toggle('expanded'); $('hud-more').textContent = on ? 'less' : 'more'; };

  // speed and mouse look
  const showSpeed = (m) => { $('speed-val').textContent = `×${m < 1 ? m.toFixed(2) : m.toFixed(1)}`; };
  controls.onSpeed = (m) => { showSpeed(m); toast(`Speed ×${m < 1 ? m.toFixed(2) : m.toFixed(1)}`, 1000); };
  showSpeed(controls.speedMul);
  $('speed-up').onclick = () => controls.changeSpeed(1.5);
  $('speed-down').onclick = () => controls.changeSpeed(1 / 1.5);
  $('btn-mouselook').onclick = () => controls.toggleMouseLook();
  controls.onMouseLook = (on) => {
    $('btn-mouselook').classList.toggle('active', on);
    if (on) toast('Mouse look: move the mouse to steer, click to pick · Esc to stop', 3000);
  };
  // any manual movement takes the camera back from following a catapult shot
  controls.onInput = () => { if (follow) endFollow(); };

  // menu button toggles the world/build panel on small screens
  $('btn-menu').onclick = () => $('world-panel').classList.toggle('open');

  // floating thumbstick: drawn wherever the left thumb lands
  const stick = $('stick'), knob = $('stick-knob');
  controls.onStick = (st) => {
    stick.classList.toggle('hidden', !st);
    document.body.classList.toggle('sticking', !!st);
    if (!st) return;
    stick.style.left = `${st.x}px`; stick.style.top = `${st.y}px`;
    knob.style.transform = `translate(${st.dx}px, ${st.dy}px)`;
  };

  // climb lever: slide up to climb, down to descend; springs back when released
  const lift = $('lift'), liftKnob = $('lift-knob');
  let liftId = null, liftY = 0;
  const setLift = (e) => {
    const travel = lift.clientHeight / 2 - 28;
    const dy = THREE.MathUtils.clamp(e.clientY - liftY, -travel, travel);
    liftKnob.style.transform = `translateY(${dy}px)`;
    controls.lift = -dy / travel;
  };
  const resetLift = () => { liftId = null; liftKnob.style.transform = ''; controls.lift = 0; lift.classList.remove('active'); };
  lift.addEventListener('pointerdown', (e) => {
    if (liftId !== null) return;
    const r = lift.getBoundingClientRect();
    liftId = e.pointerId; liftY = r.top + r.height / 2; lift.classList.add('active');
    try { lift.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setLift(e); e.preventDefault();
  });
  lift.addEventListener('pointermove', (e) => { if (e.pointerId === liftId) setLift(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) lift.addEventListener(ev, (e) => { if (e.pointerId === liftId) resetLift(); });

  $('tbtn-boost').addEventListener('pointerdown', (e) => { e.preventDefault(); controls.boost = !controls.boost; $('tbtn-boost').classList.toggle('active', controls.boost); toast(controls.boost ? 'Boost on (4× speed)' : 'Boost off', 1200); });
  for (const el of [lift, $('tbtn-boost')]) el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ------------------------------------------------------------------ shared world + Claude chat
let chat = null;
const spotMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.75, 1, 40),
  new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
);
spotMarker.renderOrder = 10;
spotMarker.visible = false;
scene.add(spotMarker);
function showSpot(hit) {
  spotMarker.visible = !!hit;
  if (!hit) return;
  const dir = latLonToDir(hit.lat, hit.lon);
  spotMarker.position.copy(dir).multiplyScalar(planet.groundRadius(dir) + 0.5);
  spotMarker.lookAt(spotMarker.position.clone().add(dir));
}

// Bring the scene in line with the shared edits from the server.
async function applyEdits(edits, { fly = false, own = false } = {}) {
  const types = new Map(store.current.structures.map((s) => [s.id, s.type]));
  const diff = store.applyShared(edits);
  if (!diff) return;
  for (const id of diff.removed) removeStructureObject(id);
  const reshape = diff.added.some((s) => FEATURE_TYPES.has(s.type)) || diff.removed.some((id) => FEATURE_TYPES.has(types.get(id)));
  if (reshape) await refreshFeatures();
  else for (const rec of diff.added) placeStructure(rec);
  updateWorldPanel();
  const first = diff.added[0];
  if (fly && first) {
    const { lat, lon } = controls.latLon;
    const far = latLonToDir(lat, lon).angleTo(latLonToDir(first.lat, first.lon)) * R > 250;
    if (far && !ride && !follow) controls.flyTo(first.lat, first.lon);
  }
  if (!own && diff.added.length) toast(`New in the world: ${diff.added.map((s) => s.name || STRUCTURES[s.type]?.label || s.type).slice(0, 3).join(', ')}`, 3500);
}

function wireChat() {
  chat = initChat({ store, controls, applyEdits, onSpot: showSpot });
  chat.enable();
  // pick up what other players have built
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || chat.busy || store.current?.kind !== 'repo') return;
    const edits = await store.fetchShared(store.current.id, store.shared?.version);
    if (edits) applyEdits(edits);
  }, 6000);
}

function setBuildMode(on) {
  buildMode = on;
  $('build-toggle').checked = on;
  renderer.domElement.style.cursor = on ? 'crosshair' : 'grab';
  toast(on ? `Build mode: click the globe to place a ${STRUCTURES[$('build-type').value].label}` : 'Build mode off');
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let hudT = 0, hashT = 0, catT = 0;
const _tmp = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!controls) return;
  if (ash) {
    stepAshland(dt);
  } else if (paper) {
    if (!paper.left) stepPaperMachine(dt);
  } else if (skip) {
    stepSkip(dt);
  } else if (tele) {
    if (!teleLeft) stepTeleport(dt);
  } else if (uni) {
    stepUniversity(dt);
  } else if (bbs) {
    if (bbs.phase === 'flying') stepDial(dt);
  } else if (follow) {
    updateFollow(dt);
  } else if (ride) {
    ride.eye(eye);
    camera.position.copy(eye.pos);
    camera.up.copy(eye.up);
    camera.lookAt(eye.target);
    controls.position.copy(eye.pos); // keeps HUD, terrain detail and sun following the rider
    const fwd = eye.target.clone().sub(eye.pos).normalize();
    const fr = tangentFrame(eye.pos);
    controls.heading = (Math.atan2(fwd.dot(fr.east), fwd.dot(fr.north)) / DEG + 360) % 360;
  } else {
    controls.update(dt);
  }
  updateSun(dt);
  if (spotMarker.visible) spotMarker.scale.setScalar(THREE.MathUtils.clamp(camera.position.distanceTo(spotMarker.position) * 0.025, 3, 400));
  if (terrain) terrain.update(controls.position);
  if (cloudMesh && cloudMesh.visible) cloudMesh.rotation.y += dt * 0.004;
  for (const s of spinners) s.rotation.z += dt * 1.2;
  for (const o of animated) o.userData.update(dt);

  // label visibility: hide labels that are far away or over the horizon
  const showLabels = $('opt-labels').checked;
  for (const g of structureObjects.values()) {
    const lo = g.userData.label;
    if (!lo) continue;
    let vis = showLabels && !paper && !uni && !tele && !skip;
    if (vis) {
      _tmp.copy(g.position).sub(camera.position);
      const dist = _tmp.length();
      vis = dist < g.userData.labelRange + controls.altitude * 2.5 && _tmp.dot(g.position) < 0;
    }
    lo.visible = vis;
  }

  const now = performance.now();
  if (now - hudT > 100) { hudT = now; updateHUD(); updateRideButton(); updateDialButton(); }
  if (now - catT > 400) { catT = now; updateCatapultPanel(); }
  if (now - hashT > 1500 && !paper && !tele && !skip && !ash) { hashT = now; writeHash(); }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
(async function boot() {
  wireUI();
  await store.init();
  const hash = readHash();
  const worlds = store.listWorlds();
  let id = (hash && hash.world) || store.lastWorldId();
  if (!worlds.some((w) => w.id === id)) id = worlds[0]?.id;
  if (!id) {
    id = store.createLocal({ name: 'My World', seed: randomSeed() });
  }
  try {
    await store.load(id);
  } catch {
    await store.load(worlds[0].id);
  }
  await buildWorld(store.current, hash && hash.world === store.current.id ? hash.view : null);
  wireControlsUI();
  wireChat();
  gardenCtx.viewer = () => controls.position;
  startStats({
    dirOf: (p) => latLonToDir(p.lat, p.lon),
    where: () => (uni ? null : { ...dirToLatLon(controls.position.clone().normalize()), alt: controls.altitude }),
    places: () => (store.current.id === 'home' ? store.current.structures.filter((s) => s.lat != null && s.createdBy !== 'claude') : []),
  });
  renderer.domElement.style.cursor = 'grab';
  animate();
  window.worldbuilder = { store, scene, camera, get planet() { return planet; }, get controls() { return controls; }, get terrain() { return terrain; }, get ride() { return ride; }, startRide, endRide, nearestCoaster, structureObjects, get thingSynth() { return thingSynth; }, get uni() { return uni; }, get tele() { return tele; }, get ash() { return ash; }, ashlandGate, walkIntoAshland, stopAshland, get skip() { return skip; }, tryLastSkip, endSkip, get paper() { return paper; }, runPaperMachine, stopPaperMachine, orbitGate, launchOrbitakt, stopTeleport, enterUniversity, leaveUniversity, sitAtOrgan, leaveOrgan, setPose, showScene, get catapult() { return catapult; }, fireCatapult, sun, pickGround, placeStructure };
})();
