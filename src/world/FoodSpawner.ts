import * as THREE from 'three';
import { Food } from '../entities/Food';
import { FoodType } from '../config/constants';

export interface FoodSnapshot {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  exists: boolean;
  respawnTimer: number;
}

/**
 * Spawns and manages all food entities.
 */
export class FoodSpawner {
  private scene: THREE.Scene;
  private foods: Map<string, Food> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createInitialFoods();
  }

  public update(deltaTime: number): void {
    this.foods.forEach((food) => food.update(deltaTime));
  }

  public getFoods(): Food[] {
    return Array.from(this.foods.values());
  }

  public getFood(id: string): Food | undefined {
    return this.foods.get(id);
  }

  public setFoodState(id: string, exists: boolean, respawnTimer?: number): void {
    const food = this.foods.get(id);
    if (!food) return;

    if (food.exists !== exists) {
      if (exists) {
        food.respawn();
      } else {
        food.collect();
      }
    }

    if (respawnTimer !== undefined) {
      food.respawnTimer = Math.max(0, respawnTimer);
    }
  }

  public resetAll(): void {
    this.foods.forEach((food) => {
      food.respawn();
      food.respawnTimer = 0;
    });
  }

  public getSnapshot(): FoodSnapshot[] {
    return this.getFoods().map((food) => ({
      id: food.id,
      type: food.type,
      position: {
        x: food.position.x,
        y: food.position.y,
        z: food.position.z,
      },
      exists: food.exists,
      respawnTimer: food.respawnTimer,
    }));
  }

  public dispose(): void {
    this.foods.forEach((food) => {
      this.scene.remove(food.mesh);
      food.dispose();
    });
    this.foods.clear();
  }

  private createInitialFoods(): void {
    // Crumbs scattered around the park (park is -25 to +25)
    const crumbPositions = [
      { x: -12, z: -8 }, { x: -6, z: -15 }, { x: 3, z: -12 },
      { x: 10, z: -18 }, { x: 15, z: -3 }, { x: -18, z: 3 },
      { x: -8, z: 12 }, { x: 6, z: 8 }, { x: 14, z: 14 },
      { x: -14, z: -20 }, { x: 0, z: 5 }, { x: 8, z: -6 },
      { x: -20, z: -14 }, { x: 20, z: 12 }, { x: -3, z: 20 },
      // A few on streets around the park
      { x: -30, z: 0 }, { x: 30, z: 0 }, { x: 0, z: -30 },
      { x: 0, z: 30 }, { x: -30, z: -30 },
    ];
    crumbPositions.forEach((pos, index) => {
      this.addFood(`crumb-${index}`, FoodType.CRUMB, new THREE.Vector3(pos.x, 0.3, pos.z));
    });

    // Bagels near park benches (benches at (0,-8), (0,8), (-8,0), (8,0))
    const bagelPositions = [
      new THREE.Vector3(1, 0.6, -8),
      new THREE.Vector3(-1, 0.6, 8),
      new THREE.Vector3(-8, 0.6, 1),
      new THREE.Vector3(8, 0.6, -1),
      new THREE.Vector3(0, 0.3, 0),
    ];
    bagelPositions.forEach((pos, index) => {
      this.addFood(`bagel-${index}`, FoodType.BAGEL, pos);
    });

    // Pizza on a street corner
    this.addFood('pizza-0', FoodType.PIZZA, new THREE.Vector3(-28, 0.3, -28));

    // Rats along streets (between park and buildings)
    const ratPositions = [
      new THREE.Vector3(-30, 0.3, 10),
      new THREE.Vector3(-30, 0.3, -10),
      new THREE.Vector3(30, 0.3, 10),
      new THREE.Vector3(30, 0.3, -10),
      new THREE.Vector3(10, 0.3, 30),
      new THREE.Vector3(-10, 0.3, -30),
    ];
    ratPositions.forEach((pos, index) => {
      this.addFood(`rat-${index}`, FoodType.RAT, pos);
    });
  }

  private addFood(id: string, type: FoodType, position: THREE.Vector3): void {
    const food = new Food(id, type, position);
    this.foods.set(id, food);
    this.scene.add(food.mesh);
  }
}
