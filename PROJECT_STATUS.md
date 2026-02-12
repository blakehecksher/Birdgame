# Hawk & Pigeon - Development Status

**Project Started:** February 6, 2025
**Last Updated:** February 12, 2026

## Project Overview

Building a web-based 3D multiplayer chase game where two players compete as a pigeon (trying to eat and survive) and a hawk (trying to hunt). Built with Three.js and WebRTC peer-to-peer networking.

**Tech Stack:**
- Three.js (3D rendering)
- TypeScript (type-safe development)
- Vite (build tool)
- PeerJS (WebRTC wrapper)

---

## Development Timeline

### Completed Phase 1.1: Foundation (Feb 6, 2025)

**Goal:** Basic 3D scene with one controllable bird

**Completed Features:**
- Vite + TypeScript project setup
- Three.js scene with lighting and ground plane
- Low-poly bird model (cone body + sphere head)
- Arcade-style flight controls (WASD + Space/Shift + Mouse)
- Third-person follow camera with smooth interpolation
- Input system with pointer lock

**Validation:** Single bird flies smoothly in 3D space with camera following

---

### Completed Phase 1.2: Networking (Feb 6, 2025)

**Goal:** Real-time multiplayer with two players seeing each other's movement

**Completed Features:**
- PeerJS WebRTC connection (peer-to-peer)
- Host/Join lobby system
- Network message protocol (TypeScript interfaces)
- State synchronization at 20Hz
- Authoritative host architecture
- Input lag compensation
- Two birds flying simultaneously

**Validation:** Two players connect and see each other flying in real-time

---

### Completed Phase 1.3: Collision and Round System (Feb 6, 2025)

**Goal:** Hawk touching pigeon ends round, with scoring and role swapping

**Completed Features:**
- Sphere-sphere collision detection
- Player vs player collision (hawk catches pigeon)
- Round end logic with score calculation
- Score display UI (round end screen)
- Role swapping between rounds
- Bird color updates when roles swap
- Network-coordinated round resets

**Validation:** Collision triggers round end, roles swap, positions sync correctly

---

### Completed Phase 1.4: Food System (Feb 7, 2026 - Codex)

**Goal:** Pigeon eats food, gains weight, slows down; visual growth. Hawk drains energy and eats rats.

**Completed Features:**
- Food entity with multiple types (crumbs, bagels, pizza, rats)
- Food spawning/respawn manager
- Food collision detection
- Network sync for food pickup (FOOD_COLLECTED)
- Pigeon weight system (speed penalty + mesh scaling)
- Hawk energy system (drain + speed modifiers)

**Files Added:**
- `src/entities/Pigeon.ts` - Pigeon weight logic
- `src/entities/Hawk.ts` - Hawk energy logic
- `src/world/FoodSpawner.ts` - Food spawn/respawn management

---

### Completed Phase 1.5: City Environment (Feb 7, 2026)

**Goal:** 2x2 block city with buildings and small park

**Completed Features:**
- Building class with AABB collision bounds and push-out resolution
- Window overlays on buildings (front/back faces)
- 2x2 city block grid (4 quadrants, 3 buildings each = 12 buildings)
- Central park (50x50) with 10 trees and 4 benches
- Street markings (yellow center lines) and sidewalk edges
- Building collision for both local and remote players
- Food repositioned to park and street areas (not inside buildings)
- Ground expanded to 200x200

**Files Added:**
- `src/world/Building.ts` - Building geometry + AABB collision
- `src/world/Environment.ts` - City generator (blocks, park, streets)

**Files Updated:**
- `src/core/Game.ts` - Environment integration, collision for both players
- `src/world/FoodSpawner.ts` - Repositioned food to park/street areas
- `src/config/constants.ts` - Expanded GROUND_SIZE to 200

---

### Completed Phase 1.6: Hawk Energy System (Feb 7, 2026 - Codex)

**Goal:** Hawk drains energy over time, eats rats to replenish

