import * as THREE from 'three';
import { PlayerRole, RoundState, GAME_CONFIG } from '../config/constants';
import { NPCState, NPCType } from '../entities/NPC';

export enum PlayerConnectionState {
  CONNECTING = 'connecting',
  SYNCING = 'syncing',
  ACTIVE = 'active',
  DISCONNECTED = 'disconnected',
}

/**
 * Player state data
 */
export interface PlayerState {
  peerId: string;
  role: PlayerRole;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  velocity: THREE.Vector3;

  // Pigeon-specific
  weight?: number;

  // Hawk-specific
  energy?: number;

  // Common
  isEating?: boolean;
  eatingTimer?: number;
  joinOrder: number;
  connectionState: PlayerConnectionState;
  active: boolean;
  spawnProtectionUntilTick: number;
  inputLockedUntilTick: number;
}

/**
 * Food item state
 */
export interface FoodState {
  id: string;
  type: string;
  position: THREE.Vector3;
  exists: boolean; // false if eaten, waiting to respawn
  respawnTimer?: number;
}

/**
 * NPC item state
 */
export interface NPCStateData {
  id: string;
  type: NPCType;
  position: THREE.Vector3;
  rotation: number;
  state: NPCState;
  exists: boolean;
  respawnTimer?: number;
}

/**
 * Score tracking
 */
export interface ScoreData {
  pigeon: {
    totalWeight: number;
    roundsWon: number;
  };
  hawk: {
    killTimes: number[];
    roundsWon: number;
  };
}

/**
 * Centralized game state
 */
export class GameState {
  // Match metadata
  public matchId: string;
  public worldSeed: number = 1;
  public roundNumber: number = 0;
  public roundStartTime: number = 0;
  public roundDuration: number = GAME_CONFIG.ROUND_DURATION;
  public roundState: RoundState = RoundState.LOBBY;

  // Network
  public isHost: boolean;
  public localPeerId: string;
  public remotePeerId: string | null = null;

  // Players
  public players: Map<string, PlayerState> = new Map();
  private joinOrderCounter: number = 0;

  // World
  public foods: Map<string, FoodState> = new Map();
  public npcs: Map<string, NPCStateData> = new Map();

  // Scores
  public scores: ScoreData = {
    pigeon: { totalWeight: 0, roundsWon: 0 },
    hawk: { killTimes: [], roundsWon: 0 },
  };

  constructor(isHost: boolean, localPeerId: string) {
    this.isHost = isHost;
    this.localPeerId = localPeerId;
    this.matchId = this.generateMatchId();
  }

