import * as THREE from 'three';
import { PlayerRole, GAME_CONFIG } from '../config/constants';

export class Player {
  public mesh: THREE.Group;
  public position: THREE.Vector3;
  public rotation: THREE.Euler;
  public velocity: THREE.Vector3;
  public role: PlayerRole;

  // Ellipsoid collision radii (world-scaled)
  public collisionRadii: THREE.Vector3;
  public radius: number; // max of collisionRadii (used for sphere fallback checks)
  private baseCollisionRadii: THREE.Vector3;
  private baseRadius: number = 0;
  private debugMesh: THREE.Mesh | null = null;

  private modelOffsetQ: THREE.Quaternion;

  // Player state
  public isEating: boolean = false;
  public eatingTimer: number = 0;

  // Speed multiplier (affected by weight/energy)
  public speedMultiplier: number = 1.0;

  // Bank physics state
  public bankVelocity: number = 0;

  constructor(role: PlayerRole, initialPosition?: THREE.Vector3, model?: THREE.Group | null) {
    this.role = role;
    this.position = initialPosition || new THREE.Vector3(0, 5, 0);
    this.rotation = new THREE.Euler(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.baseCollisionRadii = new THREE.Vector3();
    this.collisionRadii = new THREE.Vector3();
    this.radius = 0;

    // Use loaded 3D model if available, otherwise fall back to procedural mesh
    this.mesh = new THREE.Group();
    if (model) {
      this.mesh.add(model);
      // GLB models: no rotation offset by default (adjust if model faces wrong way)
      this.modelOffsetQ = new THREE.Quaternion();
    } else {
      this.mesh.add(this.createBirdMesh(role));
      // Procedural mesh is built along +X; rotate +90° Y so it faces -Z (camera forward)
      this.modelOffsetQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    }
    this.mesh.position.copy(this.position);
    this.updateCollisionShape();
    this.setVisualScale(1);
  }

  private createBirdMesh(role: PlayerRole): THREE.Group {
    const group = new THREE.Group();

    // Different colors for different roles
    const color = role === PlayerRole.PIGEON ? 0x9999ff : 0xff6633; // Blue for pigeon, orange for hawk

    // Body (cone pointing forward)
    const bodyGeometry = new THREE.ConeGeometry(0.6, 2, 8);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.rotation.z = Math.PI / 2; // Rotate to point forward
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Head (sphere)
    const headGeometry = new THREE.SphereGeometry(0.4, 8, 8);
    const headMaterial = new THREE.MeshLambertMaterial({ color: color });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.set(1.2, 0, 0); // Position at front of body
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    // Beak (small cone)
    const beakGeometry = new THREE.ConeGeometry(0.1, 0.3, 4);
    const beakMaterial = new THREE.MeshLambertMaterial({ color: 0xffaa00 });
    const beak = new THREE.Mesh(beakGeometry, beakMaterial);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(1.5, 0, 0);
    beak.castShadow = true;
    group.add(beak);

    // Wings (simple flat triangles)
    const wingGeometry = new THREE.ConeGeometry(0.5, 1.2, 3);
    const wingMaterial = new THREE.MeshLambertMaterial({ color: color });

    const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
    leftWing.rotation.z = Math.PI / 2;
    leftWing.rotation.y = Math.PI / 4;
    leftWing.position.set(0, 0, 0.8);
    leftWing.castShadow = true;
    group.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
    rightWing.rotation.z = Math.PI / 2;
    rightWing.rotation.y = -Math.PI / 4;
    rightWing.position.set(0, 0, -0.8);
    rightWing.castShadow = true;
    group.add(rightWing);

    // Tail (small cone)
    const tailGeometry = new THREE.ConeGeometry(0.3, 0.8, 4);
    const tailMaterial = new THREE.MeshLambertMaterial({ color: color });
    const tail = new THREE.Mesh(tailGeometry, tailMaterial);
    tail.rotation.z = -Math.PI / 2;
    tail.position.set(-1.2, 0, 0);
    tail.castShadow = true;
    group.add(tail);

    return group;
  }

  // Reusable objects to avoid per-frame allocation
  private static _forward = new THREE.Vector3();
  private static _bankQ = new THREE.Quaternion();
  private static _yawQ = new THREE.Quaternion();
  private static _pitchQ = new THREE.Quaternion();
  private static _attitudeQ = new THREE.Quaternion();
  private static _rightAxis = new THREE.Vector3();
  private static _upAxis = new THREE.Vector3(0, 1, 0);

  /**
   * Update player state
   */
  public update(deltaTime: number): void {
    // Update position from velocity
    this.position.add(this.velocity.clone().multiplyScalar(deltaTime));

    // Update mesh transform
    this.mesh.position.copy(this.position);
    this.applyMeshRotation();

    // Handle eating timer
    if (this.isEating) {
      this.eatingTimer -= deltaTime;
      if (this.eatingTimer <= 0) {
        this.isEating = false;
        this.eatingTimer = 0;
      }
    }
  }

  /**
   * Get base speed for this player role
   */
  public getBaseSpeed(): number {
    return this.role === PlayerRole.PIGEON
      ? GAME_CONFIG.PIGEON_BASE_SPEED
      : GAME_CONFIG.HAWK_BASE_SPEED;
  }

  /**
   * Get current speed (base speed * multiplier)
   */
  public getCurrentSpeed(): number {
    return this.getBaseSpeed() * this.speedMultiplier;
  }

  /**
   * Set a uniform visual scale and keep collision radii aligned with it.
   */
  public setVisualScale(scale: number): void {
    const safeScale = Math.max(0.1, scale);
    this.mesh.scale.setScalar(safeScale);
    this.collisionRadii.copy(this.baseCollisionRadii).multiplyScalar(safeScale);
    this.radius = Math.max(this.collisionRadii.x, this.collisionRadii.y, this.collisionRadii.z);
  }

  /**
   * Rebuild collision radii and debug mesh for the current role.
   * Call after role changes (e.g. round swap).
   */
  public updateCollisionShape(): void {
    const isPigeon = this.role === PlayerRole.PIGEON;
    this.baseCollisionRadii.set(
      isPigeon ? GAME_CONFIG.PIGEON_COLLISION_RX : GAME_CONFIG.HAWK_COLLISION_RX,
      isPigeon ? GAME_CONFIG.PIGEON_COLLISION_RY : GAME_CONFIG.HAWK_COLLISION_RY,
      isPigeon ? GAME_CONFIG.PIGEON_COLLISION_RZ : GAME_CONFIG.HAWK_COLLISION_RZ,
    );
    this.baseRadius = Math.max(
      this.baseCollisionRadii.x,
      this.baseCollisionRadii.y,
      this.baseCollisionRadii.z,
    );

    // Apply current visual scale
    const currentScale = Math.max(0.1, this.mesh.scale.x);
    this.collisionRadii.copy(this.baseCollisionRadii).multiplyScalar(currentScale);
    this.radius = this.baseRadius * currentScale;

    // Debug ellipsoid visualization
    if (this.debugMesh) {
      this.mesh.remove(this.debugMesh);
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
      this.debugMesh = null;
    }
    if (GAME_CONFIG.SHOW_COLLISION_DEBUG) {
      const geo = new THREE.SphereGeometry(1, 16, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: isPigeon ? 0x00aaff : 0xff4400,
        wireframe: true,
        transparent: true,
        opacity: 0.4,
        depthTest: false,
      });
      this.debugMesh = new THREE.Mesh(geo, mat);
      this.debugMesh.scale.set(
        this.baseCollisionRadii.x,
        this.baseCollisionRadii.y,
        this.baseCollisionRadii.z,
      );
      this.debugMesh.renderOrder = 999;
      this.mesh.add(this.debugMesh);
    }
  }

