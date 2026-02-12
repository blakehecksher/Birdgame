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
    forward: -1,
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
    forward: -1,
    strafe: 0.5,
    ascend: 0,
    mouseX: 0,
    mouseY: 0,
    scrollDelta: 0,
  });
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
