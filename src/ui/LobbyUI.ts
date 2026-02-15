/**
 * Lobby UI Manager
 * Handles the pre-game lobby interface for hosting/joining games
 */
import { PersonalBests, formatBestTime, formatBestWeight } from './personalBests';

export const USERNAME_STORAGE_KEY = 'birdgame_username';

export function createFallbackUsername(randomFn: () => number = Math.random): string {
  const suffix = Math.floor(randomFn() * 900 + 100);
  return `bird-${suffix}`;
}

export function resolveUsername(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export class LobbyUI {
  private lobbyElement: HTMLElement;
  private lobbyMenu: HTMLElement;
  private hostScreen: HTMLElement;
  private joinScreen: HTMLElement;

  private hostBtn: HTMLButtonElement;
  private joinBtn: HTMLButtonElement;
  private connectBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private hostBackBtn: HTMLButtonElement;
  private peerIdDisplay: HTMLInputElement;
  private peerIdInput: HTMLInputElement;
  private usernameInput: HTMLInputElement;
  private joinUsernameInput: HTMLInputElement;
  private hostStatus: HTMLElement;
  private joinStatus: HTMLElement;
  private leaderboardFat: HTMLOListElement;
  private leaderboardKill: HTMLOListElement;
  private leaderboardStatus: HTMLElement;
  private personalBestFat: HTMLElement;
  private personalBestKill: HTMLElement;
  private personalBestBadge: HTMLElement;

  private onHostCallback: (() => void) | null = null;
  private onHostCancelCallback: (() => void) | null = null;
  private onJoinCallback: ((peerId: string) => void) | null = null;
  private fallbackUsername: string = createFallbackUsername();
  private pendingRoomCode: string | null = null;

  constructor() {
    // Get DOM elements
    this.lobbyElement = document.getElementById('lobby')!;
    this.lobbyMenu = document.getElementById('lobby-menu')!;
    this.hostScreen = document.getElementById('host-screen')!;
    this.joinScreen = document.getElementById('join-screen')!;

    this.hostBtn = document.getElementById('host-btn') as HTMLButtonElement;
    this.joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
    this.connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
    this.backBtn = document.getElementById('back-btn') as HTMLButtonElement;
    this.hostBackBtn = document.getElementById('host-back-btn') as HTMLButtonElement;
    this.peerIdDisplay = document.getElementById('peer-id-display') as HTMLInputElement;
    this.peerIdInput = document.getElementById('peer-id-input') as HTMLInputElement;
    this.usernameInput = document.getElementById('username-input') as HTMLInputElement;
    this.joinUsernameInput = document.getElementById('join-username-input') as HTMLInputElement;
    this.hostStatus = document.getElementById('host-status') as HTMLElement;
    this.joinStatus = document.getElementById('join-status') as HTMLElement;
    this.leaderboardFat = document.getElementById('leaderboard-fat') as HTMLOListElement;
    this.leaderboardKill = document.getElementById('leaderboard-kill') as HTMLOListElement;
    this.leaderboardStatus = document.getElementById('leaderboard-status') as HTMLElement;
    this.personalBestFat = document.getElementById('personal-best-fat') as HTMLElement;
    this.personalBestKill = document.getElementById('personal-best-kill') as HTMLElement;
    this.personalBestBadge = document.getElementById('personal-best-badge') as HTMLElement;

    this.setupEventListeners();
    this.restoreUsername();
  }

  private setupEventListeners(): void {
    // Host button
    this.hostBtn.addEventListener('click', () => {
      this.showHostScreen();
      if (this.onHostCallback) {
        this.onHostCallback();
      }
    });

    // Join button
    this.joinBtn.addEventListener('click', () => {
      this.showJoinScreen();
    });

    // Connect button
    this.connectBtn.addEventListener('click', () => {
      const peerId = this.peerIdInput.value.trim();
      if (!peerId) {
        this.setJoinStatus('Enter a room code to connect.');
        return;
      }
      this.getEffectiveUsername();
      if (this.onJoinCallback) {
        this.onJoinCallback(peerId);
      }
    });

    // Back button
    this.backBtn.addEventListener('click', () => {
      this.showMainMenu();
    });
    this.hostBackBtn.addEventListener('click', () => {
      this.showMainMenu();
      if (this.onHostCancelCallback) {
        this.onHostCancelCallback();
      }
    });

    // Enter key in join input
    this.peerIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.connectBtn.click();
      }
    });
    // Copy link button
    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const linkEl = document.getElementById('room-link') as HTMLInputElement;
        if (!linkEl) return;
        navigator.clipboard.writeText(linkEl.value).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
        });
      });
    }

    // Copy room code button
    const copyCodeBtn = document.getElementById('copy-code-btn');
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', () => {
        const codeEl = document.getElementById('room-code');
        const code = codeEl?.textContent?.trim() ?? '';
        if (!code) return;
        navigator.clipboard.writeText(code).then(() => {
          copyCodeBtn.textContent = 'Copied!';
          setTimeout(() => { copyCodeBtn.textContent = 'Copy Code'; }, 2000);
        });
      });
    }

    const syncFromMain = () => this.setUsername(this.usernameInput.value);
    const syncFromJoin = () => this.setUsername(this.joinUsernameInput.value);
    this.usernameInput.addEventListener('input', syncFromMain);
    this.joinUsernameInput.addEventListener('input', syncFromJoin);
  }

  private restoreUsername(): void {
    const saved = localStorage.getItem(USERNAME_STORAGE_KEY)?.trim() ?? '';
    const restored = resolveUsername(saved, this.fallbackUsername);
    this.setUsername(restored, true);
  }

  private setUsername(value: string, persist: boolean = true): void {
    const trimmed = value.trim();
    this.usernameInput.value = trimmed;
    this.joinUsernameInput.value = trimmed;
    if (persist) {
      localStorage.setItem(USERNAME_STORAGE_KEY, trimmed);
    }
  }

  private setHostStatus(message: string): void {
    this.hostStatus.textContent = message;
  }

  private setJoinStatus(message: string): void {
    this.joinStatus.textContent = message;
  }

  private resetJoinControls(): void {
    this.peerIdInput.disabled = false;
    this.connectBtn.disabled = false;
    this.connectBtn.textContent = 'Connect';
    this.setJoinStatus('Input username (optional), then enter room code.');
  }

  /**
   * Show main lobby menu
   */
  public showMainMenu(): void {
    this.resetJoinControls();
    this.setHostStatus('Waiting for player to join...');
    this.lobbyMenu.classList.remove('hidden');
    this.hostScreen.classList.add('hidden');
    this.joinScreen.classList.add('hidden');
  }

  /**
   * Show host screen with peer ID
   */
  private showHostScreen(): void {
    this.lobbyMenu.classList.add('hidden');
    this.hostScreen.classList.remove('hidden');
    this.joinScreen.classList.add('hidden');
  }

  /**
   * Show join screen
   */
  private showJoinScreen(): void {
    this.resetJoinControls();
    this.lobbyMenu.classList.add('hidden');
    this.hostScreen.classList.add('hidden');
    this.joinScreen.classList.remove('hidden');
    this.peerIdInput.value = this.pendingRoomCode ?? '';
    this.pendingRoomCode = null;
    this.joinUsernameInput.value = this.usernameInput.value.trim();
    this.peerIdInput.focus();
    if (this.peerIdInput.value) {
      this.peerIdInput.select();
    }
  }

  /**
   * Display peer ID for host (legacy)
   */
  public displayPeerId(peerId: string): void {
    this.peerIdDisplay.value = peerId;
    this.peerIdDisplay.select();
  }

  /**
   * Display shareable room link
   */
  public displayRoomLink(roomCode: string): void {
    // Show room code
    const codeEl = document.getElementById('room-code');
    if (codeEl) codeEl.textContent = roomCode;

    // Build shareable URL
    const url = new URL(window.location.href);
    url.search = `?room=${roomCode}`;
    const shareUrl = url.toString();

    const linkEl = document.getElementById('room-link') as HTMLInputElement;
    if (linkEl) {
      linkEl.value = shareUrl;
      linkEl.select();
    }

    // Also set the old peer ID display for fallback
    this.peerIdDisplay.value = roomCode;
    this.setHostStatus('Waiting for friends to join...');
  }

  /**
   * Show lobby
   */
  public show(): void {
    this.lobbyElement.style.display = 'block';
    this.showMainMenu();
  }

  /**
   * Hide lobby
   */
  public hide(): void {
    this.lobbyElement.style.display = 'none';
  }

  /**
   * Show connecting state on join screen
   */
  public showConnecting(): void {
    this.lobbyMenu.classList.add('hidden');
    this.hostScreen.classList.add('hidden');
    this.joinScreen.classList.remove('hidden');
    this.peerIdInput.disabled = true;
    this.connectBtn.disabled = true;
    this.connectBtn.textContent = 'Connecting...';
    this.setJoinStatus('Connecting to host...');
  }

  /**
   * Show loading/waiting state
   */
  public showWaiting(message: string): void {
    if (!this.hostScreen.classList.contains('hidden')) {
      this.setHostStatus(message);
      return;
    }
    if (!this.joinScreen.classList.contains('hidden')) {
      this.setJoinStatus(message);
      return;
    }
    console.log('Waiting:', message);
  }

  /**
   * Show error message
   */
  public showError(message: string): void {
    alert(`Error: ${message}`);
  }

  /**
   * Register callback for host button
   */
  public onHost(callback: () => void): void {
    this.onHostCallback = callback;
  }

  public onHostCancel(callback: () => void): void {
    this.onHostCancelCallback = callback;
  }

  /**
   * Register callback for join button
   */
  public onJoin(callback: (peerId: string) => void): void {
    this.onJoinCallback = callback;
  }

  public getUsername(): string {
    return this.usernameInput.value.trim();
  }

  public getEffectiveUsername(): string {
    const username = resolveUsername(this.usernameInput.value, this.fallbackUsername);
    this.setUsername(username, true);
    return username;
  }

  public prefillJoinRoomCode(roomCode: string): void {
    this.pendingRoomCode = roomCode;
    this.showJoinScreen();
  }

  public setLeaderboardStatus(text: string): void {
    this.leaderboardStatus.textContent = text;
  }

  public renderLeaderboard(
    fattest: Array<{ username: string; value: number }>,
    fastest: Array<{ username: string; value: number }>
  ): void {
    this.leaderboardFat.innerHTML = fattest.length
      ? fattest
          .map((row, idx) => this.renderLeaderboardRow(
            `${idx + 1}. ${this.escapeHtml(row.username)}`,
            `${row.value.toFixed(1)} lbs`
          ))
          .join('')
      : '<li class="leaderboard-empty">No entries yet</li>';

    this.leaderboardKill.innerHTML = fastest.length
      ? fastest
          .map((row, idx) => this.renderLeaderboardRow(
            `${idx + 1}. ${this.escapeHtml(row.username)}`,
            this.formatSeconds(row.value)
          ))
          .join('')
      : '<li class="leaderboard-empty">No entries yet</li>';
  }

  private renderLeaderboardRow(left: string, right: string): string {
    return `<li><span class="leader-left">${left}</span><span class="leader-dots" aria-hidden="true"></span><span class="leader-right">${right}</span></li>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatSeconds(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  public renderPersonalBests(bests: PersonalBests): void {
    this.personalBestFat.textContent = `Fattest pigeon: ${formatBestWeight(bests.fattestPigeon)}`;
    this.personalBestKill.textContent = `Fastest hawk kill: ${formatBestTime(bests.fastestHawkKill)}`;
  }

  public showPersonalBestBadge(show: boolean): void {
    this.personalBestBadge.style.display = show ? 'inline-block' : 'none';
  }
}

