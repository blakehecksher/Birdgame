# 2026-02-14 2153 Multiplayer Desync & Jitter Fix Plan

## Objective
Ship a practical multiplayer netcode upgrade that:
- Reduces "looked like a hit but did not register" reports
- Reduces remote player jitter under normal and lossy networks
- Keeps controls responsive for both host and joining players
- Avoids destabilizing round flow, scoring, and reconnect behavior

## Current Baseline (from code + analysis)
- Host-authoritative simulation and collision
- Variable `deltaTime` simulation loop (`src/core/Game.ts`)
- Network tick/send cadence at 30Hz (`src/config/constants.ts`)
- Interpolation delay at 120ms (`src/config/constants.ts`)
- Reliable ordered PeerJS data channel (`src/network/PeerConnection.ts`)
- Client local reconciliation at about 30Hz with a wide dead-zone (`src/core/Game.ts`)

## Scope
In scope:
- Simulation timing and reconciliation behavior
- State/input transport behavior and rates
- Collision fairness improvements for online play
- Instrumentation to measure netcode quality

Out of scope:
- Matchmaking/lobby UX redesign
- New game modes or role logic changes
- Full rollback networking architecture rewrite

## Success Criteria
Primary:
1. Hit validation complaints decrease in playtests (qualitative).
2. Remote motion has visibly fewer freeze-then-jump spikes.
3. Median local reconciliation error stays below 0.20 units.
4. 95th percentile reconciliation error stays below 1.0 units.

Secondary:
1. RTT and packet loss spikes do not cause long visual stalls.
2. Round outcomes stay host-authoritative and deterministic.
3. Bandwidth increase remains acceptable for 2-5 player sessions.

## Rollout Strategy
Use phased rollout with validation gates. Do not combine all changes in one commit.

Phase order:
1. Instrumentation and baselines
2. Low-risk tuning (buffer + reconciliation)
3. Sync-rate increase
4. Transport reliability split
5. Fixed-step simulation refactor
6. Host lag-compensated collision
7. Optional collision forgiveness tuning

Each phase ships only if test and telemetry gates pass.

---

## Phase 0 - Instrumentation and Baseline Capture

### Goals
- Measure current error/jitter profile before behavior changes.
- Make regressions obvious during each later phase.

### Implementation
- Add lightweight debug counters/metrics in:
  - `src/core/Game.ts`
  - `src/network/NetworkManager.ts`
  - `src/network/PeerConnection.ts`
- Capture:
  - Local authoritative error distance per reconciliation step
  - State snapshot age at render time
  - Interpolation buffer occupancy
  - Extrapolation usage rate
  - Message receive gaps and burst arrivals
- Add optional on-screen/net debug panel toggle (reuse existing debug console style).

### Exit Criteria
- We can log and compare: p50/p95/p99 reconciliation error and interpolation gap behavior.
- Baseline runs recorded for:
  - Desktop host <-> desktop client
  - Desktop host <-> mobile client
  - Mobile host <-> desktop client

---

## Phase 1 - Low-Risk Responsiveness Tuning

### Changes
1. Reduce interpolation delay from 120ms to 60-80ms in `src/config/constants.ts`.
2. Tighten reconciliation in `src/core/Game.ts`:
   - Remove 30Hz throttle gate so correction can run every frame.
   - Reduce soft dead-zone from 0.4 to 0.1-0.2.
   - Increase correction strength (alpha) so drift resolves faster.
3. Keep hard snap threshold conservative to avoid visible warps.

### Rationale
- Fastest improvement for end-user feel.
- Minimal architecture risk.

### Risks
- Lower buffer can expose network jitter on weaker links.
- Stronger correction can create visible tugging if overtuned.

### Mitigations
- Start with midpoint values (for example 70ms buffer, 0.15 dead-zone).
- Clamp correction alpha and tune with real packet-loss simulations.

### Exit Criteria
- Subjective playtest: fewer collision "ghost misses."
- Objective: lower average error without increased correction snaps.

---

## Phase 2 - Increase Realtime Sync Cadence

### Changes
- Raise `TICK_RATE` from 30Hz to 45Hz first, then evaluate 60Hz target.
- Keep world-state bundle cadence (`worldSyncIntervalMs`) decoupled from player state.
- Ensure send throttles in `NetworkManager` still cap burst rates correctly.

### Rationale
- Smaller snapshot spacing improves interpolation quality and prediction alignment.

### Risks
- Higher bandwidth and CPU on low-end/mobile devices.
- Increased queue pressure on poor networks if not paired with transport updates.

### Mitigations
- Step-up rollout: 30 -> 45 -> 60 with measured CPU/network cost.
- Keep food/NPC snapshots at slower cadence than player transforms.

### Exit Criteria
- Measurable reduction in interpolation gap variance.
- No major FPS regression on target mobile devices.

---

## Phase 3 - Transport Reliability Split

### Changes
- Use unreliable/unordered channel for high-frequency transient streams:
  - `INPUT_UPDATE`
  - `STATE_SYNC`
- Keep reliable/ordered channel for critical events:
  - Round start/end
  - Player death
  - Food/NPC authoritative events (if event loss is unacceptable)

### Implementation Notes
- Update `PeerConnection` to support two logical channels or equivalent PeerJS config handling.
- Route message types by criticality in `NetworkManager`.
- Preserve message timestamping for interpolation and lag compensation.

