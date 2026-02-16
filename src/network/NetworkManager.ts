import * as THREE from 'three';
import { PeerConnection } from './PeerConnection';
import { GameState } from '../core/GameState';
import {
  NetworkMessage,
  MessageType,
  InputUpdateMessage,
  StateSyncMessage,
  LateJoinStateMessage,
  FoodCollectedMessage,
  NPCKilledMessage,
  PlayerDeathMessage,
  RoundStartMessage,
  RoundEndMessage,
  createMessage,
} from './messages';
import { InputState } from '../core/InputManager';
import { GAME_CONFIG, PlayerRole, RoundState } from '../config/constants';
import { DeviceDetector } from '../utils/DeviceDetector';

/**
 * Manages network synchronization between peers
 */
export class NetworkManager {
  private peerConnection: PeerConnection;
  private gameState: GameState;
  private lastSyncTime: number = 0;
  private lastInputTime: number = 0;
  private tickRate: number;
  private lastWorldSyncTime: number = 0;
  private worldSyncIntervalMs: number = 100;

  // State buffer for interpolation (client only)
  private stateBuffer: StateSyncMessage[] = [];

  // Host-side remote input cache per peer.
  // Axes are treated as persistent state; mouse deltas are consumed once.
  private remoteInputs: Map<string, {
    hasInput: boolean;
    axes: InputState;
    pendingMouseX: number;
    pendingMouseY: number;
  }> = new Map();
  private pendingLocalInputAxes: InputState = {
    forward: 0,
    strafe: 0,
    ascend: 0,
    mouseX: 0,
    mouseY: 0,
    scrollDelta: 0,
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
  private onNPCKilledCallback: ((message: NPCKilledMessage) => void) | null = null;
  private onRoundEndCallback: ((message: RoundEndMessage) => void) | null = null;
  private onLateJoinStateCallback: ((message: LateJoinStateMessage) => void) | null = null;

  constructor(peerConnection: PeerConnection, gameState: GameState) {
    this.peerConnection = peerConnection;
    this.gameState = gameState;

    // Phase 2: Adaptive tick rate based on device capabilities
    // Use DeviceDetector to determine optimal tick rate for this device
    const recommendedTickRateHz = DeviceDetector.getRecommendedTickRate();
    this.tickRate = 1000 / recommendedTickRateHz; // Convert Hz to ms

    console.log(
      `[NetworkManager] Initialized with ${recommendedTickRateHz}Hz tick rate ` +
      `(${this.tickRate.toFixed(1)}ms interval) for ${DeviceDetector.getDeviceTypeString()} device`
    );

    // Register message handler
    this.peerConnection.onMessage((message, peerId) => this.handleMessage(message, peerId));
  }

  /**
   * Set the network tick rate dynamically
   * Used for FPS-based quality degradation on struggling hosts
   *
   * @param tickRateHz - New tick rate in Hz (e.g., 20, 30, 45)
   */
  public setTickRate(tickRateHz: number): void {
    const oldTickRateHz = Math.round(1000 / this.tickRate);
    this.tickRate = 1000 / tickRateHz;
    console.log(`[NetworkManager] Tick rate changed: ${oldTickRateHz}Hz → ${tickRateHz}Hz`);
  }

  /**
   * Get the current tick rate in Hz
   *
   * @returns Current tick rate in Hz
   */
  public getTickRateHz(): number {
    return Math.round(1000 / this.tickRate);
  }

  /**
   * Handle incoming network message
   */
  private handleMessage(message: NetworkMessage, peerId: string): void {
    switch (message.type) {
      case MessageType.PING:
        // Silently ignore keep-alive pings
        break;

      case MessageType.INPUT_UPDATE:
        this.handleInputUpdate(message as InputUpdateMessage, peerId);
        break;

      case MessageType.STATE_SYNC:
        this.handleStateSync(message as StateSyncMessage);
        break;

      case MessageType.LATE_JOIN_STATE:
        this.handleLateJoinState(message as LateJoinStateMessage);
        break;

      case MessageType.FOOD_COLLECTED:
        this.handleFoodCollected(message as FoodCollectedMessage);
        break;

      case MessageType.NPC_KILLED:
        this.handleNPCKilled(message as NPCKilledMessage);
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
  private handleInputUpdate(message: InputUpdateMessage, peerId: string): void {
    if (!this.gameState.isHost) return;

    const existing = this.remoteInputs.get(peerId) ?? {
      hasInput: false,
      axes: { forward: 0, strafe: 0, ascend: 0, mouseX: 0, mouseY: 0, scrollDelta: 0 },
      pendingMouseX: 0,
      pendingMouseY: 0,
    };

    existing.axes.forward = message.input.forward;
    existing.axes.strafe = message.input.strafe;
    existing.axes.ascend = message.input.ascend;
    existing.axes.mobilePitchAutoCenter = message.input.pitchAutoCenter === true;
    if (typeof message.input.pitchAxis === 'number') {
      existing.axes.mobilePitchAxis = THREE.MathUtils.clamp(message.input.pitchAxis, -1, 1);
    } else {
      existing.axes.mobilePitchAxis = undefined;
    }
    existing.pendingMouseX += message.input.mouseX;
    if (!(existing.axes.mobilePitchAutoCenter && typeof existing.axes.mobilePitchAxis === 'number')) {
      existing.pendingMouseY += message.input.mouseY;
    }
    existing.hasInput = true;
    this.remoteInputs.set(peerId, existing);
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
    this.syncRoundTimingFromHost(message);

    // Update players
    for (const peerId in message.players) {
      const playerData = message.players[peerId];
      let player = this.gameState.players.get(peerId);
      if (!player) {
        player = this.gameState.addPlayer(peerId, playerData.role);
      }

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

    if (message.npcs) {
      this.gameState.setNPCSnapshots(
        message.npcs.map((npc) => ({
          id: npc.id,
          type: npc.type,
          position: new THREE.Vector3(npc.position.x, npc.position.y, npc.position.z),
          rotation: npc.rotation,
          state: npc.state,
          exists: npc.exists,
          respawnTimer: 0,
        }))
      );
    }
  }

  /**
   * Keep client-side round timer aligned with host using elapsed time rather
   * than absolute host clock timestamps (which can differ across devices).
   */
  private syncRoundTimingFromHost(message: StateSyncMessage): void {
    if (this.gameState.isHost) return;

    if (typeof message.roundNumber === 'number') {
      this.gameState.roundNumber = message.roundNumber;
    }
    if (typeof message.roundDuration === 'number') {
      this.gameState.roundDuration = message.roundDuration;
    }
    if (typeof message.roundState === 'string') {
      this.gameState.roundState = message.roundState as RoundState;
    }

    if (typeof message.roundElapsedMs !== 'number') return;

    const elapsedMs = Math.max(0, message.roundElapsedMs);
    const estimatedLocalRoundStart = Date.now() - elapsedMs;

    if (!this.gameState.roundStartTime) {
      this.gameState.setRoundStartTime(estimatedLocalRoundStart);
      return;
    }

    const driftMs = estimatedLocalRoundStart - this.gameState.roundStartTime;
    if (Math.abs(driftMs) > 250) {
      // Large drift: snap timer baseline back to host-derived value.
      this.gameState.setRoundStartTime(estimatedLocalRoundStart);
      return;
    }

    // Small drift: gently blend to avoid timer jitter from packet delay variance.
    this.gameState.setRoundStartTime(
      this.gameState.roundStartTime + (driftMs * 0.2)
    );
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
    this.pendingLocalInputAxes.mobilePitchAutoCenter = input.mobilePitchAutoCenter;
    this.pendingLocalInputAxes.mobilePitchAxis = input.mobilePitchAxis;
    this.pendingLocalMouseX += input.mouseX;
    const useMobilePitchAxis = input.mobilePitchAutoCenter && typeof input.mobilePitchAxis === 'number';
    if (useMobilePitchAxis) {
      this.pendingLocalMouseY = 0;
    } else {
      this.pendingLocalMouseY += input.mouseY;
    }

    const now = Date.now();
    if (now - this.lastInputTime < this.tickRate) return;

    const outboundInput: InputUpdateMessage['input'] = {
      forward: this.pendingLocalInputAxes.forward,
      strafe: this.pendingLocalInputAxes.strafe,
      ascend: this.pendingLocalInputAxes.ascend,
      mouseX: this.pendingLocalMouseX,
      mouseY: this.pendingLocalMouseY,
    };
    const sendMobilePitchAxis = this.pendingLocalInputAxes.mobilePitchAutoCenter &&
      typeof this.pendingLocalInputAxes.mobilePitchAxis === 'number';
    if (this.pendingLocalInputAxes.mobilePitchAutoCenter) {
      outboundInput.pitchAutoCenter = true;
    }
    if (sendMobilePitchAxis) {
      outboundInput.pitchAxis = this.pendingLocalInputAxes.mobilePitchAxis;
      outboundInput.mouseY = 0;
    }

    const message = createMessage<InputUpdateMessage>(MessageType.INPUT_UPDATE, {
      input: outboundInput,
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

    const payload: Omit<StateSyncMessage, 'type' | 'timestamp'> = {
      players,
      roundNumber: this.gameState.roundNumber,
      roundStartTime: this.gameState.roundStartTime,
      roundDuration: this.gameState.roundDuration,
      roundState: this.gameState.roundState,
      roundElapsedMs: this.gameState.roundState === RoundState.PLAYING
        ? Math.max(0, now - this.gameState.roundStartTime)
        : 0,
    };
    const shouldSendWorldState = now - this.lastWorldSyncTime >= this.worldSyncIntervalMs;

    if (shouldSendWorldState) {
      payload.foods = Array.from(this.gameState.foods.values()).map((food) => ({
        id: food.id,
        type: food.type,
        position: { x: food.position.x, y: food.position.y, z: food.position.z },
        exists: food.exists,
        respawnTimer: food.respawnTimer ?? 0,
      }));
      payload.npcs = Array.from(this.gameState.npcs.values()).map((npc) => ({
        id: npc.id,
        type: npc.type,
        position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
        rotation: npc.rotation,
        state: npc.state,
        exists: npc.exists,
      }));
      this.lastWorldSyncTime = now;
    }

    const message = createMessage<StateSyncMessage>(MessageType.STATE_SYNC, payload);

    this.peerConnection.send(message);
    this.lastSyncTime = now;
  }

  /**
   * Get remote player's input (for host to apply to remote player)
   */
  public getRemoteInput(peerId: string): InputState | null {
    if (!this.gameState.isHost) return null;
    const entry = this.remoteInputs.get(peerId);
    if (!entry || !entry.hasInput) return null;

    const input: InputState = {
      forward: entry.axes.forward,
      strafe: entry.axes.strafe,
      ascend: entry.axes.ascend,
      mouseX: entry.pendingMouseX,
      mouseY: entry.pendingMouseY,
      scrollDelta: 0,
    };
    if (entry.axes.mobilePitchAutoCenter) {
      input.mobilePitchAutoCenter = true;
    }
    if (entry.axes.mobilePitchAutoCenter && typeof entry.axes.mobilePitchAxis === 'number') {
      input.mobilePitchAxis = entry.axes.mobilePitchAxis;
      input.mouseY = 0;
    }

    entry.pendingMouseX = 0;
    entry.pendingMouseY = 0;
    this.remoteInputs.set(peerId, entry);

    return input;
  }

  /**
   * Clear cached remote input (useful on round transitions).
   */
  public resetRemoteInput(): void {
    this.remoteInputs.clear();
    this.pendingLocalInputAxes.forward = 0;
    this.pendingLocalInputAxes.strafe = 0;
    this.pendingLocalInputAxes.ascend = 0;
    this.pendingLocalInputAxes.mouseX = 0;
    this.pendingLocalInputAxes.mouseY = 0;
    this.pendingLocalInputAxes.mobilePitchAutoCenter = false;
    this.pendingLocalInputAxes.mobilePitchAxis = undefined;
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
   * Sample a smoothed remote player transform using buffered host snapshots.
   */
  public getInterpolatedRemoteState(peerId: string): {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    velocity: THREE.Vector3;
    role: PlayerRole;
    isEating: boolean;
  } | null {
    if (this.gameState.isHost) return null;

    const snapshots = this.stateBuffer
      .map((snapshot) => {
        const player = snapshot.players[peerId];
        if (!player) return null;
        return {
          timestamp: snapshot.timestamp,
          position: player.position,
          rotation: player.rotation,
          velocity: player.velocity,
          role: player.role,
          isEating: !!player.isEating,
        };
      })
      .filter((snapshot): snapshot is {
        timestamp: number;
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
        velocity: { x: number; y: number; z: number };
        role: PlayerRole;
        isEating: boolean;
      } => snapshot !== null);

    if (snapshots.length === 0) return null;

    const renderTimestamp = Date.now() - GAME_CONFIG.STATE_BUFFER_TIME;

    // If render time is before our buffer, snap to earliest known snapshot.
    if (renderTimestamp <= snapshots[0].timestamp) {
      const earliest = snapshots[0];
      return {
        position: new THREE.Vector3(earliest.position.x, earliest.position.y, earliest.position.z),
        rotation: new THREE.Euler(earliest.rotation.x, earliest.rotation.y, earliest.rotation.z),
        velocity: new THREE.Vector3(earliest.velocity.x, earliest.velocity.y, earliest.velocity.z),
        role: earliest.role,
        isEating: earliest.isEating,
      };
    }

    for (let i = 0; i < snapshots.length - 1; i++) {
      const older = snapshots[i];
      const newer = snapshots[i + 1];
      if (renderTimestamp < older.timestamp || renderTimestamp > newer.timestamp) continue;

      const span = Math.max(1, newer.timestamp - older.timestamp);
      const alpha = Math.max(0, Math.min(1, (renderTimestamp - older.timestamp) / span));

      const startPos = new THREE.Vector3(older.position.x, older.position.y, older.position.z);
      const endPos = new THREE.Vector3(newer.position.x, newer.position.y, newer.position.z);
      const startVel = new THREE.Vector3(older.velocity.x, older.velocity.y, older.velocity.z);
      const endVel = new THREE.Vector3(newer.velocity.x, newer.velocity.y, newer.velocity.z);

      return {
        position: startPos.lerp(endPos, alpha),
        rotation: new THREE.Euler(
          THREE.MathUtils.lerp(older.rotation.x, newer.rotation.x, alpha),
          this.lerpAngle(older.rotation.y, newer.rotation.y, alpha),
          THREE.MathUtils.lerp(older.rotation.z, newer.rotation.z, alpha)
        ),
        velocity: startVel.lerp(endVel, alpha),
        role: newer.role,
        isEating: alpha < 0.5 ? older.isEating : newer.isEating,
      };
    }

    // Extrapolate a short distance from the latest snapshot if needed.
    const latest = snapshots[snapshots.length - 1];
    const extrapolationAge = renderTimestamp - latest.timestamp;

    // Phase 1: If snapshot is too stale (>200ms), just snap to last position
    // Don't extrapolate into nonsense
    if (extrapolationAge > GAME_CONFIG.EXTRAPOLATION_STALE_THRESHOLD) {
      return {
        position: new THREE.Vector3(latest.position.x, latest.position.y, latest.position.z),
        rotation: new THREE.Euler(latest.rotation.x, latest.rotation.y, latest.rotation.z),
        velocity: new THREE.Vector3(latest.velocity.x, latest.velocity.y, latest.velocity.z),
        role: latest.role,
        isEating: latest.isEating,
      };
    }

    const extrapolationSeconds = Math.max(
      0,
      Math.min(0.1, extrapolationAge / 1000)
    );

    return {
      position: new THREE.Vector3(
        latest.position.x + (latest.velocity.x * extrapolationSeconds),
        latest.position.y + (latest.velocity.y * extrapolationSeconds),
        latest.position.z + (latest.velocity.z * extrapolationSeconds)
      ),
      rotation: new THREE.Euler(latest.rotation.x, latest.rotation.y, latest.rotation.z),
      velocity: new THREE.Vector3(latest.velocity.x, latest.velocity.y, latest.velocity.z),
      role: latest.role,
      isEating: latest.isEating,
    };
  }

  private lerpAngle(start: number, end: number, alpha: number): number {
    const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
    return start + (delta * alpha);
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
   * Handle NPC killed message
   */
  private handleNPCKilled(message: NPCKilledMessage): void {
    if (this.onNPCKilledCallback) {
      this.onNPCKilledCallback(message);
    }
  }

  /**
   * Handle late-join state message (client only)
   */
  private handleLateJoinState(message: LateJoinStateMessage): void {
    if (this.gameState.isHost) return;
    if (this.onLateJoinStateCallback) {
      this.onLateJoinStateCallback(message);
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
    roundStartAt: number,
    countdownSeconds: number,
    roles: { [peerId: string]: PlayerRole },
    spawnStates: RoundStartMessage['spawnStates']
  ): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<RoundStartMessage>(MessageType.ROUND_START, {
      roundNumber,
      roundStartAt,
      countdownSeconds,
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
   * Send NPC killed event (host only)
   */
  public sendNPCKilled(
    npcId: string,
    playerId: string,
    npcType: NPCKilledMessage['npcType'],
    exists: boolean,
    respawnTimer: number
  ): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<NPCKilledMessage>(MessageType.NPC_KILLED, {
      npcId,
      playerId,
      npcType,
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
   * Register callback for NPC killed events
   */
  public onNPCKilled(callback: (message: NPCKilledMessage) => void): void {
    this.onNPCKilledCallback = callback;
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

  /**
   * Register callback for late-join state
   */
  public onLateJoinState(callback: (message: LateJoinStateMessage) => void): void {
    this.onLateJoinStateCallback = callback;
  }

  /**
   * Send late-join state to a specific peer (host only).
   * Includes round timer, roles, and all player states so the joiner
   * starts with the correct world.
   */
  public sendLateJoinState(
    targetPeerId: string,
    roundNumber: number,
    roundStartTime: number,
    roundDuration: number,
    roundState: RoundState,
    roles: { [peerId: string]: PlayerRole },
    playerStates: LateJoinStateMessage['playerStates']
  ): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<LateJoinStateMessage>(MessageType.LATE_JOIN_STATE, {
      roundNumber,
      roundStartTime,
      roundDuration,
      roundState,
      roles,
      playerStates,
    });

    this.peerConnection.send(message, targetPeerId);
  }

  /**
   * Force an immediate full state sync including food and NPC data.
   * Used to ensure late joiners get world state right away instead of
   * waiting for the next worldSyncIntervalMs tick.
   */
  public sendImmediateFullSync(): void {
    if (!this.gameState.isHost) return;

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

    const now = Date.now();
    const payload: Omit<StateSyncMessage, 'type' | 'timestamp'> = {
      players,
      roundNumber: this.gameState.roundNumber,
      roundStartTime: this.gameState.roundStartTime,
      roundDuration: this.gameState.roundDuration,
      roundState: this.gameState.roundState,
      roundElapsedMs: this.gameState.roundState === RoundState.PLAYING
        ? Math.max(0, now - this.gameState.roundStartTime)
        : 0,
      foods: Array.from(this.gameState.foods.values()).map((food) => ({
        id: food.id,
        type: food.type,
        position: { x: food.position.x, y: food.position.y, z: food.position.z },
        exists: food.exists,
        respawnTimer: food.respawnTimer ?? 0,
      })),
      npcs: Array.from(this.gameState.npcs.values()).map((npc) => ({
        id: npc.id,
        type: npc.type,
        position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
        rotation: npc.rotation,
        state: npc.state,
        exists: npc.exists,
      })),
    };

    const message = createMessage<StateSyncMessage>(MessageType.STATE_SYNC, payload);
    this.peerConnection.send(message);
    this.lastSyncTime = now;
    this.lastWorldSyncTime = now;
  }

  /**
   * Get debug stats for the network debug panel
   */
  public getDebugStats(): any {
    // Calculate basic stats from state buffer
    const bufferSize = this.stateBuffer.length;

    // Stub values - to be enhanced with actual metrics tracking
    return {
      rtt: 0, // To be calculated from ping/pong
      jitter: 0, // To be calculated from RTT variance
      packetLoss: 0, // To be tracked
      reconciliationError: 0, // To be tracked in Game.ts
      interpolationBufferSize: bufferSize,
      interpolationUnderruns: 0, // To be tracked
      extrapolationCount: 0, // To be tracked
      tickRate: Math.round(1000 / this.tickRate),
    };
  }
}
