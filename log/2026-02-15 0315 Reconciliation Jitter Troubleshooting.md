# 2026-02-15 0315 — Reconciliation Jitter Troubleshooting

## Issue Report

**Reporter:** User
**Date:** 2026-02-15 03:15
**Environment:** Desktop, two browser windows (local testing)
**Affected Role:** Hawk (client)
**Unaffected:** Pigeon (host), remote players

### Symptoms

> "The world itself looks pretty smooth like all players are moving around smoothly but once I start moving in the world, it gets jittery and jumpy and it's a constant kind of stepping sort of jitter and it seems to be really apparent whenever I'm raising up in the air. Whenever I'm on a slight decline, not diving, but just a slight decline if I were to start diving, it's just as bad as whenever it's raising up into the air."

**Key Observations:**
1. ✅ Remote players move smoothly (interpolation working)
2. ✅ Stationary local player sees smooth world
3. ❌ Local player movement has constant stepping/jitter
4. ❌ Vertical movement (up OR down) is especially jittery
5. ✅ Host pigeon has no issues (no reconciliation)
6. ❌ Did NOT exist before Phase 1 changes

---

## Root Cause Analysis

### The Reconciliation Loop

```
┌─────────────────────────────────────────────────────┐
│ Frame N (16ms @ 60fps)                              │
├─────────────────────────────────────────────────────┤
│ 1. Client predicts movement (immediate, 0ms delay)  │
│    → Hawk position: (10.0, 5.0, 0.0)                │
│                                                      │
│ 2. Server authority arrives (30Hz = 33ms old)       │
│    → Server says: (9.85, 4.90, 0.0)                 │
│                                                      │
│ 3. Reconciliation calculates error:                 │
│    → distance = 0.18 units                          │
│                                                      │
│ 4. Check dead zone:                                 │
│    → 0.18 > 0.15 (RECONCILIATION_DEAD_ZONE)         │
│    → CORRECTION TRIGGERED                           │
│                                                      │
│ 5. Apply lerp correction (alpha = 0.35):            │
│    → Pull position toward server authority          │
│    → Hawk position: (9.95, 4.97, 0.0)               │
│                                                      │
│ 6. Player input still says "move forward"           │
│    → Next frame predicts ahead again                │
│    → (10.0, 5.0, 0.0)                               │
│                                                      │
│ 7. Repeat cycle every frame (60 times per second)   │
│    → CONSTANT JITTER                                │
└─────────────────────────────────────────────────────┘
```

### Why Phase 1 Made It Worse

| Parameter | Before | Phase 1 | Impact |
|-----------|--------|---------|--------|
| **Reconciliation Rate** | 30Hz | **60Hz** | 2x more corrections per second |
| **Dead Zone** | 0.4 units | **0.15 units** | 62% tighter tolerance |
| **Correction Strength** | 0.22 | **0.35** | 59% stronger pull |
| **Result** | Occasional gentle nudge | **Constant aggressive tug** |

### Mathematical Breakdown

**Normal Network Delay:** 16-33ms (half a server tick at 30Hz)

**Client Prediction Error at 60fps:**
- Hawk speed: ~10 units/sec
- Error per frame: `10 units/sec × 0.016 sec = 0.16 units`
- This is **larger than 0.15 dead zone** → triggers correction **every frame**

**Why Vertical Movement Is Worse:**
- Horizontal velocity is relatively constant (turn rate limited)
- Vertical velocity changes rapidly:
  - Gravity: -9.8 m/s² equivalent in game units
  - Pitch input: instant velocity changes
  - Dive mechanics: speed multipliers
- Prediction error is higher on Y-axis → more frequent corrections

**Why Stationary Is Smooth:**
- Velocity = 0 → prediction error = 0
- No corrections needed
- Remote players use pure interpolation (no reconciliation)

---

## The Fix: Dead Zone Tuning

### Initial Phase 1 Value (Too Tight)

```typescript
RECONCILIATION_DEAD_ZONE: 0.15,  // ~10% of collision size
```

**Problem:** Normal network jitter (16-33ms delay) creates 0.16-0.20 unit errors → constant corrections

