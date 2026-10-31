// Leaving for Orbitakt. The camera drops down beside the traveller on the ring; they
// evaporate from the hat down, and the sparks rise. The camera follows them up
// through the sky and turns to look back at the whole planet, where the sparks settle
// as new stars among satellites circling the earth in their four shells, pulsing in
// time to the pattern the drum machine has been playing all along. Then, a flash.
import * as THREE from 'three';
import { R } from './planet.js';
import { mulberry32 } from './noise.js';
import { TRACKS, STEP } from './orbitakt.js';

const GLIDE = 2.4, DISSOLVE = 4, ASCEND = 7, ORBIT = 6.5, FLASH = 1.1;
const TOTAL = GLIDE + DISSOLVE + ASCEND + ORBIT;
const SPARKS = 3200, HEIGHT = 3.35, FAR_ALT = 32000;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
// [shell altitude, rings, satellites per ring, inclination, pixels, turns per second]
const SHELLS = [
  { track: 0, alt: 8000, rings: 3, per: 8, tilt: 55, size: 11, spin: 0.03 },
  { track: 1, alt: 2300, rings: 6, per: 12, tilt: 86, size: 7, spin: 0.09 },
  { track: 2, alt: 1300, rings: 8, per: 46, tilt: 53, size: 3.2, spin: 0.12 },
  { track: 3, alt: 14000, rings: 1, per: 40, tilt: 0, size: 8, spin: 0.012 },
];

const dot = (() => {
  let tex = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 15, 0, 7); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 3; x.beginPath(); x.arc(32, 32, 26, 0, 7); x.stroke();
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

// The satellites, on rings that really go round, each pulsing just after the last.
function buildConstellations() {
  const group = new THREE.Group(), rng = mulberry32(1957), rings = [];
  for (const s of SHELLS) {
    for (let i = 0; i < s.rings; i++) {
      const r = R + s.alt + i * 60, pos = new Float32Array(s.per * 3), ring = new THREE.Group();
      for (let k = 0; k < s.per; k++) {
        const a = (k + rng() * 0.3) / s.per * Math.PI * 2;
        pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], k * 3);
      }
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const bright = new THREE.Color(TRACKS[s.track].color).lerp(new THREE.Color(0xffffff), 0.3);
      const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: bright, map: dot(), size: s.size, sizeAttenuation: false, transparent: true, alphaTest: 0.05, opacity: 0, depthWrite: false, toneMapped: false }));
      const path = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, k) => new THREE.Vector3(Math.cos(k / 64 * Math.PI) * r, 0, Math.sin(k / 64 * Math.PI) * r)));
      const orbit = new THREE.LineLoop(path, new THREE.LineBasicMaterial({ color: bright, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      ring.add(points);
      const tilted = new THREE.Group();
      tilted.rotation.set(s.tilt * Math.PI / 180, (i / s.rings) * Math.PI, 0, 'YXZ');
      tilted.add(ring, orbit);
      group.add(tilted);
      rings.push({ s, points, orbit, ring, delay: i * 0.055 });
    }
  }
  return { group, rings };
}

