import * as THREE from 'three';
import { Building } from './Building';
import { GAME_CONFIG } from '../config/constants';
import { SeededRandom } from '../utils/SeededRandom';
import { getModelByKey } from '../utils/ModelLoader';

/**
 * Cell type in the city grid.
 */
export enum CellType {
  PARK = 'park',
  BUILDING = 'building',
}

/**
 * Info about a single grid cell, exported for FoodSpawner / NPCSpawner use.
 */
export interface GridCell {
  row: number;
  col: number;
  type: CellType;
  centerX: number;
  centerZ: number;
  size: number;
}

/**
 * Tree collision data.
 */
interface Tree {
  group: THREE.Group;
  position: THREE.Vector3;
  trunkRadius: number;
  canopyRadius: number;
  canopyCenterY: number;
}

export interface TreeCanopyAnchor {
  position: THREE.Vector3;
  canopyRadius: number;
  canopyCenterY: number;
}

/**
 * City environment generator — 10x10 seeded grid.
 *
 * Grid layout:
 *   - 10×10 cells, each CELL_SIZE × CELL_SIZE, separated by STREET_WIDTH streets
 *   - Each cell is either BUILDING or PARK (seeded random, ~40% building)
 *   - Edge cells (row 0, row 9, col 0, col 9) are forced to PARK
 *   - Building cells get 1-2 random buildings
 *   - Park cells get trees and benches
 *   - Streets run between every row and column
 */
export class Environment {
  public buildings: Building[] = [];
  public trees: Tree[] = [];
  public treeCanopies: TreeCanopyAnchor[] = [];
  public grid: GridCell[][] = [];
  public parkCells: GridCell[] = [];
  public streetCenters: THREE.Vector3[] = [];

  private group: THREE.Group;
  private rng: SeededRandom;

  constructor(scene: THREE.Scene, seed: number) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rng = new SeededRandom(seed);

