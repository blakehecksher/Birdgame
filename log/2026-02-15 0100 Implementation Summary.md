# 2026-02-15 0100 — Netcode Improvement Implementation Summary

## What Changed in the Final Plan

Based on your feedback, the plan now includes:

### 1. **CRITICAL: Mobile Host Background Disconnect Fix** (Phase 0A)
**The Problem**: When you host on mobile, copy the room code, switch to Messages to send it to friends, and come back — the room is dead. Friends can't join with the code you just sent them.

**Why It Happens**: iOS Safari and Android Chrome kill WebRTC connections when apps go to background to save battery. The PeerJS connection dies, but the UI still shows the old room code.

**The Fix**:
- Add keep-alive pings every 10 seconds to keep connection active
- Listen for `visibilitychange`, `pagehide`, `pageshow` events
- When app comes back to foreground, check if connection is still alive
- If connection died, show clear error: "Room disconnected, please create new room"
- Add "Copy Room Code" button so you don't have to leave the app
- Show mobile-specific tip: "Keep this tab open while sharing!"

**Priority**: DO THIS FIRST. This is game-breaking for mobile hosts right now.

### 2. **Automated Testing Suite** (Phase 0B)
**The Problem**: You were testing manually with friends, which is slow and catches bugs late.

**The Solution**: Write automated tests that simulate network conditions:

**Test Files**:
- `tests/network/NetworkConditions.test.ts` - Tests latency, jitter, packet loss, interpolation, reconciliation
- `tests/network/CollisionSync.test.ts` - Tests collision detection under various network delays

**Network Conditions Simulated**:
- Same city: 20ms ± 5ms, 0.5% loss
- Cross-country: 80ms ± 15ms, 1% loss
- Bad WiFi: 50ms ± 30ms, 3% loss
- Mobile LTE: 60ms ± 40ms, 2% loss

**What It Catches**:
- Interpolation buffer underruns (jitter)
- Reconciliation not converging
- Collision false positives/negatives
- Mobile performance degradation
- Connection drop recovery

**How to Run**:
```bash
npm test -- tests/network/
npm test -- --coverage  # See test coverage
```

**Benefits**:
- Catch bugs BEFORE friend playtests
- Verify each phase doesn't break previous phases
- Test edge cases (packet loss, connection drops) you can't easily reproduce manually

---

## Phase 0 Priority Order

**Week 1, Day 1-2: CRITICAL FIX**
1. Mobile background disconnect fix
2. Test on iOS + Android
3. Verify desktop unaffected

**Week 1, Day 3: AUTOMATED TESTS**
4. Write network condition tests
5. Write collision sync tests
6. Verify all tests pass

**Week 1, Day 4: DEBUG TOOLS**
7. F3 debug console (network stats + collision hitboxes)
8. Network simulator for dev testing
9. Capture baseline metrics

---

## Why the Testing Suite Matters

Right now your process is:
1. Make code changes
2. Build and deploy to GitHub Pages
3. Text friends to playtest
4. Friends give feedback days later
5. Discover bugs, fix, repeat

With automated tests:
1. Make code changes
2. Run `npm test` locally (30 seconds)
3. See if anything broke immediately
4. Only deploy to friends when tests pass
5. Friend playtests focus on "feel" not "does it work"

**Time Saved**: Instead of 3-4 friend playtest cycles, you'll need 1-2.

---

## Updated Timeline

**Phase 0** (3-4 days):
- Day 1: Mobile background fix + testing
- Day 2: Automated test suite
- Day 3: Debug console + network simulator
- Day 4: Baseline metrics + integration testing

**Phase 1** (1-2 days):
- Tune parameters (buffer delay, reconciliation)
- Run automated tests to verify no regressions

**Phase 2** (1-2 days):
- Mobile-aware adaptive quality
- Test mobile hosting with automated tests

**Friend Playtests** (2-3 days):
- Cross-country test (you ↔ Seattle friend)
- Mobile host test (iPhone + Android)
- Collect feedback, adjust parameters

**Total: ~1.5 weeks** to ship Phases 0-2

---

## What You Need to Do

1. **Read the full plan**: [2026-02-15 0045 Final Netcode Improvement Plan.md](2026-02-15%200045%20Final%20Netcode%20Improvement%20Plan.md)

2. **Prioritize Phase 0A** (mobile fix): This is blocking mobile hosting right now

3. **Work with Codex on automated tests**: Give Codex the test file specifications from Phase 0B

4. **Use the debug console**: F3 toggle will help you see what's happening during development

5. **Tune parameters based on test results**: Don't guess — look at the metrics

---

## Key Insights from Your Answers

### Mobile is a First-Class Citizen
- Mobile can host (not just join)
- This is HARDER than desktop-only hosting
- Mobile browsers aggressively kill background tabs
- Mobile CPUs throttle under sustained load
- Need adaptive quality (auto-reduce tick rate on mobile)

### Target Audience: Friends, Mostly Same-City
- Primary: Same room / same city (< 30ms RTT)
- Secondary: Cross-country friends (60-120ms RTT)
- Don't over-optimize for > 150ms RTT (not your audience)

### Keep It Simple
- Avoid big refactors (no fixed timestep unless absolutely needed)
- Tune parameters first (70ms buffer, tighter reconciliation)
- Only do Phases 3-5 if Phases 0-2 aren't enough

### Testing Strategy
- You + local devices first (automated tests catch most bugs)
- Friends second (validate "feel", not functionality)
- Ship incrementally (each phase is a separate commit, easy to revert)

---

## What to Expect After Phases 0-2

### Same-City Play (< 30ms RTT)
**Before**: Pretty good
**After**: Excellent, no complaints

### Cross-Country (60-120ms RTT) - You ↔ Seattle
**Before**: "I hit them but it didn't count!" + jittery motion
**After**: Acceptable lag, smooth motion, occasional close calls (but fun)

### Mobile Hosting
**Before**: Room dies when you switch apps (BROKEN)
**After**: Stays alive for brief switches, clear error if dies, auto-reduces quality

### Debug Visibility
**Before**: Blind guessing when something feels off
**After**: Press F3, see RTT/jitter/reconciliation error, understand why

---

## Next Steps

1. ✅ Read full plan
2. ✅ Start with Phase 0A (mobile fix) — this is critical
3. ✅ Write automated tests (Phase 0B) — saves time later
4. ✅ Add debug console (Phase 0C) — helps with tuning
5. Then move to Phase 1 (parameter tuning)

The plan is comprehensive and ready for you or Codex to start implementing. Good luck!
