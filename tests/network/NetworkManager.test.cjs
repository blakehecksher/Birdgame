const test = require('node:test');
const assert = require('node:assert/strict');

const { GameState } = require('../../.test-out/core/GameState.js');
const { NetworkManager } = require('../../.test-out/network/NetworkManager.js');
const { MessageType, createMessage } = require('../../.test-out/network/messages.js');
const { PlayerRole } = require('../../.test-out/config/constants.js');

class FakePeerConnection {
  constructor() {
    this.messageHandler = null;
    this.sentMessages = [];
  }

  onMessage(callback) {
    this.messageHandler = callback;
  }

  send(message, peerId) {
    this.sentMessages.push({ message, peerId });
  }

  emit(message, peerId) {
    if (!this.messageHandler) {
      throw new Error('No message handler registered');
    }
    this.messageHandler(message, peerId);
  }
}

function makePlayerSnapshot(role, position) {
  return {
    role,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    isEating: false,
    weight: role === PlayerRole.PIGEON ? 1 : undefined,
    energy: role === PlayerRole.HAWK ? 100 : undefined,
  };
}

test('host caches input per peer and consumes mouse deltas independently', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);
  gameState.addPlayer('peer-b', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  peerConnection.emit(
    createMessage(MessageType.INPUT_UPDATE, {
      input: { forward: 1, strafe: 0, ascend: 0.25, mouseX: 3, mouseY: -1 },
    }),
    'peer-a'
  );
  peerConnection.emit(
    createMessage(MessageType.INPUT_UPDATE, {
      input: { forward: -1, strafe: 0.5, ascend: 0, mouseX: -2, mouseY: 4 },
    }),
    'peer-b'
  );

  assert.deepEqual(networkManager.getRemoteInput('peer-a'), {
    forward: 1,
    strafe: 0,
    ascend: 0.25,
    mouseX: 3,
    mouseY: -1,
    scrollDelta: 0,
  });
  assert.deepEqual(networkManager.getRemoteInput('peer-b'), {
    forward: 0,
    strafe: 0.5,
    ascend: 0,
    mouseX: -2,
    mouseY: 4,
    scrollDelta: 0,
  });

  peerConnection.emit(
    createMessage(MessageType.INPUT_UPDATE, {
      input: { forward: 0.5, strafe: 0, ascend: 0, mouseX: 1, mouseY: 2 },
    }),
    'peer-a'
  );

  assert.deepEqual(networkManager.getRemoteInput('peer-a'), {
    forward: 0.5,
    strafe: 0,
    ascend: 0,
    mouseX: 1,
    mouseY: 2,
    scrollDelta: 0,
  });

  assert.deepEqual(networkManager.getRemoteInput('peer-b'), {
    forward: 0,
    strafe: 0.5,
    ascend: 0,
    mouseX: 0,
    mouseY: 0,
    scrollDelta: 0,
  });
});

test('host neutralizes stale remote input after packet gap', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;

  try {
    peerConnection.emit(
      createMessage(MessageType.INPUT_UPDATE, {
        input: { forward: 1, strafe: 0.3, ascend: 0.2, mouseX: 4, mouseY: -2 },
      }),
      'peer-a'
    );

    assert.deepEqual(networkManager.getRemoteInput('peer-a'), {
      forward: 1,
      strafe: 0.3,
      ascend: 0.2,
      mouseX: 4,
      mouseY: -2,
      scrollDelta: 0,
    });

    now += 350;

    assert.deepEqual(networkManager.getRemoteInput('peer-a'), {
      forward: 0,
      strafe: 0,
      ascend: 0,
      mouseX: 0,
      mouseY: 0,
      scrollDelta: 0,
    });
  } finally {
    Date.now = originalNow;
  }
});

test('host state sync includes all known players and respects tick interval', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);
  gameState.addPlayer('peer-b', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  networkManager.sendStateSync();
  assert.equal(peerConnection.sentMessages.length, 1);

  const firstMessage = peerConnection.sentMessages[0].message;
  assert.equal(firstMessage.type, MessageType.STATE_SYNC);
  assert.deepEqual(Object.keys(firstMessage.players).sort(), ['host', 'peer-a', 'peer-b']);

  networkManager.sendStateSync();
  assert.equal(peerConnection.sentMessages.length, 1);
});

test('client state sync creates missing player states and stores local authoritative snapshot', () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  const stateSyncMessage = createMessage(MessageType.STATE_SYNC, {
    players: {
      'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 1, y: 2, z: 3 }),
      'host-1': makePlayerSnapshot(PlayerRole.PIGEON, { x: -4, y: 5, z: 6 }),
      'client-2': makePlayerSnapshot(PlayerRole.HAWK, { x: 7, y: 8, z: 9 }),
    },
    foods: [],
    npcs: [],
  });

  peerConnection.emit(stateSyncMessage, 'host-1');

  assert.ok(gameState.players.has('host-1'));
  assert.ok(gameState.players.has('client-2'));
  assert.equal(gameState.players.get('host-1').role, PlayerRole.PIGEON);
  assert.equal(gameState.players.get('client-2').role, PlayerRole.HAWK);

  const authoritative = networkManager.getLocalAuthoritativeState();
  assert.ok(authoritative);
  assert.equal(authoritative.position.x, 1);
  assert.equal(authoritative.position.y, 2);
  assert.equal(authoritative.position.z, 3);
});

