// The MEGAzine BBS terminal: a colossal beige 486 with a CRT monitor, keyboard,
// mouse and a floppy disk on the ground. Its screen runs a looping DOS boot,
// a Telix dial-up and the board's ANSI banner; players can "dial in", which
// opens the real BBS (a web app) framed inside the monitor.
import * as THREE from 'three';
import { R, latLonToDir, tangentFrame } from './planet.js';
import { TypingHands, SCALE } from './typingHands.js';
import { KEY_HEIGHT } from './hands/instrument/layout.js';

const KEY_TOP = KEY_HEIGHT * SCALE; // key tops above the keyboard plate

const DEG = Math.PI / 180;
export const BBS_URL = 'https://samuelling.github.io/BBS/';

const BEIGE = 0xd9d0b8, BEIGE_DARK = 0xc6bca3, BEIGE_LIGHT = 0xe6dfcc, GREY = 0x8d887c, SLOT = 0x26241f;
const mats = new Map();
function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...extra }));
  return mats.get(key);
}
function glow(color) { return new THREE.MeshBasicMaterial({ color, toneMapped: false }); }
function box(parent, w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// a box whose back face (+z) is scaled down: the tapered shell of a CRT
function taperedBox(w1, h1, w2, h2, depth, dy = 0) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const back = p.getZ(i) > 0;
    p.setXYZ(i, p.getX(i) * (back ? w2 : w1), p.getY(i) * (back ? h2 : h1) + (back ? dy : 0), p.getZ(i) * depth);
  }
  g.computeVertexNormals();
  return g;
}
function labelTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function plaque(parent, w, h, x, y, z, tex, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}
function cable(parent, points, radius = 1.6, color = 0x3b3833) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, radius, 8), mat(color)));
}

// ---------------------------------------------------------------- the screen
// A chunky 50x22 text mode on a 1024x768 canvas (readable from afar), DOS colours.
const DOS = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'];
const COLS = 50, ROWS = 22, CW = 1024 / COLS, CH = 768 / ROWS;
// 5x7 block letters for the banner
const FONT = {
  M: '10001110111010110101100011000110001', E: '11111100001000011110100001000011111', G: '01111100001000010011100011000101111',
  A: '01110100011000111111100011000110001', Z: '11111000010001000100010001000011111', I: '11111001000010000100001000010011111',
  N: '10001110011010110011100011000110001', B: '11110100011000111110100011000111110', S: '01111100001000001110000010000111110',
};
const BOOT = [
  [7, 'MEGA-486 Modular BIOS v4.51PG'],
  [7, '(C) 1984-93, Award Software, Inc.'],
  [7, ''],
  [7, '486DX2-66 CPU at 66MHz'],
  [7, 'MEMORY'],
  [7, ''],
  [7, 'HDD Primary Master ... MEGA 540MB'],
  [7, 'HDD Primary Slave  ... None'],
  [7, ''],
  [7, 'Starting MS-DOS...'],
];
const DIAL = [
  [7, 'C:\\>TELIX'], [7, ''], [14, 'ATZ'], [7, 'OK'], [14, 'ATDT MEGAZINE'], [7, 'DIALING...'], [7, 'RINGING...'], [10, 'CONNECT 14400/ARQ/V42BIS'],
];
const CYCLE = 46; // seconds per boot -> banner -> hang-up loop
const PROMPT = 'C:\\MEGA>';