  /**
   * Generate unique match ID
   */
  private generateMatchId(): string {
    return `match-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get local player state
   */
  public getLocalPlayer(): PlayerState | undefined {
    return this.players.get(this.localPeerId);
  }



  /**
   * Get remote player state (legacy first-remote accessor).
   */
  public getRemotePlayer(): PlayerState | undefined {
    if (!this.remotePeerId) return undefined;
    return this.players.get(this.remotePeerId);
  }

  /**
   * Add a player to the game
   */
  public addPlayer(peerId: string, role: PlayerRole, position?: THREE.Vector3): PlayerState {
    const existing = this.players.get(peerId);
    if (existing) {
      if (position) existing.position.copy(position);
      existing.role = role;
      existing.weight = role === PlayerRole.PIGEON ? GAME_CONFIG.PIGEON_INITIAL_WEIGHT : undefined;
      existing.energy = role === PlayerRole.HAWK ? GAME_CONFIG.HAWK_INITIAL_ENERGY : undefined;
      return existing;
    }

    const playerState: PlayerState = {
      peerId,
      role,
      position: position || new THREE.Vector3(0, 5, 0),
      rotation: new THREE.Euler(0, 0, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      weight: role === PlayerRole.PIGEON ? GAME_CONFIG.PIGEON_INITIAL_WEIGHT : undefined,
      energy: role === PlayerRole.HAWK ? GAME_CONFIG.HAWK_INITIAL_ENERGY : undefined,
      isEating: false,
      eatingTimer: 0,
      joinOrder: this.joinOrderCounter++,
      connectionState: PlayerConnectionState.ACTIVE,
      active: true,
      spawnProtectionUntilTick: 0,
      inputLockedUntilTick: 0,
    };

    this.players.set(peerId, playerState);
    return playerState;
  }

  /**
   * Start a new round
   */
  public startRound(): void {
    this.roundNumber++;
    this.roundStartTime = Date.now();
    this.roundState = RoundState.PLAYING;

    // Reset player states
    this.players.forEach((player) => {
      player.weight = player.role === PlayerRole.PIGEON ? GAME_CONFIG.PIGEON_INITIAL_WEIGHT : undefined;
      player.energy = player.role === PlayerRole.HAWK ? GAME_CONFIG.HAWK_INITIAL_ENERGY : undefined;
      player.isEating = false;
      player.eatingTimer = 0;
      player.spawnProtectionUntilTick = 0;
      player.inputLockedUntilTick = 0;
    });
  }

  /**
   * End the current round
   */
  public endRound(): void {
    this.roundState = RoundState.ENDED;
  }

  /**
   * Assign one pigeon and make everyone else hawks for next round.
   */
  public assignRolesForNextRound(nextPigeonPeerId: string): void {
    this.players.forEach((player, peerId) => {
      player.role = peerId === nextPigeonPeerId ? PlayerRole.PIGEON : PlayerRole.HAWK;
      player.weight = player.role === PlayerRole.PIGEON ? GAME_CONFIG.PIGEON_INITIAL_WEIGHT : undefined;
      player.energy = player.role === PlayerRole.HAWK ? GAME_CONFIG.HAWK_INITIAL_ENERGY : undefined;
    });
  }

  public setPlayerConnectionState(
    peerId: string,
    connectionState: PlayerConnectionState,
    active: boolean
  ): void {
    const player = this.players.get(peerId);
    if (!player) return;
    player.connectionState = connectionState;
    player.active = active;
  }

  public removePlayer(peerId: string): PlayerState | undefined {
    const existing = this.players.get(peerId);
    if (!existing) return undefined;
    this.players.delete(peerId);
    return existing;
  }

  public getActivePlayerCount(): number {
    let active = 0;
    this.players.forEach((player) => {
      if (player.active) active++;
    });
    return active;
  }

  public getPigeonPeerId(): string | null {
    for (const [peerId, player] of this.players) {
      if (player.role === PlayerRole.PIGEON) return peerId;
    }
    return null;
  }

  public getHawkPeerIds(): string[] {
    const hawks: string[] = [];
    for (const [peerId, player] of this.players) {
      if (player.role === PlayerRole.HAWK) {
        hawks.push(peerId);
      }
    }
    return hawks;
  }

  public getLowestJoinOrderActiveHawk(): string | null {
    let selected: PlayerState | null = null;
    for (const player of this.players.values()) {
      if (!player.active || player.role !== PlayerRole.HAWK) continue;
      if (!selected || player.joinOrder < selected.joinOrder) {
        selected = player;
      }
    }
    return selected?.peerId ?? null;
  }

  public setSpawnProtection(peerId: string, untilTick: number): void {
    const player = this.players.get(peerId);
    if (!player) return;
    player.spawnProtectionUntilTick = Math.max(player.spawnProtectionUntilTick, untilTick);
  }

  public setInputLock(peerId: string, untilTick: number): void {
    const player = this.players.get(peerId);
    if (!player) return;
    player.inputLockedUntilTick = Math.max(player.inputLockedUntilTick, untilTick);
  }

  /**
   * Get elapsed round time in seconds
   */
  public getRoundTime(): number {
    if (this.roundState !== RoundState.PLAYING) return 0;
    return (Date.now() - this.roundStartTime) / 1000;
  }

  /**
   * Get remaining round time in seconds
   */
  public getRemainingTime(): number {
    const elapsed = this.getRoundTime();
    return Math.max(0, this.roundDuration - elapsed);
  }

  /**
   * Check if round timer has expired
   */
  public isRoundTimeUp(): boolean {
    return this.getRemainingTime() <= 0;
  }

  /**
   * Add food item to the world
   */
  public addFood(id: string, type: string, position: THREE.Vector3): FoodState {
    const food: FoodState = {
      id,
      type,
      position: position.clone(),
      exists: true,
      respawnTimer: 0,
    };
    this.foods.set(id, food);
    return food;
  }

  /**
   * Remove food (when eaten)
   */
  public removeFood(id: string): void {
    const food = this.foods.get(id);
    if (food) {
      food.exists = false;
      food.respawnTimer = GAME_CONFIG.FOOD_RESPAWN_TIME;
    }
  }

  /**
   * Update food respawn timers
   */
  public updateFoodTimers(deltaTime: number): void {
    this.foods.forEach((food) => {
      if (!food.exists && food.respawnTimer !== undefined) {
        food.respawnTimer -= deltaTime;
        if (food.respawnTimer <= 0) {
          food.exists = true;
          food.respawnTimer = 0;
        }
      }
    });
  }

  /**
   * Replace all NPC states from host-authoritative snapshot.
   */
  public setNPCSnapshots(snapshots: NPCStateData[]): void {
    this.npcs.clear();
    snapshots.forEach((npc) => {
      this.npcs.set(npc.id, {
        id: npc.id,
        type: npc.type,
        position: npc.position.clone(),
        rotation: npc.rotation,
        state: npc.state,
        exists: npc.exists,
        respawnTimer: npc.respawnTimer ?? 0,
      });
    });
  }
}
