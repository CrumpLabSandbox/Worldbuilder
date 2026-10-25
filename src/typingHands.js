// Giant typing hands for the MEGAzine BBS computer, using the kinematic hands,
// keyboard and motor layer from CognitiveHands (src/hands/). Players' key
// presses go straight to the motor layer (no cognitive model). Each character
// appears, in the order it was typed, when the finger's keystroke for it
// lands. The hands move naturally (fast sequences overlap, and a reach can
// clip a neighbouring key), but the player's text always comes out as typed.
//
// Everything is built in CognitiveHands' units (metres, life size; the typist
// sits on the +Z side, key tops at y = 0) inside a group scaled up by SCALE.
import * as THREE from 'three';
import { Hand } from './hands/body/hand.js';
import { Arm } from './hands/body/arm.js';
import { REST_POSE, FINGERS, deg } from './hands/body/anatomy.js';
import { Keyboard } from './hands/instrument/keyboard.js';
import { PITCH, KEY_CAP, KEY_HEIGHT, charToKey } from './hands/instrument/layout.js';
import { MotorController } from './hands/motor/controller.js';
import { HOME_KEYS } from './hands/motor/fingering.js';
import { makeRng } from './hands/util/random.js';

export const SCALE = 360;        // life size -> giant (a 19 mm key pitch becomes 6.9 m)
const DT = 1 / 400;              // CognitiveHands' simulation step
const MAX_STEPS = 60;            // per frame, so a slow frame can't stall the game
const IDLE_AFTER = 1.5;          // seconds without keystrokes before the simulation rests
const FINGER_COLORS = { thumb: 0xe4572e, index: 0xf3a712, middle: 0xa8c256, ring: 0x29a19c, little: 0x3d7dca };
const Y_UP = new THREE.Vector3(0, 1, 0);

const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
const unitSphere = new THREE.SphereGeometry(1, 16, 12);