class Screen {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 768;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.t = 0;
    this.mode = 'idle';  // idle | calling | online
    this.modeT = 0;
    this.last = -1;
    this.draw();
  }
  setMode(mode) { this.mode = mode; this.modeT = 0; this.last = -1; }
  // DOS prompt for typing at the giant keyboard
  startTyping() {
    this.setMode('typing');
    this.out = [[14, 'MEGA-DOS 6.22  Type HELP for commands.'], [7, '']];
    this.line = '';
  }
  typeChar(ch) {
    this.last = -1;
    if (ch === '\b') { this.line = this.line.slice(0, -1); return; }
    if (ch !== '\n') { if (this.line.length < COLS - 10) this.line += ch; return; }
    const cmd = this.line.trim();
    this.out.push([7, `${PROMPT}${this.line}`]);
    this.line = '';
    const [word, ...rest] = cmd.split(/\s+/);
    const w = (word || '').toLowerCase();
    const say = (...lines) => lines.forEach((l) => this.out.push([7, l]));
    if (!w) return;
    if (w === 'cls') this.out = [];
    else if (w === 'help') say('HELP  DIR  VER  ECHO  CLS', 'To call the board, press DIAL IN.');
    else if (w === 'dir') say(' Volume in drive C is MEGAZINE', ' BBS      EXE    14,400', ' ISSUE1   TXT     2,048', ' HANDS    SYS    27,000', '        3 file(s)');
    else if (w === 'ver') say('MEGA-DOS Version 6.22', 'Hands by CognitiveHands');
    else if (w === 'echo') say(rest.join(' '));
    else if (['dial', 'bbs', 'atdt', 'telix'].includes(w)) say('Press DIAL IN to call the board.');
    else say('Bad command or file name');
    this.out = this.out.slice(-(ROWS - 3));
  }
  // back to the idle loop, starting at NO CARRIER
  hangUp() { this.setMode('idle'); this.t = Math.ceil(this.t / CYCLE) * CYCLE + CYCLE - 3; }
  text(col, row, s, color = 7, bg = null) {
    const g = this.ctx;
    if (bg != null) { g.fillStyle = DOS[bg]; g.fillRect(col * CW, row * CH, s.length * CW, CH); }
    g.fillStyle = DOS[color];
    g.fillText(s, col * CW, row * CH + CH * 0.8);
  }
  lines(list, n, row = 1) { list.slice(0, n).forEach(([c, s], i) => this.text(1, row + i, s, c)); }
  bigText(word, x, y, px, color, shadow) {
    const g = this.ctx;
    for (const [col, off] of [[shadow, px * 0.35], [color, 0]]) {
      g.fillStyle = col;
      [...word].forEach((ch, k) => {
        const bits = FONT[ch];
        if (!bits) return;
        for (let i = 0; i < 35; i++) if (bits[i] === '1') g.fillRect(x + (k * 6 + (i % 5)) * px + off, y + Math.floor(i / 5) * px + off, px - 1, px - 1);
      });
    }
  }
  statusBar(online) {
    const secs = Math.floor(this.t % CYCLE);
    const clock = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    const s = ` MEGAzine BBS | 14400 | ${online ? `ONLINE ${clock}` : 'OFFLINE'} | ALT-Z Help`;
    this.text(0, ROWS - 1, s.padEnd(COLS), 15, 1);
  }
  draw() {
    const g = this.ctx;
    g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 768);
    g.font = `${Math.round(CH * 0.86)}px "Courier New", Courier, monospace`;
    g.textBaseline = 'alphabetic';
    const blink = Math.floor(this.t * 2.2) % 2 === 0;
    if (this.mode === 'typing') {
      this.lines(this.out, this.out.length, 0);
      const row = this.out.length;
      this.text(1, row, `${PROMPT}${this.line}${blink ? '_' : ''}`, 7);
      this.statusBar(false);
    } else if (this.mode === 'calling') {
      const n = Math.min(DIAL.length, 1 + Math.floor(this.modeT * 4));
      this.lines(DIAL, n);
      this.statusBar(false);
    } else if (this.mode === 'online') {
      this.text(1, 2, 'CONNECT 14400/ARQ/V42BIS', 10);
      this.text(1, 4, 'You are online.', 15);
      this.text(1, 5, 'The board is on your screen.', 15);
      this.statusBar(true);
    } else {
      const c = this.t % CYCLE;
      if (c < 4.5) {
        const n = Math.min(BOOT.length, Math.floor(c * 2.6) + 1);
        const mem = Math.min(8192, Math.floor(Math.max(0, c - 0.6) * 4096 / 64) * 64);
        this.lines(BOOT.map(([col, s]) => [col, s === 'MEMORY' ? `Memory Test :  ${mem}K OK` : s]), n);
        if (blink && n === BOOT.length) this.text(1, 1 + n, '_');
      } else if (c < 9) {
        const n = Math.min(DIAL.length, 1 + Math.floor((c - 4.5) * 1.8));
        this.lines(DIAL, n);
        if (blink) this.text(1, 1 + n, '_');
        this.statusBar(false);
      } else if (c < CYCLE - 3) {
        this.bigText('MEGAZINE', 128, 40, 16, DOS[11], DOS[1]);
        this.bigText('BBS', 416, 186, 16, DOS[13], DOS[5]);
        this.text(4, 11, 'A dial-up board for the megaZINE', 15);
        this.text(4, 12, 'collective. Call in, upload,', 15);
        this.text(4, 13, 'download, post.', 15);
        this.text(4, 16, '[D]', 11); this.text(8, 16, 'Fly close and press DIAL IN', 7);
        this.text(4, 18, `> ${blink ? '_' : ' '}`, 10);
        this.statusBar(true);
      } else {
        this.text(1, 2, 'NO CARRIER', 12);
        this.statusBar(false);
      }
    }
    // CRT: scanlines and a soft vignette
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < 768; y += 3) g.fillRect(0, y, 1024, 1);
    const v = g.createRadialGradient(512, 384, 260, 512, 384, 700);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, 1024, 768);
    this.texture.needsUpdate = true;
  }
  // redraw about eight times a second, and only while the screen is being rendered
  tick(dt) {
    this.t += dt; this.modeT += dt;
    const frame = Math.floor(this.t * 8);
    if (frame !== this.last) { this.last = frame; this.draw(); }
  }
}

