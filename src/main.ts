import { Game } from './core/Game';

/**
 * Entry point for Hawk & Pigeon game
 */

// Initialize game when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new Game();
  });
} else {
  new Game();
}
