import * as THREE from 'three';
import { PlayerRole, RoundState, GAME_CONFIG } from '../config/constants';
import { NPCState, NPCType } from '../entities/NPC';

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

  // World
  public foods: Map<string, FoodState> = new Map();
  public npcs: Map<string, NPCStateData> = new Map();

  // Scores
  public scores: ScoreData = {
    pigeon: { totalWeight: 0, roundsWon: 0 },
    hawk: { killTimes: [], roundsWon: 0 },
  };
  private pigeonWinRotationIndex: number = 0;

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

  /**
   * Select the next pigeon after a hawk kill.
   * - 2 players: always swap roles.
   * - 3+ players: killer becomes pigeon.
   */
  public chooseNextPigeonAfterHawkWin(killerPeerId: string, victimPeerId: string): string {
    const joinedPeerIds = this.getJoinedPeerIds();
    if (joinedPeerIds.length <= 1) {
      return joinedPeerIds[0] ?? killerPeerId;
    }

    if (joinedPeerIds.length === 2) {
      return this.getOtherPeerId(victimPeerId) ?? joinedPeerIds[0];
    }

    if (this.players.has(killerPeerId)) {
      return killerPeerId;
    }

    const fallbackHawk = joinedPeerIds.find((peerId) => peerId !== victimPeerId);
    return fallbackHawk ?? joinedPeerIds[0];
  }

  /**
   * Select the next pigeon after a pigeon survival.
   * - 2 players: always swap roles.
   * - 3+ players: rotate through join order on each pigeon win.
   */
  public chooseNextPigeonAfterPigeonWin(currentPigeonPeerId: string): string {
    const joinedPeerIds = this.getJoinedPeerIds();
    if (joinedPeerIds.length <= 1) {
      return joinedPeerIds[0] ?? currentPigeonPeerId;
    }

    if (joinedPeerIds.length === 2) {
      return this.getOtherPeerId(currentPigeonPeerId) ?? joinedPeerIds[0];
    }

    const rotationSlot = this.pigeonWinRotationIndex % joinedPeerIds.length;
    const nextPigeonPeerId = joinedPeerIds[rotationSlot];
    this.pigeonWinRotationIndex += 1;
    return nextPigeonPeerId;
  }

  private getJoinedPeerIds(): string[] {
    return Array.from(this.players.keys());
  }

  private getOtherPeerId(peerId: string): string | null {
    for (const candidatePeerId of this.getJoinedPeerIds()) {
      if (candidatePeerId !== peerId) {
        return candidatePeerId;
      }
    }
    return null;
  }

  /**
   * Set round start time from host (for late-join timer sync).
   */
  public setRoundStartTime(hostRoundStartTime: number): void {
    this.roundStartTime = hostRoundStartTime;
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
