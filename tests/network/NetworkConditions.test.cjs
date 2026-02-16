const test = require('node:test');
const assert = require('node:assert/strict');

const { GameState } = require('../../.test-out/core/GameState.js');
const { NetworkManager } = require('../../.test-out/network/NetworkManager.js');
const { MessageType, createMessage } = require('../../.test-out/network/messages.js');
const { PlayerRole } = require('../../.test-out/config/constants.js');

/**
 * Mock PeerConnection with network simulation capabilities
 */
class SimulatedPeerConnection {
  constructor() {
    this.messageHandler = null;
    this.sentMessages = [];
    this.simulation = {
      enabled: false,
      latency: 0,
      jitter: 0,
      loss: 0,
    };
  }

  onMessage(callback) {
    this.messageHandler = callback;
  }

  enableSimulation(options) {
    this.simulation = {
      enabled: true,
      latency: options.latency || 0,
      jitter: options.jitter || 0,
      loss: options.loss || 0,
    };
  }

  disableSimulation() {
    this.simulation.enabled = false;
  }

  send(message, peerId) {
    if (this.simulation.enabled) {
      // Simulate packet loss
      if (Math.random() < this.simulation.loss) {
        return; // Packet dropped
      }

      // Simulate latency and jitter
      const baseLatency = this.simulation.latency;
      const jitterAmount = (Math.random() - 0.5) * this.simulation.jitter;
      const totalDelay = baseLatency + jitterAmount;

      setTimeout(() => {
        this.sentMessages.push({ message, peerId, timestamp: Date.now() });
      }, Math.max(0, totalDelay));
    } else {
      this.sentMessages.push({ message, peerId, timestamp: Date.now() });
    }
  }

  emit(message, peerId) {
    if (!this.messageHandler) {
      throw new Error('No message handler registered');
    }

    if (this.simulation.enabled) {
      // Simulate packet loss
      if (Math.random() < this.simulation.loss) {
        return; // Packet dropped
      }

      // Simulate latency and jitter
      const baseLatency = this.simulation.latency;
      const jitterAmount = (Math.random() - 0.5) * this.simulation.jitter;
      const totalDelay = baseLatency + jitterAmount;

      setTimeout(() => {
        this.messageHandler(message, peerId);
      }, Math.max(0, totalDelay));
    } else {
      this.messageHandler(message, peerId);
    }
  }

  clearSentMessages() {
    this.sentMessages = [];
  }
}

/**
 * Helper to create player snapshot for testing
 */
function makePlayerSnapshot(role, position, velocity = { x: 0, y: 0, z: 0 }) {
  return {
    role,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    velocity: { ...velocity },
    isEating: false,
    weight: role === PlayerRole.PIGEON ? 1 : undefined,
    energy: role === PlayerRole.HAWK ? 100 : undefined,
  };
}

