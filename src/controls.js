// Globe-aware fly controls: the camera keeps the local "up" (radial) direction as
// its up vector, so flying feels natural anywhere on the sphere.
//
// Movement is level: forward follows the heading along the surface whatever the
// pitch, and climbing is its own axis. Inputs set target velocities that the
// camera eases towards, so starting, stopping and turning feel smooth.
import * as THREE from 'three';
import { dirToLatLon, latLonToDir, tangentFrame, R } from './planet.js';

const DEG = Math.PI / 180;
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
// keys whose browser default (scrolling, pressing a focused button) gets in the way of flying
const FLIGHT_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class FlyControls {
  constructor(camera, domElement, planet) {
    this.camera = camera;
    this.dom = domElement;
    this.planet = planet;
    this.position = new THREE.Vector3(0, 0, R + 2000);
    this.heading = 0;   // degrees, 0 = north, 90 = east
    this.pitch = -30;   // degrees, negative looks down
    this.speedMul = 1;
    this.boost = false;
    this.velocity = 0;
    this.keys = new Set();
    this.enabled = true;
    this.minAlt = 1.5;
    this.maxAlt = R * 4;
    this.mouseSensitivity = 0.16;  // degrees per pixel
    this.pointerLocked = false;
    // analog inputs from the touch UI, each in [-1, 1]
    this.stick = { x: 0, y: 0 };   // x = strafe, y = forward
    this.lift = 0;                 // climb (+) / descend (-)
    this.onStick = null;           // (state | null) => void, for drawing the floating thumbstick
    this.onInput = null;           // called on any manual input (e.g. to cancel a camera follow)
    this.stickZone = (x, y) => x < window.innerWidth * 0.45 && y > window.innerHeight * 0.3;
    this._v = { f: 0, r: 0, u: 0 }; // smoothed movement, fractions of full speed
    this._turn = 0;                 // smoothed keyboard turn rate, degrees/second
    this._zoom = 0;                 // pending altitude change (log scale) from wheel / pinch
    this._flight = null;
    this._pointers = new Map();     // canvas pointers: id -> { x, y, role }
    this._pinch = 0;
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._bind();
  }

  _bind() {
    const dom = this.dom;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping(e.target) || e.metaKey || e.ctrlKey) return;
      if (FLIGHT_KEYS.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyL') this.toggleMouseLook();
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.changeSpeed(1.5);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.changeSpeed(1 / 1.5);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      const touch = e.pointerType === 'touch';
      const stickTaken = [...this._pointers.values()].some((p) => p.role === 'stick');
      const role = touch && !stickTaken && this.stickZone(e.clientX, e.clientY) ? 'stick' : 'look';
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, role, touch, moved: 0 });
      try { dom.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.cancelFlight();
      if (role === 'stick') this._setStick(this._pointers.get(e.pointerId));
      const looks = this._lookPointers();
      if (looks.length === 2) { this._pinch = this._spread(looks); for (const l of looks) l.moved = 999; }
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.pointerLocked) { this._look(e.movementX, e.movementY, this.mouseSensitivity); return; }
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (p.role === 'stick') { this._setStick(p); return; }
      const looks = this._lookPointers();
      if (looks.length >= 2) {
        // pinch: spread fingers to zoom in (descend), squeeze to zoom out
        const d = this._spread(looks);
        if (this._pinch > 0 && d > 0) this._zoom -= Math.log(d / this._pinch) * 1.6;
        this._pinch = d;
        return;
      }
      // touch: a swipe across the screen turns well over one field of view
      const sens = p.touch ? (this.camera.fov / window.innerHeight) * 2.4 : this.mouseSensitivity;
      this._look(dx, dy, sens);
    });
    const end = (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      this._lastClick = p.role === 'look' && p.moved < 6;
      this._pointers.delete(e.pointerId);
      if (p.role === 'stick') { this.stick.x = 0; this.stick.y = 0; if (this.onStick) this.onStick(null); }
      if (this._lookPointers().length < 2) this._pinch = 0;
      try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      // lines/pages -> pixels; a trackpad pinch arrives as ctrl+wheel with small deltas
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      this._zoom += THREE.MathUtils.clamp(px, -200, 200) * (e.ctrlKey ? 0.01 : 0.0015);
      this.cancelFlight();
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === dom;
      if (this.onMouseLook) this.onMouseLook(this.pointerLocked);
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _lookPointers() { return [...this._pointers.values()].filter((p) => p.role === 'look'); }
  _spread([a, b]) { return Math.hypot(a.x - b.x, a.y - b.y); }

  _setStick(p) {
    const radius = 50;
    let dx = p.x - p.ox, dy = p.y - p.oy;
    const len = Math.hypot(dx, dy);
    // the base follows the thumb if it strays too far, so the stick never "runs out"
    if (len > radius) {
      p.ox += dx * (1 - radius / len); p.oy += dy * (1 - radius / len);
      dx = p.x - p.ox; dy = p.y - p.oy;
    }
    this.stick.x = dx / radius;
    this.stick.y = -dy / radius;
    if (this.onStick) this.onStick({ x: p.ox, y: p.oy, dx, dy });
    if (this.onInput && len > 6) this.onInput();
  }

  _look(dx, dy, sens) {
    this.heading = (this.heading + dx * sens + 360) % 360;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -89, 89);
    this.cancelFlight();
  }

  toggleMouseLook() {
    if (this.pointerLocked) document.exitPointerLock();
    else this.dom.requestPointerLock();
  }

  changeSpeed(factor) {
    this.speedMul = THREE.MathUtils.clamp(this.speedMul * factor, 0.1, 10);
    if (Math.abs(this.speedMul - 1) < 0.05) this.speedMul = 1;
    if (this.onSpeed) this.onSpeed(this.speedMul);
  }

  // True if the pointer gesture ending with event e was a click/tap on the scene rather
  // than a drag, a pinch, or a thumbstick touch.
  wasClick(e) {
    const p = e && this._pointers.get(e.pointerId);
    return p ? p.role === 'look' && p.moved < 6 : !!this._lastClick;
  }

  get altitude() {
    const floor = this.planet.tunnelFloor(this.position);
    if (floor != null) return this.position.length() - (R + floor); // height above a tunnel's road
    const dir = this.position.clone().normalize();
    return this.position.length() - this.planet.groundRadius(dir);
  }

  get latLon() { return dirToLatLon(this.position); }

  teleport(lat, lon, alt = 200, heading = this.heading, pitch = this.pitch) {
    this.cancelFlight();
    const dir = latLonToDir(lat, lon);
    const r = this.planet.groundRadius(dir) + Math.max(this.minAlt, alt);
    this.position.copy(dir).multiplyScalar(r);
    this.heading = heading; this.pitch = pitch;
    this._v.f = this._v.r = this._v.u = 0; this._zoom = 0;
    this.updateCamera();
    if (this.onTeleport) this.onTeleport();
  }

  // Glide to look at a spot on the ground, arriving a little back from it and above it.
  flyTo(lat, lon) {
    const target = latLonToDir(lat, lon);
    const startDir = this.position.clone().normalize();
    const dist = startDir.angleTo(target) * R;
    const alt0 = Math.max(this.minAlt, this.altitude);
    const alt1 = THREE.MathUtils.clamp(Math.min(alt0, dist) * 0.45, 25, 1500);
    // stand off from the target along the line of approach so it ends up in view
    const { east, north } = tangentFrame(target);
    const toward = startDir.clone().sub(target);
    let back = new THREE.Vector3(toward.dot(east), toward.dot(north), 0);
    if (back.lengthSq() < 1e-12) back.set(-Math.sin(this.heading * DEG), -Math.cos(this.heading * DEG), 0);
    back.normalize();
    const standOff = (alt1 * 1.1) / R;
    const endDir = target.clone()
      .addScaledVector(east, back.x * standOff).addScaledVector(north, back.y * standOff).normalize();
    const heading1 = (Math.atan2(-back.x, -back.y) / DEG + 360) % 360;
    this._flight = {
      t: 0, dur: THREE.MathUtils.clamp(0.9 + Math.log10(1 + dist / 50) * 0.8, 1, 3.5),
      startDir, endDir, alt0, alt1, hump: Math.min(dist * 0.35, R * 0.8),
      heading0: this.heading, heading1, pitch0: this.pitch, pitch1: -42,
      quat: new THREE.Quaternion().setFromUnitVectors(startDir, endDir),
    };
    this._v.f = this._v.r = this._v.u = 0; this._zoom = 0;
  }

  cancelFlight() { this._flight = null; }
  get flying() { return !!this._flight; }

  _stepFlight(dt) {
    const fl = this._flight;
    fl.t = Math.min(1, fl.t + dt / fl.dur);
    const u = fl.t < 0.5 ? 4 * fl.t ** 3 : 1 - (-2 * fl.t + 2) ** 3 / 2; // ease in-out
    const dir = fl.startDir.clone().applyQuaternion(new THREE.Quaternion().slerp(fl.quat, u));
    const alt = Math.exp(THREE.MathUtils.lerp(Math.log(fl.alt0), Math.log(fl.alt1), u)) + Math.sin(Math.PI * u) * fl.hump;
    this.position.copy(dir).multiplyScalar(this.planet.groundRadius(dir) + alt);
    const turn = Math.min(1, u * 2.5);
    const dh = ((fl.heading1 - fl.heading0 + 540) % 360) - 180;
    this.heading = (fl.heading0 + dh * turn + 360) % 360;
    this.pitch = THREE.MathUtils.lerp(fl.pitch0, fl.pitch1, u);
    if (fl.t >= 1) this._flight = null;
  }

  // Current full motion speed in m/s given altitude.
  baseSpeed() {
    const alt = Math.max(0, this.altitude);
    const min = this.planet.tunnelFloor(this.position) != null ? 18 : 6; // cruise through tunnels
    return THREE.MathUtils.clamp(alt * 0.9 + 4, min, R * 2) * this.speedMul;
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    const has = (...codes) => codes.some((c) => k.has(c));
    // keyboard input, in fractions of full speed
    let f = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    let r = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
    let u = (has('Space', 'KeyE', 'KeyR', 'PageUp') ? 1 : 0) - (has('KeyC', 'KeyQ', 'KeyF', 'PageDown') ? 1 : 0);
    const turnKeys = (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0);
    if (f && r) { f *= Math.SQRT1_2; r *= Math.SQRT1_2; }
    // thumbstick: a gentle curve gives fine control near the centre
    const sl = Math.min(1, Math.hypot(this.stick.x, this.stick.y));
    if (sl > 0.08) {
      const g = Math.pow((sl - 0.08) / 0.92, 1.5) / sl;
      f += this.stick.y * g; r += this.stick.x * g;
    }
    if (Math.abs(this.lift) > 0.05) u += Math.sign(this.lift) * Math.pow(Math.abs(this.lift), 1.5);
    const anyInput = f || r || u || turnKeys;
    if (anyInput) {
      this.cancelFlight();
      if (this.onInput) this.onInput();
    }

    if (this._flight) { this._stepFlight(dt); this.velocity = 0; this.updateCamera(); return; }

    this._turn += (turnKeys * 85 - this._turn) * ease(8, dt);
    this.heading = (this.heading + this._turn * dt + 360) % 360;

    const a = ease(anyInput ? 5 : 6, dt);
    this._v.f += (THREE.MathUtils.clamp(f, -1, 1) - this._v.f) * a;
    this._v.r += (THREE.MathUtils.clamp(r, -1, 1) - this._v.r) * a;
    this._v.u += (THREE.MathUtils.clamp(u, -1, 1) - this._v.u) * a;
    for (const key of ['f', 'r', 'u']) if (Math.abs(this._v[key]) < 1e-4) this._v[key] = 0;

    const { east, north, up } = tangentFrame(this.position, this._east, this._north);
    const h = this.heading * DEG;
    const flat = this._fwd.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    const right = this._right.copy(east).multiplyScalar(Math.cos(h)).addScaledVector(north, -Math.sin(h));

    let speed = this.baseSpeed();
    if (has('ShiftLeft', 'ShiftRight') || this.boost) speed *= 4;
    const move = new THREE.Vector3()
      .addScaledVector(flat, this._v.f).addScaledVector(right, this._v.r).addScaledVector(up, this._v.u * 0.6);
    this.velocity = speed * move.length();
    this.position.addScaledVector(move, speed * dt);

    // wheel / pinch: ease altitude up or down by a fraction of itself
    if (this._zoom !== 0) {
      const step = Math.abs(this._zoom) < 1e-3 ? this._zoom : this._zoom * ease(10, dt);
      this._zoom -= step;
      const alt = Math.max(4, this.altitude);
      this.position.addScaledVector(this.position.clone().normalize(), alt * (Math.exp(step) - 1));
    }

    // inside a tunnel: stay within its walls; otherwise keep above ground / below ceiling
    if (!this.planet.constrainTunnels(this.position)) {
      const dir = this.position.clone().normalize();
      const ground = this.planet.groundRadius(dir);
      const len = this.position.length();
      if (len < ground + this.minAlt) { this.position.copy(dir).multiplyScalar(ground + this.minAlt); if (this._zoom < 0) this._zoom = 0; }
      if (len > R + this.maxAlt) { this.position.copy(dir).multiplyScalar(R + this.maxAlt); if (this._zoom > 0) this._zoom = 0; }
    }
    this.updateCamera();
  }

  updateCamera() {
    const { east, north, up } = tangentFrame(this.position, this._east, this._north);
    const h = this.heading * DEG, p = this.pitch * DEG;
    const fwd = this._fwd.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h)).multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p));
    this.camera.position.copy(this.position);
    this.camera.up.copy(up);
    this.camera.lookAt(this.position.clone().add(fwd));
  }
}
