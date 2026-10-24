// The structure types Claude may place, with rough sizes so it can plan layouts.
// Keys must match src/structures.js. Sizes are at scale 1 and in metres.
export const CATALOG = {
  house: 'small house with a pitched roof, ~5 m across',
  hut: 'round thatched hut, ~5 m across',
  village: 'cluster of 6-10 houses with trees, ~50 m across',
  town: 'larger cluster of houses and a few taller buildings, ~80 m across',
  city: 'dense blocks of towers, ~120 m across',
  tower: 'round stone tower, ~5 m wide and 18 m tall',
  castle: 'walled castle with corner towers and a keep, ~40 m across',
  lighthouse: 'striped lighthouse with a light, ~20 m tall (good on coasts)',
  windmill: 'windmill with turning sails, ~12 m tall',
  temple: 'columned temple, ~20 m across',
  pyramid: 'stepped stone pyramid, ~40 m across',
  obelisk: 'tall thin obelisk, ~20 m tall',
  dome: 'domed building, ~20 m across',
  tree: 'single tree, ~8 m tall',
  forest: 'small grove of trees, ~40 m across',
  farm: 'farmhouse with fields, ~50 m across',
  beacon: 'glowing beacon light on a post, visible from far away',
  flag: 'flag on a pole',
  wall: 'straight stone wall, 40 m long, runs along the heading',
  bridge: 'bridge; give both ends with lat/lon and lat2/lon2 (shore to shore), otherwise a 60 m span along the heading',
  ship: 'sailing ship that floats on the sea (place on water), ~25 m long',
  monolith: 'tall black monolith slab',
  arch: 'stone arch you can fly through, ~15 m wide',
  statue: 'statue on a plinth, ~10 m tall',
  dinosaur: 'giant dinosaur monument, ~40 m long',
  volcano: 'terrain feature: a volcano cone with a lava crater. Optional radius (base, default 600 m) and height (default 420 m). Very large; use sparingly and on land',
  woodland: 'terrain feature: thousands of trees over an area. Optional radius (default 400 m)',
  mushroomtree: 'colossal glowing fungal tree. Optional height (default 320 m)',
};

export const TYPES = Object.keys(CATALOG);
// Types that reshape the terrain and accept size options.
export const FEATURE_OPTIONS = { volcano: ['radius', 'height'], woodland: ['radius'], mushroomtree: ['height'] };
