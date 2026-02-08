import * as THREE from 'three';
import { Food } from '../entities/Food';
import { FoodType } from '../config/constants';
import { GridCell } from './Environment';
import { SeededRandom } from '../utils/SeededRandom';
import { Building } from './Building';
import { getModelByKey } from '../utils/ModelLoader';

export interface FoodSnapshot {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  exists: boolean;
  respawnTimer: number;
}

/**
 * Spawns and manages all food entities.
 * Food is distributed across park cells and streets using seeded random.
 */
export class FoodSpawner {
  private scene: THREE.Scene;
  private foods: Map<string, Food> = new Map();

  constructor(
    scene: THREE.Scene,
    parkCells: GridCell[],
    streetCenters: THREE.Vector3[],
    buildings: Building[],
    rng: SeededRandom
  ) {
    this.scene = scene;
    this.createFoods(parkCells, streetCenters, buildings, rng);
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

  /**
   * Distribute food across park cells and streets using seeded random.
   */
  private createFoods(
    parkCells: GridCell[],
    streetCenters: THREE.Vector3[],
    buildings: Building[],
    rng: SeededRandom
  ): void {
    const margin = 2;

    // Crumbs scattered across park cells (30 total)
    for (let i = 0; i < 30; i++) {
      const cell = rng.pick(parkCells);
      const half = cell.size / 2 - margin;
      const x = cell.centerX + rng.nextFloat(-half, half);
      const z = cell.centerZ + rng.nextFloat(-half, half);
      this.addFood(`crumb-${i}`, FoodType.CRUMB, new THREE.Vector3(x, 0.3, z));
    }

    // Bagels in park cells (8 total)
    for (let i = 0; i < 8; i++) {
      const cell = rng.pick(parkCells);
      const half = cell.size / 2 - margin;
      const x = cell.centerX + rng.nextFloat(-half, half);
      const z = cell.centerZ + rng.nextFloat(-half, half);
      this.addFood(`bagel-${i}`, FoodType.BAGEL, new THREE.Vector3(x, 0.6, z));
    }

    // Pizza on streets (3 total)
    for (let i = 0; i < 3; i++) {
      const center = rng.pick(streetCenters);
      const x = center.x + rng.nextFloat(-1, 1);
      const z = center.z + rng.nextFloat(-1, 1);
      this.addFood(`pizza-${i}`, FoodType.PIZZA, new THREE.Vector3(x, 0.3, z));
    }

    this.addRooftopFoods(buildings, rng);

    // Static rats removed. Hawk prey now comes from NPC rats/squirrels/pigeons.
  }

  private addRooftopFoods(buildings: Building[], rng: SeededRandom): void {
    if (buildings.length === 0) return;

    const roofMargin = 1.0;

    // High-risk/high-reward rooftop food: mostly bagels and pizza.
    for (let i = 0; i < 10; i++) {
      const building = rng.pick(buildings);
      const x = rng.nextFloat(building.min.x + roofMargin, building.max.x - roofMargin);
      const z = rng.nextFloat(building.min.z + roofMargin, building.max.z - roofMargin);
      this.addFood(`roof-bagel-${i}`, FoodType.BAGEL, new THREE.Vector3(x, building.max.y + 0.6, z));
    }

    for (let i = 0; i < 8; i++) {
      const building = rng.pick(buildings);
      const x = rng.nextFloat(building.min.x + roofMargin, building.max.x - roofMargin);
      const z = rng.nextFloat(building.min.z + roofMargin, building.max.z - roofMargin);
      this.addFood(`roof-pizza-${i}`, FoodType.PIZZA, new THREE.Vector3(x, building.max.y + 0.3, z));
    }

    // Keep rooftop crumbs minimal.
    for (let i = 0; i < 2; i++) {
      const building = rng.pick(buildings);
      const x = rng.nextFloat(building.min.x + roofMargin, building.max.x - roofMargin);
      const z = rng.nextFloat(building.min.z + roofMargin, building.max.z - roofMargin);
      this.addFood(`roof-crumb-${i}`, FoodType.CRUMB, new THREE.Vector3(x, building.max.y + 0.25, z));
    }
  }

  private addFood(id: string, type: FoodType, position: THREE.Vector3): void {
    const modelKey = (() => {
      switch (type) {
        case FoodType.CRUMB:
          return 'food/crumb';
        case FoodType.BAGEL:
          return 'food/bagel';
        case FoodType.PIZZA:
          return 'food/pizza';
        case FoodType.RAT:
          return 'food/rat';
        default:
          return null;
      }
    })();
    const model = modelKey ? getModelByKey(modelKey) : null;
    const food = new Food(id, type, position, model);
    this.foods.set(id, food);
    this.scene.add(food.mesh);
  }
}