**Completed Features:**
- Energy property with configurable drain rate
- Speed penalties: <25 energy = 0.8x speed, >75 energy = 1.2x boost
- Rat food type (6 spawns on streets)
- Hawk-rat collision and eating mechanic
- Energy gain from eating rats (+15 per rat)
- Eating animation (locked in place during eat time)

---

### Completed Phase 1.7: Scoring & Polish (Feb 7, 2026)

**Goal:** Full game loop with HUD, scoring, and round management

**Completed Features:**
- Round timer win condition: 3-minute countdown, pigeon survives = pigeon wins
- ROUND_END network message for timer expiry
- Cumulative scoring across rounds (pigeon totalWeight, hawk killTimes)
- Instructions overlay on first game start (controls reference)
- HUD polish: energy/weight progress bars, eating indicator
- Crosshair overlay during gameplay
- Visual feedback for pigeon weight (bar fills as weight increases)
- Visual feedback for hawk energy (gradient bar red->yellow->green)

**Files Updated:**
- `src/core/Game.ts` - Timer check, endRoundPigeonSurvived, handleRoundEnd, HUD bars
- `src/network/NetworkManager.ts` - sendRoundEnd, onRoundEnd
- `index.html` - Instructions overlay, crosshair, HUD bars, eating indicator

---

### Multiplayer Stability Hardening (Feb 7, 2026 - Codex)

**Primary Issue:** Persistent host/client world divergence after multiple rounds ("players in different worlds").

**Architecture Changes Implemented:**
- Deterministic environment generation across peers (building heights/colors, tree size/colors) to eliminate collision-world mismatch.
- Reliable input transport for mouse deltas (accumulate per-frame, send per-network-tick, consume once on host).
- Host-authoritative ROUND_START spawn payload (`spawnStates`) so both peers reset to exactly the same transforms.
- Client-side local reconciliation reintroduced with tuned thresholds:
  - Soft correction for moderate error
  - Hard snap for large error
  - Stale-snapshot guard
- Frame-rate independent drag in flight physics to reduce FPS-based divergence.
- Input/state reset at round boundaries to prevent stale carryover.

**Result:** Multiplayer position/state sync now appears stable in repeated playtests.

---

### Post-MVP Bug Fixes and Tuning (Feb 7, 2026 - Codex)

**Fixed:**
- Hawk energy now drains correctly across round starts and role swaps.
- Pigeon size no longer carries over when switching to hawk role.
- Hawk now slows significantly in tree canopies; pigeon remains unaffected.
- Rat eating confirmed working in playtests.

**Tuning Applied:**
- Movement speed baseline increased by ~4x:
  - `PIGEON_BASE_SPEED`: `1.0 -> 4.0`
  - `HAWK_BASE_SPEED`: `2.5 -> 10.0`

---

## Overall Progress

**Total Phases:** 7 (1.1 through 1.7)
**Completed:** 7/7 phases - Phase 1 MVP Complete!
**Status:** Stabilized and ready to hand back to Claude for Phase 2 development.

---

## Testing Checklist

- [x] Single player flies smoothly with responsive controls
- [x] Two players connect via PeerJS successfully
- [x] Both players see each other's movement in real-time
- [x] Hawk collision with pigeon ends round
- [x] Scores display at round end
- [x] Roles swap after round
- [x] New round starts with reset states (weight=1, energy=100)
- [x] Birds stay in sync during gameplay
- [x] Birds face forward correctly
- [x] Pigeon collects food and gains weight
- [x] Pigeon speed decreases as weight increases
- [x] Pigeon visually scales up with weight
- [x] Hawk energy drains over time
- [x] Hawk eating rats restores energy
- [x] Buildings block player movement
- [x] Round timer counts down and pigeon wins at 0
- [x] Instructions overlay shows and dismisses

---

