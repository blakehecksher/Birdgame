import * as THREE from 'three';
import { PlayerRole, GAME_CONFIG } from '../config/constants';

export class Player {
  public mesh: THREE.Group;
  public position: THREE.Vector3;
  public rotation: THREE.Euler;
  public velocity: THREE.Vector3;
  public role: PlayerRole;
  public radius: number;

  // Player state
  public isEating: boolean = false;
  public eatingTimer: number = 0;

  // Speed multiplier (affected by weight/energy)
  public speedMultiplier: number = 1.0;

  constructor(role: PlayerRole, initialPosition?: THREE.Vector3) {
    this.role = role;
    this.position = initialPosition || new THREE.Vector3(0, 5, 0);
    this.rotation = new THREE.Euler(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.radius = GAME_CONFIG.PLAYER_RADIUS;

    // Create bird mesh
    this.mesh = this.createBirdMesh(role);
    this.mesh.position.copy(this.position);
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

  /**
   * Update player state
   */
  public update(deltaTime: number): void {
    // Update position from velocity
    this.position.add(this.velocity.clone().multiplyScalar(deltaTime));

    // Update mesh position and rotation
    this.mesh.position.copy(this.position);
    // Apply player rotation with +90 degree offset on Y axis to correct bird facing direction
    this.mesh.rotation.set(this.rotation.x, this.rotation.y + Math.PI / 2, this.rotation.z);

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
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
