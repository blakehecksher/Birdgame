import * as THREE from 'three';
import { PeerConnection } from './PeerConnection';
import { GameState, PlayerConnectionState } from '../core/GameState';
import {
  BaseMessage,
  NetworkMessage,
  MessageType,
  InputUpdateMessage,
  StateSyncMessage,
  FoodCollectedMessage,
  NPCKilledMessage,
  PlayerDeathMessage,
  RoundStartMessage,
  RoundEndMessage,
  JoinRequestMessage,
  JoinAcceptMessage,
  JoinDenyMessage,
  FullStateSnapshotMessage,
  JoinReadyMessage,
  FullStatePayload,
  RoleAssignmentMessage,
  PlayerLeftMessage,
  HostTerminatingMessage,
  PingMessage,
  PongMessage,
  createMessage,
} from './messages';
import { InputState } from '../core/InputManager';
import { GAME_CONFIG, PlayerRole, RoundState } from '../config/constants';

type JoinDenyReason = JoinDenyMessage['reason'];
type PlayerLeftReason = PlayerLeftMessage['reason'];
type JoinPhase = 'connecting' | 'requested' | 'accepted' | 'ready' | 'active' | 'denied';

interface PendingJoinPeer {
  phase: JoinPhase;
  connectedAt: number;
  snapshotId?: string;
  requestTimeout?: ReturnType<typeof setTimeout>;
  readyTimeout?: ReturnType<typeof setTimeout>;
}

interface SnapshotAssembly {
  totalChunks: number;
  receivedChunkIndexes: Set<number>;
  basePayload: Omit<FullStatePayload, 'foods' | 'npcs'>;
  foodsById: Map<string, FullStatePayload['foods'][number]>;
  npcsById: Map<string, FullStatePayload['npcs'][number]>;
}

interface BufferedRemoteSnapshot {
  serverTick: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  role: PlayerRole;
  isEating: boolean;
}

/**
 * Manages network synchronization between peers.
 */
export class NetworkManager {
  private peerConnection: PeerConnection;
  private gameState: GameState;

  private readonly playerSyncIntervalMs: number;
  private readonly npcSyncIntervalMs: number;
  private readonly inputIntervalMs: number;
  private readonly worldKeyframeIntervalMs: number;
  private readonly authoritativeTickMs: number;
  private readonly pingIntervalMs: number = 1000;

  private lastPlayerSyncTime: number = 0;
  private lastNpcSyncTime: number = 0;
  private lastWorldKeyframeTime: number = 0;
  private lastInputTime: number = 0;
  private lastPingTime: number = 0;
  private lastHostTickClock: number = 0;

  private serverTick: number = 0;
  private lastObservedServerTick: number = 0;
  private lastObservedServerTickAtMs: number = Date.now();
  private msgSeq: number = 0;

  private interpolationBufferMs: number = GAME_CONFIG.STATE_BUFFER_TIME;
  private smoothedRttMs: number = GAME_CONFIG.STATE_BUFFER_TIME;
  private smoothedJitterMs: number = 0;
  private pendingPings: Map<string, number> = new Map();
  private peerJoinTimes: Map<string, number> = new Map(); // peerId -> joinTime

  // State buffer for interpolation (client only)
  private stateBuffer: StateSyncMessage[] = [];
  private stalePeerRemovals: string[] = [];

  // Host-side remote input cache per peer.
  // Axes are treated as persistent state; mouse deltas are consumed once.
  private remoteInputs: Map<string, {
    hasInput: boolean;
    axes: InputState;
    pendingMouseX: number;
    pendingMouseY: number;
    lastUpdateAtMs: number;
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
  private clientInputEnabled: boolean = false;

  // Host-side join lifecycle
  private pendingJoins: Map<string, PendingJoinPeer> = new Map();

  // Client-side snapshot assembly for late join/recovery
  private snapshotAssemblies: Map<string, SnapshotAssembly> = new Map();
  private lastAppliedSnapshotId: string | null = null;

  // Client-side authoritative snapshot for local reconciliation.
  private localAuthoritativeState: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    velocity: THREE.Vector3;
    timestamp: number;
    serverTick: number;
  } | null = null;

  // Event callbacks (existing)
  private onPlayerDeathCallback: ((message: PlayerDeathMessage) => void) | null = null;
  private onRoundStartCallback: ((message: RoundStartMessage) => void) | null = null;
  private onFoodCollectedCallback: ((message: FoodCollectedMessage) => void) | null = null;
  private onNPCKilledCallback: ((message: NPCKilledMessage) => void) | null = null;
  private onRoundEndCallback: ((message: RoundEndMessage) => void) | null = null;

  // Event callbacks (lifecycle)
  private onJoinRequestCallback: ((message: JoinRequestMessage, peerId: string) => void) | null = null;
  private onJoinAcceptCallback: ((message: JoinAcceptMessage) => void) | null = null;
  private onJoinDenyCallback: ((message: JoinDenyMessage) => void) | null = null;
  private onJoinReadyCallback: ((message: JoinReadyMessage, peerId: string) => void) | null = null;
  private onFullSnapshotAppliedCallback: ((snapshotId: string, payload: FullStatePayload) => void) | null = null;
  private onRoleAssignmentCallback: ((message: RoleAssignmentMessage) => void) | null = null;
  private onPlayerLeftCallback: ((message: PlayerLeftMessage) => void) | null = null;
  private onHostTerminatingCallback: ((message: HostTerminatingMessage) => void) | null = null;

  constructor(peerConnection: PeerConnection, gameState: GameState) {
    this.peerConnection = peerConnection;
    this.gameState = gameState;
    this.playerSyncIntervalMs = 1000 / GAME_CONFIG.PLAYER_SNAPSHOT_RATE;
    this.npcSyncIntervalMs = 1000 / GAME_CONFIG.NPC_SNAPSHOT_RATE;
    this.inputIntervalMs = 1000 / GAME_CONFIG.INPUT_SEND_RATE;
    this.worldKeyframeIntervalMs = 1000 / GAME_CONFIG.WORLD_KEYFRAME_RATE;
    this.authoritativeTickMs = 1000 / GAME_CONFIG.TICK_RATE;

    // Register message handler
    this.peerConnection.onMessage((message, peerId) => this.handleMessage(message, peerId));

    // Local host player is always active.
    if (this.gameState.isHost) {
      this.gameState.setPlayerConnectionState(this.gameState.localPeerId, PlayerConnectionState.ACTIVE, true);
    }
  }