  /**
   * Update collision debug visualization visibility
   */
  public setCollisionDebugVisible(visible: boolean): void {
    const isPigeon = this.role === 'pigeon';

    // Remove existing debug mesh
    if (this.debugMesh) {
      this.mesh.remove(this.debugMesh);
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
      this.debugMesh = null;
    }

    // Create new debug mesh if visible
    if (visible) {
      const geo = new THREE.SphereGeometry(1, 16, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: isPigeon ? 0x00aaff : 0xff4400,
        wireframe: true,
        transparent: true,
        opacity: 0.4,
        depthTest: false,
      });
      this.debugMesh = new THREE.Mesh(geo, mat);
      this.debugMesh.scale.set(
        this.baseCollisionRadii.x,
        this.baseCollisionRadii.y,
        this.baseCollisionRadii.z,
      );
      this.debugMesh.renderOrder = 999;
      this.mesh.add(this.debugMesh);
    }
  }

  /**
   * Swap the visual model (e.g. on role change between rounds).
   * Disposes old children and replaces with new model content.
   */
  public swapModel(newModel: THREE.Group, offsetQ?: THREE.Quaternion): void {
    // Save current transform
    const pos = this.mesh.position.clone();
    const scale = this.mesh.scale.clone();

    // Dispose and remove old children
    const oldChildren = [...this.mesh.children];
    for (const child of oldChildren) {
      this.mesh.remove(child);
      // GLB models are cloned from shared cache resources; disposing here can
      // invalidate another live player that references the same geometry.
      if (child.userData.fromModelCache) {
        continue;
      }
      child.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          if (node.material instanceof THREE.Material) {
            node.material.dispose();
          }
        }
      });
    }

    // Add new model
    this.mesh.add(newModel);

    // Update model offset if provided
    if (offsetQ) {
      this.modelOffsetQ.copy(offsetQ);
    }

    // Restore transform
    this.mesh.position.copy(pos);
    this.mesh.scale.copy(scale);
  }

  /**
   * Apply the correct quaternion rotation to the mesh (pitch + yaw + banking).
   * Call this whenever rotation is changed externally (e.g. network sync, reconciliation).
   */
  public applyMeshRotation(): void {
    // Compose explicit aircraft attitude:
    // 1) yaw around world up
    // 2) pitch around the bird's local right after yaw
    // 3) roll around the bird's local forward after yaw+pitch
    // Then apply model axis offset (+90deg Y) because mesh geometry points along +X.
    Player._yawQ.setFromAxisAngle(Player._upAxis, this.rotation.y);
    Player._attitudeQ.copy(Player._yawQ);

    Player._rightAxis.set(1, 0, 0).applyQuaternion(Player._attitudeQ);
    Player._pitchQ.setFromAxisAngle(Player._rightAxis, this.rotation.x);
    Player._attitudeQ.premultiply(Player._pitchQ);

    if (Math.abs(this.rotation.z) > 0.001) {
      Player._forward.set(0, 0, -1).applyQuaternion(Player._attitudeQ);
      Player._bankQ.setFromAxisAngle(Player._forward, this.rotation.z);
      Player._attitudeQ.premultiply(Player._bankQ);
    }

    this.mesh.quaternion.copy(Player._attitudeQ).multiply(this.modelOffsetQ);
  }

  /**
   * Start eating animation/state
   */
  public startEating(duration: number): void {
    this.isEating = true;
    this.eatingTimer = duration;
    this.velocity.set(0, 0, 0); // Stop movement while eating
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    this.mesh.traverse((child) => {
      if (child.userData.fromModelCache) {
        return;
      }
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