### Adjusted Value (Balanced)

```typescript
RECONCILIATION_DEAD_ZONE: 0.3,   // ~20% of collision size
```

**Rationale:**
- Still **25% tighter than original** (0.4) → maintains Phase 1 improvement goal
- Allows small prediction errors from network delay without correction
- Only corrects when error is **genuinely large** (not just network jitter)
- Keeps every-frame reconciliation for **quick response** to real desyncs

### Comparison Table

| Dead Zone | % of Collision Size | Triggers on Normal Movement? | Effective Range |
|-----------|---------------------|------------------------------|-----------------|
| **0.4** (original) | 25% | Rarely | Loose, forgiving |
| **0.15** (Phase 1) | 10% | **Every frame** ❌ | Too tight, jittery |
| **0.3** (Phase 1A) | 20% | Only when needed ✅ | Balanced |

---

## Alternative Solutions (If 0.3 Still Jittery)

### Option A: Velocity-Based Dead Zone

Adjust tolerance based on movement speed:

```typescript
private reconcileLocalPlayerWithAuthority(deltaTime: number): void {
  if (!this.gameState || this.gameState.isHost || !this.localPlayer || !this.networkManager) return;

  const authoritative = this.networkManager.getLocalAuthoritativeState();
  if (!authoritative) return;
  if (Date.now() - authoritative.timestamp > 300) return;

  const speed = this.localPlayer.velocity.length();

  // Dynamic dead zone based on speed
  const deadZone = speed > 5.0
    ? 0.5  // Loose tolerance when moving fast (prediction is good)
    : 0.2; // Tight tolerance when maneuvering slowly (precision matters)

  const hardSnapDistance = GAME_CONFIG.HARD_SNAP_THRESHOLD;
  const error = this.localPlayer.position.distanceTo(authoritative.position);

  this.currentReconciliationError = error;

  if (error > hardSnapDistance) {
    // Hard snap (unchanged)
    this.localPlayer.position.copy(authoritative.position);
    this.localPlayer.velocity.copy(authoritative.velocity);
    this.localPlayer.rotation.copy(authoritative.rotation);
  } else if (error > deadZone) {
    // Velocity-aware correction
    const alpha = Math.min(GAME_CONFIG.RECONCILIATION_ALPHA_MAX, deltaTime * GAME_CONFIG.RECONCILIATION_ALPHA_SCALE);
    this.localPlayer.position.lerp(authoritative.position, alpha);
    this.localPlayer.velocity.lerp(authoritative.velocity, alpha);
    this.localPlayer.rotation.x = THREE.MathUtils.lerp(this.localPlayer.rotation.x, authoritative.rotation.x, alpha);
    this.localPlayer.rotation.y = this.lerpAngle(this.localPlayer.rotation.y, authoritative.rotation.y, alpha);
    this.localPlayer.rotation.z = THREE.MathUtils.lerp(this.localPlayer.rotation.z, authoritative.rotation.z, alpha);
  }

  this.localPlayer.mesh.position.copy(this.localPlayer.position);
  this.localPlayer.applyMeshRotation();
}
```