  /**
   * Handle incoming network message.
   */
  private handleMessage(message: NetworkMessage, peerId: string): void {
    if (
      message.protocolVersion !== GAME_CONFIG.NETWORK_PROTOCOL_VERSION
      && this.gameState.isHost
      && message.type === MessageType.JOIN_REQUEST
    ) {
      this.sendJoinDeny(peerId, 'version_mismatch');
      return;
    }

    switch (message.type) {
      case MessageType.JOIN_REQUEST:
        this.handleJoinRequest(message as JoinRequestMessage, peerId);
        break;

      case MessageType.JOIN_ACCEPT:
        this.handleJoinAccept(message as JoinAcceptMessage);
        break;

      case MessageType.JOIN_DENY:
        this.handleJoinDeny(message as JoinDenyMessage);
        break;

      case MessageType.FULL_STATE_SNAPSHOT:
        this.handleFullStateSnapshot(message as FullStateSnapshotMessage);
        break;

      case MessageType.JOIN_READY:
        this.handleJoinReady(message as JoinReadyMessage, peerId);
        break;

      case MessageType.INPUT_UPDATE:
        this.handleInputUpdate(message as InputUpdateMessage, peerId);
        break;

      case MessageType.STATE_SYNC:
        this.handleStateSync(message as StateSyncMessage);
        break;

      case MessageType.FOOD_COLLECTED:
        this.handleFoodCollected(message as FoodCollectedMessage);
        break;

      case MessageType.NPC_KILLED:
        this.handleNPCKilled(message as NPCKilledMessage);
        break;

      case MessageType.PLAYER_DEATH:
        this.handlePlayerDeath(message as PlayerDeathMessage);
        break;

      case MessageType.ROUND_START:
        this.handleRoundStart(message as RoundStartMessage);
        break;

      case MessageType.ROUND_END:
        this.handleRoundEnd(message as RoundEndMessage);
        break;

      case MessageType.ROLE_ASSIGNMENT:
        this.handleRoleAssignment(message as RoleAssignmentMessage);
        break;

      case MessageType.PLAYER_LEFT:
        this.handlePlayerLeft(message as PlayerLeftMessage);
        break;

      case MessageType.HOST_TERMINATING:
        this.handleHostTerminating(message as HostTerminatingMessage);
        break;

      case MessageType.PING:
        this.handlePing(message as PingMessage, peerId);
        break;

      case MessageType.PONG:
        this.handlePong(message as PongMessage);
        break;

      default:
        return;
    }
  }

  /**
   * Host registers a freshly connected peer that must perform a join handshake.
   */
  public registerPendingPeer(peerId: string): void {
    if (!this.gameState.isHost) return;

    this.clearJoinTimers(peerId);
    const pending: PendingJoinPeer = {
      phase: 'connecting',
      connectedAt: Date.now(),
    };

    pending.requestTimeout = setTimeout(() => {
      this.sendJoinDeny(peerId, 'timeout', 'JOIN_REQUEST timed out');
      const closer = this.peerConnection as unknown as { closePeer?: (id: string) => void };
      if (typeof closer.closePeer === 'function') {
        closer.closePeer(peerId);
      }
    }, GAME_CONFIG.NETWORK_JOIN_REQUEST_TIMEOUT_MS);

    this.pendingJoins.set(peerId, pending);
    this.gameState.setPlayerConnectionState(peerId, PlayerConnectionState.CONNECTING, false);
  }

  public unregisterPeer(peerId: string): void {
    this.clearJoinTimers(peerId);
    this.pendingJoins.delete(peerId);
    this.remoteInputs.delete(peerId);
  }

  public isPeerActive(peerId: string): boolean {
    if (!this.gameState.isHost) return false;

    const pending = this.pendingJoins.get(peerId);
    if (pending) {
      return pending.phase === 'active';
    }

    const player = this.gameState.players.get(peerId);
    return !!player?.active;
  }

  public activatePeer(peerId: string): void {
    if (!this.gameState.isHost) return;

    const pending = this.pendingJoins.get(peerId);
    if (pending) {
      this.clearJoinTimers(peerId);
      pending.phase = 'active';
      this.pendingJoins.set(peerId, pending);
    }

    this.gameState.setPlayerConnectionState(peerId, PlayerConnectionState.ACTIVE, true);
  }

  private clearJoinTimers(peerId: string): void {
    const pending = this.pendingJoins.get(peerId);
    if (!pending) return;

    if (pending.requestTimeout) {
      clearTimeout(pending.requestTimeout);
      pending.requestTimeout = undefined;
    }

    if (pending.readyTimeout) {
      clearTimeout(pending.readyTimeout);
      pending.readyTimeout = undefined;
    }
  }

