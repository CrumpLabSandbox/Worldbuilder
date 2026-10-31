// The Night Window, the way in to HomeBlocks: a block of apartment towers where it
// is always night. HomeBlocks lets you click from a homepage to its tenant's window
// in the skyline; this goes the other way. One window stands open with a homepage
// shining out of it, and a beam of light runs down to the street. Follow the beam
// up, in through the window, and HomeBlocks itself opens in a frame, with the city
// spread out behind it. Lights in the towers go on and off as you watch.
//
// The street runs along +z, with the open window at the far end facing back down it.
import * as THREE from 'three';
import { R, tangentFrame } from './planet.js';
import { mulberry32 } from './noise.js';
import { Bag } from './university.js';

const DEG = Math.PI / 180;
const HERO = { w: 260, h: 640, z: -300 };               // the tower with the open window
const PANE = { w: 190, h: 240, y: 300 };                // the open window
const PANE_Z = HERO.z + 78 + 1;
const WALLS = [0x3a2238, 0x2c2a4a, 0x4a2a2a, 0x23334f, 0x3f3550, 0x2f2a3a];
const LIT = [0xffd76a, 0xffe9a6, 0xffb35c, 0x9fd8ff, 0xff9ec7];
const DARK = 0x0a0c22;
const SKY = 9000;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const glow = (extra) => new THREE.MeshBasicMaterial({ toneMapped: false, ...extra });

// HomeBlocks' front page in a NetSurfer window, as seen from the street.
function pageTexture() {
  return canvasTexture(570, 720, (c, w, h) => {
    c.fillStyle = '#c0c0c0'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#000080'; c.fillRect(10, 10, w - 20, 44);
    c.fillStyle = '#fff'; c.font = 'bold 26px Arial, sans-serif'; c.fillText('NetSurfer - HomeBlocks', 22, 41);
    c.fillStyle = '#fff'; c.fillRect(10, 62, w - 20, h - 72);
    c.fillStyle = '#000080'; c.fillRect(10, 62, w - 20, 70);
    c.fillStyle = '#ffc94d'; c.font = 'bold 44px Arial, sans-serif'; c.fillText('Home', 32, 113);
    c.fillStyle = '#fff'; c.fillText('Blocks', 142, 113);
    c.fillStyle = '#ffd34d'; c.fillRect(10, 132, w - 20, 30);
    c.fillStyle = '#000'; c.font = 'bold 19px Arial, sans-serif'; c.fillText('Free homesteads for every block in the city!', 22, 154);
    c.fillStyle = '#e8001c'; c.fillRect(34, 180, w - 68, 76);
    c.fillStyle = '#ffff00'; c.font = 'bold 30px Arial, sans-serif'; c.textAlign = 'center'; c.fillText('WIN A FREE 56K MODEM!!!', w / 2, 212);
    c.fillStyle = '#fff'; c.font = '18px Arial, sans-serif'; c.fillText('Click the duck to win!', w / 2, 240);
    c.textAlign = 'left'; c.fillStyle = '#000'; c.font = 'bold 28px Arial, sans-serif'; c.fillText('Neighborhoods', 34, 302);
    const hoods = ['Silicon Alley', 'Marquee', 'Sunset Strip', 'Athens', 'Heartland', 'PawPrint Park', 'Area 51', 'Cape Canaveral', 'Colosseum', 'Left Bank', 'Supper Club', 'Graveyard Shift'];
    hoods.forEach((n, i) => {
      const x = 34 + (i % 2) * 256, y = 322 + Math.floor(i / 2) * 58;
      c.fillStyle = '#eaf0ff'; c.fillRect(x, y, 246, 50);
      c.fillStyle = '#0000ee'; c.font = 'bold 24px Arial, sans-serif'; c.fillText(n, x + 12, y + 33);
      c.fillRect(x + 12, y + 37, c.measureText(n).width, 2);
    });
    c.fillStyle = '#c0c0c0'; c.fillRect(10, h - 26, w - 20, 16);
  });
}

