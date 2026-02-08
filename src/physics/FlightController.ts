import * as THREE from 'three';
import { Player } from '../entities/Player';
import { InputState } from '../core/InputManager';
import { GAME_CONFIG, PlayerRole } from '../config/constants';

export class FlightController {
  private static _forward = new THREE.Vector3();
  private static _up = new THREE.Vector3(0, 1, 0);
  private static _yawQ = new THREE.Quaternion();
  private static _pitchQ = new THREE.Quaternion();
  private static _attitudeQ = new THREE.Quaternion();
  private static _rightAxis = new THREE.Vector3();

  /**
   * Apply player input to control flight using a banking model.
   * A/D bank the bird (roll), banking drives yaw (turning).
   * Mouse vertical controls pitch only.
   */
  public applyInput(player: Player, input: InputState, deltaTime: number): void {
    // Don't allow movement while eating
    if (player.isEating) {
      return;
    }

    const speed = player.getCurrentSpeed();

    const isPigeon = player.role === PlayerRole.PIGEON;
    const turnCoupling = isPigeon
      ? GAME_CONFIG.PIGEON_BANK_TURN_COUPLING
      : GAME_CONFIG.HAWK_BANK_TURN_COUPLING;
    const bankAcceleration = isPigeon
      ? GAME_CONFIG.PIGEON_BANK_ACCELERATION
      : GAME_CONFIG.HAWK_BANK_ACCELERATION;
    const bankSpring = isPigeon
      ? GAME_CONFIG.PIGEON_BANK_SPRING_STIFFNESS
      : GAME_CONFIG.HAWK_BANK_SPRING_STIFFNESS;
    const bankDamping = isPigeon
      ? GAME_CONFIG.PIGEON_BANK_DAMPING
      : GAME_CONFIG.HAWK_BANK_DAMPING;
    const maxBankAngle = isPigeon
      ? GAME_CONFIG.PIGEON_MAX_BANK_ANGLE
      : GAME_CONFIG.HAWK_MAX_BANK_ANGLE;
    const pitchSensitivity = isPigeon
      ? GAME_CONFIG.PIGEON_MOUSE_PITCH_SENSITIVITY
      : GAME_CONFIG.HAWK_MOUSE_PITCH_SENSITIVITY;
    const maxPitch = isPigeon
      ? GAME_CONFIG.PIGEON_MAX_PITCH
      : GAME_CONFIG.HAWK_MAX_PITCH;

    // === BANKING PHYSICS (spring-damper system) ===
    const bankInput = input.strafe; // A/D now means bank, not strafe

    // Spring force pulls bank back to level
    const springForce = -player.rotation.z * bankSpring;

    // Damping prevents oscillation
    const dampingForce = -player.bankVelocity * bankDamping;

    // Player input drives the bank
    const inputForce = bankInput * bankAcceleration;

    // Integrate bank velocity and angle
    player.bankVelocity += (inputForce + springForce + dampingForce) * deltaTime;
    player.rotation.z += player.bankVelocity * deltaTime;

    // Clamp bank angle
    player.rotation.z = Math.max(
      -maxBankAngle,
      Math.min(maxBankAngle, player.rotation.z)
    );

    // Stop velocity from building up against the limit
    if (player.rotation.z >= maxBankAngle && player.bankVelocity > 0) {
      player.bankVelocity = 0;
    } else if (player.rotation.z <= -maxBankAngle && player.bankVelocity < 0) {
      player.bankVelocity = 0;
    }

    // === YAW (turning) ===
    // Banking is the primary turn mechanism
    const bankYawRate = player.rotation.z * turnCoupling;

    // No direct yaw input. Turning comes from bank only.
    player.rotation.y -= bankYawRate * deltaTime;

    // === PITCH ===
    player.rotation.x -= input.mouseY * pitchSensitivity;
    player.rotation.x = Math.max(
      -maxPitch,
      Math.min(maxPitch, player.rotation.x)
    );

    // === MOVEMENT VECTORS ===
    // Forward uses yaw + pitch only (no roll), matching airplane-style controls.
    FlightController._yawQ.setFromAxisAngle(FlightController._up, player.rotation.y);
    FlightController._attitudeQ.copy(FlightController._yawQ);
    FlightController._rightAxis.set(1, 0, 0).applyQuaternion(FlightController._attitudeQ);
    FlightController._pitchQ.setFromAxisAngle(FlightController._rightAxis, player.rotation.x);
    FlightController._attitudeQ.premultiply(FlightController._pitchQ);
    FlightController._forward.set(0, 0, -1).applyQuaternion(FlightController._attitudeQ);

    // Forward thrust only (W).
    const forwardInput = Math.max(0, input.forward);
    if (forwardInput > 0) {
      player.velocity.addScaledVector(FlightController._forward, forwardInput * speed * deltaTime * 10);
    }

    // Ascend/descend
    if (input.ascend !== 0) {
      player.velocity.addScaledVector(FlightController._up, input.ascend * speed * deltaTime * 10);
    }

    // Air resistance (frame-rate independent)
    const dragFactor = Math.pow(GAME_CONFIG.AIR_RESISTANCE, deltaTime * 60);
    player.velocity.multiplyScalar(dragFactor);

    // Clamp velocity
    const maxVelocity = speed * 3;
    if (player.velocity.length() > maxVelocity) {
      player.velocity.normalize().multiplyScalar(maxVelocity);
    }

    // Keep player above ground
    if (player.position.y < 1) {
      player.position.y = 1;
      player.velocity.y = Math.max(0, player.velocity.y);
    }
  }

  /**
   * Apply physics simulation (gravity, etc.)
   * For now, we use arcade physics with no gravity
   */
  public applyPhysics(_player: Player, _deltaTime: number): void {
    // Could add subtle gravity here if desired
  }
}
