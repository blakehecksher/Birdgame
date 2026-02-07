import * as THREE from 'three';
import { Building } from './Building';
import { GAME_CONFIG } from '../config/constants';

/**
 * Tree structure for the park
 */
interface Tree {
  group: THREE.Group;
  position: THREE.Vector3;
  trunkRadius: number;
  canopyRadius: number;
  canopyCenterY: number;
}

/**
 * City environment generator
 * Creates a 2x2 block city grid with a central park
 */
export class Environment {
  public buildings: Building[] = [];
  public trees: Tree[] = [];
  private group: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.createCityGrid();
    this.createPark();
    this.createStreets();
  }

  /**
   * Create 2x2 city blocks with buildings
   * Layout (top-down, centered on origin):
   *
   *  NW Block  |  street  |  NE Block
   *  ----------+---------+----------
   *   street   |  PARK   |  street
   *  ----------+---------+----------
   *  SW Block  |  street  |  SE Block
   */
  private createCityGrid(): void {
    const blockOffset = 35; // Distance from center to block center
    let buildingIndex = 0;

    // Building positions: [x, z, width, depth]
    // Each block gets 2-3 buildings of varying sizes
    const blockConfigs = [
      // NW Block (negative x, negative z)
      { cx: -blockOffset, cz: -blockOffset, buildings: [
        { ox: -8, oz: -8, w: 14, d: 14 },
        { ox: 8, oz: -5, w: 10, d: 18 },
        { ox: -5, oz: 10, w: 18, d: 8 },
      ]},
      // NE Block (positive x, negative z)
      { cx: blockOffset, cz: -blockOffset, buildings: [
        { ox: 0, oz: -8, w: 20, d: 12 },
        { ox: -8, oz: 8, w: 12, d: 12 },
        { ox: 8, oz: 6, w: 10, d: 16 },
      ]},
      // SW Block (negative x, positive z)
      { cx: -blockOffset, cz: blockOffset, buildings: [
        { ox: -6, oz: 0, w: 16, d: 20 },
        { ox: 8, oz: -8, w: 10, d: 10 },
        { ox: 8, oz: 8, w: 12, d: 10 },
      ]},
      // SE Block (positive x, positive z)
      { cx: blockOffset, cz: blockOffset, buildings: [
        { ox: 0, oz: -6, w: 22, d: 14 },
        { ox: -6, oz: 10, w: 14, d: 8 },
        { ox: 8, oz: 10, w: 8, d: 8 },
      ]},
    ];

    for (const block of blockConfigs) {
      for (const b of block.buildings) {
        const t = this.seededUnitValue(buildingIndex + 1);
        const height = GAME_CONFIG.BUILDING_MIN_HEIGHT +
          t * (GAME_CONFIG.BUILDING_MAX_HEIGHT - GAME_CONFIG.BUILDING_MIN_HEIGHT);

        const building = new Building(
          block.cx + b.ox,
          block.cz + b.oz,
          b.w,
          b.d,
          height
        );

        this.buildings.push(building);
        this.group.add(building.mesh);
        buildingIndex++;
      }
    }
  }

  /**
   * Create central park with trees
   */
  private createPark(): void {
    const parkSize = GAME_CONFIG.PARK_SIZE;

    // Green park ground
    const parkGeometry = new THREE.PlaneGeometry(parkSize, parkSize);
    const parkMaterial = new THREE.MeshLambertMaterial({ color: 0x4a7a3a });
    const parkGround = new THREE.Mesh(parkGeometry, parkMaterial);
    parkGround.rotation.x = -Math.PI / 2;
    parkGround.position.set(0, 0.01, 0); // Slightly above main ground to avoid z-fighting
    parkGround.receiveShadow = true;
    this.group.add(parkGround);

    // Add trees in a scattered pattern
    const treePositions = [
      { x: -12, z: -12 },
      { x: 8, z: -15 },
      { x: -18, z: 5 },
      { x: 15, z: 8 },
      { x: -5, z: 14 },
      { x: 5, z: -5 },
      { x: -10, z: -18 },
      { x: 18, z: -5 },
      { x: -15, z: 15 },
      { x: 10, z: 18 },
    ];

    for (let i = 0; i < treePositions.length; i++) {
      const pos = treePositions[i];
      this.createTree(pos.x, pos.z, i + 1);
    }

    // Park benches (simple box geometry)
    const benchPositions = [
      { x: 0, z: -8, ry: 0 },
      { x: 0, z: 8, ry: 0 },
      { x: -8, z: 0, ry: Math.PI / 2 },
      { x: 8, z: 0, ry: Math.PI / 2 },
    ];

    for (const pos of benchPositions) {
      this.createBench(pos.x, pos.z, pos.ry);
    }
  }

  /**
   * Create a simple low-poly tree
   */
  private createTree(x: number, z: number, seed: number): void {
    const treeGroup = new THREE.Group();

    // Deterministic size variation.
    const scale = 0.8 + this.seededUnitValue(100 + seed) * 0.6;
    const trunkHeight = 3 * scale;
    const trunkRadius = 0.3 * scale;
    const canopyRadius = 2.5 * scale;

    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(trunkRadius, trunkRadius * 1.2, trunkHeight, 6);
    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    // Canopy (sphere)
    const canopyGeometry = new THREE.SphereGeometry(canopyRadius, 8, 6);
    const canopyColor = this.getDeterministicTreeColor(seed);
    const canopyMaterial = new THREE.MeshLambertMaterial({ color: canopyColor });
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    const canopyCenterY = trunkHeight + canopyRadius * 0.6;
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
  }

  /**
   * Deterministic pseudo-random value in [0, 1).
   */
  private seededUnitValue(seed: number): number {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Deterministic canopy color variation.
   */
  private getDeterministicTreeColor(seed: number): number {
    const greenPalette = [
      0x2d5a1e,
      0x356425,
      0x3b6a2b,
      0x2f6122,
      0x42732f,
    ];
    const idx = Math.floor(this.seededUnitValue(200 + seed) * greenPalette.length);
    return greenPalette[Math.min(idx, greenPalette.length - 1)];
  }

  /**
   * Create a simple park bench
   */
  private createBench(x: number, z: number, rotationY: number): void {
    const benchGroup = new THREE.Group();
    const benchMaterial = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });

    // Seat
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.1, 0.6),
      benchMaterial
    );
    seat.position.y = 0.5;
    benchGroup.add(seat);

    // Legs
    const legGeometry = new THREE.BoxGeometry(0.1, 0.5, 0.1);
    const positions = [
      [-0.8, 0.25, -0.2],
      [-0.8, 0.25, 0.2],
      [0.8, 0.25, -0.2],
      [0.8, 0.25, 0.2],
    ];
    for (const [lx, ly, lz] of positions) {
      const leg = new THREE.Mesh(legGeometry, benchMaterial);
      leg.position.set(lx, ly, lz);
      benchGroup.add(leg);
    }

    // Back
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.6, 0.08),
      benchMaterial
    );
    back.position.set(0, 0.8, -0.25);
    benchGroup.add(back);

    benchGroup.position.set(x, 0, z);
    benchGroup.rotation.y = rotationY;
    benchGroup.castShadow = true;
    this.group.add(benchGroup);
  }

  /**
   * Create street surfaces between blocks
   */
  private createStreets(): void {
    // Main cross streets (horizontal and vertical through center)
    // These are already visible as the default ground, but we add sidewalk lines

    // Street line markings (yellow center lines)
    const lineMaterial = new THREE.MeshLambertMaterial({ color: 0xcccc44 });

    // Horizontal center line
    const hLine = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 0.3),
      lineMaterial
    );
    hLine.rotation.x = -Math.PI / 2;
    hLine.position.set(0, 0.02, -35);
    this.group.add(hLine);

    const hLine2 = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 0.3),
      lineMaterial
    );
    hLine2.rotation.x = -Math.PI / 2;
    hLine2.position.set(0, 0.02, 35);
    this.group.add(hLine2);

    // Vertical center lines
    const vLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 100),
      lineMaterial
    );
    vLine.rotation.x = -Math.PI / 2;
    vLine.position.set(-35, 0.02, 0);
    this.group.add(vLine);

    const vLine2 = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 100),
      lineMaterial
    );
    vLine2.rotation.x = -Math.PI / 2;
    vLine2.position.set(35, 0.02, 0);
    this.group.add(vLine2);

    // Sidewalk edges around park
    const parkHalf = GAME_CONFIG.PARK_SIZE / 2;
    const edgeMaterial = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
    const edgeThickness = 0.5;
    const edgeHeight = 0.15;

    const edges = [
      { x: 0, z: -parkHalf, w: GAME_CONFIG.PARK_SIZE, d: edgeThickness },
      { x: 0, z: parkHalf, w: GAME_CONFIG.PARK_SIZE, d: edgeThickness },
      { x: -parkHalf, z: 0, w: edgeThickness, d: GAME_CONFIG.PARK_SIZE },
      { x: parkHalf, z: 0, w: edgeThickness, d: GAME_CONFIG.PARK_SIZE },
    ];

    for (const edge of edges) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(edge.w, edgeHeight, edge.d),
        edgeMaterial
      );
      mesh.position.set(edge.x, edgeHeight / 2, edge.z);
      this.group.add(mesh);
    }
  }

  /**
   * Check if a sphere collides with any building and resolve
   */
  public checkAndResolveCollisions(position: THREE.Vector3, radius: number, velocity: THREE.Vector3): boolean {
    let collided = false;

    for (const building of this.buildings) {
      if (building.intersectsSphere(position, radius)) {
        building.pushOut(position, radius, velocity);
        collided = true;
      }
    }

    // Tree trunk collision (simple cylinder check)
    for (const tree of this.trees) {
      const dx = position.x - tree.position.x;
      const dz = position.z - tree.position.z;
      const dist2D = Math.sqrt(dx * dx + dz * dz);
      const combinedRadius = radius + tree.trunkRadius;

      // Only collide with trunk if at trunk height
      if (dist2D < combinedRadius && position.y < 4) {
        // Push out horizontally
        const pushDist = combinedRadius - dist2D;
        const safeDist = Math.max(dist2D, 0.0001);
        const nx = dx / safeDist;
        const nz = dz / safeDist;
        position.x += nx * pushDist;
        position.z += nz * pushDist;
        velocity.x *= 0.5;
        velocity.z *= 0.5;
        collided = true;
      }
    }

    return collided;
  }

  /**
   * Slow hawks significantly while flying through tree canopies.
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
      const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));

      if (distance < (tree.canopyRadius + radius)) {
        const drag = Math.pow(0.2, deltaTime * 6);
        velocity.multiplyScalar(drag);
        slowed = true;
      }
    }

    return slowed;
  }

  /**
   * Cleanup
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
