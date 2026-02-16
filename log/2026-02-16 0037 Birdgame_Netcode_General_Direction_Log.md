# 2026-02-16 0037 - Birdgame Netcode General Direction Log (Consolidated)

## Purpose
This file consolidates the current netcode direction from the active `log/` files so future agents can quickly understand:
- what was decided,
- what was implemented,
- what changed during troubleshooting,
- what remains.

Scope: main `log/` folder only (not `log/Old Logs/`).

---

## Source Logs (Primary References)

1. `log/2026-02-15 0015 Netcode Plan Review & Assumptions.md`
2. `log/2026-02-15 0045 Final Netcode Improvement Plan.md`
3. `log/2026-02-15 0100 Implementation Summary.md`
4. `log/2026-02-15 0200 Phase 0 Implementation Complete.md`
5. `log/2026-02-15 0300 Phase 1 Implementation Complete.md`
6. `log/2026-02-15 0315 Reconciliation Jitter Troubleshooting.md`
7. `log/2026-02-15 2349 Phase 1.5 Joiner Jitter Smoothing Fix.md`

---

## High-Level Direction (What the project is optimizing for)

- Target experience: casual/friends play, not esports-level strictness.
- Networking model: host-authoritative P2P via WebRTC/PeerJS, no dedicated server.
- Constraints: mobile and desktop both matter; keep complexity controlled.
- Priority order:
1. Smoothness and stability first.
2. Responsiveness improvements second.
3. Deep architecture refactors only if needed by playtests.

This direction comes primarily from:
- assumptions + risk framing: `log/2026-02-15 0015 Netcode Plan Review & Assumptions.md`
- finalized scope and constraints: `log/2026-02-15 0045 Final Netcode Improvement Plan.md`

---

## Overall Direction and Implementation Program (from 0045 + 0100)

This section captures the explicit program defined in:
- `log/2026-02-15 0045 Final Netcode Improvement Plan.md`
- `log/2026-02-15 0100 Implementation Summary.md`

### Direction Constraints to Preserve

1. Mobile devices are first-class participants and can host or join.
2. Deployment remains static hosting (GitHub Pages) with P2P WebRTC only.
3. Keep complexity controlled: tune and instrument first, large refactors later.
4. Target quality is "no complaints" and cross-country usability (roughly 60-120ms RTT use cases).
5. Feedback loop is friend playtesting plus local automation, not telemetry infrastructure.

### Planned Scope and Phase Strategy

1. Recommended delivery scope is Phases 0-2 for the first meaningful quality jump.
2. Phases 3-4 are optional escalation if Phases 0-2 do not clear remaining complaints.
3. Phase 5 (fixed-step simulation and lag compensation) is deferred/high-complexity work.

### Planned Implementation Sequence

1. `Phase 0` (3-4 days): instrumentation and critical reliability fixes.
Phase 0A priority: fix mobile host background/app-switch disconnect behavior first.
Phase 0B priority: add automated network and collision tests.
Phase 0C priority: add F3 debug visibility and network simulation support.

2. `Phase 1` (1-2 days): low-risk responsiveness tuning.
Focus: lower interpolation delay, tighten reconciliation behavior, and add stale extrapolation safety.

3. `Phase 2` (1-2 days): mobile-aware adaptive performance.
Focus: device-aware tick-rate decisions and host quality safeguards.

4. `Phase 3` optional (about 1 day): desktop-only tick-rate increase (45Hz) if still needed.

5. `Phase 4` optional (about 3-5 days): transport-layer reliability strategy changes only if jitter remains unacceptable.

6. `Phase 5` future/deferred: fixed-step simulation refactor and collision lag compensation only if required by later goals.

### Plan-Level Priorities Emphasized in 0100

1. The critical mobile host fix is the first blocker to clear before further tuning.
2. Automated tests are meant to shorten iteration loops before friend playtests.
3. Debug tooling is required so tuning is metric-guided, not guess-driven.
4. Expected overall timeline for Phases 0-2 was about 1.5 weeks including testing/iteration.

### Expected Post-Phase-2 Outcomes (from plan intent)

1. Same-city play should feel excellent with minimal lag complaints.
2. Cross-country play should be playable/smooth enough for casual sessions, with occasional close-call ambiguity still possible.
3. Mobile hosting should be reliable enough for normal room setup/use, with clear failure messaging when recovery is not possible.
4. Network behavior should be inspectable in-session via debug tools.

---

## Consolidated Decision History

### 1. Planning and Scope Lock

- The "Final Netcode Improvement Plan" chose a phased path with strongest focus on Phases 0-2.
- Phases 3-5 were explicitly treated as optional/deferred unless playtests proved the need.
- A critical blocker was identified early: mobile host background/app-switch disconnect behavior.

