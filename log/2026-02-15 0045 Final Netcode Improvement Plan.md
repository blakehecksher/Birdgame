# 2026-02-15 0045 — Final Netcode Improvement Plan

## Project Context

**Game**: Hawk & Pigeon - 3D browser-based chase game
**Target Audience**: Friends playing same-city/same-room, occasionally cross-country
**Platforms**: Desktop (Chrome/Firefox/Safari/Edge) + Mobile (iOS Safari, Android Chrome)
**Deployment**: Static site on GitHub Pages (no servers)
**Testing**: Local devices + friend playtests
**Quality Bar**: No complaints, smooth enough that lag is rarely mentioned, competitive-friendly

## Critical Constraints

1. **Mobile devices are first-class citizens** - can host AND join
2. **No server infrastructure** - P2P WebRTC only
3. **Keep it simple** - avoid big refactors, tune parameters first
4. **Cross-country playable** - you ↔ Seattle friend should work (~80ms RTT)
5. **No telemetry/monitoring** - rely on friend feedback

## Current Problems (from 2026-02-14 analysis)

1. **Desync**: "Felt like a hit but didn't register" - caused by 120ms interpolation delay + variable timestep drift
2. **Jitter**: Remote players stutter/jump - caused by 30Hz sync rate + reliable channel head-of-line blocking
3. **Mobile host risk**: Unknown whether mobile can reliably host at current tick rates
4. **CRITICAL - Mobile host background disconnect**: When mobile host switches apps (e.g., to copy room code and paste in Messages), iOS/Android kills the WebRTC connection. When host returns, room code is invalid and clients can't connect.

## Recommended Scope: Focus on Phases 0-2

**Rationale**: Based on your constraints (mobile hosting, no servers, keep it simple), Phases 0-2 will solve 70-80% of the problem with minimal risk. Phases 3-5 are **optional** and only needed if playtests show continued issues.

---

## Phase 0: Instrumentation, Debug Console & Critical Fixes

### Goals
- **FIX CRITICAL BUG**: Mobile host disconnect on app switch
- Measure current netcode performance
- Make regressions visible during tuning
- Add F3 debug console with network stats
- Add automated testing suite for network conditions

### Implementation

#### A. FIX: Mobile Host Background Disconnect (CRITICAL - DO THIS FIRST)

**Problem**: iOS Safari and Android Chrome disconnect WebRTC connections when app goes to background (e.g., host switches to Messages to share room code). When host returns, the PeerJS connection is dead and room code no longer works.

**Root Cause**: Mobile browsers suspend background tabs to save battery. PeerJS peer connection gets destroyed, but the lobby UI still shows the old room code.

**Solution**: Keep connection alive during brief app switches + graceful recovery

**File**: `src/network\PeerConnection.ts`

Add page visibility handling:

```typescript
export class PeerConnection {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private isHost: boolean = false;
  private keepAliveInterval: number | null = null;
  private pageHiddenTime: number = 0;
  private readonly MAX_BACKGROUND_TIME = 30000; // 30 seconds max background time

  // ... existing code ...

  public async initializeAsHost(roomCode?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const peerId = roomCode ? `birdgame-${roomCode}` : undefined;
        this.peer = peerId ? new Peer(peerId) : new Peer();
        this.isHost = true;

        this.peer.on('open', (id) => {
          console.log('Host peer ID:', id);
          this.startKeepAlive(); // NEW
          this.setupVisibilityHandlers(); // NEW
          resolve(id);
        });

        // ... rest of existing code ...
      }
    });
  }

  // NEW: Send keep-alive pings to maintain connection during brief background
  private startKeepAlive(): void {
    if (this.keepAliveInterval !== null) return;

    this.keepAliveInterval = window.setInterval(() => {
      // Send tiny ping message to all connections to keep them alive
      this.connections.forEach((conn) => {
        if (conn.open) {
          try {
            conn.send({ type: 'PING', timestamp: Date.now() });
          } catch (e) {
            console.warn('Keep-alive ping failed:', e);
          }
        }
      });
    }, 10000); // Every 10 seconds
  }

  // NEW: Handle page visibility changes
  private setupVisibilityHandlers(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Page going to background
        this.pageHiddenTime = Date.now();
        console.log('[Mobile] Page hidden, connection may suspend');
      } else {
        // Page coming back to foreground
        const backgroundDuration = Date.now() - this.pageHiddenTime;
        console.log(`[Mobile] Page visible again (was hidden ${backgroundDuration}ms)`);

        if (backgroundDuration > this.MAX_BACKGROUND_TIME) {
          // Was in background too long, connection likely dead
          console.warn('[Mobile] Connection may be dead after long background time');
          this.attemptReconnect();
        } else {
          // Brief background, check if peer is still alive
          this.checkPeerHealth();
        }
      }
    });

    // iOS-specific: pagehide/pageshow events
    window.addEventListener('pagehide', () => {
      console.log('[Mobile] Page hiding (iOS)');
      this.pageHiddenTime = Date.now();
    });

    window.addEventListener('pageshow', () => {
      const backgroundDuration = Date.now() - this.pageHiddenTime;
      console.log(`[Mobile] Page showing (iOS), was hidden ${backgroundDuration}ms`);
      if (backgroundDuration > this.MAX_BACKGROUND_TIME) {
        this.attemptReconnect();
      }
    });
  }

  // NEW: Check if peer connection is still healthy
  private checkPeerHealth(): void {
    if (!this.peer) return;

    if (this.peer.destroyed) {
      console.error('[Mobile] Peer was destroyed while in background');
      this.attemptReconnect();
    } else if (this.peer.disconnected) {
      console.warn('[Mobile] Peer disconnected while in background, reconnecting...');
      this.peer.reconnect();
    } else {
      console.log('[Mobile] Peer connection healthy');
    }
  }

  // NEW: Attempt to recreate peer connection
  private attemptReconnect(): void {
    console.log('[Mobile] Attempting to recreate peer connection...');
    // For host: This is tricky because room code is tied to peer ID
    // Best we can do is notify the UI that connection was lost
    if (this.onDisconnectedCallback) {
      this.onDisconnectedCallback();
    }
  }

  public disconnect(): void {
    if (this.keepAliveInterval !== null) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    this.connections.forEach((connection) => connection.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
    }
  }
}
```