## Architecture Decisions
- Authoritative host runs game logic, client sends input only
- Client-side local reconciliation against host-authoritative snapshots (soft/hard correction)
- Custom message types with TypeScript interfaces
- State sync at 20Hz
- Deterministic world generation to keep collision geometry identical on both peers
- Collision is manual AABB/sphere (no physics engine for MVP)

---

## Claude Handoff Notes

1. Phase 1 is functionally complete and sync-stable after architecture hardening.
2. If multiplayer drift resurfaces, inspect first:
   - `src/network/NetworkManager.ts` input accumulation/consumption path
   - `src/core/Game.ts` reconciliation thresholds and round-start spawn handling
   - `src/world/Environment.ts` deterministic generation assumptions
3. Recommended next workstream: begin Phase 2 content/polish (audio, camera collision, advanced hawk mechanics, richer prey/AI).

---

### Phase 2 Progress (Feb 7, 2026)

**Completed:**
- Camera collision — raycasts from player to camera, pulls camera forward if building in the way (CameraController.ts)
- Hawk dive attack — pitch down + downward velocity = dive mode, up to 2x speed bonus proportional to steepness, 2.5x energy drain (Hawk.ts, constants.ts)
- Dive indicator — red "DIVING" HUD element when hawk is diving (index.html, Game.ts)

**In Progress:**
- Networking improvements (room codes, deployment, connection stability)

---

### Session Log (Feb 7, 2026 - Codex)

**Focus:** Friend-share networking flow, deployment hardening, and lobby UX polish.

**Completed Networking/Deployment Work:**
- Added shareable room-code flow with URL auto-join (`?room=CODE`).
- Added reconnect/disconnect UX (connection state indicator + disconnect overlay).
- Added join/host recovery handling so failed joins do not leave controls stuck.
- Fixed room-link join bug caused by case-sensitive room-code prefix handling.
- Set up GitHub Pages deployment pipeline (`vite` base path + deploy script).
- Verified deployment approach and documented publish flow in `DEPLOYMENT.md`.

**Completed UI/Lobby Work:**
- Integrated `assets/Landing Page.png` into lobby.
- Refined lobby composition to a single container with two distinct visual sections:
  - Top hero image section
  - Bottom lobby control band
- Removed overlaid lobby title text from the hero image and moved subtitle into the lower band.

**Technical Notes / Decisions:**
- `main` remains source-of-truth for code; deployed site is built output.
- `npm run deploy` publishes the production build to GitHub Pages (separate from normal code push).
- Keep networking join codes normalized to one canonical peer-id format to avoid silent connect failures.

**Handoff Status:**
- Multiplayer state sync is stable in playtests.
- Room-link join flow is functional after normalization fix.
- Lobby visual direction is now aligned with current design sketch.

---

### Session Log (Feb 8, 2026 - Codex, Post-Claude Takeover)

**Focus:** Flight feel overhaul, control simplification, role-specific tuning, and hitbox/visual-size consistency.

**Movement + Controls (implemented):**
- Reworked flight to airplane-style inputs:
  - `Mouse Y` controls pitch only
  - `A/D` control roll (bank) only
  - `W` provides forward thrust only
  - No direct yaw input from mouse; yaw comes from bank-turn coupling
  - Removed backward thrust (`S`) from active movement mapping
- Added explicit quaternion attitude composition in `Player.applyMeshRotation()` to separate yaw/pitch/roll cleanly and avoid Euler-order artifacts.
- Added flight attitude indicator (center circle + moving dot) and aligned indicator direction with actual pitch behavior.
- Added scroll-wheel camera zoom support.

**Role-Specific Flight Tuning (implemented):**
- Split pigeon/hawk pitch and bank tuning into independent constants:
  - Pitch sensitivity and max pitch per role
  - Bank acceleration, spring stiffness, damping, and max bank angle per role
  - Existing per-role bank-turn coupling retained
- Updated flight system to use role-specific values at runtime.
- Reorganized `src/config/constants.ts` so `PIGEON_*` and `HAWK_*` parameters are grouped for easier tuning.