Reference:
- `log/2026-02-15 0045 Final Netcode Improvement Plan.md`

### 2. Phase 0 Delivered

Phase 0 intent: instrumentation + critical reliability fixes before more tuning.

Implemented outcomes:
- Mobile host background/visibility handling and keep-alive behavior.
- F3 network debug panel flow.
- Automated network/collision test coverage added.
- Follow-up fix for F3 conflict and hitbox-visibility flow.

References:
- initial implementation: `log/2026-02-15 0200 Phase 0 Implementation Complete.md`
- debug/hitbox conflict fix details: same file (Phase 0D section)

### 3. Phase 1 Delivered, Then Iterated

Phase 1 intent: low-risk responsiveness tuning.

Core changes:
- Lower interpolation delay (`STATE_BUFFER_TIME` from 120ms to 70ms).
- Stronger/tighter reconciliation settings.
- Reconciliation moved to every frame.
- Stale-snapshot extrapolation fallback.

Reference:
- `log/2026-02-15 0300 Phase 1 Implementation Complete.md`

### 4. Jitter Troubleshooting Cycle (1A/1B/1C/1D)

After Phase 1, user-observed local movement jitter required fast iteration:
- 1A: dead zone widened.
- 1B/1C: additional attempts including rotation handling experiments.
- 1D: root cause pinned to local `player.update()` timing/order and mesh update interaction.

Important outcome:
- The major visual jitter source was update ordering and how reconciliation affected what the camera tracked.

References:
- troubleshooting analysis: `log/2026-02-15 0315 Reconciliation Jitter Troubleshooting.md`
- full Phase 1A-1D narrative: `log/2026-02-15 0300 Phase 1 Implementation Complete.md`

### 5. Phase 1.5 Joiner Smoothing Pass Delivered

Final smoothing approach added a visual reconciliation offset buffer so simulation corrections remain authoritative without visible tugging:
- preserve hard snaps,
- keep soft simulation correction,
- decouple visual presentation from soft correction deltas,
- damp and clamp visual offset.

Result from user retest: smooth and accepted as fixed.

Reference:
- `log/2026-02-15 2349 Phase 1.5 Joiner Jitter Smoothing Fix.md`

---

## Current Canonical State (What future agents should assume)

1. Phases 0 and 1 are implemented, plus a post-Phase-1 smoothing pass (Phase 1.5).
2. Jitter was not solved by one parameter tweak alone; it required update-order and visual/simulation decoupling decisions.
3. The current accepted direction is:
- host-authoritative simulation remains,
- client visual smoothing absorbs soft corrections,
- hard correction path remains intact for true desync.
4. Automated tests and debug tooling are part of expected workflow, not optional extras.

Primary references:
- `log/2026-02-15 0200 Phase 0 Implementation Complete.md`
- `log/2026-02-15 0300 Phase 1 Implementation Complete.md`
- `log/2026-02-15 2349 Phase 1.5 Joiner Jitter Smoothing Fix.md`

---

## Files/Areas Future Agents Should Check First

- `src/core/Game.ts`
  - Reconciliation logic, local player update ordering, visual offset handling.
- `src/config/constants.ts`
  - Netcode tuning constants.
- `src/network/NetworkManager.ts`
  - Interpolation/extrapolation and debug metrics feed.
- `src/network/PeerConnection.ts`
  - Keep-alive and mobile visibility/background behavior.
- `src/debug/NetworkDebugPanel.ts`
  - F3 debug modes/stats integration.
- `tests/network/NetworkConditions.test.cjs`
- `tests/network/CollisionSync.test.cjs`

Rationale references:
- `log/2026-02-15 0200 Phase 0 Implementation Complete.md`
- `log/2026-02-15 0300 Phase 1 Implementation Complete.md`
- `log/2026-02-15 2349 Phase 1.5 Joiner Jitter Smoothing Fix.md`

---

## Open/Deferred Work (Based on existing logs)

- Phase 2 (mobile-aware adaptive performance) appears planned but not logged here as completed.
- Some debug metrics were originally stubbed and may still need verification for full fidelity.
- Phase 3/4/5 remain optional and should be driven by new playtest evidence, not assumed mandatory.

Planning reference:
- `log/2026-02-15 0045 Final Netcode Improvement Plan.md`

---

## Practical Guidance for Next Agent

1. Start by validating the current baseline before changing tuning:
- run tests,
- run build,
- reproduce host/joiner movement behavior with F3 stats visible.
2. Treat `Phase 1.5` behavior as the latest accepted jitter solution unless new evidence disproves it.
3. If changing reconciliation again, preserve the distinction between:
- simulation correctness,
- visual smoothness.
4. Log changes with clear "problem -> root cause -> fix -> retest result" structure (same style as these logs).
