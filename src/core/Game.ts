import * as THREE from 'three';
import { SceneManager } from '../rendering/SceneManager';
import { CameraController } from '../rendering/CameraController';
import { InputManager } from './InputManager';
import { FlightController } from '../physics/FlightController';
import { CollisionDetector } from '../physics/CollisionDetector';
import { Player } from '../entities/Player';
import { Pigeon } from '../entities/Pigeon';
import { Hawk } from '../entities/Hawk';
import { GameState, PlayerConnectionState } from './GameState';
import { PeerConnection } from '../network/PeerConnection';
import { NetworkManager } from '../network/NetworkManager';
import {
  FoodCollectedMessage,
  FullStatePayload,
  HostTerminatingMessage,
  JoinAcceptMessage,
  JoinDenyMessage,
  JoinReadyMessage,
  JoinRequestMessage,
  NPCKilledMessage,
  PlayerLeftMessage,
  RoleAssignmentMessage,
  RoundEndMessage,
  RoundStartMessage,
} from '../network/messages';
import { LobbyUI } from '../ui/LobbyUI';
import { RoundEndOptions, ScoreUI } from '../ui/ScoreUI';
import { PlayerRole, RoundState, FoodType, GAME_CONFIG } from '../config/constants';
import { FoodSpawner } from '../world/FoodSpawner';
import { Environment } from '../world/Environment';
import { preloadModels, getModel } from '../utils/ModelLoader';
import { SeededRandom } from '../utils/SeededRandom';
import { NPCType } from '../entities/NPC';
import { NPCSpawner } from '../world/NPCSpawner';
import { LeaderboardService } from '../services/LeaderboardService';
import { AudioManager } from '../audio/AudioManager';
import { SOUND_MANIFEST, SFX } from '../audio/SoundManifest';
import {
  PERSONAL_BESTS_STORAGE_KEY,
  PersonalBests,
  parsePersonalBests,
  stringifyPersonalBests,
  updatePersonalBest,
} from '../ui/personalBests';

/**
 * Main game orchestrator
 */
export class Game {
  // Rendering
  private sceneManager: SceneManager;
  private cameraController: CameraController;

  // Input and physics
  private inputManager: InputManager;
  private flightController: FlightController;
  private collisionDetector: CollisionDetector;

  // Game state
  private gameState: GameState | null = null;

  // Networking
  private peerConnection: PeerConnection | null = null;
  private networkManager: NetworkManager | null = null;

  // UI
  private lobbyUI: LobbyUI;
  private scoreUI: ScoreUI;
  private leaderboard: LeaderboardService;

  // Players
  private localPlayer: Player | null = null;
  private remotePlayers: Map<string, Player> = new Map();
  private newlyJoinedPlayers: Map<string, number> = new Map(); // peerId -> joinTime
  private localPigeon: Pigeon | null = null;
  private localHawk: Hawk | null = null;
  private remotePigeons: Map<string, Pigeon> = new Map();
  private remoteHawks: Map<string, Hawk> = new Map();
  private foodSpawner: FoodSpawner | null = null;
  private npcSpawner: NPCSpawner | null = null;
  private environment: Environment | null = null;

  // Game loop
  private lastTime: number = 0;
  private canvas: HTMLCanvasElement;

  // State
  private isGameStarted: boolean = false;
  private isStartingGame: boolean = false;
  private lastReconcileTime: number = 0;
  private localAuthorityDriftMs: number = 0;
  private worldSeed: number = 1;
  private fixedTimeAccumulator: number = 0; // For fixed timestep on host
  private debugConsoleEl: HTMLElement | null = null;
  private lastDebugRefreshTime: number = 0;
  private debugConsoleVisible: boolean = true;
  private networkStatsEl: HTMLElement | null = null;
  private networkStatsVisible: boolean = false;
  private lastNetworkStatsRefreshTime: number = 0;
  private readonly debugToggleHandler: (event: KeyboardEvent) => void;
  private readonly networkStatsToggleHandler: (event: KeyboardEvent) => void;
  private readonly visibilityResumeHandler: () => void;

  // Audio
  private ambientLoopId: string | null = null;
  private windLoopId: string | null = null;
  private wasHawkDiving: boolean = false;
  private nextPigeonPeerId: string | null = null;
  private personalBests: PersonalBests;
  private countdownIntervalId: number | null = null;
  private countdownHideTimeoutId: number | null = null;
  private countdownActive: boolean = false;
  private readonly roundCountdownSeconds: number = 3;
  private hostRequestToken: number = 0;
  private controlsEnabled: boolean = false;
  private pendingConnectedPeers: Set<string> = new Set();

  constructor() {
    // Get canvas
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    if (!this.canvas) {
      throw new Error('Canvas element not found');
    }

    // Initialize rendering
    this.sceneManager = new SceneManager(this.canvas);
    this.cameraController = new CameraController(this.sceneManager.camera);

    // Initialize input and physics
    this.inputManager = new InputManager(this.canvas);
    this.flightController = new FlightController();
    this.collisionDetector = new CollisionDetector();

    // Initialize UI
    this.lobbyUI = new LobbyUI();
    this.scoreUI = new ScoreUI();
    this.leaderboard = new LeaderboardService();
    this.personalBests = this.loadPersonalBests();
    this.lobbyUI.show();
    this.lobbyUI.renderPersonalBests(this.personalBests);
    this.lobbyUI.showPersonalBestBadge(false);
    this.refreshLeaderboard();

    // Set up lobby callbacks
    this.lobbyUI.onHost(() => this.hostGame());
    this.lobbyUI.onHostCancel(() => this.cancelPendingHost());
    this.lobbyUI.onJoin((peerId) => this.joinGame(peerId));

    // Set up score UI callbacks
    this.scoreUI.onNextRound(() => this.startNextRound());

    // Set up disconnect return button
    const returnBtn = document.getElementById('disconnect-return-btn');
    if (returnBtn) {
      returnBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }
    this.debugConsoleEl = document.getElementById('debug-console');
    this.debugToggleHandler = (event: KeyboardEvent) => {
      if (event.code !== 'F3') return;
      event.preventDefault();
      this.debugConsoleVisible = !this.debugConsoleVisible;
      this.applyDebugConsoleVisibility();
    };
    this.networkStatsEl = document.getElementById('network-stats');
    this.networkStatsToggleHandler = (event: KeyboardEvent) => {
      if (event.code !== 'F4') return;
      event.preventDefault();
      this.networkStatsVisible = !this.networkStatsVisible;
      this.applyNetworkStatsVisibility();
    };
    this.visibilityResumeHandler = () => {
      if (document.visibilityState !== 'visible') return;
      this.peerConnection?.refreshPresence();
      if (this.gameState?.isHost && !this.isGameStarted) {
        this.lobbyUI.showWaiting('Back online. Waiting for players to join...');
      }
    };
    window.addEventListener('keydown', this.debugToggleHandler);
    window.addEventListener('keydown', this.networkStatsToggleHandler);
    document.addEventListener('visibilitychange', this.visibilityResumeHandler);
    window.addEventListener('focus', this.visibilityResumeHandler);

    // Initialize audio system
    AudioManager.init();
    this.setupVolumeControls();

    // If room code is in URL, prefill join screen but let player confirm name first.
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
      this.lobbyUI.prefillJoinRoomCode(roomCode.replace(/^birdgame-/i, '').toUpperCase());
    }

