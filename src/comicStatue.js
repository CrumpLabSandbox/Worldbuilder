// The Comic Booklet statue: a giant open comic on a plinth at the shore, turning
// its own pages. Clicking it opens the record's url: megaZINE, not the PDF itself. The pages are
// made-up placeholder art in the comic's spirit, not Jan's. The record's lat/lon is
// the lookout and its heading points at the statue, which faces back at it: the
// model's front is +z.
import * as THREE from 'three';
import { R, tangentFrame } from './planet.js';

const DEG = Math.PI / 180;
const W = 100, H = 138, SPREAD = 0.3, TILT = -0.14;  // one page, and how the book lies open
const STATUE_Z = -300, BASE_Y = 50;
const FLIP = 2.4, REST = 5;                          // seconds turning a page, seconds between
const INK = '#16110e', RED = 0xd6232f, CREAM = '#fbf2dc', CYAN = '#25b7d3', YELLOW = '#ffd52e', MAGENTA = '#e0287a';
const FONT = '"Comic Sans MS", "Marker Felt", cursive';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
const STONE = std(0xb9b4ac), GOLD = std(0xe3b23c), COVER = std(RED);
const inkLines = new THREE.LineBasicMaterial({ color: 0x16110e });

function box(parent, w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), inkLines));
  parent.add(m);
  return m;
}
function texture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function plane(parent, w, h, map, x, y, z, extra = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, toneMapped: false, ...extra }));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// ---- comic drawing, all in a panel's own w x h
function fill(c, color, w, h) { c.fillStyle = color; c.fillRect(0, 0, w, h); }
function dots(c, color, w, h, step = 18) {
  c.fillStyle = color;
  for (let y = 0, row = 0; y < h + step; y += step * 0.7, row++) {
    for (let x = row % 2 ? step / 2 : 0; x < w + step; x += step) {
      c.beginPath(); c.arc(x, y, step * (0.1 + 0.25 * y / h), 0, 7); c.fill();
    }
  }
}
function words(c, text, x, y, size, color = INK, stroke = null) {
  c.font = `bold ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = size / 5; c.strokeText(text, x, y); }
  c.fillStyle = color; c.fillText(text, x, y);
}
function caption(c, text, w) {
  c.font = `bold 28px ${FONT}`;
  const bw = Math.min(w - 20, c.measureText(text).width + 30);
  c.fillStyle = YELLOW; c.fillRect(10, 10, bw, 46);
  c.strokeStyle = INK; c.lineWidth = 4; c.strokeRect(10, 10, bw, 46);
  words(c, text, 10 + bw / 2, 34, 28);
}
function spikes(c, x, y, r1, r2, n, color) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1, a = i * Math.PI / n;
    c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8);
  }
  c.closePath();
  c.fillStyle = color; c.fill();
  c.strokeStyle = INK; c.lineWidth = 7; c.stroke();
}
function bubble(c, text, x, y, rx, ry, tailX, tailY, size = 34) {
  c.fillStyle = '#fff'; c.strokeStyle = INK; c.lineWidth = 6;
  c.beginPath(); c.moveTo(x - rx * 0.3, y); c.lineTo(tailX, tailY); c.lineTo(x + rx * 0.3, y); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 7); c.fill(); c.stroke();
  words(c, text, x, y, size);
}
function reader(c, x, y, s) {
  c.strokeStyle = INK; c.lineWidth = 8 * s; c.lineCap = 'round'; c.fillStyle = '#fff';
  c.beginPath(); c.arc(x, y, 34 * s, 0, 7); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(x, y + 34 * s); c.lineTo(x, y + 120 * s); c.moveTo(x, y + 60 * s); c.lineTo(x + 56 * s, y + 66 * s);
  c.moveTo(x, y + 120 * s); c.lineTo(x - 34 * s, y + 190 * s); c.moveTo(x, y + 120 * s); c.lineTo(x + 34 * s, y + 190 * s); c.stroke();
  c.fillStyle = MAGENTA; c.fillRect(x + 50 * s, y + 34 * s, 16 * s, 56 * s);
  c.fillStyle = INK; c.fillRect(x + 8 * s, y - 8 * s, 8 * s, 8 * s);
}

const PANELS = {
  shore(c, w, h) {
    fill(c, '#8fdcf0', w, h); dots(c, '#ffffff', w, h, 24);
    c.fillStyle = YELLOW; c.beginPath(); c.arc(w * 0.76, h * 0.3, 54, 0, 7); c.fill();
    fill(c, 'transparent', w, h);
    c.fillStyle = CYAN; c.fillRect(0, h * 0.7, w, h * 0.3);
    caption(c, 'One day, by the sea...', w);
  },
  find(c, w, h) {
    fill(c, '#ffe9a8', w, h);
    reader(c, w * 0.34, h * 0.28, 1);
    bubble(c, 'A comic!', w * 0.7, h * 0.26, 120, 58, w * 0.46, h * 0.52);
  },
  pow(c, w, h) {
    fill(c, CYAN, w, h); dots(c, '#0d7f9b', w, h);
    spikes(c, w / 2, h / 2, Math.min(w, h) * 0.52, Math.min(w, h) * 0.28, 12, YELLOW);
    words(c, 'POW!', w / 2, h / 2, 84, MAGENTA, '#fff');
  },
  night(c, w, h) {
    fill(c, '#231a4d', w, h);
    c.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) c.fillRect((i * 83) % w, (i * 47) % h, 4, 4);
    c.fillStyle = '#ff9e3d'; c.strokeStyle = INK; c.lineWidth = 6;
    c.beginPath(); c.arc(w * 0.5, h * 0.6, 62, 0, 7); c.fill(); c.stroke();
    c.strokeStyle = YELLOW; c.lineWidth = 9; c.beginPath(); c.ellipse(w * 0.5, h * 0.6, 112, 26, -0.25, 0, 7); c.stroke();
    caption(c, 'Meanwhile...', w);
  },
  read(c, w, h) {
    fill(c, '#ffc6dc', w, h); dots(c, '#f58ab3', w, h);
    reader(c, w * 0.5, h * 0.2, 1.1);
    words(c, 'flip', w * 0.8, h * 0.28, 42, INK);
    words(c, 'flip', w * 0.2, h * 0.5, 34, INK);
  },
  end(c, w, h) {
    fill(c, YELLOW, w, h);
    words(c, 'The End?', w / 2, h * 0.42, 74, MAGENTA, '#fff');
    words(c, 'Click to read the real one', w / 2, h * 0.72, 30);
  },
};

function comicPage(rows) {
  return (c, w, h) => {
    fill(c, CREAM, w, h);
    const m = 34, gap = 22, rowH = (h - m * 2 - gap * (rows.length - 1)) / rows.length;
    rows.forEach((row, r) => {
      const y = m + r * (rowH + gap), cellW = (w - m * 2 - gap * (row.length - 1)) / row.length;
      row.forEach((name, i) => {
        const x = m + i * (cellW + gap);
        c.save();
        c.translate(x, y);
        c.beginPath(); c.rect(0, 0, cellW, rowH); c.clip();
        PANELS[name](c, cellW, rowH);
        c.restore();
        c.strokeStyle = INK; c.lineWidth = 8; c.strokeRect(x, y, cellW, rowH);
      });
    });
  };
}
function coverPage(c, w, h) {
  fill(c, MAGENTA, w, h); dots(c, '#b3155c', w, h, 26);
  c.strokeStyle = INK; c.lineWidth = 12; c.strokeRect(26, 26, w - 52, h - 52);
  words(c, 'megaZINE', w / 2, 120, 64, '#fff', INK);
  spikes(c, w / 2, h * 0.52, 300, 190, 14, YELLOW);
  words(c, 'COMIC', w / 2, h * 0.47, 100, CYAN, INK);
  words(c, 'BOOKLET', w / 2, h * 0.58, 80, CYAN, INK);
  words(c, 'by Jan', w / 2, h - 110, 52, '#fff', INK);
}
const PAGES = [
  coverPage,
  comicPage([['shore'], ['find', 'pow']]),
  comicPage([['night', 'read'], ['pow']]),
  comicPage([['find'], ['read', 'night']]),
  comicPage([['shore', 'pow'], ['read']]),
  comicPage([['night'], ['end']]),
];

export function buildComicStatue(rec, planet, f) {
  const site = new THREE.Group();
  site.position.copy(f.center).multiplyScalar(R + f.target);
  const { east, north, up } = tangentFrame(f.center);
  site.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
  const g = new THREE.Group();                    // -z is the record's heading, at the statue
  g.rotation.y = -(rec.heading ?? 0) * DEG;
  site.add(g);

  // the plinth, its name on the front
  const statue = new THREE.Group();
  statue.position.z = STATUE_Z;
  g.add(statue);
  box(statue, 250, 12, 150, STONE, 0, 6, 0);
  box(statue, 226, 14, 128, STONE, 0, 19, 0);
  box(statue, 204, 24, 106, std(0xe0287a), 0, 38, 0);
  box(statue, 210, 3, 112, GOLD, 0, BASE_Y + 1, 0);
  plane(statue, 150, 21, texture(1024, 144, (c, w, h) => {
    fill(c, YELLOW, w, h);
    c.strokeStyle = INK; c.lineWidth = 12; c.strokeRect(6, 6, w - 12, h - 12);
    words(c, `${rec.name} · by Jan`, w / 2, h / 2 + 4, 84);
  }), 0, 38, 53.2);

  // the book: two boards, a page block on each, opening from the spine
  const pages = PAGES.map((draw) => texture(768, 1060, draw));
  const book = new THREE.Group();
  book.position.set(0, BASE_Y + 3, 12);
  book.rotation.x = TILT;
  statue.add(book);
  const side = (dir) => {
    const p = new THREE.Group();
    p.rotation.y = -dir * SPREAD;
    book.add(p);
    box(p, W + 6, H + 8, 3, COVER, dir * (W + 6) / 2, H / 2, -3);
    box(p, W, H, 3, std(0xf6eddc), dir * W / 2, H / 2, 0);
    return p;
  };
  const left = side(-1), right = side(1);
  const leftPage = plane(left, W - 2, H - 2, pages[0], -W / 2, H / 2, 1.7);
  const rightPage = plane(right, W - 2, H - 2, pages[1], W / 2, H / 2, 1.7);
  plane(left, W, H, pages[0], -W / 2, H / 2, -4.7, { side: THREE.BackSide }).scale.x = -1;
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, H + 8, 12), COVER);
  spine.position.set(0, H / 2, -4);
  book.add(spine);
  box(statue, 40, 110, 36, GOLD, 0, BASE_Y + 55, -30).rotation.x = TILT;
  box(statue, 214, 7, 20, GOLD, 0, BASE_Y + 6, 34);

  // the turning leaf, shown only while it turns
  const leaf = new THREE.Group();
  leaf.position.z = 2.4;
  leaf.visible = false;
  book.add(leaf);
  const leafFront = plane(leaf, W - 2, H - 2, pages[1], W / 2, H / 2, 0.3);
  const leafBack = plane(leaf, W - 2, H - 2, pages[2], W / 2, H / 2, -0.3);
  leafBack.rotation.y = Math.PI;

  // the sound effects hanging around it
  const pop = (w, h, draw, x, y) => {
    const m = plane(statue, w, h, texture(512, Math.round(512 * h / w), draw), x, y, 30, { transparent: true, depthWrite: false, alphaTest: 0.02 });
    m.userData.y = y;
    return m;
  };
  const read = pop(140, 100, (c, w, h) => bubble(c, 'Read me!', w / 2, h * 0.4, w * 0.44, h * 0.32, w * 0.2, h * 0.94, 70), 158, 202);
  const pow = pop(130, 110, (c, w, h) => {
    spikes(c, w / 2, h / 2, w * 0.47, w * 0.28, 11, YELLOW);
    words(c, 'POW!', w / 2, h / 2, 86, MAGENTA, '#fff');
  }, -165, 118);

  // what a click or tap lands on
  const hit = new THREE.Mesh(new THREE.BoxGeometry(320, 230, 150), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0, 115, 0);
  statue.add(hit);

  let t = 0, clock = 0, spread = 0;
  site.userData.update = (dt) => {
    t += dt; clock += dt;
    read.position.y = read.userData.y + Math.sin(t * 1.1) * 5;
    pow.position.y = pow.userData.y + Math.sin(t * 0.8 + 2) * 6;
    pow.rotation.z = Math.sin(t * 0.6) * 0.08;
    const n = pages.length, page = (i) => pages[(spread + i) % n];
    if (clock > REST && !leaf.visible) {
      leafFront.material.map = page(1);
      leafBack.material.map = page(2);
      rightPage.material.map = page(3);
      leaf.visible = true;
    }
    if (leaf.visible) {
      const k = THREE.MathUtils.smoothstep(clock - REST, 0, FLIP);
      leaf.rotation.y = -SPREAD - k * (Math.PI - SPREAD * 2);
      if (k >= 1) {
        leftPage.material.map = page(2);
        leaf.visible = false;
        spread = (spread + 2) % n;
        clock = 0;
      }
    }
  };
  site.userData.labelPos = new THREE.Vector3(0, 265, STATUE_Z).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
  site.userData.labelRange = 6000;

  const toWorld = (v) => v.clone().applyMatrix4(g.matrixWorld);
  site.userData.comicStatue = {
    site,
    hit,
    url: rec.url,
    center: site.position.clone(),
    // from the lookout, out over the shore at the open book
    view() {
      const pos = toWorld(new THREE.Vector3(0, 124, 0));
      return { pos, look: toWorld(new THREE.Vector3(0, 112, STATUE_Z)).sub(pos).normalize() };
    },
  };
  return site;
}