test('resetRemoteInput clears host input cache', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  peerConnection.emit(
    createMessage(MessageType.INPUT_UPDATE, {
      input: { forward: 1, strafe: 0, ascend: 0, mouseX: 2, mouseY: 3 },
    }),
    'peer-a'
  );
  assert.notEqual(networkManager.getRemoteInput('peer-a'), null);

  networkManager.resetRemoteInput();
  assert.equal(networkManager.getRemoteInput('peer-a'), null);
});

test('host ignores remote input until peer is activated', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);
  networkManager.registerPendingPeer('peer-a');

  peerConnection.emit(
    createMessage(MessageType.INPUT_UPDATE, {
      input: { forward: 1, strafe: 0.4, ascend: 0, mouseX: 2, mouseY: -1 },
    }),
    'peer-a'
  );
  assert.equal(networkManager.getRemoteInput('peer-a'), null);

  networkManager.activatePeer('peer-a');
  peerConnection.emit(
    createMessage(MessageType.INPUT_UPDATE, {
      input: { forward: 1, strafe: 0.4, ascend: 0, mouseX: 2, mouseY: -1 },
    }),
    'peer-a'
  );
  assert.deepEqual(networkManager.getRemoteInput('peer-a'), {
    forward: 1,
    strafe: 0.4,
    ascend: 0,
    mouseX: 2,
    mouseY: -1,
    scrollDelta: 0,
  });
});

test('client receives join accept/deny lifecycle messages', () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  let joinAcceptRole = null;
  let joinDenyReason = null;
  networkManager.onJoinAccept((message) => {
    joinAcceptRole = message.assignedRole;
  });
  networkManager.onJoinDeny((message) => {
    joinDenyReason = message.reason;
  });

  peerConnection.emit(
    createMessage(MessageType.JOIN_ACCEPT, {
      peerId: 'client-1',
      assignedRole: PlayerRole.HAWK,
      worldSeed: 42,
      roundState: 'lobby',
      roundNumber: 0,
    }),
    'host-1'
  );
  assert.equal(joinAcceptRole, PlayerRole.HAWK);

  peerConnection.emit(
    createMessage(MessageType.JOIN_DENY, {
      reason: 'room_full',
    }),
    'host-1'
  );
  assert.equal(joinDenyReason, 'room_full');
});

test('client removes stale peers that disappear from authoritative sync', () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);
  gameState.addPlayer('peer-a', PlayerRole.PIGEON);
  gameState.addPlayer('peer-b', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  peerConnection.emit(
    createMessage(MessageType.STATE_SYNC, {
      serverTick: 20,
      players: {
        'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 0, y: 5, z: 0 }),
        'peer-a': makePlayerSnapshot(PlayerRole.PIGEON, { x: 2, y: 5, z: 0 }),
      },
    }),
    'host-1'
  );

  assert.equal(gameState.players.has('peer-b'), false);
  assert.deepEqual(networkManager.consumeStalePeerRemovals(), ['peer-b']);
});

test('client interpolation advances between packets using estimated server tick', () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    peerConnection.emit(
      createMessage(MessageType.STATE_SYNC, {
        serverTick: 100,
        players: {
          'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 0, y: 5, z: 0 }),
          'host-1': makePlayerSnapshot(PlayerRole.PIGEON, { x: 0, y: 5, z: 0 }),
        },
      }),
      'host-1'
    );

    peerConnection.emit(
      createMessage(MessageType.STATE_SYNC, {
        serverTick: 110,
        players: {
          'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 0, y: 5, z: 0 }),
          'host-1': makePlayerSnapshot(PlayerRole.PIGEON, { x: 10, y: 5, z: 0 }),
        },
      }),
      'host-1'
    );

    const initial = networkManager.getInterpolatedRemoteState('host-1');
    assert.ok(initial);

    now += 100;

    const progressed = networkManager.getInterpolatedRemoteState('host-1');
    assert.ok(progressed);
    assert.ok(progressed.position.x > initial.position.x + 1);
  } finally {
    Date.now = originalNow;
  }
});

test('client ignores stale out-of-order state sync packets', () => {
  const gameState = new GameState(false, 'client-1');
  gameState.addPlayer('client-1', PlayerRole.HAWK);

  const peerConnection = new FakePeerConnection();
  const networkManager = new NetworkManager(peerConnection, gameState);

  peerConnection.emit(
    createMessage(MessageType.STATE_SYNC, {
      serverTick: 50,
      players: {
        'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: 5, y: 5, z: 5 }),
      },
    }),
    'host-1'
  );

  const freshAuthoritative = networkManager.getLocalAuthoritativeState();
  assert.ok(freshAuthoritative);
  assert.equal(freshAuthoritative.serverTick, 50);
  assert.equal(freshAuthoritative.position.x, 5);

  peerConnection.emit(
    createMessage(MessageType.STATE_SYNC, {
      serverTick: 45,
      players: {
        'client-1': makePlayerSnapshot(PlayerRole.HAWK, { x: -99, y: 5, z: 5 }),
      },
    }),
    'host-1'
  );

  const afterStale = networkManager.getLocalAuthoritativeState();
  assert.ok(afterStale);
  assert.equal(afterStale.serverTick, 50);
  assert.equal(afterStale.position.x, 5);
});
