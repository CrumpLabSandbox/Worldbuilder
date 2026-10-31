# Worldbuilder

A procedurally generated globe you can fly around, explore, and build on.
Built with [Three.js](https://threejs.org/) and Vite, and self-hosted on
Coolify from a Docker image.

The world opens behind a small see-through card. **Learn more** on it (or the
About button) opens the full About page, written for the November issue of
megaZINE. Both texts are in `index.html`.

## Exploring

**Visit place** at the top of the screen lists every place on the world; choose
one to go straight there.

A **Controls** card at the bottom of the screen lists everything; hide it
with `H` (or *hide*) and bring it back with the **? Controls** button.

| Control | Action |
| --- | --- |
| `W` / `S` or `↑` / `↓` | fly forward / back (level, whatever way you are looking) |
| `A` / `D` | strafe left / right |
| `←` / `→` | turn |
| `Space` / `C` (or `E` / `Q`) | climb / descend |
| `Shift` | 4× boost |
| drag (left or right mouse button) | look around |
| `L` or **Mouse look** | steer with the mouse without holding a button (Esc to stop) |
| scroll wheel / trackpad pinch | glide down towards the ground or back up |
| `+` / `−` or the card's speed buttons | speed multiplier |
| double-click the globe | fly there |
| click the globe | read the coordinates under the cursor (copied to clipboard) |
| `G` | toggle lat/lon grid |
| `B` | toggle build mode |

**Touchscreen (iPhone etc.):** touch and slide anywhere on the left of the
screen and a thumbstick appears under your thumb to fly. Drag on the right to
look around. Slide the lever (bottom right) up or down to climb or descend,
and ⚡ toggles boost. Pinch to zoom your altitude in or out, double-tap the
ground to fly there, and tap it to read its coordinates. The ☰ button opens
the world and build panel, **?** shows the controls again, and *more* on the
position panel expands it. Starting and stopping are eased, so you glide
rather than jolt.

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

- `computer` — the MEGAzine BBS terminal: a colossal beige 486 (about 165 m
  tall) with a CRT monitor, keyboard, mouse and a floppy disk, on a levelled
  plateau (`pad`, `band` and `raise` as for the catapult). Its screen loops a
  DOS boot, a Telix dial-up and the board's banner. Near it a **📞 Dial in**
  button appears (clicking the screen works too): the camera glides up to the
  monitor and the real BBS at `url` (default
  https://samuelling.github.io/BBS/) opens lined up with the glass, or full
  screen on small displays. **Hang up** or Esc returns you to flying. Logins
  inside the game are kept separately from visiting the BBS directly.
  **⌨️ Type** sits you at the keyboard instead: giant skeletal hands from
  [CognitiveHands](https://github.com/CrumpLabSandbox/CognitiveHands)
  (kinematic hands and motor layer, copied into `src/hands/`, no cognitive
  model) type whatever you type, onto a little MEGA-DOS prompt on the screen
  (try `help`, `dir`, `ver`). On a phone the on-screen keyboard opens.
  Keystrokes typed into the BBS itself can't reach the game, as browsers keep
  another site's frame private, so the hands don't type there yet.

- `organstage` — the ThingSynth stage: a giant organ on a round platform, with
  *Golden Pyramid With Tunnel Celebration* on a stepped temple across a long
  causeway (`pad`, `band`, `raise`, and `heading` is the way the organist
  looks). Near it, **🎹 Play the organ** seats you in the Mirror Sea, a sunset
  scene with the temple reflected in the water that shows only while seated.
  The 17 keys are ThingSynth's playable computer keys (A S D F G H J K L ; and
  W E T Y U O P), and the cognitive hands play and hold them. Touch screens get
  an on-screen keyboard with chords, sliding and octave buttons. ThingSynth runs
  as its own page (a built copy in `public/thingsynth`) laid over the painting.

- `university` — the Walking University: a campus on six jointed legs (`pad`,
  `band`, `raise`, `url`, and `heading` is the way it walks). Click it, or use
  **🎓 Enter the University**, and it gets up and walks; the world gives way to
  salt flats and you fly in through a lit tower window to the Chair's office,
  where the game at `url` (ChairQuest) lies on the desk. The office is really on
  the moving tower, so its window shows the campus. The game stays loaded for
  the visit, so you can leave and come back to it.

Records with `"issue": "november"` are listed first in **Visit place**.
`public/issues/november.json` lists every piece in the November issue and the
place it has here, if any.

Press **U** for photo mode, which hides the interface.

Available types: `house`, `hut`, `village`, `town`, `city`, `tower`, `castle`,
`lighthouse`, `windmill`, `temple`, `pyramid`, `obelisk`, `dome`, `tree`,
`forest`, `farm`, `beacon`, `flag`, `wall`, `bridge`, `ship`, `monolith`,
`arch`, `statue`, `dinosaur`, `volcano`, `woodland`, `road`, `coaster`, `catapult`, `graffiti`, `mushroomtree`, `computer`. New types are added in `src/structures.js`.

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

## Building with Claude

Press **T** (or the **💬 Ask Claude to build** button) to chat with Claude.
Click or tap the globe to pick a spot, then describe what you want, e.g.
"build a harbour town with a lighthouse here". Claude checks the terrain,
looks at what is already nearby, and places structures from the list above.
What it builds is saved on the server and shows up for everyone in that world
within a few seconds. It can also move or remove things it built, but not the
published structures in `public/worlds`.

When nothing in the list fits (a bear, a car, a giant telephone, pixel art),
Claude designs a **blueprint**: its own structure made of basic shapes (box,
sphere, dome, cylinder, cone, pyramid, ring and wedge, each with a position,
size, rotation, colour and optional glow) and/or a voxel grid of coloured
cubes. Blueprints are data, checked against limits on the server (600 shapes,
8000 voxels, 500 m reach, 900 m height; see `src/blueprintSpec.js`), and drawn
with one instanced mesh per shape. Interactive things such as rides still need
code.

Only the shared worlds from `public/worlds` take part. Your own *Build mode*
edits and local worlds stay in your browser.

## Development

```sh
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY to try the chat
npm run server         # API + shared world on :3000 (restarts on changes)
npm run dev            # game with hot reload on :5173, /api proxied to :3000
npm run build          # production build in dist/
```

Without `ANTHROPIC_API_KEY` everything works except the chat, which hides
itself.

The server (`server/`) is a small Express app:

- `GET /api/worlds/:id/edits` returns the shared edits for a world.
- `POST /api/chat` runs a chat turn with Claude (tool use; the tools only
  create validated structure records, never code).
- Shared edits are stored as JSON in `DATA_DIR` (default `./data`), with a log
  of every chat request and what it built in `chat-log.jsonl`.

Settings (environment variables): `ANTHROPIC_API_KEY`, `PORT` (3000 locally, 80 in Docker),
`DATA_DIR`, `CLAUDE_MODEL` (`claude-opus-5-5`), `CLAUDE_EFFORT` (`medium`),
`CHAT_LIMIT_PER_HOUR` (30 per visitor) and `CHAT_LIMIT_PER_DAY` (500 for the
whole site). Requests use the API's server-side refusal fallback.

## Deployment

The app runs on Coolify from the `Dockerfile` (it is no longer published to
GitHub Pages). The image builds the game and runs the Node server on port 80.
In Coolify:

1. Use the **Dockerfile** build pack with port **80**.
2. Add a persistent **volume** mounted at `/app/data`, so shared builds survive
   redeploys.
3. Add `ANTHROPIC_API_KEY` as a runtime environment variable (not a build
   variable) and mark it secret.
4. Press **Redeploy** after pushing to `main`.