**Collision/Size Consistency (implemented):**
- Added `Player.setVisualScale(scale)` as the single scale path.
- Collision radius now scales with visual scale (`radius = baseRadius * scale`).
- Pigeon growth now updates both mesh size and collision radius together.
- Role resets now restore both scale and radius together.

**Networking/Deployment Follow-through (completed during takeover window):**
- Fixed room-link join normalization edge case (case-insensitive prefix handling) that could cause failed joins.
- Confirmed/maintained GitHub Pages deployment workflow and documented `deploy` vs `commit/push` behavior.

**Validation:**
- Type checks pass (`npx tsc --noEmit`) after the above changes.
- Build/deploy command in this sandbox remains blocked by `spawn EPERM` environment limitation (not a TypeScript/code regression).

---

### 3D Model Integration (Feb 8, 2026 - Claude)

**Focus:** Replace procedural bird meshes with GLB 3D models.

**Completed:**
- Created `ModelLoader` utility (`src/utils/ModelLoader.ts`) — preloads GLB files via `GLTFLoader`, caches and clones on demand
- Updated `Player.ts` — constructor accepts optional `THREE.Group` model, added `swapModel()` for role-swap mesh replacement, per-instance `modelOffsetQ` (identity for GLB, +90° Y for procedural fallback)
- Updated `Game.ts` — async `startGame()` preloads models before player creation, replaced `updateBirdColor()` with `swapPlayerModel()` using model swap
- Added `src/vite-env.d.ts` for Vite type declarations
- Copied models to `public/models/hawk.glb` and `public/models/pigeon.glb`

**Files created:** `src/utils/ModelLoader.ts`, `src/vite-env.d.ts`, `public/models/hawk.glb`, `public/models/pigeon.glb`
**Files modified:** `src/entities/Player.ts`, `src/core/Game.ts`

---

## Phase 3: Expanded World, NPC AI & Model Infrastructure

### Overview

Scale the game world from a 2x2 block city to a **10x10 randomly generated grid (~300x300 game units)**, add **NPC pigeons and rats** with simple AI as hawk food sources, and build infrastructure for loading GLB models for all game objects.

### Confirmed Design Decisions
- **Map scale:** ~300x300 game units (1 foot ≈ 0.3 units). `GROUND_SIZE: 400`.
- **Map persistence:** Generated once per match from a shared seed. Same layout for all rounds.
- **NPC coexistence:** Static food (crumbs, bagels, pizza, rats) stays for pigeon/hawk. NPC pigeons + NPC rats added as new hawk food alongside existing items.

---

### 3A. Seeded Random World Generation

**Problem:** Current city is hardcoded 2x2 blocks. Need random layouts that are identical on both peers.

**Solution:** Deterministic PRNG seeded from a shared `worldSeed`.

**Implementation:**
- New `src/utils/SeededRandom.ts` — mulberry32 PRNG with `next()`, `nextInt(min,max)`, `nextFloat(min,max)`, `pick(array)` methods
- Host generates `worldSeed` (random integer) at match start
- Seed sent to client via `GameStartMessage` (add `worldSeed: number` field to `messages.ts`)
- `Environment.ts` accepts seed, uses PRNG for all random decisions
- Both peers generate identical worlds without transmitting full map data

**Files:** `src/utils/SeededRandom.ts` (NEW), `src/network/messages.ts` (UPDATE), `src/core/Game.ts` (UPDATE)

---

### 3B. 10x10 Grid City Layout

**Grid parameters:**
- 10x10 cells, each ~27 game units
- Street width: ~3 units between cells
- Total grid: 10×27 + 11×3 = 303 units
- `GROUND_SIZE: 400` (buffer around city edge)

**Cell assignment algorithm (seeded random):**
1. Create 10x10 grid of cells
2. Each cell randomly assigned BUILDING (~40%) or PARK (~60%)
3. Edge row/column cells forced to PARK (open perimeter for flying)
4. Constraint: no isolated building cells (must have at least one park neighbor)
5. Streets run between every row and column of cells

