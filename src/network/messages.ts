import { GAME_CONFIG, PlayerRole, RoundState } from '../config/constants';
import { NPCSnapshot, NPCType } from '../entities/NPC';

/**
 * Network message types for communication between peers.
 */
export enum MessageType {
  // Connection lifecycle
  JOIN_REQUEST = 'JOIN_REQUEST',
  JOIN_ACCEPT = 'JOIN_ACCEPT',
  JOIN_DENY = 'JOIN_DENY',
  FULL_STATE_SNAPSHOT = 'FULL_STATE_SNAPSHOT',
  JOIN_READY = 'JOIN_READY',

  // Gameplay - Real-time
  INPUT_UPDATE = 'INPUT_UPDATE',
  STATE_SYNC = 'STATE_SYNC',

  // Gameplay - Events
  FOOD_COLLECTED = 'FOOD_COLLECTED',
  NPC_KILLED = 'NPC_KILLED',
  PLAYER_DEATH = 'PLAYER_DEATH',
  ROUND_END = 'ROUND_END',
  ROUND_START = 'ROUND_START',
  ROLE_ASSIGNMENT = 'ROLE_ASSIGNMENT',
  PLAYER_LEFT = 'PLAYER_LEFT',
  HOST_TERMINATING = 'HOST_TERMINATING',

  // Diagnostics
  PING = 'PING',
  PONG = 'PONG',
}

/**
 * Base message envelope.
 */
export interface BaseMessage {
  type: MessageType;
  timestamp: number;
  protocolVersion: number;
  msgSeq: number;
  matchId?: string;
  serverTick?: number;
}

export interface PlayerSnapshotState {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  role: PlayerRole;
  weight?: number;
  energy?: number;
  isEating?: boolean;
  active?: boolean;
  joinOrder?: number;
  spawnProtectionUntilTick?: number;
  inputLockedUntilTick?: number;
}

export interface FoodSnapshotState {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  exists: boolean;
  respawnTimer?: number;
}

export interface ScoreSnapshot {
  pigeon: {
    totalWeight: number;
    roundsWon: number;
  };
  hawk: {
    killTimes: number[];
    roundsWon: number;
  };
}

export interface JoinRequestMessage extends BaseMessage {
  type: MessageType.JOIN_REQUEST;
  playerName?: string;
}

export interface JoinAcceptMessage extends BaseMessage {
  type: MessageType.JOIN_ACCEPT;
  peerId: string;
  assignedRole: PlayerRole;
  worldSeed: number;
  roundState: RoundState;
  roundNumber: number;
}

export interface JoinDenyMessage extends BaseMessage {
  type: MessageType.JOIN_DENY;
  reason: 'room_full' | 'version_mismatch' | 'match_locked' | 'timeout';
  detail?: string;
}

export interface FullStatePayload {
  worldSeed: number;
  roundState: RoundState;
  roundNumber: number;
  roundStartTime: number;
  roundDuration: number;
  players: {
    [peerId: string]: PlayerSnapshotState;
  };
  foods: FoodSnapshotState[];
  npcs: NPCSnapshot[];
  scores: ScoreSnapshot;
}

export interface FullStateSnapshotMessage extends BaseMessage {
  type: MessageType.FULL_STATE_SNAPSHOT;
  snapshotId: string;
  chunkIndex: number;
  totalChunks: number;
  payload: FullStatePayload;
}

export interface JoinReadyMessage extends BaseMessage {
  type: MessageType.JOIN_READY;
  snapshotId: string;
}

/**
 * Input update from client.
 */
export interface InputUpdateMessage extends BaseMessage {
  type: MessageType.INPUT_UPDATE;
  input: {
    forward: number;
    strafe: number;
    ascend: number;
    mouseX: number;
    mouseY: number;
    pitchAutoCenter?: boolean;
  };
  lastReceivedServerTick?: number;
}

/**
 * Dynamic state sync from host.
 */
