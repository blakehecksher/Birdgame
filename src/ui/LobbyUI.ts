/**
 * Lobby UI Manager
 * Handles the pre-game lobby interface for hosting/joining games
 */
export class LobbyUI {
  private lobbyElement: HTMLElement;
  private lobbyMenu: HTMLElement;
  private hostScreen: HTMLElement;
  private joinScreen: HTMLElement;

  private hostBtn: HTMLButtonElement;
  private joinBtn: HTMLButtonElement;
  private connectBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private peerIdDisplay: HTMLInputElement;
  private peerIdInput: HTMLInputElement;

  private onHostCallback: (() => void) | null = null;
  private onJoinCallback: ((peerId: string) => void) | null = null;

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
    this.peerIdDisplay = document.getElementById('peer-id-display') as HTMLInputElement;
    this.peerIdInput = document.getElementById('peer-id-input') as HTMLInputElement;

    this.setupEventListeners();
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
      if (peerId && this.onJoinCallback) {
        this.onJoinCallback(peerId);
      }
    });

    // Back button
    this.backBtn.addEventListener('click', () => {
      this.showMainMenu();
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
        if (linkEl) {
          navigator.clipboard.writeText(linkEl.value).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
          });
        }
      });
    }
  }

  /**
   * Show main lobby menu
   */
  public showMainMenu(): void {
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
    this.lobbyMenu.classList.add('hidden');
    this.hostScreen.classList.add('hidden');
    this.joinScreen.classList.remove('hidden');
    this.peerIdInput.value = '';
    this.peerIdInput.focus();
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
  }

  /**
   * Show loading/waiting state
   */
  public showWaiting(message: string): void {
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

  /**
   * Register callback for join button
   */
  public onJoin(callback: (peerId: string) => void): void {
    this.onJoinCallback = callback;
  }
}