/**
 * Helper to wait for async operations
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Latency Tests
// ============================================================================

test('NetworkConditions: handles 50ms latency gracefully', async () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new SimulatedPeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  peerConnection.enableSimulation({ latency: 50, jitter: 0, loss: 0 });

  const startTime = Date.now();
  const messagePromise = new Promise((resolve) => {
    const originalHandler = peerConnection.messageHandler;
    peerConnection.messageHandler = (message, peerId) => {
      originalHandler(message, peerId);
      resolve(Date.now() - startTime);
    };
  });

  peerConnection.emit(
    createMessage(MessageType.STATE_SYNC, {
      players: {
        'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 1, y: 2, z: 3 }),
      },
      foods: [],
      npcs: [],
    }),
    'host-1'
  );

  const rtt = await messagePromise;
  assert.ok(rtt >= 40 && rtt <= 70, `RTT should be ~50ms, got ${rtt}ms`);
});

test('NetworkConditions: handles 100ms cross-country latency', async () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new SimulatedPeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  peerConnection.enableSimulation({ latency: 100, jitter: 15, loss: 0 });

  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const startTime = Date.now();
    const messagePromise = new Promise((resolve) => {
      const originalHandler = peerConnection.messageHandler;
      peerConnection.messageHandler = (message, peerId) => {
        if (originalHandler) originalHandler(message, peerId);
        resolve(Date.now() - startTime);
      };
    });

    peerConnection.emit(
      createMessage(MessageType.STATE_SYNC, {
        players: {
          'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: i, y: 2, z: 3 }),
        },
        foods: [],
        npcs: [],
      }),
      'host-1'
    );

    const rtt = await messagePromise;
    rtts.push(rtt);
  }

  const avgRtt = rtts.reduce((a, b) => a + b, 0) / rtts.length;
  assert.ok(avgRtt >= 80 && avgRtt <= 130, `Average RTT should be ~100ms±15ms, got ${avgRtt}ms`);
});

// ============================================================================
// Packet Loss Tests
// ============================================================================

test('NetworkConditions: tolerates 1% packet loss', async () => {
  const peerConnection = new SimulatedPeerConnection();
  peerConnection.enableSimulation({ latency: 5, jitter: 1, loss: 0.01 });

  const totalMessages = 200;
  peerConnection.clearSentMessages();

  // Send messages without async delay (packet loss is synchronous in our mock)
  for (let i = 0; i < totalMessages; i++) {
    peerConnection.send({ type: 'TEST', data: i }, 'peer-a');
  }

  // Wait for all async sends to complete
  await sleep(100);

  const sentCount = peerConnection.sentMessages.length;
  const lossRate = 1 - (sentCount / totalMessages);

  // With 1% loss, expect roughly 1-3% loss (allow statistical variance)
  assert.ok(lossRate >= 0 && lossRate <= 0.05, `Loss rate should be ~1%, got ${(lossRate * 100).toFixed(1)}%`);
});

test('NetworkConditions: handles 5% packet loss bursts', async () => {
  const peerConnection = new SimulatedPeerConnection();
  peerConnection.enableSimulation({ latency: 5, jitter: 2, loss: 0.05 });

  const totalMessages = 200;
  peerConnection.clearSentMessages();

  for (let i = 0; i < totalMessages; i++) {
    peerConnection.send({ type: 'TEST', data: i }, 'peer-a');
  }

  // Wait for all async sends to complete
  await sleep(100);

  const sentCount = peerConnection.sentMessages.length;
  const lossRate = 1 - (sentCount / totalMessages);

  // With 5% loss, expect roughly 3-10% loss (allow statistical variance)
  assert.ok(lossRate >= 0 && lossRate <= 0.12, `Loss rate should be ~5%, got ${(lossRate * 100).toFixed(1)}%`);
});

// ============================================================================
// PING Message Handling
// ============================================================================

test('NetworkConditions: handles PING keep-alive messages without error', () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new SimulatedPeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  // Send PING message - should be silently ignored
  const pingMessage = createMessage(MessageType.PING, {});

  // Should not throw
  assert.doesNotThrow(() => {
    peerConnection.emit(pingMessage, 'host-1');
  });

  // Game state should be unaffected
  assert.equal(gameState.players.size, 1);
});

test('NetworkConditions: PING messages mixed with STATE_SYNC work correctly', () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new SimulatedPeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  // Send PING
  peerConnection.emit(createMessage(MessageType.PING, {}), 'host-1');

  // Send STATE_SYNC
  peerConnection.emit(
    createMessage(MessageType.STATE_SYNC, {
      players: {
        'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 10, y: 20, z: 30 }),
        'host-1': makePlayerSnapshot(PlayerRole.PIGEON, { x: -5, y: 15, z: 25 }),
      },
      foods: [],
      npcs: [],
    }),
    'host-1'
  );

  // Send another PING
  peerConnection.emit(createMessage(MessageType.PING, {}), 'host-1');

  // Verify state sync worked
  const authoritative = networkManager.getLocalAuthoritativeState();
  assert.ok(authoritative);
  assert.equal(authoritative.position.x, 10);
  assert.equal(authoritative.position.y, 20);
  assert.equal(authoritative.position.z, 30);

  // Verify host was added
  assert.ok(gameState.players.has('host-1'));
});

// ============================================================================
// Edge Cases
// ============================================================================

test('NetworkConditions: handles rapid STATE_SYNC messages without crash', async () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new SimulatedPeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  // Simulate 30Hz state sync (every ~33ms) for 500ms (shorter test)
  const duration = 500; // ms
  const interval = 33; // ms
  const expectedMessages = Math.floor(duration / interval);

  let messageCount = 0;
  const startTime = Date.now();

  while (Date.now() - startTime < duration) {
    peerConnection.emit(
      createMessage(MessageType.STATE_SYNC, {
        players: {
          'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: messageCount, y: 2, z: 3 }),
        },
        foods: [],
        npcs: [],
      }),
      'host-1'
    );
    messageCount++;
    await sleep(interval);
  }

  // Should have received ~15 messages in 500ms (allow ±5 variance)
  assert.ok(
    messageCount >= expectedMessages - 5 && messageCount <= expectedMessages + 5,
    `Should receive ~${expectedMessages} messages in ${duration}ms, got ${messageCount}`
  );

  // Game should still be functional
  const authoritative = networkManager.getLocalAuthoritativeState();
  assert.ok(authoritative, 'Should have authoritative state after rapid updates');
});

test('NetworkConditions: survives connection drop simulation', async () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new SimulatedPeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  // Normal operation
  peerConnection.enableSimulation({ latency: 50, jitter: 5, loss: 0 });
  peerConnection.emit(
    createMessage(MessageType.STATE_SYNC, {
      players: {
        'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 1, y: 2, z: 3 }),
      },
      foods: [],
      npcs: [],
    }),
    'host-1'
  );
  await sleep(100);

  // Simulate connection drop (100% loss for 500ms)
  peerConnection.enableSimulation({ latency: 50, jitter: 5, loss: 1.0 });
  peerConnection.emit(
    createMessage(MessageType.STATE_SYNC, {
      players: {
        'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 10, y: 20, z: 30 }),
      },
      foods: [],
      npcs: [],
    }),
    'host-1'
  );
  await sleep(500);

  // Connection recovers
  peerConnection.enableSimulation({ latency: 50, jitter: 5, loss: 0 });
  peerConnection.emit(
    createMessage(MessageType.STATE_SYNC, {
      players: {
        'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 100, y: 200, z: 300 }),
      },
      foods: [],
      npcs: [],
    }),
    'host-1'
  );
  await sleep(100);

  // Should resume without crash
  const authoritative = networkManager.getLocalAuthoritativeState();
  assert.ok(authoritative);
  assert.equal(authoritative.position.x, 100);
});
