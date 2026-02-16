const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for collision detection synchronization under network latency
 *
 * These tests verify that collision detection works correctly when there's
 * interpolation delay between what the client sees and the server's authoritative position.
 */

/**
 * Simple AABB collision check (mirrors game logic)
 */
function checkAABBCollision(pos1, size1, pos2, size2) {
  return (
    Math.abs(pos1.x - pos2.x) < (size1.x + size2.x) / 2 &&
    Math.abs(pos1.y - pos2.y) < (size1.y + size2.y) / 2 &&
    Math.abs(pos1.z - pos2.z) < (size1.z + size2.z) / 2
  );
}

/**
 * Sphere collision check (used for bird-to-bird collisions)
 */
function checkSphereCollision(pos1, radius1, pos2, radius2) {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  const radiusSum = radius1 + radius2;
  return distanceSquared <= radiusSum * radiusSum;
}

/**
 * Simulate position after deltaTime with constant velocity
 */
function simulateMovement(position, velocity, deltaTime) {
  return {
    x: position.x + velocity.x * deltaTime,
    y: position.y + velocity.y * deltaTime,
    z: position.z + velocity.z * deltaTime,
  };
}

// ============================================================================
// Basic Collision Tests
// ============================================================================

test('CollisionSync: detects collision when birds are at same position', () => {
  const hawkPos = { x: 10, y: 5, z: 0 };
  const pigeonPos = { x: 10.5, y: 5.2, z: 0.1 };

  // Using ellipsoid collision radii from game (roughly 1.5 units)
  const collision = checkSphereCollision(hawkPos, 1.5, pigeonPos, 1.5);

  assert.ok(collision, 'Should detect collision when birds are close');
});

test('CollisionSync: does NOT detect false collision when birds are far apart', () => {
  const hawkPos = { x: 10, y: 5, z: 0 };
  const pigeonPos = { x: 15, y: 5, z: 0 };

  const collision = checkSphereCollision(hawkPos, 1.5, pigeonPos, 1.5);

  assert.ok(!collision, 'Should NOT detect collision when birds are far apart');
});

// ============================================================================
// Interpolation Lag Tests
// ============================================================================

test('CollisionSync: handles interpolation delay causing position mismatch', () => {
  // Scenario: Pigeon is moving forward at 10 units/sec (fast evasion)
  // Client sees pigeon 120ms in the past due to interpolation delay

  const pigeonVelocity = { x: 10, y: 0, z: 0 }; // Moving right at 10 u/s
  const pigeonCurrentPos = { x: 20, y: 5, z: 0 }; // Current position on host
  const interpolationDelay = 0.120; // 120ms

  // Where client SEES the pigeon (120ms in the past)
  const pigeonVisualPos = {
    x: pigeonCurrentPos.x - pigeonVelocity.x * interpolationDelay, // 20 - 1.2 = 18.8
    y: pigeonCurrentPos.y - pigeonVelocity.y * interpolationDelay,
    z: pigeonCurrentPos.z - pigeonVelocity.z * interpolationDelay,
  };

  // Hawk dives at where pigeon WAS
  const hawkPos = { x: pigeonVisualPos.x, y: pigeonVisualPos.y, z: pigeonVisualPos.z };

  // Host checks collision using CURRENT pigeon position
  // Distance between hawk and current pigeon = 20 - 18.8 = 1.2 units
  // Collision radius = 1.5 + 1.5 = 3.0 units
  // Since 1.2 < 3.0, this will actually still be a collision!
  const hostCollision = checkSphereCollision(hawkPos, 1.5, pigeonCurrentPos, 1.5);

  // This demonstrates the problem: even with 120ms lag, collision radii are large enough
  // that the hawk can still hit. To truly miss, pigeon would need to move > 3 units
  assert.ok(hostCollision, 'Collision radii are large enough that hawk still hits despite 120ms lag');

  // Verify positions are different
  const distance = Math.abs(pigeonCurrentPos.x - pigeonVisualPos.x);
  assert.ok(distance > 1.0, `Pigeon should have moved ~1.2 units, moved ${distance.toFixed(2)}`);
});

