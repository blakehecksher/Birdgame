import Peer, { DataConnection } from 'peerjs';
import { NetworkMessage } from './messages';

/**
 * Wrapper for PeerJS to simplify WebRTC connection
 */
export class PeerConnection {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private isHost: boolean = false;
  private storedHostPeerId: string | null = null;
  private onMessageCallback: ((message: NetworkMessage, peerId: string) => void) | null = null;
  private onConnectedCallback: ((peerId: string) => void) | null = null;
  private onDisconnectedCallback: ((peerId?: string) => void) | null = null;
  private onReconnectedCallback: (() => void) | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private isReconnecting: boolean = false;

  // Mobile background handling
  private keepAliveInterval: number | null = null;
  private pageHiddenTime: number = 0;
  private readonly MAX_BACKGROUND_TIME = 30000; // 30 seconds max background time

  public async initializeAsHost(roomCode?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const peerId = roomCode ? `birdgame-${roomCode}` : undefined;
        this.peer = peerId ? new Peer(peerId) : new Peer();
        this.isHost = true;

        this.peer.on('open', (id) => {
          console.log('Host peer ID:', id);
          this.startKeepAlive();
          this.setupVisibilityHandlers();
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          console.log('Client connected:', conn.peer);
          this.connections.set(conn.peer, conn);
          this.setupConnectionHandlers(conn);

          if (this.isReconnecting) {
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            if (this.onReconnectedCallback) {
              this.onReconnectedCallback();
            }
          }

          if (this.onConnectedCallback) {
            this.onConnectedCallback(conn.peer);
          }
        });

        this.peer.on('error', (error) => {
          console.error('Peer error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public async initializeAsClient(hostPeerId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer();
        this.isHost = false;
        this.storedHostPeerId = hostPeerId;

        this.peer.on('open', (id) => {
          console.log('Client peer ID:', id);

          const connection = this.peer!.connect(hostPeerId, { reliable: true });
          this.connections.set(hostPeerId, connection);
          this.setupConnectionHandlers(connection);
          resolve(id);
        });

        this.peer.on('error', (error) => {
          console.error('Peer error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private setupConnectionHandlers(connection: DataConnection): void {
    connection.on('open', () => {
      console.log('Connection opened:', connection.peer);
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      if (!this.isHost && this.onConnectedCallback) {
        this.onConnectedCallback(connection.peer);
      }
    });

    connection.on('data', (data) => {
      if (this.onMessageCallback) {
        this.onMessageCallback(data as NetworkMessage, connection.peer);
      }
    });

    connection.on('close', () => {
      console.log('Connection closed:', connection.peer);
      this.connections.delete(connection.peer);
      this.attemptReconnect(connection.peer);
    });

    connection.on('error', (error) => {
      console.error('Connection error:', error);
    });
  }

  private attemptReconnect(peerId?: string): void {
    if (this.isHost) {
      console.log('Client disconnected. Waiting for reconnection...');
      this.isReconnecting = true;
      if (this.onDisconnectedCallback) {
        this.onDisconnectedCallback(peerId);
      }
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      this.isReconnecting = false;
      if (this.onDisconnectedCallback) {
        this.onDisconnectedCallback(peerId);
      }
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    console.log(`Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);

    setTimeout(() => {
      if (!this.peer || this.peer.destroyed) {
        this.peer = new Peer();
        this.peer.on('open', () => this.connectToHost());
        this.peer.on('error', (error) => {
          console.error('Reconnect peer error:', error);
          this.attemptReconnect(peerId);
        });
      } else if (this.peer.disconnected) {
        this.peer.reconnect();
        this.peer.on('open', () => this.connectToHost());
      } else {
        this.connectToHost();
      }
    }, 2000);
  }

  private connectToHost(): void {
    if (!this.peer || !this.storedHostPeerId) return;

    const connection = this.peer.connect(this.storedHostPeerId, {
      reliable: true,
    });

    this.connections.set(this.storedHostPeerId, connection);

    connection.on('open', () => {
      console.log('Reconnected to host');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      if (this.onReconnectedCallback) {
        this.onReconnectedCallback();
      }
    });

    connection.on('data', (data) => {
      if (this.onMessageCallback) {
        this.onMessageCallback(data as NetworkMessage, connection.peer);
      }
    });

    connection.on('close', () => {
      console.log('Reconnected connection closed');
      this.connections.delete(connection.peer);
      this.attemptReconnect(connection.peer);
    });

    connection.on('error', (error) => {
      console.error('Reconnect connection error:', error);
      this.attemptReconnect(connection.peer);
    });
  }

  public send(message: NetworkMessage, peerId?: string): void {
    if (peerId) {
      const conn = this.connections.get(peerId);
      if (conn?.open) conn.send(message);
      return;
    }

    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(message);
      }
    });
  }

  public onMessage(callback: (message: NetworkMessage, peerId: string) => void): void {
    this.onMessageCallback = callback;
  }

  public onConnected(callback: (peerId: string) => void): void {
    this.onConnectedCallback = callback;
  }

  public onDisconnected(callback: (peerId?: string) => void): void {
    this.onDisconnectedCallback = callback;
  }

  public onReconnected(callback: () => void): void {
    this.onReconnectedCallback = callback;
  }

  public isConnected(): boolean {
    for (const conn of this.connections.values()) {
      if (conn.open) return true;
    }
    return false;
  }

  public getIsReconnecting(): boolean {
    return this.isReconnecting;
  }

  public getPeerId(): string | null {
    return this.peer?.id || null;
  }

  public getRemotePeerId(): string | null {
    for (const [peerId, conn] of this.connections.entries()) {
      if (conn.open) return peerId;
    }
    return null;
  }

  public getRemotePeerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  public isHostPeer(): boolean {
    return this.isHost;
  }

  /**
   * Send keep-alive pings to maintain connection during brief background
   */
  private startKeepAlive(): void {
    if (this.keepAliveInterval !== null) return;

    this.keepAliveInterval = window.setInterval(() => {
      // Send tiny ping message to all connections to keep them alive
      this.connections.forEach((conn) => {
        if (conn.open) {
          try {
            conn.send({ type: 'PING', timestamp: Date.now() });
          } catch (e) {
            console.warn('Keep-alive ping failed:', e);
          }
        }
      });
    }, 10000); // Every 10 seconds
  }

  /**
   * Handle page visibility changes (mobile app switching)
   */
  private setupVisibilityHandlers(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Page going to background
        this.pageHiddenTime = Date.now();
        console.log('[Mobile] Page hidden, connection may suspend');
      } else {
        // Page coming back to foreground
        const backgroundDuration = Date.now() - this.pageHiddenTime;
        console.log(`[Mobile] Page visible again (was hidden ${backgroundDuration}ms)`);

        if (backgroundDuration > this.MAX_BACKGROUND_TIME) {
          // Was in background too long, connection likely dead
          console.warn('[Mobile] Connection may be dead after long background time');
          this.attemptHealthCheck();
        } else {
          // Brief background, check if peer is still alive
          this.checkPeerHealth();
        }
      }
    });

    // iOS-specific: pagehide/pageshow events
    window.addEventListener('pagehide', () => {
      console.log('[Mobile] Page hiding (iOS)');
      this.pageHiddenTime = Date.now();
    });

    window.addEventListener('pageshow', () => {
      const backgroundDuration = Date.now() - this.pageHiddenTime;
      console.log(`[Mobile] Page showing (iOS), was hidden ${backgroundDuration}ms`);
      if (backgroundDuration > this.MAX_BACKGROUND_TIME) {
        this.attemptHealthCheck();
      }
    });
  }

  /**
   * Check if peer connection is still healthy
   */
  private checkPeerHealth(): void {
    if (!this.peer) return;

    if (this.peer.destroyed) {
      console.error('[Mobile] Peer was destroyed while in background');
      this.attemptHealthCheck();
    } else if (this.peer.disconnected) {
      console.warn('[Mobile] Peer disconnected while in background, reconnecting...');
      this.peer.reconnect();
    } else {
      console.log('[Mobile] Peer connection healthy');
    }
  }

  /**
   * Notify that peer connection may be unhealthy after background
   */
  private attemptHealthCheck(): void {
    console.log('[Mobile] Connection health check after long background time');
    // For host: notify UI that connection might be unstable
    if (this.isHost && this.onDisconnectedCallback) {
      // Don't fully disconnect, but warn that new clients might not connect
      console.warn('[Mobile] Host was in background too long, room may be unstable');
    }
  }

  public disconnect(): void {
    // Clear keep-alive timer
    if (this.keepAliveInterval !== null) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    this.isReconnecting = false;
    this.reconnectAttempts = this.maxReconnectAttempts;
    this.connections.forEach((connection) => connection.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