// ---------------------------------------------------------------- the model
// Local frame: +y up, the screen faces -z. Sizes in metres.
function buildModel(screen) {
  const g = new THREE.Group();
  const beige = mat(BEIGE), dark = mat(BEIGE_DARK), slot = mat(SLOT), grey = mat(GREY);

  // system unit (desktop case), monitor sits on top
  box(g, 150, 46, 120, beige, 0, 23, 0);
  box(g, 152, 48, 3, dark, 0, 24, -60.5);                  // front bezel
  // (the viewer looks along +z, so their right hand is -x)
  for (const y of [34, 22]) {                               // two 5.25" drives
    box(g, 52, 10, 1.2, mat(BEIGE_LIGHT), -38, y, -62.4);
    box(g, 38, 1.8, 0.8, slot, -36, y + 0.6, -63);
    box(g, 5, 3, 1.2, grey, -58, y - 2.5, -63);
  }
  box(g, 32, 7, 1.2, mat(BEIGE_LIGHT), -47, 10, -62.4);     // 3.5" drive
  box(g, 22, 1.2, 0.8, slot, -45, 10.8, -63);
  box(g, 3.5, 2, 1, grey, -58, 8.5, -63);
  const badge = labelTexture(512, 128, (c, w, h) => {
    c.fillStyle = '#2b2b2b'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8c35a'; c.font = 'bold 64px "Arial Black", Arial, sans-serif'; c.fillText('MEGA', 24, 88);
    c.fillStyle = '#f2f2f2'; c.font = 'bold 44px Arial, sans-serif'; c.fillText('486 DX2/66', 230, 84);
  });
  plaque(g, 44, 11, 40, 36, -62.2, badge, Math.PI);
  box(g, 14, 8, 2, grey, 52, 9, -62.6);                     // power switch
  box(g, 7, 4, 1.6, mat(BEIGE_LIGHT), 58, 22, -62.6);       // turbo
  box(g, 5, 4, 1.6, grey, 49, 22, -62.6);                   // reset
  const led = (color, x) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), glow(color)); m.position.set(x, 22, -62.4); g.add(m); return m; };
  led(0x33ff66, 40); led(0xffcc33, 35);
  const hdd = led(0xff3322, 30);
  for (let i = 0; i < 6; i++) box(g, 28, 1, 0.8, slot, 30, 2.5 + i * 1.6 + 0.4, -62.5); // vent
  for (const x of [-75.3, 75.3]) for (let i = 0; i < 9; i++) box(g, 0.8, 26, 2.2, mat(0xb9af96), x, 22, -40 + i * 9); // side vents

  // monitor: swivel base, tapered shell, bezel and the glass
  const base = new THREE.Mesh(new THREE.CylinderGeometry(32, 38, 6, 40), dark);
  base.position.set(0, 49, 6); g.add(base);
  box(g, 34, 8, 30, beige, 0, 55, 8);
  const shell = new THREE.Mesh(taperedBox(136, 108, 86, 74, 96, 6), beige);
  shell.position.set(0, 111, 30); g.add(shell);
  box(g, 138, 110, 4, mat(BEIGE_LIGHT), 0, 111, -19);        // front bezel
  const sw = 112, sh = 84, sy = 115;
  for (const [w, h, x, y] of [[sw + 8, 4, 0, sy + sh / 2 + 2], [sw + 8, 4, 0, sy - sh / 2 - 2], [4, sh, -sw / 2 - 2, sy], [4, sh, sw / 2 + 2, sy]]) {
    box(g, w, h, 3, dark, x, y, -21.6);                      // recess lip
  }
  const glass = new THREE.PlaneGeometry(sw, sh, 24, 18);
  const gp = glass.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const u = gp.getX(i) / (sw / 2), v = gp.getY(i) / (sh / 2);
    gp.setZ(i, 2.6 * (1 - u * u) * (1 - v * v)); // a gentle CRT bulge (towards the viewer once turned)
  }
  glass.computeVertexNormals();
  const screenMesh = new THREE.Mesh(glass, new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
  screenMesh.position.set(0, sy, -21.2);
  screenMesh.rotation.y = Math.PI; // plane faces +z; turn it to face -z
  screenMesh.name = 'bbs-screen';
  g.add(screenMesh);
  // knobs, power LED and the maker's name under the screen
  for (const x of [-26, -34, -42]) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 2.4, 14).rotateX(Math.PI / 2), grey);
    k.position.set(x, 64, -21.5); g.add(k);
  }
  const pled = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), glow(0x33ff66)); pled.position.set(-56, 64, -21.4); g.add(pled);
  const maker = labelTexture(512, 96, (c, w, h) => {
    c.fillStyle = '#e6dfcc'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#5b564b'; c.font = 'bold 54px Arial, sans-serif'; c.fillText('MEGAVISION 14"', 20, 70);
  });
  plaque(g, 40, 7.5, 38, 64, -21.3, maker, Math.PI);
  cable(g, [[20, 100, 77], [26, 70, 86], [30, 46, 70], [34, 40, 61]], 2.2);   // monitor -> case

  // keyboard: CognitiveHands' QWERTY layout with its hands, scaled up to giant size
  const tilt = new THREE.Group();
  tilt.position.set(0, 0, -102);
  tilt.rotation.x = -0.05; // feet up at the back
  g.add(tilt);
  const kb = new THREE.Group();
  kb.rotation.y = Math.PI; // laid out from the typist's side, who faces +z
  tilt.add(kb);
  const hands = new TypingHands();
  const b = hands.bounds();
  const kw = (b.maxX - b.minX) * SCALE + 8, kd = (b.maxZ - b.minZ) * SCALE + 10;
  box(kb, kw, 7, kd, beige, 0, 3.5, 0);
  box(kb, kw - 4, 1, kd - 4, dark, 0, 7.1, 0);
  hands.group.position.set(-(b.minX + b.maxX) / 2 * SCALE, 7.2 + KEY_TOP, -(b.minZ + b.maxZ) / 2 * SCALE + 1.5);
  kb.add(hands.group);
  for (const [x, c] of [[kw / 2 - 18, 0x33ff66], [kw / 2 - 12, 0x33ff66], [kw / 2 - 6, 0x335533]]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), glow(c)); l.position.set(x, 7.6, -kd / 2 + 2.5); kb.add(l);
  }
  cable(g, [[0, 4, -76], [-6, 2, -70], [-14, 2, -64], [-20, 3, -61]], 1.4);

  // mouse and its cable
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), beige);
  mouse.scale.set(12, 5.5, 19); mouse.position.set(-104, 3, -98); g.add(mouse);
  box(g, 0.6, 1.2, 9, slot, -104, 8.1, -90.5);
  cable(g, [[-104, 4, -80], [-104, 2, -72], [-92, 2, -64], [-80, 2, -50], [-75.5, 6, -38]], 1.2);

  // a 3.5" floppy lying on the ground
  const disk = new THREE.Group();
  disk.position.set(106, 0.6, -96); disk.rotation.y = 2.6; g.add(disk);
  box(disk, 18, 1, 18.8, mat(0x1d2a52), 0, 0, 0);
  box(disk, 8, 1.2, 6.2, mat(0xc8ccd2, { metalness: 0.8, roughness: 0.35 }), 1, 0.05, -6.2);
  const diskLabel = labelTexture(256, 160, (c, w, h) => {
    c.fillStyle = '#f4f1e8'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9ab'; for (let y = 50; y < h; y += 24) { c.beginPath(); c.moveTo(10, y); c.lineTo(w - 10, y); c.stroke(); }
    c.fillStyle = '#d0287a'; c.font = 'bold 40px "Comic Sans MS", "Marker Felt", cursive'; c.fillText('megaZINE', 18, 44);
    c.fillStyle = '#123'; c.font = '26px "Comic Sans MS", "Marker Felt", cursive'; c.fillText('BBS disk 1 of 1', 18, 100);
  });
  const lab = plaque(disk, 13, 8, 0, 0.56, 4.2, diskLabel);
  lab.rotation.x = -Math.PI / 2;

  for (const o of [g]) o.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  return { group: g, screenMesh, hdd, hands, screenSize: { w: sw, h: sh }, screenLocal: new THREE.Vector3(0, sy, -21.2 - 2.6) };
}

