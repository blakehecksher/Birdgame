const test = require('node:test');
const assert = require('node:assert/strict');

const { GameState } = require('../../.test-out/core/GameState.js');
const { GAME_CONFIG, PlayerRole } = require('../../.test-out/config/constants.js');

test('assignRolesForNextRound keeps one pigeon and turns others into hawks', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);
  gameState.addPlayer('peer-b', PlayerRole.HAWK);

  gameState.assignRolesForNextRound('peer-b');

  assert.equal(gameState.players.get('peer-b').role, PlayerRole.PIGEON);
  assert.equal(gameState.players.get('peer-b').weight, GAME_CONFIG.PIGEON_INITIAL_WEIGHT);
  assert.equal(gameState.players.get('peer-b').energy, undefined);

  assert.equal(gameState.players.get('host').role, PlayerRole.HAWK);
  assert.equal(gameState.players.get('host').weight, undefined);
  assert.equal(gameState.players.get('host').energy, GAME_CONFIG.HAWK_INITIAL_ENERGY);

  assert.equal(gameState.players.get('peer-a').role, PlayerRole.HAWK);
  assert.equal(gameState.players.get('peer-a').weight, undefined);
  assert.equal(gameState.players.get('peer-a').energy, GAME_CONFIG.HAWK_INITIAL_ENERGY);
});

test('chooseNextPigeonAfterHawkWin alternates roles in a 2-player match', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);

  const nextPigeon = gameState.chooseNextPigeonAfterHawkWin('peer-a', 'host');

  assert.equal(nextPigeon, 'peer-a');
});

test('chooseNextPigeonAfterPigeonWin alternates roles in a 2-player match', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);

  const nextPigeon = gameState.chooseNextPigeonAfterPigeonWin('host');
  const secondNextPigeon = gameState.chooseNextPigeonAfterPigeonWin('peer-a');

  assert.equal(nextPigeon, 'peer-a');
  assert.equal(secondNextPigeon, 'host');
});

test('chooseNextPigeonAfterHawkWin makes the killer pigeon in 3+ player match', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);
  gameState.addPlayer('peer-b', PlayerRole.HAWK);

  const nextPigeon = gameState.chooseNextPigeonAfterHawkWin('peer-b', 'host');

  assert.equal(nextPigeon, 'peer-b');
});

test('chooseNextPigeonAfterPigeonWin rotates by join order in 3+ player match', () => {
  const gameState = new GameState(true, 'host');
  gameState.addPlayer('host', PlayerRole.PIGEON);
  gameState.addPlayer('peer-a', PlayerRole.HAWK);
  gameState.addPlayer('peer-b', PlayerRole.HAWK);

  const first = gameState.chooseNextPigeonAfterPigeonWin('host');
  const second = gameState.chooseNextPigeonAfterPigeonWin('host');
  const third = gameState.chooseNextPigeonAfterPigeonWin('peer-a');
  const fourth = gameState.chooseNextPigeonAfterPigeonWin('peer-b');

  assert.equal(first, 'host');
  assert.equal(second, 'peer-a');
  assert.equal(third, 'peer-b');
  assert.equal(fourth, 'host');
});
