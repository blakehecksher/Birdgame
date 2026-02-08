import * as THREE from 'three';
import { GAME_CONFIG } from '../config/constants';

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private targetPosition: THREE.Vector3;
  private currentPosition: THREE.Vector3;
  private raycaster: THREE.Raycaster;
  private collisionMeshes: THREE.Object3D[] = [];
  private currentDistance: number = GAME_CONFIG.CAMERA_DISTANCE;
  private targetDistance: number = GAME_CONFIG.CAMERA_DISTANCE;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.targetPosition = new THREE.Vector3();
    this.currentPosition = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
  }

  /**
   * Set meshes to check for camera collision (building meshes)
   */
  public setCollisionMeshes(meshes: THREE.Object3D[]): void {
    this.collisionMeshes = meshes;
  }

  /**
   * Adjust camera zoom distance from scroll input
   */
  public adjustZoom(scrollDelta: number): void {
    this.targetDistance += scrollDelta * GAME_CONFIG.CAMERA_ZOOM_SPEED;
    this.targetDistance = Math.max(
      GAME_CONFIG.CAMERA_ZOOM_MIN,
      Math.min(GAME_CONFIG.CAMERA_ZOOM_MAX, this.targetDistance)
    );
  }

  /**
   * Update camera to follow a target object
   * @param targetObject The object to follow (player mesh)
   * @param targetRotation The rotation of the object
   * @param scrollDelta Scroll wheel input for zoom
   */
  public update(targetObject: THREE.Object3D, targetRotation: THREE.Euler, scrollDelta: number = 0): void {
    // Handle zoom input
    if (scrollDelta !== 0) {
      this.adjustZoom(scrollDelta);
    }

    // Smoothly interpolate distance
    this.currentDistance += (this.targetDistance - this.currentDistance) * GAME_CONFIG.CAMERA_LERP_FACTOR;

    // Calculate desired camera position behind and above the player
    const offset = new THREE.Vector3(
      0,
      GAME_CONFIG.CAMERA_HEIGHT,
      this.currentDistance
    );

    // Rotate offset based on player's rotation (only yaw, not pitch)
    const yawRotation = new THREE.Euler(0, targetRotation.y, 0);
    offset.applyEuler(yawRotation);

    // Set target position
    this.targetPosition.copy(targetObject.position).add(offset);

    // Check for camera collision with buildings
    if (this.collisionMeshes.length > 0) {
      const playerPos = targetObject.position;
      const toCamera = new THREE.Vector3().subVectors(this.targetPosition, playerPos);
      const distance = toCamera.length();

      if (distance > 0.1) {
        const direction = toCamera.clone().normalize();
        this.raycaster.set(playerPos, direction);
        this.raycaster.far = distance;

        const intersections = this.raycaster.intersectObjects(this.collisionMeshes, false);
        if (intersections.length > 0) {
          // Pull camera to just before the hit point (0.5 unit buffer)
          const hitDist = Math.max(0.5, intersections[0].distance - 0.5);
          this.targetPosition.copy(playerPos).addScaledVector(direction, hitDist);
        }
      }
    }

    // Smoothly interpolate current camera position to target
    this.currentPosition.lerp(this.targetPosition, GAME_CONFIG.CAMERA_LERP_FACTOR);
    this.camera.position.copy(this.currentPosition);

    // Make camera look at the player
    this.camera.lookAt(targetObject.position);
  }

  /**
   * Set camera position immediately (no lerp) - useful for initialization
   */
  public setPositionImmediate(targetObject: THREE.Object3D, targetRotation: THREE.Euler): void {
    const offset = new THREE.Vector3(
      0,
      GAME_CONFIG.CAMERA_HEIGHT,
      this.currentDistance
    );

    const yawRotation = new THREE.Euler(0, targetRotation.y, 0);
    offset.applyEuler(yawRotation);

    this.currentPosition.copy(targetObject.position).add(offset);
    this.targetPosition.copy(this.currentPosition);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(targetObject.position);
  }
}
