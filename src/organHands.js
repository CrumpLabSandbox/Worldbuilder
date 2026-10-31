// The cognitive hands at the stage organ. ThingSynth's playable computer keys are
// the home row (white keys) and the top row (black keys), so the organ's 17 keys
// sit exactly where CognitiveHands' keyboard has those letters and the motor
// layer's typing fingering plays them. A key stays down while the player holds it.
import * as THREE from 'three';
import { TypingHands } from './typingHands.js';
import { PITCH, KEY_HEIGHT } from './hands/instrument/layout.js';

const WHITE = 'asdfghjkl;', BLACK = 'wetyuop';
// semitones above the keyboard's base note, as in ThingSynth's own computer keyboard
export const KEY_NOTES = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
export const ORGAN_KEYS = {
  KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', KeyG: 'g', KeyH: 'h', KeyJ: 'j', KeyK: 'k', KeyL: 'l', Semicolon: ';',
  KeyW: 'w', KeyE: 'e', KeyT: 't', KeyY: 'y', KeyU: 'u', KeyO: 'o', KeyP: 'p',
};

function keyFace(letter, w, h, y, bg, fg) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `bold ${Math.round(w * 0.56)}px Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter.toUpperCase(), w / 2, y);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class OrganHands extends TypingHands {
  constructor(scale) {
    super({ scale, speed: 1.7 });
    this.held = new Set();
    // the arms come straight in from under the camera, as if they were the player's own
    for (const [side, arm] of Object.entries(this.arms)) {
      const out = side === 'right' ? 0.13 : -0.13;
      arm.solve = (wrist) => ({ elbow: wrist.clone().add(new THREE.Vector3(out, 0.06, 0.9)) });
    }
    this.draw();
  }

  buildKeys() {
    const side = new THREE.MeshStandardMaterial({ color: 0xd8d0ba, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.4 });
    for (const letter of WHITE) {
      const key = this.keyboard.key(letter);
      const top = new THREE.MeshStandardMaterial({ map: keyFace(letter, 128, 540, 400, '#f3ecda', '#4a463d'), roughness: 0.4 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(PITCH * 0.95, KEY_HEIGHT, PITCH * 4.1), [side, side, top, side, side, side]);
      mesh.position.set(key.x, -KEY_HEIGHT / 2, PITCH * 0.35);
      this.group.add(mesh);
      this.keyMeshes.set(letter, { mesh, top, base: -KEY_HEIGHT / 2 });
    }
    for (const letter of BLACK) {
      const key = this.keyboard.key(letter);
      const top = new THREE.MeshStandardMaterial({ map: keyFace(letter, 128, 200, 100, '#15130f', '#f3ecda'), roughness: 0.35 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(PITCH * 0.7, KEY_HEIGHT, PITCH * 1.25), [dark, dark, top, dark, dark, dark]);
      const base = -KEY_HEIGHT / 2 + 0.0016; // proud of the white keys
      mesh.position.set(key.x, base, -PITCH);
      this.group.add(mesh);
      this.keyMeshes.set(letter, { mesh, top, base });
    }
  }

  get busy() { return this.held.size > 0 || super.busy; }

  hold(key) { this.held.add(key); this.press(key); }
  release(key) { this.held.delete(key); }

  step() {
    // keep a held key's finger in its hold phase until the player lets go
    for (const side of Object.values(this.controller.state)) {
      for (const f of Object.values(side.fingers)) {
        if (f.plan?.phase === 'hold' && this.held.has(f.plan.key)) f.plan.t = 0;
      }
    }
    super.step();
  }
}
