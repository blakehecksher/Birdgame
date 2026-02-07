import Peer, { DataConnection } from 'peerjs';
import { NetworkMessage } from './messages';

/**
 * Wrapper for PeerJS to simplify WebRTC connection
 */
export class PeerConnection {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private isHost: boolean = false;
  private storedHostPeerId: string | null = null;
  private onMessageCallback: ((message: NetworkMessage) => void) | null = null;
  private onConnectedCallback: ((peerId: string) => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  private onReconnectedCallback: (() => void) | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private isReconnecting: boolean = false;

  /**
   * Initialize as host with optional custom peer ID
   */
  public async initializeAsHost(roomCode?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const peerId = roomCode ? `birdgame-${roomCode}` : undefined;
        this.peer = peerId ? new Peer(peerId) : new Peer();
        this.isHost = true;

        this.peer.on('open', (id) => {
          console.log('Host peer ID:', id);
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          console.log('Client connected:', conn.peer);
          this.connection = conn;
          this.setupConnectionHandlers();

          if (this.isReconnecting) {
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            if (this.onReconnectedCallback) {
              this.onReconnectedCallback();
            }
          } else if (this.onConnectedCallback) {
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

  /**
   * Initialize as client and connect to host
   */
  public async initializeAsClient(hostPeerId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer();
        this.isHost = false;
        this.storedHostPeerId = hostPeerId;

        this.peer.on('open', (id) => {
          console.log('Client peer ID:', id);

          this.connection = this.peer!.connect(hostPeerId, {
            reliable: true,
          });

          this.setupConnectionHandlers();
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

  /**
   * Set up connection event handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on('open', () => {
      console.log('Connection opened');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      if (this.isReconnecting && this.onReconnectedCallback) {
        this.onReconnectedCallback();
      } else if (!this.isHost && this.onConnectedCallback) {
        this.onConnectedCallback(this.connection!.peer);
      }
    });

    this.connection.on('data', (data) => {
      if (this.onMessageCallback) {
        this.onMessageCallback(data as NetworkMessage);
      }
    });

    this.connection.on('close', () => {
      console.log('Connection closed');
      this.attemptReconnect();
    });

    this.connection.on('error', (error) => {
      console.error('Connection error:', error);
    });
  }

  /**
   * Attempt to reconnect after disconnect
   */
  private attemptReconnect(): void {
    if (this.isHost) {
      // Host waits for client to reconnect
      console.log('Client disconnected. Waiting for reconnection...');
      this.isReconnecting = true;
      if (this.onDisconnectedCallback) {
        this.onDisconnectedCallback();
      }
      return;
    }

    // Client tries to reconnect to host
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      this.isReconnecting = false;
      if (this.onDisconnectedCallback) {
        this.onDisconnectedCallback();
      }
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    console.log(`Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);

    setTimeout(() => {
      if (!this.peer || this.peer.destroyed) {
        // Need a fresh peer
        this.peer = new Peer();
        this.peer.on('open', () => {
          this.connectToHost();
        });
        this.peer.on('error', (error) => {
          console.error('Reconnect peer error:', error);
          this.attemptReconnect();
        });
      } else if (this.peer.disconnected) {
        this.peer.reconnect();
        this.peer.on('open', () => {
          this.connectToHost();
        });
      } else {
        this.connectToHost();
      }
    }, 2000);
  }

  /**
   * Connect to stored host peer ID
   */
  private connectToHost(): void {
    if (!this.peer || !this.storedHostPeerId) return;

    this.connection = this.peer.connect(this.storedHostPeerId, {
      reliable: true,
    });

    this.connection.on('open', () => {
      console.log('Reconnected to host');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      if (this.onReconnectedCallback) {
        this.onReconnectedCallback();
      }
    });

    this.connection.on('data', (data) => {
      if (this.onMessageCallback) {
        this.onMessageCallback(data as NetworkMessage);
      }
    });

    this.connection.on('close', () => {
      console.log('Reconnected connection closed');
      this.attemptReconnect();
    });

    this.connection.on('error', (error) => {
      console.error('Reconnect connection error:', error);
      this.attemptReconnect();
    });
  }

  /**
   * Send message to connected peer
   */
  public send(message: NetworkMessage): void {
    if (this.connection && this.connection.open) {
      this.connection.send(message);
    }
  }

  /**
   * Register callback for incoming messages
   */
  public onMessage(callback: (message: NetworkMessage) => void): void {
    this.onMessageCallback = callback;
  }

  /**
   * Register callback for connection established
   */
  public onConnected(callback: (peerId: string) => void): void {
    this.onConnectedCallback = callback;
  }

  /**
   * Register callback for disconnection
   */
  public onDisconnected(callback: () => void): void {
    this.onDisconnectedCallback = callback;
  }

  /**
   * Register callback for successful reconnection
   */
  public onReconnected(callback: () => void): void {
    this.onReconnectedCallback = callback;
  }

  /**
   * Check if connected to peer
   */
  public isConnected(): boolean {
    return this.connection !== null && this.connection.open;
  }

  /**
   * Check if currently attempting to reconnect
   */
  public getIsReconnecting(): boolean {
    return this.isReconnecting;
  }

  /**
   * Get local peer ID
   */
  public getPeerId(): string | null {
    return this.peer?.id || null;
  }

  /**
   * Get remote peer ID
   */
  public getRemotePeerId(): string | null {
    return this.connection?.peer || null;
  }

  /**
   * Check if this peer is the host
   */
  public isHostPeer(): boolean {
    return this.isHost;
  }

  /**
   * Disconnect and clean up
   */
  public disconnect(): void {
    this.isReconnecting = false;
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
