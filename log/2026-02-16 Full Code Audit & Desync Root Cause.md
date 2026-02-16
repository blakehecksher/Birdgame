# Full Code Audit & Late-Join Desync Root-Cause Analysis

**Date:** 2026-02-16
**Scope:** Complete codebase review — architecture, data flow, error handling, performance, netcode. Plus root-cause trace of the "late-join desync" bug.

---

## Part 1: Late-Join Desync — Root-Cause Analysis

### Summary

When a second player joins an in-progress game, the already-connected player begins moving in ways that don't match their inputs. The root cause is a **combination of dual-simulation divergence and missing state initialization on late join**.

### Detailed Trace

#### Connection Flow (Late Join)

1. Client connects via `PeerConnection.initializeAsClient()` → PeerJS `.connect()` (`PeerConnection.ts:77`)
2. Host receives `connection` event → `Game.ts:403` `peerConnection.onConnected` callback fires
3. Since `this.isGameStarted === true`, the host takes the late-join path (`Game.ts:413-422`):
   - Adds a new `PlayerState` to `gameState.players` with role `HAWK`
   - Calls `ensureRemotePlayer()` to create a `Player` entity
   - Calls `syncRoleControllers()` to rebuild Pigeon/Hawk controller maps
4. The client's `startGame()` runs (`Game.ts:507-693`), which:
   - Preloads models and sounds
   - Creates a `NetworkManager`
   - Builds the environment from the shared seed
   - Creates a local player (as HAWK) and a remote player (host, as PIGEON)
   - Starts `gameState.startRound()` and sets `isGameStarted = true`

#### Where It Breaks: Five Contributing Causes

**Cause 1 — No ROUND_START sent to late joiner** (`Game.ts:413-422`)
When a client joins mid-round, the host never sends a `ROUND_START` message. The client calls `gameState.startRound()` inside `startGame()` (`Game.ts:687`), which sets `roundStartTime = Date.now()`. This is significantly later than the host's `roundStartTime`. The client's round timer is therefore wrong — `getRemainingTime()` returns different values on host vs client, causing the HUD timer to be wrong and the pigeon-survival win condition to be checked at different absolute times.

**Cause 2 — Dual simulation with variable deltaTime** (`Game.ts:876-878` and `Game.ts:967-968`)
Both host and client independently simulate the local player's physics every frame:
```
// Game.ts:876 (client runs this for its own player)
this.flightController.applyInput(this.localPlayer, input, deltaTime);
this.localPlayer.position.add(this.localPlayer.velocity.clone().multiplyScalar(deltaTime));
```
The host also simulates the client's player with the same `applyInput` call (`Game.ts:967`) but using the host's own `deltaTime`. Since mobile and desktop run at different frame rates (30fps vs 60fps), and `deltaTime` varies per frame, the two simulations diverge. The air resistance calculation in `FlightController.ts:157` uses `Math.pow(0.9, deltaTime * 60)`, which is frame-rate-dependent in a non-trivial way when `deltaTime` varies.

**Cause 3 — Mouse delta accumulation mismatch** (`NetworkManager.ts:172-175`, `NetworkManager.ts:305-316`)
Mouse/touch deltas are accumulated between network ticks on both sides. The client accumulates `pendingLocalMouseX += input.mouseX` every frame, then sends the sum at tick time. The host accumulates `existing.pendingMouseX += message.input.mouseX` per received message. Since network ticks are rate-limited independently on host and client (`NetworkManager.ts:319`), and the rates can differ (mobile gets 30Hz, desktop gets 45Hz per `DeviceDetector.ts`), the accumulated deltas don't necessarily represent the same time periods. Small rounding differences compound into rotation divergence over time.

**Cause 4 — Reconciliation fights client prediction** (`Game.ts:1870-1913`)
The client runs its own physics locally (client-side prediction), then the host sends back the authoritative state. The reconciliation in `reconcileLocalPlayerWithAuthority()` attempts to lerp the client toward the host state, but:
- The dead zone is 0.3 units (`constants.ts:72`) — small errors accumulate uncorrected
- The alpha is frame-rate-dependent: `Math.min(0.35, deltaTime * 15)` — a 30fps device corrects differently than 60fps
- Rotation is never reconciled (`Game.ts:1905` comment: "avoiding soft rotation reconciliation") — yaw divergence accumulates permanently