// The sparks the traveller turns into: they start on the figure, spin up the column
// and settle out on a shell of their own as new stars round the planet.
function buildSparks(frame) {
  const rng = mulberry32(2718), pos = new Float32Array(SPARKS * 3), from = [];
  for (let i = 0; i < SPARKS; i++) {
    const v = rng(), height = (1 - v) * HEIGHT, width = 0.14 + (1 - height / HEIGHT) * 0.62;
    const z = rng() * 2 - 1, a = rng() * Math.PI * 2, c = Math.sqrt(1 - z * z);
    from.push({
      birth: v * DISSOLVE * 0.82, height, r: width * Math.sqrt(rng()), a, lift: 0.6 + rng() * 0.8,
      star: new THREE.Vector3(c * Math.cos(a), z, c * Math.sin(a)).multiplyScalar(R * (1.25 + rng() * 2)),
    });
  }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffe9b8, map: dot(), size: 3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  points.frustumCulled = false;
  const v = new THREE.Vector3(), { origin, up, fwd, right } = frame;
  points.userData.place = (t) => {
    for (let i = 0; i < SPARKS; i++) {
      const p = from[i], age = Math.max(0, t - p.birth), turn = p.a + age * 1.5, wide = p.r * (1 + age * 0.75);
      const rise = p.height + p.lift * (Math.exp(age * 0.82) - 1) * 1.6;
      v.copy(origin).addScaledVector(up, rise).addScaledVector(right, Math.cos(turn) * wide).addScaledVector(fwd, Math.sin(turn) * wide);
      v.lerp(p.star, smooth(4.5 + p.lift * 2, 11, age));
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return points;
}

// The pattern out loud: a kick, a rim into a dub echo, a metal hat and a gated hat.
// It keeps time by the audio clock, and the satellites pulse to the same steps.
class Sequencer {
  constructor(onStep) {
    this.onStep = onStep; this.step = 0; this.hits = [0, 0, 0, 0].map(() => -9); this.tracks = 1; this.queue = [];
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const c = this.ctx;
      this.out = c.createGain(); this.out.gain.value = 0.7; this.out.connect(c.destination);
      this.echo = c.createDelay(1); this.echo.delayTime.value = STEP * 3;
      const back = c.createGain(), dark = c.createBiquadFilter();
      back.gain.value = 0.55; dark.type = 'lowpass'; dark.frequency.value = 1400;
      this.echo.connect(dark); dark.connect(back); back.connect(this.echo); dark.connect(this.out);
      this.noise = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      c.resume().catch(() => {});
    } catch { this.ctx = null; }
    this.next = this.now() + 0.08;
  }
  now() { return this.ctx ? this.ctx.currentTime : performance.now() / 1000; }
  env(gain, at, peak, fall) {
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + fall);
  }
  noiseHit(at, type, freq, peak, fall, send) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq;
    this.env(g, at, peak, fall);
    src.connect(f); f.connect(g); g.connect(this.out);
    if (send) g.connect(this.echo);
    src.start(at); src.stop(at + fall + 0.02);
  }
  voice(track, at) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (track === 0) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(120, at); o.frequency.exponentialRampToValueAtTime(40, at + 0.14);
      this.env(g, at, 0.9, 0.55);
      o.connect(g); g.connect(this.out);
      o.start(at); o.stop(at + 0.6);
    } else if (track === 1) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = 1180;
      this.env(g, at, 0.34, 0.05);
      o.connect(g); g.connect(this.out); g.connect(this.echo);
      o.start(at); o.stop(at + 0.07);
    } else if (track === 2) this.noiseHit(at, 'highpass', 8200, 0.16, 0.05, false);
    else this.noiseHit(at, 'bandpass', 5200, 0.2, 0.22, true);
  }
  // Schedule a little ahead, and let the visuals know as each step comes due.
  tick() {
    const now = this.now();
    while (this.next < now + 0.12) {
      TRACKS.forEach((t, i) => {
        if (i >= this.tracks || t.steps[this.step] !== 'x') return;
        this.voice(i, this.next);
        this.queue.push({ i, at: this.next });
      });
      this.queue.push({ step: this.step, at: this.next });
      this.step = (this.step + 1) % 16;
      this.next += STEP;
    }
    while (this.queue.length && this.queue[0].at <= now) {
      const q = this.queue.shift();
      if (q.step != null) this.onStep(q.step); else this.hits[q.i] = q.at;
    }
    return now;
  }
  fade(sec) { if (this.ctx) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, sec / 3); }
  close() { this.ctx?.close().catch(() => {}); }
}

