import * as THREE from 'three';
import { FoodType, GAME_CONFIG } from '../config/constants';

/**
 * Food item entity
 */
export class Food {
  public id: string;
  public type: FoodType;
  public mesh: THREE.Mesh;
  public position: THREE.Vector3;
  public exists: boolean = true;
  public respawnTimer: number = 0;

  // Food properties
  public weightGain: number = 0;
  public energyGain: number = 0;
  public eatTime: number = 1;
  public radius: number = 0.5; // Collision radius

  constructor(id: string, type: FoodType, position: THREE.Vector3) {
    this.id = id;
    this.type = type;
    this.position = position.clone();

    // Set properties based on food type
    this.setPropertiesByType(type);

    // Create mesh
    this.mesh = this.createMesh(type);
    this.mesh.position.copy(this.position);
  }

  /**
   * Set food properties based on type
   */
  private setPropertiesByType(type: FoodType): void {
    switch (type) {
      case FoodType.CRUMB:
        this.weightGain = GAME_CONFIG.CRUMB_WEIGHT;
        this.eatTime = GAME_CONFIG.CRUMB_EAT_TIME;
        this.energyGain = 0;
        break;

      case FoodType.BAGEL:
        this.weightGain = GAME_CONFIG.BAGEL_WEIGHT;
        this.eatTime = GAME_CONFIG.BAGEL_EAT_TIME;
        this.energyGain = 0;
        break;

      case FoodType.PIZZA:
        this.weightGain = GAME_CONFIG.PIZZA_WEIGHT;
        this.eatTime = GAME_CONFIG.PIZZA_EAT_TIME;
        this.energyGain = 0;
        break;

      case FoodType.RAT:
        this.weightGain = 0;
        this.eatTime = GAME_CONFIG.RAT_EAT_TIME;
        this.energyGain = GAME_CONFIG.RAT_ENERGY;
        break;

      default:
        this.weightGain = 0;
        this.eatTime = 1;
        this.energyGain = 0;
    }
  }

  /**
   * Create food mesh based on type
   */
  private createMesh(type: FoodType): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    let color: number;

    switch (type) {
      case FoodType.CRUMB:
        geometry = new THREE.SphereGeometry(0.2, 6, 6);
        color = 0xd4a574; // Beige/tan
        break;

      case FoodType.BAGEL:
        geometry = new THREE.TorusGeometry(0.4, 0.15, 8, 12);
        color = 0xd4a574; // Beige/tan
        break;

      case FoodType.PIZZA:
        geometry = new THREE.ConeGeometry(0.6, 0.1, 3);
        color = 0xff6b35; // Orange-red
        break;

      case FoodType.RAT:
        geometry = new THREE.CapsuleGeometry(0.2, 0.4, 4, 8);
        color = 0x666666; // Gray
        break;

      default:
        geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        color = 0xffffff;
    }

    const material = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Rotate pizza to lay flat
    if (type === FoodType.PIZZA) {
      mesh.rotation.x = Math.PI / 2;
    }

    // Rotate rat to horizontal
    if (type === FoodType.RAT) {
      mesh.rotation.z = Math.PI / 2;
    }

    return mesh;
  }

  /**
   * Update food state
   */
  public update(deltaTime: number): void {
    // Handle respawn timer
    if (!this.exists && this.respawnTimer > 0) {
      this.respawnTimer -= deltaTime;
      if (this.respawnTimer <= 0) {
        this.respawn();
      }
    }

    // Rotate food slightly for visual effect
    if (this.exists) {
      this.mesh.rotation.y += deltaTime * 0.5;
    }
  }

  /**
   * Collect this food item
   */
  public collect(): void {
    this.exists = false;
    this.mesh.visible = false;
    this.respawnTimer = GAME_CONFIG.FOOD_RESPAWN_TIME;
  }

  /**
   * Respawn food item
   */
  public respawn(): void {
    this.exists = true;
    this.mesh.visible = true;
    this.respawnTimer = 0;
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    this.mesh.geometry.dispose();
    if (this.mesh.material instanceof THREE.Material) {
      this.mesh.material.dispose();
    }
  }
}
