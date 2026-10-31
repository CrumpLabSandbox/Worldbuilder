// The Claude builder chat panel. The server does the talking to Claude and saves
// what gets built; this panel sends the player's message with where they are and
// hands the returned world edits back to the game.
import { formatLat, formatLon, wrapLon } from './planet.js';

const $ = (id) => document.getElementById(id);
const newSessionId = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('-');

export function initChat({ store, controls, applyEdits, onSpot }) {
  const panel = $('chat'), log = $('chat-log'), input = $('chat-input'), send = $('chat-send');
  let sessionId = newSessionId();
  let spot = null;
  let busy = false;

  const isOpen = () => !panel.classList.contains('hidden');
  function open(focus = true) {
    panel.classList.remove('hidden');
    $('btn-chat').classList.add('hidden');
    document.body.classList.add('chat-open');
    if (focus && !document.body.classList.contains('touch')) input.focus();
  }
  function close() {
    panel.classList.add('hidden');
    $('btn-chat').classList.remove('hidden');
    document.body.classList.remove('chat-open');
    input.blur();
  }

  function addMsg(kind, text) {
    const el = document.createElement('div');
    el.className = `msg ${kind}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function setSpot(s) {
    spot = s;
    $('chat-spot-text').textContent = s
      ? `📍 ${formatLat(s.lat)}, ${formatLon(s.lon)} · ${s.elevation > 0 ? 'land' : 'water'}`
      : '📍 No spot picked: building ahead of you';
    $('chat-spot-clear').classList.toggle('hidden', !s);
    onSpot(s);
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    if (store.current.kind !== 'repo') { addMsg('error', 'Claude builds in the shared worlds. Load one from the World panel (☰) first.'); return; }
    busy = true; send.disabled = true;
    input.value = '';
    addMsg('user', text);
    const pending = addMsg('claude pending', 'Claude is building');
    const { lat, lon } = controls.latLon;
    const context = {
      player: { lat, lon: wrapLon(lon), alt: controls.altitude, heading: controls.heading },
      spot: spot && { lat: spot.lat, lon: wrapLon(spot.lon) },
    };
    try {
      const res = await fetch('./api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId: store.current.id, sessionId, message: text, context }),
      });
      const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
      pending.remove();
      if (data.reply) addMsg('claude', data.reply);
      if (data.error) addMsg('error', data.error);
      if (data.edits) applyEdits(data.edits, { fly: true, own: true });
    } catch {
      pending.remove();
      addMsg('error', "Couldn't reach the server. Check your connection and try again.");
    } finally {
      busy = false; send.disabled = false;
    }
  }

  $('btn-chat').onclick = () => open();
  $('chat-close').onclick = close;
  $('chat-new').onclick = () => {
    sessionId = newSessionId();
    log.replaceChildren();
    addMsg('claude', 'New conversation. What should I build?');
  };
  $('chat-spot-clear').onclick = () => setSpot(null);
  $('chat-form').onsubmit = (e) => { e.preventDefault(); submit(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); input.blur(); }
  });
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!$('about').classList.contains('hidden') || document.body.classList.contains('intro-open')) return;
    if (e.code === 'KeyT' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); open(); }
  });

  return {
    isOpen,
    get busy() { return busy; },
    // a click/tap on the globe while the chat is open picks the build spot
    pick(hit) { if (!isOpen()) return false; setSpot(hit); return true; },
    async enable() {
      try {
        const res = await fetch('./api/config', { cache: 'no-store' });
        if (res.ok && (await res.json()).chat) { $('btn-chat').classList.remove('hidden'); return true; }
      } catch { /* static hosting: no chat */ }
      return false;
    },
  };
}
