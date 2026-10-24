# Worldbuilder

A procedurally generated globe you can fly around, explore, and build on.
Built with [Three.js](https://threejs.org/) and Vite; deployed to GitHub Pages
from `main` by GitHub Actions.

**Live site:** https://crumplabsandbox.github.io/Worldbuilder/

## Exploring

| Control | Action |
| --- | --- |
| `W` / `S` | fly forward / back |
| `A` / `D` | strafe left / right |
| `R` / `F` (or `Space` / `C`) | climb / descend |
| `Q` / `E` or `←` / `→` | turn |
| `↑` / `↓` | pitch |
| `Shift` | 4× boost |
| drag mouse | look around (press `L` for pointer lock) |
| scroll wheel | speed multiplier |
| click the globe | read the coordinates under the cursor (copied to clipboard) |
| `G` | toggle lat/lon grid |
| `B` | toggle build mode |
| `H` | toggle help |

**Touchscreen:** a virtual stick (bottom left) moves you forward, back, and
sideways; drag one finger on the globe to look around; pinch to change
altitude; the ▲ ▼ buttons climb and descend, ⚡ toggles boost, and − / +
change the speed multiplier. Tap the globe to read coordinates, and use the
☰ button for the world and build panel.

Speed scales with altitude, so you can cross the planet in seconds from orbit and
creep along at walking pace near the ground.

The **Position** panel shows latitude, longitude, altitude above ground, heading,
and what is directly below you. **Copy position** copies
`lat …, lon …, alt …, heading …` and **Copy link** copies a URL that reopens the
exact same view (world, position, and look direction live in the URL hash).

## Building

Structures are placed by coordinates. Two ways to build:

1. **In the browser.** Tick *Build mode*, choose a type, colour, scale, and
   heading, then click the globe. Your additions are saved in the browser
   (localStorage) as an overlay on the published world. *Reset* discards that
   overlay. *Export* downloads the world as JSON.
2. **In the repo.** Edit `public/worlds/home.json` (or add a new world file and
   list it in `public/worlds/index.json`). Each structure looks like:

   ```json
   { "id": "unique-id", "type": "castle", "lat": 12.345, "lon": -67.89,
     "heading": 45, "scale": 1.5, "color": "#b0a090", "name": "Castle Crump" }
   ```

   `heading` is degrees clockwise from north, `scale` multiplies size, `alt`
   (optional) raises the base above the ground. Structures sit on the terrain
   (or float on the sea).

Long bridges: give a `bridge` both ends with `lat`/`lon` and `lat2`/`lon2`
(the two shore points). It follows the planet's curvature, puts piers down to
the seabed, and ramps onto land `landing` metres (default 45) past each end.
Optional `width` (default 10) and `deckHeight` (default 6) are in metres.

Terrain features reshape the planet itself rather than sitting on it:

- `volcano` — a cone with a crater, lava lake, and smoke. Options: `radius`
  (base, default 600), `height` (default 420), `crater` (default 70),
  `craterDepth` (default 60).
- `road` — needs `lat`/`lon` and `lat2`/`lon2`. It grades a smooth road
  (cuttings and embankments) and automatically bores a lit tunnel, with stone
  portals, wherever the ground stands well above it. You can fly through
  tunnels. Options: `width` (default 9), `tunnelHeight` (9), `grade` (0.08).
- `woodland` — thousands of instanced trees with clearings, kept off roads and
  bare volcano slopes, and a forest-floor tint. Options: `radius` (default
  400), `count` (tree attempts).

- `coaster` — a one-way roller coaster you can ride. `lat`/`lon` is the start
  station and `heading` its direction; `path` lists waypoints `[F, L, h]`
  (metres forward, metres right, height above ground) with elements between
  them: `{ "loop": diameter }`, `{ "corkscrew": length }`, and
  `{ "helix": radius, "turns": n, "drop": m, "side": 1 | -1 }`. `liftEnd` is
  the index of the waypoint at the top of the chain lift. Near a start
  station a **Ride** button appears (also in the structures list); Esc or
  W/A/S/D gets you off, and the ride drops you at the far station.
- A `woodland` with `alien: { lat, lon, start, full }` turns from trees into
  glowing alien flora (mushrooms, crystals, tendrils, orb stalks, pods,
  coral) between `start` and `full` metres from that point.

- `catapult` — a giant trebuchet on a raised hill (`raise` metres, `pad`
  radius, `band` slope width) facing `heading`, with a tree-free firing lane
  (`lane` metres long, `laneWidth` half-angle) and a pen holding every kind
  of ammunition. Within about 300 m a control panel appears: pick boulders,
  barrels, crates, watermelons, pumpkins, a cow, rubber ducks, beach balls,
  an anvil or an alien orb (or click one in the pen), choose its size, set
  power, angle and aim, and press **Launch** or Enter. A dashed arc and ring
  show where it will land. Shots fly under the planet's gravity with a little
  drag. They bounce, splash, float, sink or splat, and "Follow the shot"
  rides the camera along (Esc to stop).

- `graffiti` — the Graffiti Garden: a paved plaza (`pad` radius) of large
  concrete installations in graffiti styles, built when you come within a few
  kilometres. It has puffy bubble throw-ups with drips and shines, wildstyle
  with arrows and spikes, chrome 3D blockbuster letters, a crown, a spray can,
  a POW starburst, a heart, a curly arrow, a drippy alien eye, a chrome tag,
  painted mural walls and a gateway. The garden renders at higher fidelity:
  clearcoat paint with banded fades, chrome sky reflections, cartoon outlines,
  2048 px textures and real-time shadows. `entrance` is the gateway's bearing
  from the centre.

- `mushroomtree` — the Super Mushroom Tree: a colossal fungal tree (`height`,
  default 320 m, and optional `capRadius`) with a fluted stem veined in
  light, buttress roots, branches ending in their own caps, bracket shelves,
  a spotted canopy with glowing gills, swaying bioluminescent tendrils,
  drifting spores and a fairy ring. Trees in any woodland keep clear of it.

Press **U** for photo mode, which hides the interface.

Available types: `house`, `hut`, `village`, `town`, `city`, `tower`, `castle`,
`lighthouse`, `windmill`, `temple`, `pyramid`, `obelisk`, `dome`, `tree`,
`forest`, `farm`, `beacon`, `flag`, `wall`, `bridge`, `ship`, `monolith`,
`arch`, `statue`, `dinosaur`, `volcano`, `woodland`, `road`, `coaster`, `catapult`, `graffiti`, `mushroomtree`. New types are added in `src/structures.js`.

To request a build, give the coordinates and what to build, e.g.
"build a lighthouse at 41.2S, 138.0W facing east". Coordinates come straight
from the Position panel or from clicking the globe.

## Worlds

- Terrain is generated from a **seed** (continents, mountain ranges, climate
  bands, and seas come from seeded 3D noise). The same seed always gives the
  same planet, so a world file is just a seed plus a list of structures.
- **New world** starts a blank planet with a fresh (or chosen) seed, stored in
  the browser. **Load** switches between published and local worlds.
  **Import** loads an exported JSON file.
- To publish a local world, export it and add the file under `public/worlds/`.

Coordinates: latitude −90…90 (north positive), longitude −180…180 (east
positive). One degree is about 175 m on this planet (radius 10 km), and the
tallest peaks are around 320 m.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
```

Deployment: `.github/workflows/deploy.yml` builds on every push to `main` and
publishes `dist/` with GitHub Pages. In the repository settings, Pages must have
its source set to **GitHub Actions** (the workflow attempts to enable this
itself on first run).

Self-hosting (e.g. Coolify): the `Dockerfile` builds the site and serves
`dist/` with nginx on port 80. In Coolify, add a resource from this public
repository, pick the **Dockerfile** build pack, and set the exposed port to 80.