// Every tower's windows share one mesh, so the lights can change cheaply.
class Lights {
  constructor(rng, list) {
    const n = list.length;
    this.rng = rng;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glow({ color: 0xffffff }), n);
    this.color = new THREE.Color();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(7, 10, 1), Y = new THREE.Vector3(0, 1, 0);
    list.forEach(({ pos, turn }, i) => {
      m.compose(pos, q.setFromAxisAngle(Y, turn), s);
      this.mesh.setMatrixAt(i, m);
      this.set(i, rng() < 0.36);
    });
    this.mesh.frustumCulled = false;
    this.count = n;
  }
  set(i, on) { this.mesh.setColorAt(i, this.color.setHex(on ? LIT[Math.floor(this.rng() * LIT.length)] : DARK)); }
  twinkle(k) {
    for (let j = 0; j < k; j++) this.set(Math.floor(this.rng() * this.count), this.rng() < 0.4);
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// One apartment tower, its rows of windows on three sides, turned by `turn` about y.
function tower(bag, windows, rng, x, z, w, d, h, turn, color) {
  bag.box(w, h, d, color, x, h / 2, z, turn);
  bag.box(w + 8, 6, d + 8, 0x16182e, x, h + 3, z, turn);
  bag.lathe([[11, 0], [9, 26], [0.1, 40]], 0x2a2a44, x + (rng() - 0.5) * w * 0.6, h + 6, z + (rng() - 0.5) * d * 0.6, 8, false);
  const c = Math.cos(turn), s = Math.sin(turn), at = (a, b, e) => new THREE.Vector3(x + a * c + e * s, b, z - a * s + e * c);
  const rows = Math.floor((h - 24) / 16);
  for (let r = 0; r < rows; r++) {
    const y = 20 + r * 16;
    for (let i = 0, cols = Math.floor((w - 12) / 14); i < cols; i++) windows.push({ pos: at(-w / 2 + 13 + i * 14, y, d / 2 + 0.7), turn });
    for (const side of [-1, 1]) for (let i = 0, cols = Math.floor((d - 12) / 14); i < cols; i++) {
      windows.push({ pos: at(side * (w / 2 + 0.7), y, -d / 2 + 13 + i * 14), turn: turn + side * Math.PI / 2 });
    }
  }
}

// The block itself: a horseshoe of towers round the end of the street.
function buildBlock(g, rng) {
  const bag = new Bag(), windows = [];
  for (let row = 0; row < 3; row++) for (let i = -6; i <= 6; i++) {
    const w = 90 + rng() * 60, d = 110, h = 170 + rng() * 220 + row * 90 + Math.abs(i) * 8;
    const x = i * 150 + (row % 2 ? 70 : 0), z = -250 - row * 150 + i * i * 12;
    if (Math.abs(x) < 240 && z > -470) continue; // room for the hero tower, in clear view of the street
    tower(bag, windows, rng, x, z, w, d, h, -i * 0.05, WALLS[Math.floor(rng() * WALLS.length)]);
  }
  const hero = new Bag();
  hero.box(HERO.w, HERO.h, 156, 0x2c2a4a, 0, HERO.h / 2, HERO.z);
  hero.box(HERO.w + 10, 7, 166, 0x16182e, 0, HERO.h + 3, HERO.z);
  bag.box(170, 2, 1500, 0x1a1c3a, 0, 1, 450, 0, false);                 // the street
  bag.box(690, 2, 300, 0x1a1c3a, 0, 1, -100, 0, false);
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) {                 // street lamps
    bag.box(3, 26, 3, 0x16182e, s * 96, 13, 640 - i * 90, 0, false);
    bag.box(10, 4, 10, 0xffd58a, s * 90, 27, 640 - i * 90, 0, false);
  }
  bag.build(g);
  hero.build(g);
  // the rest of the hero tower's windows, either side of the open one
  for (let r = 0; r < 38; r++) for (let i = 0; i < 17; i++) {
    const x = -HERO.w / 2 + 18 + i * 14, y = 20 + r * 16;
    if (Math.abs(x) < PANE.w / 2 + 16 && y > PANE.y - PANE.h / 2 - 14 && y < PANE.y + PANE.h / 2 + 14) continue;
    windows.push({ pos: new THREE.Vector3(x, y, PANE_Z - 0.4), turn: 0 });
  }
  return new Lights(rng, windows);
}

// The rest of the city, seen only once you're in the night: towers all round.
function buildCity(g, rng) {
  const bag = new Bag(), windows = [];
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2, r = 1050 + rng() * 620, x = Math.sin(a) * r, z = Math.cos(a) * r + 150;
    if (Math.abs(x) < 130) continue;                                     // the street runs on through
    tower(bag, windows, rng, x, z, 130 + rng() * 70, 120, 220 + rng() * 420, a + Math.PI, WALLS[Math.floor(rng() * WALLS.length)]);
  }
  bag.build(g);
  return new Lights(rng, windows);
}