**Building cells:**
- 1-2 buildings per cell
- Height: 10.5–35 game units (3–10 stories × 3.5 units/story)
- Random footprint within cell bounds
- AABB collision, window overlays, deterministic color from PRNG

**Park cells:**
- 2-5 trees (random position within cell, trunk + canopy)
- 0-2 benches (random position)
- 1-3 lampposts (random position, new simple geometry)
- Green ground plane per cell

**Files:** `src/world/Environment.ts` (MAJOR REWRITE), `src/world/Building.ts` (UPDATE), `src/config/constants.ts` (UPDATE), `src/world/FoodSpawner.ts` (UPDATE — scatter food across park/street cells)

**New constants:**
```
GROUND_SIZE: 400          GRID_SIZE: 10
CELL_SIZE: 27             STREET_WIDTH: 3
BUILDING_MIN_HEIGHT: 10.5 BUILDING_MAX_HEIGHT: 35
BUILDING_CHANCE: 0.4      (40% of non-edge cells)
```

---

### 3C. NPC Entity System

**NPC Pigeons (10):**
- Spawn in random park cells
- AI state machine: IDLE (pecking, 2-4s) → WALKING (wander 2-4 units, 1-2s) → IDLE → repeat
- Flee from hawk when within 15 units (run away for 3s then resume normal behavior)
- Ground-level only (Y=0.3)
- Hawk catches them for +8 energy
- Respawn after 45s at a random park cell

**NPC Rats (10):**
- Spawn on street segments between cells
- AI state machine: IDLE (1-3s) → SCURRY (fast burst 4-8 units along street, 0.5-1s) → IDLE → repeat
- Flee from hawk when within 10 units
- Ground-level only (Y=0.3)
- Hawk catches them for +15 energy
- Respawn after 30s at a random street location

**Architecture:**
- `src/entities/NPC.ts` — NPC entity with state machine (IDLE, WALKING/SCURRYING, FLEEING)
- `src/world/NPCSpawner.ts` — manages NPC lifecycle: spawn, AI tick (host only), respawn
- **Host-authoritative:** AI logic runs on host only. NPC positions synced to client via `STATE_SYNC` message (add `npcs` array). Client receives positions and renders meshes, no AI on client.
- NPC collision with hawk checked same way as food collision (sphere-sphere)
- New `NPC_KILLED` network event message (like `FOOD_COLLECTED`)

**Files:** `src/entities/NPC.ts` (NEW), `src/world/NPCSpawner.ts` (NEW), `src/network/messages.ts` (UPDATE), `src/network/NetworkManager.ts` (UPDATE), `src/core/Game.ts` (UPDATE), `src/core/GameState.ts` (UPDATE), `src/physics/CollisionDetector.ts` (UPDATE)

**New constants:**
```
NPC_PIGEON_COUNT: 10       NPC_RAT_COUNT: 10
NPC_PIGEON_ENERGY: 8       NPC_RAT_ENERGY: 15
NPC_PIGEON_RESPAWN: 45     NPC_RAT_RESPAWN: 30
NPC_PIGEON_FLEE_RANGE: 15  NPC_RAT_FLEE_RANGE: 10
NPC_PIGEON_SPEED: 2.0      NPC_RAT_SPEED: 4.0
NPC_PIGEON_EAT_TIME: 1.5   NPC_RAT_EAT_TIME: 2.0
```

---

### 3D. Model Loading Infrastructure

**Goal:** Prepare the project to load GLB models for all game objects — not just birds.

**Expanded `public/models/` structure:**
```
public/models/
  birds/
    hawk.glb              ← (existing, move from models/)
    pigeon.glb            ← (existing, move from models/)
  food/
    bagel.glb             (future — user will provide)
    pizza.glb             (future)
    breadcrumb.glb        (future)
    rat.glb               (future)
  environment/
    tree.glb              (future)
    bench.glb             (future)
    lamppost.glb          (future)
  npcs/
    npc_pigeon.glb        (future)
    npc_rat.glb           (future)
```