export interface StateSyncMessage extends BaseMessage {
  type: MessageType.STATE_SYNC;
  serverTick: number;
  players: {
    [peerId: string]: PlayerSnapshotState;
  };
  foods?: FoodSnapshotState[];
  npcs?: NPCSnapshot[];
}

export interface FoodCollectedMessage extends BaseMessage {
  type: MessageType.FOOD_COLLECTED;
  foodId: string;
  playerId: string;
  exists: boolean;
  respawnTimer: number;
}

export interface NPCKilledMessage extends BaseMessage {
  type: MessageType.NPC_KILLED;
  npcId: string;
  playerId: string;
  npcType: NPCType;
  exists: boolean;
  respawnTimer: number;
}

export interface PlayerDeathMessage extends BaseMessage {
  type: MessageType.PLAYER_DEATH;
  victimId: string;
  killerId: string;
  pigeonWeight: number;
  survivalTime: number;
}

export interface RoundEndMessage extends BaseMessage {
  type: MessageType.ROUND_END;
  winner: 'pigeon' | 'hawk' | 'timeout' | 'insufficient_players';
  pigeonWeight: number;
  survivalTime: number;
}

export interface RoundStartMessage extends BaseMessage {
  type: MessageType.ROUND_START;
  roundNumber: number;
  roundStartAt: number;
  countdownSeconds: number;
  roles: {
    [peerId: string]: PlayerRole;
  };
  spawnStates: {
    [peerId: string]: {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
    };
  };
  spawnProtectionUntilTick?: {
    [peerId: string]: number;
  };
  inputLockedUntilTick?: {
    [peerId: string]: number;
  };
}

export interface RoleAssignmentMessage extends BaseMessage {
  type: MessageType.ROLE_ASSIGNMENT;
  roles: {
    [peerId: string]: PlayerRole;
  };
  activePeers?: string[];
  spawnStates?: RoundStartMessage['spawnStates'];
  reason?: 'round_start' | 'pigeon_reassigned' | 'join_activated' | 'sync';
  spawnProtectionUntilTick?: {
    [peerId: string]: number;
  };
  inputLockedUntilTick?: {
    [peerId: string]: number;
  };
}

export interface PlayerLeftMessage extends BaseMessage {
  type: MessageType.PLAYER_LEFT;
  peerId: string;
  reason: 'disconnect' | 'timeout' | 'kicked' | 'host_terminated';
}

export interface HostTerminatingMessage extends BaseMessage {
  type: MessageType.HOST_TERMINATING;
  reason: string;
}

export interface PingMessage extends BaseMessage {
  type: MessageType.PING;
  pingId: string;
  sentAt: number;
}

export interface PongMessage extends BaseMessage {
  type: MessageType.PONG;
  pingId: string;
  sentAt: number;
}

/**
 * Union type of all protocol messages.
 */
export type NetworkMessage =
  | JoinRequestMessage
  | JoinAcceptMessage
  | JoinDenyMessage
  | FullStateSnapshotMessage
  | JoinReadyMessage
  | InputUpdateMessage
  | StateSyncMessage
  | FoodCollectedMessage
  | NPCKilledMessage
  | PlayerDeathMessage
  | RoundEndMessage
  | RoundStartMessage
  | RoleAssignmentMessage
  | PlayerLeftMessage
  | HostTerminatingMessage
  | PingMessage
  | PongMessage;

/**
 * Helper to create a message with timestamp and protocol envelope defaults.
 */
export function createMessage<T extends BaseMessage>(
  type: MessageType,
  data: Omit<T, 'type' | 'timestamp' | 'protocolVersion' | 'msgSeq'> & Partial<Pick<BaseMessage, 'protocolVersion' | 'msgSeq'>>
): T {
  const typed = data as unknown as Partial<BaseMessage>;
  return {
    type,
    timestamp: Date.now(),
    protocolVersion: typed.protocolVersion ?? GAME_CONFIG.NETWORK_PROTOCOL_VERSION,
    msgSeq: typed.msgSeq ?? 0,
    ...data,
  } as T;
}