function buildNight(g, rng) {
  const sky = canvasTexture(2048, 1024, (c, w, h) => {
    const up = c.createLinearGradient(0, 0, 0, h / 2);
    [[0, '#03040b'], [0.6, '#0d1038'], [1, '#2a2470']].forEach(([p, col]) => up.addColorStop(p, col));
    c.fillStyle = up; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    for (let i = 0; i < 1600; i++) { c.globalAlpha = 0.25 + rng() * 0.75; const s = 1 + rng() * 1.4; c.fillRect(rng() * w, rng() * h * 0.46, s, s); }
    c.globalAlpha = 1;
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY, 40, 24), glow({ map: sky, side: THREE.BackSide, depthWrite: false }));
  dome.renderOrder = -1;
  g.add(dome);
  const moonTex = canvasTexture(256, 256, (c, w) => {
    const r = w / 2 - 4;
    c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(w / 2, w / 2, r, 0, 7); c.fill();
    c.strokeStyle = '#5a4fb0'; c.lineWidth = 1.2;
    c.save(); c.clip();
    for (let i = 0; i < 26; i++) { c.beginPath(); c.arc(w * 0.3, w * 0.65, r * 0.75 + i * r * 0.07, 0, 7); c.stroke(); }
    c.restore();
  });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), glow({ map: moonTex, transparent: true, depthWrite: false }));
  moon.position.set(2600, 3000, -6000);
  moon.lookAt(0, 300, 0);
  g.add(moon);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(SKY, 48).rotateX(-Math.PI / 2), glow({ color: 0x0d0f2a }));
  ground.position.y = -1;
  g.add(ground);
}

// The open window, its frame, and the beam it throws down the street.
function buildPane(g) {
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(PANE.w, PANE.h), glow({ map: pageTexture() }));
  pane.position.set(0, PANE.y, PANE_Z);
  g.add(pane);
  const bag = new Bag();
  bag.box(PANE.w + 16, PANE.h + 16, 4, 0x16182e, 0, PANE.y, PANE_Z - 2.5, 0, false);
  bag.box(PANE.w + 44, 8, 26, 0x4a3f5a, 0, PANE.y - PANE.h / 2 - 12, PANE_Z + 10);
  bag.build(g);
  const fade = canvasTexture(4, 256, (c, w, h) => {
    const l = c.createLinearGradient(0, 0, 0, h);
    l.addColorStop(0, 'rgba(255,230,140,.75)'); l.addColorStop(0.7, 'rgba(255,230,140,.16)'); l.addColorStop(1, 'rgba(255,230,140,0)');
    c.fillStyle = l; c.fillRect(0, 0, w, h);
  });
  const top = PANE.y - PANE.h / 2, far = 660, geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-PANE.w / 2, top, PANE_Z + 2, PANE.w / 2, top, PANE_Z + 2, 150, 3, far, -150, 3, far], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  const beam = new THREE.Mesh(geo, glow({ map: fade, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  g.add(beam);
}

export function buildNightWindow(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const g = new THREE.Group();
  g.rotation.y = -(rec.heading ?? 0) * DEG;
  site.add(g);

  const rng = mulberry32(5150);
  const lights = [buildBlock(g, rng)];
  g.add(lights[0].mesh);
  buildPane(g);
  const night = new THREE.Group();
  night.visible = false;
  g.add(night);
  buildNight(night, rng);
  const cityLights = buildCity(night, rng);
  night.add(cityLights.mesh);
  lights.push(cityLights);

  const hit = new THREE.Mesh(new THREE.BoxGeometry(HERO.w, HERO.h, 170));
  hit.position.set(0, HERO.h / 2, HERO.z);
  hit.visible = false;
  g.add(hit);

  let clock = 0;
  site.userData.update = (dt) => {
    clock += dt;
    if (clock < 0.4) return;
    clock = 0;
    lights[0].twinkle(5);
    if (night.visible) cityLights.twinkle(5);
  };
  site.userData.labelPos = new THREE.Vector3(0, HERO.h + 70, HERO.z);
  site.userData.labelRange = 9000;
  site.updateMatrixWorld(true);

  const toWorld = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
  const path = new THREE.CatmullRomCurve3([[0, 16, 640], [40, 52, 400], [-30, 130, 160], [0, 250, -90], [0, PANE.y, PANE_Z + 34]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  site.userData.nightWindow = {
    site,
    hit,
    url: rec.url,
    center: site.position.clone(),
    up: up.clone(),
    setScene(on) { night.visible = on; },
    pane: () => toWorld(0, PANE.y, PANE_Z),
    street: () => ({ pos: toWorld(0, 16, 640), look: toWorld(0, PANE.y, PANE_Z) }),
    flight(t) {
      const p = path.getPoint(t);
      return { pos: toWorld(p.x, p.y, p.z), look: toWorld(0, THREE.MathUtils.lerp(PANE.y - 40, PANE.y, t), PANE_Z) };
    },
    // looking back out of the window, over the street
    inside: () => ({ pos: toWorld(0, PANE.y, PANE_Z + 8), look: toWorld(0, PANE.y - 70, 700) }),
    view: () => {
      const pos = toWorld(0, 190, 980);
      return { pos, look: toWorld(0, 300, PANE_Z).sub(pos).normalize() };
    },
  };
  return site;
}