### Rationale
- Eliminates head-of-line blocking spikes for realtime movement data.

### Risks
- Packet loss now appears as missing snapshots instead of delayed bursts.
- Requires robust interpolation/extrapolation fallback tuning.

### Mitigations
- Keep short extrapolation cap (already present) and monitor its usage rate.
- Leave critical gameplay events on reliable path.

### Exit Criteria
- Burst-stall jitter events substantially reduced in packet-loss tests.
- No missed round/death events in stress tests.

---

## Phase 4 - Fixed-Step Simulation Refactor

### Changes
- Convert simulation from variable `deltaTime` to accumulator-based fixed-step loop.
- Recommended:
  - Simulation step: 1/60s
  - Render loop remains variable via `requestAnimationFrame`.
- Move host-authoritative gameplay updates (movement, role stats, collision checks) into fixed-step path.

### Files
- `src/core/Game.ts` (loop orchestration and update split)
- `src/physics/FlightController.ts` (validate fixed-step assumptions)
- `src/entities/Player.ts` (state integration path validation)

### Rationale
- Removes framerate-dependent drift and improves determinism.

### Risks
- Refactor touches critical game loop; high regression potential.
- Can cause double-update bugs if render/sim responsibilities are not separated cleanly.

### Mitigations
- Keep changes isolated behind `simulateFixedStep()` and `renderFrame()` boundaries.
- Add targeted tests for role swaps, round transitions, and collision timing.

### Exit Criteria
- Consistent host/client convergence across 30/60/120 FPS environments.
- No regressions in round flow, HUD, audio triggers, or NPC behavior.

---

## Phase 5 - Host Lag-Compensated Collision

### Changes
- Add short transform history ring buffer per player on host (for example 250-400ms window).
- Include input/send timestamp data on client control updates.
- During collision check, compute estimated action time and evaluate against rewound target transforms.

### Implementation Notes
- Collision authority stays on host.
- Rewind only for gameplay-critical checks (hawk-pigeon capture), not all systems.
- Cap rewind to safe bounds to prevent abuse under extreme latency.

### Rationale
- Aligns host collision resolution with what player saw when acting.

### Risks
- Complexity and fairness edge cases under very high RTT.
- Potential exploit window if rewind window is too large.

### Mitigations
- Conservative max rewind cap.
- Compare both current-time and rewound collision with strict policy.
- Add logging for rewind distance/time per capture event.

### Exit Criteria
- Significant drop in "felt like a hit" misses in cross-region/high-latency tests.
- No observable unfair long-latency advantage.

---

## Phase 6 - Optional Collision Forgiveness Tuning

### Changes
- If needed after Phase 5, add small online-only forgiveness:
  - Slight dynamic expansion of collision radii by latency bucket, or
  - Very short swept collision window (single-frame temporal cushion).

### Guardrails
- Keep forgiveness narrow and capped.
- Apply only in active round play and only for player-vs-player capture checks.

### Exit Criteria
- Improved subjective fairness without turning near-misses into obvious false positives.

---

## Test Plan

### Automated
- Extend/update tests in:
  - `tests/network/NetworkManager.test.cjs`
  - `tests/core/GameState.test.cjs`
- Add coverage for:
  - Reconciliation threshold behavior
  - Snapshot interpolation selection
  - Tick/send gating at new rates
  - Message routing by reliability class (if abstracted)

### Manual Matrix
1. Desktop host <-> desktop client (stable wifi)
2. Desktop host <-> mobile client (stable wifi)
3. Mobile host <-> desktop client
4. Lossy link simulation (packet loss + jitter + latency injection)
5. High-speed hawk dive capture scenarios

### Gameplay Validation Scenarios
1. Repeated close hawk-pigeon passes at high speed
2. Fast turn + dive near building edges
3. Late-round timer pressure captures
4. Reconnect mid-session and resume state sync

## Observability and Regression Guardrails
- Track these per build:
  - p50/p95/p99 reconciliation error
  - Interpolation buffer underrun count
  - Extrapolation activation rate
  - Remote transform jump magnitude distribution
  - Capture event latency and rewind amount (if enabled)
- Require non-regression report before moving to next phase.

## Release Notes (Player-Facing Expectations)
- Fewer missed-feeling catches
- Smoother opponent motion with fewer jump spikes
- Better consistency across desktop/mobile combinations
- Slightly higher network usage in exchange for responsiveness

## Rollback Plan
- Keep each phase in isolated commit(s) so we can revert by phase.
- If severe regression appears:
  1. Revert latest phase only.
  2. Re-run baseline instrumentation.
  3. Re-tune parameters before retry.

## Proposed Commit Sequence
1. `netcode: add multiplayer jitter/reconciliation metrics`
2. `netcode: reduce interpolation delay and tighten reconciliation`
3. `netcode: raise player sync tick rate and keep world sync decoupled`
4. `netcode: split reliable vs realtime transport paths`
5. `netcode: refactor to fixed-step simulation loop`
6. `netcode: add host lag-compensated collision checks`
7. `netcode: add optional bounded online collision forgiveness`

## Final Recommendation
Start with Phases 0-2 immediately (highest gain, lowest risk), then gate Phase 3 and beyond on measured improvements and targeted packet-loss testing.