  private createEnvelope(serverTick?: number): {
    protocolVersion: number;
    msgSeq: number;
    matchId?: string;
    serverTick?: number;
  } {
    this.msgSeq += 1;
    const envelope: {
      protocolVersion: number;
      msgSeq: number;
      matchId?: string;
      serverTick?: number;
    } = {
      protocolVersion: GAME_CONFIG.NETWORK_PROTOCOL_VERSION,
      msgSeq: this.msgSeq,
      matchId: this.gameState.matchId,
    };

    if (typeof serverTick === 'number') {
      envelope.serverTick = serverTick;
    }

    return envelope;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private updateObservedServerTick(serverTick: number): void {
    if (!Number.isFinite(serverTick)) return;

    const normalized = Math.max(0, serverTick);
    if (normalized > this.lastObservedServerTick) {
      this.lastObservedServerTick = normalized;
      this.lastObservedServerTickAtMs = Date.now();
    }
  }

  private getEstimatedObservedServerTick(nowMs: number = Date.now()): number {
    if (this.lastObservedServerTick <= 0) return 0;

    const elapsedMs = Math.max(0, nowMs - this.lastObservedServerTickAtMs);
    const elapsedTicks = elapsedMs / this.authoritativeTickMs;
    const cappedElapsedTicks = this.clamp(elapsedTicks, 0, GAME_CONFIG.RECONCILE_MAX_TICK_AGE);

    return this.lastObservedServerTick + cappedElapsedTicks;
  }
  /**
   * Handle join request from client (host only).
   */
  private handleJoinRequest(message: JoinRequestMessage, peerId: string): void {
    if (!this.gameState.isHost) return;

    const pending = this.pendingJoins.get(peerId) ?? {
      phase: 'connecting' as JoinPhase,
      connectedAt: Date.now(),
    };

    this.clearJoinTimers(peerId);
    pending.phase = 'requested';
    this.pendingJoins.set(peerId, pending);

    if (this.onJoinRequestCallback) {
      this.onJoinRequestCallback(message, peerId);
    }
  }

  /**
   * Send join request to host (client only).
   */
  public sendJoinRequest(playerName?: string): void {
    if (this.gameState.isHost) return;

    const message = createMessage<JoinRequestMessage>(MessageType.JOIN_REQUEST, {
      playerName,
      ...this.createEnvelope(),
    });

    this.peerConnection.send(message);
  }

  /**
   * Send join accept to client (host only).
   */
  public sendJoinAccept(
    peerId: string,
    assignedRole: PlayerRole,
    worldSeed: number,
    roundState: RoundState,
    roundNumber: number,
  ): void {
    if (!this.gameState.isHost) return;

    const pending = this.pendingJoins.get(peerId) ?? {
      phase: 'requested' as JoinPhase,
      connectedAt: Date.now(),
    };
    pending.phase = 'accepted';
    this.pendingJoins.set(peerId, pending);

    const message = createMessage<JoinAcceptMessage>(MessageType.JOIN_ACCEPT, {
      peerId,
      assignedRole,
      worldSeed,
      roundState,
      roundNumber,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message, peerId);
    this.gameState.setPlayerConnectionState(peerId, PlayerConnectionState.SYNCING, false);
  }

  /**
   * Send join deny to client (host only).
   */
  public sendJoinDeny(peerId: string, reason: JoinDenyReason, detail?: string): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<JoinDenyMessage>(MessageType.JOIN_DENY, {
      reason,
      detail,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message, peerId);

    const pending = this.pendingJoins.get(peerId);
    if (pending) {
      pending.phase = 'denied';
      this.clearJoinTimers(peerId);
      this.pendingJoins.delete(peerId);
    }

    this.gameState.setPlayerConnectionState(peerId, PlayerConnectionState.DISCONNECTED, false);
  }

  private handleJoinAccept(message: JoinAcceptMessage): void {
    if (this.gameState.isHost) return;

    if (typeof message.serverTick === 'number') {
      this.updateObservedServerTick(message.serverTick);
    }

    // Track join time for warmup buffer
    if (this.gameState.localPeerId) {
      this.peerJoinTimes.set(this.gameState.localPeerId, Date.now());
    }

    if (this.onJoinAcceptCallback) {
      this.onJoinAcceptCallback(message);
    }
  }

  private handleJoinDeny(message: JoinDenyMessage): void {
    if (this.gameState.isHost) return;

    if (this.onJoinDenyCallback) {
      this.onJoinDenyCallback(message);
    }
  }

  /**
   * Build an authoritative full-state payload from the current host state.
   */
  public buildFullStateSnapshotPayload(): FullStatePayload {
    const players: FullStatePayload['players'] = {};
    this.gameState.players.forEach((player, peerId) => {
      players[peerId] = {
        position: { x: player.position.x, y: player.position.y, z: player.position.z },
        rotation: { x: player.rotation.x, y: player.rotation.y, z: player.rotation.z },
        velocity: { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z },
        role: player.role,
        weight: player.weight,
        energy: player.energy,
        isEating: player.isEating,
        active: player.active,
        joinOrder: player.joinOrder,
        spawnProtectionUntilTick: player.spawnProtectionUntilTick,
        inputLockedUntilTick: player.inputLockedUntilTick,
      };
    });

    const foods = Array.from(this.gameState.foods.values()).map((food) => ({
      id: food.id,
      type: food.type,
      position: { x: food.position.x, y: food.position.y, z: food.position.z },
      exists: food.exists,
      respawnTimer: food.respawnTimer ?? 0,
    }));

    const npcs = Array.from(this.gameState.npcs.values()).map((npc) => ({
      id: npc.id,
      type: npc.type,
      position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
      rotation: npc.rotation,
      state: npc.state,
      exists: npc.exists,
      respawnTimer: npc.respawnTimer ?? 0,
    }));

    return {
      worldSeed: this.gameState.worldSeed,
      roundState: this.gameState.roundState,
      roundNumber: this.gameState.roundNumber,
      roundStartTime: this.gameState.roundStartTime,
      roundDuration: this.gameState.roundDuration,
      players,
      foods,
      npcs,
      scores: {
        pigeon: {
          totalWeight: this.gameState.scores.pigeon.totalWeight,
          roundsWon: this.gameState.scores.pigeon.roundsWon,
        },
        hawk: {
          killTimes: [...this.gameState.scores.hawk.killTimes],
          roundsWon: this.gameState.scores.hawk.roundsWon,
        },
      },
    };
  }

  /**
   * Send authoritative full-state snapshot in chunks (host only).
   */
  public sendFullStateSnapshot(peerId: string, payload?: FullStatePayload): string {
    if (!this.gameState.isHost) return '';

    const snapshot = payload ?? this.buildFullStateSnapshotPayload();
    const snapshotId = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const foodChunkSize = 80;
    const npcChunkSize = 60;
    const totalChunks = Math.max(
      1,
      Math.ceil(snapshot.foods.length / foodChunkSize),
      Math.ceil(snapshot.npcs.length / npcChunkSize),
    );

    for (let i = 0; i < totalChunks; i++) {
      const payloadChunk: FullStatePayload = {
        ...snapshot,
        foods: snapshot.foods.slice(i * foodChunkSize, (i + 1) * foodChunkSize),
        npcs: snapshot.npcs.slice(i * npcChunkSize, (i + 1) * npcChunkSize),
      };

      const message = createMessage<FullStateSnapshotMessage>(MessageType.FULL_STATE_SNAPSHOT, {
        snapshotId,
        chunkIndex: i,
        totalChunks,
        payload: payloadChunk,
        ...this.createEnvelope(this.serverTick),
      });

      this.peerConnection.send(message, peerId);
    }

    const pending = this.pendingJoins.get(peerId);
    if (pending) {
      pending.phase = 'accepted';
      pending.snapshotId = snapshotId;
      if (pending.readyTimeout) {
        clearTimeout(pending.readyTimeout);
      }
      pending.readyTimeout = setTimeout(() => {
        this.sendJoinDeny(peerId, 'timeout', 'JOIN_READY timed out');
        const closer = this.peerConnection as unknown as { closePeer?: (id: string) => void };
        if (typeof closer.closePeer === 'function') {
          closer.closePeer(peerId);
        }
      }, GAME_CONFIG.NETWORK_JOIN_READY_TIMEOUT_MS);
      this.pendingJoins.set(peerId, pending);
    }

    return snapshotId;
  }

  private handleFullStateSnapshot(message: FullStateSnapshotMessage): void {
    if (this.gameState.isHost) return;

    if (typeof message.serverTick === 'number') {
      this.updateObservedServerTick(message.serverTick);
    }

    const existing = this.snapshotAssemblies.get(message.snapshotId);
    const basePayload = existing?.basePayload ?? {
      worldSeed: message.payload.worldSeed,
      roundState: message.payload.roundState,
      roundNumber: message.payload.roundNumber,
      roundStartTime: message.payload.roundStartTime,
      roundDuration: message.payload.roundDuration,
      players: message.payload.players,
      scores: message.payload.scores,
    };

    const assembly: SnapshotAssembly = existing ?? {
      totalChunks: message.totalChunks,
      receivedChunkIndexes: new Set<number>(),
      basePayload,
      foodsById: new Map(),
      npcsById: new Map(),
    };

    message.payload.foods.forEach((food) => {
      assembly.foodsById.set(food.id, food);
    });

    message.payload.npcs.forEach((npc) => {
      assembly.npcsById.set(npc.id, npc);
    });

    assembly.receivedChunkIndexes.add(message.chunkIndex);
    assembly.totalChunks = Math.max(assembly.totalChunks, message.totalChunks);

    this.snapshotAssemblies.set(message.snapshotId, assembly);

    if (assembly.receivedChunkIndexes.size < assembly.totalChunks) {
      return;
    }

    const fullPayload: FullStatePayload = {
      ...assembly.basePayload,
      foods: Array.from(assembly.foodsById.values()),
      npcs: Array.from(assembly.npcsById.values()),
    };

    this.snapshotAssemblies.delete(message.snapshotId);
    this.lastAppliedSnapshotId = message.snapshotId;
    this.applyFullStateSnapshot(fullPayload);

    if (this.onFullSnapshotAppliedCallback) {
      this.onFullSnapshotAppliedCallback(message.snapshotId, fullPayload);
    }
  }

  /**
   * Send JOIN_READY once client fully applies snapshot.
   */
  public sendJoinReady(snapshotId: string): void {
    if (this.gameState.isHost) return;

    const message = createMessage<JoinReadyMessage>(MessageType.JOIN_READY, {
      snapshotId,
      ...this.createEnvelope(this.lastObservedServerTick),
    });

    this.peerConnection.send(message);
  }

  private handleJoinReady(message: JoinReadyMessage, peerId: string): void {
    if (!this.gameState.isHost) return;

    const pending = this.pendingJoins.get(peerId);
    if (!pending) return;

    if (pending.snapshotId && pending.snapshotId !== message.snapshotId) {
      return;
    }

    this.clearJoinTimers(peerId);
    pending.phase = 'ready';
    this.pendingJoins.set(peerId, pending);

    if (this.onJoinReadyCallback) {
      this.onJoinReadyCallback(message, peerId);
    }
  }

  private applyFullStateSnapshot(payload: FullStatePayload): void {
    this.gameState.worldSeed = payload.worldSeed;
    this.gameState.roundState = payload.roundState;
    this.gameState.roundNumber = payload.roundNumber;
    this.gameState.roundStartTime = payload.roundStartTime;
    this.gameState.roundDuration = payload.roundDuration;

    this.gameState.scores.pigeon.totalWeight = payload.scores.pigeon.totalWeight;
    this.gameState.scores.pigeon.roundsWon = payload.scores.pigeon.roundsWon;
    this.gameState.scores.hawk.killTimes = [...payload.scores.hawk.killTimes];
    this.gameState.scores.hawk.roundsWon = payload.scores.hawk.roundsWon;

    const roster = new Set(Object.keys(payload.players));
    for (const peerId of Array.from(this.gameState.players.keys())) {
      if (!roster.has(peerId)) {
        this.gameState.removePlayer(peerId);
        if (!this.stalePeerRemovals.includes(peerId)) {
          this.stalePeerRemovals.push(peerId);
        }
      }
    }

    Object.entries(payload.players).forEach(([peerId, playerData]) => {
      const spawn = new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z);
      const state = this.gameState.players.get(peerId)
        ?? this.gameState.addPlayer(peerId, playerData.role, spawn);

      state.role = playerData.role;
      state.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
      state.rotation.set(playerData.rotation.x, playerData.rotation.y, playerData.rotation.z);
      state.velocity.set(playerData.velocity.x, playerData.velocity.y, playerData.velocity.z);
      state.weight = playerData.weight;
      state.energy = playerData.energy;
      state.isEating = !!playerData.isEating;
      state.active = playerData.active ?? true;
      state.joinOrder = playerData.joinOrder ?? state.joinOrder;
      state.spawnProtectionUntilTick = playerData.spawnProtectionUntilTick ?? 0;
      state.inputLockedUntilTick = playerData.inputLockedUntilTick ?? 0;
    });

    this.gameState.foods.clear();
    payload.foods.forEach((food) => {
      const created = this.gameState.addFood(
        food.id,
        food.type,
        new THREE.Vector3(food.position.x, food.position.y, food.position.z)
      );
      created.exists = food.exists;
      created.respawnTimer = food.respawnTimer ?? 0;
    });

    this.gameState.setNPCSnapshots(
      payload.npcs.map((npc) => ({
        id: npc.id,
        type: npc.type,
        position: new THREE.Vector3(npc.position.x, npc.position.y, npc.position.z),
        rotation: npc.rotation,
        state: npc.state,
        exists: npc.exists,
        respawnTimer: npc.respawnTimer ?? 0,
      }))
    );
  }
  /**
   * Handle input update from client (host only).
   */
  private handleInputUpdate(message: InputUpdateMessage, peerId: string): void {
    if (!this.gameState.isHost) return;
    if (!this.isPeerActive(peerId)) return;

    const existing = this.remoteInputs.get(peerId) ?? {
      hasInput: false,
      axes: { forward: 0, strafe: 0, ascend: 0, mouseX: 0, mouseY: 0, scrollDelta: 0 },
      pendingMouseX: 0,
      pendingMouseY: 0,
      lastUpdateAtMs: Date.now(),
    };

    existing.axes.forward = this.clamp(message.input.forward, 0, 1);
    existing.axes.strafe = this.clamp(message.input.strafe, -1, 1);
    existing.axes.ascend = this.clamp(message.input.ascend, -1, 1);
    existing.axes.mobilePitchAutoCenter = message.input.pitchAutoCenter === true;
    existing.pendingMouseX += this.clamp(
      message.input.mouseX,
      -GAME_CONFIG.MAX_INPUT_MOUSE_DELTA,
      GAME_CONFIG.MAX_INPUT_MOUSE_DELTA
    );
    existing.pendingMouseY += this.clamp(
      message.input.mouseY,
      -GAME_CONFIG.MAX_INPUT_MOUSE_DELTA,
      GAME_CONFIG.MAX_INPUT_MOUSE_DELTA
    );
    existing.hasInput = true;
    existing.lastUpdateAtMs = Date.now();
    this.remoteInputs.set(peerId, existing);
  }

  /**
   * Handle state sync from host (client only).
   */
  private handleStateSync(message: StateSyncMessage): void {
    if (this.gameState.isHost) return;

    const incomingTick = typeof message.serverTick === 'number'
      ? Math.max(0, message.serverTick)
      : 0;

    // Prefer smoothness over strict delivery completeness:
    // drop snapshots that arrive far behind the newest observed tick.
    if (
      incomingTick > 0
      && this.lastObservedServerTick > 0
      && incomingTick < (this.lastObservedServerTick - 2)
    ) {
      return;
    }

    if (incomingTick > 0) {
      this.updateObservedServerTick(incomingTick);
    }

    this.stateBuffer.push(message);
    this.stateBuffer.sort((a, b) => (a.serverTick ?? 0) - (b.serverTick ?? 0));

    const maxTickAge = Math.max(1, GAME_CONFIG.RECONCILE_MAX_TICK_AGE * 4);
    const cutoffTick = this.lastObservedServerTick - maxTickAge;
    this.stateBuffer = this.stateBuffer.filter((snapshot) => (snapshot.serverTick ?? 0) >= cutoffTick);

    this.applyStateSync(message);
  }

  /**
   * Apply dynamic state sync to game state.
   */
  private applyStateSync(message: StateSyncMessage): void {
    const roster = new Set(Object.keys(message.players));

    // Remove players not present in latest authoritative roster.
    for (const peerId of Array.from(this.gameState.players.keys())) {
      if (peerId === this.gameState.localPeerId) continue;
      if (roster.has(peerId)) continue;
      this.gameState.removePlayer(peerId);
      if (!this.stalePeerRemovals.includes(peerId)) {
        this.stalePeerRemovals.push(peerId);
      }
    }

    // Update players.
    for (const peerId in message.players) {
      const playerData = message.players[peerId];
      let player = this.gameState.players.get(peerId);
      if (!player) {
        player = this.gameState.addPlayer(peerId, playerData.role);
      }

      if (player) {
        if (peerId === this.gameState.localPeerId) {
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
            timestamp: Date.now(),
            serverTick: message.serverTick ?? this.lastObservedServerTick,
          };
        } else {
          // Remote transforms are rendered from buffered interpolation in Game.update.
          // Do not hard-apply packet positions here to avoid visible snap/jitter on arrival.
        }

        player.role = playerData.role;
        player.weight = playerData.weight;
        player.energy = playerData.energy;
        player.isEating = playerData.isEating;
        player.active = playerData.active ?? player.active;
        player.joinOrder = playerData.joinOrder ?? player.joinOrder;
        player.spawnProtectionUntilTick = playerData.spawnProtectionUntilTick ?? player.spawnProtectionUntilTick;
        player.inputLockedUntilTick = playerData.inputLockedUntilTick ?? player.inputLockedUntilTick;
      }
    }

    if (message.foods) {
      const foodIds = new Set(message.foods.map((food) => food.id));
      for (const foodId of Array.from(this.gameState.foods.keys())) {
        if (!foodIds.has(foodId)) {
          this.gameState.foods.delete(foodId);
        }
      }

      message.foods.forEach((foodData) => {
        const existing = this.gameState.foods.get(foodData.id);
        if (existing) {
          existing.exists = foodData.exists;
          existing.respawnTimer = foodData.respawnTimer ?? 0;
          existing.position.set(foodData.position.x, foodData.position.y, foodData.position.z);
        } else {
          const created = this.gameState.addFood(
            foodData.id,
            foodData.type,
            new THREE.Vector3(foodData.position.x, foodData.position.y, foodData.position.z)
          );
          created.exists = foodData.exists;
          created.respawnTimer = foodData.respawnTimer ?? 0;
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
          respawnTimer: npc.respawnTimer ?? 0,
        }))
      );
    }
  }

  public consumeStalePeerRemovals(): string[] {
    if (this.stalePeerRemovals.length === 0) return [];
    const removals = [...this.stalePeerRemovals];
    this.stalePeerRemovals = [];
    return removals;
  }

  /**
   * Enable/disable client local input uplink.
   */
  public setClientInputEnabled(enabled: boolean): void {
    this.clientInputEnabled = enabled;
    if (!enabled) {
      this.pendingLocalInputAxes.forward = 0;
      this.pendingLocalInputAxes.strafe = 0;
      this.pendingLocalInputAxes.ascend = 0;
      this.pendingLocalMouseX = 0;
      this.pendingLocalMouseY = 0;
    }
  }

  /**
   * Send input update to host (client only, called every frame).
   */
  public sendInputUpdate(input: InputState): void {
    if (this.gameState.isHost) return;
    if (!this.clientInputEnabled) return;

    this.pendingLocalInputAxes.forward = this.clamp(input.forward, 0, 1);
    this.pendingLocalInputAxes.strafe = this.clamp(input.strafe, -1, 1);
    this.pendingLocalInputAxes.ascend = this.clamp(input.ascend, -1, 1);
    this.pendingLocalMouseX += this.clamp(
      input.mouseX,
      -GAME_CONFIG.MAX_INPUT_MOUSE_DELTA,
      GAME_CONFIG.MAX_INPUT_MOUSE_DELTA
    );
    this.pendingLocalMouseY += this.clamp(
      input.mouseY,
      -GAME_CONFIG.MAX_INPUT_MOUSE_DELTA,
      GAME_CONFIG.MAX_INPUT_MOUSE_DELTA
    );

    const now = Date.now();
    if (now - this.lastInputTime < this.inputIntervalMs) {
      this.maybeSendPing(now);
      return;
    }

    const outboundInput: InputUpdateMessage['input'] = {
      forward: this.pendingLocalInputAxes.forward,
      strafe: this.pendingLocalInputAxes.strafe,
      ascend: this.pendingLocalInputAxes.ascend,
      mouseX: this.pendingLocalMouseX,
      mouseY: this.pendingLocalMouseY,
    };
    if (input.mobilePitchAutoCenter) {
      outboundInput.pitchAutoCenter = true;
    }

    const message = createMessage<InputUpdateMessage>(MessageType.INPUT_UPDATE, {
      input: outboundInput,
      lastReceivedServerTick: this.lastObservedServerTick,
      ...this.createEnvelope(this.lastObservedServerTick),
    });

    this.peerConnection.send(message);
    this.pendingLocalMouseX = 0;
    this.pendingLocalMouseY = 0;
    this.lastInputTime = now;

    this.maybeSendPing(now);
  }

  private advanceServerTick(now: number): number {
    if (this.lastHostTickClock === 0) {
      this.lastHostTickClock = now;
      this.serverTick = Math.max(this.serverTick, 1);
      return this.serverTick;
    }

    const elapsed = now - this.lastHostTickClock;
    const ticksToAdvance = Math.max(1, Math.floor(elapsed / this.authoritativeTickMs));
    this.serverTick += ticksToAdvance;
    this.lastHostTickClock += ticksToAdvance * this.authoritativeTickMs;
    return this.serverTick;
  }

  /**
   * Send state sync to clients (host only, called every frame).
   */
  public sendStateSync(): void {
    if (!this.gameState.isHost) return;

    const now = Date.now();
    if (now - this.lastPlayerSyncTime < this.playerSyncIntervalMs) return;

    const serverTick = this.advanceServerTick(now);

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
        active: player.active,
        joinOrder: player.joinOrder,
        spawnProtectionUntilTick: player.spawnProtectionUntilTick,
        inputLockedUntilTick: player.inputLockedUntilTick,
      };
    });

    const payload: Omit<StateSyncMessage, 'type' | 'timestamp' | 'protocolVersion' | 'msgSeq'> & Partial<Pick<BaseMessage, 'matchId' | 'serverTick'>> = {
      players,
      serverTick,
    };

    const shouldSendWorldKeyframe = now - this.lastWorldKeyframeTime >= this.worldKeyframeIntervalMs;
    if (shouldSendWorldKeyframe) {
      payload.foods = Array.from(this.gameState.foods.values()).map((food) => ({
        id: food.id,
        type: food.type,
        position: { x: food.position.x, y: food.position.y, z: food.position.z },
        exists: food.exists,
        respawnTimer: food.respawnTimer ?? 0,
      }));
      this.lastWorldKeyframeTime = now;
    }

    const shouldSendNPCSync = now - this.lastNpcSyncTime >= this.npcSyncIntervalMs;
    if (shouldSendNPCSync) {
      payload.npcs = Array.from(this.gameState.npcs.values()).map((npc) => ({
        id: npc.id,
        type: npc.type,
        position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
        rotation: npc.rotation,
        state: npc.state,
        exists: npc.exists,
        respawnTimer: npc.respawnTimer ?? 0,
      }));
      this.lastNpcSyncTime = now;
    }

    const message = createMessage<StateSyncMessage>(MessageType.STATE_SYNC, {
      ...payload,
      ...this.createEnvelope(serverTick),
    });

    this.peerConnection.send(message);
    this.lastPlayerSyncTime = now;
  }

  /**
   * Get remote player's input (for host to apply to remote player).
   */
  public getRemoteInput(peerId: string): InputState | null {
    if (!this.gameState.isHost) return null;
    const entry = this.remoteInputs.get(peerId);
    if (!entry || !entry.hasInput) return null;

    const playerState = this.gameState.players.get(peerId);
    if (playerState && this.serverTick < playerState.inputLockedUntilTick) {
      return {
        forward: 0,
        strafe: 0,
        ascend: 0,
        mouseX: 0,
        mouseY: 0,
        scrollDelta: 0,
      };
    }

    const now = Date.now();
    if ((now - entry.lastUpdateAtMs) > GAME_CONFIG.REMOTE_INPUT_STALE_MS) {
      // Packet gap: neutralize intent so host authority does not keep flying on stale controls.
      entry.axes.forward = 0;
      entry.axes.strafe = 0;
      entry.axes.ascend = 0;
      entry.axes.mobilePitchAutoCenter = false;
      entry.pendingMouseX = 0;
      entry.pendingMouseY = 0;
      entry.lastUpdateAtMs = now;
      this.remoteInputs.set(peerId, entry);
    }

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
    serverTick: number;
  } | null {
    if (this.gameState.isHost) return null;
    return this.localAuthoritativeState;
  }

  public getLastObservedServerTick(): number {
    return this.lastObservedServerTick;
  }

  public getEstimatedServerTick(): number {
    if (this.gameState.isHost) return this.serverTick;
    return this.getEstimatedObservedServerTick();
  }

  public getCurrentServerTick(): number {
    return this.serverTick;
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

    const snapshots: BufferedRemoteSnapshot[] = this.stateBuffer
      .map((snapshot) => {
        const player = snapshot.players[peerId];
        if (!player) return null;
        return {
          serverTick: snapshot.serverTick ?? 0,
          position: player.position,
          rotation: player.rotation,
          velocity: player.velocity,
          role: player.role,
          isEating: !!player.isEating,
        };
      })
      .filter((snapshot): snapshot is BufferedRemoteSnapshot => snapshot !== null);

    // Not enough data to interpolate - use latest or fallback
    if (snapshots.length < 2) {
      if (snapshots.length === 1) {
        const latest = snapshots[0];
        return {
          position: new THREE.Vector3(latest.position.x, latest.position.y, latest.position.z),
          rotation: new THREE.Euler(latest.rotation.x, latest.rotation.y, latest.rotation.z),
          velocity: new THREE.Vector3(latest.velocity.x, latest.velocity.y, latest.velocity.z),
          role: latest.role,
          isEating: latest.isEating,
        };
      }
      return null;
    }

    // Use increased buffer for newly joined players (2 second warmup window)
    const joinElapsed = Date.now() - (this.peerJoinTimes.get(peerId) ?? 0);
    const isJoining = joinElapsed < 2000;
    const bufferMs = isJoining
      ? Math.min(this.interpolationBufferMs * 1.5, 300) // 1.5x buffer for joiners, cap at 300ms
      : this.interpolationBufferMs;

    const delayTicks = Math.max(
      1,
      Math.round((bufferMs / 1000) * GAME_CONFIG.TICK_RATE)
    );
    const renderTick = this.getEstimatedObservedServerTick() - delayTicks;

    if (renderTick <= snapshots[0].serverTick) {
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
      if (renderTick < older.serverTick || renderTick > newer.serverTick) continue;

      const span = Math.max(1, newer.serverTick - older.serverTick);
      const alpha = Math.max(0, Math.min(1, (renderTick - older.serverTick) / span));

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

    const latest = snapshots[snapshots.length - 1];
    const extrapolationTicksCap = Math.max(
      1,
      Math.round((GAME_CONFIG.EXTRAPOLATION_MAX_MS / 1000) * GAME_CONFIG.TICK_RATE)
    );
    const extrapolationTicks = this.clamp(
      renderTick - latest.serverTick,
      0,
      extrapolationTicksCap
    );
    const extrapolationSeconds = extrapolationTicks / GAME_CONFIG.TICK_RATE;

    // Limit extrapolation distance to prevent wild predictions
    const maxExtrapolationDistance = 3; // units
    let extrapolatedPos = new THREE.Vector3(
      latest.position.x + (latest.velocity.x * extrapolationSeconds),
      latest.position.y + (latest.velocity.y * extrapolationSeconds),
      latest.position.z + (latest.velocity.z * extrapolationSeconds)
    );

    const latestPos = new THREE.Vector3(latest.position.x, latest.position.y, latest.position.z);
    const extrapolationDist = extrapolatedPos.distanceTo(latestPos);
    if (extrapolationDist > maxExtrapolationDistance) {
      extrapolatedPos = latestPos.clone().lerp(extrapolatedPos,
        maxExtrapolationDistance / extrapolationDist);
    }

    return {
      position: extrapolatedPos,
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
  private maybeSendPing(now: number): void {
    if (now - this.lastPingTime < this.pingIntervalMs) return;

    const pingId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const message = createMessage<PingMessage>(MessageType.PING, {
      pingId,
      sentAt: now,
      ...this.createEnvelope(this.lastObservedServerTick),
    });

    this.pendingPings.set(pingId, now);
    this.peerConnection.send(message);
    this.lastPingTime = now;
  }

  private handlePing(message: PingMessage, peerId: string): void {
    const pong = createMessage<PongMessage>(MessageType.PONG, {
      pingId: message.pingId,
      sentAt: message.sentAt,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(pong, peerId);
  }

  private handlePong(message: PongMessage): void {
    const sentAt = this.pendingPings.get(message.pingId);
    if (typeof sentAt !== 'number') return;

    this.pendingPings.delete(message.pingId);
    const rtt = Math.max(1, Date.now() - sentAt);

    const delta = Math.abs(rtt - this.smoothedRttMs);
    this.smoothedRttMs = (this.smoothedRttMs * 0.85) + (rtt * 0.15);
    this.smoothedJitterMs = (this.smoothedJitterMs * 0.8) + (delta * 0.2);

    // Balanced buffer tuning: less aggressive RTT multiplier, higher base offset
    const targetBuffer = (this.smoothedRttMs * 0.5) + (this.smoothedJitterMs * 2.0) + 30;
    this.interpolationBufferMs = this.clamp(
      targetBuffer,
      GAME_CONFIG.INTERPOLATION_BUFFER_MIN_MS,
      GAME_CONFIG.INTERPOLATION_BUFFER_MAX_MS
    );
  }

  /**
   * Handle player death message.
   */
  private handlePlayerDeath(message: PlayerDeathMessage): void {
    if (this.onPlayerDeathCallback) {
      this.onPlayerDeathCallback(message);
    }
  }

  /**
   * Handle round start message.
   */
  private handleRoundStart(message: RoundStartMessage): void {
    if (typeof message.serverTick === 'number') {
      this.updateObservedServerTick(message.serverTick);
    }

    if (this.onRoundStartCallback) {
      this.onRoundStartCallback(message);
    }
  }

  /**
   * Handle food collected message.
   */
  private handleFoodCollected(message: FoodCollectedMessage): void {
    if (this.onFoodCollectedCallback) {
      this.onFoodCollectedCallback(message);
    }
  }

  /**
   * Handle NPC killed message.
   */
  private handleNPCKilled(message: NPCKilledMessage): void {
    if (this.onNPCKilledCallback) {
      this.onNPCKilledCallback(message);
    }
  }

  /**
   * Handle round end message.
   */
  private handleRoundEnd(message: RoundEndMessage): void {
    if (this.onRoundEndCallback) {
      this.onRoundEndCallback(message);
    }
  }

  private handleRoleAssignment(message: RoleAssignmentMessage): void {
    Object.entries(message.roles).forEach(([peerId, role]) => {
      const player = this.gameState.players.get(peerId);
      if (player) {
        player.role = role;
      }
    });

    if (this.onRoleAssignmentCallback) {
      this.onRoleAssignmentCallback(message);
    }
  }

  private handlePlayerLeft(message: PlayerLeftMessage): void {
    this.gameState.removePlayer(message.peerId);
    this.unregisterPeer(message.peerId);

    if (this.onPlayerLeftCallback) {
      this.onPlayerLeftCallback(message);
    }
  }

  private handleHostTerminating(message: HostTerminatingMessage): void {
    if (this.onHostTerminatingCallback) {
      this.onHostTerminatingCallback(message);
    }
  }

  /**
   * Send player death event (host only).
   */
  public sendPlayerDeath(victimId: string, killerId: string, pigeonWeight: number, survivalTime: number): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<PlayerDeathMessage>(MessageType.PLAYER_DEATH, {
      victimId,
      killerId,
      pigeonWeight,
      survivalTime,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message);
  }

  /**
   * Send round start event (host only).
   */
  public sendRoundStart(
    roundNumber: number,
    roundStartAt: number,
    countdownSeconds: number,
    roles: { [peerId: string]: PlayerRole },
    spawnStates: RoundStartMessage['spawnStates'],
    spawnProtectionUntilTick?: RoundStartMessage['spawnProtectionUntilTick'],
    inputLockedUntilTick?: RoundStartMessage['inputLockedUntilTick'],
  ): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<RoundStartMessage>(MessageType.ROUND_START, {
      roundNumber,
      roundStartAt,
      countdownSeconds,
      roles,
      spawnStates,
      spawnProtectionUntilTick,
      inputLockedUntilTick,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message);
  }

  /**
   * Send round end event (host only, e.g. timer expired).
   */
  public sendRoundEnd(
    winner: 'pigeon' | 'hawk' | 'timeout' | 'insufficient_players',
    pigeonWeight: number,
    survivalTime: number
  ): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<RoundEndMessage>(MessageType.ROUND_END, {
      winner,
      pigeonWeight,
      survivalTime,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message);
  }

  /**
   * Send food collected event (host only).
   */
  public sendFoodCollected(foodId: string, playerId: string, exists: boolean, respawnTimer: number): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<FoodCollectedMessage>(MessageType.FOOD_COLLECTED, {
      foodId,
      playerId,
      exists,
      respawnTimer,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message);
  }

  /**
   * Send NPC killed event (host only).
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
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message);
  }

  /**
   * Send role assignments (host only).
   */
  public sendRoleAssignment(
    roles: RoleAssignmentMessage['roles'],
    options?: Omit<RoleAssignmentMessage, 'type' | 'timestamp' | 'roles' | 'protocolVersion' | 'msgSeq'>,
  ): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<RoleAssignmentMessage>(MessageType.ROLE_ASSIGNMENT, {
      roles,
      activePeers: options?.activePeers,
      spawnStates: options?.spawnStates,
      reason: options?.reason,
      spawnProtectionUntilTick: options?.spawnProtectionUntilTick,
      inputLockedUntilTick: options?.inputLockedUntilTick,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message);
  }

  /**
   * Send authoritative player-left event (host only).
   */
  public sendPlayerLeft(peerId: string, reason: PlayerLeftReason): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<PlayerLeftMessage>(MessageType.PLAYER_LEFT, {
      peerId,
      reason,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message);
  }

  /**
   * Send host terminating event (host only).
   */
  public sendHostTerminating(reason: string): void {
    if (!this.gameState.isHost) return;

    const message = createMessage<HostTerminatingMessage>(MessageType.HOST_TERMINATING, {
      reason,
      ...this.createEnvelope(this.serverTick),
    });

    this.peerConnection.send(message);
  }

  public getLastAppliedSnapshotId(): string | null {
    return this.lastAppliedSnapshotId;
  }

  public getNetworkStats(): {
    bufferMs: number;
    rttMs: number;
    jitterMs: number;
    snapshotCount: number;
  } {
    return {
      bufferMs: this.interpolationBufferMs,
      rttMs: this.smoothedRttMs,
      jitterMs: this.smoothedJitterMs,
      snapshotCount: this.stateBuffer.length,
    };
  }
  // Callback registration (existing)
  public onPlayerDeath(callback: (message: PlayerDeathMessage) => void): void {
    this.onPlayerDeathCallback = callback;
  }

  public onRoundStart(callback: (message: RoundStartMessage) => void): void {
    this.onRoundStartCallback = callback;
  }

  public onFoodCollected(callback: (message: FoodCollectedMessage) => void): void {
    this.onFoodCollectedCallback = callback;
  }

  public onNPCKilled(callback: (message: NPCKilledMessage) => void): void {
    this.onNPCKilledCallback = callback;
  }

  public onRoundEnd(callback: (message: RoundEndMessage) => void): void {
    this.onRoundEndCallback = callback;
  }

  // Callback registration (lifecycle)
  public onJoinRequest(callback: (message: JoinRequestMessage, peerId: string) => void): void {
    this.onJoinRequestCallback = callback;
  }

  public onJoinAccept(callback: (message: JoinAcceptMessage) => void): void {
    this.onJoinAcceptCallback = callback;
  }

  public onJoinDeny(callback: (message: JoinDenyMessage) => void): void {
    this.onJoinDenyCallback = callback;
  }

  public onJoinReady(callback: (message: JoinReadyMessage, peerId: string) => void): void {
    this.onJoinReadyCallback = callback;
  }

  public onFullSnapshotApplied(callback: (snapshotId: string, payload: FullStatePayload) => void): void {
    this.onFullSnapshotAppliedCallback = callback;
  }

  public onRoleAssignment(callback: (message: RoleAssignmentMessage) => void): void {
    this.onRoleAssignmentCallback = callback;
  }

  public onPlayerLeft(callback: (message: PlayerLeftMessage) => void): void {
    this.onPlayerLeftCallback = callback;
  }

  public onHostTerminating(callback: (message: HostTerminatingMessage) => void): void {
    this.onHostTerminatingCallback = callback;
  }
}