// Place the computer on its levelled site. `f` is the site feature (flattened pad).
export function buildComputer(rec, planet, f) {
  const site = new THREE.Group();
  const center = f ? f.center : latLonToDir(rec.lat, rec.lon);
  const top = f ? f.target : planet.elevation(center);
  site.position.copy(center).multiplyScalar(R + top);
  const { east, north, up } = tangentFrame(center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));

  const screen = new Screen();
  const model = buildModel(screen);
  const turn = new THREE.Group();
  turn.rotation.y = -(rec.heading ?? 0) * DEG; // screen faces the heading
  model.group.position.z = 25;                  // centre the footprint on the pad
  turn.add(model.group);
  site.add(turn);
  site.updateMatrixWorld(true);

  let hddT = 0;
  model.screenMesh.onBeforeRender = () => { screen.visible = true; };
  site.userData.update = (dt) => {
    model.hands.update(dt);                // only simulates while there is typing to do
    if (screen.visible) screen.tick(dt);   // animate only while the screen was drawn last frame
    screen.visible = false;
    hddT -= dt;
    if (hddT < 0) { hddT = 0.05 + Math.random() * 0.4; model.hdd.visible = !model.hdd.visible || Math.random() < 0.3; }
  };
  site.userData.labelPos = new THREE.Vector3(0, 190, 0);
  site.userData.labelRange = 7000;

  const normal = new THREE.Vector3(0, 0, -1).transformDirection(model.group.matrixWorld);
  const centerW = model.screenLocal.clone().applyMatrix4(model.group.matrixWorld);
  site.userData.computer = {
    url: rec.url || BBS_URL,
    screen, screenMesh: model.screenMesh,
    center: centerW, normal, size: model.screenSize,
    // world-space corners of the glass, for lining up the live BBS with it
    corners() {
      const { w, h } = model.screenSize;
      return [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]]
        .map(([x, y]) => new THREE.Vector3(x, y + model.screenLocal.y, model.screenLocal.z).applyMatrix4(model.group.matrixWorld));
    },
    // a camera spot `dist` metres out from the screen, level with it, looking at it
    viewPoint(dist) { return centerW.clone().addScaledVector(normal, dist); },
    hands: model.hands,
    // the typist's view: over the keyboard to the screen, backed off on narrow screens
    typingView(aspect) {
      const m = model.group.matrixWorld;
      const target = new THREE.Vector3(0, 62, -66).applyMatrix4(m);
      const eye = new THREE.Vector3(0, 100, -235).applyMatrix4(m);
      eye.sub(target).multiplyScalar(Math.max(1, 1.05 / aspect)).add(target);
      return { pos: eye, look: target.clone().sub(eye).normalize() };
    },
  };
  return site;
}