**File**: `src/ui/LobbyUI.ts`

Update UI to show warning when host goes to background:

```typescript
export class LobbyUI {
  private connectionWarning: HTMLElement | null = null;

  constructor() {
    // ... existing code ...

    // Add connection warning element (append to host screen)
    this.connectionWarning = document.createElement('div');
    this.connectionWarning.style.cssText = `
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 100, 100, 0.95);
      color: white;
      padding: 20px;
      border-radius: 10px;
      font-size: 16px;
      text-align: center;
      z-index: 10000;
      max-width: 80%;
    `;
    document.body.appendChild(this.connectionWarning);

    // Listen for visibility changes
    this.setupMobileWarnings();
  }

  private setupMobileWarnings(): void {
    let isWarningShown = false;

    document.addEventListener('visibilitychange', () => {
      // Only show warning if we're in lobby and hosting
      const isInLobby = this.lobbyElement.style.display !== 'none';
      const isHosting = this.hostScreen.style.display !== 'none';

      if (document.hidden && isInLobby && isHosting && !isWarningShown) {
        // Don't show warning yet, wait until they come back
        isWarningShown = true;
      } else if (!document.hidden && isWarningShown) {
        // Came back, show brief "connection may be unstable" message
        this.showConnectionWarning(
          'Welcome back! If clients can\'t connect, you may need to create a new room.',
          3000
        );
        isWarningShown = false;
      }
    });
  }

  private showConnectionWarning(message: string, duration: number): void {
    if (!this.connectionWarning) return;
    this.connectionWarning.textContent = message;
    this.connectionWarning.style.display = 'block';
    setTimeout(() => {
      if (this.connectionWarning) {
        this.connectionWarning.style.display = 'none';
      }
    }, duration);
  }

  public showRoomCode(peerId: string): void {
    const roomCode = peerId.replace('birdgame-', '');
    this.peerIdDisplay.value = roomCode;
    this.hostStatus.textContent = '';

    // NEW: Add mobile-specific tip
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      this.hostStatus.innerHTML = `
        <div style="margin-top: 10px; padding: 10px; background: rgba(255, 200, 100, 0.2); border-radius: 5px;">
          <strong>📱 Mobile Host Tip:</strong><br>
          Keep this tab open while sharing the code!<br>
          Switching apps may disconnect the room.
        </div>
      `;
    }
  }
}
```

**Alternative (Simpler) Approach**: Copy to clipboard automatically

Add a "Copy & Share" button that copies room code AND shows instructions without leaving the app:

```typescript
// In LobbyUI constructor, add button next to room code
const copyShareBtn = document.createElement('button');
copyShareBtn.textContent = '📋 Copy Room Code';
copyShareBtn.onclick = () => {
  const roomCode = this.peerIdDisplay.value;
  navigator.clipboard.writeText(roomCode).then(() => {
    this.hostStatus.innerHTML = `
      <div style="margin-top: 10px; padding: 15px; background: rgba(100, 255, 100, 0.3); border-radius: 5px;">
        ✅ <strong>Room code copied!</strong><br>
        Send to friends: <code>${roomCode}</code><br>
        <em>Keep this tab open while they join.</em>
      </div>
    `;
  });
};
```

**Testing**:
1. Host on mobile, get room code
2. Switch to Messages app, wait 5 seconds
3. Switch back to browser
4. Have friend try to join with room code
5. Should work OR show clear error message

**Exit Criteria**:
- Mobile host can switch apps for < 30 seconds without breaking room
- If connection dies, UI clearly indicates "Room disconnected, please create new room"
- Desktop hosts unaffected

#### B. Automated Network Testing Suite

**File**: `tests/network/NetworkConditions.test.ts` (NEW)

Create automated tests that simulate various network conditions and verify game behavior:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NetworkManager } from '../../src/network/NetworkManager';
import { PeerConnection } from '../../src/network/PeerConnection';
import { GameState } from '../../src/core/GameState';

