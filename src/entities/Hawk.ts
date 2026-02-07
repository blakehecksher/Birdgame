import { GAME_CONFIG } from '../config/constants';
import { Player } from './Player';

/**
 * Hawk-specific energy and speed behavior.
 */
export class Hawk {
  private player: Player;
  private energy: number;
  private isDiving: boolean = false;

  constructor(player: Player) {
    this.player = player;
    this.energy = GAME_CONFIG.HAWK_INITIAL_ENERGY;
    this.applyToPlayer();
  }

  public getEnergy(): number {
    return this.energy;
  }

  public setEnergy(energy: number): void {
    this.energy = Math.max(0, Math.min(100, energy));
    this.applyToPlayer();
  }

  public addEnergy(amount: number): void {
    this.setEnergy(this.energy + amount);
  }

  public getIsDiving(): boolean {
    return this.isDiving;
  }

  public update(deltaTime: number): void {
    // Check dive state: diving when pitch is significantly negative (looking down)
    const pitch = this.player.rotation.x;
    this.isDiving = pitch < -0.15 && this.player.velocity.y < -0.5;

    // Extra energy drain while diving
    const drainMult = this.isDiving ? GAME_CONFIG.HAWK_DIVE_ENERGY_DRAIN_MULT : 1.0;
    this.setEnergy(this.energy - (GAME_CONFIG.HAWK_ENERGY_DRAIN_RATE * drainMult * deltaTime));
  }

  public reset(): void {
    this.energy = GAME_CONFIG.HAWK_INITIAL_ENERGY;
    this.isDiving = false;
    this.applyToPlayer();
  }

  private applyToPlayer(): void {
    let mult = 1.0;

    if (this.energy < GAME_CONFIG.HAWK_LOW_ENERGY_THRESHOLD) {
      mult = GAME_CONFIG.HAWK_LOW_ENERGY_SPEED_MULT;
    } else if (this.energy > 75) {
      mult = GAME_CONFIG.HAWK_BOOSTED_SPEED_MULT;
    }

    // Dive speed bonus: scale with pitch angle (steeper = faster)
    if (this.isDiving) {
      const pitch = this.player.rotation.x; // negative when looking down
      const maxPitch = GAME_CONFIG.MAX_PITCH;
      const diveFraction = Math.min(1.0, Math.abs(pitch) / maxPitch);
      const diveBonus = 1.0 + diveFraction * (GAME_CONFIG.HAWK_DIVE_MAX_SPEED_MULT - 1.0);
      mult *= diveBonus;
    }

    this.player.speedMultiplier = mult;
  }
}
