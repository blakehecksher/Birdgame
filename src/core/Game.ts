import * as THREE from 'three';
import { SceneManager } from '../rendering/SceneManager';
import { CameraController } from '../rendering/CameraController';
import { InputManager } from './InputManager';
import { FlightController } from '../physics/FlightController';
import { CollisionDetector } from '../physics/CollisionDetector';
import { Player } from '../entities/Player';
import { Pigeon } from '../entities/Pigeon';
import { Hawk } from '../entities/Hawk';
import { GameState } from './GameState';
import { PeerConnection } from '../network/PeerConnection';
import { NetworkManager } from '../network/NetworkManager';
import { FoodCollectedMessage, NPCKilledMessage, RoundEndMessage, RoundStartMessage } from '../network/messages';
import { LobbyUI } from '../ui/LobbyUI';
import { ScoreUI } from '../ui/ScoreUI';
import { PlayerRole, RoundState, FoodType, GAME_CONFIG } from '../config/constants';
import { FoodSpawner } from '../world/FoodSpawner';
import { Environment } from '../world/Environment';
import { preloadModels, getModel } from '../utils/ModelLoader';
import { SeededRandom } from '../utils/SeededRandom';
import { NPCType } from '../entities/NPC';
import { NPCSpawner } from '../world/NPCSpawner';
import { LeaderboardService } from '../services/LeaderboardService';

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
  private remotePlayer: Player | null = null;
  private localPigeon: Pigeon | null = null;
  private localHawk: Hawk | null = null;
  private remotePigeon: Pigeon | null = null;
  private remoteHawk: Hawk | null = null;
  private foodSpawner: FoodSpawner | null = null;
  private npcSpawner: NPCSpawner | null = null;
  private environment: Environment | null = null;

  // Game loop
  private lastTime: number = 0;
  private canvas: HTMLCanvasElement;

  // State
  private isGameStarted: boolean = false;
  private lastReconcileTime: number = 0;
  private worldSeed: number = 1;
  private debugConsoleEl: HTMLElement | null = null;
  private lastDebugRefreshTime: number = 0;
  private debugConsoleVisible: boolean = true;
  private readonly debugToggleHandler: (event: KeyboardEvent) => void;

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
    this.lobbyUI.show();
    this.refreshLeaderboard();

    // Set up lobby callbacks
    this.lobbyUI.onHost(() => this.hostGame());
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
    window.addEventListener('keydown', this.debugToggleHandler);

    // Check for room code in URL (auto-join)
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
      // Auto-join with the room code
      this.lobbyUI.showConnecting();
      this.joinGame(roomCode);
    }

    // Start render loop (even before game starts)
    this.lastTime = performance.now();
    this.gameLoop();
  }

  /**
   * Generate a short room code (6 chars, no ambiguous characters)
   */
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
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
   * Derive shared world seed from the host peer id so both peers generate
   * exactly the same map without an extra network message.
   */
  private getWorldSeedFromPeerIds(): number {
    if (!this.gameState) return 1;

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

  /**
   * Host a new game
   */
  private async hostGame(): Promise<void> {
    try {
      this.lobbyUI.showWaiting('Initializing...');

      const roomCode = this.generateRoomCode();

      // Initialize peer connection as host with room code
      this.peerConnection = new PeerConnection();
      const peerId = await this.peerConnection.initializeAsHost(roomCode);

      // Display shareable room link
      this.lobbyUI.displayRoomLink(roomCode);

      // Initialize game state
      this.gameState = new GameState(true, peerId);

      // Set up connection callbacks
      this.peerConnection.onConnected((remotePeerId) => {
        console.log('Client connected:', remotePeerId);
        this.gameState!.remotePeerId = remotePeerId;
        this.startGame();
      });

      this.setupDisconnectHandlers();

      this.lobbyUI.showWaiting('Waiting for player to join...');
    } catch (error) {
      console.error('Failed to host game:', error);
      this.lobbyUI.showError('Failed to create game. Please try again.');
    }
  }

  /**
   * Join an existing game
   */
  private async joinGame(hostPeerId: string): Promise<void> {
    try {
      this.lobbyUI.showConnecting();

      // Normalize accepted inputs:
      // - "ABC123"
      // - "birdgame-ABC123" (any case)
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
        this.startGame();
      });

      this.setupDisconnectHandlers();

      // Handle connection errors
      setTimeout(() => {
        if (!this.isGameStarted) {
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

    console.log('Starting game...');

    // Preload 3D models
    try {
      await preloadModels();
      console.log('3D models loaded');
    } catch (err) {
      console.warn('Failed to load 3D models, using fallback meshes:', err);
    }

    // Initialize network manager
    this.networkManager = new NetworkManager(this.peerConnection, this.gameState);

    // Register network event handlers
    this.networkManager.onPlayerDeath((message) => this.handlePlayerDeath(message));
    this.networkManager.onRoundStart((message) => this.handleRoundStart(message));
    this.networkManager.onFoodCollected((message) => this.handleFoodCollected(message));
    this.networkManager.onNPCKilled((message) => this.handleNPCKilled(message));
    this.networkManager.onRoundEnd((message) => this.handleRoundEnd(message));

    // Assign roles (host = pigeon, client = hawk for now, will swap later)
    const localRole = this.gameState.isHost ? PlayerRole.PIGEON : PlayerRole.HAWK;
    const remoteRole = this.gameState.isHost ? PlayerRole.HAWK : PlayerRole.PIGEON;

    // Build deterministic world from shared seed.
    this.worldSeed = this.getWorldSeedFromPeerIds();
    this.environment = new Environment(this.sceneManager.scene, this.worldSeed);

    // Set up camera collision with building meshes
    this.cameraController.setCollisionMeshes(
      this.environment.buildings.map((b) => b.mesh)
    );

    const spawn = this.getSpawnPositions();
    const localSpawnPos = spawn.local.clone();
    const remoteSpawnPos = spawn.remote.clone();

    // Create local player
    const localPlayerState = this.gameState.addPlayer(this.gameState.localPeerId, localRole, localSpawnPos);
    this.localPlayer = new Player(localRole, localSpawnPos, getModel(localRole));
    // Face toward center (host faces right, client faces left)
    this.localPlayer.rotation.y = this.gameState.isHost ? 0 : Math.PI;
    localPlayerState.rotation.y = this.localPlayer.rotation.y;
    this.sceneManager.scene.add(this.localPlayer.mesh);

    // Create remote player
    const remotePlayerState = this.gameState.addPlayer(this.gameState.remotePeerId!, remoteRole, remoteSpawnPos);
    this.remotePlayer = new Player(remoteRole, remoteSpawnPos, getModel(remoteRole));
    // Face toward center (hawk faces left, pigeon faces right)
    this.remotePlayer.rotation.y = this.gameState.isHost ? Math.PI : 0;
    remotePlayerState.rotation.y = this.remotePlayer.rotation.y;
    this.sceneManager.scene.add(this.remotePlayer.mesh);

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
    this.applyDebugConsoleVisibility();

    // Show instructions overlay (dismissed on click)
    const instructions = document.getElementById('instructions');
    if (instructions) {
      instructions.style.display = 'block';
      const dismiss = () => {
        instructions.style.display = 'none';
        instructions.removeEventListener('click', dismiss);
      };
      instructions.addEventListener('click', dismiss);
    }

    // Start first round
    this.gameState.startRound();

    this.isGameStarted = true;
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

    const username = this.lobbyUI.getUsername();
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

  /**
   * Update game state
   */
  private update(deltaTime: number): void {
    if (!this.gameState || !this.localPlayer) return;

    // Get input
    const input = this.inputManager.getInputState();

    // Apply flight controls to local player
    this.flightController.applyInput(this.localPlayer, input, deltaTime);

    // Update local player
    this.localPlayer.update(deltaTime);

    // Check building collisions for local player
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

    // Authoritative stat simulation runs on host
    if (this.gameState.isHost) {
      this.updateRoleStats(this.localPlayer, deltaTime);
    }

    if (this.foodSpawner) {
      this.foodSpawner.update(deltaTime);
    }
    if (this.npcSpawner) {
      if (this.gameState.isHost) {
        if (this.gameState.roundState === RoundState.PLAYING) {
          const hawkPlayer = this.localPlayer.role === PlayerRole.HAWK ? this.localPlayer : this.remotePlayer;
          const buildingBounds = this.environment
            ? this.environment.buildings.map((building) => ({ min: building.min, max: building.max }))
            : [];
          this.npcSpawner.update(deltaTime, hawkPlayer?.position ?? null, buildingBounds);
        }
        this.syncNPCStateToGameState();
      } else {
        this.syncNPCStateFromGameState();
      }
    }

    // Sync local player state to game state
    const localPlayerState = this.gameState.getLocalPlayer();
    if (localPlayerState) {
      localPlayerState.position.copy(this.localPlayer.position);
      localPlayerState.rotation.copy(this.localPlayer.rotation);
      localPlayerState.velocity.copy(this.localPlayer.velocity);
      if (this.gameState.isHost) {
        localPlayerState.isEating = this.localPlayer.isEating;
        localPlayerState.weight = this.getPlayerWeight(this.localPlayer);
        localPlayerState.energy = this.getPlayerEnergy(this.localPlayer);
      }
    }

    // Network updates
    if (this.networkManager) {
      if (this.gameState.isHost) {
        // Host: Apply remote player input if available
        if (this.remotePlayer) {
          const remoteInput = this.networkManager.getRemoteInput();
          if (remoteInput) {
            this.flightController.applyInput(this.remotePlayer, remoteInput, deltaTime);
          }
          this.remotePlayer.update(deltaTime);

          // Check building collisions for remote player (host simulates remote)
          if (this.environment) {
            this.environment.checkAndResolveCollisions(
              this.remotePlayer.position,
              this.remotePlayer.radius,
              this.remotePlayer.velocity
            );
            if (this.remotePlayer.role === PlayerRole.HAWK) {
              this.environment.applyHawkCanopySlow(
                this.remotePlayer.position,
                this.remotePlayer.radius,
                this.remotePlayer.velocity,
                deltaTime
              );
            }
          }

          this.updateRoleStats(this.remotePlayer, deltaTime);

          // Sync remote player state to game state
          const remotePlayerState = this.gameState.getRemotePlayer();
          if (remotePlayerState) {
            remotePlayerState.position.copy(this.remotePlayer.position);
            remotePlayerState.rotation.copy(this.remotePlayer.rotation);
            remotePlayerState.velocity.copy(this.remotePlayer.velocity);
            remotePlayerState.isEating = this.remotePlayer.isEating;
            remotePlayerState.weight = this.getPlayerWeight(this.remotePlayer);
            remotePlayerState.energy = this.getPlayerEnergy(this.remotePlayer);
          }
        }

        this.syncFoodStateToGameState();

        // Send state sync to client
        this.networkManager.sendStateSync();
      } else {
        // Client: Send input to host
        this.networkManager.sendInputUpdate(input);

        // Update remote player from game state
        if (this.remotePlayer) {
          const remotePlayerState = this.gameState.getRemotePlayer();
          if (remotePlayerState) {
            this.remotePlayer.position.copy(remotePlayerState.position);
            this.remotePlayer.rotation.copy(remotePlayerState.rotation);
            this.remotePlayer.velocity.copy(remotePlayerState.velocity);
            this.remotePlayer.isEating = !!remotePlayerState.isEating;

            // Apply host-authoritative transform directly on client.
            this.remotePlayer.mesh.position.copy(this.remotePlayer.position);
            this.remotePlayer.applyMeshRotation();
          }
        }

        this.syncVisualStatsFromGameState();
        this.syncFoodStateFromGameState();
        this.reconcileLocalPlayerWithAuthority(deltaTime);
      }
    }

    // Collision detection and timer check (host only)
    if (this.gameState.isHost && this.gameState.roundState === RoundState.PLAYING) {
      this.checkCollisions();

      // Check if round timer expired (pigeon survives)
      if (this.gameState.isRoundTimeUp()) {
        this.endRoundPigeonSurvived();
      }
    }

    // Update camera to follow local player
    this.cameraController.update(this.localPlayer.mesh, this.localPlayer.rotation, input.scrollDelta);

    // Update HUD
    this.updateHUD();
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
        const weightBar = document.getElementById('weight-bar');
        if (weightBar) weightBar.style.width = `${Math.min(100, (weight / 20) * 100)}%`;
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
      const remaining = Math.max(0, Math.floor(this.gameState.getRemainingTime()));
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      timerDisplay.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
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

    this.updateDebugConsole();
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
    const remoteState = this.gameState.getRemotePlayer();
    const localError = localState
      ? localState.position.distanceTo(this.localPlayer.position)
      : 0;
    const remoteError = this.remotePlayer && remoteState
      ? remoteState.position.distanceTo(this.remotePlayer.position)
      : 0;

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
      this.remotePlayer
        ? `Remote ${this.remotePlayer.role} p:${this.formatVec3(this.remotePlayer.position)} v:${this.remotePlayer.velocity.length().toFixed(2)}`
        : 'Remote: n/a',
      `PosErr L:${localError.toFixed(2)} R:${remoteError.toFixed(2)}`,
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

  private formatVec3(value: THREE.Vector3): string {
    return `${value.x.toFixed(1)},${value.y.toFixed(1)},${value.z.toFixed(1)}`;
  }

  /**
   * Check for collisions (host only)
   */
  private checkCollisions(): void {
    if (!this.localPlayer || !this.remotePlayer || !this.gameState) return;

    // Check player vs player collision
    const collision = this.collisionDetector.checkPlayerCollision(
      this.localPlayer,
      this.remotePlayer
    );

    if (collision) {
      this.endRound();
    }

    if (this.foodSpawner) {
      this.checkFoodCollision(this.localPlayer, this.gameState.localPeerId);
      if (this.gameState.remotePeerId) {
        this.checkFoodCollision(this.remotePlayer, this.gameState.remotePeerId);
      }
    }

    if (this.npcSpawner) {
      if (this.localPlayer.role === PlayerRole.HAWK) {
        this.checkNPCCollision(this.localPlayer, this.gameState.localPeerId);
      }
      if (this.gameState.remotePeerId && this.remotePlayer.role === PlayerRole.HAWK) {
        this.checkNPCCollision(this.remotePlayer, this.gameState.remotePeerId);
      }
    }
  }

  /**
   * End the current round
   */
  private endRound(): void {
    if (!this.gameState) return;

    // Calculate scores
    const pigeonPlayer = this.localPlayer!.role === PlayerRole.PIGEON
      ? this.localPlayer!
      : this.remotePlayer!;

    const pigeonWeight = this.getPlayerWeight(pigeonPlayer);
    const survivalTime = this.gameState.getRoundTime();

    // Update cumulative scores
    this.gameState.scores.pigeon.totalWeight += pigeonWeight;
    this.gameState.scores.hawk.roundsWon += 1;
    this.gameState.scores.hawk.killTimes.push(survivalTime);

    // End the round
    this.gameState.endRound();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();

    // Send death event to client (host only)
    if (this.gameState.isHost && this.networkManager) {
      const victimId = pigeonPlayer === this.localPlayer
        ? this.gameState.localPeerId
        : this.gameState.remotePeerId!;
      const killerId = pigeonPlayer === this.localPlayer
        ? this.gameState.remotePeerId!
        : this.gameState.localPeerId;

      this.networkManager.sendPlayerDeath(victimId, killerId, pigeonWeight, survivalTime);
    }

    // Show score screen
    this.scoreUI.showRoundEnd(
      'hawk',
      pigeonWeight,
      survivalTime,
      this.gameState.scores.pigeon,
      this.gameState.scores.hawk
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

    const pigeonPlayer = this.localPlayer!.role === PlayerRole.PIGEON
      ? this.localPlayer!
      : this.remotePlayer!;

    const pigeonWeight = this.getPlayerWeight(pigeonPlayer);
    const survivalTime = this.gameState.roundDuration;

    // Update cumulative scores
    this.gameState.scores.pigeon.totalWeight += pigeonWeight;
    this.gameState.scores.pigeon.roundsWon += 1;

    // End the round
    this.gameState.endRound();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();

    // Send round end event to client
    if (this.networkManager) {
      this.networkManager.sendRoundEnd('pigeon', pigeonWeight, survivalTime);
    }

    // Show score screen
    this.scoreUI.showRoundEnd(
      'pigeon',
      pigeonWeight,
      survivalTime,
      this.gameState.scores.pigeon,
      this.gameState.scores.hawk
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
    this.gameState.scores.pigeon.totalWeight += pigeonWeight;
    if (winner === 'pigeon') {
      this.gameState.scores.pigeon.roundsWon += 1;
    } else {
      this.gameState.scores.hawk.roundsWon += 1;
      this.gameState.scores.hawk.killTimes.push(survivalTime);
    }

    this.gameState.endRound();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();

    this.scoreUI.showRoundEnd(
      winner === 'pigeon' ? 'pigeon' : 'hawk',
      pigeonWeight,
      survivalTime,
      this.gameState.scores.pigeon,
      this.gameState.scores.hawk
    );
    this.submitLocalLeaderboardResult(winner === 'pigeon' ? 'pigeon' : 'hawk', pigeonWeight, survivalTime);

    this.inputManager.releasePointerLock();
  }

  /**
   * Start next round with role swap
   * Called by host when "Next Round" is clicked, or by client when ROUND_START message received
   */
  private startNextRound(): void {
    if (!this.gameState || !this.localPlayer || !this.remotePlayer) return;

    // Only host should execute this directly from UI
    // Client waits for ROUND_START message
    if (!this.gameState.isHost) {
      console.log('Client waiting for round start from host...');
      return;
    }

    // Swap roles
    this.gameState.swapRoles();

    // Update player roles
    const localPlayerState = this.gameState.getLocalPlayer();
    const remotePlayerState = this.gameState.getRemotePlayer();

    if (localPlayerState && remotePlayerState) {
      this.localPlayer.role = localPlayerState.role;
      this.remotePlayer.role = remotePlayerState.role;

      // Swap bird models for new roles
      this.swapPlayerModel(this.localPlayer);
      this.swapPlayerModel(this.remotePlayer);

      // Reset positions
      const spawn = this.getSpawnPositions();
      this.localPlayer.position.copy(spawn.local);
      this.remotePlayer.position.copy(spawn.remote);

      // Reset rotations (including bank angle)
      this.localPlayer.rotation.y = this.gameState.isHost ? 0 : Math.PI;
      this.localPlayer.rotation.z = 0;
      this.localPlayer.bankVelocity = 0;
      this.remotePlayer.rotation.y = this.gameState.isHost ? Math.PI : 0;
      this.remotePlayer.rotation.z = 0;
      this.remotePlayer.bankVelocity = 0;

      // Reset velocities
      this.localPlayer.velocity.set(0, 0, 0);
      this.remotePlayer.velocity.set(0, 0, 0);

      // Keep authoritative game state aligned before broadcasting ROUND_START.
      localPlayerState.position.copy(this.localPlayer.position);
      localPlayerState.rotation.copy(this.localPlayer.rotation);
      localPlayerState.velocity.copy(this.localPlayer.velocity);
      localPlayerState.isEating = false;
      remotePlayerState.position.copy(this.remotePlayer.position);
      remotePlayerState.rotation.copy(this.remotePlayer.rotation);
      remotePlayerState.velocity.copy(this.remotePlayer.velocity);
      remotePlayerState.isEating = false;
    }

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

    // Start new round
    this.gameState.startRound();

    // Send round start to client (host only)
    if (this.networkManager) {
      const spawnStates = {
        [this.gameState.localPeerId]: {
          position: {
            x: localPlayerState!.position.x,
            y: localPlayerState!.position.y,
            z: localPlayerState!.position.z,
          },
          rotation: {
            x: localPlayerState!.rotation.x,
            y: localPlayerState!.rotation.y,
            z: localPlayerState!.rotation.z,
          },
          velocity: {
            x: localPlayerState!.velocity.x,
            y: localPlayerState!.velocity.y,
            z: localPlayerState!.velocity.z,
          },
        },
        [this.gameState.remotePeerId!]: {
          position: {
            x: remotePlayerState!.position.x,
            y: remotePlayerState!.position.y,
            z: remotePlayerState!.position.z,
          },
          rotation: {
            x: remotePlayerState!.rotation.x,
            y: remotePlayerState!.rotation.y,
            z: remotePlayerState!.rotation.z,
          },
          velocity: {
            x: remotePlayerState!.velocity.x,
            y: remotePlayerState!.velocity.y,
            z: remotePlayerState!.velocity.z,
          },
        },
      };

      this.networkManager.sendRoundStart(
        this.gameState.roundNumber,
        {
          [this.gameState.localPeerId]: localPlayerState!.role,
          [this.gameState.remotePeerId!]: remotePlayerState!.role,
        },
        spawnStates
      );
    }
  }

  /**
   * Configure role stat controllers after role changes.
   */
  private syncRoleControllers(): void {
    if (!this.localPlayer || !this.remotePlayer) return;

    // Clear role-specific visual/physics leftovers before re-attaching controllers.
    this.localPlayer.setVisualScale(1);
    this.remotePlayer.setVisualScale(1);
    this.localPlayer.speedMultiplier = 1;
    this.remotePlayer.speedMultiplier = 1;

    this.localPigeon = this.localPlayer.role === PlayerRole.PIGEON ? new Pigeon(this.localPlayer) : null;
    this.localHawk = this.localPlayer.role === PlayerRole.HAWK ? new Hawk(this.localPlayer) : null;
    this.remotePigeon = this.remotePlayer.role === PlayerRole.PIGEON ? new Pigeon(this.remotePlayer) : null;
    this.remoteHawk = this.remotePlayer.role === PlayerRole.HAWK ? new Hawk(this.remotePlayer) : null;
  }

  /**
   * Update per-role stats on host.
   */
  private updateRoleStats(player: Player, deltaTime: number): void {
    const hawk = player === this.localPlayer ? this.localHawk : this.remoteHawk;
    if (hawk) {
      hawk.update(deltaTime);
    }
  }

  /**
   * Reset all role stats for a new round.
   */
  private resetRoleStats(): void {
    this.localPigeon?.reset();
    this.localHawk?.reset();
    this.remotePigeon?.reset();
    this.remoteHawk?.reset();
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

      const hawk = player === this.localPlayer ? this.localHawk : this.remoteHawk;
      hawk?.addEnergy(killed.getEnergyReward());

      this.syncNPCStateToGameState();
      this.networkManager!.sendNPCKilled(
        killed.id,
        playerId,
        killed.type,
        false,
        respawnTime
      );
      break;
    }
  }

  /**
   * Apply food effects to the role controller.
   */
  private applyFoodEffect(player: Player, foodType: FoodType, weightGain: number, energyGain: number): void {
    if (player.role === PlayerRole.PIGEON && foodType !== FoodType.RAT) {
      const pigeon = player === this.localPlayer ? this.localPigeon : this.remotePigeon;
      pigeon?.addWeight(weightGain);
      return;
    }

    if (player.role === PlayerRole.HAWK && foodType === FoodType.RAT) {
      const hawk = player === this.localPlayer ? this.localHawk : this.remoteHawk;
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
        respawnTimer: 0,
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
      }))
    );
  }

  /**
   * Copy weight/energy values from game state to local controllers.
   */
  private syncVisualStatsFromGameState(): void {
    if (!this.gameState || !this.localPlayer || !this.remotePlayer) return;

    const localState = this.gameState.getLocalPlayer();
    const remoteState = this.gameState.getRemotePlayer();

    if (localState) {
      if (localState.weight !== undefined) {
        this.setPlayerWeight(this.localPlayer, localState.weight);
      }
      if (localState.energy !== undefined) {
        this.setPlayerEnergy(this.localPlayer, localState.energy);
      }
    }

    if (remoteState) {
      if (remoteState.weight !== undefined) {
        this.setPlayerWeight(this.remotePlayer, remoteState.weight);
      }
      if (remoteState.energy !== undefined) {
        this.setPlayerEnergy(this.remotePlayer, remoteState.energy);
      }
    }
  }

  private setPlayerWeight(player: Player, weight: number): void {
    const pigeon = player === this.localPlayer ? this.localPigeon : this.remotePigeon;
    pigeon?.setWeight(weight);
  }

  private setPlayerEnergy(player: Player, energy: number): void {
    const hawk = player === this.localPlayer ? this.localHawk : this.remoteHawk;
    hawk?.setEnergy(energy);
  }

  private getPlayerWeight(player: Player): number {
    const pigeon = player === this.localPlayer ? this.localPigeon : this.remotePigeon;
    return pigeon ? pigeon.getWeight() : 1;
  }

  private getPlayerEnergy(player: Player): number {
    const hawk = player === this.localPlayer ? this.localHawk : this.remoteHawk;
    return hawk ? hawk.getEnergy() : 0;
  }

  /**
   * Reconcile local predicted state with host-authoritative local state.
   */
  private reconcileLocalPlayerWithAuthority(deltaTime: number): void {
    if (!this.gameState || this.gameState.isHost || !this.localPlayer || !this.networkManager) return;

    const now = performance.now();
    if (now - this.lastReconcileTime < 33) return; // ~30Hz correction

    const authoritative = this.networkManager.getLocalAuthoritativeState();
    if (!authoritative) return;

    // Ignore stale snapshots.
    if (Date.now() - authoritative.timestamp > 300) return;

    const hardSnapDistance = 5.0;
    const softStartDistance = 0.4;
    const error = this.localPlayer.position.distanceTo(authoritative.position);

    if (error > hardSnapDistance) {
      this.localPlayer.position.copy(authoritative.position);
      this.localPlayer.velocity.copy(authoritative.velocity);
      this.localPlayer.rotation.copy(authoritative.rotation);
    } else if (error > softStartDistance) {
      const alpha = Math.min(0.22, deltaTime * 10);
      this.localPlayer.position.lerp(authoritative.position, alpha);
      this.localPlayer.velocity.lerp(authoritative.velocity, alpha);
      this.localPlayer.rotation.x = THREE.MathUtils.lerp(this.localPlayer.rotation.x, authoritative.rotation.x, alpha);
      this.localPlayer.rotation.y = this.lerpAngle(this.localPlayer.rotation.y, authoritative.rotation.y, alpha);
      this.localPlayer.rotation.z = THREE.MathUtils.lerp(this.localPlayer.rotation.z, authoritative.rotation.z, alpha);
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

    // Show score screen
    this.scoreUI.showRoundEnd(
      'hawk',
      pigeonWeight,
      survivalTime,
      this.gameState.scores.pigeon,
      this.gameState.scores.hawk
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

    const isLocalCollector = message.playerId === this.gameState.localPeerId;
    const collector = isLocalCollector ? this.localPlayer : this.remotePlayer;
    if (!collector) return;

    collector.startEating(food.eatTime);
    this.applyFoodEffect(collector, food.type, food.weightGain, food.energyGain);
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

    const collector = message.playerId === this.gameState.localPeerId ? this.localPlayer : this.remotePlayer;
    if (!collector || collector.role !== PlayerRole.HAWK) return;

    collector.startEating(this.getNPCEatTime(message.npcType));

    const hawk = collector === this.localPlayer ? this.localHawk : this.remoteHawk;
    hawk?.addEnergy(this.getNPCEnergyReward(message.npcType));
  }

  /**
   * Handle round start network event (client only)
   */
  private handleRoundStart(message: RoundStartMessage): void {
    // Client receives round start from host
    if (this.gameState?.isHost) return; // Host handles this directly

    if (!this.gameState || !this.localPlayer || !this.remotePlayer) return;

    console.log('Client received round start from host:', message.roundNumber);

    // Update player roles
    const localPlayerState = this.gameState.getLocalPlayer();
    const remotePlayerState = this.gameState.getRemotePlayer();

    if (localPlayerState && remotePlayerState) {
      // Use host-authoritative role map from ROUND_START.
      const localRole = message.roles[this.gameState.localPeerId] as PlayerRole;
      const remoteRole = message.roles[this.gameState.remotePeerId!] as PlayerRole;
      if (localRole) localPlayerState.role = localRole;
      if (remoteRole) remotePlayerState.role = remoteRole;

      this.localPlayer.role = localPlayerState.role;
      this.remotePlayer.role = remotePlayerState.role;

      // Swap bird models for new roles
      this.swapPlayerModel(this.localPlayer);
      this.swapPlayerModel(this.remotePlayer);

      // Reset transforms from host-authoritative spawn states.
      const localSpawn = message.spawnStates[this.gameState.localPeerId];
      const remoteSpawn = message.spawnStates[this.gameState.remotePeerId!];
      if (localSpawn) {
        this.localPlayer.position.set(localSpawn.position.x, localSpawn.position.y, localSpawn.position.z);
        this.localPlayer.rotation.set(localSpawn.rotation.x, localSpawn.rotation.y, localSpawn.rotation.z);
        this.localPlayer.velocity.set(localSpawn.velocity.x, localSpawn.velocity.y, localSpawn.velocity.z);
      }
      if (remoteSpawn) {
        this.remotePlayer.position.set(remoteSpawn.position.x, remoteSpawn.position.y, remoteSpawn.position.z);
        this.remotePlayer.rotation.set(remoteSpawn.rotation.x, remoteSpawn.rotation.y, remoteSpawn.rotation.z);
        this.remotePlayer.velocity.set(remoteSpawn.velocity.x, remoteSpawn.velocity.y, remoteSpawn.velocity.z);
      }

      localPlayerState.position.copy(this.localPlayer.position);
      localPlayerState.rotation.copy(this.localPlayer.rotation);
      localPlayerState.velocity.copy(this.localPlayer.velocity);
      localPlayerState.isEating = false;
      remotePlayerState.position.copy(this.remotePlayer.position);
      remotePlayerState.rotation.copy(this.remotePlayer.rotation);
      remotePlayerState.velocity.copy(this.remotePlayer.velocity);
      remotePlayerState.isEating = false;
    }

    this.syncRoleControllers();
    this.resetRoleStats();
    this.networkManager?.resetRemoteInput();
    this.inputManager.resetInputState();
    if (this.foodSpawner) {
      this.foodSpawner.resetAll();
    }
    this.syncNPCStateFromGameState();

    // Start new round
    this.gameState.roundNumber = Math.max(0, message.roundNumber - 1);
    this.gameState.startRound();
  }

  /**
   * Set up disconnect/reconnect handlers on peer connection
   */
  private setupDisconnectHandlers(): void {
    if (!this.peerConnection) return;

    this.peerConnection.onDisconnected(() => {
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
    });
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    window.removeEventListener('keydown', this.debugToggleHandler);
    this.sceneManager.dispose();
    this.inputManager.dispose();
    if (this.localPlayer) this.localPlayer.dispose();
    if (this.remotePlayer) this.remotePlayer.dispose();
    if (this.foodSpawner) this.foodSpawner.dispose();
    if (this.npcSpawner) this.npcSpawner.dispose();
    if (this.environment) this.environment.dispose();
    if (this.peerConnection) this.peerConnection.disconnect();
  }
}