    // Start render loop (even before game starts)
    this.lastTime = performance.now();
    this.gameLoop();
  }

  /**
   * Generate a short numeric room code (6 digits).
   */
  private generateRoomCode(): string {
    const chars = '0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  /**
   * Stable 32-bit hash (FNV-1a) for deterministic world seed generation.
   */
  private hashToSeed(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Resolve world seed, preferring host-authoritative seed if already known.
   */
  private getWorldSeedFromPeerIds(): number {
    if (!this.gameState) return 1;
    if (this.gameState.worldSeed > 0) {
      return this.gameState.worldSeed;
    }

    const hostPeerId = this.gameState.isHost
      ? this.gameState.localPeerId
      : (this.gameState.remotePeerId ?? this.gameState.localPeerId);

    const seed = this.hashToSeed(hostPeerId);
    return seed === 0 ? 1 : seed;
  }

  /**
   * Get deterministic spawn points on opposite sides of the map.
   */
  private getSpawnPositions(): { local: THREE.Vector3; remote: THREE.Vector3 } {
    const fallbackLeft = new THREE.Vector3(-10, 5, 0);
    const fallbackRight = new THREE.Vector3(10, 5, 0);

    if (!this.gameState) {
      return { local: fallbackLeft, remote: fallbackRight };
    }

    let leftSpawn = fallbackLeft;
    let rightSpawn = fallbackRight;

    if (this.environment && this.environment.streetCenters.length >= 2) {
      const centralBand = this.environment.streetCenters
        .filter((point) => Math.abs(point.z) <= GAME_CONFIG.STREET_WIDTH * 2)
        .sort((a, b) => a.x - b.x);
      const sorted = (centralBand.length >= 2 ? centralBand : [...this.environment.streetCenters].sort((a, b) => a.x - b.x));

      leftSpawn = sorted[0].clone();
      rightSpawn = sorted[sorted.length - 1].clone();
      leftSpawn.y = 5;
      rightSpawn.y = 5;
    }

    return this.gameState.isHost
      ? { local: leftSpawn, remote: rightSpawn }
      : { local: rightSpawn, remote: leftSpawn };
  }

  private getBuildingClearance(point: THREE.Vector3): number {
    if (!this.environment || this.environment.buildings.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    let minDistance = Number.POSITIVE_INFINITY;
    this.environment.buildings.forEach((building) => {
      const closestX = Math.max(building.min.x, Math.min(point.x, building.max.x));
      const closestZ = Math.max(building.min.z, Math.min(point.z, building.max.z));
      const dx = point.x - closestX;
      const dz = point.z - closestZ;
      const distance = Math.sqrt((dx * dx) + (dz * dz));
      if (distance < minDistance) {
        minDistance = distance;
      }
    });

    return minDistance;
  }

  private distance2D(a: THREE.Vector3, b: THREE.Vector3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt((dx * dx) + (dz * dz));
  }

  private getStreetSpawnCandidates(): THREE.Vector3[] {
    if (!this.environment || this.environment.streetCenters.length === 0) {
      const fallback = this.getSpawnPositions();
      return [fallback.local.clone(), fallback.remote.clone()];
    }

    return this.environment.streetCenters
      .map((point) => new THREE.Vector3(point.x, 5, point.z))
      .filter((point) => this.getBuildingClearance(point) >= 4);
  }

  private pickBestSpawnCandidate(
    candidates: THREE.Vector3[],
    scoreFn: (point: THREE.Vector3) => number,
    filterFn: (point: THREE.Vector3) => boolean
  ): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    const maxCandidates = Math.min(32, candidates.length);
    for (let i = 0; i < maxCandidates; i++) {
      const candidate = candidates[(i * 17) % candidates.length];
      if (!filterFn(candidate)) continue;
      const score = scoreFn(candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best ? best.clone() : null;
  }

  private getSafePigeonSpawn(existingHawkPositions: THREE.Vector3[]): THREE.Vector3 {
    const candidates = this.getStreetSpawnCandidates();
    const fallback = this.getSpawnPositions().local.clone();

    const strict = this.pickBestSpawnCandidate(
      candidates,
      (candidate) => {
        const hawkDistance = existingHawkPositions.length > 0
          ? Math.min(...existingHawkPositions.map((hawkPos) => this.distance2D(candidate, hawkPos)))
          : 100;
        const clearance = this.getBuildingClearance(candidate);
        return (hawkDistance * 2) + clearance;
      },
      (candidate) => {
        if (this.getBuildingClearance(candidate) < 4) return false;
        if (existingHawkPositions.length === 0) return true;
        const minHawkDistance = Math.min(...existingHawkPositions.map((hawkPos) => this.distance2D(candidate, hawkPos)));
        return minHawkDistance >= 35;
      }
    );

    if (strict) return strict;

    const relaxed = this.pickBestSpawnCandidate(
      candidates,
      (candidate) => {
        const hawkDistance = existingHawkPositions.length > 0
          ? Math.min(...existingHawkPositions.map((hawkPos) => this.distance2D(candidate, hawkPos)))
          : 100;
        return hawkDistance + this.getBuildingClearance(candidate);
      },
      () => true
    );

    return relaxed ?? fallback;
  }

  private getSafeHawkSpawn(
    pigeonPosition: THREE.Vector3,
    existingHawkPositions: THREE.Vector3[]
  ): THREE.Vector3 {
    const candidates = this.getStreetSpawnCandidates();
    const fallback = this.getSpawnPositions().remote.clone();

    const strict = this.pickBestSpawnCandidate(
      candidates,
      (candidate) => {
        const pigeonDistance = this.distance2D(candidate, pigeonPosition);
        const spacingDistance = existingHawkPositions.length > 0
          ? Math.min(...existingHawkPositions.map((hawkPos) => this.distance2D(candidate, hawkPos)))
          : 30;
        return pigeonDistance + spacingDistance + this.getBuildingClearance(candidate);
      },
      (candidate) => {
        const pigeonDistance = this.distance2D(candidate, pigeonPosition);
        if (pigeonDistance < 45 || pigeonDistance > 90) return false;
        if (this.getBuildingClearance(candidate) < 4) return false;
        if (existingHawkPositions.length === 0) return true;
        const minSpacing = Math.min(...existingHawkPositions.map((hawkPos) => this.distance2D(candidate, hawkPos)));
        return minSpacing >= 14;
      }
    );

    if (strict) return strict;

    const relaxed = this.pickBestSpawnCandidate(
      candidates,
      (candidate) => {
        const pigeonDistance = this.distance2D(candidate, pigeonPosition);
        const spacingDistance = existingHawkPositions.length > 0
          ? Math.min(...existingHawkPositions.map((hawkPos) => this.distance2D(candidate, hawkPos)))
          : 30;
        return pigeonDistance + spacingDistance;
      },
      () => true
    );

    return relaxed ?? fallback;
  }

  private getRemoteSpawnPosition(index: number, totalRemotes: number): THREE.Vector3 {
    const hawkPositions: THREE.Vector3[] = [];
    for (let i = 0; i < index; i++) {
      const existing = this.remotePlayers.get(
        Array.from(this.remotePlayers.keys())[i] ?? ''
      );
      if (existing) hawkPositions.push(existing.position.clone());
    }
    const pigeon = this.getCurrentPigeon();
    const pigeonPosition = pigeon?.player.position ?? this.getSpawnPositions().local;
    return this.getSafeHawkSpawn(pigeonPosition.clone(), hawkPositions.slice(0, Math.max(0, totalRemotes - 1)));
  }

  private getPlayerByPeerId(peerId: string): Player | null {
    if (!this.gameState) return null;
    if (peerId === this.gameState.localPeerId) {
      return this.localPlayer;
    }
    return this.remotePlayers.get(peerId) ?? null;
  }

  private getPeerIdForPlayer(player: Player): string | null {
    if (!this.gameState) return null;
    if (this.localPlayer === player) return this.gameState.localPeerId;
    for (const [peerId, remote] of this.remotePlayers) {
      if (remote === player) return peerId;
    }
    return null;
  }

  private ensureRemotePlayer(
    peerId: string,
    role: PlayerRole,
    position: THREE.Vector3,
    yaw: number
  ): Player {
    const existing = this.remotePlayers.get(peerId);
    if (existing) return existing;

    const player = new Player(role, position.clone(), getModel(role));
    player.rotation.y = yaw;
    player.applyMeshRotation();
    this.remotePlayers.set(peerId, player);
    this.newlyJoinedPlayers.set(peerId, Date.now()); // Track join time
    this.sceneManager.scene.add(player.mesh);
    return player;
  }

  private removeRemotePlayer(peerId: string): void {
    const player = this.remotePlayers.get(peerId);
    if (!player) return;
    this.sceneManager.scene.remove(player.mesh);
    this.newlyJoinedPlayers.delete(peerId); // Clean up tracking
    player.dispose();
    this.remotePlayers.delete(peerId);
    this.remotePigeons.delete(peerId);
    this.remoteHawks.delete(peerId);
  }

  private syncRemotePlayersFromGameState(): void {
    if (!this.gameState) return;

    const expectedRemoteIds = new Set<string>();
    let roleChanged = false;
    this.gameState.players.forEach((playerState, peerId) => {
      if (peerId === this.gameState!.localPeerId) return;
      expectedRemoteIds.add(peerId);
      const yaw = playerState.role === PlayerRole.PIGEON ? 0 : Math.PI;
      const remotePlayer = this.ensureRemotePlayer(peerId, playerState.role, playerState.position, yaw);
      if (remotePlayer.role !== playerState.role) {
        remotePlayer.role = playerState.role;
        this.swapPlayerModel(remotePlayer);
        roleChanged = true;
      }
    });

    for (const peerId of Array.from(this.remotePlayers.keys())) {
      if (!expectedRemoteIds.has(peerId)) {
        this.removeRemotePlayer(peerId);
      }
    }

    if (roleChanged) {
      this.syncRoleControllers();
    }
  }

  private getCurrentPigeon(): { peerId: string; player: Player } | null {
    if (!this.gameState) return null;
    const pigeonState = Array.from(this.gameState.players.values())
      .find((playerState) => playerState.role === PlayerRole.PIGEON && playerState.active);
    if (!pigeonState) return null;
    const player = this.getPlayerByPeerId(pigeonState.peerId);
    if (!player) return null;
    return { peerId: pigeonState.peerId, player };
  }

  private getHawkPlayers(): Array<{ peerId: string; player: Player }> {
    if (!this.gameState) return [];
    const hawks: Array<{ peerId: string; player: Player }> = [];
    this.gameState.players.forEach((playerState, peerId) => {
      if (playerState.role !== PlayerRole.HAWK || !playerState.active) return;
      const player = this.getPlayerByPeerId(peerId);
      if (player) {
        hawks.push({ peerId, player });
      }
    });
    return hawks;
  }

  private setControlsEnabled(enabled: boolean): void {
    this.controlsEnabled = enabled;
    if (this.gameState && !this.gameState.isHost && this.networkManager) {
      this.networkManager.setClientInputEnabled(enabled);
    }
    if (!enabled) {
      this.inputManager.resetInputState();
    }
  }

  private processPendingConnections(): void {
    if (!this.gameState || !this.networkManager || !this.gameState.isHost) return;

    const pendingPeers = Array.from(this.pendingConnectedPeers.values());
    this.pendingConnectedPeers.clear();

    pendingPeers.forEach((peerId) => {
      if (!this.gameState || !this.networkManager) return;
      if (this.gameState.players.has(peerId)) return;

      if (this.gameState.players.size >= GAME_CONFIG.MAX_PLAYERS) {
        this.networkManager.sendJoinDeny(peerId, 'room_full');
        this.peerConnection?.closePeer(peerId);
        return;
      }

      this.networkManager.registerPendingPeer(peerId);
    });
  }

  private tryStartRoundIfReady(): void {
    if (!this.gameState || !this.gameState.isHost || !this.isGameStarted) return;

    if (this.gameState.getActivePlayerCount() < 2) {
      this.gameState.roundState = RoundState.WAITING_FOR_PLAYERS;
      this.setControlsEnabled(false);
      return;
    }

    if (this.gameState.roundState !== RoundState.PLAYING && !this.countdownActive) {
      this.startNextRound();
    }
  }

  /**
   * Host a new game
   */
  private async hostGame(): Promise<void> {
    const requestToken = ++this.hostRequestToken;
    try {
      AudioManager.resume();
      this.lobbyUI.showWaiting('Initializing...');
      this.lobbyUI.getEffectiveUsername();

      const roomCode = this.generateRoomCode();

      // Initialize peer connection as host with room code
      const peerConnection = new PeerConnection();
      this.peerConnection = peerConnection;
      const peerId = await peerConnection.initializeAsHost(roomCode);
      if (requestToken !== this.hostRequestToken) {
        peerConnection.disconnect();
        if (this.peerConnection === peerConnection) {
          this.peerConnection = null;
        }
        return;
      }

      // Display shareable room link
      this.lobbyUI.displayRoomLink(roomCode);

      // Initialize game state
      this.gameState = new GameState(true, peerId);
      this.gameState.worldSeed = this.getWorldSeedFromPeerIds();

      // Set up connection callbacks
      peerConnection.onConnected((remotePeerId) => {
        console.log('Client connected:', remotePeerId);
        if (!this.gameState) return;
        this.gameState.remotePeerId = remotePeerId;
        this.pendingConnectedPeers.add(remotePeerId);
        if (!this.isGameStarted && !this.isStartingGame) {
          this.lobbyUI.showWaiting('Player connected. Loading match...');
          void this.startGame().then(() => {
            this.processPendingConnections();
          });
        } else if (this.networkManager) {
          this.processPendingConnections();
        } else {
          this.lobbyUI.showWaiting('Player connected. Preparing host state...');
        }
      });

      this.setupDisconnectHandlers();
      this.lobbyUI.showWaiting('Waiting for players to join. Share your invite link first.');
    } catch (error) {
      if (requestToken !== this.hostRequestToken) {
        return;
      }
      console.error('Failed to host game:', error);
      this.lobbyUI.showError('Failed to create game. Please try again.');
    }
  }

  private cancelPendingHost(): void {
    if (this.isGameStarted) return;

    this.hostRequestToken += 1;
    if (this.peerConnection) {
      this.peerConnection.disconnect();
      this.peerConnection = null;
    }
    this.networkManager = null;
    this.gameState = null;
  }

  /**
   * Join an existing game
   */
  private async joinGame(hostPeerId: string): Promise<void> {
    try {
      AudioManager.resume();
      this.lobbyUI.getEffectiveUsername();
      this.lobbyUI.showConnecting();

      // Normalize accepted inputs:
      // - "123456"
      // - "birdgame-123456" (any case)
      // Backward-compatible: existing alphanumeric room ids still parse.
      const rawInput = hostPeerId.trim();
      const roomCode = rawInput.replace(/^birdgame-/i, '').toUpperCase();
      const fullPeerId = `birdgame-${roomCode}`;

      // Initialize peer connection as client
      this.peerConnection = new PeerConnection();
      const peerId = await this.peerConnection.initializeAsClient(fullPeerId);

      // Initialize game state
      this.gameState = new GameState(false, peerId);
      this.gameState.remotePeerId = fullPeerId;

      // Set up connection callback
      this.peerConnection.onConnected(() => {
        console.log('Connected to host');
        void this.startGame();
      });

      this.setupDisconnectHandlers();

      // Handle connection errors
      setTimeout(() => {
        if (!this.gameState || (this.gameState.roundState === RoundState.LOBBY && !this.controlsEnabled)) {
          this.lobbyUI.showError('Failed to connect. Check the room code and try again.');
          this.lobbyUI.show();
        }
      }, 8000);
    } catch (error) {
      console.error('Failed to join game:', error);
      this.lobbyUI.showError('Failed to connect. Please try again.');
      this.lobbyUI.show();
    }
  }

  /**
   * Start the game once connection is established
   */
  private async startGame(): Promise<void> {
    if (!this.gameState || !this.peerConnection) return;
    if (this.isGameStarted || this.isStartingGame) return;
    this.isStartingGame = true;

    try {
      console.log('Starting game...');

    // Preload 3D models and sounds in parallel
    const modelTask = preloadModels()
      .then(() => console.log('3D models loaded'))
      .catch((err) => console.warn('Failed to load 3D models, using fallback meshes:', err));

    const soundTask = AudioManager.preload(SOUND_MANIFEST)
      .then(() => console.log('Sounds loaded'))
      .catch((err) => console.warn('Failed to load sounds:', err));

    await Promise.all([modelTask, soundTask]);

    // Initialize network manager
    this.networkManager = new NetworkManager(this.peerConnection, this.gameState);

    // Register network event handlers
    this.networkManager.onPlayerDeath((message) => this.handlePlayerDeath(message));
    this.networkManager.onRoundStart((message) => this.handleRoundStart(message));
    this.networkManager.onFoodCollected((message) => this.handleFoodCollected(message));
    this.networkManager.onNPCKilled((message) => this.handleNPCKilled(message));
    this.networkManager.onRoundEnd((message) => this.handleRoundEnd(message));
    this.networkManager.onJoinRequest((message, peerId) => this.handleJoinRequest(message, peerId));
    this.networkManager.onJoinReady((message, peerId) => this.handleJoinReady(message, peerId));
    this.networkManager.onJoinAccept((message) => this.handleJoinAccept(message));
    this.networkManager.onJoinDeny((message) => this.handleJoinDeny(message));
    this.networkManager.onFullSnapshotApplied((snapshotId, payload) => this.handleFullSnapshotApplied(snapshotId, payload));
    this.networkManager.onRoleAssignment((message) => this.handleRoleAssignment(message));
    this.networkManager.onPlayerLeft((message) => this.handlePlayerLeft(message));
    this.networkManager.onHostTerminating((message) => this.handleHostTerminating(message));

    // Assign roles (host = pigeon, client = hawk for now, will swap later)
    const localRole = this.gameState.isHost ? PlayerRole.PIGEON : PlayerRole.HAWK;

    // Build deterministic world from shared seed.
    this.worldSeed = this.getWorldSeedFromPeerIds();
    this.gameState.worldSeed = this.worldSeed;
    this.environment = new Environment(this.sceneManager.scene, this.worldSeed);

    // Set up camera collision with building meshes
    this.cameraController.setCollisionMeshes(
      this.environment.buildings.map((b) => b.mesh)
    );

    const spawn = this.getSpawnPositions();
    const localSpawnPos = spawn.local.clone();

    // Clear any pre-existing runtime player instances.
    for (const peerId of Array.from(this.remotePlayers.keys())) {
      this.removeRemotePlayer(peerId);
    }
    this.remotePigeons.clear();
    this.remoteHawks.clear();

    // Create local player
    const localPlayerState = this.gameState.players.get(this.gameState.localPeerId)
      ?? this.gameState.addPlayer(this.gameState.localPeerId, localRole, localSpawnPos);
    localPlayerState.role = localRole;
    localPlayerState.position.copy(localSpawnPos);
    this.localPlayer = new Player(localRole, localSpawnPos, getModel(localRole));
    // Face toward center (host faces right, client faces left)
    this.localPlayer.rotation.y = this.gameState.isHost ? 0 : Math.PI;
    this.localPlayer.applyMeshRotation();
    localPlayerState.rotation.y = this.localPlayer.rotation.y;
    this.sceneManager.scene.add(this.localPlayer.mesh);

    if (!this.gameState.isHost && this.gameState.remotePeerId) {
      // Client immediately tracks the host as remote; additional clients are
      // created lazily from host state snapshots.
      const hostPeerId = this.gameState.remotePeerId;
      const hostSpawnPos = spawn.remote.clone();
      const state = this.gameState.players.get(hostPeerId)
        ?? this.gameState.addPlayer(hostPeerId, PlayerRole.PIGEON, hostSpawnPos);
      state.role = PlayerRole.PIGEON;
      state.position.copy(hostSpawnPos);
      state.rotation.set(0, 0, 0);
      state.velocity.set(0, 0, 0);
      this.ensureRemotePlayer(hostPeerId, PlayerRole.PIGEON, hostSpawnPos, 0);
    }
    this.syncRemotePlayersFromGameState();

    // Spawn food entities
    const foodRng = new SeededRandom((this.worldSeed ^ 0x9e3779b9) >>> 0);
    this.foodSpawner = new FoodSpawner(
      this.sceneManager.scene,
      this.environment.parkCells,
      this.environment.streetCenters,
      this.environment.buildings,
      foodRng
    );
    this.foodSpawner.getFoods().forEach((food) => {
      this.gameState!.addFood(food.id, food.type, food.position);
    });

    const npcRng = new SeededRandom((this.worldSeed ^ 0x7f4a7c15) >>> 0);
    this.npcSpawner = new NPCSpawner(
      this.sceneManager.scene,
      npcRng,
      this.environment.parkCells,
      this.environment.streetCenters,
      this.environment.treeCanopies
    );
    if (this.gameState.isHost) {
      this.npcSpawner.spawnInitial(
        GAME_CONFIG.NPC_PIGEON_COUNT,
        GAME_CONFIG.NPC_RAT_COUNT,
        GAME_CONFIG.NPC_SQUIRREL_COUNT
      );
      this.syncNPCStateToGameState();
    }

    // Initialize role-specific stat controllers
    this.syncRoleControllers();
    this.setControlsEnabled(false);
    this.networkManager.setClientInputEnabled(false);

    // Set initial camera position
    this.cameraController.setPositionImmediate(this.localPlayer.mesh, this.localPlayer.rotation);

    // Hide lobby, show HUD, flight indicator, and connection status
    this.lobbyUI.hide();
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'block';
    const flightIndicator = document.getElementById('flight-indicator');
    if (flightIndicator) flightIndicator.style.display = 'block';
    const connStatus = document.getElementById('connection-status');
    if (connStatus) connStatus.style.display = 'flex';
    const volumeBtn = document.getElementById('volume-btn');
    if (volumeBtn) volumeBtn.style.display = 'flex';
    this.applyDebugConsoleVisibility();
    if (!this.inputManager.isMobile) {
      this.inputManager.setPointerLockEnabled(false);
    }

    // Show instructions overlay (dismissed on click/tap)
    const instructions = document.getElementById('instructions');
    if (instructions) {
      // Show mobile-specific control instructions
      if (this.inputManager.isMobile) {
        const controlsDiv = instructions.querySelector('.controls');
        if (controlsDiv) {
          controlsDiv.innerHTML = `
            <div><span>GO button</span> Forward thrust</div>
            <div><span>Right stick</span> Pitch & bank</div>
            <div><span>UP</span> Fly higher</div>
            <div><span>DN</span> Fly lower</div>
          `;
        }
        const dismissEl = instructions.querySelector('.dismiss');
        if (dismissEl) dismissEl.textContent = 'Tap to start';
      }

      instructions.style.display = 'block';
      const dismiss = () => {
        instructions.style.display = 'none';
        if (!this.inputManager.isMobile) {
          this.inputManager.setPointerLockEnabled(true);
        }
        this.inputManager.showTouchControls();
        instructions.removeEventListener('click', dismiss);
        instructions.removeEventListener('touchstart', dismiss);
      };
      instructions.addEventListener('click', dismiss);
      instructions.addEventListener('touchstart', dismiss);
    } else {
      if (!this.inputManager.isMobile) {
        this.inputManager.setPointerLockEnabled(true);
      }
      this.inputManager.showTouchControls();
    }

    this.isGameStarted = true;
    this.lastReconcileTime = 0;
    this.localAuthorityDriftMs = 0;

    // Start ambient sounds
    this.ambientLoopId = AudioManager.playLoop(SFX.AMBIENT_CITY, 'ambient', 0.5);
    this.windLoopId = AudioManager.playLoop(SFX.WIND_LOOP, 'ambient', 0.3);

      if (this.gameState.isHost) {
        this.processPendingConnections();
        this.gameState.roundState = RoundState.WAITING_FOR_PLAYERS;
        this.tryStartRoundIfReady();
      } else {
        this.gameState.roundState = RoundState.LOBBY;
        this.lobbyUI.showWaiting('Joining room...');
        this.networkManager.sendJoinRequest(this.lobbyUI.getEffectiveUsername());
      }
    } finally {
      this.isStartingGame = false;
    }
  }

  /**
   * Main game loop
   */
  private gameLoop = (): void => {
    requestAnimationFrame(this.gameLoop);

    // Calculate delta time
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    const cappedDelta = Math.min(deltaTime, 0.1);

    // Update game
    if (this.isGameStarted) {
      this.update(cappedDelta);
    }

    // Always render
    this.sceneManager.render();
  };

  private async refreshLeaderboard(): Promise<void> {
    if (!this.leaderboard.isConfigured()) {
      this.lobbyUI.setLeaderboardStatus('Set Supabase env vars to enable leaderboard');
      this.lobbyUI.renderLeaderboard([], []);
      return;
    }

    this.lobbyUI.setLeaderboardStatus('Loading...');
    try {
      const [fattest, fastest] = await Promise.all([
        this.leaderboard.fetchTop('fattest_pigeon', 10),
        this.leaderboard.fetchTop('fastest_hawk_kill', 10),
      ]);
      this.lobbyUI.renderLeaderboard(fattest, fastest);
      this.lobbyUI.setLeaderboardStatus('Live board');
    } catch (error) {
      console.warn('Leaderboard load failed:', error);
      this.lobbyUI.setLeaderboardStatus('Leaderboard unavailable');
      this.lobbyUI.renderLeaderboard([], []);
    }
  }

  private submitLocalLeaderboardResult(
    winner: 'pigeon' | 'hawk',
    pigeonWeight: number,
    survivalTime: number
  ): void {
    if (!this.localPlayer || !this.gameState || !this.leaderboard.isConfigured()) return;

    const username = this.lobbyUI.getEffectiveUsername();
    const tasks: Promise<void>[] = [];

    if (this.localPlayer.role === PlayerRole.PIGEON) {
      tasks.push(this.leaderboard.submit({
        username,
        metric: 'fattest_pigeon',
        value: pigeonWeight,
        match_id: this.gameState.matchId,
        round_number: this.gameState.roundNumber,
      }));
    }

    if (winner === 'hawk' && this.localPlayer.role === PlayerRole.HAWK) {
      tasks.push(this.leaderboard.submit({
        username,
        metric: 'fastest_hawk_kill',
        value: survivalTime,
        match_id: this.gameState.matchId,
        round_number: this.gameState.roundNumber,
      }));
    }

    if (tasks.length === 0) return;

    Promise.all(tasks)
      .then(() => this.refreshLeaderboard())
      .catch((error) => console.warn('Leaderboard submit failed:', error));
  }

  private loadPersonalBests(): PersonalBests {
    const raw = localStorage.getItem(PERSONAL_BESTS_STORAGE_KEY);
    return parsePersonalBests(raw);
  }

  private savePersonalBests(): void {
    localStorage.setItem(PERSONAL_BESTS_STORAGE_KEY, stringifyPersonalBests(this.personalBests));
    this.lobbyUI.renderPersonalBests(this.personalBests);
  }

  private createRoundEndOptions(bestCallouts: string[]): RoundEndOptions {
    const isHost = !!this.gameState?.isHost;
    return {
      canStartNextRound: isHost,
      nextRoundLabel: isHost ? 'Play Again' : 'Waiting for host...',
      statusText: isHost
        ? 'Round Over -> Ready. Click Play Again to launch countdown.'
        : 'Round Over. Waiting for host to launch next round.',
      personalBestCallouts: bestCallouts,
    };
  }

  private updatePersonalBestsForRound(
    winner: 'pigeon' | 'hawk',
    pigeonWeight: number,
    survivalTime: number
  ): string[] {
    if (!this.localPlayer) return [];

    const callouts: string[] = [];

    if (this.localPlayer.role === PlayerRole.PIGEON) {
      const update = updatePersonalBest(this.personalBests, 'fattest_pigeon', pigeonWeight);
      if (update.isNewBest) {
        this.personalBests = update.bests;
        callouts.push('New Personal Best: Fattest pigeon!');
      }
    }

    if (winner === 'hawk' && this.localPlayer.role === PlayerRole.HAWK) {
      const update = updatePersonalBest(this.personalBests, 'fastest_hawk_kill', survivalTime);
      if (update.isNewBest) {
        this.personalBests = update.bests;
        callouts.push('New Personal Best: Fastest hawk kill!');
      }
    }

    this.lobbyUI.showPersonalBestBadge(callouts.length > 0);
    if (callouts.length > 0) {
      this.savePersonalBests();
      this.showEventPopup('New Personal Best!', 'warn');
    }

    return callouts;
  }

  /**
   * Update game state
   */
  private update(deltaTime: number): void {
    if (!this.gameState || !this.localPlayer) return;

    // Get input (locked during countdown)
    const rawInput = this.inputManager.getInputState(deltaTime);
    const input = (this.countdownActive || !this.controlsEnabled)
      ? { ...rawInput, forward: 0, strafe: 0, ascend: 0, mouseX: 0, mouseY: 0 }
      : rawInput;

    if (this.gameState.isHost) {
      // HOST: Fixed timestep simulation for deterministic cross-platform sync
      this.updateHost(deltaTime, input);
    } else {
      // CLIENT: Smooth local prediction + interpolated remote players
      this.updateClient(deltaTime, input);
    }

    this.updateDebugConsole();
    this.updateNetworkStats();
  }

  /**
   * Host update with fixed timestep simulation
   */
  private updateHost(deltaTime: number, input: InputState): void {
    if (!this.gameState || !this.localPlayer) return;

    const FIXED_STEP = 1 / GAME_CONFIG.TICK_RATE; // 0.0333... seconds (30Hz)
    this.fixedTimeAccumulator += deltaTime;

    // Cap accumulator to prevent spiral of death
    if (this.fixedTimeAccumulator > 0.25) {
      this.fixedTimeAccumulator = 0.25;
    }

    // Run fixed timestep simulation
    while (this.fixedTimeAccumulator >= FIXED_STEP) {
      this.simulateStep(FIXED_STEP, input);
      this.fixedTimeAccumulator -= FIXED_STEP;
    }

    // Update visuals and network
    this.updateVisuals();
    this.updateDiveSounds();
    if (this.networkManager) {
      this.networkManager.sendStateSync();
    }
  }

  /**
   * Single fixed timestep simulation (called multiple times per frame on host)
   */
  private simulateStep(fixedDelta: number, input: InputState): void {
    if (!this.gameState || !this.localPlayer) return;

    // Simulate local player
    this.flightController.applyInput(this.localPlayer, input, fixedDelta);
    this.localPlayer.update(fixedDelta);

    if (this.environment) {
      this.environment.checkAndResolveCollisions(
        this.localPlayer.position,
        this.localPlayer.radius,
        this.localPlayer.velocity
      );
      if (this.localPlayer.role === PlayerRole.HAWK) {
        this.environment.applyHawkCanopySlow(
          this.localPlayer.position,
          this.localPlayer.radius,
          this.localPlayer.velocity,
          fixedDelta
        );
      }
    }

    // Update role stats (hawk energy, etc.)
    this.updateRoleStats(this.localPlayer, fixedDelta, true);

    // Simulate ALL remote players authoritatively on host
    if (this.networkManager) {
      for (const [peerId, remotePlayer] of this.remotePlayers) {
        const remoteState = this.gameState.players.get(peerId);
        if (!remoteState?.active) continue;

        const remoteInput = this.networkManager.getRemoteInput(peerId);
        if (remoteInput && !this.countdownActive) {
          this.flightController.applyInput(remotePlayer, remoteInput, fixedDelta);
        }
        remotePlayer.update(fixedDelta);

        if (this.environment) {
          this.environment.checkAndResolveCollisions(
            remotePlayer.position,
            remotePlayer.radius,
            remotePlayer.velocity
          );
          if (remotePlayer.role === PlayerRole.HAWK) {
            this.environment.applyHawkCanopySlow(
              remotePlayer.position,
              remotePlayer.radius,
              remotePlayer.velocity,
              fixedDelta
            );
          }
        }

        this.updateRoleStats(remotePlayer, fixedDelta, true);

        // Sync to game state
        const remotePlayerState = this.gameState.players.get(peerId);
        if (remotePlayerState) {
          remotePlayerState.position.copy(remotePlayer.position);
          remotePlayerState.rotation.copy(remotePlayer.rotation);
          remotePlayerState.velocity.copy(remotePlayer.velocity);
          remotePlayerState.isEating = remotePlayer.isEating;
          remotePlayerState.weight = this.getPlayerWeight(remotePlayer);
          remotePlayerState.energy = this.getPlayerEnergy(remotePlayer);
        }
      }
    }

    // Sync local player to game state
    const localPlayerState = this.gameState.getLocalPlayer();
    if (localPlayerState) {
      localPlayerState.position.copy(this.localPlayer.position);
      localPlayerState.rotation.copy(this.localPlayer.rotation);
      localPlayerState.velocity.copy(this.localPlayer.velocity);
      localPlayerState.isEating = this.localPlayer.isEating;
      localPlayerState.weight = this.getPlayerWeight(this.localPlayer);
      localPlayerState.energy = this.getPlayerEnergy(this.localPlayer);
    }

    // Update food spawner
    if (this.foodSpawner) {
      this.foodSpawner.update(fixedDelta);
      this.syncFoodStateToGameState();
    }

    // Update NPCs
    if (this.npcSpawner && this.gameState.roundState === RoundState.PLAYING) {
      const hawkCandidates = this.localPlayer.role === PlayerRole.HAWK
        ? [this.localPlayer, ...this.getHawkPlayers().map((entry) => entry.player)]
        : this.getHawkPlayers().map((entry) => entry.player);
      const hawkPlayer = hawkCandidates.length > 0
        ? hawkCandidates.reduce((closest, current) => {
          const closestDistance = this.distance2D(closest.position, this.localPlayer!.position);
          const currentDistance = this.distance2D(current.position, this.localPlayer!.position);
          return currentDistance < closestDistance ? current : closest;
        })
        : null;
      const buildingBounds = this.environment
        ? this.environment.buildings.map((building) => ({ min: building.min, max: building.max }))
        : [];
      this.npcSpawner.update(fixedDelta, hawkPlayer?.position ?? null, buildingBounds);
      this.syncNPCStateToGameState();
    }

    // Check game events (collisions, round timer)
    this.checkGameEvents();
  }

  /**
   * Update visual representations (called once per render frame on host)
   */
  private updateVisuals(): void {
    if (!this.localPlayer) return;

    // Update mesh positions for all players
    this.localPlayer.mesh.position.copy(this.localPlayer.position);
    this.localPlayer.applyMeshRotation();

    for (const [, remotePlayer] of this.remotePlayers) {
      remotePlayer.mesh.position.copy(remotePlayer.position);
      remotePlayer.applyMeshRotation();
    }
  }

  /**
   * Client update with smooth prediction and interpolation
   */
  private updateClient(deltaTime: number, input: InputState): void {
    if (!this.gameState || !this.localPlayer || !this.networkManager) return;

    // CLIENT-SIDE PREDICTION: Update local player smoothly for responsiveness
    this.flightController.applyInput(this.localPlayer, input, deltaTime);
    this.localPlayer.update(deltaTime);

    if (this.environment) {
      this.environment.checkAndResolveCollisions(
        this.localPlayer.position,
        this.localPlayer.radius,
        this.localPlayer.velocity
      );
      if (this.localPlayer.role === PlayerRole.HAWK) {
        this.environment.applyHawkCanopySlow(
          this.localPlayer.position,
          this.localPlayer.radius,
          this.localPlayer.velocity,
          deltaTime
        );
      }
    }

    // Update visuals for feedback (not authoritative)
    this.updateRoleStats(this.localPlayer, deltaTime, false);

    // Sync local player to game state (for UI display)
    const localPlayerState = this.gameState.getLocalPlayer();
    if (localPlayerState) {
      localPlayerState.position.copy(this.localPlayer.position);
      localPlayerState.rotation.copy(this.localPlayer.rotation);
      localPlayerState.velocity.copy(this.localPlayer.velocity);
    }

    // Send input to host
    this.networkManager.sendInputUpdate(input);

    // Handle disconnected players
    this.networkManager.consumeStalePeerRemovals().forEach((peerId) => {
      this.removeRemotePlayer(peerId);
    });

    // SIMPLE INTERPOLATION: Smoothly interpolate remote players from host positions
    for (const [peerId, remotePlayer] of this.remotePlayers) {
      const interpolated = this.networkManager.getInterpolatedRemoteState(peerId);
      if (interpolated) {
        const distanceError = remotePlayer.position.distanceTo(interpolated.position);

        // Hard snap only for very large errors (across map)
        if (distanceError > 20) {
          remotePlayer.position.copy(interpolated.position);
          remotePlayer.rotation.copy(interpolated.rotation);
          remotePlayer.velocity.copy(interpolated.velocity);
        } else {
          // Smooth lerp for normal movement
          const alpha = Math.min(1, deltaTime / 0.15); // 150ms smooth time
          remotePlayer.position.lerp(interpolated.position, alpha);
          remotePlayer.velocity.lerp(interpolated.velocity, alpha);
          remotePlayer.rotation.x = THREE.MathUtils.lerp(remotePlayer.rotation.x, interpolated.rotation.x, alpha);
          remotePlayer.rotation.y = this.lerpAngle(remotePlayer.rotation.y, interpolated.rotation.y, alpha);
          remotePlayer.rotation.z = THREE.MathUtils.lerp(remotePlayer.rotation.z, interpolated.rotation.z, alpha);
        }
        remotePlayer.isEating = interpolated.isEating;
      }

      remotePlayer.mesh.position.copy(remotePlayer.position);
      remotePlayer.applyMeshRotation();
    }

    this.syncVisualStatsFromGameState();
    this.syncFoodStateFromGameState();

    // Update NPCs visually (host sends authoritative state)
    if (this.npcSpawner) {
      this.syncNPCStateFromGameState();
      this.npcSpawner.updateVisuals(deltaTime);
    }

    // Update food spawner
    if (this.foodSpawner) {
      this.foodSpawner.update(deltaTime);
    }

    // GENTLE LOCAL CORRECTIONS: Only correct big errors from host authority
    this.gentleLocalPlayerCorrection(deltaTime);

    // Update sounds, camera, and HUD
    this.updateDiveSounds();
    this.cameraController.update(this.localPlayer.mesh, this.localPlayer.rotation, input.scrollDelta);
    this.updateHUD();
  }

  /**
   * Gentle local player correction from host authority (clients only)
   */
  private gentleLocalPlayerCorrection(deltaTime: number): void {
    if (!this.gameState || !this.localPlayer || !this.networkManager) return;

    const authoritative = this.networkManager.getLocalAuthoritativeState();
    if (!authoritative) return;

    const error = this.localPlayer.position.distanceTo(authoritative.position);

    // Only correct if error is significant (>3 units)
    if (error > 3) {
      // Gentle correction over time
      const correctionAlpha = Math.min(1, deltaTime / 0.5); // 500ms correction time
      this.localPlayer.position.lerp(authoritative.position, correctionAlpha);
      this.localPlayer.velocity.lerp(authoritative.velocity, correctionAlpha);

      // Hard snap if really far off (cross-platform desync)
      if (error > 20) {
        this.localPlayer.position.copy(authoritative.position);
        this.localPlayer.rotation.copy(authoritative.rotation);
        this.localPlayer.velocity.copy(authoritative.velocity);
      }
    }
  }

  /**
   * Check collisions and handle game events (host only, called from simulateStep)
   */
  private checkGameEvents(): void {
    if (!this.gameState || this.gameState.roundState !== RoundState.PLAYING) return;

    this.checkCollisions();

    // Check if round timer expired (pigeon survives)
    if (this.gameState.isRoundTimeUp()) {
      this.endRoundPigeonSurvived();
    }
  }

  /**
   * Update HUD display
   */
  private updateHUD(): void {
    if (!this.localPlayer) return;

    const roleDisplay = document.getElementById('role-display');
    if (roleDisplay) {
      const emoji = this.localPlayer.role === PlayerRole.PIGEON ? '🕊️' : '🦅';
      roleDisplay.textContent = `Role: ${this.localPlayer.role} ${emoji}`;
    }

    const isPigeon = this.localPlayer.role === PlayerRole.PIGEON;

    const weightDisplay = document.getElementById('weight-display');
    if (weightDisplay) {
      weightDisplay.style.display = isPigeon ? 'block' : 'none';
      if (isPigeon) {
        const weight = this.getPlayerWeight(this.localPlayer);
        const weightValue = document.getElementById('weight-value');
        if (weightValue) weightValue.textContent = weight.toFixed(1);
      }
    }

    const energyDisplay = document.getElementById('energy-display');
    if (energyDisplay) {
      energyDisplay.style.display = isPigeon ? 'none' : 'block';
      if (!isPigeon) {
        const energy = this.getPlayerEnergy(this.localPlayer);
        const energyValue = document.getElementById('energy-value');
        if (energyValue) energyValue.textContent = `${Math.round(energy)}`;
        const energyBar = document.getElementById('energy-bar');
        if (energyBar) energyBar.style.width = `${energy}%`;
      }
    }

    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay && this.gameState) {
      if (this.countdownActive) {
        timerDisplay.textContent = 'Time: Starting...';
      } else {
        const remaining = Math.max(0, Math.floor(this.gameState.getRemainingTime()));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        timerDisplay.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
    }

    const eatingIndicator = document.getElementById('eating-indicator');
    if (eatingIndicator) {
      eatingIndicator.style.display = this.localPlayer.isEating ? 'block' : 'none';
    }

    // Dive indicator (hawk only)
    const diveIndicator = document.getElementById('dive-indicator');
    if (diveIndicator) {
      const hawk = this.localHawk;
      diveIndicator.style.display = hawk && hawk.getIsDiving() ? 'block' : 'none';
    }

    // Flight attitude indicator — dot shows bank and pitch
    const flightDot = document.getElementById('flight-dot');
    if (flightDot) {
      const isPigeon = this.localPlayer.role === PlayerRole.PIGEON;
      const maxBank = isPigeon ? GAME_CONFIG.PIGEON_MAX_BANK_ANGLE : GAME_CONFIG.HAWK_MAX_BANK_ANGLE;
      const maxPitch = isPigeon ? GAME_CONFIG.PIGEON_MAX_PITCH : GAME_CONFIG.HAWK_MAX_PITCH;
      const bankPx = (this.localPlayer.rotation.z / maxBank) * 28;
      // Screen-space convention: up on screen = negative Y.
      // In flight convention here, negative pitch means nose down.
      // Invert for indicator so "nose down" moves the dot downward visually.
      const pitchPx = (-this.localPlayer.rotation.x / maxPitch) * 28;
      flightDot.style.transform = `translate(calc(-50% + ${bankPx}px), calc(-50% + ${pitchPx}px))`;
    }

    // Connection status dot
    const connectionDot = document.getElementById('connection-dot');
    if (connectionDot && this.peerConnection) {
      if (this.peerConnection.isConnected()) {
        connectionDot.style.background = '#44ff44';
      } else if (this.peerConnection.getIsReconnecting()) {
        connectionDot.style.background = '#ffaa00';
      } else {
        connectionDot.style.background = '#ff4444';
      }
    }
    const connectionText = document.getElementById('connection-text');
    if (connectionText && this.peerConnection && this.gameState) {
      if (this.gameState.isHost) {
        const connectedPeers = this.peerConnection.getRemotePeerIds().length;
        connectionText.textContent = connectedPeers > 0
          ? `Host live: ${connectedPeers} friend${connectedPeers === 1 ? '' : 's'} connected`
          : 'Host live: waiting for friends';
      } else {
        connectionText.textContent = this.peerConnection.isConnected()
          ? 'Connected to host'
          : (this.peerConnection.getIsReconnecting() ? 'Reconnecting...' : 'Disconnected');
      }
    }

    this.updateDebugConsole();
    this.updateNetworkStats();
  }

  private updateDebugConsole(): void {
    if (!this.debugConsoleEl) return;
    if (!this.gameState || !this.localPlayer) {
      this.debugConsoleEl.textContent = '';
      return;
    }

    const now = performance.now();
    if (now - this.lastDebugRefreshTime < 100) return;
    this.lastDebugRefreshTime = now;

    const localState = this.gameState.getLocalPlayer();
    const localError = localState
      ? localState.position.distanceTo(this.localPlayer.position)
      : 0;
    const remoteErrors = Array.from(this.remotePlayers.entries())
      .map(([peerId, remotePlayer]) => {
        const remoteState = this.gameState!.players.get(peerId);
        if (!remoteState) return 0;
        return remoteState.position.distanceTo(remotePlayer.position);
      });
    const maxRemoteError = remoteErrors.length > 0 ? Math.max(...remoteErrors) : 0;

    let foodMismatch = 0;
    let missingLocalFood = 0;
    let orphanLocalFood = 0;
    if (this.foodSpawner) {
      const localFoods = this.foodSpawner.getFoods();
      const localFoodMap = new Map(localFoods.map((food) => [food.id, food]));
      for (const [id, foodState] of this.gameState.foods) {
        const localFood = localFoodMap.get(id);
        if (!localFood) {
          missingLocalFood += 1;
          continue;
        }
        const stateRespawnTimer = foodState.respawnTimer ?? 0;
        if (
          localFood.exists !== foodState.exists ||
          Math.abs(localFood.respawnTimer - stateRespawnTimer) > 0.25
        ) {
          foodMismatch += 1;
        }
      }
      for (const localFood of localFoods) {
        if (!this.gameState.foods.has(localFood.id)) {
          orphanLocalFood += 1;
        }
      }
    }

    const connectionState = this.peerConnection?.isConnected()
      ? 'connected'
      : this.peerConnection?.getIsReconnecting()
        ? 'reconnecting'
        : 'disconnected';

    const lines: string[] = [
      `DEBUG (${this.gameState.isHost ? 'HOST' : 'CLIENT'})`,
      `Conn: ${connectionState}`,
      `Round: ${this.gameState.roundNumber} ${this.gameState.roundState}`,
      `Local ${this.localPlayer.role} p:${this.formatVec3(this.localPlayer.position)} v:${this.localPlayer.velocity.length().toFixed(2)}`,
      `Remotes: ${this.remotePlayers.size}`,
      `PosErr L:${localError.toFixed(2)} Rmax:${maxRemoteError.toFixed(2)}`,
      `Food local:${this.foodSpawner?.getFoods().length ?? 0} state:${this.gameState.foods.size}`,
      `Food mismatch:${foodMismatch} missing:${missingLocalFood} orphan:${orphanLocalFood}`,
      `NPC local:${this.npcSpawner?.getNPCs().length ?? 0} state:${this.gameState.npcs.size}`,
    ];

    this.debugConsoleEl.textContent = lines.join('\n');
  }

  private applyDebugConsoleVisibility(): void {
    if (!this.debugConsoleEl) return;
    this.debugConsoleEl.style.display = this.isGameStarted && this.debugConsoleVisible ? 'block' : 'none';
  }

  private applyNetworkStatsVisibility(): void {
    if (!this.networkStatsEl) return;
    this.networkStatsEl.style.display = this.isGameStarted && this.networkStatsVisible ? 'block' : 'none';
  }

  private updateNetworkStats(): void {
    if (!this.networkStatsEl || !this.networkManager) return;
    if (!this.gameState || this.gameState.isHost) {
      // Network stats only relevant for clients
      return;
    }

    const now = performance.now();
    if (now - this.lastNetworkStatsRefreshTime < 200) return; // Update 5 times per second
    this.lastNetworkStatsRefreshTime = now;

    // Get network stats from NetworkManager
    const stats = this.networkManager.getNetworkStats();

    // Update UI elements
    const bufferEl = document.getElementById('stat-buffer');
    const rttEl = document.getElementById('stat-rtt');
    const jitterEl = document.getElementById('stat-jitter');
    const playersEl = document.getElementById('stat-players');
    const snapshotsEl = document.getElementById('stat-snapshots');

    if (bufferEl) bufferEl.textContent = `${Math.round(stats.bufferMs)}ms`;
    if (rttEl) rttEl.textContent = `${Math.round(stats.rttMs)}ms`;
    if (jitterEl) jitterEl.textContent = `${Math.round(stats.jitterMs)}ms`;
    if (playersEl) playersEl.textContent = `${this.remotePlayers.size}`;
    if (snapshotsEl) snapshotsEl.textContent = `${stats.snapshotCount}`;
  }

  private formatVec3(value: THREE.Vector3): string {
    return `${value.x.toFixed(1)},${value.y.toFixed(1)},${value.z.toFixed(1)}`;
  }

  /**
   * Check for collisions (host only)
   */
  private checkCollisions(): void {
    if (!this.localPlayer || !this.gameState) return;

    const pigeon = this.getCurrentPigeon();
    const currentTick = this.networkManager?.getCurrentServerTick() ?? 0;
    const pigeonState = pigeon ? this.gameState.players.get(pigeon.peerId) : null;
    const pigeonProtected = pigeonState ? currentTick < pigeonState.spawnProtectionUntilTick : false;

    if (pigeon && !pigeonProtected) {
      for (const hawk of this.getHawkPlayers()) {
        const hawkState = this.gameState.players.get(hawk.peerId);
        if (!hawkState?.active) continue;
        const collision = this.collisionDetector.checkPlayerCollision(
          pigeon.player,
          hawk.player
        );
        if (collision) {
          this.endRound(hawk.peerId, pigeon.peerId);
          return;
        }
      }
    }

    if (this.foodSpawner) {
      this.checkFoodCollision(this.localPlayer, this.gameState.localPeerId);
      for (const [peerId, remotePlayer] of this.remotePlayers) {
        this.checkFoodCollision(remotePlayer, peerId);
      }
    }

    if (this.npcSpawner) {
      if (this.localPlayer.role === PlayerRole.HAWK) {
        this.checkNPCCollision(this.localPlayer, this.gameState.localPeerId);
      }
      for (const [peerId, remotePlayer] of this.remotePlayers) {
        if (remotePlayer.role === PlayerRole.HAWK) {
          this.checkNPCCollision(remotePlayer, peerId);
        }
      }
    }
  }

  /**
   * End the current round
   */
  private endRound(killerPeerId: string, victimPeerId: string): void {
    if (!this.gameState) return;

    const pigeonPlayer = this.getPlayerByPeerId(victimPeerId);
    if (!pigeonPlayer) return;

    const pigeonWeight = this.getPlayerWeight(pigeonPlayer);
    const survivalTime = this.gameState.getRoundTime();

    // Update cumulative scores
    this.gameState.scores.pigeon.totalWeight += pigeonWeight;
    this.gameState.scores.hawk.roundsWon += 1;
    this.gameState.scores.hawk.killTimes.push(survivalTime);

    // End the round
    this.nextPigeonPeerId = killerPeerId;
    this.gameState.endRound();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();
    this.setControlsEnabled(false);

    // Send death event to clients (host only)
    if (this.gameState.isHost && this.networkManager) {
      this.networkManager.sendPlayerDeath(victimPeerId, killerPeerId, pigeonWeight, survivalTime);
    }

    // Play hawk catch sounds
    AudioManager.play(SFX.HAWK_SCREECH, 'sfx');
    AudioManager.play(SFX.HAWK_WINS, 'sfx');

    // Show score screen
    this.inputManager.hideTouchControls();
    const bestCallouts = this.updatePersonalBestsForRound('hawk', pigeonWeight, survivalTime);
    this.scoreUI.showRoundEnd(
      'hawk',
      pigeonWeight,
      survivalTime,
      this.gameState.scores.pigeon,
      this.gameState.scores.hawk,
      this.createRoundEndOptions(bestCallouts)
    );
    this.submitLocalLeaderboardResult('hawk', pigeonWeight, survivalTime);

    // Release pointer lock
    this.inputManager.releasePointerLock();
  }

  /**
   * End the round because timer expired (pigeon survived, host only)
   */
  private endRoundPigeonSurvived(): void {
    if (!this.gameState) return;

    const pigeon = this.getCurrentPigeon();
    if (!pigeon) {
      if (this.gameState.isHost) {
        this.handleInsufficientPlayers('missing pigeon');
      }
      return;
    }

    const pigeonWeight = this.getPlayerWeight(pigeon.player);
    const survivalTime = this.gameState.roundDuration;

    // Update cumulative scores
    this.gameState.scores.pigeon.totalWeight += pigeonWeight;
    this.gameState.scores.pigeon.roundsWon += 1;

    // End the round
    this.nextPigeonPeerId = pigeon.peerId;
    this.gameState.endRound();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();
    this.setControlsEnabled(false);

    // Send round end event to client
    if (this.networkManager) {
      this.networkManager.sendRoundEnd('pigeon', pigeonWeight, survivalTime);
    }

    // Play pigeon-wins sound
    AudioManager.play(SFX.PIGEON_WINS, 'sfx');

    // Show score screen
    this.inputManager.hideTouchControls();
    const bestCallouts = this.updatePersonalBestsForRound('pigeon', pigeonWeight, survivalTime);
    this.scoreUI.showRoundEnd(
      'pigeon',
      pigeonWeight,
      survivalTime,
      this.gameState.scores.pigeon,
      this.gameState.scores.hawk,
      this.createRoundEndOptions(bestCallouts)
    );
    this.submitLocalLeaderboardResult('pigeon', pigeonWeight, survivalTime);

    this.inputManager.releasePointerLock();
  }

  /**
   * Handle round end network event (client only, e.g. timer expired)
   */
  private handleRoundEnd(message: RoundEndMessage): void {
    if (this.gameState?.isHost) return;
    if (!this.gameState) return;

    const { winner, pigeonWeight, survivalTime } = message;

    // Update scores on client
    if (winner === 'pigeon' || winner === 'hawk') {
      this.gameState.scores.pigeon.totalWeight += pigeonWeight;
    }
    if (winner === 'pigeon') {
      this.gameState.scores.pigeon.roundsWon += 1;
    } else if (winner === 'hawk') {
      this.gameState.scores.hawk.roundsWon += 1;
      this.gameState.scores.hawk.killTimes.push(survivalTime);
    }

    this.gameState.endRound();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();
    this.setControlsEnabled(false);

    // Play round-end sounds on client
    if (winner === 'hawk') {
      AudioManager.play(SFX.HAWK_SCREECH, 'sfx');
      AudioManager.play(SFX.HAWK_WINS, 'sfx');
    } else if (winner === 'pigeon') {
      AudioManager.play(SFX.PIGEON_WINS, 'sfx');
    }

    if (winner === 'insufficient_players') {
      this.gameState.roundState = RoundState.WAITING_FOR_PLAYERS;
      this.showEventPopup('Round paused: not enough players', 'warn');
      return;
    }

    this.inputManager.hideTouchControls();
    const bestCallouts = this.updatePersonalBestsForRound(winner === 'pigeon' ? 'pigeon' : 'hawk', pigeonWeight, survivalTime);
    this.scoreUI.showRoundEnd(
      winner === 'pigeon' ? 'pigeon' : 'hawk',
      pigeonWeight,
      survivalTime,
      this.gameState.scores.pigeon,
      this.gameState.scores.hawk,
      this.createRoundEndOptions(bestCallouts)
    );
    this.submitLocalLeaderboardResult(winner === 'pigeon' ? 'pigeon' : 'hawk', pigeonWeight, survivalTime);

    this.inputManager.releasePointerLock();
  }

  private handleJoinRequest(_message: JoinRequestMessage, peerId: string): void {
    if (!this.gameState || !this.networkManager || !this.gameState.isHost) return;

    if (this.gameState.players.size >= GAME_CONFIG.MAX_PLAYERS) {
      this.networkManager.sendJoinDeny(peerId, 'room_full');
      this.peerConnection?.closePeer(peerId);
      return;
    }

    const spawn = this.getRemoteSpawnPosition(this.remotePlayers.size, this.remotePlayers.size + 1);
    const playerState = this.gameState.players.get(peerId)
      ?? this.gameState.addPlayer(peerId, PlayerRole.HAWK, spawn);
    playerState.role = PlayerRole.HAWK;
    playerState.position.copy(spawn);
    playerState.rotation.set(0, Math.PI, 0);
    playerState.velocity.set(0, 0, 0);
    playerState.active = false;

    this.ensureRemotePlayer(peerId, PlayerRole.HAWK, spawn, Math.PI);
    this.gameState.setPlayerConnectionState(peerId, PlayerConnectionState.SYNCING, false);

    this.networkManager.sendJoinAccept(
      peerId,
      PlayerRole.HAWK,
      this.gameState.worldSeed,
      this.gameState.roundState,
      this.gameState.roundNumber
    );
    this.networkManager.sendFullStateSnapshot(peerId, this.networkManager.buildFullStateSnapshotPayload());
    this.showEventPopup('Player syncing into match...', 'warn');
  }

  private handleJoinReady(_message: JoinReadyMessage, peerId: string): void {
    if (!this.gameState || !this.networkManager || !this.gameState.isHost) return;

    const playerState = this.gameState.players.get(peerId);
    if (!playerState) return;

    this.networkManager.activatePeer(peerId);
    playerState.active = true;

    // Lock newly joined hawk input briefly to avoid instant collision artifacts.
    const currentTick = this.networkManager.getCurrentServerTick();
    const lockUntilTick = currentTick + Math.ceil(GAME_CONFIG.HAWK_INPUT_LOCK_SECONDS * GAME_CONFIG.TICK_RATE);
    this.gameState.setInputLock(peerId, lockUntilTick);

    if (this.gameState.roundState === RoundState.PLAYING) {
      const pigeon = this.getCurrentPigeon();
      const existingHawks = this.getHawkPlayers()
        .filter((entry) => entry.peerId !== peerId)
        .map((entry) => entry.player.position.clone());
      const spawn = this.getSafeHawkSpawn(
        pigeon?.player.position.clone() ?? this.getSpawnPositions().local,
        existingHawks
      );
      const remotePlayer = this.getPlayerByPeerId(peerId);
      if (remotePlayer) {
        remotePlayer.position.copy(spawn);
        remotePlayer.rotation.set(0, Math.PI, 0);
        remotePlayer.velocity.set(0, 0, 0);
        remotePlayer.mesh.position.copy(remotePlayer.position);
        remotePlayer.applyMeshRotation();
      }
      playerState.position.copy(spawn);
      playerState.rotation.set(0, Math.PI, 0);
      playerState.velocity.set(0, 0, 0);
    }

    const roles: { [peerId: string]: PlayerRole } = {};
    const spawnStates: RoleAssignmentMessage['spawnStates'] = {};
    const activePeers: string[] = [];
    const inputLockedUntilTick: { [peerId: string]: number } = {};
    this.gameState.players.forEach((state, id) => {
      roles[id] = state.role;
      if (state.active) activePeers.push(id);
      inputLockedUntilTick[id] = state.inputLockedUntilTick;
      spawnStates[id] = {
        position: { x: state.position.x, y: state.position.y, z: state.position.z },
        rotation: { x: state.rotation.x, y: state.rotation.y, z: state.rotation.z },
        velocity: { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z },
      };
    });

    this.networkManager.sendRoleAssignment(roles, {
      activePeers,
      spawnStates,
      reason: 'join_activated',
      inputLockedUntilTick,
    });

    this.syncRoleControllers();
    this.tryStartRoundIfReady();
    this.showEventPopup('Player joined match', 'good');
  }

  private handleJoinAccept(message: JoinAcceptMessage): void {
    if (!this.gameState || this.gameState.isHost) return;

    this.gameState.worldSeed = message.worldSeed;
    this.gameState.roundState = message.roundState;
    this.gameState.roundNumber = message.roundNumber;
    this.lobbyUI.showWaiting('Syncing full match state...');
  }

  private handleJoinDeny(message: JoinDenyMessage): void {
    if (!this.gameState || this.gameState.isHost) return;

    this.setControlsEnabled(false);
    const reason = message.reason === 'room_full'
      ? 'Room is full'
      : message.reason === 'version_mismatch'
        ? 'Version mismatch'
        : message.reason === 'match_locked'
          ? 'Match is locked'
          : 'Join timed out';
    this.lobbyUI.showError(`${reason}. Try another invite.`);
    this.lobbyUI.show();
    this.peerConnection?.disconnect();
  }

  private handleFullSnapshotApplied(snapshotId: string, payload: FullStatePayload): void {
    if (!this.gameState || !this.networkManager || this.gameState.isHost) return;
    if (!this.localPlayer) return;

    const localState = payload.players[this.gameState.localPeerId];
    if (localState) {
      this.localPlayer.role = localState.role;
      this.localPlayer.position.set(localState.position.x, localState.position.y, localState.position.z);
      this.localPlayer.rotation.set(localState.rotation.x, localState.rotation.y, localState.rotation.z);
      this.localPlayer.velocity.set(localState.velocity.x, localState.velocity.y, localState.velocity.z);
      this.localPlayer.mesh.position.copy(this.localPlayer.position);
      this.localPlayer.applyMeshRotation();
      this.swapPlayerModel(this.localPlayer);

      const gameStateLocal = this.gameState.players.get(this.gameState.localPeerId);
      if (gameStateLocal) {
        gameStateLocal.role = localState.role;
        gameStateLocal.position.copy(this.localPlayer.position);
        gameStateLocal.rotation.copy(this.localPlayer.rotation);
        gameStateLocal.velocity.copy(this.localPlayer.velocity);
      }
    }

    this.syncRemotePlayersFromGameState();
    this.syncRoleControllers();
    this.syncFoodStateFromGameState();
    this.syncNPCStateFromGameState();
    this.networkManager.resetRemoteInput();
    this.setControlsEnabled(false);
    this.networkManager.sendJoinReady(snapshotId);
    this.lobbyUI.showWaiting('Waiting for host activation...');
  }

  private handleRoleAssignment(message: RoleAssignmentMessage): void {
    if (!this.gameState || !this.localPlayer) return;

    for (const peerId of Array.from(this.gameState.players.keys())) {
      if (!(peerId in message.roles)) {
        this.gameState.players.delete(peerId);
      }
    }

    Object.entries(message.roles).forEach(([peerId, role]) => {
      const state = this.gameState!.players.get(peerId)
        ?? this.gameState!.addPlayer(peerId, role, this.getSpawnPositions().remote.clone());
      state.role = role;
    });

    if (message.spawnStates) {
      Object.entries(message.spawnStates).forEach(([peerId, spawn]) => {
        const state = this.gameState!.players.get(peerId);
        if (!state) return;
        state.position.set(spawn.position.x, spawn.position.y, spawn.position.z);
        state.rotation.set(spawn.rotation.x, spawn.rotation.y, spawn.rotation.z);
        state.velocity.set(spawn.velocity.x, spawn.velocity.y, spawn.velocity.z);
      });
    }

    if (message.spawnProtectionUntilTick) {
      Object.entries(message.spawnProtectionUntilTick).forEach(([peerId, tick]) => {
        this.gameState!.setSpawnProtection(peerId, tick);
      });
    }

    if (message.inputLockedUntilTick) {
      Object.entries(message.inputLockedUntilTick).forEach(([peerId, tick]) => {
        this.gameState!.setInputLock(peerId, tick);
      });
    }

    const localRole = message.roles[this.gameState.localPeerId];
    if (localRole && this.localPlayer.role !== localRole) {
      this.localPlayer.role = localRole;
      this.swapPlayerModel(this.localPlayer);
    }

    this.syncRemotePlayersFromGameState();
    this.gameState.players.forEach((state, peerId) => {
      const player = this.getPlayerByPeerId(peerId);
      if (!player) return;
      player.role = state.role;
      if (message.spawnStates && message.spawnStates[peerId]) {
        const spawn = message.spawnStates[peerId];
        player.position.set(spawn.position.x, spawn.position.y, spawn.position.z);
        player.rotation.set(spawn.rotation.x, spawn.rotation.y, spawn.rotation.z);
        player.velocity.set(spawn.velocity.x, spawn.velocity.y, spawn.velocity.z);
        player.mesh.position.copy(player.position);
        player.applyMeshRotation();
      }
      this.swapPlayerModel(player);
    });
    this.syncRoleControllers();

    if (!this.gameState.isHost) {
      const localIsActive = message.activePeers
        ? message.activePeers.includes(this.gameState.localPeerId)
        : true;
      if (localIsActive && !this.countdownActive && this.gameState.roundState === RoundState.PLAYING) {
        this.setControlsEnabled(true);
        this.lobbyUI.hide();
      }
    }
  }

  private handlePlayerLeft(message: PlayerLeftMessage): void {
    if (!this.gameState) return;

    this.removeRemotePlayer(message.peerId);
    if (this.gameState.remotePeerId === message.peerId) {
      const fallback = Array.from(this.remotePlayers.keys())[0] ?? null;
      this.gameState.remotePeerId = fallback;
    }

    if (!this.gameState.isHost) {
      this.showEventPopup('A player left the match', 'warn');
    }
    this.tryStartRoundIfReady();
  }

  private handleHostTerminating(message: HostTerminatingMessage): void {
    if (this.gameState?.isHost) return;
    this.setControlsEnabled(false);
    this.inputManager.hideTouchControls();

    const overlay = document.getElementById('disconnect-overlay');
    if (overlay) overlay.style.display = 'block';
    const status = document.getElementById('disconnect-status');
    if (status) status.textContent = `Host ended match: ${message.reason}`;
  }

  /**
   * Start next round flow (host only).
   */
  private startNextRound(): void {
    if (!this.gameState || !this.localPlayer) return;

    // Only host should execute this directly from UI
    // Client waits for ROUND_START message
    if (!this.gameState.isHost) {
      console.log('Client waiting for round start from host...');
      return;
    }

    if (this.gameState.getActivePlayerCount() < 2) {
      this.gameState.roundState = RoundState.WAITING_FOR_PLAYERS;
      this.setControlsEnabled(false);
      this.showEventPopup('Waiting for at least 2 active players...', 'warn');
      return;
    }

    // Choose next pigeon: killing hawk becomes pigeon, otherwise keep prior pigeon.
    let nextPigeonPeerId = this.nextPigeonPeerId;
    const activePeerIds = Array.from(this.gameState.players.values())
      .filter((player) => player.active)
      .map((player) => player.peerId);
    if (!nextPigeonPeerId || !activePeerIds.includes(nextPigeonPeerId)) {
      const currentPigeon = Array.from(this.gameState.players.values())
        .find((p) => p.role === PlayerRole.PIGEON && p.active);
      nextPigeonPeerId = currentPigeon?.peerId ?? this.gameState.getLowestJoinOrderActiveHawk() ?? this.gameState.localPeerId;
    }
    this.gameState.assignRolesForNextRound(nextPigeonPeerId);
    this.nextPigeonPeerId = null;

    this.syncRemotePlayersFromGameState();
    this.gameState.players.forEach((playerState, peerId) => {
      const player = this.getPlayerByPeerId(peerId);
      if (!player) return;
      player.role = playerState.role;
      this.swapPlayerModel(player);
    });

    const spawnStates = this.buildSpawnStateForAllPlayers();

    this.syncRoleControllers();
    this.resetRoleStats();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();
    if (this.foodSpawner) {
      this.foodSpawner.resetAll();
      this.syncFoodStateToGameState();
    }
    if (this.npcSpawner) {
      this.npcSpawner.resetAll();
      this.syncNPCStateToGameState();
    }

    this.launchRoundCountdown(spawnStates);
  }

  private launchRoundCountdown(spawnStates: RoundStartMessage['spawnStates']): void {
    if (!this.gameState) return;

    const nextRoundNumber = this.gameState.roundNumber + 1;
    const roundStartAt = Date.now() + (this.roundCountdownSeconds * 1000);
    const roles: { [peerId: string]: PlayerRole } = {};
    const spawnProtectionUntilTick: { [peerId: string]: number } = {};
    const inputLockedUntilTick: { [peerId: string]: number } = {};

    this.gameState.players.forEach((playerState, peerId) => {
      if (!playerState.active) return;
      roles[peerId] = playerState.role;
      spawnProtectionUntilTick[peerId] = playerState.spawnProtectionUntilTick;
      inputLockedUntilTick[peerId] = playerState.inputLockedUntilTick;
    });

    if (this.networkManager) {
      this.networkManager.sendRoundStart(
        nextRoundNumber,
        roundStartAt,
        this.roundCountdownSeconds,
        roles,
        spawnStates,
        spawnProtectionUntilTick,
        inputLockedUntilTick
      );
    }

    this.runRoundCountdown(nextRoundNumber, roundStartAt, this.roundCountdownSeconds);
  }

  private runRoundCountdown(roundNumber: number, roundStartAt: number, countdownSeconds: number): void {
    this.clearRoundCountdownState();
    this.lobbyUI.showPersonalBestBadge(false);
    this.countdownActive = true;
    this.setControlsEnabled(false);
    this.inputManager.resetInputState();
    this.inputManager.showTouchControls();
    this.networkManager?.resetRemoteInput();

    const overlay = document.getElementById('round-countdown');
    const valueEl = document.getElementById('round-countdown-value');
    const labelEl = document.getElementById('round-countdown-label');

    if (overlay) overlay.style.display = 'flex';
    if (labelEl) labelEl.textContent = 'Get ready';

    let started = false;
    const tick = () => {
      const msRemaining = roundStartAt - Date.now();
      if (msRemaining <= 0) {
        if (!started) {
          started = true;
          if (valueEl) valueEl.textContent = 'GO';
          if (labelEl) labelEl.textContent = 'Round live';
          this.finishRoundCountdown(roundNumber);
        }
        return;
      }

      const secondsLeft = Math.min(countdownSeconds, Math.max(1, Math.ceil(msRemaining / 1000)));
      if (valueEl) valueEl.textContent = `${secondsLeft}`;
      if (labelEl) labelEl.textContent = 'Get ready';
    };

    tick();
    this.countdownIntervalId = window.setInterval(tick, 100);
  }

  private finishRoundCountdown(roundNumber: number): void {
    if (!this.gameState) return;

    if (this.countdownIntervalId !== null) {
      window.clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }

    this.gameState.roundNumber = Math.max(0, roundNumber - 1);
    this.gameState.startRound();
    this.countdownActive = false;
    this.setControlsEnabled(true);
    AudioManager.play(SFX.ROUND_START, 'sfx');

    this.countdownHideTimeoutId = window.setTimeout(() => {
      const overlay = document.getElementById('round-countdown');
      if (overlay) overlay.style.display = 'none';
      const valueEl = document.getElementById('round-countdown-value');
      if (valueEl) valueEl.textContent = `${this.roundCountdownSeconds}`;
      const labelEl = document.getElementById('round-countdown-label');
      if (labelEl) labelEl.textContent = 'Get ready';
      this.countdownHideTimeoutId = null;
    }, 450);
  }

  private clearRoundCountdownState(): void {
    if (this.countdownIntervalId !== null) {
      window.clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
    if (this.countdownHideTimeoutId !== null) {
      window.clearTimeout(this.countdownHideTimeoutId);
      this.countdownHideTimeoutId = null;
    }
    const overlay = document.getElementById('round-countdown');
    if (overlay) overlay.style.display = 'none';
    this.countdownActive = false;
  }

  /**
   * Configure role stat controllers after role changes.
   */
  private syncRoleControllers(): void {
    if (!this.localPlayer) return;

    // Clear role-specific visual/physics leftovers before re-attaching controllers.
    this.localPlayer.setVisualScale(1);
    this.localPlayer.speedMultiplier = 1;
    this.remotePigeons.clear();
    this.remoteHawks.clear();
    for (const remotePlayer of this.remotePlayers.values()) {
      remotePlayer.setVisualScale(1);
      remotePlayer.speedMultiplier = 1;
    }

    this.localPigeon = this.localPlayer.role === PlayerRole.PIGEON ? new Pigeon(this.localPlayer) : null;
    this.localHawk = this.localPlayer.role === PlayerRole.HAWK ? new Hawk(this.localPlayer) : null;
    for (const [peerId, remotePlayer] of this.remotePlayers) {
      if (remotePlayer.role === PlayerRole.PIGEON) {
        this.remotePigeons.set(peerId, new Pigeon(remotePlayer));
      } else {
        this.remoteHawks.set(peerId, new Hawk(remotePlayer));
      }
    }
  }

  /**
   * Update per-role stats on host.
   */
  private updateRoleStats(player: Player, deltaTime: number, authoritative: boolean): void {
    const peerId = this.getPeerIdForPlayer(player);
    if (!peerId || !this.gameState) return;
    const hawk = peerId === this.gameState.localPeerId
      ? this.localHawk
      : (this.remoteHawks.get(peerId) ?? null);
    // Only update hawk energy when authoritative to prevent desync
    if (hawk && authoritative) {
      hawk.update(deltaTime, true);
    }
  }

  /**
   * Reset all role stats for a new round.
   */
  private resetRoleStats(): void {
    this.localPigeon?.reset();
    this.localHawk?.reset();
    this.remotePigeons.forEach((pigeon) => pigeon.reset());
    this.remoteHawks.forEach((hawk) => hawk.reset());
  }

  /**
   * Check food collisions for a specific player (host only).
   */
  private checkFoodCollision(player: Player, playerId: string): void {
    if (!this.foodSpawner || !this.networkManager) return;
    const networkManager = this.networkManager;

    this.foodSpawner.getFoods().forEach((food) => {
      if (!food.exists) return;
      if (player.role === PlayerRole.PIGEON && food.type === FoodType.RAT) return;
      if (player.role === PlayerRole.HAWK && food.type !== FoodType.RAT) return;

      const hit = this.collisionDetector.checkSpherePointCollision(
        player.position,
        player.radius + food.radius,
        food.position
      );

      if (!hit) return;

      food.collect();
      player.startEating(food.eatTime);
      this.applyFoodEffect(player, food.type, food.weightGain, food.energyGain);
      this.syncFoodStateToGameState();
      networkManager.sendFoodCollected(food.id, playerId, food.exists, food.respawnTimer);

      // Play eating sound (host plays for local player only; client plays via handleFoodCollected)
      if (player === this.localPlayer) {
        this.playEatSound(food.type);
        this.showFoodPopup(food.type, food.weightGain, food.energyGain);
      }
    });
  }

  /**
   * Check NPC collisions for hawk players (host only).
   */
  private checkNPCCollision(player: Player, playerId: string): void {
    if (!this.npcSpawner || !this.networkManager) return;
    if (player.role !== PlayerRole.HAWK) return;

    for (const npc of this.npcSpawner.getNPCs()) {
      if (!npc.exists) continue;

      const hit = this.collisionDetector.checkSpherePointCollision(
        player.position,
        player.radius + npc.radius,
        npc.position
      );
      if (!hit) continue;

      const respawnTime = npc.getRespawnTime();
      const killed = this.npcSpawner!.killNPC(npc.id, respawnTime);
      if (!killed) continue;

      player.startEating(killed.getEatTime());

      const peerId = this.getPeerIdForPlayer(player);
      const hawk = !peerId || !this.gameState
        ? null
        : (peerId === this.gameState.localPeerId ? this.localHawk : (this.remoteHawks.get(peerId) ?? null));
      hawk?.addEnergy(killed.getEnergyReward());

      this.syncNPCStateToGameState();
      this.networkManager!.sendNPCKilled(
        killed.id,
        playerId,
        killed.type,
        false,
        respawnTime
      );

      // Play kill sound for local hawk
      if (player === this.localPlayer) {
        AudioManager.play(SFX.NPC_KILL, 'sfx');
        this.showEventPopup(`NPC caught +${killed.getEnergyReward().toFixed(0)} energy`, 'good');
      }
      break;
    }
  }

  /**
   * Apply food effects to the role controller.
   */
  private applyFoodEffect(player: Player, foodType: FoodType, weightGain: number, energyGain: number): void {
    const peerId = this.getPeerIdForPlayer(player);
    if (!peerId || !this.gameState) return;

    if (player.role === PlayerRole.PIGEON && foodType !== FoodType.RAT) {
      const pigeon = peerId === this.gameState.localPeerId
        ? this.localPigeon
        : (this.remotePigeons.get(peerId) ?? null);
      pigeon?.addWeight(weightGain);
      return;
    }

    if (player.role === PlayerRole.HAWK && foodType === FoodType.RAT) {
      const hawk = peerId === this.gameState.localPeerId
        ? this.localHawk
        : (this.remoteHawks.get(peerId) ?? null);
      hawk?.addEnergy(energyGain);
    }
  }

  private getNPCEatTime(type: NPCType): number {
    switch (type) {
      case NPCType.PIGEON:
        return GAME_CONFIG.NPC_PIGEON_EAT_TIME;
      case NPCType.SQUIRREL:
        return GAME_CONFIG.NPC_SQUIRREL_EAT_TIME;
      case NPCType.RAT:
      default:
        return GAME_CONFIG.NPC_RAT_EAT_TIME;
    }
  }

  private getNPCEnergyReward(type: NPCType): number {
    switch (type) {
      case NPCType.PIGEON:
        return GAME_CONFIG.NPC_PIGEON_ENERGY;
      case NPCType.SQUIRREL:
        return GAME_CONFIG.NPC_SQUIRREL_ENERGY;
      case NPCType.RAT:
      default:
        return GAME_CONFIG.NPC_RAT_ENERGY;
    }
  }

  /**
   * Copy food state from spawner to authoritative game state.
   */
  private syncFoodStateToGameState(): void {
    if (!this.gameState || !this.foodSpawner) return;

    this.foodSpawner.getFoods().forEach((food) => {
      const state = this.gameState!.foods.get(food.id);
      if (!state) {
        this.gameState!.addFood(food.id, food.type, food.position);
      }
      const updated = this.gameState!.foods.get(food.id);
      if (updated) {
        updated.exists = food.exists;
        updated.respawnTimer = food.respawnTimer;
      }
    });
  }

  /**
   * Copy food state from networked game state into local visuals.
   */
  private syncFoodStateFromGameState(): void {
    if (!this.gameState || !this.foodSpawner) return;

    this.gameState.foods.forEach((foodState) => {
      this.foodSpawner!.setFoodState(foodState.id, foodState.exists, foodState.respawnTimer);
    });
  }

  /**
   * Copy NPC state from spawner to authoritative game state.
   */
  private syncNPCStateToGameState(): void {
    if (!this.gameState || !this.npcSpawner) return;

    this.gameState.setNPCSnapshots(
      this.npcSpawner.getSnapshots().map((snapshot) => ({
        id: snapshot.id,
        type: snapshot.type,
        position: new THREE.Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z),
        rotation: snapshot.rotation,
        state: snapshot.state,
        exists: snapshot.exists,
        respawnTimer: snapshot.respawnTimer ?? 0,
      }))
    );
  }

  /**
   * Copy NPC state from game state into local visuals.
   */
  private syncNPCStateFromGameState(): void {
    if (!this.gameState || !this.npcSpawner) return;

    this.npcSpawner.applySnapshots(
      Array.from(this.gameState.npcs.values()).map((npc) => ({
        id: npc.id,
        type: npc.type,
        position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
        rotation: npc.rotation,
        state: npc.state,
        exists: npc.exists,
        respawnTimer: npc.respawnTimer ?? 0,
      }))
    );
  }

  /**
   * Copy weight/energy values from game state to local controllers.
   */
  private syncVisualStatsFromGameState(): void {
    if (!this.gameState || !this.localPlayer) return;

    this.gameState.players.forEach((playerState, peerId) => {
      const player = this.getPlayerByPeerId(peerId);
      if (!player) return;

      if (playerState.weight !== undefined) {
        this.setPlayerWeight(player, playerState.weight);
      }
      if (playerState.energy !== undefined) {
        this.setPlayerEnergy(player, playerState.energy);
      }
    });
  }

  private getPigeonController(player: Player): Pigeon | null {
    if (!this.gameState) return null;
    const peerId = this.getPeerIdForPlayer(player);
    if (!peerId) return null;
    return peerId === this.gameState.localPeerId
      ? this.localPigeon
      : (this.remotePigeons.get(peerId) ?? null);
  }

  private getHawkController(player: Player): Hawk | null {
    if (!this.gameState) return null;
    const peerId = this.getPeerIdForPlayer(player);
    if (!peerId) return null;
    return peerId === this.gameState.localPeerId
      ? this.localHawk
      : (this.remoteHawks.get(peerId) ?? null);
  }

  private setPlayerWeight(player: Player, weight: number): void {
    const pigeon = this.getPigeonController(player);
    pigeon?.setWeight(weight);
  }

  private setPlayerEnergy(player: Player, energy: number): void {
    const hawk = this.getHawkController(player);
    hawk?.setEnergy(energy);
  }

  private getPlayerWeight(player: Player): number {
    const pigeon = this.getPigeonController(player);
    return pigeon ? pigeon.getWeight() : 1;
  }

  private getPlayerEnergy(player: Player): number {
    const hawk = this.getHawkController(player);
    return hawk ? hawk.getEnergy() : 0;
  }

  private buildSpawnStateForAllPlayers(): {
    [peerId: string]: {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
    };
  } {
    if (!this.gameState) return {};

    const spawnStates: {
      [peerId: string]: {
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
        velocity: { x: number; y: number; z: number };
      };
    } = {};

    const activePlayers = Array.from(this.gameState.players.entries())
      .filter(([, playerState]) => playerState.active);
    if (activePlayers.length === 0) {
      return spawnStates;
    }

    let pigeonPeerId = activePlayers.find(([, playerState]) => playerState.role === PlayerRole.PIGEON)?.[0]
      ?? activePlayers[0][0];
    if (!this.gameState.players.has(pigeonPeerId)) {
      pigeonPeerId = this.gameState.localPeerId;
    }

    const hawkIds = activePlayers
      .map(([peerId]) => peerId)
      .filter((peerId) => peerId !== pigeonPeerId)
      .sort((a, b) => {
        const aState = this.gameState!.players.get(a);
        const bState = this.gameState!.players.get(b);
        return (aState?.joinOrder ?? 0) - (bState?.joinOrder ?? 0);
      });

    const existingHawkPositions = hawkIds
      .map((peerId) => this.getPlayerByPeerId(peerId)?.position.clone())
      .filter((pos): pos is THREE.Vector3 => !!pos);
    const pigeonSpawn = this.getSafePigeonSpawn(existingHawkPositions);

    const assignedHawkSpawns: THREE.Vector3[] = [];
    activePlayers.forEach(([peerId, playerState]) => {
      const isPigeon = peerId === pigeonPeerId;
      const spawnPos = isPigeon
        ? pigeonSpawn
        : this.getSafeHawkSpawn(pigeonSpawn, assignedHawkSpawns);
      if (!isPigeon) {
        assignedHawkSpawns.push(spawnPos.clone());
      }

      let player = this.getPlayerByPeerId(peerId);
      if (!player && peerId !== this.gameState!.localPeerId) {
        player = this.ensureRemotePlayer(peerId, playerState.role, spawnPos, playerState.role === PlayerRole.PIGEON ? 0 : Math.PI);
      }
      if (!player) return;

      player.position.copy(spawnPos);
      player.rotation.set(0, isPigeon ? 0 : Math.PI, 0);
      player.velocity.set(0, 0, 0);
      player.bankVelocity = 0;
      player.isEating = false;
      player.mesh.position.copy(player.position);
      player.applyMeshRotation();

      playerState.position.copy(player.position);
      playerState.rotation.copy(player.rotation);
      playerState.velocity.copy(player.velocity);
      playerState.isEating = false;

      spawnStates[peerId] = {
        position: {
          x: playerState.position.x,
          y: playerState.position.y,
          z: playerState.position.z,
        },
        rotation: {
          x: playerState.rotation.x,
          y: playerState.rotation.y,
          z: playerState.rotation.z,
        },
        velocity: {
          x: playerState.velocity.x,
          y: playerState.velocity.y,
          z: playerState.velocity.z,
        },
      };
    });

    return spawnStates;
  }

  /**
   * Reconcile local predicted state with host-authoritative local state.
   */
  private reconcileLocalPlayerWithAuthority(deltaTime: number): void {
    if (!this.gameState || this.gameState.isHost || !this.localPlayer || !this.networkManager) return;

    const now = performance.now();
    const elapsedSinceLast = this.lastReconcileTime > 0 ? now - this.lastReconcileTime : (deltaTime * 1000);
    if (elapsedSinceLast < 33) return; // ~30Hz correction keeps authority alignment tighter

    const authoritative = this.networkManager.getLocalAuthoritativeState();
    if (!authoritative) return;

    const latestServerTick = this.networkManager.getEstimatedServerTick();
    const tickAge = latestServerTick - authoritative.serverTick;
    if (tickAge > GAME_CONFIG.RECONCILE_MAX_TICK_AGE) return;

    const hardSnapDistance = GAME_CONFIG.RECONCILE_HARD_DISTANCE;
    const softStartDistance = GAME_CONFIG.RECONCILE_SOFT_DISTANCE;
    const error = this.localPlayer.position.distanceTo(authoritative.position);
    const yawDelta = Math.atan2(
      Math.sin(authoritative.rotation.y - this.localPlayer.rotation.y),
      Math.cos(authoritative.rotation.y - this.localPlayer.rotation.y)
    );
    const yawDeltaDeg = Math.abs(THREE.MathUtils.radToDeg(yawDelta));
    const hardSnapRotation = yawDeltaDeg > GAME_CONFIG.RECONCILE_HARD_ANGLE_DEG;
    const significantError = error > GAME_CONFIG.RECONCILE_SOFT_DISTANCE || yawDeltaDeg > 18;

    if (significantError) {
      this.localAuthorityDriftMs += elapsedSinceLast;
    } else {
      this.localAuthorityDriftMs = Math.max(0, this.localAuthorityDriftMs - (elapsedSinceLast * 1.5));
    }

    const persistentDrift = this.localAuthorityDriftMs >= 300;
    const persistentDriftDistance = Math.max(
      GAME_CONFIG.RECONCILE_SOFT_DISTANCE * 2.5,
      GAME_CONFIG.RECONCILE_HARD_DISTANCE * 0.5,
    );

    if (error > hardSnapDistance || hardSnapRotation || (persistentDrift && error > persistentDriftDistance)) {
      this.localPlayer.position.copy(authoritative.position);
      this.localPlayer.velocity.copy(authoritative.velocity);
      this.localPlayer.rotation.copy(authoritative.rotation);
      this.localAuthorityDriftMs = 0;
    } else if (error > softStartDistance) {
      const errorRatio = Math.min(1, error / Math.max(0.001, hardSnapDistance));
      const alpha = Math.min(0.24, Math.max(0.1, (deltaTime * 7) + (errorRatio * 0.08)));
      this.localPlayer.position.lerp(authoritative.position, alpha);
      this.localPlayer.velocity.lerp(authoritative.velocity, alpha);
      this.localPlayer.rotation.x = THREE.MathUtils.lerp(this.localPlayer.rotation.x, authoritative.rotation.x, alpha);
      this.localPlayer.rotation.y = this.lerpAngle(this.localPlayer.rotation.y, authoritative.rotation.y, alpha);
      this.localPlayer.rotation.z = THREE.MathUtils.lerp(this.localPlayer.rotation.z, authoritative.rotation.z, alpha);
    } else if (yawDeltaDeg > 10) {
      const yawAlpha = Math.min(0.2, deltaTime * 8);
      this.localPlayer.rotation.y = this.lerpAngle(this.localPlayer.rotation.y, authoritative.rotation.y, yawAlpha);
    }

    this.localPlayer.mesh.position.copy(this.localPlayer.position);
    this.localPlayer.applyMeshRotation();
    this.lastReconcileTime = now;
  }

  private lerpAngle(current: number, target: number, alpha: number): number {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + (delta * alpha);
  }

  /**
   * Swap the player's 3D model to match their current role.
   */
  private swapPlayerModel(player: Player): void {
    const model = getModel(player.role);
    if (model) {
      player.swapModel(model);
    }
    player.updateCollisionShape();
  }

  /**
   * Handle player death network event (client only)
   */
  private handlePlayerDeath(message: any): void {
    // Client receives death event from host and shows score screen
    if (this.gameState?.isHost) return; // Host already called endRound

    if (!this.gameState) return;

    const { pigeonWeight, survivalTime } = message;

    // Update scores on client
    this.gameState.scores.pigeon.totalWeight += pigeonWeight;
    this.gameState.scores.hawk.roundsWon += 1;
    this.gameState.scores.hawk.killTimes.push(survivalTime);

    // End round
    this.gameState.endRound();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();

    // Play hawk catch sounds (client side)
    AudioManager.play(SFX.HAWK_SCREECH, 'sfx');
    AudioManager.play(SFX.HAWK_WINS, 'sfx');

    // Show score screen
    this.inputManager.hideTouchControls();
    const bestCallouts = this.updatePersonalBestsForRound('hawk', pigeonWeight, survivalTime);
    this.scoreUI.showRoundEnd(
      'hawk',
      pigeonWeight,
      survivalTime,
      this.gameState.scores.pigeon,
      this.gameState.scores.hawk,
      this.createRoundEndOptions(bestCallouts)
    );
    this.submitLocalLeaderboardResult('hawk', pigeonWeight, survivalTime);

    // Release pointer lock
    this.inputManager.releasePointerLock();
  }

  /**
   * Handle food collected network event (client only)
   */
  private handleFoodCollected(message: FoodCollectedMessage): void {
    if (this.gameState?.isHost) return;
    if (!this.gameState || !this.foodSpawner) return;

    const food = this.foodSpawner.getFood(message.foodId);
    if (!food) return;

    this.foodSpawner.setFoodState(message.foodId, message.exists, message.respawnTimer);

    const collector = this.getPlayerByPeerId(message.playerId);
    const isLocalCollector = message.playerId === this.gameState.localPeerId;
    if (!collector) return;

    collector.startEating(food.eatTime);
    this.applyFoodEffect(collector, food.type, food.weightGain, food.energyGain);

    // Play eating sound for local player pickup
    if (isLocalCollector) {
      this.playEatSound(food.type);
      this.showFoodPopup(food.type, food.weightGain, food.energyGain);
    }
  }

  /**
   * Handle NPC killed event (client only).
   */
  private handleNPCKilled(message: NPCKilledMessage): void {
    if (this.gameState?.isHost) return;
    if (!this.gameState || !this.npcSpawner) return;

    const npc = this.npcSpawner.getNPC(message.npcId);
    if (npc && message.exists === false) {
      npc.kill(message.respawnTimer);
    }

    const isLocalCollector = message.playerId === this.gameState.localPeerId;
    const collector = this.getPlayerByPeerId(message.playerId);
    if (!collector || collector.role !== PlayerRole.HAWK) return;

    collector.startEating(this.getNPCEatTime(message.npcType));

    const hawk = this.getHawkController(collector);
    hawk?.addEnergy(this.getNPCEnergyReward(message.npcType));

    // Play kill sound for local hawk
    if (isLocalCollector) {
      AudioManager.play(SFX.NPC_KILL, 'sfx');
      this.showEventPopup(`NPC caught +${this.getNPCEnergyReward(message.npcType).toFixed(0)} energy`, 'good');
    }
  }

  /**
   * Handle round start network event (client only)
   */
  private handleRoundStart(message: RoundStartMessage): void {
    // Client receives round start from host
    if (this.gameState?.isHost) return; // Host handles this directly

    if (!this.gameState || !this.localPlayer) return;
    this.scoreUI.hide();

    console.log('Client received round start from host:', message.roundNumber);

    // Align player state map to host-authoritative role roster.
    for (const peerId of Array.from(this.gameState.players.keys())) {
      if (!(peerId in message.roles)) {
        this.gameState.players.delete(peerId);
      }
    }

    Object.entries(message.roles).forEach(([peerId, role]) => {
      const spawn = message.spawnStates[peerId];
      const spawnPos = spawn
        ? new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z)
        : new THREE.Vector3(0, 5, 0);
      const state = this.gameState!.players.get(peerId)
        ?? this.gameState!.addPlayer(peerId, role as PlayerRole, spawnPos);
      state.role = role as PlayerRole;
      state.active = true;
      if (message.spawnProtectionUntilTick && message.spawnProtectionUntilTick[peerId] !== undefined) {
        state.spawnProtectionUntilTick = message.spawnProtectionUntilTick[peerId];
      }
      if (message.inputLockedUntilTick && message.inputLockedUntilTick[peerId] !== undefined) {
        state.inputLockedUntilTick = message.inputLockedUntilTick[peerId];
      }
    });

    this.syncRemotePlayersFromGameState();

    Object.entries(message.roles).forEach(([peerId, role]) => {
      const player = this.getPlayerByPeerId(peerId);
      const playerState = this.gameState!.players.get(peerId);
      if (!player || !playerState) return;

      playerState.role = role as PlayerRole;
      player.role = role as PlayerRole;
      this.swapPlayerModel(player);

      const spawn = message.spawnStates[peerId];
      if (spawn) {
        player.position.set(spawn.position.x, spawn.position.y, spawn.position.z);
        player.rotation.set(spawn.rotation.x, spawn.rotation.y, spawn.rotation.z);
        player.velocity.set(spawn.velocity.x, spawn.velocity.y, spawn.velocity.z);
      } else {
        player.velocity.set(0, 0, 0);
      }

      player.bankVelocity = 0;
      player.isEating = false;
      player.mesh.position.copy(player.position);
      player.applyMeshRotation();

      playerState.position.copy(player.position);
      playerState.rotation.copy(player.rotation);
      playerState.velocity.copy(player.velocity);
      playerState.isEating = false;
    });

    if (!this.gameState.remotePeerId) {
      const firstRemoteId = Object.keys(message.roles)
        .find((peerId) => peerId !== this.gameState!.localPeerId);
      if (firstRemoteId) {
        this.gameState.remotePeerId = firstRemoteId;
      }
    }

    this.syncRoleControllers();
    this.resetRoleStats();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();
    if (this.foodSpawner) {
      this.foodSpawner.resetAll();
    }
    this.syncNPCStateFromGameState();

    const countdownSeconds = message.countdownSeconds ?? this.roundCountdownSeconds;
    const roundStartAt = message.roundStartAt ?? (Date.now() + (countdownSeconds * 1000));
    this.runRoundCountdown(message.roundNumber, roundStartAt, countdownSeconds);
  }

  /**
   * Set up disconnect/reconnect handlers on peer connection
   */
  private handleInsufficientPlayers(reason: string): void {
    if (!this.gameState || !this.networkManager || !this.gameState.isHost) return;

    if (this.gameState.roundState === RoundState.PLAYING) {
      this.networkManager.sendRoundEnd('insufficient_players', 0, this.gameState.getRoundTime());
    }
    this.gameState.endRound();
    this.gameState.roundState = RoundState.WAITING_FOR_PLAYERS;
    this.networkManager.resetRemoteInput();
    this.setControlsEnabled(false);
    this.clearRoundCountdownState();
    this.showEventPopup(`Round paused: ${reason}`, 'warn');
  }

  private handleHostSideDisconnect(peerId: string): void {
    if (!this.gameState || !this.gameState.isHost) return;

    const removedState = this.gameState.removePlayer(peerId);
    this.networkManager?.unregisterPeer(peerId);
    this.networkManager?.sendPlayerLeft(peerId, 'disconnect');
    this.removeRemotePlayer(peerId);

    if (this.gameState.remotePeerId === peerId) {
      const remainingPeerIds = this.peerConnection?.getRemotePeerIds() ?? [];
      this.gameState.remotePeerId = remainingPeerIds.length > 0 ? remainingPeerIds[0] : null;
    }

    if (!removedState) {
      return;
    }

    if (this.gameState.roundState === RoundState.PLAYING && removedState.role === PlayerRole.PIGEON) {
      const nextPigeonPeerId = this.gameState.getLowestJoinOrderActiveHawk();
      if (!nextPigeonPeerId) {
        this.handleInsufficientPlayers('pigeon disconnected');
        return;
      }

      this.gameState.assignRolesForNextRound(nextPigeonPeerId);
      const promotedState = this.gameState.players.get(nextPigeonPeerId);
      const promotedPlayer = this.getPlayerByPeerId(nextPigeonPeerId);
      if (promotedState && promotedPlayer) {
        const hawkPositions = this.getHawkPlayers()
          .filter((entry) => entry.peerId !== nextPigeonPeerId)
          .map((entry) => entry.player.position.clone());
        const safeSpawn = this.getSafePigeonSpawn(hawkPositions);

        promotedPlayer.role = PlayerRole.PIGEON;
        this.swapPlayerModel(promotedPlayer);
        promotedPlayer.position.copy(safeSpawn);
        promotedPlayer.velocity.set(0, 0, 0);
        promotedPlayer.rotation.set(0, 0, 0);
        promotedPlayer.mesh.position.copy(promotedPlayer.position);
        promotedPlayer.applyMeshRotation();

        promotedState.position.copy(promotedPlayer.position);
        promotedState.velocity.copy(promotedPlayer.velocity);
        promotedState.rotation.copy(promotedPlayer.rotation);

        const currentTick = this.networkManager?.getCurrentServerTick() ?? 0;
        const protectionTick = currentTick + Math.ceil(GAME_CONFIG.SPAWN_PROTECTION_SECONDS * GAME_CONFIG.TICK_RATE);
        this.gameState.setSpawnProtection(nextPigeonPeerId, protectionTick);
      }

      const roles: { [peerId: string]: PlayerRole } = {};
      const activePeers: string[] = [];
      const spawnStates: RoleAssignmentMessage['spawnStates'] = {};
      const spawnProtectionUntilTick: { [peerId: string]: number } = {};
      this.gameState.players.forEach((state, id) => {
        roles[id] = state.role;
        if (state.active) activePeers.push(id);
        spawnStates[id] = {
          position: { x: state.position.x, y: state.position.y, z: state.position.z },
          rotation: { x: state.rotation.x, y: state.rotation.y, z: state.rotation.z },
          velocity: { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z },
        };
        spawnProtectionUntilTick[id] = state.spawnProtectionUntilTick;
      });

      this.networkManager?.sendRoleAssignment(roles, {
        activePeers,
        spawnStates,
        reason: 'pigeon_reassigned',
        spawnProtectionUntilTick,
      });
      this.syncRoleControllers();
      this.showEventPopup('Pigeon reassigned after disconnect', 'warn');
      return;
    }

    const activeHawkCount = this.getHawkPlayers()
      .filter((entry) => this.gameState?.players.get(entry.peerId)?.active)
      .length;
    if (this.gameState.roundState === RoundState.PLAYING && activeHawkCount === 0) {
      this.handleInsufficientPlayers('no hawks remaining');
      return;
    }

    this.syncRoleControllers();
    this.showEventPopup('A player disconnected', 'warn');
    this.tryStartRoundIfReady();
  }

  private setupDisconnectHandlers(): void {
    if (!this.peerConnection) return;

    this.peerConnection.onDisconnected((peerId) => {
      if (this.gameState?.isHost) {
        if (peerId) {
          this.handleHostSideDisconnect(peerId);
          return;
        }
        if (!this.isGameStarted) {
          this.lobbyUI.showWaiting('Connection paused while app is backgrounded. Keep this tab in foreground until a friend joins.');
        } else {
          this.showEventPopup('Network paused. Trying to reconnect...', 'warn');
        }
        return;
      }
      console.log('Peer disconnected');
      const overlay = document.getElementById('disconnect-overlay');
      if (overlay) overlay.style.display = 'block';
      const status = document.getElementById('disconnect-status');
      if (status) status.textContent = 'Attempting to reconnect...';
    });

    this.peerConnection.onReconnected(() => {
      console.log('Peer reconnected');
      const overlay = document.getElementById('disconnect-overlay');
      if (overlay) overlay.style.display = 'none';
      if (this.gameState?.isHost) {
        if (!this.isGameStarted) {
          this.lobbyUI.showWaiting('Invite link is live again. Ask your friend to retry join.');
        } else {
          this.showEventPopup('Network connection restored', 'good');
        }
      }
      if (this.gameState && !this.gameState.isHost && this.networkManager) {
        this.setControlsEnabled(false);
        this.lobbyUI.showWaiting('Reconnected. Resyncing...');
        this.networkManager.sendJoinRequest(this.lobbyUI.getEffectiveUsername());
      }
    });
  }

  /**
   * Wire up volume slider UI.
   */
  private setupVolumeControls(): void {
    const btn = document.getElementById('volume-btn');
    const panel = document.getElementById('volume-panel');

    if (btn && panel) {
      btn.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
      });
    }

    const bind = (id: string, channel: 'master' | 'sfx' | 'ambient') => {
      const slider = document.getElementById(id) as HTMLInputElement | null;
      if (slider) {
        slider.addEventListener('input', () => {
          AudioManager.setVolume(channel, parseInt(slider.value, 10) / 100);
        });
      }
    };

    bind('vol-master', 'master');
    bind('vol-sfx', 'sfx');
    bind('vol-ambient', 'ambient');
  }

  /**
   * Play the appropriate eating sound for a food type.
   */
  private playEatSound(foodType: FoodType): void {
    switch (foodType) {
      case FoodType.CRUMB:
        AudioManager.play(SFX.EAT_CRUMB, 'sfx');
        break;
      case FoodType.BAGEL:
        AudioManager.play(SFX.EAT_BAGEL, 'sfx');
        break;
      case FoodType.PIZZA:
        AudioManager.play(SFX.EAT_PIZZA, 'sfx');
        break;
    }
  }

  private showFoodPopup(foodType: FoodType, weightGain: number, energyGain: number): void {
    if (!this.localPlayer) return;
    if (this.localPlayer.role === PlayerRole.PIGEON && foodType !== FoodType.RAT) {
      this.showEventPopup(`+${weightGain.toFixed(1)} lbs`, 'good');
      return;
    }
    if (this.localPlayer.role === PlayerRole.HAWK && foodType === FoodType.RAT) {
      this.showEventPopup(`+${energyGain.toFixed(0)} energy`, 'good');
    }
  }

  private showEventPopup(text: string, variant: 'good' | 'warn' = 'good'): void {
    const feed = document.getElementById('event-feed');
    if (!feed) return;

    const item = document.createElement('div');
    item.className = `event-popup ${variant}`;
    item.textContent = text;
    feed.appendChild(item);

    window.setTimeout(() => {
      item.remove();
    }, 1500);
  }

  /**
   * Check hawk dive state transitions and play dive sound.
   */
  private updateDiveSounds(): void {
    const hawk = this.localHawk;
    if (!hawk) {
      this.wasHawkDiving = false;
      return;
    }

    const isDiving = hawk.getIsDiving();
    if (isDiving && !this.wasHawkDiving) {
      AudioManager.play(SFX.HAWK_DIVE, 'sfx', 0.8);
    }
    this.wasHawkDiving = isDiving;
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    window.removeEventListener('keydown', this.debugToggleHandler);
    document.removeEventListener('visibilitychange', this.visibilityResumeHandler);
    window.removeEventListener('focus', this.visibilityResumeHandler);
    this.clearRoundCountdownState();
    if (this.ambientLoopId) AudioManager.stop(this.ambientLoopId);
    if (this.windLoopId) AudioManager.stop(this.windLoopId);
    AudioManager.dispose();
    this.sceneManager.dispose();
    this.inputManager.setPointerLockEnabled(false);
    this.inputManager.hideTouchControls();
    this.inputManager.dispose();
    if (this.localPlayer) this.localPlayer.dispose();
    this.remotePlayers.forEach((remotePlayer) => remotePlayer.dispose());
    if (this.foodSpawner) this.foodSpawner.dispose();
    if (this.npcSpawner) this.npcSpawner.dispose();
    if (this.environment) this.environment.dispose();
    if (this.gameState?.isHost && this.networkManager) {
      this.networkManager.sendHostTerminating('host_shutdown');
    }
    if (this.peerConnection) this.peerConnection.disconnect();
  }
}
