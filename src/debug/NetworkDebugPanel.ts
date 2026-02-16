/**
 * Network Debug Panel
 *
 * Shows real-time network statistics and diagnostic info.
 * Toggle with keyboard shortcuts (1-4 keys).
 */

export interface NetworkStats {
  rtt: number; // Round-trip time (ms)
  jitter: number; // RTT variance (ms)
  packetLoss: number; // Percentage 0-1
  fps: number; // Current frame rate
  reconciliationError: number; // Distance error (units)
  interpolationBufferSize: number; // Number of snapshots buffered
  interpolationUnderruns: number; // Count of buffer empty events
  extrapolationCount: number; // Count of extrapolation activations
  tickRate: number; // Network update rate (Hz)
  isHost: boolean; // Is this client the host
  playerCount: number; // Number of connected players
}

export enum DebugPanelMode {
  HIDDEN = 0,
  STATS_ONLY = 1,
  STATS_AND_HITBOXES = 2,
}

export class NetworkDebugPanel {
  private container: HTMLDivElement;
  private mode: DebugPanelMode = DebugPanelMode.HIDDEN;
  private stats: NetworkStats | null = null;
  private lastUpdateTime: number = 0;
  private readonly UPDATE_INTERVAL = 100; // Update display every 100ms
  private onModeChangeCallback: ((mode: DebugPanelMode) => void) | null = null;

  constructor() {
    this.container = this.createPanel();
    document.body.appendChild(this.container);
    this.setupKeyboardHandler();
  }

  public onModeChange(callback: (mode: DebugPanelMode) => void): void {
    this.onModeChangeCallback = callback;
  }

  private createPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'network-debug-panel';
    panel.style.cssText = `
      display: none;
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      padding: 10px;
      border: 2px solid #0f0;
      border-radius: 5px;
      z-index: 9999;
      min-width: 280px;
      pointer-events: none;
      user-select: none;
    `;
    return panel;
  }

  private setupKeyboardHandler(): void {
    document.addEventListener('keydown', (e) => {
      // F3 key toggles modes
      if (e.key === 'F3') {
        e.preventDefault();
        this.cycleMode();
      }
      // Direct mode selection with 1-3 keys (when Ctrl is held)
      else if (e.ctrlKey && e.key >= '1' && e.key <= '3') {
        e.preventDefault();
        const modeNum = parseInt(e.key, 10) - 1;
        this.setMode(modeNum as DebugPanelMode);
      }
    });
  }

  private cycleMode(): void {
    // Cycle: HIDDEN -> STATS_ONLY -> STATS_AND_HITBOXES -> HIDDEN
    const nextMode = (this.mode + 1) % 3;
    this.setMode(nextMode as DebugPanelMode);
  }

  public setMode(mode: DebugPanelMode): void {
    this.mode = mode;

    switch (mode) {
      case DebugPanelMode.HIDDEN:
        this.container.style.display = 'none';
        console.log('[Debug] Network debug panel hidden');
        break;
      case DebugPanelMode.STATS_ONLY:
        this.container.style.display = 'block';
        console.log('[Debug] Network stats visible (press F3 again for hitboxes)');
        break;
      case DebugPanelMode.STATS_AND_HITBOXES:
        this.container.style.display = 'block';
        console.log('[Debug] Network stats + collision hitboxes visible (press F3 to hide)');
        break;
    }

    // Trigger re-render
    if (this.stats) {
      this.render();
    }

    // Notify callback of mode change
    if (this.onModeChangeCallback) {
      this.onModeChangeCallback(mode);
    }
  }

  public getMode(): DebugPanelMode {
    return this.mode;
  }

  public updateStats(stats: NetworkStats): void {
    this.stats = stats;

    // Throttle display updates
    const now = Date.now();
    if (now - this.lastUpdateTime < this.UPDATE_INTERVAL) {
      return;
    }
    this.lastUpdateTime = now;

    if (this.mode !== DebugPanelMode.HIDDEN) {
      this.render();
    }
  }

  private render(): void {
    if (!this.stats) {
      this.container.innerHTML = '<div>No stats available</div>';
      return;
    }

    const s = this.stats;

    // Color-code values based on quality
    const rttColor = s.rtt < 50 ? '#0f0' : s.rtt < 100 ? '#ff0' : '#f00';
    const fpsColor = s.fps >= 55 ? '#0f0' : s.fps >= 30 ? '#ff0' : '#f00';
    const lossColor = s.packetLoss < 0.01 ? '#0f0' : s.packetLoss < 0.05 ? '#ff0' : '#f00';
    const errorColor = s.reconciliationError < 0.5 ? '#0f0' : s.reconciliationError < 2.0 ? '#ff0' : '#f00';

    this.container.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid #0f0; padding-bottom: 5px;">
        🔧 NETWORK DEBUG ${this.mode === DebugPanelMode.STATS_AND_HITBOXES ? '+ HITBOXES' : ''}
      </div>

      <div style="line-height: 1.4;">
        <div><strong>Role:</strong> ${s.isHost ? 'HOST' : 'CLIENT'}</div>
        <div><strong>Players:</strong> ${s.playerCount}</div>
        <div><strong>Tick Rate:</strong> ${s.tickRate}Hz</div>
        <div style="height: 4px;"></div>

        <div><strong>FPS:</strong> <span style="color: ${fpsColor};">${s.fps.toFixed(1)}</span></div>
        <div><strong>RTT (ping):</strong> <span style="color: ${rttColor};">${s.rtt.toFixed(0)}ms</span></div>
        <div><strong>Jitter:</strong> ${s.jitter.toFixed(1)}ms</div>
        <div><strong>Packet Loss:</strong> <span style="color: ${lossColor};">${(s.packetLoss * 100).toFixed(1)}%</span></div>
        <div style="height: 4px;"></div>

        ${!s.isHost ? `
          <div><strong>Recon Error:</strong> <span style="color: ${errorColor};">${s.reconciliationError.toFixed(2)}u</span></div>
          <div><strong>Interp Buffer:</strong> ${s.interpolationBufferSize} snapshots</div>
          <div><strong>Underruns:</strong> ${s.interpolationUnderruns}</div>
          <div><strong>Extrap Count:</strong> ${s.extrapolationCount}</div>
        ` : ''}
      </div>

      <div style="margin-top: 8px; padding-top: 5px; border-top: 1px solid #0f0; font-size: 10px; opacity: 0.7;">
        Press F3 to cycle modes
      </div>
    `;
  }

  public destroy(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
