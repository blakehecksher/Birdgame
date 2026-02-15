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
  private readonly peerConfig = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    },
  };

  public async initializeAsHost(roomCode?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        const peerId = roomCode ? `birdgame-${roomCode}` : undefined;
        this.storedHostPeerId = peerId ?? null;
        this.peer = peerId ? new Peer(peerId, this.peerConfig) : new Peer(this.peerConfig);
        this.isHost = true;

        this.peer.on('open', (id) => {
          console.log('Host peer ID:', id);
          this.storedHostPeerId = id;
          if (!settled) {
            settled = true;
            resolve(id);
          }
          if (this.isReconnecting) {
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            if (this.onReconnectedCallback) {
              this.onReconnectedCallback();
            }
          }
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

        });

        this.peer.on('disconnected', () => {
          console.warn('Peer signaling disconnected (host). Attempting to restore room...');
          this.isReconnecting = true;
          if (this.onDisconnectedCallback) {
            this.onDisconnectedCallback();
          }
          if (this.peer && !this.peer.destroyed) {
            this.peer.reconnect();
          }
        });

        this.peer.on('error', (error) => {
          console.error('Peer error:', error);
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    });
  }

  public async initializeAsClient(hostPeerId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.peer = new Peer(this.peerConfig);
        this.isHost = false;
        this.storedHostPeerId = hostPeerId;

        this.peer.on('open', (id) => {
          console.log('Client peer ID:', id);

          const connection = this.peer!.connect(hostPeerId, { reliable: true });
          this.connections.set(hostPeerId, connection);
          this.setupConnectionHandlers(connection);
          if (!settled) {
            settled = true;
            resolve(id);
          }
        });

        this.peer.on('disconnected', () => {
          console.warn('Peer signaling disconnected (client). Attempting to reconnect...');
          this.isReconnecting = true;
          if (this.onDisconnectedCallback) {
            this.onDisconnectedCallback();
          }
          if (this.peer && !this.peer.destroyed) {
            this.peer.reconnect();
          }
        });

        this.peer.on('error', (error) => {
          console.error('Peer error:', error);
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    });
  }

  private setupConnectionHandlers(connection: DataConnection): void {
    connection.on('open', () => {
      console.log('Connection opened:', connection.peer);
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      if (this.onConnectedCallback) {
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
        this.peer = new Peer(this.peerConfig);
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
    return Array.from(this.connections.entries())
      .filter(([, conn]) => conn.open)
      .map(([peerId]) => peerId);
  }

  public closePeer(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (!conn) return;
    conn.close();
    this.connections.delete(peerId);
  }

  public isHostPeer(): boolean {
    return this.isHost;
  }

  public refreshPresence(): void {
    if (!this.peer) return;
    if (this.peer.destroyed) return;
    if (this.peer.disconnected) {
      console.log('Refreshing signaling presence...');
      this.peer.reconnect();
    }
  }

  public disconnect(): void {
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
