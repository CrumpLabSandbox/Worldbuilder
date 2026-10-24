// Blueprints: free-form structures that Claude designs from basic shapes and
// voxels (see blueprintSpec.js for the format). Each shape kind is one
// InstancedMesh, so even thousands of pieces draw cheaply.
import * as THREE from 'three';

const DEG = Math.PI / 180;

// Unit geometries, each filling a 1x1x1 box centred on the origin.
let unit = null;
function unitGeometries() {
  if (unit) return unit;
  const wedge = new THREE.BufferGeometry();
  {
    // triangular prism: back (-z) is full height, front (+z) is at ground level
    const a = [-0.5, -0.5, -0.5], b = [0.5, -0.5, -0.5], c = [0.5, 0.5, -0.5], d = [-0.5, 0.5, -0.5];
    const e = [-0.5, -0.5, 0.5], f = [0.5, -0.5, 0.5];
    const tris = [a, c, b, a, d, c, a, b, f, a, f, e, d, e, f, d, f, c, a, e, d, b, c, f];
    wedge.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    wedge.computeVertexNormals();
  }
  const dome = new THREE.SphereGeometry(0.5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 2, 1).translate(0, -0.5, 0);
  const ring = new THREE.TorusGeometry(0.375, 0.125, 12, 40).rotateX(Math.PI / 2);
  ring.scale(1, 4, 1);
  unit = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(0.5, 24, 16),
    dome,
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 28),
    cone: new THREE.ConeGeometry(0.5, 1, 28),
    pyramid: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
    ring,
    wedge,
  };
  return unit;
}

const solid = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
const shiny = new THREE.MeshBasicMaterial({ toneMapped: false });

export function buildBlueprint(rec) {
  const geos = unitGeometries();
  const g = new THREE.Group();
  const groups = new Map(); // "shape|glow" -> [{ m, c }]
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), color = new THREE.Color();
  const add = (shape, glow, matrix, c) => {
    const key = `${shape}|${glow ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ m: matrix.clone(), c: color.set(c).clone() });
  };
  for (const p of rec.parts || []) {
    if (!geos[p.shape]) continue;
    const [rx = 0, ry = 0, rz = 0] = p.rot || [];
    q.setFromEuler(e.set(rx * DEG, ry * DEG, rz * DEG));
    m4.compose(new THREE.Vector3(...p.at), q, new THREE.Vector3(...p.size));
    add(p.shape, p.glow, m4, p.color);
  }
  const vox = rec.voxels;
  if (vox && vox.cells && vox.cells.length) {
    const s = vox.size, ident = new THREE.Quaternion(), scl = new THREE.Vector3(s, s, s);
    for (const [x, y, z, ci] of vox.cells) {
      m4.compose(new THREE.Vector3(x * s, y * s + s / 2, z * s), ident, scl);
      add('box', vox.glow?.includes(ci), m4, vox.palette[ci] || '#ffffff');
    }
  }
  for (const [key, list] of groups) {
    const [shape, glow] = key.split('|');
    const mesh = new THREE.InstancedMesh(geos[shape], glow === '1' ? shiny : solid, list.length);
    list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.c); });
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    g.add(mesh);
  }
  return g;
}
