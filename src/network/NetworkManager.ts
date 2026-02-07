import * as THREE from 'three';
import { PeerConnection } from './PeerConnection';
import { GameState } from '../core/GameState';
import {
  NetworkMessage,
  MessageType,
  InputUpdateMessage,
  StateSyncMessage,
  FoodCollectedMessage,
  PlayerDeathMessage,
  RoundStartMessage,
  RoundEndMessage,
  createMessage,
} from './messages';
import { InputState } from '../core/InputManager';
import { GAME_CONFIG, PlayerRole } from '../config/constants';

/**
 * Manages network synchronization between peers
 */
export class NetworkManager {
  private peerConnection: PeerConnection;
  private gameState: GameState;
  private lastSyncTime: number = 0;
  private lastInputTime: number = 0;
  private tickRate: number;

  // State buffer for interpolation (client only)
  private stateBuffer: StateSyncMessage[] = [];

  // Host-side remote input cache.
  // Axes are treated as persistent state; mouse deltas are consumed once.
  private hasRemoteInput: boolean = false;
  private remoteInputAxes: InputState = {
    forward: 0,
    strafe: 0,
    ascend: 0,
    mouseX: 0,
    mouseY: 0,
  };
  private pendingRemoteMouseX: number = 0;
  private pendingRemoteMouseY: number = 0;
  private pendingLocalInputAxes: InputState = {
    forward: 0,
    strafe: 0,
    ascend: 0,
    mouseX: 0,
    mouseY: 0,
  };
  private pendingLocalMouseX: number = 0;
  private pendingLocalMouseY: number = 0;

