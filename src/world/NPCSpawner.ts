import * as THREE from 'three';
import { NPC, NPCType, NPCSnapshot } from '../entities/NPC';
import { SeededRandom } from '../utils/SeededRandom';
import { GridCell, TreeCanopyAnchor } from './Environment';
import { GAME_CONFIG } from '../config/constants';
import { getModelByKey } from '../utils/ModelLoader';

/**
 * Manages NPC lifecycle: spawning, AI updates (host only), respawning, and network sync.
 */
export class NPCSpawner {
  private scene: THREE.Scene;
  private npcs: Map<string, NPC> = new Map();
  private rng: SeededRandom;
  private parkCells: GridCell[];
  private streetCenters: THREE.Vector3[];
  private treeCanopies: TreeCanopyAnchor[];

  constructor(
    scene: THREE.Scene,
    rng: SeededRandom,
    parkCells: GridCell[],
    streetCenters: THREE.Vector3[],
    treeCanopies: TreeCanopyAnchor[]
  ) {
    this.scene = scene;
    this.rng = rng;
    this.parkCells = parkCells;
    this.streetCenters = streetCenters;
    this.treeCanopies = treeCanopies;
  }

  public spawnInitial(pigeonCount: number, ratCount: number, squirrelCount: number): void {
    for (let i = 0; i < pigeonCount; i++) {
      const pos = this.getRandomPigeonSpawnPosition();

      const npc = new NPC(
        `npc-pigeon-${i}`,
        NPCType.PIGEON,
        pos,
        getModelByKey('npcs/pigeon'),
        () => this.rng.next()
      );
      this.npcs.set(npc.id, npc);
      this.scene.add(npc.mesh);
    }

    for (let i = 0; i < ratCount; i++) {
      const streetPos = this.getRandomStreetPosition();

      const npc = new NPC(
        `npc-rat-${i}`,
        NPCType.RAT,
        streetPos,
        getModelByKey('npcs/rat'),
        () => this.rng.next()
      );
      this.npcs.set(npc.id, npc);
      this.scene.add(npc.mesh);
    }

    for (let i = 0; i < squirrelCount; i++) {
      const pos = this.getRandomSquirrelSpawnPosition();

      const npc = new NPC(
        `npc-squirrel-${i}`,
        NPCType.SQUIRREL,
        pos,
        getModelByKey('npcs/squirrel'),
        () => this.rng.next()
      );
      this.npcs.set(npc.id, npc);
      this.scene.add(npc.mesh);
    }
  }

  public update(
    deltaTime: number,
    hawkPosition: THREE.Vector3 | null,
    buildings: Array<{ min: THREE.Vector3; max: THREE.Vector3 }>
  ): void {
    for (const npc of this.npcs.values()) {
      const fleeRange = npc.getFleeRange();
      npc.update(deltaTime, hawkPosition, fleeRange, buildings);

      if (npc.isReadyToRespawn()) {
        const newPos = this.getRandomSpawnPosition(npc.type);
        npc.respawn(newPos);
      }
    }
  }

  private getRandomSpawnPosition(type: NPCType): THREE.Vector3 {
    if (type === NPCType.PIGEON) {
      return this.getRandomPigeonSpawnPosition();
    }

    if (type === NPCType.SQUIRREL) {
      return this.getRandomSquirrelSpawnPosition();
    }

    return this.getRandomStreetPosition();
  }

  private getRandomPigeonSpawnPosition(): THREE.Vector3 {
    const base = this.getRandomParkPosition(
      this.rng.nextFloat(GAME_CONFIG.NPC_PIGEON_FLIGHT_MIN_ALT, GAME_CONFIG.NPC_PIGEON_FLIGHT_MAX_ALT),
      cell => cell.size / 3
    );
    base.y = this.rng.nextFloat(GAME_CONFIG.NPC_PIGEON_FLIGHT_MIN_ALT, GAME_CONFIG.NPC_PIGEON_FLIGHT_MAX_ALT);
    return base;
  }

  private getRandomSquirrelSpawnPosition(): THREE.Vector3 {
    if (this.treeCanopies.length > 0 && this.rng.chance(GAME_CONFIG.NPC_SQUIRREL_TREE_BIAS)) {
      const tree = this.rng.pick(this.treeCanopies);
      const angle = this.rng.nextFloat(0, Math.PI * 2);
      const radius = this.rng.nextFloat(0, tree.canopyRadius * 0.55);
      const x = tree.position.x + Math.cos(angle) * radius;
      const z = tree.position.z + Math.sin(angle) * radius;
      const y = Math.max(0.35, tree.canopyCenterY + this.rng.nextFloat(-tree.canopyRadius * 0.2, tree.canopyRadius * 0.2));
      return new THREE.Vector3(x, y, z);
    }

    return this.getRandomParkPosition(0.35, cell => cell.size / 2.5);
  }

  private getRandomParkPosition(
    y: number,
    spreadFn: (cell: GridCell) => number
  ): THREE.Vector3 {
    if (this.parkCells.length === 0) {
      return new THREE.Vector3(0, y, 0);
    }
    const cell = this.rng.pick(this.parkCells);
    const spread = spreadFn(cell);
    return new THREE.Vector3(
      cell.centerX + this.rng.nextFloat(-spread, spread),
      y,
      cell.centerZ + this.rng.nextFloat(-spread, spread)
    );
  }

  private getRandomStreetPosition(): THREE.Vector3 {
    if (this.streetCenters.length === 0) {
      return new THREE.Vector3(0, 0.3, 0);
    }
    const pos = this.rng.pick(this.streetCenters).clone();
    pos.x += this.rng.nextFloat(-5, 5);
    pos.z += this.rng.nextFloat(-5, 5);
    pos.y = 0.3;
    return pos;
  }

  public killNPC(id: string, respawnTime: number): NPC | null {
    const npc = this.npcs.get(id);
    if (npc && npc.exists) {
      npc.kill(respawnTime);
      return npc;
    }
    return null;
  }

  public getNPCs(): NPC[] {
    return Array.from(this.npcs.values());
  }

  public getNPC(id: string): NPC | undefined {
    return this.npcs.get(id);
  }

  public getSnapshots(): NPCSnapshot[] {
    return this.getNPCs().map((npc) => npc.getSnapshot());
  }

  public applySnapshots(snapshots: NPCSnapshot[]): void {
    for (const snap of snapshots) {
      let npc = this.npcs.get(snap.id);
      if (!npc) {
        const pos = new THREE.Vector3(snap.position.x, snap.position.y, snap.position.z);
        const modelKey = snap.type === NPCType.PIGEON
          ? 'npcs/pigeon'
          : snap.type === NPCType.SQUIRREL
            ? 'npcs/squirrel'
            : 'npcs/rat';
        npc = new NPC(snap.id, snap.type, pos, getModelByKey(modelKey));
        this.npcs.set(npc.id, npc);
        this.scene.add(npc.mesh);
      }
      npc.applySnapshot(snap);
    }
  }

  public resetAll(): void {
    for (const npc of this.npcs.values()) {
      const newPos = this.getRandomSpawnPosition(npc.type);
      npc.respawn(newPos);
    }
  }

  public dispose(): void {
    for (const npc of this.npcs.values()) {
      this.scene.remove(npc.mesh);
      npc.dispose();
    }
    this.npcs.clear();
  }
}