**ModelLoader expansion (`src/utils/ModelLoader.ts`):**
- `preload(manifest: string[])` — load a list of model paths
- `get(key: string): THREE.Group | null` — get cached clone by key
- Graceful fallback: all entities accept optional model, use procedural geometry when GLB not available
- Models loaded during lobby/loading screen before game starts

**Entity updates:** `Food.ts`, `NPC.ts`, `Building.ts` — all accept optional `THREE.Group` model parameter, fallback to procedural mesh.

---

### Implementation Order

**Session A — Seeded Random + Map Expansion:**
1. Create `SeededRandom.ts`
2. Add `worldSeed` to `GameStartMessage`
3. Rewrite `Environment.ts` for 10x10 seeded grid
4. Update `constants.ts` with new map dimensions
5. Update `Building.ts` for PRNG-driven sizing
6. Update `FoodSpawner.ts` for grid-aware food placement
7. Update `Game.ts` to pass seed to Environment
8. Verify: `npx tsc --noEmit`, multiplayer test for identical worlds

**Session B — NPC AI System:**
1. Create `NPC.ts` with IDLE/WALKING/FLEEING state machine
2. Create `NPCSpawner.ts` lifecycle manager
3. Add NPC network messages (NPC_KILLED, npcs in STATE_SYNC)
4. Update NetworkManager, GameState for NPC sync
5. Integrate into Game.ts (host AI tick, hawk collision, client rendering)
6. Verify: NPCs move, hawk catches them, energy works

**Session C — Model Infrastructure Expansion:**
1. Reorganize `public/models/` directory
2. Expand `ModelLoader.ts` with manifest-based loading
3. Update `Food.ts`, `NPC.ts` to accept optional GLB models
4. Add procedural fallbacks for all entities
5. Verify: models load when present, fallback when not

---

### Session A Complete (Feb 8, 2026 - Codex + Claude)

**Status:** Complete

**Summary of what was done:**
- Added deterministic seeded world generation infrastructure (`SeededRandom`) and rewrote environment to 10x10 grid generation.
- Expanded map architecture to large-city scale constants (`GROUND_SIZE`, `GRID_SIZE`, `CELL_SIZE`, `STREET_WIDTH`).
- Implemented seeded `Environment(scene, seed)` generation with:
  - building/park cell assignment
  - deterministic tree/bench placement
  - exported `parkCells` and `streetCenters` for spawning systems
- Updated `FoodSpawner` to distribute food from map data instead of hardcoded positions.
- Integrated world seed derivation in `Game.ts` from host peer ID (deterministic across peers, no extra seed message required).
- Updated game startup and round reset spawn logic to use expanded map street-based spawn positions.
- Type checks pass (`npx tsc --noEmit`).

---

### Session B Progress (Feb 8, 2026 - Codex)

**Status:** In progress (core architecture wired)

**Completed this pass:**
- Added NPC gameplay constants to `GAME_CONFIG` (counts, flee ranges, speed, rewards, respawn, collision radius, eat times).
- Upgraded `NPC.ts` with role-specific config usage, collision radius, reward/eat/respawn helpers, and seeded-random-capable behavior.
- Upgraded `NPCSpawner.ts` with config-based behavior and snapshot helpers (`getNPC`, `getSnapshots`, `applySnapshots`).
- Extended network protocol:
  - Added `NPC_KILLED` event message
  - Added `npcs` payload to `STATE_SYNC`
- Extended `GameState` with authoritative NPC state map and snapshot replace method.
- Extended `NetworkManager` to sync NPC snapshots and handle/send `NPC_KILLED`.
- Integrated NPC lifecycle into `Game.ts`:
  - spawn + host AI update
  - host hawk-vs-NPC collision checks
  - NPC state sync host->client
  - client-side NPC snapshot application
  - client handling of `NPC_KILLED` for immediate eat/energy feedback
  - round reset + cleanup integration
