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
