/**
 * Deterministic pseudo-random number generator using mulberry32.
 * Given the same seed, produces the same sequence of numbers on any platform.
 * Used for world generation so both peers produce identical maps from a shared seed.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] (inclusive) */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns a float in [min, max) */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Pick a random element from an array */
  pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }

  /** Returns true with the given probability (0-1) */
  chance(probability: number): boolean {
    return this.next() < probability;
  }
}
