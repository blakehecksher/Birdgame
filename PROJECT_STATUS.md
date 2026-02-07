# Hawk & Pigeon - Development Status

**Project Started:** February 6, 2025
**Last Updated:** February 7, 2026

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
- [ ] Pigeon collects food and gains weight (needs playtest)
- [ ] Pigeon speed decreases as weight increases (needs playtest)
- [ ] Pigeon visually scales up with weight (needs playtest)
- [x] Hawk energy drains over time
- [x] Hawk eating rats restores energy
- [x] Buildings block player movement
- [ ] Round timer counts down and pigeon wins at 0 (needs playtest)
- [ ] Instructions overlay shows and dismisses (needs playtest)

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

### AI Prey Animals (designed, not yet implemented)

Replace static rat food items with moving AI animals:
- **AI Rats** (6): scurry along streets in short bursts, pause, repeat. Flee from hawk.
- **NPC Pigeons** (4): wander in central park, peck at ground. Flee from hawk.
- Simple state machine: IDLE → WALKING → FLEEING
- Ground-level only, simple building collision avoidance (rotate 90° on AABB hit)
- Hawk catches them for energy (rats: +15, pigeons: +8)
- AI runs on host, positions synced to client via existing food state pipeline
- New `NPCAnimal.ts` entity class + `NPCSpawner.ts` manager

**Files to create:** NPCAnimal.ts, NPCSpawner.ts
**Files to modify:** constants.ts, FoodSpawner.ts, GameState.ts, messages.ts, NetworkManager.ts, Game.ts

---

## Known Limitations
1. ~~Camera can clip through buildings~~ — FIXED (Phase 2)
2. No audio (future)
3. Simple bird models — wing flapping planned (see above)
4. No AI prey — designed, not yet built (see above)
5. Limited map (2x2 blocks, future expansion to 4x4)
6. ~~No dive attack for hawk~~ — FIXED (Phase 2)
7. No leaderboard (Phase 3)

---

## Resources

- `Birdgame Spec.md` - Full game specification
- `README.md` - Project setup and documentation
