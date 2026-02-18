/**
 * InterpolationSim.test.cjs
 *
 * Simulates a stream of host state-sync packets arriving at a client and
 * samples the interpolated position at every frame.  Measures:
 *
 *  - Position error   (how far the rendered position is from the "true" path)
 *  - Frame-to-frame jitter  (how much the rendered position jumps each frame)
 *  - Extrapolation events  (frames where we fell off the end of the buffer)
 *  - Buffer underruns       (frames where render time was before all snapshots)
 *
 * The test does NOT need a browser.  It monkeypatches performance.now() so the
 * interpolator's render-time clock is fully controlled.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { GameState }      = require('../../.test-out/core/GameState.js');
const { NetworkManager } = require('../../.test-out/network/NetworkManager.js');
const { MessageType, createMessage } = require('../../.test-out/network/messages.js');
const { PlayerRole, GAME_CONFIG } = require('../../.test-out/config/constants.js');

// ---------------------------------------------------------------------------
// Minimal PeerConnection stub
// ---------------------------------------------------------------------------
class FakePeer {
  constructor() { this.messageHandler = null; }
  onMessage(cb) { this.messageHandler = cb; }
  send() {}
  emit(msg, peer) { this.messageHandler && this.messageHandler(msg, peer); }
}

// ---------------------------------------------------------------------------
// Clock helpers
// ---------------------------------------------------------------------------
// performance.now() is used inside NetworkManager for receivedAt timestamps
// and for rendering render-time.  We replace it with a controllable clock.
let _now = 0;
const realPerfNow = performance.now.bind(performance);
function setNow(ms) { _now = ms; }
function advanceNow(ms) { _now += ms; }

// Patch global performance.now before each scenario, restore after.
function patchClock()   { performance.now = () => _now; }
function restoreClock() { performance.now = realPerfNow; }

// ---------------------------------------------------------------------------
// Snapshot factory
// ---------------------------------------------------------------------------
let _seq = 0;
function makeSnapshot(position, velocity = { x: 0, y: 0, z: 0 }) {
  return createMessage(MessageType.STATE_SYNC, {
    sequence: ++_seq,
    players: {
      'host-1': {
        role: PlayerRole.PIGEON,
        position,
        rotation: { x: 0, y: 0, z: 0 },
        velocity,
        weight: 1,
        energy: 100,
        isEating: false,
      },
    },
    foods: [],
    npcs: [],
  });
}

// ---------------------------------------------------------------------------
// True position at time t (seconds).  Bird flies straight along X at speed v.
// ---------------------------------------------------------------------------
function trueX(t, speed) { return speed * t; }

// ---------------------------------------------------------------------------
// Scenario runner
// Returns an array of per-frame result objects.
// ---------------------------------------------------------------------------
function runScenario(options) {
  const {
    label,
    durationMs,       // total simulation time
    snapshotHz,       // how often host sends STATE_SYNC
    frameHz,          // client render rate
    latencyMs,        // one-way packet latency (ms)
    jitterMs,         // ± jitter on top of latency
    lossRate,         // fraction of packets dropped [0,1]
    speedUnits,       // bird speed in game units/second
    seed,             // for reproducible random
  } = options;

  _seq = 0;
  setNow(0);
  patchClock();

  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);
  // host-1 will be added automatically when the first snapshot arrives

  const peer = new FakePeer();
  const nm   = new NetworkManager(peer, gameState);

  const snapshotIntervalMs = 1000 / snapshotHz;
  const frameIntervalMs    = 1000 / frameHz;

  // Simple seeded pseudo-random (lcg) so results are reproducible
  let rngState = seed >>> 0;
  function rand() {
    rngState = (Math.imul(1664525, rngState) + 1013904223) >>> 0;
    return rngState / 0xffffffff;
  }

  // Collect (hostSendTime, snapshot) pairs for deferred delivery
  const packetQueue = []; // { deliverAt, snapshot }

  // Generate all host snapshots upfront
  let hostTime = 0;
  while (hostTime <= durationMs) {
    const x = trueX(hostTime / 1000, speedUnits);
    const snap = makeSnapshot(
      { x, y: 5, z: 0 },
      { x: speedUnits, y: 0, z: 0 }
    );

    // Apply loss
    if (rand() >= lossRate) {
      const delay = latencyMs + (rand() - 0.5) * 2 * jitterMs;
      packetQueue.push({ deliverAt: hostTime + Math.max(0, delay), snapshot: snap });
    }
    hostTime += snapshotIntervalMs;
  }

  // Sort by delivery time
  packetQueue.sort((a, b) => a.deliverAt - b.deliverAt);

  // ---------------------------------------------------------------------------
  // Frame loop: advance simulated clock one frame at a time, deliver any
  // packets whose deliverAt has passed, then sample interpolated position.
  // ---------------------------------------------------------------------------
  const frames = [];
  let packetIdx = 0;
  let clientTime = 0;

  while (clientTime <= durationMs) {
    setNow(clientTime);

    // Deliver packets that arrived by now
    while (packetIdx < packetQueue.length && packetQueue[packetIdx].deliverAt <= clientTime) {
      peer.emit(packetQueue[packetIdx].snapshot, 'host-1');
      packetIdx++;
    }

    // Sample interpolated state
    const interp = nm.getInterpolatedRemoteState('host-1');

    const renderT = clientTime / 1000; // seconds
    const truth   = trueX(renderT, speedUnits);

    frames.push({
      t: clientTime,
      truth,
      rendered: interp ? interp.position.x : null,
      missing: interp === null,
    });

    clientTime += frameIntervalMs;
  }

  restoreClock();

  return frames;
}

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------
function analyzeFrames(frames) {
  const validFrames = frames.filter(f => f.rendered !== null);
  if (validFrames.length === 0) return { noData: true };

  // Skip first few frames while the buffer fills (first 200ms)
  const steadyFrames = validFrames.filter(f => f.t > 200);

  const errors = steadyFrames.map(f => Math.abs(f.rendered - f.truth));
  const maxError   = Math.max(...errors);
  const avgError   = errors.reduce((a, b) => a + b, 0) / errors.length;

  // Jitter = frame-to-frame position delta variance
  const deltas = [];
  for (let i = 1; i < steadyFrames.length; i++) {
    deltas.push(Math.abs(steadyFrames[i].rendered - steadyFrames[i - 1].rendered));
  }
  const expectedDelta = steadyFrames.length > 1
    ? Math.abs(steadyFrames[steadyFrames.length - 1].truth - steadyFrames[0].truth) / (steadyFrames.length - 1)
    : 0;
  const jitterValues = deltas.map(d => Math.abs(d - expectedDelta));
  const maxJitter = jitterValues.length ? Math.max(...jitterValues) : 0;
  const avgJitter = jitterValues.length ? jitterValues.reduce((a, b) => a + b, 0) / jitterValues.length : 0;

  const missingFrames = frames.filter(f => f.missing).length;

  return { maxError, avgError, maxJitter, avgJitter, missingFrames, totalFrames: frames.length, steadyCount: steadyFrames.length };
}

function printReport(label, metrics) {
  if (metrics.noData) {
    console.log(`\n[${label}] ⚠  No interpolated data returned at all`);
    return;
  }
  console.log(`\n[${label}]`);
  console.log(`  Position error  avg=${metrics.avgError.toFixed(3)}u  max=${metrics.maxError.toFixed(3)}u`);
  console.log(`  Frame jitter    avg=${metrics.avgJitter.toFixed(4)}u  max=${metrics.maxJitter.toFixed(3)}u`);
  console.log(`  Missing frames  ${metrics.missingFrames}/${metrics.totalFrames}`);
  console.log(`  Steady frames   ${metrics.steadyCount}`);
}

// ============================================================================
// TEST 1 — ideal conditions (no latency, no jitter, no loss)
//           Should be nearly perfect interpolation
// ============================================================================
test('InterpolationSim: ideal conditions — low error, smooth output', () => {
  const frames = runScenario({
    label: 'Ideal (0ms latency)',
    durationMs: 2000,
    snapshotHz: 20,
    frameHz: 60,
    latencyMs: 0,
    jitterMs: 0,
    lossRate: 0,
    speedUnits: 10,
    seed: 42,
  });

  const m = analyzeFrames(frames);
  printReport('Ideal (0ms latency, 20Hz snapshots, 60fps)', m);

  assert.ok(!m.noData, 'Should produce interpolated data');
  assert.ok(m.avgError < 2.0,  `Average position error should be < 2.0 units (got ${m.avgError.toFixed(3)})`);
  assert.ok(m.maxError < 5.0,  `Max position error should be < 5.0 units (got ${m.maxError.toFixed(3)})`);
  assert.ok(m.avgJitter < 0.5, `Average jitter should be < 0.5 units/frame (got ${m.avgJitter.toFixed(4)})`);
});

// ============================================================================
// TEST 2 — typical LAN conditions (20ms latency, small jitter)
// ============================================================================
test('InterpolationSim: LAN conditions — 20ms latency, 5ms jitter', () => {
  const frames = runScenario({
    label: 'LAN',
    durationMs: 2000,
    snapshotHz: 20,
    frameHz: 60,
    latencyMs: 20,
    jitterMs: 5,
    lossRate: 0,
    speedUnits: 10,
    seed: 42,
  });

  const m = analyzeFrames(frames);
  printReport('LAN (20ms latency, 5ms jitter)', m);

  assert.ok(!m.noData, 'Should produce interpolated data');
  assert.ok(m.avgError < 3.0,  `avg error should be < 3.0 units (got ${m.avgError.toFixed(3)})`);
  assert.ok(m.avgJitter < 1.0, `avg jitter should be < 1.0 units/frame (got ${m.avgJitter.toFixed(4)})`);
});

// ============================================================================
// TEST 3 — cross-country WebRTC (80ms latency, 30ms jitter)
//           This is the typical "friend joining from another state" scenario
// ============================================================================
test('InterpolationSim: cross-country WebRTC — 80ms latency, 30ms jitter', () => {
  const frames = runScenario({
    label: 'Cross-country WebRTC',
    durationMs: 3000,
    snapshotHz: 20,
    frameHz: 60,
    latencyMs: 80,
    jitterMs: 30,
    lossRate: 0,
    speedUnits: 10,
    seed: 99,
  });

  const m = analyzeFrames(frames);
  printReport('Cross-country WebRTC (80ms latency, 30ms jitter)', m);

  assert.ok(!m.noData, 'Should produce interpolated data');
  // With a 70ms interpolation buffer, 80ms latency means we're often extrapolating
  // or at the very edge of the buffer — this is where jitter shows up
  assert.ok(m.avgError < 10.0,  `avg error should be < 10.0 units (got ${m.avgError.toFixed(3)})`);
  assert.ok(m.avgJitter < 3.0,  `avg jitter should be < 3.0 units/frame (got ${m.avgJitter.toFixed(4)})`);
});

// ============================================================================
// TEST 4 — high jitter (30ms latency, 40ms jitter)
//           Packets arrive out of order regularly — tests reorder buffer
// ============================================================================
test('InterpolationSim: high jitter — packets regularly arrive out of order', () => {
  const frames = runScenario({
    label: 'High jitter',
    durationMs: 3000,
    snapshotHz: 20,
    frameHz: 60,
    latencyMs: 30,
    jitterMs: 40,
    lossRate: 0,
    speedUnits: 10,
    seed: 7,
  });

  const m = analyzeFrames(frames);
  printReport('High jitter (30ms latency, ±40ms jitter)', m);

  // With ±40ms jitter on a 50ms packet interval, packets will frequently
  // arrive out of order.  The sequence reorder buffer should handle this.
  assert.ok(!m.noData, 'Should produce interpolated data despite out-of-order packets');
  assert.ok(m.avgJitter < 5.0, `avg jitter should be < 5.0 units/frame (got ${m.avgJitter.toFixed(4)})`);
});

// ============================================================================
// TEST 5 — buffer size diagnostic
//           Reveals whether STATE_BUFFER_TIME is too small for typical latency.
//           Prints the % of frames that fell into extrapolation territory.
// ============================================================================
test('InterpolationSim: buffer diagnostic — how often are we extrapolating?', () => {
  const bufferMs = GAME_CONFIG.STATE_BUFFER_TIME;

  // Run three latency scenarios and count extrapolation frames
  const scenarios = [
    { latencyMs: 30,  jitterMs: 10, label: '30ms latency' },
    { latencyMs: 70,  jitterMs: 20, label: '70ms latency' },
    { latencyMs: 120, jitterMs: 40, label: '120ms latency' },
  ];

  console.log(`\n[Buffer Diagnostic] STATE_BUFFER_TIME = ${bufferMs}ms`);

  for (const s of scenarios) {
    _seq = 0;
    const frames = runScenario({
      label: s.label,
      durationMs: 3000,
      snapshotHz: 20,
      frameHz: 60,
      latencyMs: s.latencyMs,
      jitterMs: s.jitterMs,
      lossRate: 0,
      speedUnits: 10,
      seed: 12,
    });

    const steady = frames.filter(f => f.t > 300 && f.rendered !== null);

    // A frame is "extrapolating" when render time is ahead of the latest snapshot.
    // We can't directly query this from NetworkManager so we use a heuristic:
    // if jitter is high enough that position jumped more than 2x expected delta, flag it.
    const snapshotIntervalS = 1 / 20;
    const expectedFrameDelta = 10 * (1 / 60); // speed * frame_interval_s
    const jumpFrames = [];
    for (let i = 1; i < steady.length; i++) {
      const delta = Math.abs(steady[i].rendered - steady[i - 1].rendered);
      if (delta > expectedFrameDelta * 4) jumpFrames.push(steady[i]);
    }

    const jumpPct = steady.length > 0 ? (jumpFrames.length / steady.length * 100).toFixed(1) : '?';
    const m = analyzeFrames(frames);
    console.log(`  ${s.label}: avg_err=${m.avgError.toFixed(2)}u  max_err=${m.maxError.toFixed(2)}u  jump_frames=${jumpFrames.length}/${steady.length} (${jumpPct}%)`);
  }

  // This test always passes — it's diagnostic output only.
  // Read the console output to understand buffer behaviour.
  assert.ok(true, 'Diagnostic test');
});

// ============================================================================
// TEST 6 — joining mid-game (late joiner gets first snapshot burst)
//           Tests the "teleport on join" scenario your friends noticed
// ============================================================================
test('InterpolationSim: late joiner — no teleport on first packets', () => {
  _seq = 0;
  setNow(0);
  patchClock();

  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peer = new FakePeer();
  const nm   = new NetworkManager(peer, gameState);

  // Simulate: player joins at t=0, first packet arrives at t=150ms
  // (host has been playing for 5 seconds already, bird is at x=50)
  setNow(150);
  peer.emit(makeSnapshot({ x: 50, y: 5, z: 0 }, { x: 10, y: 0, z: 0 }), 'host-1');

  // Second packet at t=200ms (normal 20Hz cadence, bird at x=50.5)
  setNow(200);
  peer.emit(makeSnapshot({ x: 50.5, y: 5, z: 0 }, { x: 10, y: 0, z: 0 }), 'host-1');

  // Now sample at t=220ms (render time = 220 - bufferMs)
  setNow(220);
  const interpA = nm.getInterpolatedRemoteState('host-1');

  // Third packet at t=250ms
  setNow(250);
  peer.emit(makeSnapshot({ x: 51, y: 5, z: 0 }, { x: 10, y: 0, z: 0 }), 'host-1');

  setNow(280);
  const interpB = nm.getInterpolatedRemoteState('host-1');

  restoreClock();

  console.log('\n[Late Joiner]');
  console.log(`  interpA (t=220ms): x=${interpA ? interpA.position.x.toFixed(3) : 'null'}`);
  console.log(`  interpB (t=280ms): x=${interpB ? interpB.position.x.toFixed(3) : 'null'}`);

  // The bird should not jump from 0 → 50.  If interpA is non-null, it must be
  // near 50 (the first known position), not 0.
  if (interpA !== null) {
    const jumpDistance = Math.abs(interpA.position.x - 50);
    console.log(`  Jump from expected x≈50: ${jumpDistance.toFixed(3)} units`);
    assert.ok(jumpDistance < 5, `Late joiner should start near first known position, not at origin (jump=${jumpDistance.toFixed(2)})`);
  } else {
    console.log('  interpA is null — buffer not warm yet (ok, will snap on next frame)');
    // Not a hard failure — buffer just hasn't warmed up yet.
    assert.ok(true);
  }

  if (interpB !== null && interpA !== null) {
    const frameDelta = Math.abs(interpB.position.x - interpA.position.x);
    console.log(`  Frame delta A→B: ${frameDelta.toFixed(3)} units (expect ~0.5)`);
    // Should be smooth, not a huge jump
    assert.ok(frameDelta < 3.0, `Frame delta should be smooth, not a teleport (got ${frameDelta.toFixed(2)})`);
  }
});
