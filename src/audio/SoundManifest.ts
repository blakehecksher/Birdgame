import { SoundManifestEntry } from './AudioManager';

/**
 * Sound manifest — all game sounds with their file paths.
 * All entries are optional so the game works silently without any sound files.
 * Drop .mp3/.ogg/.wav files into public/sounds/ matching these paths.
 */
export const SOUND_MANIFEST: SoundManifestEntry[] = [
  // Hawk sounds
  { key: 'hawk_screech', path: 'sounds/hawk_screech.mp3', optional: true },
  { key: 'hawk_dive', path: 'sounds/hawk_dive.mp3', optional: true },

  // Eating / pickup
  { key: 'eat_crumb', path: 'sounds/eat_crumb.mp3', optional: true },
  { key: 'eat_bagel', path: 'sounds/eat_bagel.mp3', optional: true },
  { key: 'eat_pizza', path: 'sounds/eat_pizza.mp3', optional: true },
  { key: 'npc_kill', path: 'sounds/npc_kill.mp3', optional: true },

  // Round events
  { key: 'round_start', path: 'sounds/round_start.mp3', optional: true },
  { key: 'round_end', path: 'sounds/round_end.mp3', optional: true },
  { key: 'hawk_wins', path: 'sounds/hawk_wins.mp3', optional: true },
  { key: 'pigeon_wins', path: 'sounds/pigeon_wins.mp3', optional: true },

  // Wing / flight
  { key: 'wing_flap', path: 'sounds/wing_flap.mp3', optional: true },

  // Ambient
  { key: 'ambient_city', path: 'sounds/ambient_city.mp3', optional: true },
  { key: 'wind_loop', path: 'sounds/wind_loop.mp3', optional: true },

  // UI
  { key: 'ui_click', path: 'sounds/ui_click.mp3', optional: true },
];

/** Sound keys for type-safe access */
export const SFX = {
  HAWK_SCREECH: 'hawk_screech',
  HAWK_DIVE: 'hawk_dive',
  EAT_CRUMB: 'eat_crumb',
  EAT_BAGEL: 'eat_bagel',
  EAT_PIZZA: 'eat_pizza',
  NPC_KILL: 'npc_kill',
  ROUND_START: 'round_start',
  ROUND_END: 'round_end',
  HAWK_WINS: 'hawk_wins',
  PIGEON_WINS: 'pigeon_wins',
  WING_FLAP: 'wing_flap',
  AMBIENT_CITY: 'ambient_city',
  WIND_LOOP: 'wind_loop',
  UI_CLICK: 'ui_click',
} as const;