**Cause 5 — Client builds its own world independently** (`Game.ts:537-627`)
The client creates its own `Environment`, `FoodSpawner`, and `NPCSpawner` from the shared seed. While the seed is deterministic, the client's food/NPC entities are local objects — the client doesn't receive a full world snapshot on join. The first `STATE_SYNC` with food/NPC data only arrives at the next `worldSyncIntervalMs` boundary (100ms, `NetworkManager.ts:30`). During this gap, the client may see stale food that was already eaten.

### The "Already-Connected Player Moves Wrong" Symptom

The already-connected player's movement going wrong is specifically caused by **Cause 1 + syncRoleControllers**. When `syncRoleControllers()` is called at `Game.ts:420`, it rebuilds the Pigeon/Hawk controller maps for ALL players, including the already-connected player. This resets `localPigeon` and `localHawk` references. If the existing player was mid-flight with accumulated energy/weight state, the controller reconstruction can momentarily reset their `speedMultiplier` to 1.0 (via `remotePlayer.speedMultiplier = 1` at `Game.ts:1503`). The visual scale also resets to 1 (`setVisualScale(1)` at `Game.ts:1497`).

Additionally, the `getRemoteInput()` call on the host side (`NetworkManager.ts:403-429`) returns the accumulated mouse deltas for the already-connected client. If `syncRoleControllers()` is called mid-tick, the pending mouse deltas from the connected client aren't consumed in the right order relative to the controller reset, causing a momentary discontinuity in the connected player's heading.

### Recommended Fix

Send a `ROUND_START`-equivalent snapshot to late joiners that includes:
- Current `roundStartTime` and `roundNumber`
- All player positions/rotations/velocities/roles
- Full food and NPC state
- Current pigeon weight and hawk energy values

Stop calling `syncRoleControllers()` for all players when a new player joins — only set up controllers for the new player.

---

## Part 2: General Code Quality Audit

### CRITICAL

**C1. No fixed-timestep simulation — physics diverges across frame rates**
`Game.ts:700-717`, `FlightController.ts:21-184`
The game loop uses `requestAnimationFrame` with variable `deltaTime`. All physics (banking spring-damper, air resistance, velocity integration) uses this variable delta. The air resistance formula `Math.pow(0.9, deltaTime * 60)` at `FlightController.ts:157` is particularly problematic — it's a non-linear operation that gives different results when `deltaTime` is 0.033 (30fps) vs two steps of 0.0167 (60fps). This is the foundational cause of mobile ↔ desktop desync. **Fix: implement a fixed-timestep accumulator (e.g., 60Hz) in the game loop.**

**C2. Client and host both simulate physics independently with no convergence guarantee**
`Game.ts:876-878` (client local sim), `Game.ts:967-968` (host sim of remote player)
The host simulates the client player using `applyInput` with the host's `deltaTime`. The client also simulates itself with its own `deltaTime`. These are two separate integrations of the same differential equation with different step sizes — they will always diverge. The reconciliation at `Game.ts:1870-1913` cannot fix this because it only corrects position, not rotation (the comment at line 1905 explicitly says rotation is not reconciled). Heading divergence accumulates permanently. **Fix: make the host simulation authoritative and have clients only predict locally, with full state correction (including rotation) from the host.**

