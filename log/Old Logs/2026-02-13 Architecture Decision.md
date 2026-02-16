# Architecture Decision: Jitter vs Complexity Trade-off

## Timestamp
2026-02-13 (post-jitter fixes analysis)

## Context
User reported that:
1. **Current local build**: Still has noticeable jitter despite all smoothing fixes
2. **GitHub hosted version (445e8f0)**: Almost no lag/jitter, but terrible player desync
3. **User's priorities** (in order):
   - World sync'd up with 2-5 players
   - No jittery/jumpy feeling
   - This is a casual game for friends (2-4 players, often physically nearby)
   - Anti-cheat is NOT a priority

## Root Cause Analysis

### Why GitHub Version Feels Smooth
Looking at commit 445e8f0:
- Buffer: 120ms (simple, fixed)
- No complex authority reconciliation
- No adaptive buffer system
- Simpler interpolation path

### Why Current Local Build Feels Jittery
Between 445e8f0 and now, significant complexity was added:
- Increased buffer to 220ms (now 140ms after today's fixes)
- Added host-authoritative simulation
- Added tick-based reconciliation system
- Added adaptive interpolation buffers
- Added RTT/jitter measurement and tuning
- Multiple reconciliation loops fighting each other

**The core architectural issue**: Simulation runs on frame time (variable), network runs on wall clock (fixed 30Hz). These drift apart under load.

### The Three Paths Forward

#### Option 1: Fixed-Timestep Simulation (Most Complex)
**What it solves**: Makes simulation deterministic, eliminates clock drift
**Complexity**: High - requires refactoring entire game loop
**Risk**: Could introduce new bugs in physics/movement
**Files affected**: Game.ts (core update loop), FlightController, all entity updates
**Time estimate**: Significant refactor, testing needed across all systems

#### Option 2: Revert to Simple Architecture (Least Complex)
**What it solves**: Return to smooth 120ms buffer system that worked
**Complexity**: Low - mostly removing code
**Risk**: Returns the "terrible desync" user mentioned
**But**: For 2-5 friends playing casually, how bad was the desync really?

#### Option 3: Hybrid - Keep Light Authority, Remove Heavy Reconciliation
**What it solves**: Balance between smoothness and basic sync
**Complexity**: Medium - selective removal/simplification
**Risk**: Moderate - need to find right balance

## Investigation: What Was the "Terrible Desync"?

Need to understand what the actual problem was with 445e8f0:
- Was it occasional position drift (tolerable)?
- Was it game-breaking (pigeon dies on client but not host)?
- Was it just visual offset between players?
- Was it accumulating over time?

## Recommendation Path

### Step 1: Benchmark the GitHub Version
Deploy current fixes but with much simpler architecture:
- Revert to 120ms fixed buffer
- Keep basic state sync but remove:
  - Local player reconciliation (reconcileLocalPlayerWithAuthority)
  - Adaptive buffer tuning
  - Stale packet dropping
  - Complex tick-based interpolation
- Keep:
  - Host authority for collisions/food
  - Basic remote player interpolation
  - Network message structure

### Step 2: Test with Friends
See if the "terrible desync" is actually terrible for casual play, or if it was over-engineered.

### Step 3: Add Minimal Authority If Needed
If desync is actually bad:
- Add periodic position corrections (not every frame)
- Use larger snap thresholds (only correct big errors)
- Don't fight the visual interpolation

## Key Insight from Logs

From `2026-02-13 2148 Log.md`:
> "Pure client-side lerp tuning has diminishing returns at this point."

This was written BEFORE the complexity was added. The implication: someone tried to solve jitter with MORE complexity, when the answer might be LESS.

## The Actual Problem Statement

**For a casual 2-5 player game between friends:**
- Do we need tick-perfect authority reconciliation? **No**
- Do we need adaptive buffer tuning? **Probably not**
- Do we need to prevent cheating? **Definitely not**
- Do we need smooth visual gameplay? **Yes**
- Do we need "good enough" sync for fun gameplay? **Yes**

## Decision: Simplify First, Add Back Only If Needed

### Phase 1: Simplification
1. Revert buffer to 120ms fixed (no adaptive tuning)
2. Remove local player reconciliation loop
3. Remove stale packet dropping (or make threshold much higher)
4. Simplify remote interpolation (basic lerp, no complex tick math)
5. Keep host authority for game events (food, collisions, rounds)

### Phase 2: Minimal Corrections
1. Occasional position snap for large errors only (>20 units)
2. Keep role/state sync (pigeon vs hawk, scores, etc.)
3. Let visual interpolation do its job without fighting it

### Phase 3: Test & Iterate
1. Test with 2-5 players in actual play scenarios
2. Only add back complexity if specific problems emerge
3. Measure: "Can friends play together and have fun?" not "Is this tick-perfect?"

## Why This Makes Sense

The GitHub version worked well enough for casual play. The complexity was added to solve edge cases that might not matter for the actual use case.

**Occam's Razor**: The simplest solution that works is often the best.

## Expected Outcome

- Jitter: Should be as good as GitHub version (very smooth)
- Desync: Will exist but probably tolerable for 2-5 friends
- Complexity: Much lower, easier to maintain
- Fun factor: Higher (smooth gameplay > perfect sync)

## Implementation Priority

1. **High**: Remove reconciliation complexity
2. **High**: Return to simple 120ms buffer
3. **Medium**: Keep host authority for game events
4. **Low**: Add back minimal corrections only if needed after testing

## Next Steps

Propose specific code changes to user:
- Show what to remove vs keep
- Explain trade-offs clearly
- Let user decide based on actual priorities
