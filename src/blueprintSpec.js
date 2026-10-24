// Shared by the game and the server: the shapes a blueprint can use and its limits.
// A blueprint is a free-form structure made of basic shapes and/or a voxel grid,
// in metres, in its own frame: +y up from the ground, +z towards its front (the
// side that faces its heading), +x to the right of someone standing in front of it.
export const SHAPES = {
  box: 'rectangular block; size = width (x), height (y), depth (z)',
  sphere: 'ellipsoid filling its size box',
  dome: 'half sphere, flat side down, filling its size box',
  cylinder: 'upright cylinder; size = diameter (x), height (y), diameter (z)',
  cone: 'upright cone, point up; size = base diameter (x), height (y), base diameter (z)',
  pyramid: 'four-sided pyramid, point up, square base filling x and z',
  ring: 'flat ring (torus) lying level; size = outer diameter (x), tube thickness (y), outer diameter (z); the tube is a quarter of the diameter wide',
  wedge: 'ramp: full height at the back (-z), sloping down to nothing at the front (+z)',
};
export const SHAPE_NAMES = Object.keys(SHAPES);

export const LIMITS = {
  parts: 600,       // shapes per blueprint
  cells: 8000,      // voxels per blueprint
  palette: 32,      // voxel colours
  reach: 500,       // furthest any part may sit from the anchor, horizontally (m)
  height: 900,      // tallest point above the anchor (m)
  partSize: 900,    // largest dimension of one part (m)
  voxel: [0.5, 30], // voxel edge length range (m)
};
