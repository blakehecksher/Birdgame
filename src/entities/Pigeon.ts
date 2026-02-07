import { GAME_CONFIG } from '../config/constants';
import { Player } from './Player';

/**
 * Pigeon-specific stats and scaling behavior.
 */
export class Pigeon {
  private player: Player;
  private weight: number;

  constructor(player: Player) {
    this.player = player;
    this.weight = GAME_CONFIG.PIGEON_INITIAL_WEIGHT;
    this.applyToPlayer();
  }

  public getWeight(): number {
    return this.weight;
  }

  public setWeight(weight: number): void {
    this.weight = Math.max(0, weight);
    this.applyToPlayer();
  }

  public addWeight(amount: number): void {
    this.setWeight(this.weight + amount);
  }

  public reset(): void {
    this.weight = GAME_CONFIG.PIGEON_INITIAL_WEIGHT;
    this.applyToPlayer();
  }

  private applyToPlayer(): void {
    const speedMultiplier = Math.max(
      GAME_CONFIG.PIGEON_MIN_SPEED,
      1 - (this.weight * GAME_CONFIG.PIGEON_WEIGHT_PENALTY)
    );
    this.player.speedMultiplier = speedMultiplier;

    const scale = 1 + (this.weight * GAME_CONFIG.PIGEON_SIZE_SCALE);
    this.player.mesh.scale.setScalar(scale);
  }
}
