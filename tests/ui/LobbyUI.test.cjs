const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFallbackUsername,
  resolveUsername,
} = require('../../.test-out/ui/LobbyUI.js');

test('resolveUsername returns typed name when non-empty', () => {
  assert.equal(resolveUsername('Sky Hawk', 'bird-123'), 'Sky Hawk');
});

test('resolveUsername falls back for blank input', () => {
  assert.equal(resolveUsername('   ', 'bird-123'), 'bird-123');
});

test('createFallbackUsername creates bird-XYZ format', () => {
  const name = createFallbackUsername(() => 0.5);
  assert.match(name, /^bird-\d{3}$/);
});