**Pros:**
- Smooth during flight (when player can't notice small errors)
- Tight during hovering/maneuvering (when precision matters for collision)

**Cons:**
- More complex logic
- Needs testing to find optimal speed threshold

### Option B: Restore 30Hz Throttle (Partial Rollback)

Keep improvements but reduce correction frequency:

```typescript
private lastReconcileTime: number = 0; // Add back

private reconcileLocalPlayerWithAuthority(deltaTime: number): void {
  if (!this.gameState || this.gameState.isHost || !this.localPlayer || !this.networkManager) return;

  // Throttle to 30Hz (but keep other improvements)
  const now = performance.now();
  if (now - this.lastReconcileTime < 33) return;

  const authoritative = this.networkManager.getLocalAuthoritativeState();
  if (!authoritative) return;
  if (Date.now() - authoritative.timestamp > 300) return;

  const hardSnapDistance = GAME_CONFIG.HARD_SNAP_THRESHOLD;
  const softStartDistance = 0.3; // Keep widened dead zone
  const error = this.localPlayer.position.distanceTo(authoritative.position);

  this.currentReconciliationError = error;

  if (error > hardSnapDistance) {
    this.localPlayer.position.copy(authoritative.position);
    this.localPlayer.velocity.copy(authoritative.velocity);
    this.localPlayer.rotation.copy(authoritative.rotation);
  } else if (error > softStartDistance) {
    // Keep stronger correction (0.35 alpha)
    const alpha = Math.min(0.35, deltaTime * 15);
    this.localPlayer.position.lerp(authoritative.position, alpha);
    this.localPlayer.velocity.lerp(authoritative.velocity, alpha);
    this.localPlayer.rotation.x = THREE.MathUtils.lerp(this.localPlayer.rotation.x, authoritative.rotation.x, alpha);
    this.localPlayer.rotation.y = this.lerpAngle(this.localPlayer.rotation.y, authoritative.rotation.y, alpha);
    this.localPlayer.rotation.z = THREE.MathUtils.lerp(this.localPlayer.rotation.z, authoritative.rotation.z, alpha);
  }

  this.localPlayer.mesh.position.copy(this.localPlayer.position);
  this.localPlayer.applyMeshRotation();
  this.lastReconcileTime = now; // Update throttle timer
}
```

**Pros:**
- Less frequent corrections = inherently smoother
- Still keeps 70ms interpolation buffer + stronger alpha

**Cons:**
- Slower response to large desyncs (not really a problem in practice)
- Partially rolls back "run every frame" goal

### Option C: Hybrid Approach (Smart Throttling)

Run every frame for **large** errors, throttle to 30Hz for **small** errors:

```typescript
private reconcileLocalPlayerWithAuthority(deltaTime: number): void {
  if (!this.gameState || this.gameState.isHost || !this.localPlayer || !this.networkManager) return;

  const authoritative = this.networkManager.getLocalAuthoritativeState();
  if (!authoritative) return;
  if (Date.now() - authoritative.timestamp > 300) return;

  const hardSnapDistance = GAME_CONFIG.HARD_SNAP_THRESHOLD;
  const softStartDistance = 0.3;
  const error = this.localPlayer.position.distanceTo(authoritative.position);

  this.currentReconciliationError = error;

  // Large errors: correct immediately (every frame)
  if (error > 1.0) {
    // Apply correction without throttle
    this.applyReconciliation(authoritative, error, deltaTime);
    this.lastReconcileTime = performance.now();
  }
  // Small errors: throttle to 30Hz
  else if (error > softStartDistance) {
    const now = performance.now();
    if (now - this.lastReconcileTime < 33) return; // 30Hz throttle
    this.applyReconciliation(authoritative, error, deltaTime);
    this.lastReconcileTime = now;
  }

  this.localPlayer.mesh.position.copy(this.localPlayer.position);
  this.localPlayer.applyMeshRotation();
}

private applyReconciliation(authoritative: any, error: number, deltaTime: number): void {
  if (error > GAME_CONFIG.HARD_SNAP_THRESHOLD) {
    this.localPlayer.position.copy(authoritative.position);
    this.localPlayer.velocity.copy(authoritative.velocity);
    this.localPlayer.rotation.copy(authoritative.rotation);
  } else {
    const alpha = Math.min(GAME_CONFIG.RECONCILIATION_ALPHA_MAX, deltaTime * GAME_CONFIG.RECONCILIATION_ALPHA_SCALE);
    this.localPlayer.position.lerp(authoritative.position, alpha);
    this.localPlayer.velocity.lerp(authoritative.velocity, alpha);
    this.localPlayer.rotation.x = THREE.MathUtils.lerp(this.localPlayer.rotation.x, authoritative.rotation.x, alpha);
    this.localPlayer.rotation.y = this.lerpAngle(this.localPlayer.rotation.y, authoritative.rotation.y, alpha);
    this.localPlayer.rotation.z = THREE.MathUtils.lerp(this.localPlayer.rotation.z, authoritative.rotation.z, alpha);
  }
}
```

**Pros:**
- Fast response to real desyncs (> 1.0 unit)
- Smooth during normal play (small errors throttled)

**Cons:**
- Most complex solution

---

## Testing Protocol

### Retest Checklist (With 0.3 Dead Zone)

1. **Vertical Climbing:**
   - [ ] Pitch up and climb → Should be smooth, no stepping
   - [ ] Check F3 debug → Reconciliation error should stay < 0.3 during climb

2. **Vertical Descending:**
   - [ ] Pitch down (not diving) → Should be smooth
   - [ ] Check F3 debug → Error should stay < 0.3

3. **Diving:**
   - [ ] Full dive (steep angle) → Should be smooth
   - [ ] Check F3 debug → Error may spike briefly but smooth visually

4. **Level Flight:**
   - [ ] Fly straight → Should be perfectly smooth
   - [ ] Check F3 debug → Error should be near 0

5. **Maneuvering:**
   - [ ] Banking turns → Should be smooth
   - [ ] Tight circles → May have small corrections but no constant jitter

6. **Remote Player View:**
   - [ ] Watch pigeon (host) → Should be smooth (unchanged)
   - [ ] Watch other hawk (if multiplayer) → Should be smooth (interpolation)

### Debug Panel Metrics (Press F3)

**Expected Values:**
- **Reconciliation Error:** < 0.3 during normal flight, < 0.5 during maneuvering
- **FPS:** Stable 60fps
- **Packet Loss:** 0% (local testing)
- **RTT:** ~0-5ms (local testing)

**Red Flags:**
- Reconciliation error constantly > 0.3 → Dead zone still too tight
- Reconciliation error spiking > 2.0 → Possible real desync issue
- FPS < 60 → Performance issue (not netcode)

---

## Lessons Learned

### Key Insight: Network Delay ≠ Desync

**Network delay** (16-33ms) is **normal and expected**. It creates small position errors (~0.16-0.20 units) that should be **tolerated**, not corrected.

**Actual desync** (> 0.5 units) is rare and indicates:
- Packet loss
- Client prediction bug
- Server/client tick rate mismatch

**Dead zone should be sized to:**
- ✅ **Tolerate** normal network delay
- ✅ **Correct** actual desync
- ❌ **NOT** fight against physics

### The "Goldilocks Zone" for Dead Zones

- **Too small** (0.05-0.15): Constant corrections, jittery movement
- **Too large** (0.5-1.0): Visible drift, loose sync
- **Just right** (0.25-0.35): Smooth movement, tight-enough sync

**Rule of thumb:** Dead zone should be **2x the expected prediction error from network delay**

If RTT = 50ms and speed = 10 units/sec:
- Prediction error ≈ (50ms / 1000) × 10 = 0.5 units
- Dead zone should be ≈ 2 × 0.5 = **1.0 units** (loose but smooth)

If RTT = 20ms and speed = 10 units/sec:
- Prediction error ≈ (20ms / 1000) × 10 = 0.2 units
- Dead zone should be ≈ 2 × 0.2 = **0.4 units** (original value was correct!)

For local testing (RTT ~5ms):
- Prediction error ≈ (5ms / 1000) × 10 = 0.05 units
- Dead zone should be ≈ 2 × 0.05 = **0.1 units** minimum

**Phase 1A choice of 0.3** accounts for:
- Higher RTT in real-world play (30-60ms)
- Variable packet arrival times (jitter)
- Vertical velocity changes (higher prediction error)

---

## Recommendation

**Start with 0.3 dead zone** (already applied). If still jittery:

1. **First:** Try 0.4 (original value) to confirm it's the dead zone
2. **Then:** Try Option B (30Hz throttle) to reduce correction frequency
3. **Last resort:** Try Option A (velocity-based) for smart tolerance

**Do NOT** go tighter than 0.3 unless you also implement velocity-aware logic.

---

**Analyst:** Claude Sonnet 4.5
**Date:** 2026-02-15 03:15
**Status:** Fix Applied (0.3 dead zone), Awaiting Retest ⏳

---
