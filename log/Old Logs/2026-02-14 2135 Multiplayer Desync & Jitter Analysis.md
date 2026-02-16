# 2026-02-14 2135 — Multiplayer Desync & Jitter Analysis

## Symptom
Players report that hawk-catches-pigeon collisions "feel like they should hit" but don't register. Remote players also appear slightly jittery/jumpy during play.

## Architecture Summary (for context)

- **Host-authoritative**: Host runs physics and collision for ALL players. Clients send input; host sends back state.
- **30 Hz tick rate**: Both input sends (client→host) and state sync (host→client) are throttled to ~33ms intervals.
- **WebRTC DataChannel** via PeerJS, configured as `reliable: true` (TCP-like ordered delivery).
- **120ms interpolation buffer**: Clients render remote players 120ms behind real-time to smooth between snapshots.
- **Client-side prediction**: Clients apply their own input locally for responsiveness, then reconcile with host authority.

---

## Root Causes Identified

### 1. Variable Timestep Physics (Drift Source)

**File:** `Game.ts:654-671`

The game loop uses `requestAnimationFrame` with a variable `deltaTime`:

```
deltaTime = (performance.now() - lastTime) / 1000;
cappedDelta = Math.min(deltaTime, 0.1);
```

Movement physics (`FlightController.applyInput`) runs with this variable dt. If the host is at 60fps (~16.7ms frames) and a client is at 45fps (~22ms frames), identical inputs produce slightly different positions over time due to floating-point accumulation differences in velocity/drag/turn calculations.

**Impact:** Gradual positional drift between what the client predicts and where the host says the player actually is. This drift is the root of the "felt like it hit" problem — positions are close but not identical.

### 2. The 120ms Interpolation Delay

**File:** `NetworkManager.ts:435`, `constants.ts:69`

```
STATE_BUFFER_TIME: 120  // ms
renderTimestamp = Date.now() - 120
```

Clients display remote players at where they were **120ms ago**. This means:
- The hawk player sees the pigeon 120ms in the past
- The pigeon player sees the hawk 120ms in the past
- But collision is checked on the host using **current** positions

So both players see a "hit" on their screens that the host never sees, because the host's real-time positions have already diverged from what the clients are rendering.

**Impact:** This is the single biggest contributor to "it looked like it hit but didn't." 120ms at hawk speed (10 units/sec base, up to 20 with dive) means the pigeon can be **1.2–2.4 units** away from where the hawk player sees it.

### 3. 30Hz Sync Rate + Reliable Channel = Jitter

**Files:** `constants.ts:68`, `PeerConnection.ts:70`

State updates arrive every ~33ms, but the game renders at 60fps (16ms frames). Between sync messages, the client interpolates — which works well in steady-state. But:

- **Reliable ordered delivery** means if one packet is lost, ALL subsequent packets are held until retransmission completes (head-of-line blocking). A single dropped WebRTC SCTP packet can cause a 50-200ms stall followed by a burst of messages.
- When this happens, the interpolation buffer runs dry and the client either freezes the remote player or extrapolates (capped at 100ms). When the burst arrives, the player "jumps" to catch up.

**Impact:** This is the jitter. It's not constant — it happens in spikes when the network has packet loss. Reliable channels amplify jitter compared to unreliable ones.

### 4. Reconciliation Tuning Issues

**File:** `Game.ts:1842-1874`

The client reconciliation for its OWN position (not remote players) has these thresholds:
- Error < 0.4 units: no correction (dead zone)
- Error 0.4–5.0 units: soft lerp at `alpha = min(0.22, deltaTime * 10)`
- Error > 5.0 units: hard snap

Problems:
- **0.4 unit dead zone is too wide.** At game speeds, 0.4 units of uncorrected error means the client's predicted position and the host's authoritative position can stay permanently diverged by up to 0.4 units. Since collision ellipsoids are only ~1.4–2.0 units combined radius, that 0.4 error is 20-28% of the collision distance.
- **Lerp alpha of 0.22 is quite gentle.** It takes multiple frames to converge, during which the error persists.
- **Runs at 30Hz, not every frame.** Between corrections, the client continues to drift further.

### 5. No Input Delay Compensation on Host

When the host receives a client's input, it applies it to the current simulation frame — but that input was generated 30-80ms ago (network RTT + send throttle). The host doesn't account for this delay, so the remote player's movement on the host is always slightly behind where the client thinks they are.

For collision, this means the hawk (if played by a client) is checking against a pigeon position that's correct on the host, but the hawk's own position on the host is ~50ms stale compared to what the hawk player sees locally.

---

## Latency Budget Breakdown

For a client playing hawk, trying to catch a client playing pigeon:

| Step | Delay |
|---|---|
| Hawk input → network send (throttled 30Hz) | 0–33ms |
| Network transit (one-way) | 20–80ms |
| Host applies input, runs physics | 0–16ms |
| Host broadcasts state (throttled 30Hz) | 0–33ms |
| Network transit back | 20–80ms |
| Client interpolation buffer | 120ms |
| **Total effective delay** | **~160–360ms** |

At hawk dive speed of 20 units/sec, 250ms of effective lag means positions can differ by **5 units** — larger than the entire collision ellipsoid.

---

## Why It Feels OK Locally But Not Online

Local play has zero network delay. Both players' positions are computed on the same machine in the same frame. The variable timestep issue still exists but is negligible because there's no network RTT amplifying the drift. The interpolation buffer and reconciliation code are bypassed entirely for the host's own players.

---

## Jitter Summary

The jitter comes from three compounding sources:
1. **Head-of-line blocking** from reliable WebRTC channels causing bursty delivery
2. **30Hz update rate** leaving gaps that interpolation/extrapolation must fill
3. **Reconciliation snaps** when client prediction diverges too far and lerps back

---

## Potential Fix Directions (Not Implementing Yet)

1. **Fixed timestep physics** — Decouple physics from render framerate. Run physics at a fixed 60Hz with an accumulator pattern. Both host and client simulate identically.
2. **Reduce interpolation delay** — Drop `STATE_BUFFER_TIME` from 120ms to 50-80ms. Trades smoothness for responsiveness.
3. **Tighten reconciliation** — Reduce dead zone from 0.4 to 0.1-0.2, increase lerp alpha, run every frame instead of 30Hz.
4. **Unreliable channel for state sync** — PeerJS supports `reliable: false`. Eliminates head-of-line blocking. Lost packets are simply skipped (interpolation handles gaps).
5. **Increase tick rate** — Bump from 30Hz to 60Hz for tighter sync. More bandwidth but smaller interpolation gaps.
6. **Server-side lag compensation** — When checking collision, rewind positions by the estimated RTT to check "where was the pigeon when the hawk actually pressed the button?"
7. **Collision forgiveness window** — Slightly expand online collision radii or check collision across a small time window rather than a single instant.

## Files Examined

- `src/core/Game.ts` — Game loop (line 654), update flow (862-935), collision (938-946, 1143-1157), reconciliation (1842-1874)
- `src/network/NetworkManager.ts` — State sync send/receive, interpolation (402-493), buffer management
- `src/network/PeerConnection.ts` — WebRTC setup, reliable:true on line 70
- `src/config/constants.ts` — TICK_RATE: 30, STATE_BUFFER_TIME: 120
- `src/physics/CollisionDetector.ts` — Ellipsoid collision check