- Type checks pass after integration.

**Remaining Session B validation work:**
- Playtest host/client NPC behavior end-to-end in browser (movement, flee, kill, respawn timing).
- Tune NPC movement values after first gameplay pass.

---

### Session B Update (Feb 8, 2026 - Codex)

**Status:** Implemented prey reward + composition update

**Completed:**
- Increased hawk energy rewards from NPC prey to make hunting more meaningful:
  - `NPC_PIGEON_ENERGY: 25`
  - `NPC_RAT_ENERGY: 35`
- Removed static floating rat food spawns from `FoodSpawner` so hawk ground prey now comes from moving NPCs only.
- Added squirrel NPC prey:
  - New type: `NPC_SQUIRREL`
  - Brown fallback model, larger collision radius, park-cell spawning, scurrying/flee behavior
  - Configured with dedicated constants for count, speed, flee range, eat time, respawn, and energy reward (`NPC_SQUIRREL_ENERGY: 50`)
- Updated client-side `NPC_KILLED` handling in `Game.ts` so squirrel eat-time/energy reward is applied correctly for non-host views too.

**Validation:**
- Type checks pass (`npx tsc --noEmit`).

---

### Session C Progress (Feb 8, 2026 - Codex)

**Status:** Complete for current gameplay pass (future polish/model drops still open)

**Completed this pass:**
- Expanded model-loading infrastructure in `src/utils/ModelLoader.ts`:
  - Added manifest-based preloading (`preloadModelManifest`)
  - Added key-based retrieval (`getModelByKey`)
  - Added optional model entries for food/NPC/environment placeholders (fallback-safe if files are missing)
- Updated entities for model-first architecture with fallback support:
  - `src/entities/Food.ts` now accepts optional GLB model and falls back to procedural meshes
  - `src/world/Building.ts` now accepts optional model and falls back to procedural building + windows
- Updated world integration to consume optional model keys where available:
  - `src/world/Environment.ts` now requests optional building model via model key
  - `src/world/NPCSpawner.ts` now requests optional NPC model keys for pigeon/rat/squirrel

**Gameplay requests implemented in this same pass:**
- NPC pigeons now fly in the air with swooping/sweeping motion (host-authoritative):
  - airborne spawn altitude
  - curved heading turns
  - sinusoidal altitude profile
- Squirrels are now predominantly tree-canopy spawns (configurable tree bias) with canopy-biased movement.
- Added rooftop food distribution:
  - rooftop bagels and pizza as high-value/high-risk pickups
  - minimal rooftop crumbs
  - supports "reward for flying higher" loop
- User playtest sign-off: NPC pigeons, squirrels, and rooftop food are considered complete for now.

**Validation:**
- Type checks pass (`npx tsc --noEmit`).

---

### Session C Hotfix (Feb 8, 2026 - Codex)

**Issue:**
- In round 2 after role swap, player 2 (new local pigeon) could lose their own pigeon model render on that client, while still rendering correctly on player 1.

**Root cause:**
- Role-swap model replacement was disposing mesh geometry/material resources from GLB clones.
- Clones were shallow and shared underlying cached resources, so disposing one model could invalidate another live model instance.

**Fix:**
- Mark cache-derived model roots in `ModelLoader` (`fromModelCache`).
- In `Player.swapModel()` and `Player.dispose()`, skip disposal for cache-derived models to avoid freeing shared resources during round transitions.

**Validation:**
- Re-tested role swap across rounds in two windows; local pigeon model now renders correctly after swap.
- Type checks pass (`npx tsc --noEmit`).

---

### Session C + Leaderboard Update (Feb 8, 2026 - Codex)

**Completed:**
- Added anonymous, no-account leaderboard integration (Supabase REST + anon key):
  - `fattest_pigeon` (highest value)
  - `fastest_hawk_kill` (lowest time)
