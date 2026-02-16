import * as THREE from 'three';
import { GAME_CONFIG } from '../config/constants';

/**
 * NPC behavior states.
 */
export enum NPCState {
  IDLE = 'IDLE',
  WALKING = 'WALKING',
  SCURRYING = 'SCURRYING',
  FLEEING = 'FLEEING',
  DEAD = 'DEAD',
}

/**
 * NPC types.
 */
export enum NPCType {
  PIGEON = 'NPC_PIGEON',
  RAT = 'NPC_RAT',
  SQUIRREL = 'NPC_SQUIRREL',
}

/**
 * Serializable NPC state for network sync.
 */
export interface NPCSnapshot {
  id: string;
  type: NPCType;
  position: { x: number; y: number; z: number };
  rotation: number;
  state: NPCState;
  exists: boolean;
}

/**
 * Host-auth AI entity. Client receives snapshots only.
 */
export class NPC {
  public readonly id: string;
  public readonly type: NPCType;
  public mesh: THREE.Group;
  public position: THREE.Vector3;
  public heading: number = 0;
  public state: NPCState = NPCState.IDLE;
  public exists: boolean = true;
  public readonly radius: number;
  private debugMesh: THREE.Mesh | null = null;

  // Client-side interpolation targets (set by applySnapshot, lerped each frame)
  private targetPosition: THREE.Vector3 = new THREE.Vector3();
  private targetHeading: number = 0;
  private hasTarget: boolean = false;

  private stateTimer: number = 0;
  private respawnTimer: number = 0;
  private moveDirection: THREE.Vector3 = new THREE.Vector3();
  private speed: number = 0;
  private turnRate: number = 0;
  private verticalPhase: number = 0;
  private preferredAltitude: number = 0;
  private homeAnchor: THREE.Vector3 = new THREE.Vector3();
  private readonly random: () => number;

  constructor(
    id: string,
    type: NPCType,
    position: THREE.Vector3,
    model?: THREE.Group | null,
    randomFn: () => number = Math.random
  ) {
    this.id = id;
    this.type = type;
    this.position = position.clone();
    this.random = randomFn;
    this.radius = this.getRadiusByType(type);
    this.verticalPhase = this.random() * Math.PI * 2;
    this.preferredAltitude = position.y;
    this.homeAnchor.copy(position);

    this.mesh = new THREE.Group();
    if (model) {
      this.mesh.add(model);
    } else {
      this.mesh.add(this.createFallbackMesh());
    }
    this.updateDebugCollisionMesh();
    this.mesh.position.copy(this.position);
  }

