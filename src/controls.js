// Globe-aware fly controls: the camera keeps the local "up" (radial) direction as
// its up vector, so flying feels natural anywhere on the sphere.
import * as THREE from 'three';
import { dirToLatLon, latLonToDir, tangentFrame, R } from './planet.js';

const DEG = Math.PI / 180;

export class FlyControls {
  constructor(camera, domElement, planet) {
    this.camera = camera;
    this.dom = domElement;
    this.planet = planet;
    this.position = new THREE.Vector3(0, 0, R + 2000);
    this.heading = 0;   // degrees, 0 = north, 90 = east
    this.pitch = -30;   // degrees, negative looks down
    this.speedMul = 1;
    this.velocity = 0;
    this.keys = new Set();
    this.dragging = false;
    this.pointerLocked = false;
    this.lastPointer = { x: 0, y: 0 };
    this.dragPointerId = null;
    this.pointers = new Map(); // active pointers on the canvas (for pinch)
    this.pinchDist = 0;
    this.touchMove = { x: 0, y: 0 }; // analog stick: x = strafe, y = forward, each in [-1, 1]
    this.enabled = true;
    this.minAlt = 1.5;
    this.maxAlt = R * 4;
    this.lookSensitivity = 0.18;
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._bind();
  }

  _bind() {
    const dom = this.dom;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      if (e.code === 'KeyL') { if (this.pointerLocked) document.exitPointerLock(); else dom.requestPointerLock(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dom.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) {
        // start pinch: cancel look-drag
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.dragging = false; this.moved = 999;
        return;
      }
      if (this.pointers.size > 2) return;
      this.dragging = true; this.moved = 0; this.dragPointerId = e.pointerId;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.pointerLocked) { this._look(e.movementX, e.movementY); return; }
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0) this._pinch(d - this.pinchDist);
        this.pinchDist = d;
        return;
      }
      if (!this.dragging || e.pointerId !== this.dragPointerId) return;
      const dx = e.clientX - this.lastPointer.x, dy = e.clientY - this.lastPointer.y;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this._look(dx, dy);
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (e.pointerId === this.dragPointerId) { this.dragging = false; this.dragPointerId = null; }
      try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.speedMul = THREE.MathUtils.clamp(this.speedMul * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.05, 20);
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === dom; });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _look(dx, dy) {
    this.heading = (this.heading + dx * this.lookSensitivity + 360) % 360;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * this.lookSensitivity, -89, 89);
  }

  // Pinch (two fingers): spread to climb, squeeze to descend, proportional to altitude.
  _pinch(deltaPx) {
    const alt = Math.max(2, this.altitude);
    const dir = this.position.clone().normalize();
    const r = this.position.length() + deltaPx * alt * 0.01;
    this.position.copy(dir).multiplyScalar(THREE.MathUtils.clamp(r, this.planet.groundRadius(dir) + this.minAlt, R + this.maxAlt));
    this.updateCamera();
  }

  // True if the last pointer gesture was a click rather than a drag.
  wasClick() { return this.moved < 4; }

  get altitude() {
    const dir = this.position.clone().normalize();
    return this.position.length() - this.planet.groundRadius(dir);
  }

  get latLon() { return dirToLatLon(this.position); }

  teleport(lat, lon, alt = 200, heading = this.heading, pitch = this.pitch) {
    const dir = latLonToDir(lat, lon);
    const r = this.planet.groundRadius(dir) + Math.max(this.minAlt, alt);
    this.position.copy(dir).multiplyScalar(r);
    this.heading = heading; this.pitch = pitch;
    this.updateCamera();
    if (this.onTeleport) this.onTeleport();
  }

  // Current motion speed in units/second given altitude.
  baseSpeed() {
    const alt = Math.max(0, this.altitude);
    return THREE.MathUtils.clamp(alt * 0.9 + 4, 6, R * 2) * this.speedMul;
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    const turn = 70 * dt;
    if (k.has('ArrowLeft') || k.has('KeyQ')) this.heading = (this.heading - turn + 360) % 360;
    if (k.has('ArrowRight') || k.has('KeyE')) this.heading = (this.heading + turn) % 360;
    if (k.has('ArrowUp')) this.pitch = Math.min(89, this.pitch + turn);
    if (k.has('ArrowDown')) this.pitch = Math.max(-89, this.pitch - turn);

    const { east, north, up } = tangentFrame(this.position, this._east, this._north);
    const h = this.heading * DEG, p = this.pitch * DEG;
    const flat = this._fwd.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    const fwd = flat.clone().multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p));
    const right = this._right.copy(east).multiplyScalar(Math.cos(h)).addScaledVector(north, -Math.sin(h));

    let speed = this.baseSpeed();
    if (k.has('ShiftLeft') || k.has('ShiftRight') || this.boost) speed *= 4;
    const move = new THREE.Vector3();
    if (k.has('KeyW')) move.add(fwd);
    if (k.has('KeyS')) move.sub(fwd);
    if (k.has('KeyD')) move.add(right);
    if (k.has('KeyA')) move.sub(right);
    if (k.has('KeyR') || k.has('Space')) move.add(up);
    if (k.has('KeyF') || k.has('KeyC')) move.sub(up);
    this.velocity = 0;
    if (move.lengthSq() > 0) move.normalize();
    // analog stick (touch): scaled by stick deflection
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) {
      move.addScaledVector(fwd, this.touchMove.y).addScaledVector(right, this.touchMove.x);
      if (move.length() > 1) move.normalize();
    }
    if (move.lengthSq() > 0) {
      const mag = move.length();
      move.multiplyScalar(speed * dt);
      this.position.add(move);
      this.velocity = speed * mag;
    }
    // keep above ground / below ceiling
    const dir = this.position.clone().normalize();
    const ground = this.planet.groundRadius(dir);
    const r = this.position.length();
    if (r < ground + this.minAlt) this.position.copy(dir).multiplyScalar(ground + this.minAlt);
    if (r > R + this.maxAlt) this.position.copy(dir).multiplyScalar(R + this.maxAlt);
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
