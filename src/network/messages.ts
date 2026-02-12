import { PlayerRole } from '../config/constants';
import { NPCSnapshot, NPCType } from '../entities/NPC';

/**
 * Network message types for communication between peers
 */
export enum MessageType {
  // Connection
  PLAYER_JOIN = 'PLAYER_JOIN',
  ROLE_SELECT = 'ROLE_SELECT',
  GAME_START = 'GAME_START',

  // Gameplay - Real-time
  INPUT_UPDATE = 'INPUT_UPDATE',      // Client sends input to host
  STATE_SYNC = 'STATE_SYNC',          // Host sends authoritative state to client

  // Gameplay - Events
  FOOD_COLLECTED = 'FOOD_COLLECTED',
  NPC_KILLED = 'NPC_KILLED',
  PLAYER_DEATH = 'PLAYER_DEATH',
  ROUND_END = 'ROUND_END',
  ROUND_START = 'ROUND_START',
}

/**
 * Base message interface
 */
export interface BaseMessage {
  type: MessageType;
  timestamp: number;
}

/**
 * Player joins the game
 */
export interface PlayerJoinMessage extends BaseMessage {
  type: MessageType.PLAYER_JOIN;
  peerId: string;
  playerName?: string;
}

/**
 * Role selection/assignment
 */
export interface RoleSelectMessage extends BaseMessage {
  type: MessageType.ROLE_SELECT;
  peerId: string;
  role: PlayerRole;
}

/**
 * Start the game
 */
export interface GameStartMessage extends BaseMessage {
  type: MessageType.GAME_START;
}

/**
 * Input update from client (sent at ~20Hz)
 */
export interface InputUpdateMessage extends BaseMessage {
  type: MessageType.INPUT_UPDATE;
  input: {
    forward: number;
    strafe: number;
    ascend: number;
    mouseX: number;
    mouseY: number;
  };
}

/**
 * State sync from host (sent at ~20Hz)
 */
export interface StateSyncMessage extends BaseMessage {
  type: MessageType.STATE_SYNC;
  players: {
    [peerId: string]: {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
      role: PlayerRole;
      weight?: number;
      energy?: number;
      isEating?: boolean;
    };
  };
  foods?: Array<{
    id: string;
    type: string;
    position: { x: number; y: number; z: number };
    exists: boolean;
    respawnTimer?: number;
  }>;
  npcs?: NPCSnapshot[];
}

/**
 * Food collected event
 */
export interface FoodCollectedMessage extends BaseMessage {
  type: MessageType.FOOD_COLLECTED;
  foodId: string;
  playerId: string;
  exists: boolean;
  respawnTimer: number;
}

/**
 * NPC killed event
 */
export interface NPCKilledMessage extends BaseMessage {
  type: MessageType.NPC_KILLED;
  npcId: string;
  playerId: string;
  npcType: NPCType;
  exists: boolean;
  respawnTimer: number;
}

/**
 * Player death event
 */
export interface PlayerDeathMessage extends BaseMessage {
  type: MessageType.PLAYER_DEATH;
  victimId: string;
  killerId: string;
  pigeonWeight: number;
  survivalTime: number;
}

/**
 * Round end event
 */
export interface RoundEndMessage extends BaseMessage {
  type: MessageType.ROUND_END;
  winner: 'pigeon' | 'hawk' | 'timeout';
  pigeonWeight: number;
  survivalTime: number;
}

/**
 * Round start event
 */
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
}

/**
 * Union type of all messages
 */
export type NetworkMessage =
  | PlayerJoinMessage
  | RoleSelectMessage
  | GameStartMessage
  | InputUpdateMessage
  | StateSyncMessage
  | FoodCollectedMessage
  | NPCKilledMessage
  | PlayerDeathMessage
  | RoundEndMessage
  | RoundStartMessage;

/**
 * Helper to create a message with timestamp
 */
export function createMessage<T extends BaseMessage>(
  type: MessageType,
  data: Omit<T, 'type' | 'timestamp'>
): T {
  return {
    type,
    timestamp: Date.now(),
    ...data,
  } as T;
}