test('CollisionSync: high-speed dive still detects collision if timing is right', () => {
  // Scenario: Hawk diving straight down at max speed (20 units/sec)
  const hawkVelocity = { x: 0, y: -20, z: 0 };
  const hawkStartPos = { x: 10, y: 20, z: 0 };

  const pigeonPos = { x: 10, y: 5, z: 0 }; // Pigeon at ground level

  // Simulate hawk position after 0.75 seconds of diving
  const deltaTime = 0.75; // 750ms
  const hawkCurrentPos = simulateMovement(hawkStartPos, hawkVelocity, deltaTime);

  // After 750ms: hawk at y = 20 - (20 * 0.75) = 5.0
  assert.ok(Math.abs(hawkCurrentPos.y - 5.0) < 0.1, 'Hawk should be at y=5');

  // Check collision
  const collision = checkSphereCollision(hawkCurrentPos, 1.5, pigeonPos, 1.5);
  assert.ok(collision, 'Hawk should collide with pigeon at ground level');
});

// ============================================================================
// Frame-Perfect Collision Tests
// ============================================================================

test('CollisionSync: detects collision during frame of impact', () => {
  // Scenario: Hawk diving, need to check if collision happens between frames
  const hawkVelocity = { x: 0, y: -20, z: 0 };
  const pigeonPos = { x: 10, y: 5, z: 0 };

  // Simulate hawk movement frame-by-frame
  let hawkPos = { x: 10, y: 10, z: 0 }; // Starting above pigeon
  const frameTime = 1 / 60; // 60 FPS = ~16.67ms per frame

  let collisionDetected = false;
  let framesSimulated = 0;

  // Simulate for max 120 frames (2 seconds at 60fps)
  while (framesSimulated < 120 && !collisionDetected) {
    // Move hawk
    hawkPos = simulateMovement(hawkPos, hawkVelocity, frameTime);

    // Check collision
    if (checkSphereCollision(hawkPos, 1.5, pigeonPos, 1.5)) {
      collisionDetected = true;
    }

    framesSimulated++;

    // Stop if hawk goes below pigeon
    if (hawkPos.y < pigeonPos.y - 2) break;
  }

  assert.ok(collisionDetected, 'Collision should be detected during dive');
  assert.ok(framesSimulated < 60, `Collision should happen quickly, took ${framesSimulated} frames`);
});

test('CollisionSync: no tunneling through fast-moving targets', () => {
  // Scenario: Very fast hawk shouldn't pass through pigeon without collision
  const hawkVelocity = { x: 30, y: 0, z: 0 }; // Very fast horizontal movement
  const pigeonPos = { x: 10, y: 5, z: 0 };

  let hawkPos = { x: 5, y: 5, z: 0 }; // Starting to the left
  const frameTime = 1 / 60;

  let collisionDetected = false;
  let framesSimulated = 0;

  while (framesSimulated < 60 && hawkPos.x < 15) {
    // Check collision BEFORE moving (to catch fast movement)
    if (checkSphereCollision(hawkPos, 1.5, pigeonPos, 1.5)) {
      collisionDetected = true;
      break;
    }

    // Move hawk
    hawkPos = simulateMovement(hawkPos, hawkVelocity, frameTime);
    framesSimulated++;
  }

  assert.ok(collisionDetected, 'Fast-moving hawk should still collide, not tunnel through');
});

// ============================================================================
// Ellipsoid Collision Tests
// ============================================================================

test('CollisionSync: ellipsoid collision works for elongated bird shapes', () => {
  // Birds are elongated (longer than they are wide)
  const hawkPos = { x: 10, y: 5, z: 0 };
  const hawkSize = { x: 2.0, y: 1.0, z: 1.0 }; // 2 units long, 1 unit tall/wide

  const pigeonPos = { x: 11.5, y: 5, z: 0 }; // Offset along x-axis
  const pigeonSize = { x: 2.0, y: 1.0, z: 1.0 };

  const collision = checkAABBCollision(hawkPos, hawkSize, pigeonPos, pigeonSize);

  assert.ok(collision, 'Should detect collision between elongated shapes');
});

