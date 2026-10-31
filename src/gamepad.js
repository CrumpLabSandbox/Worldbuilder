// Fly with a gamepad: Xbox, PlayStation and Nintendo Switch controllers (Pro
// Controller and Joy-Con), or most others, through the browser's Gamepad API.
//
// The API numbers buttons by position, not by the letter on them, so Nintendo's A
// (on the right) is button 1 where Xbox's A (at the bottom) is button 0. Confirm and
// cancel swap to suit, so that "press A" means the same on either. A browser only
// shows a controller once one of its buttons has been pressed.
const DEAD = 0.15;
const LOOK_SPEED = 95;        // degrees a second, right stick at full tilt
const REPEAT = 0.22;          // seconds between steps through the place list
const BTN = { bottom: 0, right: 1, left: 2, top: 3, l: 4, r: 5, zl: 6, zr: 7, minus: 8, plus: 9, up: 12, down: 13, dleft: 14, dright: 15 };
const STORE = 'worldbuilder.gamepad';

// What A does, in order: whichever of these is showing.
const ACTIONS = ['intro-start', 'mn-go', 'ash-go', 'orbit-go', 'about-start', 'btn-university', 'btn-night', 'btn-mneme', 'btn-organ', 'btn-ride', 'btn-dial', 'btn-ashland', 'btn-orbitakt', 'btn-paper', 'btn-skip', 'btn-comic'];
// What B does, in order, before falling back on Escape.
const CANCELS = ['hands-close', 'mn-stay', 'ash-stay', 'orbit-stay', 'ash-stop', 'orbit-stop', 'organ-stand', 'bbs-hangup', 'night-leave', 'uni-leave'];

const shape = (v = 0) => (Math.abs(v) < DEAD ? 0 : (Math.sign(v) * (Math.min(1, Math.abs(v)) - DEAD)) / (1 - DEAD));
const held = (pad, i) => { const b = pad.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
const level = (pad, i) => pad.buttons[i]?.value || (held(pad, i) ? 1 : 0);
const isNintendo = (id = '') => /057e|nintendo|joy-?con|pro controller/i.test(id);
// one Joy-Con held sideways has a single stick, so the shoulder buttons turn instead
const oneStick = (pad) => pad.axes.length < 4 || /joy-?con \((l|r)\)|joy-?con (l|r)\b/i.test(pad.id || '');
const showing = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

export class Gamepads {
  // `controls()` gives the flight controls; `places()` the Visit list as [{ id, name }];
  // `go(id)` visits one; `say(text)` shows a message; `used()` runs on first use.
  constructor({ controls, places, go, say, used }) {
    Object.assign(this, { controls, places, go, say, used });
    this.was = [];             // buttons down last frame
    this.place = -1;           // where we are in the place list
    this.hold = 0;             // time until the d-pad steps again
    this.driving = false;      // the sticks are moving the flight controls
    this.placeKey = 'X';
    try { this.enabled = localStorage.getItem(STORE) !== 'off'; } catch { this.enabled = true; }
    window.addEventListener('gamepadconnected', (e) => this.connected(e.gamepad));
    window.addEventListener('gamepaddisconnected', () => { this.release(); this.say('🎮 Controller disconnected'); });
  }
  setEnabled(on) {
    this.enabled = on;
    if (!on) this.release();
    try { localStorage.setItem(STORE, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
  }
  connected(pad) {
    if (!this.enabled) return;
    this.say('🎮 Controller ready: A to go in, B to leave, d-pad for places', 4000);
  }
  // take our hands off the controls, or they'd keep flying
  release() {
    if (!this.driving) return;
    const c = this.controls();
    if (c) { c.stick.x = 0; c.stick.y = 0; c.lift = 0; c.boost = false; }
    this.driving = false;
  }
  current() {
    if (!navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p?.connected && p.mapping !== 'xr-standard') return p;
    return null;
  }

  update(dt) {
    const pad = this.enabled ? this.current() : null;
    if (!pad) { this.release(); this.was = []; return; }
    const pressed = (i) => held(pad, i) && !this.was[i];
    const nintendo = isNintendo(pad.id), single = oneStick(pad);
    this.placeKey = single ? 'minus' : nintendo ? 'X' : 'Y'; // the top button: X on Nintendo, Y on Xbox, triangle on PlayStation
    const confirm = nintendo ? BTN.right : BTN.bottom, cancel = nintendo ? BTN.bottom : BTN.right;
    const c = this.controls();
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

    if (c && c.enabled && !typing) {
      const mx = shape(pad.axes[0]), my = shape(pad.axes[1]);
      let lx = shape(pad.axes[2]), ly = shape(pad.axes[3]);
      if (single) { lx = (held(pad, BTN.r) ? 1 : 0) - (held(pad, BTN.l) ? 1 : 0); ly = 0; }
      const climb = single ? (held(pad, BTN.top) ? 1 : 0) - (held(pad, BTN.left) ? 1 : 0) : level(pad, BTN.zr) - level(pad, BTN.zl);
      const boost = single ? level(pad, BTN.zr) > 0.5 : held(pad, BTN.r) || held(pad, BTN.l);
      if (mx || my || lx || ly || climb || boost) { if (!this.driving) this.used(); this.driving = true; }
      if (this.driving) {
        c.stick.x = mx; c.stick.y = -my;
        c.lift = climb;
        c.boost = boost;
        // a gentle curve, so small movements of the stick aim finely
        c.heading = (c.heading + Math.sign(lx) * lx * lx * LOOK_SPEED * dt + 360) % 360;
        c.pitch = Math.min(89, Math.max(-89, c.pitch - Math.sign(ly) * ly * ly * LOOK_SPEED * 0.7 * dt));
      }
    } else this.release();

    if (pressed(confirm)) this.act();
    if (pressed(cancel)) this.back();
    if (!typing) {
      if (pressed(single ? BTN.minus : BTN.top)) this.visit();
      if (!single && pressed(BTN.left)) this.key('KeyB');   // build mode
      if (pressed(BTN.plus)) this.key('KeyH');             // the controls card
      if (pressed(BTN.minus) && !single) this.key('KeyU');  // photo mode
      const step = (held(pad, BTN.down) ? 1 : 0) - (held(pad, BTN.up) ? 1 : 0);
      this.hold -= dt;
      if (!step) this.hold = 0;
      else if (this.hold <= 0) { this.stepPlace(step); this.hold = REPEAT; }
    }
    this.was = pad.buttons.map((_, i) => held(pad, i));
  }

  act() {
    const el = ACTIONS.map((id) => document.getElementById(id)).find(showing);
    if (el) el.click(); else this.key('Enter');           // fires the catapult when loaded
  }
  back() {
    const el = CANCELS.map((id) => document.getElementById(id)).find(showing);
    if (el) el.click(); else this.key('Escape');
  }
  key(code) { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Escape' || code === 'Enter' ? code : '', bubbles: true })); }
  stepPlace(by) {
    const list = this.places();
    if (!list.length) return;
    this.place = (this.place + by + list.length) % list.length;
    this.say(`🧭 ${list[this.place].name}: press ${this.placeKey} to go there`, 2600);
  }
  visit() {
    const list = this.places(), p = list[this.place];
    if (p) this.go(p.id); else this.say('🧭 Use the d-pad to pick a place first');
  }
}
