export const PERSONAL_BESTS_STORAGE_KEY = 'birdgame_personal_bests';

export interface PersonalBests {
  fattestPigeon: number | null;
  fastestHawkKill: number | null;
}

export type PersonalBestMetric = 'fattest_pigeon' | 'fastest_hawk_kill';

export interface PersonalBestUpdateResult {
  bests: PersonalBests;
  isNewBest: boolean;
}

export function createDefaultPersonalBests(): PersonalBests {
  return {
    fattestPigeon: null,
    fastestHawkKill: null,
  };
}

function normalizeBestValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function parsePersonalBests(raw: string | null): PersonalBests {
  if (!raw) return createDefaultPersonalBests();

  try {
    const parsed = JSON.parse(raw) as Partial<PersonalBests>;
    return {
      fattestPigeon: normalizeBestValue(parsed.fattestPigeon),
      fastestHawkKill: normalizeBestValue(parsed.fastestHawkKill),
    };
  } catch {
    return createDefaultPersonalBests();
  }
}

export function stringifyPersonalBests(bests: PersonalBests): string {
  return JSON.stringify(bests);
}

export function updatePersonalBest(
  current: PersonalBests,
  metric: PersonalBestMetric,
  value: number
): PersonalBestUpdateResult {
  if (!Number.isFinite(value) || value < 0) {
    return { bests: current, isNewBest: false };
  }

  if (metric === 'fattest_pigeon') {
    const existing = current.fattestPigeon;
    if (existing === null || value > existing) {
      return {
        bests: {
          ...current,
          fattestPigeon: value,
        },
        isNewBest: true,
      };
    }
    return { bests: current, isNewBest: false };
  }

  const existing = current.fastestHawkKill;
  if (existing === null || value < existing) {
    return {
      bests: {
        ...current,
        fastestHawkKill: value,
      },
      isNewBest: true,
    };
  }
  return { bests: current, isNewBest: false };
}

export function formatBestWeight(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(1)} lbs`;
}

export function formatBestTime(value: number | null): string {
  if (value === null) return '--';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