- Added lobby username input (free-form arcade name, stored locally).
- Added lobby leaderboard panel with top results for both metrics.
- Submission behavior:
  - each client submits only its own local role result at round end
  - host/client duplication avoided without requiring account identity
- Added host-screen inline `Copy Code` button.
- Added arrow-key pitch support (`ArrowUp/ArrowDown`) in addition to mouse pitch.
- Reduced reticle visual prominence (thinner/lower-contrast indicator).

**Docs:**
- Added `.env.example` for Supabase client config.
- Added README section with one-time SQL table/RLS setup and key-safety notes.

---

## Future Feature Plans

### Wing Flapping Animation (designed, not yet implemented)

Replace static wing meshes with **pivot groups** for animated flapping:
- Wrap each wing in a `THREE.Group` pivot at the shoulder joint
- `animateWings(deltaTime)` method with sine wave oscillation
- Flap frequency scales with movement speed (faster flight = faster flapping)
- Wings fold during eating (static angle, no flapping)
- Hawk dive: wings sweep back with minimal oscillation
- Hawk gets 1.25x larger wingspan than pigeon
- Purely visual — no network changes needed (driven by already-synced velocity)

**Files to modify:** Player.ts, Hawk.ts, constants.ts, Game.ts (minor)

### Art Direction (target style, not yet implemented)

Low-poly cartoon style matching `assets/Landing Page.png` — fat rounded pigeon body, stylized hawk with spread wings, warm color palette (oranges, purples, yellows), soft rounded building geometry. Characters should feel chunky and expressive, not realistic. The pigeon should look comically round and greedy; the hawk should look sleek and menacing with extended wingspan.

---

## Known Limitations
1. ~~Camera can clip through buildings~~ — FIXED (Phase 2)
2. No audio (future)
3. ~~Simple bird models~~ — GLB models integrated (Feb 8, 2026)
4. ~~No AI prey~~ - basic AI prey is implemented (advanced behavior/model polish pending)
5. ~~Limited map (2x2 blocks)~~ — Phase 3 expansion to 10x10 grid (see above)
6. ~~No dive attack for hawk~~ — FIXED (Phase 2)
7. No leaderboard (future)

---

## Line In The Sand Snapshot (Feb 12, 2026)

This section is the current baseline reference for future work.

**Multiplayer NPC smoothing (non-host quality):**
- Client NPCs no longer hard-snap every snapshot.
- NPC snapshots now set movement targets, and client visuals lerp each frame toward those targets.
- Added `NPCSpawner.updateVisuals(deltaTime)` and wired it into the client game loop.
- Host AI/authority model is unchanged (host still drives true NPC simulation).

**Player collision shape overhaul:**
- Replaced shared sphere-only player hitbox tuning with per-role ellipsoid dimensions:
  - `PIGEON_COLLISION_RX/RY/RZ`
  - `HAWK_COLLISION_RX/RY/RZ`
- Added transparent/wireframe collision debug shells on birds (`SHOW_COLLISION_DEBUG`) for live tuning.
- Pigeon growth scaling now scales ellipsoid collision extents correctly.
- Hawk-vs-pigeon collision now uses ellipsoid distance check (axis-scaled overlap test).

**Ground contact alignment fix:**
- Minimum flight height now uses each bird's vertical collision half-extent (`collisionRadii.y`) instead of hardcoded `y=1`.
- Result: bird body and shadow are much closer to the ground plane and match visual expectations.

**Current tuning/tradeoff notes:**
- Building and pickup checks still use `player.radius` (derived as max ellipsoid axis) for conservative/simple behavior.
- `SHOW_COLLISION_DEBUG` should be toggled off for normal play once tuning is complete.
- NPC smoothing currently favors visual continuity over strict snapshot snapping on clients.

---

## Resources

- `Birdgame Spec.md` - Full game specification
- `README.md` - Project setup and documentation