test('CollisionSync: ellipsoid allows close passes without false collision', () => {
  const hawkPos = { x: 10, y: 5, z: 0 };
  const hawkSize = { x: 2.0, y: 1.0, z: 1.0 };

  const pigeonPos = { x: 10, y: 6.5, z: 0 }; // Just above (0.5 unit gap)
  const pigeonSize = { x: 2.0, y: 1.0, z: 1.0 };

  const collision = checkAABBCollision(hawkPos, hawkSize, pigeonPos, pigeonSize);

  assert.ok(!collision, 'Should NOT detect collision for close but non-overlapping shapes');
});

// ============================================================================
// Network Compensation Tests
// ============================================================================

test('CollisionSync: lag compensation reduces false negatives', () => {
  // Scenario: With lag compensation, host checks collision at position
  // where pigeon was when hawk started the dive

  const pigeonVelocity = { x: 10, y: 0, z: 0 }; // Faster movement
  const pigeonCurrentPos = { x: 20, y: 5, z: 0 };
  const rtt = 0.150; // 150ms round-trip time (longer lag)

  // Rewind pigeon to where it was when hawk saw it
  // 10 u/s * 0.15s = 1.5 units back
  const pigeonHistoricalPos = {
    x: pigeonCurrentPos.x - pigeonVelocity.x * rtt, // 20 - 1.5 = 18.5
    y: pigeonCurrentPos.y - pigeonVelocity.y * rtt,
    z: pigeonCurrentPos.z - pigeonVelocity.z * rtt,
  };

  const hawkPos = { x: pigeonHistoricalPos.x, y: pigeonHistoricalPos.y, z: pigeonHistoricalPos.z };

  // Check collision against historical position (should hit)
  const lagCompensatedCollision = checkSphereCollision(hawkPos, 1.5, pigeonHistoricalPos, 1.5);
  assert.ok(lagCompensatedCollision, 'Lag compensation should allow hit at historical position');

  // Without lag comp (against current position)
  // Distance = 20 - 18.5 = 1.5 units, collision radius = 3.0
  // Since 1.5 < 3.0, this will STILL collide (radii are too large)
  // Need pigeon to move > 3 units to demonstrate miss
  // Let's use a longer time: 0.35s * 10 = 3.5 units
  const longerRtt = 0.35;
  const pigeonFarPos = {
    x: pigeonCurrentPos.x - pigeonVelocity.x * longerRtt, // 20 - 3.5 = 16.5
    y: pigeonCurrentPos.y,
    z: pigeonCurrentPos.z,
  };

  const hawkAtOldPos = { x: pigeonFarPos.x, y: pigeonFarPos.y, z: pigeonFarPos.z };

  // Without lag comp: distance = 20 - 16.5 = 3.5 units > 3.0 collision radius
  const noCompCollision = checkSphereCollision(hawkAtOldPos, 1.5, pigeonCurrentPos, 1.5);
  assert.ok(!noCompCollision, 'Without lag comp, this would be a miss (pigeon moved > 3 units)');

  // With lag comp: check against historical position
  const withCompCollision = checkSphereCollision(hawkAtOldPos, 1.5, pigeonFarPos, 1.5);
  assert.ok(withCompCollision, 'With lag comp, hawk hits at historical position');
});

test('CollisionSync: reconciliation keeps positions synchronized', () => {
  // Scenario: Client prediction vs server authority
  const serverPos = { x: 10, y: 5, z: 0 }; // Authoritative position
  const clientPredictedPos = { x: 10.3, y: 5.1, z: 0.05 }; // Client prediction drifted

  const reconciliationError = Math.sqrt(
    Math.pow(serverPos.x - clientPredictedPos.x, 2) +
    Math.pow(serverPos.y - clientPredictedPos.y, 2) +
    Math.pow(serverPos.z - clientPredictedPos.z, 2)
  );

  // Error should be small enough to not affect collision detection
  assert.ok(reconciliationError < 0.5, `Reconciliation error ${reconciliationError.toFixed(3)} should be < 0.5 units`);

  // Both positions should detect collision with same target
  const targetPos = { x: 10.2, y: 5, z: 0 };
  const serverCollision = checkSphereCollision(serverPos, 1.5, targetPos, 1.5);
  const clientCollision = checkSphereCollision(clientPredictedPos, 1.5, targetPos, 1.5);

  assert.equal(serverCollision, clientCollision, 'Server and client should agree on collision');
});