    this.createGroundPlane();
    this.generateGrid();
    this.buildCells();
    this.createStreets();
  }

  /**
   * Compute the world-space center of a grid cell.
   */
  private cellCenter(row: number, col: number): { x: number; z: number } {
    const gridTotal = GAME_CONFIG.GRID_SIZE * GAME_CONFIG.CELL_SIZE +
      (GAME_CONFIG.GRID_SIZE + 1) * GAME_CONFIG.STREET_WIDTH;
    const halfGrid = gridTotal / 2;

    const x = GAME_CONFIG.STREET_WIDTH * (col + 1) + GAME_CONFIG.CELL_SIZE * col +
      GAME_CONFIG.CELL_SIZE / 2 - halfGrid;
    const z = GAME_CONFIG.STREET_WIDTH * (row + 1) + GAME_CONFIG.CELL_SIZE * row +
      GAME_CONFIG.CELL_SIZE / 2 - halfGrid;

    return { x, z };
  }

  /**
   * Generate the 10×10 grid, assigning BUILDING or PARK to each cell.
   */
  private generateGrid(): void {
    const size = GAME_CONFIG.GRID_SIZE;

    // First pass: assign types
    for (let row = 0; row < size; row++) {
      this.grid[row] = [];
      for (let col = 0; col < size; col++) {
        const isEdge = row === 0 || row === size - 1 || col === 0 || col === size - 1;
        const center = this.cellCenter(row, col);

        const type: CellType = isEdge
          ? CellType.PARK
          : this.rng.chance(GAME_CONFIG.BUILDING_CHANCE) ? CellType.BUILDING : CellType.PARK;

        this.grid[row][col] = {
          row,
          col,
          type,
          centerX: center.x,
          centerZ: center.z,
          size: GAME_CONFIG.CELL_SIZE,
        };
      }
    }

    // Second pass: ensure no isolated building cells (must have at least one park neighbor)
    for (let row = 1; row < size - 1; row++) {
      for (let col = 1; col < size - 1; col++) {
        if (this.grid[row][col].type !== CellType.BUILDING) continue;

        const neighbors = [
          this.grid[row - 1][col],
          this.grid[row + 1][col],
          this.grid[row][col - 1],
          this.grid[row][col + 1],
        ];
        const hasParkNeighbor = neighbors.some(n => n.type === CellType.PARK);
        if (!hasParkNeighbor) {
          // Convert a random neighbor to park
          const ni = this.rng.nextInt(0, neighbors.length - 1);
          neighbors[ni].type = CellType.PARK;
        }
      }
    }

    // Collect park cells and street centers
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (this.grid[row][col].type === CellType.PARK) {
          this.parkCells.push(this.grid[row][col]);
        }
      }
    }

    this.computeStreetCenters();
  }

  /**
   * Compute representative street center positions for NPC/food spawning.
   */
  private computeStreetCenters(): void {
    const size = GAME_CONFIG.GRID_SIZE;

    // Horizontal streets: midpoint between row pairs
    for (let row = 0; row < size - 1; row++) {
      const z1 = this.grid[row][0].centerZ;
      const z2 = this.grid[row + 1][0].centerZ;
      const streetZ = (z1 + z2) / 2;
      for (let col = 0; col < size; col++) {
        this.streetCenters.push(new THREE.Vector3(this.grid[row][col].centerX, 0.3, streetZ));
      }
    }

    // Vertical streets: midpoint between column pairs
    for (let col = 0; col < size - 1; col++) {
      const x1 = this.grid[0][col].centerX;
      const x2 = this.grid[0][col + 1].centerX;
      const streetX = (x1 + x2) / 2;
      for (let row = 0; row < size; row++) {
        this.streetCenters.push(new THREE.Vector3(streetX, 0.3, this.grid[row][col].centerZ));
      }
    }
  }

  /**
   * Build content for each cell.
   */
  private buildCells(): void {
    for (let row = 0; row < GAME_CONFIG.GRID_SIZE; row++) {
      for (let col = 0; col < GAME_CONFIG.GRID_SIZE; col++) {
        const cell = this.grid[row][col];
        if (cell.type === CellType.BUILDING) {
          this.buildBuildingCell(cell);
        } else {
          this.buildParkCell(cell);
        }
      }
    }
  }

  /**
   * Place 1-2 buildings in a building cell.
   */
  private buildBuildingCell(cell: GridCell): void {
    const count = this.rng.nextInt(1, 2);
    const halfCell = cell.size / 2;
    const margin = 2;
    const usable = halfCell - margin;

    for (let i = 0; i < count; i++) {
      const w = this.rng.nextFloat(8, Math.min(22, cell.size - margin * 2));
      const d = this.rng.nextFloat(8, Math.min(22, cell.size - margin * 2));
      const h = this.rng.nextFloat(GAME_CONFIG.BUILDING_MIN_HEIGHT, GAME_CONFIG.BUILDING_MAX_HEIGHT);

      let ox: number, oz: number;
      if (count === 1) {
        ox = this.rng.nextFloat(-usable + w / 2, usable - w / 2);
        oz = this.rng.nextFloat(-usable + d / 2, usable - d / 2);
      } else if (i === 0) {
        ox = this.rng.nextFloat(-usable + w / 2, -1);
        oz = this.rng.nextFloat(-usable + d / 2, usable - d / 2);
      } else {
        ox = this.rng.nextFloat(1, usable - w / 2);
        oz = this.rng.nextFloat(-usable + d / 2, usable - d / 2);
      }

      const building = new Building(
        cell.centerX + ox,
        cell.centerZ + oz,
        w,
        d,
        h,
        getModelByKey('environment/building')
      );
      this.buildings.push(building);
      this.group.add(building.mesh);
    }
  }

  /**
   * Place trees and benches in a park cell.
   */
  private buildParkCell(cell: GridCell): void {
    const halfCell = cell.size / 2;
    const margin = 2;
    const inner = halfCell - margin;

    // Green ground plane
    const parkGround = new THREE.Mesh(
      new THREE.PlaneGeometry(cell.size, cell.size),
      new THREE.MeshLambertMaterial({ color: 0x4a7a3a })
    );
    parkGround.rotation.x = -Math.PI / 2;
    parkGround.position.set(cell.centerX, 0.01, cell.centerZ);
    parkGround.receiveShadow = true;
    this.group.add(parkGround);

    // Trees
    const treeCount = this.rng.nextInt(GAME_CONFIG.PARK_TREES_MIN, GAME_CONFIG.PARK_TREES_MAX);
    for (let i = 0; i < treeCount; i++) {
      this.createTree(
        cell.centerX + this.rng.nextFloat(-inner, inner),
        cell.centerZ + this.rng.nextFloat(-inner, inner)
      );
    }

    // Benches
    const benchCount = this.rng.nextInt(0, GAME_CONFIG.PARK_BENCHES_MAX);
    for (let i = 0; i < benchCount; i++) {
      this.createBench(
        cell.centerX + this.rng.nextFloat(-inner, inner),
        cell.centerZ + this.rng.nextFloat(-inner, inner),
        this.rng.chance(0.5) ? 0 : Math.PI / 2
      );
    }
  }

  /**
   * Create a low-poly tree.
   */
  private createTree(x: number, z: number): void {
    const treeGroup = new THREE.Group();

    const scale = this.rng.nextFloat(0.8, 1.4);
    const trunkHeight = 3 * scale;
    const trunkRadius = 0.3 * scale;
    const canopyRadius = 2.5 * scale;

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkRadius, trunkRadius * 1.2, trunkHeight, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4226 })
    );
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    const canopyCenterY = trunkHeight + canopyRadius * 0.6;
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(canopyRadius, 8, 6),
      new THREE.MeshLambertMaterial({
        color: this.rng.pick([0x2d5a1e, 0x356425, 0x3b6a2b, 0x2f6122, 0x42732f]),
      })
    );
    canopy.position.y = canopyCenterY;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    treeGroup.add(canopy);

    treeGroup.position.set(x, 0, z);
    this.group.add(treeGroup);

    this.trees.push({
      group: treeGroup,
      position: new THREE.Vector3(x, 0, z),
      trunkRadius,
      canopyRadius,
      canopyCenterY,
    });
    this.treeCanopies.push({
      position: new THREE.Vector3(x, 0, z),
      canopyRadius,
      canopyCenterY,
    });
  }

  /**
   * Create a park bench.
   */
  private createBench(x: number, z: number, rotationY: number): void {
    const benchGroup = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });

    const seat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.6), mat);
    seat.position.y = 0.5;
    benchGroup.add(seat);

    const legGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
    for (const [lx, ly, lz] of [[-0.8, 0.25, -0.2], [-0.8, 0.25, 0.2], [0.8, 0.25, -0.2], [0.8, 0.25, 0.2]]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx, ly, lz);
      benchGroup.add(leg);
    }

    const back = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 0.08), mat);
    back.position.set(0, 0.8, -0.25);
    benchGroup.add(back);

    benchGroup.position.set(x, 0, z);
    benchGroup.rotation.y = rotationY;
    this.group.add(benchGroup);
  }

  /**
   * Create street line markings between cells.
   */
  private createStreets(): void {
    const lineMaterial = new THREE.MeshLambertMaterial({ color: 0xcccc44 });
    const gridTotal = GAME_CONFIG.GRID_SIZE * GAME_CONFIG.CELL_SIZE +
      (GAME_CONFIG.GRID_SIZE + 1) * GAME_CONFIG.STREET_WIDTH;
    const halfGrid = gridTotal / 2;

    for (let i = 0; i <= GAME_CONFIG.GRID_SIZE; i++) {
      const offset = GAME_CONFIG.STREET_WIDTH * (i + 0.5) + GAME_CONFIG.CELL_SIZE * i - halfGrid;

      // Horizontal street line
      const hLine = new THREE.Mesh(new THREE.PlaneGeometry(gridTotal, 0.3), lineMaterial);
      hLine.rotation.x = -Math.PI / 2;
      hLine.position.set(0, 0.02, offset);
      this.group.add(hLine);

      // Vertical street line
      const vLine = new THREE.Mesh(new THREE.PlaneGeometry(0.3, gridTotal), lineMaterial);
      vLine.rotation.x = -Math.PI / 2;
      vLine.position.set(offset, 0.02, 0);
      this.group.add(vLine);
    }
  }

  /**
   * Create the main ground plane.
   */
  private createGroundPlane(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GAME_CONFIG.GROUND_SIZE, GAME_CONFIG.GROUND_SIZE),
      new THREE.MeshLambertMaterial({ color: 0x666666 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /**
   * Check building and tree trunk collisions, push player out.
   */
  public checkAndResolveCollisions(position: THREE.Vector3, radius: number, velocity: THREE.Vector3): boolean {
    let collided = false;

    for (const building of this.buildings) {
      if (building.intersectsSphere(position, radius)) {
        building.pushOut(position, radius, velocity);
        collided = true;
      }
    }

    for (const tree of this.trees) {
      const dx = position.x - tree.position.x;
      const dz = position.z - tree.position.z;
      const dist2D = Math.sqrt(dx * dx + dz * dz);
      const combinedRadius = radius + tree.trunkRadius;

      if (dist2D < combinedRadius && position.y < 4) {
        const pushDist = combinedRadius - dist2D;
        const safeDist = Math.max(dist2D, 0.0001);
        position.x += (dx / safeDist) * pushDist;
        position.z += (dz / safeDist) * pushDist;
        velocity.x *= 0.5;
        velocity.z *= 0.5;
        collided = true;
      }
    }

    return collided;
  }


  /**
   * True when the player is contacting walkable surfaces (ground or rooftops).
   * Tree trunks/canopies are intentionally excluded.
   */
  public isOnWalkableSurface(position: THREE.Vector3, radius: number): boolean {
    const epsilon = GAME_CONFIG.SURFACE_CONTACT_EPSILON;

    if (position.y <= Math.max(1, radius) + epsilon) {
      return true;
    }

    const sphereBottom = position.y - radius;
    for (const building of this.buildings) {
      const withinRoofBounds =
        position.x >= building.min.x - radius &&
        position.x <= building.max.x + radius &&
        position.z >= building.min.z - radius &&
        position.z <= building.max.z + radius;

      if (!withinRoofBounds) continue;

      if (Math.abs(sphereBottom - building.max.y) <= epsilon) {
        return true;
      }
    }

    return false;
  }

  /**
   * Slow hawks in tree canopies.
   */
  public applyHawkCanopySlow(
    position: THREE.Vector3,
    radius: number,
    velocity: THREE.Vector3,
    deltaTime: number
  ): boolean {
    let slowed = false;

    for (const tree of this.trees) {
      const dx = position.x - tree.position.x;
      const dy = position.y - tree.canopyCenterY;
      const dz = position.z - tree.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance < tree.canopyRadius + radius) {
        velocity.multiplyScalar(Math.pow(0.2, deltaTime * 6));
        slowed = true;
      }
    }

    return slowed;
  }

  /**
   * Cleanup.
   */
  public dispose(): void {
    for (const building of this.buildings) {
      building.dispose();
    }
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