export class TypingHands {
  constructor() {
    this.rng = makeRng(20261025);
    this.keyboard = new Keyboard();
    this.hands = { left: new Hand('left'), right: new Hand('right') };
    this.arms = { left: new Arm('left'), right: new Arm('right') };
    this.placeHands();
    // a bit faster and steadier than the research default, for a smooth show
    this.controller = new MotorController({ hands: this.hands, keyboard: this.keyboard, rng: this.rng, params: { speed: 1.3, noise: 0.35 } });
    this.queue = [];       // requested { key, char, done }, in typing order
    this.onType = null;    // (char) => void, when a keystroke lands
    this.acc = 0;
    this.quiet = IDLE_AFTER; // run a little at start so the fingers settle onto the home row

    this.group = new THREE.Group();
    this.group.scale.setScalar(SCALE);
    this.meshes = new Map();
    this.keyMeshes = new Map();
    this.mats = {
      bone: new THREE.MeshStandardMaterial({ color: 0xf0e8d6, roughness: 0.55 }),
      joint: new THREE.MeshStandardMaterial({ color: 0xd9cfb9, roughness: 0.5 }),
      carpal: new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.6 }),
      arm: new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.6, transparent: true, opacity: 0.45, depthWrite: false }),
      finger: Object.fromEntries(Object.entries(FINGER_COLORS).map(([f, c]) => [f, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 })])),
      keySide: new THREE.MeshStandardMaterial({ color: 0xd3d0c8, roughness: 0.7 }),
    };
    this.buildKeys();
    this.draw();
  }

  // Each hand hovers over the home row, pitched and rolled like a seated
  // typist's (as in CognitiveHands' simulator).
  placeHands() {
    const pitch = deg(15), roll = deg(17.5);
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    for (const side of ['left', 'right']) {
      const hand = this.hands[side];
      hand.baseQuaternion
        .setFromAxisAngle(X, -pitch)
        .multiply(new THREE.Quaternion().setFromAxisAngle(Z, -hand.s * roll))
        .multiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.PI));
      hand.basePosition.set(0, 0, 0);
      hand.offset.set(0, 0, 0);
      const pose = { ...REST_POSE, 'middle.mcpFlex': deg(28), 'middle.pipFlex': deg(55), 'middle.dipFlex': deg(33) };
      const tip = hand.fingerTip('middle', pose, new THREE.Vector3());
      const home = this.keyboard.keyCenter(HOME_KEYS[side].middle).clone();
      home.y -= 0.003;
      hand.basePosition.copy(home.sub(tip));
      hand.setCommanded({ ...REST_POSE });
    }
  }

  // Extent of the key layout in life-size metres, for fitting the keyboard case.
  bounds() {
    const ks = this.keyboard.keys;
    return {
      minX: Math.min(...ks.map((k) => k.x - k.width / 2)), maxX: Math.max(...ks.map((k) => k.x + k.width / 2)),
      minZ: Math.min(...ks.map((k) => k.z)) - PITCH / 2, maxZ: Math.max(...ks.map((k) => k.z)) + PITCH / 2,
    };
  }

  buildKeys() {
    for (const key of this.keyboard.keys) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#ebe6d6'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#4a463d';
      g.font = `${key.label.length > 2 ? 'bold 34px' : 'bold 64px'} Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(key.label.toUpperCase(), 64, 68);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(key.width - (PITCH - KEY_CAP), KEY_HEIGHT, KEY_CAP), [this.mats.keySide, this.mats.keySide, top, this.mats.keySide, this.mats.keySide, this.mats.keySide]);
      mesh.position.set(key.x, -KEY_HEIGHT / 2, key.z);
      this.group.add(mesh);
      this.keyMeshes.set(key.id, { mesh, top });
    }
  }

  // Type one character (as given by KeyboardEvent.key, or '\n'). Returns false
  // when no finger can type it, so the caller can handle it directly.
  press(char) {
    const key = charToKey(char);
    if (!key || !this.controller.request(key, this.controller.time)) return false;
    this.queue.push({ key, char, done: false });
    this.quiet = 0;
    return true;
  }

  get busy() { return this.controller.pending > 0 || this.quiet < IDLE_AFTER; }

  update(dt) {
    if (!this.busy) return;
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= DT && steps++ < MAX_STEPS) {
      this.acc -= DT;
      this.step();
    }
    if (steps >= MAX_STEPS) this.acc = 0;
    this.quiet += dt;
    if (this.controller.pending > 0) this.quiet = 0;
    this.draw();
  }

  step() {
    const completed = this.controller.update(DT, {});
    const tips = [];
    for (const side of ['left', 'right']) {
      const t = this.hands[side].tips();
      for (const f of FINGERS) tips.push({ hand: side, finger: f, pos: t[f] });
    }
    for (const ev of this.keyboard.update(tips, this.controller.time)) {
      if (ev.type === 'down') this.controller.notifyKeyDown(ev); // lights the key that was actually hit
    }
    // a finished keystroke completes the earliest matching character; then
    // everything finished at the front of the queue appears, in order
    for (const c of completed) {
      const q = this.queue.find((x) => !x.done && x.key === c.intended);
      if (q) q.done = true;
    }
    while (this.queue.length && this.queue[0].done) this.emit(this.queue.shift().char);
  }

  emit(char) { if (this.onType) this.onType(char); }

  // ---------------------------------------------------------------- drawing
  mesh(id, geometry, material) {
    let m = this.meshes.get(id);
    if (!m) { m = new THREE.Mesh(geometry, material); this.group.add(m); this.meshes.set(id, m); }
    return m;
  }
  bone(id, from, to, radius, material) {
    const m = this.mesh(id, unitCylinder, material);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(Y_UP, dir.normalize());
    m.scale.set(radius, len, radius);
  }
  sphere(id, pos, radius, material) {
    const m = this.mesh(id, unitSphere, material);
    m.position.copy(pos);
    m.scale.setScalar(radius);
  }

  draw() {
    for (const side of ['left', 'right']) {
      const fk = this.hands[side].forwardKinematics();
      for (const seg of fk.segments) {
        const distal = seg.name.endsWith('distal');
        const mat = distal ? this.mats.finger[seg.finger] : this.mats.bone;
        this.bone(`${side}.${seg.name}`, seg.from, seg.to, seg.radius * 0.9, mat);
        this.sphere(`${side}.${seg.name}.head`, seg.from, seg.radius * 1.05, this.mats.joint);
        if (distal) {
          this.sphere(`${side}.${seg.name}.tip`, seg.to, seg.radius * 0.95, mat);
          this.sphere(`${side}.${seg.name}.pad`, fk.pads[seg.finger], seg.radius * 0.8, mat);
        }
      }
      for (const c of fk.carpals) this.sphere(`${side}.carpal.${c.name}`, c.pos, c.radius, this.mats.carpal);
      // ghostly forearms reaching back towards the (unseen) typist
      const arm = this.arms[side].solve(fk.wrist);
      const r = side === 'right' ? -1 : 1;
      const radialWrist = fk.wrist.clone().add(new THREE.Vector3(r * 0.012, 0.002, 0.02));
      const ulnarWrist = fk.wrist.clone().add(new THREE.Vector3(-r * 0.012, 0.002, 0.02));
      const radialElbow = arm.elbow.clone().add(new THREE.Vector3(r * 0.02, -0.005, 0));
      this.bone(`${side}.ulna`, arm.elbow, ulnarWrist, 0.0085, this.mats.arm);
      this.bone(`${side}.radius`, radialElbow, radialWrist, 0.008, this.mats.arm);
      this.sphere(`${side}.elbow`, arm.elbow, 0.02, this.mats.arm);
    }
    for (const key of this.keyboard.keys) {
      const e = this.keyMeshes.get(key.id);
      e.mesh.position.y = -KEY_HEIGHT / 2 - key.depth;
      e.top.emissive.setHex(key.pressed ? 0xff7a30 : 0x000000);
    }
  }
}