**C3. `getRemotePeerIds()` returns ALL connections including closed ones**
`PeerConnection.ts:249-251`
```typescript
public getRemotePeerIds(): string[] {
  return Array.from(this.connections.keys());
}
```
The `connections` map stores connections on insertion but only removes them in the `close` handler. However, `setupConnectionHandlers` at `PeerConnection.ts:93` registers handlers once. If a connection is added via `connectToHost()` at `PeerConnection.ts:164-168` during reconnection, the OLD closed connection may still be in the map alongside the new one (keyed by the same peer ID, so it gets overwritten — but there's a window where both exist). More critically, this method is used at `Game.ts:406` to count connected peers and at `Game.ts:569` to enumerate remote players. If a peer disconnects and reconnects, it may be double-counted briefly.

**C4. Round timer uses `Date.now()` — not synchronized between peers**
`GameState.ts:148-149`, `GameState.ts:181-184`
`roundStartTime` is set to `Date.now()` on each peer independently. There is no clock synchronization protocol. On late join, the client sets its own `roundStartTime`, which can be seconds behind the host's. The `ROUND_START` message includes `roundStartAt` (a future timestamp), but the initial round at game start (`Game.ts:687`) has no such synchronization. The result: the host and client disagree on when the round ends, which can cause the pigeon-survival win condition to fire at different times.

### MODERATE

**M1. No message validation — any data from peer is trusted**
`PeerConnection.ts:104-107`
```typescript
connection.on('data', (data) => {
  if (this.onMessageCallback) {
    this.onMessageCallback(data as NetworkMessage, connection.peer);
  }
});
```
Incoming data is cast to `NetworkMessage` without any validation. A malicious peer could send fabricated state. While this is a P2P game between friends, there's no schema validation, no bounds checking on input values, and no sequence numbering. Input values like `mouseX` could be set to massive numbers to teleport. The `handleInputUpdate` at `NetworkManager.ts:153-178` does clamp `pitchAxis` to [-1, 1] but doesn't clamp `mouseX`, `mouseY`, `forward`, `strafe`, or `ascend`.

**M2. State buffer sorting on every message is O(n log n) per frame**
`NetworkManager.ts:190`
```typescript
this.stateBuffer.sort((a, b) => a.timestamp - b.timestamp);
```
Every `STATE_SYNC` message triggers a full sort of the state buffer. Since messages arrive roughly in order (same network path), this could be replaced with a simple insertion at the end with a check for out-of-order. At 30-45Hz tick rate, this sort runs 30-45 times per second.

**M3. `velocity.clone().multiplyScalar(deltaTime)` allocates a new Vector3 every frame**
`Game.ts:879`, `Player.ts:132`
Both the main game loop and the remote player update allocate a new `THREE.Vector3` every frame for velocity integration. At 60fps with 2+ players, this creates 120+ temporary objects per second. Use `addScaledVector` instead: `this.position.addScaledVector(this.velocity, deltaTime)`.

**M4. `CollisionDetector.resolveAABBSphereCollision` allocates 3 Vector3s per call**
`CollisionDetector.ts:63-98`
Every building collision check allocates `center`, `delta`, and `absDelta` as new `THREE.Vector3` instances. With multiple buildings checked per frame per player, this creates significant GC pressure. Pre-allocate these as static scratch vectors.

**M5. No RTT/jitter measurement — debug panel shows zeros**
`NetworkManager.ts:751-766`
The debug panel stubs return `rtt: 0`, `jitter: 0`, `packetLoss: 0`. The PING message type exists but is only used for keep-alive with no round-trip measurement. Without RTT data, the interpolation buffer time (`STATE_BUFFER_TIME: 70ms`) is a static guess — too low for high-latency connections, too high for local play.

**M6. Reconnecting client gets no state snapshot — stale local state persists**
`PeerConnection.ts:161-195`
When a client reconnects (`connectToHost()`), it re-establishes the data channel but doesn't request or receive a full state sync. The client's local `GameState`, player positions, food states, and NPC states are all stale from the moment of disconnection. The next periodic `STATE_SYNC` partially corrects this, but food/NPC state only syncs every 100ms and there's no guarantee of a full snapshot.

**M7. Event callbacks are single-subscriber — last registration wins**
`NetworkManager.ts:62-67`, `PeerConnection.ts:12-15`
All network callbacks (`onPlayerDeathCallback`, `onRoundStartCallback`, etc.) are single function references. If any code accidentally registers twice, the previous handler is silently lost. This hasn't caused bugs yet but is fragile as the codebase grows.

**M8. `checkAABBSphereCollision` in CollisionDetector allocates per call**
`CollisionDetector.ts:50-54`
```typescript
const closestPoint = new THREE.Vector3(...)
```
This creates a new Vector3 every collision check. With 10+ buildings and multiple players, this runs dozens of times per frame.

**M9. No input sequence numbering — impossible to correlate input with state**
`messages.ts:69-80`
`InputUpdateMessage` has no sequence number. The host applies whatever input it last received. If a message is lost or arrives out of order (WebRTC data channels are ordered but can be unreliable), the host has no way to detect the gap. For client-side prediction and proper reconciliation, inputs need sequence numbers so the client can replay un-acknowledged inputs.

**M10. `FoodSpawner.dispose()` doesn't null references**
`FoodSpawner.ts:86-92`
After dispose, the `scene` reference and `foods` map are still accessible. If any code accidentally accesses the spawner post-dispose, it could operate on a cleared map without error.

### MINOR

**m1. `PlayerDeathMessage` handler uses `any` type**
`NetworkManager.ts:62`, `Game.ts:1930`
`onPlayerDeathCallback` is typed as `(message: any) => void` instead of using the defined `PlayerDeathMessage` interface. The handler at `Game.ts:1936` destructures `{ pigeonWeight, survivalTime }` from `message` without type safety.

**m2. Touch controller `mouseY` output is frame-rate coupled**
`TouchController.ts:253-260`
The touch controller multiplies `mouseY` by `frameNormalization = clampedDelta * 60`. This is intended to be frame-rate invariant, but it's applied to the mouse delta output — which is then accumulated by the network tick system (`NetworkManager.ts:315`). The accumulation already accounts for multiple frames between ticks, so this double-scales the pitch on slower devices.

**m3. `generateMatchId` uses `Math.random` — not deterministic**
`GameState.ts:103`
`Math.random().toString(36).substr(2, 9)` — the `substr` method is deprecated in favor of `substring`. Minor, but worth noting for consistency.

**m4. Host status HTML injection in LobbyUI**
`LobbyUI.ts:182-188`
`setHostStatus` checks if the message contains `<` and uses `innerHTML` if so. While currently only called with hardcoded strings, this pattern is XSS-prone if any user-controlled data ever reaches it.

**m5. `console.log` in flight controller fires every ascend start**
`FlightController.ts:146-149`
A debug log fires every time a player starts ascending. In normal gameplay, this fires frequently and clutters the console.

**m6. `collisionDetector.resolveAABBSphereCollision` zeroes velocity entirely**
`CollisionDetector.ts:97`
When a player hits a building, all velocity is set to zero — not just the component along the collision normal. This feels abrupt and prevents sliding along walls.

**m7. `FoodType.RAT` in `addFood` model mapping will never be used**
`FoodSpawner.ts:174-175`
The `RAT` food type has a model key mapping, but no rats are ever spawned as food items (they're NPCs now, as noted by the comment at line 133). Dead code.

**m8. Camera collision meshes are building meshes — not bounding boxes**
`Game.ts:541-543`
`cameraController.setCollisionMeshes(this.environment.buildings.map(b => b.mesh))` passes the visual meshes for camera raycasting. Since buildings are simple boxes, this works, but it couples camera logic to the visual representation.

**m9. Leaderboard `sanitizeUsername` strips valid Unicode**
`LeaderboardService.ts:32`
`/[^\w\- ]+/g` strips everything that isn't `[a-zA-Z0-9_\- ]`. International characters (CJK, accented letters, etc.) are silently removed. A player named "Müller" becomes "Mller".

**m10. `DeviceDetector` categorization is coarse**
`src/utils/DeviceDetector.ts`
The tick rate recommendation (30Hz mobile, 45Hz desktop) is based solely on UA string detection, not actual performance measurement. A high-end iPad Pro gets the same tick rate as a budget Android phone.

---

## Part 3: Architecture Notes

### What Works Well
- Seeded deterministic world generation via `SeededRandom` is clean and correct
- The host-authoritative model is the right choice for this game type
- Banking physics spring-damper system is well-designed and feels good on desktop
- Food/NPC snapshot sync approach is reasonable
- Reconciliation with visual offset smoothing is a solid approach (just needs rotation too)
- Audio system is well-structured with fallback handling

### Architectural Debt
1. **God class**: `Game.ts` is ~2300 lines and handles game loop, networking, UI, audio, collision, scoring, leaderboard, and round management. Consider extracting `RoundManager`, `NetworkSync`, and `AudioController` subsystems.
2. **No test coverage**: Zero test files. The `personalBests.ts` pure functions and `SeededRandom` are ideal candidates for unit tests.
3. **Index.html has ~1500 lines of inline CSS**: Should be extracted to a `.css` file for maintainability.
4. **PeerJS version pinned to ^1.5.2**: PeerJS has known issues with mobile WebRTC. Consider evaluating alternatives or at least pinning to a tested exact version.

---

## Summary Priority Matrix

| # | Severity | Issue | Impact |
|---|----------|-------|--------|
| C1 | Critical | No fixed timestep — physics diverges across frame rates | Root cause of mobile desync |
| C2 | Critical | Dual simulation without rotation reconciliation | Permanent heading drift |
| C3 | Critical | `getRemotePeerIds()` includes closed connections | Player count errors |
| C4 | Critical | Round timer not synchronized between peers | Win condition race |
| Desync | Critical | Late-join missing ROUND_START + controller reset | Already-connected player glitches |
| M1 | Moderate | No input validation from peers | Potential abuse |
| M2 | Moderate | State buffer sort O(n log n) per message | Performance waste |
| M3 | Moderate | Vector3 allocation per frame in hot path | GC pressure |
| M5 | Moderate | No RTT measurement — static interpolation buffer | Poor adaptive behavior |
| M6 | Moderate | Reconnecting client gets no state snapshot | Stale state after reconnect |
| M9 | Moderate | No input sequence numbering | Can't do proper prediction |
| m2 | Minor | Touch mouseY double-scaled by frame normalization | Mobile pitch drift |
| m6 | Minor | Building collision zeroes all velocity | Abrupt feel |
