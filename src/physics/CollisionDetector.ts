import * as THREE from 'three';
import { Player } from '../entities/Player';

/**
 * Collision detection system
 */
export class CollisionDetector {
  /**
   * Check sphere-sphere collision between two players
   */
  public checkPlayerCollision(player1: Player, player2: Player): boolean {
    const distance = player1.position.distanceTo(player2.position);
    const combinedRadius = player1.radius + player2.radius;
    return distance < combinedRadius;
  }

  /**
   * Check sphere-point collision (for food pickup)
   */
  public checkSpherePointCollision(
    spherePos: THREE.Vector3,
    radius: number,
    point: THREE.Vector3
  ): boolean {
    const distance = spherePos.distanceTo(point);
    return distance < radius;
  }

  /**
   * Check AABB (box) vs sphere collision (for buildings)
   */
  public checkAABBSphereCollision(
    boxMin: THREE.Vector3,
    boxMax: THREE.Vector3,
    spherePos: THREE.Vector3,
    radius: number
  ): boolean {
    // Find closest point on AABB to sphere center
    const closestPoint = new THREE.Vector3(
      Math.max(boxMin.x, Math.min(spherePos.x, boxMax.x)),
      Math.max(boxMin.y, Math.min(spherePos.y, boxMax.y)),
      Math.max(boxMin.z, Math.min(spherePos.z, boxMax.z))
    );

    const distance = spherePos.distanceTo(closestPoint);
    return distance < radius;
  }

  /**
   * Resolve AABB-sphere collision by pushing sphere out
   */
  public resolveAABBSphereCollision(
    boxMin: THREE.Vector3,
    boxMax: THREE.Vector3,
    player: Player
  ): void {
    const center = new THREE.Vector3(
      (boxMin.x + boxMax.x) / 2,
      (boxMin.y + boxMax.y) / 2,
      (boxMin.z + boxMax.z) / 2
    );

    const delta = player.position.clone().sub(center);
    const absDelta = new THREE.Vector3(
      Math.abs(delta.x),
      Math.abs(delta.y),
      Math.abs(delta.z)
    );

    // Push on the dominant axis
    if (absDelta.x > absDelta.y && absDelta.x > absDelta.z) {
      player.position.x = delta.x > 0
        ? boxMax.x + player.radius
        : boxMin.x - player.radius;
    } else if (absDelta.y > absDelta.z) {
      player.position.y = delta.y > 0
        ? boxMax.y + player.radius
        : boxMin.y - player.radius;
    } else {
      player.position.z = delta.z > 0
        ? boxMax.z + player.radius
        : boxMin.z - player.radius;
    }

    // Stop movement
    player.velocity.set(0, 0, 0);
  }
}