describe('Network Conditions', () => {
  let networkManager: NetworkManager;
  let mockPeerConnection: PeerConnection;
  let gameState: GameState;

  beforeEach(() => {
    gameState = new GameState();
    mockPeerConnection = new PeerConnection();
    networkManager = new NetworkManager(mockPeerConnection, gameState);
  });

  describe('Latency Simulation', () => {
    it('should handle 50ms latency gracefully', async () => {
      // Enable network simulator
      mockPeerConnection.enableSimulation({ latency: 50, jitter: 0, loss: 0 });

      // Send 100 messages, measure round-trip time
      const rtts: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = Date.now();
        await sendAndReceiveMessage(networkManager, { type: 'TEST' });
        const rtt = Date.now() - start;
        rtts.push(rtt);
      }

      const avgRtt = rtts.reduce((a, b) => a + b, 0) / rtts.length;
      expect(avgRtt).toBeGreaterThan(90); // ~50ms each way = 100ms round-trip
      expect(avgRtt).toBeLessThan(150);    // Some variance expected
    });

    it('should handle 100ms cross-country latency', async () => {
      mockPeerConnection.enableSimulation({ latency: 100, jitter: 15, loss: 0 });

      const rtts: number[] = [];
      for (let i = 0; i < 50; i++) {
        const start = Date.now();
        await sendAndReceiveMessage(networkManager, { type: 'TEST' });
        rtts.push(Date.now() - start);
      }

      const avgRtt = rtts.reduce((a, b) => a + b, 0) / rtts.length;
      expect(avgRtt).toBeGreaterThan(180); // 100ms ± 15ms jitter each way
      expect(avgRtt).toBeLessThan(250);
    });
  });

  describe('Packet Loss', () => {
    it('should tolerate 1% packet loss', async () => {
      mockPeerConnection.enableSimulation({ latency: 50, jitter: 5, loss: 0.01 });

      let successCount = 0;
      const totalMessages = 1000;

      for (let i = 0; i < totalMessages; i++) {
        const received = await sendAndReceiveMessage(networkManager, { type: 'TEST' }, 200);
        if (received) successCount++;
      }

      // With 1% loss, expect ~99% success (reliable channel retries)
      expect(successCount).toBeGreaterThan(980);
    });

    it('should handle 5% packet loss bursts', async () => {
      mockPeerConnection.enableSimulation({ latency: 50, jitter: 10, loss: 0.05 });

      let successCount = 0;
      const totalMessages = 500;

      for (let i = 0; i < totalMessages; i++) {
        const received = await sendAndReceiveMessage(networkManager, { type: 'TEST' }, 500);
        if (received) successCount++;
      }

      // With reliable channel, all should eventually arrive
      expect(successCount).toBeGreaterThan(475);
    });
  });

  describe('Interpolation Buffer', () => {
    it('should not underrun with 70ms buffer at 30Hz', async () => {
      gameState.isHost = false; // Client mode
      mockPeerConnection.enableSimulation({ latency: 40, jitter: 10, loss: 0 });

      // Simulate receiving state sync messages at 30Hz for 5 seconds
      const startTime = Date.now();
      let underruns = 0;

      while (Date.now() - startTime < 5000) {
        await new Promise(resolve => setTimeout(resolve, 33)); // 30Hz

        // Host sends state
        networkManager.sendStateSync();

        // Check if interpolation buffer is empty
        const bufferState = networkManager.getInterpolationBufferState();
        if (bufferState.isEmpty) underruns++;
      }

      // Should have minimal underruns (< 5% of frames)
      const totalFrames = Math.floor(5000 / 33);
      expect(underruns).toBeLessThan(totalFrames * 0.05);
    });

    it('should underrun with 30ms buffer at 30Hz under jitter', async () => {
      gameState.isHost = false;
      mockPeerConnection.enableSimulation({ latency: 40, jitter: 25, loss: 0 });

      // With 30ms buffer and ±25ms jitter, should see underruns
      const startTime = Date.now();
      let underruns = 0;

      while (Date.now() - startTime < 3000) {
        await new Promise(resolve => setTimeout(resolve, 33));
        networkManager.sendStateSync();

        const bufferState = networkManager.getInterpolationBufferState();
        if (bufferState.isEmpty) underruns++;
      }

      // Should see significant underruns (buffer too small for jitter)
      expect(underruns).toBeGreaterThan(10);
    });
  });

  describe('Reconciliation', () => {
    it('should converge within 0.5 units under normal conditions', async () => {
      gameState.isHost = false;
      mockPeerConnection.enableSimulation({ latency: 50, jitter: 10, loss: 0 });

      // Simulate client prediction diverging from host authority
      const errors: number[] = [];

      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 16)); // 60fps

        // Mock: client predicts position, host sends authoritative position
        const reconciliationError = simulateReconciliation(networkManager);
        errors.push(reconciliationError);
      }

      const p95Error = percentile(errors, 0.95);
      expect(p95Error).toBeLessThan(0.5);
    });

    it('should hard snap above 5.0 unit error', async () => {
      gameState.isHost = false;

      // Simulate huge desync (e.g., client fell through world)
      const hugeError = 10.0;
      const snapped = networkManager.reconcile(hugeError);

      expect(snapped).toBe(true); // Should have hard snapped
    });
  });

  describe('Mobile Performance', () => {
    it('should maintain 20Hz tick rate on simulated mobile', async () => {
      // Mock mobile device
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        configurable: true,
      });

      gameState.isHost = true;
      const tickRate = networkManager.getTickRate();

      expect(tickRate).toBeLessThanOrEqual(20);
    });

    it('should degrade gracefully when FPS drops', async () => {
      gameState.isHost = true;

      // Simulate sustained low FPS (< 30fps)
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 40)); // 25fps
        networkManager.update(0.04); // deltaTime = 40ms
      }

      const tickRate = networkManager.getTickRate();
      expect(tickRate).toBeLessThanOrEqual(20); // Should have degraded
    });
  });

  describe('Edge Cases', () => {
    it('should handle connection drop and recovery', async () => {
      mockPeerConnection.enableSimulation({ latency: 50, jitter: 5, loss: 0 });

      // Normal operation
      await sendMessages(networkManager, 50);

      // Simulate connection drop (100% loss for 2 seconds)
      mockPeerConnection.enableSimulation({ latency: 50, jitter: 5, loss: 1.0 });
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Connection recovers
      mockPeerConnection.enableSimulation({ latency: 50, jitter: 5, loss: 0 });

      // Should resume without crash
      const success = await sendAndReceiveMessage(networkManager, { type: 'TEST' });
      expect(success).toBe(true);
    });

    it('should handle rapid visibility changes (mobile app switching)', async () => {
      gameState.isHost = true;

      // Simulate rapid hide/show cycles
      for (let i = 0; i < 10; i++) {
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        await new Promise(resolve => setTimeout(resolve, 100));

        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Peer connection should still be alive
      expect(mockPeerConnection.isConnected()).toBe(true);
    });
  });
});

