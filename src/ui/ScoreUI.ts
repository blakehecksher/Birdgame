/**
 * Score UI Manager
 * Displays round end results and scores
 */
export interface RoundEndOptions {
  canStartNextRound?: boolean;
  nextRoundLabel?: string;
  statusText?: string;
  personalBestCallouts?: string[];
}

export class ScoreUI {
  private scoreScreen: HTMLElement;
  private scoreTitle: HTMLElement;
  private scoreDetails: HTMLElement;
  private scoreStatus: HTMLElement;
  private nextRoundBtn: HTMLButtonElement;

  private onNextRoundCallback: (() => void) | null = null;

  constructor() {
    this.scoreScreen = document.getElementById('score-screen')!;
    this.scoreTitle = document.getElementById('score-title')!;
    this.scoreDetails = document.getElementById('score-details')!;
    this.scoreStatus = document.getElementById('score-status')!;
    this.nextRoundBtn = document.getElementById('next-round-btn') as HTMLButtonElement;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.nextRoundBtn.addEventListener('click', () => {
      this.hide();
      if (this.onNextRoundCallback) {
        this.onNextRoundCallback();
      }
    });
  }

  /**
   * Show round end screen with results
   */
  public showRoundEnd(
    winner: 'pigeon' | 'hawk',
    pigeonWeight: number,
    survivalTime: number,
    pigeonScore: { totalWeight: number; roundsWon: number },
    hawkScore: { killTimes: number[]; roundsWon: number },
    options: RoundEndOptions = {}
  ): void {
    if (winner === 'hawk') {
      this.scoreTitle.textContent = 'Hawk Wins!';
    } else {
      this.scoreTitle.textContent = 'Pigeon Survived!';
    }

    const minutes = Math.floor(survivalTime / 60);
    const seconds = Math.floor(survivalTime % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    let detailsHTML = `
      <div class="score-item">
        <strong>Pigeon Weight:</strong> ${pigeonWeight.toFixed(1)} units
      </div>
      <div class="score-item">
        <strong>Survival Time:</strong> ${timeStr}
      </div>
      <hr style="margin: 20px 0; border-color: #666;">
      <div class="score-item">
        <strong>Cumulative Scores:</strong>
      </div>
      <div class="score-item">
        Pigeon - Total Weight: ${pigeonScore.totalWeight.toFixed(1)} | Rounds Won: ${pigeonScore.roundsWon}
      </div>
      <div class="score-item">
        Hawk - Avg Kill Time: ${this.getAverageKillTime(hawkScore.killTimes)} | Rounds Won: ${hawkScore.roundsWon}
      </div>
    `;

    if (options.personalBestCallouts && options.personalBestCallouts.length > 0) {
      detailsHTML += `
        <hr style="margin: 20px 0; border-color: #666;">
        ${options.personalBestCallouts
          .map((callout) => `<div class="score-item"><strong>${callout}</strong></div>`)
          .join('')}
      `;
    }

    this.scoreDetails.innerHTML = detailsHTML;
    this.scoreStatus.textContent = options.statusText ?? 'Round over. Ready for the next run.';
    this.nextRoundBtn.textContent = options.nextRoundLabel ?? 'Play Again';
    this.nextRoundBtn.disabled = options.canStartNextRound === false;
    this.show();
  }

  /**
   * Calculate average kill time for hawk
   */
  private getAverageKillTime(killTimes: number[]): string {
    if (killTimes.length === 0) return 'N/A';
    const avg = killTimes.reduce((a, b) => a + b, 0) / killTimes.length;
    const minutes = Math.floor(avg / 60);
    const seconds = Math.floor(avg % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Show score screen
   */
  public show(): void {
    this.scoreScreen.style.display = 'block';
  }

  /**
   * Hide score screen
   */
  public hide(): void {
    this.scoreScreen.style.display = 'none';
  }

  /**
   * Register callback for next round button
   */
  public onNextRound(callback: () => void): void {
    this.onNextRoundCallback = callback;
  }
}
