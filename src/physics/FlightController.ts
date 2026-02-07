import * as THREE from 'three';
import { Player } from '../entities/Player';
import { InputState } from '../core/InputManager';
import { GAME_CONFIG } from '../config/constants';

export class FlightController {
  /**
   * Apply player input to control flight
   */
  public applyInput(player: Player, input: InputState, deltaTime: number): void {
    // Don't allow movement while eating
    if (player.isEating) {
      return;
    }

    // Get current speed
    const speed = player.getCurrentSpeed();

    // Update rotation based on mouse movement
    player.rotation.y -= input.mouseX * GAME_CONFIG.MOUSE_SENSITIVITY;
    player.rotation.x -= input.mouseY * GAME_CONFIG.MOUSE_SENSITIVITY;

    // Clamp pitch to prevent flipping upside down
    player.rotation.x = Math.max(
      -GAME_CONFIG.MAX_PITCH,
      Math.min(GAME_CONFIG.MAX_PITCH, player.rotation.x)
    );

    // Calculate movement vectors based on player rotation
    const forward = new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);

    // Apply rotation to forward and right vectors (only yaw for strafe)
    forward.applyEuler(player.rotation);
    right.applyEuler(new THREE.Euler(0, player.rotation.y, 0));

    // Apply movement input
    if (input.forward !== 0) {
      player.velocity.addScaledVector(forward, input.forward * speed * deltaTime * 10);
    }

    if (input.strafe !== 0) {
      player.velocity.addScaledVector(right, input.strafe * speed * deltaTime * 10);
    }

    if (input.ascend !== 0) {
      player.velocity.addScaledVector(up, input.ascend * speed * deltaTime * 10);
    }

    // Apply air resistance using a frame-rate independent factor.
    const dragFactor = Math.pow(GAME_CONFIG.AIR_RESISTANCE, deltaTime * 60);
    player.velocity.multiplyScalar(dragFactor);

    // Clamp velocity to prevent excessive speeds
    const maxVelocity = speed * 3;
    if (player.velocity.length() > maxVelocity) {
      player.velocity.normalize().multiplyScalar(maxVelocity);
    }

    // Keep player above ground (minimum height of 1 unit)
    if (player.position.y < 1) {
      player.position.y = 1;
      player.velocity.y = Math.max(0, player.velocity.y); // Stop downward velocity
    }
  }

  /**
   * Apply physics simulation (gravity, etc.)
   * For now, we use arcade physics with no gravity
   */
  public applyPhysics(_player: Player, _deltaTime: number): void {
    // Could add subtle gravity here if desired
    // For now, arcade flight has no gravity
  }
}