  // Client-side authoritative snapshot for local reconciliation.
  private localAuthoritativeState: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    velocity: THREE.Vector3;
    timestamp: number;
  } | null = null;

  // Event callbacks
  private onPlayerDeathCallback: ((message: any) => void) | null = null;
  private onRoundStartCallback: ((message: RoundStartMessage) => void) | null = null;
  private onFoodCollectedCallback: ((message: FoodCollectedMessage) => void) | null = null;
  private onRoundEndCallback: ((message: RoundEndMessage) => void) | null = null;

  constructor(peerConnection: PeerConnection, gameState: GameState) {
    this.peerConnection = peerConnection;
    this.gameState = gameState;
    this.tickRate = 1000 / GAME_CONFIG.TICK_RATE; // Convert Hz to ms

    // Register message handler
    this.peerConnection.onMessage((message) => this.handleMessage(message));
  }

  /**
   * Handle incoming network message
   */
  private handleMessage(message: NetworkMessage): void {
    switch (message.type) {
      case MessageType.INPUT_UPDATE:
        this.handleInputUpdate(message as InputUpdateMessage);
        break;

      case MessageType.STATE_SYNC:
        this.handleStateSync(message as StateSyncMessage);
        break;

      case MessageType.FOOD_COLLECTED:
        this.handleFoodCollected(message as FoodCollectedMessage);
        break;

      case MessageType.PLAYER_DEATH:
        this.handlePlayerDeath(message as any);
        break;

      case MessageType.ROUND_START:
        this.handleRoundStart(message as RoundStartMessage);
        break;

      case MessageType.ROUND_END:
        this.handleRoundEnd(message as RoundEndMessage);
        break;

      default:
        console.log('Unhandled message type:', message.type);
    }
  }

  /**
   * Handle input update from client (host only)
   */
  private handleInputUpdate(message: InputUpdateMessage): void {
    if (!this.gameState.isHost) return;

    // Movement axes are continuous state.
    this.remoteInputAxes.forward = message.input.forward;
    this.remoteInputAxes.strafe = message.input.strafe;
    this.remoteInputAxes.ascend = message.input.ascend;

    // Mouse is per-frame delta; accumulate and consume once in getRemoteInput().
    this.pendingRemoteMouseX += message.input.mouseX;
    this.pendingRemoteMouseY += message.input.mouseY;
    this.hasRemoteInput = true;
  }

  /**
   * Handle state sync from host (client only)
   */
  private handleStateSync(message: StateSyncMessage): void {
    if (this.gameState.isHost) return;

    // Add to buffer for interpolation
    this.stateBuffer.push(message);

    // Keep buffer sorted by timestamp
    this.stateBuffer.sort((a, b) => a.timestamp - b.timestamp);

    // Remove old states (older than 1 second)
    const cutoff = Date.now() - 1000;
    this.stateBuffer = this.stateBuffer.filter((s) => s.timestamp > cutoff);

    // Apply immediate state update (we can add interpolation later if needed)
    this.applyStateSync(message);
  }

  /**
   * Apply state sync to game state
   */
  private applyStateSync(message: StateSyncMessage): void {
    // Update players
    for (const peerId in message.players) {
      const playerData = message.players[peerId];
      const player = this.gameState.players.get(peerId);

      if (player) {
        // Don't update local player position from network (we control it locally)
        if (peerId !== this.gameState.localPeerId) {
          player.position.set(
            playerData.position.x,
            playerData.position.y,
            playerData.position.z
          );
          player.rotation.set(
            playerData.rotation.x,
            playerData.rotation.y,
            playerData.rotation.z
          );
          player.velocity.set(
            playerData.velocity.x,
            playerData.velocity.y,
            playerData.velocity.z
          );
        } else {
          // Keep host-authoritative local state for client reconciliation.
          this.localAuthoritativeState = {
            position: new THREE.Vector3(
              playerData.position.x,
              playerData.position.y,
              playerData.position.z
            ),
            rotation: new THREE.Euler(
              playerData.rotation.x,
              playerData.rotation.y,
              playerData.rotation.z
            ),
            velocity: new THREE.Vector3(
              playerData.velocity.x,
              playerData.velocity.y,
              playerData.velocity.z
            ),
            timestamp: message.timestamp,
          };
        }

        // Update state data for all players
        player.role = playerData.role;
        player.weight = playerData.weight;
        player.energy = playerData.energy;
        player.isEating = playerData.isEating;
      }
    }

    // Update foods if included
    if (message.foods) {
      message.foods.forEach((foodData) => {
        const existing = this.gameState.foods.get(foodData.id);
        if (existing) {
          existing.exists = foodData.exists;
          existing.respawnTimer = foodData.respawnTimer ?? 0;
          existing.position.set(foodData.position.x, foodData.position.y, foodData.position.z);
        } else {
          this.gameState.addFood(
            foodData.id,
            foodData.type,
            new THREE.Vector3(foodData.position.x, foodData.position.y, foodData.position.z)
          );
          const created = this.gameState.foods.get(foodData.id);
          if (created) {
            created.exists = foodData.exists;
            created.respawnTimer = foodData.respawnTimer ?? 0;
          }
        }
      });
    }
  }

  /**
   * Send input update to host (client only, called every tick)
   */
  public sendInputUpdate(input: InputState): void {
    if (this.gameState.isHost) return; // Host doesn't send input to itself

    // Preserve latest movement axis state and accumulate per-frame mouse deltas.
    this.pendingLocalInputAxes.forward = input.forward;
    this.pendingLocalInputAxes.strafe = input.strafe;
    this.pendingLocalInputAxes.ascend = input.ascend;
    this.pendingLocalMouseX += input.mouseX;
    this.pendingLocalMouseY += input.mouseY;

    const now = Date.now();
    if (now - this.lastInputTime < this.tickRate) return;

    const message = createMessage<InputUpdateMessage>(MessageType.INPUT_UPDATE, {
      input: {
        forward: this.pendingLocalInputAxes.forward,
        strafe: this.pendingLocalInputAxes.strafe,
        ascend: this.pendingLocalInputAxes.ascend,
        mouseX: this.pendingLocalMouseX,
        mouseY: this.pendingLocalMouseY,
      },
    });

    this.peerConnection.send(message);
    this.pendingLocalMouseX = 0;
    this.pendingLocalMouseY = 0;
    this.lastInputTime = now;
  }

  /**
   * Send state sync to client (host only, called every tick)
   */
  public sendStateSync(): void {
    if (!this.gameState.isHost) return;

    const now = Date.now();
    if (now - this.lastSyncTime < this.tickRate) return;

    // Build state sync message
    const players: StateSyncMessage['players'] = {};

    this.gameState.players.forEach((player, peerId) => {
      players[peerId] = {
        position: { x: player.position.x, y: player.position.y, z: player.position.z },
        rotation: { x: player.rotation.x, y: player.rotation.y, z: player.rotation.z },
        velocity: { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z },
        role: player.role,
        weight: player.weight,
        energy: player.energy,
        isEating: player.isEating,
      };
    });

    const message = createMessage<StateSyncMessage>(MessageType.STATE_SYNC, {
      players,
      foods: Array.from(this.gameState.foods.values()).map((food) => ({
        id: food.id,
        type: food.type,
        position: { x: food.position.x, y: food.position.y, z: food.position.z },
        exists: food.exists,
        respawnTimer: food.respawnTimer ?? 0,
      })),
    });

    this.peerConnection.send(message);
    this.lastSyncTime = now;
  }

  /**
   * Get remote player's input (for host to apply to remote player)
   */
  public getRemoteInput(): InputState | null {
    if (!this.gameState.isHost) return null;
    if (!this.hasRemoteInput) return null;

    const input: InputState = {
      forward: this.remoteInputAxes.forward,
      strafe: this.remoteInputAxes.strafe,
      ascend: this.remoteInputAxes.ascend,
      mouseX: this.pendingRemoteMouseX,
      mouseY: this.pendingRemoteMouseY,
    };

    // Consume mouse deltas so they are applied only once.
    this.pendingRemoteMouseX = 0;
    this.pendingRemoteMouseY = 0;

    return input;
  }

  /**
   * Clear cached remote input (useful on round transitions).
   */
  public resetRemoteInput(): void {
    this.hasRemoteInput = false;
    this.remoteInputAxes.forward = 0;
    this.remoteInputAxes.strafe = 0;
    this.remoteInputAxes.ascend = 0;
    this.remoteInputAxes.mouseX = 0;
    this.remoteInputAxes.mouseY = 0;
    this.pendingRemoteMouseX = 0;
    this.pendingRemoteMouseY = 0;
    this.pendingLocalInputAxes.forward = 0;
    this.pendingLocalInputAxes.strafe = 0;
    this.pendingLocalInputAxes.ascend = 0;
    this.pendingLocalInputAxes.mouseX = 0;
    this.pendingLocalInputAxes.mouseY = 0;
    this.pendingLocalMouseX = 0;
    this.pendingLocalMouseY = 0;
  }

  /**
   * Get latest host-authoritative local state snapshot (client only).
   */
  public getLocalAuthoritativeState(): {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    velocity: THREE.Vector3;
    timestamp: number;
  } | null {
    if (this.gameState.isHost) return null;
    return this.localAuthoritativeState;
  }

  /**
   * Handle player death message
   */
  private handlePlayerDeath(message: any): void {
    if (this.onPlayerDeathCallback) {
      this.onPlayerDeathCallback(message);
    }
  }

  /**
   * Handle round start message
   */
  private handleRoundStart(message: RoundStartMessage): void {
    if (this.onRoundStartCallback) {
      this.onRoundStartCallback(message);
    }
  }

  /**
   * Handle food collected message
   */
  private handleFoodCollected(message: FoodCollectedMessage): void {
    if (this.onFoodCollectedCallback) {
      this.onFoodCollectedCallback(message);
    }
  }

  /**
   * Handle round end message (timer expired)
   */
  private handleRoundEnd(message: RoundEndMessage): void {
    if (this.onRoundEndCallback) {
      this.onRoundEndCallback(message);
    }
  }

  /**
   * Send player death event (host only)
   */
  public sendPlayerDeath(victimId: string, killerId: string, pigeonWeight: number, survivalTime: number): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<PlayerDeathMessage>(MessageType.PLAYER_DEATH, {
      victimId,
      killerId,
      pigeonWeight,
      survivalTime,
    });

    this.peerConnection.send(message);
  }

  /**
   * Send round start event (host only)
   */
  public sendRoundStart(
    roundNumber: number,
    roles: { [peerId: string]: PlayerRole },
    spawnStates: RoundStartMessage['spawnStates']
  ): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<RoundStartMessage>(MessageType.ROUND_START, {
      roundNumber,
      roles,
      spawnStates,
    });

    this.peerConnection.send(message);
  }

  /**
   * Send food collected event (host only)
   */
  public sendFoodCollected(foodId: string, playerId: string, exists: boolean, respawnTimer: number): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<FoodCollectedMessage>(MessageType.FOOD_COLLECTED, {
      foodId,
      playerId,
      exists,
      respawnTimer,
    });

    this.peerConnection.send(message);
  }

  /**
   * Register callback for player death
   */
  public onPlayerDeath(callback: (message: any) => void): void {
    this.onPlayerDeathCallback = callback;
  }

  /**
   * Register callback for round start
   */
  public onRoundStart(callback: (message: RoundStartMessage) => void): void {
    this.onRoundStartCallback = callback;
  }

  /**
   * Register callback for food collection
   */
  public onFoodCollected(callback: (message: FoodCollectedMessage) => void): void {
    this.onFoodCollectedCallback = callback;
  }

  /**
   * Send round end event (host only, e.g. timer expired)
   */
  public sendRoundEnd(winner: 'pigeon' | 'hawk' | 'timeout', pigeonWeight: number, survivalTime: number): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<RoundEndMessage>(MessageType.ROUND_END, {
      winner,
      pigeonWeight,
      survivalTime,
    });

    this.peerConnection.send(message);
  }

  /**
   * Register callback for round end
   */
  public onRoundEnd(callback: (message: RoundEndMessage) => void): void {
    this.onRoundEndCallback = callback;
  }
}
