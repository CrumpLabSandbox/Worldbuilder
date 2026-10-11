// Quadtree cube-sphere terrain with level of detail. Each of the six cube faces
// is a root tile; tiles split toward the camera and are built lazily from the
// planet's analytic height field. Skirts hide cracks between detail levels.
import * as THREE from 'three';
import { R } from './planet.js';

const FACES = [
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
  [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
];

function faceDir(face, u, v, out) {
  const [n, a, b] = FACES[face];
  const tu = Math.tan(u * Math.PI / 4), tv = Math.tan(v * Math.PI / 4);
  return out.copy(n).addScaledVector(a, tu).addScaledVector(b, tv).normalize();
}

class Tile {
  constructor(face, depth, u0, v0, size) {
    this.face = face; this.depth = depth; this.u0 = u0; this.v0 = v0; this.size = size; // uv in [-1, 1]
    this.center = faceDir(face, u0 + size / 2, v0 + size / 2, new THREE.Vector3());
    // angular radius (radians) of the tile's bounding cap, with margin
    const corner = faceDir(face, u0, v0, new THREE.Vector3());
    this.angRadius = Math.acos(THREE.MathUtils.clamp(corner.dot(this.center), -1, 1)) * 1.15 + 0.002;
    this.edge = (Math.PI / 2) * R * (size / 2); // approx edge length in world units
    this.children = null;
    this.mesh = null;
    this.building = false;
  }
}

export class TerrainLOD {
  constructor(planet, { segments = 40, maxDepth = 8, splitFactor = 2.8, buildBudgetMs = 9 } = {}) {
    this.planet = planet;
    this.segments = segments;
    this.maxDepth = maxDepth;
    this.splitFactor = splitFactor;
    this.buildBudgetMs = buildBudgetMs;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
    this.roots = FACES.map((_, f) => new Tile(f, 0, -1, -1, 2));
    this.visible = new Set();
    this.tileCount = 0;
    this._tmp = new THREE.Vector3();
  }

  _disposeAll() {
    const walk = (t) => { this._disposeMesh(t); if (t.children) t.children.forEach(walk); };
    this.roots.forEach(walk);
    this.visible = new Set();
  }

  dispose() {
    this._disposeAll();
    this.material.dispose();
  }

  // Throw away every tile (after terrain features change) and start again.
  reset() {
    this._disposeAll();
    this.roots = FACES.map((_, f) => new Tile(f, 0, -1, -1, 2));
  }

  _disposeMesh(t) {
    if (t.mesh) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; this.tileCount--; }
  }
  _collapse(t) {
    if (!t.children) return;
    for (const c of t.children) { this._collapse(c); this._disposeMesh(c); }
    t.children = null;
  }

  // Build a tile mesh from the height field. Returns the mesh.
  _build(t) {
    const S = this.segments, N = S + 1;
    const planet = this.planet;
    const count = N * N + 4 * N; // grid + skirt ring
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const d = new THREE.Vector3();
    const c = [0, 0, 0];
    // vertex spacing in radians → max noise frequency (cycles per unit) = 1 / (2 * spacing)
    const spacing = (Math.PI / 2) * (t.size / 2) / S;
    const maxFreq = 1 / (2.2 * spacing);
    const skirt = Math.max(3, t.edge * 0.04);
    let vi = 0;
    const heights = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      const v = t.v0 + (j / S) * t.size;
      for (let i = 0; i < N; i++) {
        const u = t.u0 + (i / S) * t.size;
        faceDir(t.face, u, v, d);
        const h = planet.elevation(d, maxFreq);
        heights[j * N + i] = h;
        const r = R + h;
        pos[vi * 3] = d.x * r; pos[vi * 3 + 1] = d.y * r; pos[vi * 3 + 2] = d.z * r;
        planet.color(d.x, d.y, d.z, h, c);
        col[vi * 3] = c[0]; col[vi * 3 + 1] = c[1]; col[vi * 3 + 2] = c[2];
        vi++;
      }
    }
    // skirt vertices: copies of edge vertices pushed inward
    const edgeIdx = [];
    for (let i = 0; i < N; i++) edgeIdx.push(i);                      // bottom row (j=0)
    for (let j = 0; j < N; j++) edgeIdx.push(j * N + (N - 1));        // right col
    for (let i = N - 1; i >= 0; i--) edgeIdx.push((N - 1) * N + i);   // top row
    for (let j = N - 1; j >= 0; j--) edgeIdx.push(j * N);             // left col
    const skirtStart = vi;
    for (const e of edgeIdx) {
      const x = pos[e * 3], y = pos[e * 3 + 1], z = pos[e * 3 + 2];
      const r = Math.hypot(x, y, z);
      const f = (r - skirt) / r;
      pos[vi * 3] = x * f; pos[vi * 3 + 1] = y * f; pos[vi * 3 + 2] = z * f;
      col[vi * 3] = col[e * 3]; col[vi * 3 + 1] = col[e * 3 + 1]; col[vi * 3 + 2] = col[e * 3 + 2];
      vi++;
    }
    const idx = new Uint32Array(S * S * 6 + edgeIdx.length * 6);
    let ii = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = j * N + i, b = a + 1, cc = a + N, dd = cc + 1;
      idx[ii++] = a; idx[ii++] = b; idx[ii++] = cc;
      idx[ii++] = b; idx[ii++] = dd; idx[ii++] = cc;
    }
    const E = edgeIdx.length;
    for (let k = 0; k < E; k++) {
      const e0 = edgeIdx[k], e1 = edgeIdx[(k + 1) % E];
      const s0 = skirtStart + k, s1 = skirtStart + ((k + 1) % E);
      idx[ii++] = e0; idx[ii++] = s0; idx[ii++] = e1;
      idx[ii++] = e1; idx[ii++] = s0; idx[ii++] = s1;
    }
    // cut tunnel mouths out of fine tiles that touch a tunnel
    let index = idx;
    if (spacing * R < 3.2) {
      const bounds = planet.holeBounds();
      const near = bounds.some((b) => Math.acos(THREE.MathUtils.clamp(t.center.dot(b.center), -1, 1)) < t.angRadius + b.ang);
      if (near) {
        const kept = new Uint32Array(idx.length);
        let k = 0;
        const cen = new THREE.Vector3();
        for (let q = 0; q < idx.length; q += 3) {
          const i0 = idx[q] * 3, i1 = idx[q + 1] * 3, i2 = idx[q + 2] * 3;
          cen.set((pos[i0] + pos[i1] + pos[i2]) / 3, (pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1]) / 3, (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3);
          const r = cen.length();
          cen.divideScalar(r);
          if (planet.isHole(cen, r - R)) continue;
          kept[k++] = idx[q]; kept[k++] = idx[q + 1]; kept[k++] = idx[q + 2];
        }
        index = kept.slice(0, k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `tile_${t.face}_${t.depth}`;
    mesh.frustumCulled = true;
    mesh.visible = false;
    this.group.add(mesh);
    this.tileCount++;
    return mesh;
  }

  // Build tiles synchronously until the view is fully detailed or time runs out.
  warm(cameraPos, maxMs = 600) {
    const t0 = performance.now();
    let before = -1;
    while (performance.now() - t0 < maxMs) {
      this.update(cameraPos, 50);
      if (this.tileCount === before && !this.pending) break;
      before = this.tileCount;
    }
  }

  // Decide which tiles to show for this camera position; build a few per frame.
  update(cameraPos, budgetMs = this.buildBudgetMs) {
    const camDir = this._tmp.copy(cameraPos).normalize();
    const camR = cameraPos.length();
    // angle from camera's nadir to the horizon (plus margin for mountains)
    // plus how far beyond the horizon the tallest terrain can still poke up
    const peak = Math.acos(R / (R + this.planet.maxElevation()));
    const horizon = Math.acos(THREE.MathUtils.clamp((R - this.planet.seaDepth) / camR, -1, 1)) + Math.max(0.05, peak);
    const start = performance.now();
    let built = 0;
    const canBuild = () => built === 0 || performance.now() - start < budgetMs;
    this.pending = false;
    const show = new Set();
    const visit = (t) => {
      const ang = Math.acos(THREE.MathUtils.clamp(t.center.dot(camDir), -1, 1));
      if (ang - t.angRadius > horizon) { this._collapse(t); return; } // beyond horizon
      const dist = Math.max(0, cameraPos.distanceTo(t.center.clone().multiplyScalar(R)) - t.edge * 0.75);
      const wantSplit = t.depth < this.maxDepth && dist < t.edge * this.splitFactor;
      if (wantSplit) {
        if (!t.children) {
          const s = t.size / 2;
          t.children = [
            new Tile(t.face, t.depth + 1, t.u0, t.v0, s), new Tile(t.face, t.depth + 1, t.u0 + s, t.v0, s),
            new Tile(t.face, t.depth + 1, t.u0, t.v0 + s, s), new Tile(t.face, t.depth + 1, t.u0 + s, t.v0 + s, s),
          ];
        }
        // children ready? (all leaf-renderable meshes exist)
        let ready = true;
        for (const c of t.children) {
          const cAng = Math.acos(THREE.MathUtils.clamp(c.center.dot(camDir), -1, 1));
          if (cAng - c.angRadius > horizon) continue; // hidden children don't block
          if (!c.mesh && !c.children) { if (canBuild()) { c.mesh = this._build(c); built++; } else { ready = false; this.pending = true; } }
        }
        if (ready) {
          for (const c of t.children) visit(c);
          if (t.depth > 0 && t.mesh && !show.has(t.mesh)) { /* parent mesh stays cached for quick merge */ }
          return;
        }
      } else if (t.children) {
        // hysteresis: only merge when well outside the split distance
        if (dist > t.edge * this.splitFactor * 1.3 || t.depth >= this.maxDepth) this._collapse(t);
        else {
          // keep children rendered until we're far enough away
          let ready = true;
          for (const c of t.children) if (!c.mesh && !c.children) ready = false;
          if (ready) { for (const c of t.children) visit(c); return; }
        }
      }
      if (!t.mesh) { if (canBuild()) { t.mesh = this._build(t); built++; } else { this.pending = true; return; } }
      show.add(t.mesh);
    };
    for (const root of this.roots) visit(root);
    for (const m of this.visible) if (!show.has(m)) m.visible = false;
    for (const m of show) m.visible = true;
    this.visible = show;
  }
}
