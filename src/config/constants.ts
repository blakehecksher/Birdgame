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
  PIGEON_MOUSE_BANK_SENSITIVITY: 0.004, // Subtle mouse X -> bank assist
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
  HAWK_MOUSE_BANK_SENSITIVITY: 0.004, // Subtle mouse X -> bank assist
  HAWK_MAX_PITCH: Math.PI / 3, // Maximum pitch angle (60 degrees)
  HAWK_BANK_ACCELERATION: 8.0,
  HAWK_BANK_SPRING_STIFFNESS: 6.0,
  HAWK_BANK_DAMPING: 4.0,
  HAWK_MAX_BANK_ANGLE: Math.PI / 3,
  HAWK_BANK_TURN_COUPLING: 1.0, // Hawks bank less aggressively than pigeons

  // Player collision ellipsoid (per-role, in local bird space)
  // X = forward/back, Y = up/down, Z = left/right (wingspan)
  PIGEON_COLLISION_RX: 0.7,   // forward/back half-extent
  PIGEON_COLLISION_RY: 0.35,  // vertical half-extent
  PIGEON_COLLISION_RZ: 0.45,  // side-to-side half-extent

  HAWK_COLLISION_RX: 1.0,     // longer body
  HAWK_COLLISION_RY: 0.5,     // sleeker profile
  HAWK_COLLISION_RZ: 0.7,    // wider wingspan

  SHOW_COLLISION_DEBUG: false,  // render transparent collision bounds on players and NPCs

  // Player physics
  AIR_RESISTANCE: 0.9, // Velocity multiplier per frame
  GROUND_SPEED_MULTIPLIER: 0.2, // Grounded players move at 20% normal horizontal speed

  // Camera settings
  CAMERA_DISTANCE: 5,
  CAMERA_HEIGHT: 2,
  CAMERA_LERP_FACTOR: 0.18,
  CAMERA_BANK_FOLLOW: 0.3,
  CAMERA_ZOOM_MIN: 3.0,
  CAMERA_ZOOM_MAX: 12.0,
  CAMERA_ZOOM_SPEED: 1.5,

  // Physics
  PHYSICS_TIMESTEP: 1 / 60, // Fixed physics step in seconds (60Hz)
  MAX_PHYSICS_STEPS_PER_FRAME: 4, // Prevent spiral of death on slow devices

  // Network settings
  TICK_RATE: 30, // Movement updates per second
  STATE_BUFFER_TIME: 70, // Interpolation delay in milliseconds (Phase 1: reduced from 120ms)
  MOBILE_STATE_BUFFER_EXTRA: 25, // Mobile-only interpolation delay bonus to smooth packet jitter
  STATE_REORDER_GRACE_TIME: 20, // Delay before skipping a missing STATE_SYNC sequence
  MOBILE_STATE_REORDER_GRACE_EXTRA: 20, // Extra reorder grace on mobile jittery links

  // Netcode tuning (Phase 1)
  RECONCILIATION_DEAD_ZONE: 0.3,      // Below this error, no correction (was 0.4, tried 0.15 but too jittery)
  RECONCILIATION_ALPHA_MAX: 0.35,     // Correction strength (was 0.22)
  RECONCILIATION_ALPHA_SCALE: 15.0,   // Multiplier for deltaTime (was 10)
  RECONCILIATION_MOBILE_DEAD_ZONE: 0.2, // Slightly wider dead zone to reduce mobile micro-corrections/jitter
  RECONCILIATION_MOBILE_ALPHA_MAX: 0.4, // Soften correction aggressiveness on mobile
  RECONCILIATION_MOBILE_ALPHA_SCALE: 16.0,
  RECONCILIATION_VISUAL_OFFSET_DAMPING: 12.0, // Smoothly decays visual correction offset back to zero
  RECONCILIATION_VISUAL_OFFSET_MAX: 1.0, // Clamp visual correction offset to avoid runaway divergence
  RECONCILIATION_MOBILE_VISUAL_OFFSET_MAX: 0.35, // Mobile shows less visual-only offset from authority
  RECONCILIATION_COMBAT_VISUAL_OFFSET_MAX: 0.12, // Near-collision clamp so what player sees matches host checks
  RECONCILIATION_COMBAT_LOCK_DISTANCE: 8.0,
  RECONCILIATION_MOBILE_ROT_ALPHA_MAX: 0.24,
  RECONCILIATION_MOBILE_ROT_ALPHA_SCALE: 7.0,
  HARD_SNAP_THRESHOLD: 5.0,           // Instant teleport above this distance
  EXTRAPOLATION_STALE_THRESHOLD: 200, // Fallback to last position if snapshot > this ms old

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
  NPC_PIGEON_ENERGY: 75,
  NPC_RAT_ENERGY: 50,
  NPC_SQUIRREL_ENERGY: 75,
  NPC_PIGEON_RESPAWN: 45,
  NPC_RAT_RESPAWN: 30,
  NPC_SQUIRREL_RESPAWN: 35,
  NPC_PIGEON_FLEE_RANGE: 5,
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
  NPC_COLLISION_RADIUS_MULT: 1.5, // Global NPC hitbox scale multiplier
  NPC_PIGEON_RADIUS: 0.6,
  NPC_RAT_RADIUS: 0.4,
  NPC_SQUIRREL_RADIUS: 0.6,

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

  // Touch controls
  TOUCH_DEADZONE: 0.14,
  TOUCH_STRAFE_SCALE: 1.0,
  TOUCH_PITCH_SCALE: 9.5,
  TOUCH_STICK_RESPONSE_EXPONENT: 1.75,
  TOUCH_PITCH_RESPONSE_EXPONENT: 1.0,
  TOUCH_STICK_FOLLOW_RATE: 16.0,
  TOUCH_STICK_RETURN_RATE: 10.0,
  TOUCH_THRUST_FOLLOW_RATE: 18.0,
  TOUCH_THRUST_RETURN_RATE: 7.0,
  TOUCH_MICRO_SNAP: 0.03,
  TOUCH_PITCH_CENTER_RATE: 6.0,
  TOUCH_PITCH_CENTER_INPUT_THRESHOLD: 0.06,
  TOUCH_PITCH_CENTER_SNAP: 0.004,
  TOUCH_STICK_RADIUS: 60,
  TOUCH_KNOB_RADIUS: 25,
  TOUCH_BUTTON_SIZE: 56,

  // Mobile performance
  MOBILE_PIXEL_RATIO_CAP: 1.5,
  MOBILE_SHADOWS_ENABLED: false,
  MOBILE_SHADOW_MAP_SIZE: 512,
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