export class OrbitTeleport {
  // `o` is the launchpad, and `caption` shows a line of text at the bottom of the screen
  constructor({ scene, camera, o, caption }) {
    Object.assign(this, { scene, camera, o, caption });
    this.t = 0; this.from = camera.position.clone(); this.fromQ = camera.quaternion.clone();
    const { origin, fwd, up, right } = o.frame;
    this.seat = origin.clone().addScaledVector(up, 2.1).addScaledVector(fwd, -10.5).addScaledVector(right, 3.2);
    // a cut through the world, level with the top of what's left of the traveller
    this.cut = new THREE.Plane(up.clone().negate(), 0);
    o.traveller.traverse((m) => {
      if (!m.material) return;
      m.userData.was = m.material;
      m.material = m.material.clone();
      m.material.clippingPlanes = [this.cut];
    });
    this.cutAt(HEIGHT);
    this.pose(this.seat.clone(), 15);
    this.toQ = camera.quaternion.clone();
    camera.position.copy(this.from); camera.quaternion.copy(this.fromQ);
    this.sky = buildConstellations();
    this.sparks = buildSparks(o.frame);
    scene.add(this.sky.group, this.sparks);
    o.drive(true);
    this.seq = new Sequencer((s) => o.playStep(s));
    caption('Hold still.');
  }
  cutAt(h) { this.cut.constant = this.o.frame.origin.dot(this.o.frame.up) + h; }
  // Look along the frame's heading, tipped up by `phi` degrees, without ever rolling.
  pose(pos, phi, drift = 0) {
    const { fwd, up, right } = this.o.frame, a = phi * Math.PI / 180;
    const f = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
    const u = up.clone().multiplyScalar(Math.cos(a)).addScaledVector(fwd, -Math.sin(a));
    if (drift) { f.applyAxisAngle(right, drift); u.applyAxisAngle(right, drift); pos.applyAxisAngle(right, drift); }
    this.camera.position.copy(pos);
    this.camera.up.copy(u);
    this.camera.lookAt(pos.clone().add(f));
  }
  // returns true when it's time to leave
  step(dt) {
    this.t += dt;
    const { t, camera, o, seq } = this, { up, right } = o.frame;
    const now = seq.tick();
    const inFade = smooth(TOTAL - 0.2, TOTAL + FLASH - 0.2, t);
    if (t < GLIDE) {
      const e = smooth(0, 1, t / GLIDE);
      camera.position.lerpVectors(this.from, this.seat, e);
      camera.quaternion.slerpQuaternions(this.fromQ, this.toQ, e);
    } else if (t < GLIDE + DISSOLVE) {
      const k = (t - GLIDE) / DISSOLVE;
      this.cutAt(HEIGHT * (1 - smooth(0.02, 0.84, k) * 1.06));
      seq.tracks = k > 0.5 ? 2 : 1;
      this.pose(this.seat.clone(), 15 + 62 * smooth(0.3, 1, k));
    } else if (t < GLIDE + DISSOLVE + ASCEND) {
      const k = (t - GLIDE - DISSOLVE) / ASCEND, climb = smooth(0, 1, k);
      const alt = Math.expm1(climb * Math.log1p(FAR_ALT));
      seq.tracks = k > 0.3 ? 4 : 3;
      this.pose(this.seat.clone().addScaledVector(up, alt), 77 - 167 * smooth(0.28, 0.92, k));
      if (k > 0.5) this.caption('Orbitakt is played by the satellites overhead.');
    } else {
      const k = (t - GLIDE - DISSOLVE - ASCEND) / (ORBIT + FLASH);
      this.pose(this.seat.clone().addScaledVector(up, FAR_ALT), -90, k * 0.5);
      if (k > 0.45) this.caption('Handing you over…');
    }
    // the sky wakes up on the way out
    if (t > GLIDE) { this.sparks.material.opacity = 0.95; this.sparks.userData.place(t - GLIDE); }
    const alt = camera.position.length() - R, seen = smooth(1200, 9000, alt);
    let kick = 0;
    for (const r of this.sky.rings) {
      const hit = Math.exp(-Math.max(0, now - seq.hits[r.s.track] - r.delay) / 0.2);
      const on = now >= seq.hits[r.s.track] + r.delay ? hit : 0;
      kick = Math.max(kick, r.s.track === 0 ? on : 0);
      r.ring.rotation.y -= dt * r.s.spin * Math.PI * 2;
      r.points.material.opacity = seen * (0.72 + on * 0.28);
      r.points.material.size = r.s.size * (1 + on * 2.4);
      r.orbit.material.opacity = seen * (0.16 + on * 0.34);
    }
    this.sparks.material.size = 2.4 + kick * 1.6;
    if (t > TOTAL - 0.6) seq.fade(FLASH);
    this.flash = inFade;
    return t >= TOTAL + FLASH;
  }
  dispose() {
    const { o } = this;
    this.seq.close();
    o.drive(false);
    o.traveller.traverse((m) => { if (m.userData.was) { m.material.dispose(); m.material = m.userData.was; delete m.userData.was; } });
    this.scene.remove(this.sky.group, this.sparks);
    for (const g of [this.sky.group, this.sparks]) g.traverse((m) => { m.geometry?.dispose(); m.material?.dispose(); });
    this.caption('');
  }
}