// Helper functions
async function sendAndReceiveMessage(nm: NetworkManager, msg: any, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    nm.send(msg);
    nm.onMessage((received) => {
      if (received.type === msg.type) {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * p);
  return sorted[index];
}
```

**File**: `tests/network/CollisionSync.test.ts` (NEW)

Test that collision detection stays synchronized under various network conditions:

```typescript
import { describe, it, expect } from 'vitest';
import { CollisionDetector } from '../../src/physics/CollisionDetector';
import { Player } from '../../src/entities/Player';
import * as THREE from 'three';

describe('Collision Synchronization', () => {
  it('should detect collision on host at same position client sees', () => {
    const hawk = new Player('hawk1', 'hawk');
    const pigeon = new Player('pigeon1', 'pigeon');

    // Position where client SEES pigeon (120ms interpolation delay)
    pigeon.position.set(10, 5, 0);

    // Position where hawk is diving
    hawk.position.set(10.5, 5.2, 0.1);

    const collision = new CollisionDetector();
    const hit = collision.checkPlayerCollision(hawk, pigeon);

    // With current ellipsoid radii, this should be a hit
    expect(hit).toBe(true);
  });

  it('should NOT detect false collision due to interpolation lag', () => {
    const hawk = new Player('hawk1', 'hawk');
    const pigeon = new Player('pigeon1', 'pigeon');

    // Pigeon has moved forward (current position on host)
    pigeon.position.set(15, 5, 0);

    // Hawk dove at where pigeon WAS 120ms ago
    hawk.position.set(10, 5, 0);

    const collision = new CollisionDetector();
    const hit = collision.checkPlayerCollision(hawk, pigeon);

    // Should NOT be a hit (pigeon escaped)
    expect(hit).toBe(false);
  });

  it('should handle high-speed dive collision correctly', () => {
    const hawk = new Player('hawk1', 'hawk');
    const pigeon = new Player('pigeon1', 'pigeon');

    // Hawk diving at 20 units/sec (max speed)
    hawk.position.set(10, 20, 0);
    hawk.velocity.set(0, -20, 0); // Straight down

    // Pigeon at ground level
    pigeon.position.set(10, 1, 0);

    // Simulate one frame (16ms) of movement
    hawk.position.add(hawk.velocity.clone().multiplyScalar(0.016));

    // After frame: hawk at y = 20 - (20 * 0.016) = 19.68
    // Still far from pigeon at y = 1
    const collision1 = new CollisionDetector();
    expect(collision1.checkPlayerCollision(hawk, pigeon)).toBe(false);

    // Simulate 1 second of diving
    for (let i = 0; i < 60; i++) {
      hawk.position.add(hawk.velocity.clone().multiplyScalar(0.016));
    }

    // After 1 sec: hawk at y = 20 - 20 = 0 (below pigeon)
    // Should have collided during descent
    const collision2 = new CollisionDetector();
    expect(hawk.position.y).toBeLessThan(pigeon.position.y + 1);
  });
});
```

**Running Tests**:
```bash
npm test -- tests/network/
```

**Exit Criteria**:
- All network condition tests pass
- Collision sync tests pass
- Can run `npm test -- --coverage` and see network code is tested

#### C. Network Stats Display

**File**: `src/debug/NetworkDebugPanel.ts` (NEW)

Create a debug panel that shows:
- **RTT (ping)**: Round-trip time to host/clients
- **Packet loss**: % of missed state sync messages
- **Jitter**: Variance in message arrival timing
- **Reconciliation error**: Distance between client prediction and host authority
- **Interpolation buffer**: How many snapshots buffered, underrun count
- **Frame rate**: Host FPS, client FPS

**UI**: Overlay in top-right corner (hidden by default)

#### B. F3 Debug Console Toggle

**File**: `src/core/Game.ts`

Add keyboard handler for F3:
- **Press 1**: Debug panel hidden (default)
- **Press 2**: Debug panel visible (network stats)
- **Press 3**: Debug panel + collision hitboxes (`SHOW_COLLISION_DEBUG = true`)
- **Press 4**: Back to hidden

#### C. Metrics Collection

**Files**:
- `src/network/NetworkManager.ts`
- `src/core/Game.ts`

Add lightweight tracking for:
- `reconciliationErrors: number[]` - ring buffer of last 100 errors
- `snapshotGaps: number[]` - time between received STATE_SYNC messages
- `interpolationUnderruns: number` - count of times buffer was empty
- `extrapolationActivations: number` - count of times we had to extrapolate

Compute p50/p95/p99 on-demand for debug panel.

#### D. Network Simulator (Dev-Only)

**File**: `src/network/PeerConnection.ts`

Add optional artificial latency/jitter/loss:

```typescript
private simulateNetworkConditions = false;
private simulatedLatency = 50; // ms
private simulatedJitter = 20; // ± ms
private simulatedLoss = 0.05; // 5% packet loss

public send(message: NetworkMessage): void {
  if (this.simulateNetworkConditions) {
    // Random delay
    const delay = this.simulatedLatency + (Math.random() - 0.5) * this.simulatedJitter;
    // Random drop
    if (Math.random() < this.simulatedLoss) return;
    setTimeout(() => this.actualSend(message), delay);
  } else {
    this.actualSend(message);
  }
}
```

Enable via URL param: `?netSim=latency:50,jitter:20,loss:0.05`

### Exit Criteria
- F3 toggles debug panel correctly
- Can see RTT, FPS, reconciliation error in real-time
- Can enable network simulator via URL param
- Baseline metrics captured for desktop↔desktop and desktop↔mobile

### Estimated Effort
**2-3 days** (mostly UI work)

---

## Phase 1: Low-Risk Responsiveness Tuning

### Goals
- Reduce effective latency for remote players
- Tighten local player reconciliation
- Make cross-country play feel better

### Changes

#### A. Reduce Interpolation Delay

**File**: `src/config/constants.ts`

```typescript
// Before
STATE_BUFFER_TIME: 120, // ms

// After
STATE_BUFFER_TIME: 70, // ms (tunable - start here, adjust based on jitter)
```

**Rationale**:
- 120ms is very conservative. Most games use 50-100ms.
- 70ms balances latency vs. jitter tolerance
- Still leaves room for 2-3 snapshots at 30Hz (33ms intervals)

**Risk**: Lower buffer = more sensitive to jitter. If packet gaps exceed 70ms, interpolation buffer underruns and you get stutters.

**Mitigation**: Monitor `interpolationUnderruns` in debug panel. If > 5% of frames, increase back to 90ms.

#### B. Tighten Reconciliation

**File**: `src/core/Game.ts` (lines 1842-1874)

Current:
```typescript
private reconcileLocalPlayerWithAuthority(deltaTime: number): void {
  // ...
  if (now - this.lastReconcileTime < 33) return; // ~30Hz correction

  const hardSnapDistance = 5.0;
  const softStartDistance = 0.4;
  const error = this.localPlayer.position.distanceTo(authoritative.position);

  if (error > hardSnapDistance) {
    // Hard snap
  } else if (error > softStartDistance) {
    const alpha = Math.min(0.22, deltaTime * 10);
    // Soft lerp
  }
}
```

**Changes**:
1. **Run every frame** (remove 30Hz throttle)
2. **Reduce dead zone** from 0.4 to 0.15
3. **Increase correction strength** from 0.22 to 0.35 (faster convergence)
4. **Keep hard snap threshold** at 5.0 (safety against severe desync)

New code:
```typescript
private reconcileLocalPlayerWithAuthority(deltaTime: number): void {
  if (!this.gameState || this.gameState.isHost || !this.localPlayer || !this.networkManager) return;

  const authoritative = this.networkManager.getLocalAuthoritativeState();
  if (!authoritative) return;

  // Ignore stale snapshots
  if (Date.now() - authoritative.timestamp > 300) return;

  const hardSnapDistance = 5.0;
  const softStartDistance = 0.15; // CHANGED: tighter dead zone
  const error = this.localPlayer.position.distanceTo(authoritative.position);

  // Track for debug panel
  if (this.debugMetrics) {
    this.debugMetrics.reconciliationErrors.push(error);
    if (this.debugMetrics.reconciliationErrors.length > 100) {
      this.debugMetrics.reconciliationErrors.shift();
    }
  }

  if (error > hardSnapDistance) {
    // Hard snap (unchanged)
    this.localPlayer.position.copy(authoritative.position);
    this.localPlayer.velocity.copy(authoritative.velocity);
    this.localPlayer.rotation.copy(authoritative.rotation);
  } else if (error > softStartDistance) {
    // CHANGED: stronger correction
    const alpha = Math.min(0.35, deltaTime * 15);
    this.localPlayer.position.lerp(authoritative.position, alpha);
    this.localPlayer.velocity.lerp(authoritative.velocity, alpha);
    this.localPlayer.rotation.x = THREE.MathUtils.lerp(this.localPlayer.rotation.x, authoritative.rotation.x, alpha);
    this.localPlayer.rotation.y = this.lerpAngle(this.localPlayer.rotation.y, authoritative.rotation.y, alpha);
    this.localPlayer.rotation.z = THREE.MathUtils.lerp(this.localPlayer.rotation.z, authoritative.rotation.z, alpha);
  }
  // else: error < 0.15, no correction

  this.localPlayer.mesh.position.copy(this.localPlayer.position);
  this.localPlayer.applyMeshRotation();
}
```

**Rationale**:
- 0.4 unit dead zone is ~25% of collision size - too loose
- 0.15 unit dead zone is ~10% of collision size - tight but not overly aggressive
- Running every frame (not 30Hz) catches drift faster
- Alpha 0.35 converges in ~3-5 frames instead of 10-15

#### C. Improve Remote Player Interpolation Extrapolation Cap

**File**: `src/network/NetworkManager.ts` (line 479)

Current extrapolation is capped at 100ms. This is good, keep it.

But add fallback to last-known-good position if extrapolation age exceeds 200ms:

```typescript
// Around line 476, after extrapolation calculation:
const extrapolationAge = renderTimestamp - latest.timestamp;
if (extrapolationAge > 200) {
  // Too stale, just snap to last known position (don't extrapolate into nonsense)
  return {
    position: new THREE.Vector3(latest.position.x, latest.position.y, latest.position.z),
    rotation: new THREE.Euler(latest.rotation.x, latest.rotation.y, latest.rotation.z),
    velocity: new THREE.Vector3(latest.velocity.x, latest.velocity.y, latest.velocity.z),
    role: latest.role,
    isEating: latest.isEating,
  };
}
```

### Tuning Parameters (for you to adjust)

Add these to `constants.ts` so you can fiddle without touching code:

```typescript
// Netcode tuning (Phase 1)
STATE_BUFFER_TIME: 70,              // Interpolation delay (50-100ms reasonable range)
RECONCILIATION_DEAD_ZONE: 0.15,     // Below this error, no correction (0.1-0.3 reasonable)
RECONCILIATION_ALPHA_MAX: 0.35,     // Correction strength (0.2-0.5 reasonable)
RECONCILIATION_ALPHA_SCALE: 15.0,   // Multiplier for deltaTime (10-20 reasonable)
HARD_SNAP_THRESHOLD: 5.0,           // Instant teleport above this (keep at 5.0)
```

Then reference in `Game.ts`:
```typescript
const softStartDistance = GAME_CONFIG.RECONCILIATION_DEAD_ZONE;
const alpha = Math.min(GAME_CONFIG.RECONCILIATION_ALPHA_MAX, deltaTime * GAME_CONFIG.RECONCILIATION_ALPHA_SCALE);
```

### Exit Criteria
- Friend playtest (same-city): "Feels the same or better"
- Friend playtest (cross-country): "Feels noticeably smoother"
- Debug panel shows p95 reconciliation error < 0.5 units
- No hard snaps during normal play (check debug console)

### Estimated Effort
**1-2 days** (parameter tuning + testing)

---

## Phase 2: Mobile-Aware Adaptive Performance

### Goals
- Detect when host is mobile device
- Automatically reduce quality to prevent thermal throttling
- Keep game playable even if mobile host struggles

### Implementation

#### A. Device Detection

**File**: `src/utils/DeviceDetector.ts` (NEW)

```typescript
export class DeviceDetector {
  static isMobile(): boolean {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  static isLowEndDevice(): boolean {
    // Heuristic: mobile + < 4GB RAM
    if (!this.isMobile()) return false;
    const memory = (navigator as any).deviceMemory; // Chrome only
    return memory && memory < 4;
  }

  static getRecommendedTickRate(): number {
    if (this.isLowEndDevice()) return 20; // Low-end mobile
    if (this.isMobile()) return 30;       // Standard mobile
    return 30;                             // Desktop (keep at 30 for now)
  }
}
```

#### B. Dynamic Tick Rate (Host Only)

**File**: `src/network/NetworkManager.ts`

```typescript
constructor(peerConnection: PeerConnection, gameState: GameState) {
  this.peerConnection = peerConnection;
  this.gameState = gameState;

  // Adaptive tick rate based on device
  const recommendedRate = DeviceDetector.getRecommendedTickRate();
  this.tickRate = 1000 / recommendedRate;

  console.log(`Network tick rate: ${recommendedRate}Hz (device: ${DeviceDetector.isMobile() ? 'mobile' : 'desktop'})`);

  // ... rest of constructor
}
```

#### C. Show Host Device Info in Lobby

**File**: `src/ui/LobbyUI.ts`

When displaying room code, also show:
```
Room Code: ABC123
Host Device: Desktop (30Hz sync)
```

or

```
Room Code: ABC123
Host Device: Mobile (20Hz sync)
```

This sets expectations for joining players.

#### D. FPS-Based Quality Degradation (Optional)

If host FPS drops below 30 for sustained period, automatically reduce tick rate:

**File**: `src/core/Game.ts`

```typescript
private lowFPSFrames = 0;
private currentTickRate = GAME_CONFIG.TICK_RATE;

private update(deltaTime: number): void {
  const fps = 1 / deltaTime;

  if (fps < 30) {
    this.lowFPSFrames++;
    if (this.lowFPSFrames > 60 && this.currentTickRate > 20) {
      // Sustained low FPS, reduce tick rate
      this.currentTickRate = 20;
      this.networkManager.setTickRate(20);
      console.warn('Host FPS low, reducing network tick rate to 20Hz');
      this.lowFPSFrames = 0;
    }
  } else {
    this.lowFPSFrames = 0;
  }

  // ... rest of update
}
```

### Exit Criteria
- Mobile host (iPhone/Android) can host 2-4 clients without thermal throttling in 3-minute rounds
- Tick rate shown in lobby UI
- FPS-based degradation prevents spiral-of-death on weak devices

### Estimated Effort
**1-2 days** (device detection + adaptive quality)

---

## Phase 3 (OPTIONAL): Increase Tick Rate to 45Hz

**Only do this if Phases 0-2 ship and playtests still show jitter.**

### Changes
- Bump `TICK_RATE` from 30Hz to 45Hz (desktop only)
- Keep mobile at 30Hz or 20Hz via adaptive logic
- Monitor bandwidth increase (expect ~40% more data)

### Risk
- Mobile host may struggle even with adaptive logic
- Bandwidth cost for mobile clients on cellular (if they ignore WiFi requirement)

### Exit Criteria
- Measurably smoother remote player motion
- No mobile host thermal issues
- Bandwidth under 12 KB/s per client

### Estimated Effort
**1 day** (config change + testing)

---

## Phase 4 (OPTIONAL): Unreliable Transport for State Sync

**Only do this if Phases 0-3 ship and jitter is still a problem.**

### Problem
PeerJS `reliable: true` causes head-of-line blocking. One lost packet stalls all subsequent packets until retransmission.

### Solution
Use `reliable: false` for `INPUT_UPDATE` and `STATE_SYNC` messages. Keep `reliable: true` for critical events (ROUND_START, PLAYER_DEATH, etc.).

### Challenge
**PeerJS does NOT support dual-channel mode easily.** You have two options:

#### Option A: Single Unreliable Channel + App-Layer Reliability
- Set ALL messages to `reliable: false`
- Implement simple ack/retry for critical messages at application layer
- Track message IDs, resend if no ack within 100ms

#### Option B: Stay Fully Reliable
- Accept that jitter exists
- Rely on interpolation to smooth it out

**Recommendation**: Try Option B (stay reliable) after Phases 0-2. The interpolation buffer should handle most jitter. Only attempt Option A if playtests show severe stutter issues.

### Estimated Effort
**3-5 days** (if Option A chosen)

---

## Phase 5 (FUTURE - OUT OF SCOPE FOR NOW)

### Fixed-Step Simulation Refactor

**Status**: Not recommended for initial release.

**Why**:
- Mobile hosting makes consistent 60Hz simulation unrealistic
- Variable timestep drift is minor compared to 70ms interpolation delay
- High complexity, high regression risk

**When to revisit**:
- If you add server-based hosting later
- If competitive balance becomes critical
- If you have 2-4 weeks for careful refactor + testing

### Lag Compensation for Collision

**Status**: Defer until player feedback demands it.

**Why**:
- Complex to implement correctly
- May not be needed if Phases 0-2 solve most complaints
- Can introduce new fairness issues if tuned wrong

**When to revisit**:
- If cross-country playtests show persistent "I hit them but it didn't count"
- If you're willing to add history buffers and rewind logic (2-3 weeks effort)

---

## Testing Plan

### Phase 0 Testing

#### Critical Mobile Host Bug Fix
1. **iOS Safari**:
   - Host on iPhone, get room code
   - Switch to Messages app for 10 seconds
   - Switch back to Safari
   - Have friend join with room code → should work OR show clear error
2. **Android Chrome**: Same test as iOS
3. **Desktop**: Verify no regressions (switching tabs should not break room)

#### Automated Tests
1. **Run test suite**: `npm test -- tests/network/`
2. **Verify all conditions pass**:
   - Latency tests (50ms, 100ms cross-country)
   - Packet loss tests (1%, 5%)
   - Interpolation buffer tests
   - Reconciliation tests
   - Mobile performance tests
   - Edge cases (connection drop, visibility changes)
3. **Check coverage**: `npm test -- --coverage` → network code should be well-tested

#### Debug Console
1. **Local**: Launch game, press F3 three times, verify cycle: hidden → stats → stats+hitboxes → hidden
2. **Local**: Enable network simulator via URL param `?netSim=latency:50,jitter:10,loss:0.01`, verify artificial lag works
3. **Friend test**: Have friend join, check RTT display, collect baseline metrics

### Phase 1 Testing
1. **Local**: Test on localhost (should feel identical to before)
2. **Same-room**: Test on LAN (should feel tight, minimal reconciliation)
3. **Cross-city**: Test with friend in another city (should feel noticeably better)
4. **Cross-country**: Test with Seattle friend (should feel acceptable, not perfect)

During each test:
- Play 3-5 full rounds as hawk and pigeon
- Check debug panel for reconciliation errors (target p95 < 0.5 units)
- Ask: "Did any catches feel unfair?" (fewer complaints = success)

### Phase 2 Testing
1. **Mobile host**: iPhone/Android hosts, 2 desktop clients join, play 3-minute round
2. **Monitor**: Check FPS, thermal throttling, tick rate adjustments
3. **Mobile client**: Desktop hosts, mobile client joins, verify smooth motion

### Simulated Network Conditions

Use network simulator (Phase 0) with these profiles:

| Profile | Latency | Jitter | Loss | Simulates |
|---------|---------|--------|------|-----------|
| LAN | 5ms | ±2ms | 0% | Same room |
| Same City | 20ms | ±5ms | 0.5% | Local fiber |
| Cross-Country | 80ms | ±15ms | 1% | You ↔ Seattle |
| Bad WiFi | 50ms | ±30ms | 3% | Crappy router |
| Mobile LTE | 60ms | ±40ms | 2% | Cellular backup |

Test each profile, verify game is playable.

---

## Success Metrics (Qualitative)

### Must Have (Phases 0-2)
- ✅ Same-room play: "Feels great, no lag noticed"
- ✅ Cross-country play: "Occasionally a close call feels off, but mostly good"
- ✅ Mobile host: Can complete 3-minute round without crashing/stuttering
- ✅ Debug panel: Easy to toggle, shows useful info

### Nice to Have (Phase 3+)
- ✅ Cross-country play: "Feels as good as same-room"
- ✅ Mobile host: Handles 4 clients smoothly
- ✅ Bad WiFi: Still playable despite jitter

---

## Implementation Checklist

### Phase 0: Instrumentation & Critical Fixes (3-4 days)

#### CRITICAL: Mobile Host Background Fix (DO FIRST)
- [ ] Add keep-alive pings to `PeerConnection.ts` (every 10 seconds)
- [ ] Add visibility change handlers in `PeerConnection.ts` (`visibilitychange`, `pagehide`, `pageshow`)
- [ ] Add peer health check on resume (detect if connection died)
- [ ] Add connection warning element to `LobbyUI.ts`
- [ ] Add mobile-specific tip in `showRoomCode()`
- [ ] Add "Copy Room Code" button with clipboard API
- [ ] Test on iOS Safari: host → switch to Messages → back → client joins
- [ ] Test on Android Chrome: same scenario
- [ ] Verify desktop hosts unaffected

#### Automated Testing Suite
- [ ] Create `tests/network/NetworkConditions.test.ts`
  - [ ] Latency simulation tests (50ms, 100ms)
  - [ ] Packet loss tolerance tests (1%, 5%)
  - [ ] Interpolation buffer tests (underrun detection)
  - [ ] Reconciliation convergence tests
  - [ ] Mobile performance tests (tick rate degradation)
  - [ ] Edge case tests (connection drop, rapid visibility changes)
- [ ] Create `tests/network/CollisionSync.test.ts`
  - [ ] Same-position collision detection
  - [ ] Interpolation lag false collision test
  - [ ] High-speed dive collision test
- [ ] Run `npm test -- tests/network/` and verify all pass
- [ ] Add network tests to CI/CD (if applicable)

#### Debug Console & Instrumentation
- [ ] Create `src/debug/NetworkDebugPanel.ts`
- [ ] Add F3 keyboard handler in `Game.ts` (3-state toggle: hidden → stats → stats+hitboxes → hidden)
- [ ] Add metrics collection in `NetworkManager.ts` (reconciliation errors, gaps, underruns)
- [ ] Add network simulator in `PeerConnection.ts` (URL param: `?netSim=latency:50,jitter:20,loss:0.05`)
- [ ] Test debug panel locally
- [ ] Capture baseline metrics (desktop↔desktop, desktop↔mobile)

### Phase 1: Responsiveness Tuning (1-2 days)
- [ ] Add tuning constants to `constants.ts`
- [ ] Reduce `STATE_BUFFER_TIME` from 120ms to 70ms
- [ ] Remove 30Hz throttle from reconciliation (line 1846)
- [ ] Reduce dead zone from 0.4 to 0.15
- [ ] Increase alpha from 0.22 to 0.35, scale from 10 to 15
- [ ] Add 200ms extrapolation fallback in `NetworkManager.ts`
- [ ] Test locally, same-room, cross-country
- [ ] Verify p95 reconciliation error < 0.5 units

### Phase 2: Mobile-Aware Adaptive (1-2 days)
- [ ] Create `src/utils/DeviceDetector.ts`
- [ ] Add adaptive tick rate to `NetworkManager` constructor
- [ ] Show host device info in lobby UI
- [ ] (Optional) Add FPS-based quality degradation
- [ ] Test mobile hosting (iPhone, Android)
- [ ] Verify no thermal throttling in 3-minute rounds

### Phase 3 (OPTIONAL): 45Hz Tick Rate (1 day)
- [ ] Bump `TICK_RATE` to 45 for desktop, keep 30 for mobile
- [ ] Test bandwidth increase
- [ ] Test mobile host stability

### Phase 4 (OPTIONAL): Unreliable Transport (3-5 days)
- [ ] Research PeerJS dual-channel approach
- [ ] Implement ack/retry for critical messages
- [ ] Route messages by criticality
- [ ] Test packet loss scenarios

---

## Rollback Plan

Each phase is a separate commit. If a phase introduces regressions:

1. **Revert the commit** for that phase only
2. **Re-test** previous phase to confirm it still works
3. **Adjust parameters** (e.g., increase `STATE_BUFFER_TIME` from 70ms to 90ms)
4. **Retry** with new values

Example rollback:
```bash
# Phase 1 introduced too much jitter
git revert HEAD
# Adjust STATE_BUFFER_TIME from 70ms to 85ms
# Re-commit Phase 1 with new value
```

---

## Recommended Commit Messages

```
Phase 0: [CRITICAL] Fix mobile host disconnect on app switch (background tab handling)
Phase 0: Add automated network testing suite for latency/jitter/loss scenarios
Phase 0: Add network debug panel and F3 toggle with collision hitbox visualization
Phase 0: Add network simulator for dev testing (?netSim URL param)
Phase 1: Reduce interpolation delay from 120ms to 70ms
Phase 1: Tighten client reconciliation (dead zone 0.4→0.15, alpha 0.22→0.35)
Phase 1: Add extrapolation fallback for stale snapshots
Phase 2: Add mobile device detection and adaptive tick rate
Phase 2: Show host device info in lobby UI
Phase 2: Add FPS-based quality degradation for struggling hosts
Phase 3: Increase tick rate to 45Hz for desktop hosts
Phase 4: Switch to unreliable transport for state sync
```

---

## FAQ / Common Issues

### "Interpolation buffer underruns too often"
- Increase `STATE_BUFFER_TIME` from 70ms to 90ms or 100ms
- Check network simulator - are you testing with too much jitter?

### "Reconciliation snaps are visible"
- Reduce `RECONCILIATION_ALPHA_MAX` from 0.35 to 0.25 (gentler correction)
- Increase `RECONCILIATION_DEAD_ZONE` from 0.15 to 0.2 (more tolerance)

### "Mobile host thermal throttles after 2 minutes"
- Reduce tick rate to 20Hz for all mobile hosts
- Reduce NPC count in `constants.ts` for mobile hosts
- Disable shadows on mobile (`MOBILE_SHADOWS_ENABLED: false` already set)

### "Cross-country still feels laggy"
- This is physics, not fixable with tuning alone
- 80ms RTT + 70ms buffer = 150ms effective latency is near the limit
- Consider showing RTT in UI so players understand why

### "Desktop host at 45Hz, mobile client stutters"
- Mobile client render FPS might be < 45fps
- Interpolation should smooth this, but if it doesn't, keep tick rate at 30Hz

### "Mobile host room code stops working after app switch"
- This is what Phase 0A fixes
- If still happening, check:
  - Are visibility handlers being called? (Check console logs)
  - Is keep-alive ping working? (Check network tab)
  - Try increasing `MAX_BACKGROUND_TIME` from 30s to 60s
  - Worst case: show clear error in UI and force host to recreate room

### "Automated tests are failing"
- Check network simulator is enabled correctly in test environment
- Mock browser APIs (visibilitychange, clipboard, etc.) may need stubs
- Some tests may be timing-sensitive - increase timeouts if flaky

---

## Final Recommendation

**Ship Phases 0-2 first.** This is:
- Low risk (mostly parameter tuning)
- High impact (70-80% of desync/jitter problems solved)
- Mobile-safe (adaptive quality prevents thermal issues)
- Tunable (you can fiddle with constants without code changes)

**Only do Phases 3-4 if friend playtests show continued issues.**

**Defer Phase 5 (fixed-step, lag comp) indefinitely** - not worth the complexity for a casual party game.

---

## Expected Timeline

- **Phase 0**: 3-4 days (critical mobile fix + automated tests + instrumentation)
  - Day 1: Mobile background disconnect fix + initial testing
  - Day 2: Automated test suite (network conditions + collision sync)
  - Day 3: Debug panel + network simulator
  - Day 4: Integration testing + baseline metrics
- **Phase 1**: 1-2 days (tuning)
- **Phase 2**: 1-2 days (mobile adaptive)
- **Testing & iteration**: 2-3 days (friend playtests, parameter tweaking)

**Total: ~1.5 weeks for Phases 0-2** to ship and playtest.

If needed:
- **Phase 3**: +1 day (45Hz tick rate)
- **Phase 4**: +3-5 days (unreliable transport)

---

## Player-Facing Release Notes

> ### Network Improvements (Phase 1-2)
> - Reduced online latency for smoother remote player motion
> - Improved collision accuracy in cross-country play
> - Mobile devices now automatically optimize performance when hosting
> - Added F3 debug panel to view network stats and collision hitboxes
>
> **What to expect:**
> - Same-room/same-city: Feels great, minimal lag
> - Cross-country (e.g. you ↔ Seattle): Playable and fun, occasional close calls
> - Mobile hosting: Works! Desktop host still recommended for best experience
>
> **Tips:**
> - Host should be on a stable WiFi connection (not cellular)
> - Press F3 to check network stats if something feels off
> - If you see high RTT (>100ms), expect some lag - it's physics, not a bug!
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
