// The on-screen organ keyboard for phones and tablets: the same 17 keys as a
// computer keyboard, played with several fingers at once, and a finger can slide
// from key to key. It drives the same notes and hands as real keys.
const WHITE = 'asdfghjkl;';
const BLACK = { w: 1, e: 2, t: 4, y: 5, u: 6, o: 8, p: 9 }; // key -> white keys to its left

export function mountOrganKeys(el, { down, up, octave }) {
  const keys = document.createElement('div');
  keys.className = 'okeys';
  const add = (key, cls, left) => {
    const k = document.createElement('div');
    k.className = cls;
    k.dataset.key = key;
    k.textContent = key.toUpperCase();
    if (left != null) k.style.left = `${left * 10}%`;
    keys.append(k);
  };
  for (const key of WHITE) add(key, 'okey');
  for (const [key, left] of Object.entries(BLACK)) add(key, 'okey black', left);
  const bar = document.createElement('div');
  bar.className = 'okeys-oct';
  for (const [label, step] of [['− octave', -12], ['octave +', 12]]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => octave(step);
    bar.append(b);
  }
  el.append(bar, keys);

  const fingers = new Map(); // pointer -> key
  const count = (key) => [...fingers.values()].filter((k) => k === key).length;
  const set = (id, key) => {
    const old = fingers.get(id);
    if (old === key) return;
    if (key) fingers.set(id, key); else fingers.delete(id);
    if (old && !count(old)) { keys.querySelector(`[data-key="${old}"]`).classList.remove('on'); up(old); }
    if (key && count(key) === 1) { keys.querySelector(`[data-key="${key}"]`).classList.add('on'); down(key); }
  };
  const keyAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.okey')?.dataset.key ?? null;
  keys.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { keys.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    set(e.pointerId, keyAt(e));
  });
  keys.addEventListener('pointermove', (e) => { if (fingers.has(e.pointerId)) set(e.pointerId, keyAt(e)); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) keys.addEventListener(type, (e) => set(e.pointerId, null));
  keys.addEventListener('contextmenu', (e) => e.preventDefault());
  return { release() { for (const id of [...fingers.keys()]) set(id, null); } };
}
