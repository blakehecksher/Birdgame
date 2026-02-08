// Game configuration constants

export const GAME_CONFIG = {
  // Round settings
  ROUND_DURATION: 180, // 3 minutes in seconds

  // Pigeon parameters
  PIGEON_BASE_SPEED: 8.0,
  PIGEON_TURN_RADIUS: 0.25,
  PIGEON_INITIAL_WEIGHT: .50,
  PIGEON_MIN_SPEED: 0.5, // Minimum speed multiplier at max weight
  PIGEON_WEIGHT_PENALTY: 0.05, // Speed reduction per weight unit
  PIGEON_SIZE_SCALE: 0.05, // Visual size increase per weight unit
  PIGEON_MOUSE_PITCH_SENSITIVITY: 0.0015,
  PIGEON_MAX_PITCH: Math.PI / 3, // Maximum pitch angle (60 degrees)
  PIGEON_BANK_ACCELERATION: 12.0,
  PIGEON_BANK_SPRING_STIFFNESS: 12.0,
  PIGEON_BANK_DAMPING: 4.0,
  PIGEON_MAX_BANK_ANGLE: Math.PI / 3,
  PIGEON_BANK_TURN_COUPLING: 2.0, // How much banking increases turn rate

  // Hawk parameters
  HAWK_BASE_SPEED: 10.0,
  HAWK_TURN_RADIUS: 2.0,
  HAWK_INITIAL_ENERGY: 100,
  HAWK_ENERGY_DRAIN_RATE: 1.0, // Energy per second
  HAWK_LOW_ENERGY_THRESHOLD: 25,
  HAWK_LOW_ENERGY_SPEED_MULT: 0.8,
  HAWK_BOOSTED_SPEED_MULT: 1.2, // When well-fed (>75 energy)
  HAWK_DIVE_MAX_SPEED_MULT: 2.0, // Max speed multiplier at steepest dive
  HAWK_DIVE_ENERGY_DRAIN_MULT: 2.5, // Extra energy drain while diving
  HAWK_MOUSE_PITCH_SENSITIVITY: 0.0015,
  HAWK_MAX_PITCH: Math.PI / 3, // Maximum pitch angle (60 degrees)
  HAWK_BANK_ACCELERATION: 8.0,
  HAWK_BANK_SPRING_STIFFNESS: 6.0,
  HAWK_BANK_DAMPING: 4.0,
  HAWK_MAX_BANK_ANGLE: Math.PI / 3,
  HAWK_BANK_TURN_COUPLING: 1.0, // Hawks bank less aggressively than pigeons

  // Player physics
  PLAYER_RADIUS: 1.5, // Collision sphere radius
  AIR_RESISTANCE: 0.9, // Velocity multiplier per frame

  // Camera settings
  CAMERA_DISTANCE: 5,
  CAMERA_HEIGHT: 2,
  CAMERA_LERP_FACTOR: 0.18,
  CAMERA_BANK_FOLLOW: 0.3,
  CAMERA_ZOOM_MIN: 3.0,
  CAMERA_ZOOM_MAX: 12.0,
  CAMERA_ZOOM_SPEED: 1.5,

  // Network settings
  TICK_RATE: 20, // Updates per second
  STATE_BUFFER_TIME: 100, // Milliseconds

  // Food settings
  FOOD_RESPAWN_TIME: 30, // Seconds
  CRUMB_WEIGHT: 0.5,
  CRUMB_EAT_TIME: 0.5,
  BAGEL_WEIGHT: 2.0,
  BAGEL_EAT_TIME: 2.0,
  PIZZA_WEIGHT: 5.0,
  PIZZA_EAT_TIME: 4.0,

  // Prey settings (for hawk)
  RAT_ENERGY: 15,
  RAT_EAT_TIME: 2,
  RAT_RESPAWN_TIME: 15,

  // NPC AI settings (Session B)
  NPC_PIGEON_COUNT: 10,
  NPC_RAT_COUNT: 10,
  NPC_SQUIRREL_COUNT: 8,
  NPC_PIGEON_ENERGY: 25,
  NPC_RAT_ENERGY: 35,
  NPC_SQUIRREL_ENERGY: 50,
  NPC_PIGEON_RESPAWN: 45,
  NPC_RAT_RESPAWN: 30,
  NPC_SQUIRREL_RESPAWN: 35,
  NPC_PIGEON_FLEE_RANGE: 15,
  NPC_RAT_FLEE_RANGE: 10,
  NPC_SQUIRREL_FLEE_RANGE: 12,
  NPC_PIGEON_SPEED: 2.0,
  NPC_RAT_SPEED: 4.0,
  NPC_SQUIRREL_SPEED: 3.2,
  NPC_PIGEON_SWOOP_AMPLITUDE: 2.2,
  NPC_PIGEON_SWOOP_FREQUENCY: 2.0,
  NPC_PIGEON_TURN_RATE: 0.9,
  NPC_PIGEON_FLIGHT_MIN_ALT: 5.5,
  NPC_PIGEON_FLIGHT_MAX_ALT: 16.0,
  NPC_SQUIRREL_TREE_BIAS: 0.8,
  NPC_PIGEON_EAT_TIME: 1.5,
  NPC_RAT_EAT_TIME: 2.0,
  NPC_SQUIRREL_EAT_TIME: 2.4,
  NPC_PIGEON_RADIUS: 0.45,
  NPC_RAT_RADIUS: 0.3,
  NPC_SQUIRREL_RADIUS: 0.5,

  // Environment — 10x10 city grid
  GROUND_SIZE: 400,
  GRID_SIZE: 10,            // 10x10 grid of cells
  CELL_SIZE: 27,            // Each cell is 27x27 game units
  STREET_WIDTH: 3,          // Street between cells
  BUILDING_MIN_HEIGHT: 10.5, // ~3 stories (3 × 3.5)
  BUILDING_MAX_HEIGHT: 35,   // ~10 stories (10 × 3.5)
  BUILDING_CHANCE: 0.4,     // 40% chance a non-edge cell is a building
  PARK_TREES_MIN: 2,
  PARK_TREES_MAX: 5,
  PARK_BENCHES_MAX: 2,
} as const;

// Food types
export enum FoodType {
  CRUMB = 'CRUMB',
  BAGEL = 'BAGEL',
  PIZZA = 'PIZZA',
  RAT = 'RAT', // For hawks
}

// Player roles
export enum PlayerRole {
  PIGEON = 'pigeon',
  HAWK = 'hawk',
}

// Round states
export enum RoundState {
  LOBBY = 'lobby',
  PLAYING = 'playing',
  ENDED = 'ended',
}
