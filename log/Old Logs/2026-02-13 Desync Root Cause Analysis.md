# Desync Root Cause Analysis

## Timestamp
2026-02-13 (after user provided specific desync symptoms)

## User-Reported Symptoms

### 1. Joiner 1 Second Behind Host
- Joined player sees world state ~1 second delayed
- Makes collision detection difficult (pigeon, NPCs, food)
- Joiner can't hit things that appear hittable on their screen

### 2. Mobile Host → Desktop Client: SEVERE Desync
- Players appear on opposite sides of map
- Example: Desktop hawk hits mobile pigeon on desktop, but mobile shows hawk across map
- Host position is authoritative, so joiner can't win
- Game-breaking for gameplay

### 3. Platform-Specific Pattern
- **Mobile ↔ Mobile**: Mostly in sync ✅
- **Desktop ↔ Desktop**: Mostly in sync ✅
- **Mobile ↔ Desktop**: Really bad desync ❌
- **Specifically**: Desktop clients seem far off from mobile hosts

### Impact
- Constantly happening
- Breaks fun factor (you "hit" things but don't get credit)
- Particularly bad for cross-platform play

## Root Cause Analysis

### Symptom 1: "1 Second Behind"
This is the **120ms buffer from GitHub version becoming 1000ms**.

**Likely causes**:
1. **Mobile input processing delay** - Touch events → network send has lag
2. **Mobile frame rate variance** - If mobile drops to 15fps, deltaTime spikes
3. **Network send rate mismatch** - Mobile might be sending slower than desktop
4. **Accumulated interpolation delay** - 120ms buffer + network RTT + processing = 1s

### Symptom 2 & 3: Cross-Platform Desync (THE BIG ONE)

**This is NOT a jitter issue - this is a fundamental bug.**

#### Hypothesis 1: Mobile vs Desktop Frame Time Handling
Looking at the recent mobile update (445e8f0):

```typescript
// New in mobile update:
const rawInput = this.inputManager.getInputState(deltaTime);
```

If desktop runs at 60fps (deltaTime = 0.016s) but mobile runs at 30fps (deltaTime = 0.033s):
- Desktop integrates position 60 times/sec with small steps
- Mobile integrates position 30 times/sec with large steps
- **Over time, they diverge massively**

#### Hypothesis 2: Mobile Input Timestamping
Mobile added `mobilePitchAutoCenter` to input messages. If the input processing changed between platforms, the timing might be off.

#### Hypothesis 3: Pointer Lock / Input Accumulation Difference
Desktop uses pointer lock (mouse delta accumulation).
Mobile uses touch (direct input).

From NetworkManager.ts line 771-780:
```typescript
// Mouse deltas ACCUMULATE (+=)
remotePlayer.accumulatedMouseX += inputData.mouseDeltaX;
remotePlayer.accumulatedMouseY += inputData.mouseDeltaY;
```

If mobile doesn't send mouse deltas but desktop does, or vice versa, **position integration diverges**.

#### Hypothesis 4: Mobile Background/Throttling
Mobile browsers aggressively throttle background tabs. If host mobile app backgrounds even briefly:
- Simulation might pause or slow
- Clients continue at full speed
- Massive divergence when host resumes

#### Hypothesis 5: The "Big Ol' Update" Broke It
Commit 445e8f0: "Big ol' update. Added mobile."

**This is when the problem was likely introduced.**

Changes that could cause cross-platform desync:
1. `InputManager.getInputState(deltaTime)` - deltaTime now affects input
2. Mobile-specific input handling
3. Touch control additions
4. Frame rate differences between platforms

## The Smoking Gun

Looking at the GitHub version that works:
- **No deltaTime passed to input processing**
- **Simpler frame handling**
- **No platform-specific input paths**

The mobile update added platform-specific code that diverges.

## Why Mobile ↔ Mobile and Desktop ↔ Desktop Work

Both sides integrate physics the same way:
- Same frame rate (roughly)
- Same input handling path
- Same deltaTime values
- Same accumulation errors (so they cancel out)

## Why Mobile ↔ Desktop Breaks

Different frame rates + deltaTime in input = diverging integration:
```
Desktop: 60 iterations of (velocity * 0.016)
Mobile: 30 iterations of (velocity * 0.033)

Even if total time is same, numerical integration diverges due to:
- Floating point accumulation
- Frame timing jitter
- Different update frequencies
```

## The Real Issue: Two Separate Simulations

**Current architecture flaw**:
- Each client simulates their own player
- Host simulates all players
- They SHOULD match but don't because:
  - Different frame rates
  - Different deltaTime per frame
  - Accumulated floating point errors
  - Platform-specific input handling

**Why the simple GitHub version worked better**:
- Less complex simulation
- Simpler input handling
- No deltaTime in weird places

## The Fix Is NOT More Reconciliation

Adding more authority reconciliation (what we did today) tries to FORCE them to match.
But the underlying simulations still diverge, so you get:
- Jitter (constant corrections)
- Desync (corrections can't keep up with divergence rate)

## The REAL Fix Options

### Option A: Fixed-Timestep (Proper Solution)
Make all simulations run at exactly 30Hz regardless of frame rate.
- Desktop at 60fps: runs simulation 30 times/sec, renders 60 times/sec
- Mobile at 30fps: runs simulation 30 times/sec, renders 30 times/sec
- **Same integration, same results, no divergence**

### Option B: Host-Only Simulation (Simplest)
Clients don't simulate their own player, just send inputs.
Host simulates everything and broadcasts results.
- No divergence (only one simulation)
- Clients just interpolate received positions
- Downside: Local player has input lag

### Option C: Deterministic Simulation (Complex)
Ensure all platforms integrate physics identically.
- Use fixed-point math instead of floats
- Lockstep synchronization
- Way too complex for this game

### Option D: Increase Correction Strength (Bandaid)
What we tried today - doesn't fix root cause.
Fights symptoms but divergence continues.

## Recommended Solution

**Combination of A and B**:

1. **Host-only authority for remote players** (Option B)
   - Clients send inputs to host
   - Host simulates ALL players at fixed 30Hz (Option A)
   - Host broadcasts all positions
   - Clients interpolate smoothly

2. **Local player prediction** (for responsiveness)
   - Client simulates their own player locally (smooth immediate response)
   - Occasionally corrects from host authority (gentle, not every frame)
   - Use large thresholds to avoid jitter

3. **Fixed timestep on host only** (Option A, but simplified)
   - Only host needs deterministic simulation
   - Clients can run variable frame rate
   - Removes cross-platform divergence

## Why This Solves Everything

### For Jitter:
- Clients mostly trust their local simulation (smooth)
- Gentle corrections only when needed (no fighting)
- 120ms buffer for smooth interpolation

### For Desync:
- Host is single source of truth (no divergence)
- Fixed timestep on host (deterministic)
- All platforms receive same positions (no cross-platform issues)

### For Collisions:
- Host decides all collisions (authoritative)
- Clients see collisions happen based on interpolated positions
- Minor visual lag but consistent rules

## Implementation Priority

1. **Critical**: Fix cross-platform desync (host-only remote player simulation)
2. **High**: Reduce buffer to 120ms (less delay)
3. **Medium**: Add fixed timestep to host simulation
4. **Low**: Gentle local player corrections

## Key Decision Point

**Do we want:**
- **Smooth + slight visual offset** (client prediction + gentle corrections)
- **Perfect sync + possible jitter** (host authority + strong corrections)

For a casual game with friends, smooth is better than perfect.
