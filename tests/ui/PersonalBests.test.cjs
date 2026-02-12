const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDefaultPersonalBests,
  parsePersonalBests,
  updatePersonalBest,
} = require('../../.test-out/ui/personalBests.js');

test('updatePersonalBest stores first fattest pigeon result', () => {
  const current = createDefaultPersonalBests();
  const result = updatePersonalBest(current, 'fattest_pigeon', 4.2);
  assert.equal(result.isNewBest, true);
  assert.equal(result.bests.fattestPigeon, 4.2);
});

test('updatePersonalBest keeps higher-is-better for fattest pigeon', () => {
  const current = { fattestPigeon: 4.2, fastestHawkKill: null };
  const result = updatePersonalBest(current, 'fattest_pigeon', 3.8);
  assert.equal(result.isNewBest, false);
  assert.equal(result.bests.fattestPigeon, 4.2);
});

test('updatePersonalBest keeps lower-is-better for fastest hawk kill', () => {
  const current = { fattestPigeon: null, fastestHawkKill: 42 };
  const result = updatePersonalBest(current, 'fastest_hawk_kill', 38);
  assert.equal(result.isNewBest, true);
  assert.equal(result.bests.fastestHawkKill, 38);
});

test('parsePersonalBests handles invalid json safely', () => {
  const parsed = parsePersonalBests('{this-is-not-json');
  assert.deepEqual(parsed, createDefaultPersonalBests());
});