  private createFallbackMesh(): THREE.Group {
    const group = new THREE.Group();

    if (this.type === NPCType.PIGEON) {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8),
        new THREE.MeshLambertMaterial({ color: 0x8888aa })
      );
      body.position.y = 0.3;
      body.castShadow = true;
      group.add(body);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 6, 6),
        new THREE.MeshLambertMaterial({ color: 0x8888aa })
      );
      head.position.set(0.25, 0.45, 0);
      head.castShadow = true;
      group.add(head);
    } else if (this.type === NPCType.RAT) {
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.1, 0.3, 4, 8),
        new THREE.MeshLambertMaterial({ color: 0x666666 })
      );
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.15;
      body.castShadow = true;
      group.add(body);

      const tail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.01, 0.3, 4),
        new THREE.MeshLambertMaterial({ color: 0x888888 })
      );
      tail.rotation.z = Math.PI / 2;
      tail.position.set(-0.3, 0.15, 0);
      group.add(tail);
    } else {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 8),
        new THREE.MeshLambertMaterial({ color: 0x7a4f2a })
      );
      body.position.y = 0.25;
      body.castShadow = true;
      group.add(body);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 8),
        new THREE.MeshLambertMaterial({ color: 0x8b5a2b })
      );
      head.position.set(0.22, 0.3, 0);
      head.castShadow = true;
      group.add(head);

      const tail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.015, 0.45, 6),
        new THREE.MeshLambertMaterial({ color: 0x5e3a1c })
      );
      tail.rotation.z = -Math.PI / 3;
      tail.position.set(-0.24, 0.43, 0);
      tail.castShadow = true;
      group.add(tail);
    }

    return group;
  }

  public update(
    deltaTime: number,
    hawkPosition: THREE.Vector3 | null,
    fleeRange: number,
    _buildings: Array<{ min: THREE.Vector3; max: THREE.Vector3 }>
  ): void {
    if (!this.exists) {
      this.respawnTimer -= deltaTime;
      return;
    }

    if (hawkPosition && this.state !== NPCState.FLEEING) {
      const dist = this.position.distanceTo(hawkPosition);
      if (dist < fleeRange) {
        this.enterFlee(hawkPosition);
      }
    }

    this.stateTimer -= deltaTime;

    switch (this.state) {
      case NPCState.IDLE:
        if (this.stateTimer <= 0) {
          this.enterMove();
        }
        break;

      case NPCState.WALKING:
      case NPCState.SCURRYING:
      case NPCState.FLEEING:
        this.advanceMovement(deltaTime);
        if (this.stateTimer <= 0) {
          this.enterIdle();
        }
        break;

      case NPCState.DEAD:
        break;
    }

    this.constrainToWorldBounds();
    this.applyHeightProfile(deltaTime);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.heading;
  }

  private enterIdle(): void {
    this.state = NPCState.IDLE;
    this.speed = 0;
    this.turnRate = 0;
    this.stateTimer = this.type === NPCType.PIGEON
      ? 0.6 + this.random() * 0.9
      : 1.5 + this.random() * 2.5;
  }

  private enterMove(): void {
    if (this.type === NPCType.PIGEON) {
      this.state = NPCState.WALKING;
      this.speed = GAME_CONFIG.NPC_PIGEON_SPEED;
      this.turnRate = this.randomSigned() * GAME_CONFIG.NPC_PIGEON_TURN_RATE;
      this.preferredAltitude = this.randomInRange(
        GAME_CONFIG.NPC_PIGEON_FLIGHT_MIN_ALT,
        GAME_CONFIG.NPC_PIGEON_FLIGHT_MAX_ALT
      );
      this.stateTimer = 2.4 + this.random() * 2.2;
    } else {
      this.state = NPCState.SCURRYING;
      this.speed = this.type === NPCType.SQUIRREL
        ? GAME_CONFIG.NPC_SQUIRREL_SPEED
        : GAME_CONFIG.NPC_RAT_SPEED;
      this.turnRate = this.randomSigned() * 1.8;
      this.stateTimer = this.type === NPCType.SQUIRREL
        ? 0.8 + this.random() * 0.9
        : 0.5 + this.random() * 0.5;
    }

    const angle = this.random() * Math.PI * 2;
    this.moveDirection.set(Math.cos(angle), 0, Math.sin(angle));
    this.heading = angle;
  }

  private enterFlee(hawkPosition: THREE.Vector3): void {
    this.state = NPCState.FLEEING;
    this.stateTimer = 3.0;

    this.moveDirection.copy(this.position).sub(hawkPosition).normalize();
    this.moveDirection.y = 0;
    this.heading = Math.atan2(this.moveDirection.z, this.moveDirection.x);
    this.turnRate = 0;

    switch (this.type) {
      case NPCType.PIGEON:
        this.speed = GAME_CONFIG.NPC_PIGEON_SPEED * 1.5;
        this.preferredAltitude = Math.min(
          GAME_CONFIG.NPC_PIGEON_FLIGHT_MAX_ALT,
          Math.max(this.position.y, GAME_CONFIG.NPC_PIGEON_FLIGHT_MIN_ALT) + 2
        );
        break;
      case NPCType.SQUIRREL:
        this.speed = GAME_CONFIG.NPC_SQUIRREL_SPEED * 1.5;
        break;
      default:
        this.speed = GAME_CONFIG.NPC_RAT_SPEED * 1.5;
        break;
    }
  }

  public getEnergyReward(): number {
    switch (this.type) {
      case NPCType.PIGEON:
        return GAME_CONFIG.NPC_PIGEON_ENERGY;
      case NPCType.SQUIRREL:
        return GAME_CONFIG.NPC_SQUIRREL_ENERGY;
      default:
        return GAME_CONFIG.NPC_RAT_ENERGY;
    }
  }

  public getEatTime(): number {
    switch (this.type) {
      case NPCType.PIGEON:
        return GAME_CONFIG.NPC_PIGEON_EAT_TIME;
      case NPCType.SQUIRREL:
        return GAME_CONFIG.NPC_SQUIRREL_EAT_TIME;
      default:
        return GAME_CONFIG.NPC_RAT_EAT_TIME;
    }
  }

  public getRespawnTime(): number {
    switch (this.type) {
      case NPCType.PIGEON:
        return GAME_CONFIG.NPC_PIGEON_RESPAWN;
      case NPCType.SQUIRREL:
        return GAME_CONFIG.NPC_SQUIRREL_RESPAWN;
      default:
        return GAME_CONFIG.NPC_RAT_RESPAWN;
    }
  }

  public kill(respawnTime: number): void {
    this.exists = false;
    this.state = NPCState.DEAD;
    this.respawnTimer = respawnTime;
    this.mesh.visible = false;
    // Reset interpolation so respawn snaps to the new position
    this.hasTarget = false;
  }

  public isReadyToRespawn(): boolean {
    return !this.exists && this.respawnTimer <= 0;
  }

  public respawn(newPosition: THREE.Vector3): void {
    this.exists = true;
    this.position.copy(newPosition);
    this.preferredAltitude = newPosition.y;
    this.homeAnchor.copy(newPosition);
    this.verticalPhase = this.random() * Math.PI * 2;
    this.mesh.position.copy(this.position);
    this.mesh.visible = true;
    this.enterIdle();
  }

  public getFleeRange(): number {
    switch (this.type) {
      case NPCType.PIGEON:
        return GAME_CONFIG.NPC_PIGEON_FLEE_RANGE;
      case NPCType.SQUIRREL:
        return GAME_CONFIG.NPC_SQUIRREL_FLEE_RANGE;
      default:
        return GAME_CONFIG.NPC_RAT_FLEE_RANGE;
    }
  }

  private getRadiusByType(type: NPCType): number {
    const scale = GAME_CONFIG.NPC_COLLISION_RADIUS_MULT;
    switch (type) {
      case NPCType.PIGEON:
        return GAME_CONFIG.NPC_PIGEON_RADIUS * scale;
      case NPCType.SQUIRREL:
        return GAME_CONFIG.NPC_SQUIRREL_RADIUS * scale;
      default:
        return GAME_CONFIG.NPC_RAT_RADIUS * scale;
    }
  }

  private getDebugColorByType(): number {
    switch (this.type) {
      case NPCType.PIGEON:
        return 0x66ccff;
      case NPCType.SQUIRREL:
        return 0xffaa44;
      default:
        return 0xdd6666;
    }
  }

  private updateDebugCollisionMesh(): void {
    if (this.debugMesh) {
      this.mesh.remove(this.debugMesh);
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
      this.debugMesh = null;
    }
    // Only create if enabled (will be controlled by Game.ts)
    if (!GAME_CONFIG.SHOW_COLLISION_DEBUG) return;

    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: this.getDebugColorByType(),
      wireframe: true,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
    });
    this.debugMesh = new THREE.Mesh(geo, mat);
    this.debugMesh.scale.setScalar(this.radius);
    this.debugMesh.renderOrder = 998;
    this.mesh.add(this.debugMesh);
  }

  /**
   * Public method to toggle collision debug visibility
   */
  public setCollisionDebugVisible(visible: boolean): void {
    if (this.debugMesh) {
      this.mesh.remove(this.debugMesh);
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
      this.debugMesh = null;
    }

    if (visible) {
      const geo = new THREE.SphereGeometry(1, 16, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: this.getDebugColorByType(),
        wireframe: true,
        transparent: true,
        opacity: 0.4,
        depthTest: false,
      });
      this.debugMesh = new THREE.Mesh(geo, mat);
      this.debugMesh.scale.setScalar(this.radius);
      this.debugMesh.renderOrder = 998;
      this.mesh.add(this.debugMesh);
    }
  }

  private getGroundHeight(): number {
    if (this.type === NPCType.RAT) return 0.25;
    if (this.type === NPCType.SQUIRREL) return 0.35;
    return 0.3;
  }

  private advanceMovement(deltaTime: number): void {
    if (this.type === NPCType.PIGEON) {
      this.heading += this.turnRate * deltaTime;
      this.moveDirection.set(Math.cos(this.heading), 0, Math.sin(this.heading));
      this.position.addScaledVector(this.moveDirection, this.speed * deltaTime);
      return;
    }

    if (this.type === NPCType.SQUIRREL) {
      // Tree squirrels keep quick, curved movement around their current zone.
      this.heading += this.turnRate * deltaTime * 0.6;
      if (this.preferredAltitude > 1.0) {
        const toHomeX = this.homeAnchor.x - this.position.x;
        const toHomeZ = this.homeAnchor.z - this.position.z;
        const distSq = toHomeX * toHomeX + toHomeZ * toHomeZ;
        if (distSq > 20.25) {
          const homeHeading = Math.atan2(toHomeZ, toHomeX);
          const delta = Math.atan2(Math.sin(homeHeading - this.heading), Math.cos(homeHeading - this.heading));
          this.heading += delta * Math.min(1, deltaTime * 2.0);
        }
      }
      this.moveDirection.set(Math.cos(this.heading), 0, Math.sin(this.heading));
      this.position.addScaledVector(this.moveDirection, this.speed * deltaTime);
      return;
    }

    this.position.addScaledVector(this.moveDirection, this.speed * deltaTime);
  }

  private applyHeightProfile(deltaTime: number): void {
    this.verticalPhase += deltaTime * GAME_CONFIG.NPC_PIGEON_SWOOP_FREQUENCY;

    if (this.type === NPCType.PIGEON) {
      const swoop = Math.sin(this.verticalPhase) * GAME_CONFIG.NPC_PIGEON_SWOOP_AMPLITUDE;
      const targetY = this.preferredAltitude + swoop;
      const previousY = this.position.y;
      this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, Math.min(1, deltaTime * 3.0));
      const climbRate = (this.position.y - previousY) / Math.max(deltaTime, 0.001);
      this.mesh.rotation.x = THREE.MathUtils.clamp(-climbRate * 0.05, -0.35, 0.35);
      return;
    }

    if (this.type === NPCType.SQUIRREL && this.preferredAltitude > 1.0) {
      const canopyBob = Math.sin(this.verticalPhase * 1.7) * 0.25;
      const targetY = this.preferredAltitude + canopyBob;
      this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, Math.min(1, deltaTime * 4.5));
      this.mesh.rotation.x = 0;
      return;
    }

    this.position.y = this.getGroundHeight();
    this.mesh.rotation.x = 0;
  }

  private constrainToWorldBounds(): void {
    const halfExtent = GAME_CONFIG.GROUND_SIZE / 2 - 6;
    let reflected = false;

    if (this.position.x > halfExtent) {
      this.position.x = halfExtent;
      this.heading = Math.PI - this.heading;
      reflected = true;
    } else if (this.position.x < -halfExtent) {
      this.position.x = -halfExtent;
      this.heading = Math.PI - this.heading;
      reflected = true;
    }

    if (this.position.z > halfExtent) {
      this.position.z = halfExtent;
      this.heading = -this.heading;
      reflected = true;
    } else if (this.position.z < -halfExtent) {
      this.position.z = -halfExtent;
      this.heading = -this.heading;
      reflected = true;
    }

    if (reflected) {
      this.moveDirection.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    }
  }

  private randomSigned(): number {
    return this.random() * 2 - 1;
  }

  private randomInRange(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  public getSnapshot(): NPCSnapshot {
    return {
      id: this.id,
      type: this.type,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotation: this.heading,
      state: this.state,
      exists: this.exists,
    };
  }

  public applySnapshot(snapshot: NPCSnapshot): void {
    this.state = snapshot.state;
    this.exists = snapshot.exists;
    this.mesh.visible = this.exists;

    if (!this.hasTarget) {
      // First snapshot — snap immediately (no previous position to lerp from)
      this.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
      this.heading = snapshot.rotation;
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = this.heading;
    }

    // Set interpolation targets for subsequent frames
    this.targetPosition.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    this.targetHeading = snapshot.rotation;
    this.hasTarget = true;
  }

  /**
   * Smoothly interpolate mesh toward the latest snapshot target.
   * Called every frame on the client to eliminate jitter between network updates.
   */
  public lerpToTarget(deltaTime: number): void {
    if (!this.hasTarget || !this.exists) return;

    // Lerp factor: reaches ~95% of target in ~100ms at 60fps
    const factor = Math.min(1, deltaTime * 12);

    this.position.lerp(this.targetPosition, factor);
    this.mesh.position.copy(this.position);

    // Shortest-path angle lerp for heading
    const delta = Math.atan2(
      Math.sin(this.targetHeading - this.heading),
      Math.cos(this.targetHeading - this.heading)
    );
    this.heading += delta * factor;
    this.mesh.rotation.y = this.heading;
  }

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
