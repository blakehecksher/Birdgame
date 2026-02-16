import Peer, { DataConnection } from 'peerjs';
import { MessageType, NetworkMessage } from './messages';

type ChannelType = 'realtime' | 'event';
type PeerChannels = {
  realtime: DataConnection | null;
  event: DataConnection | null;
};

/**
 * Wrapper for PeerJS to simplify WebRTC connection
 */
export class PeerConnection {
  private peer: Peer | null = null;
  private connections: Map<string, PeerChannels> = new Map();
  private connectedPeers: Set<string> = new Set();
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
  private readonly REALTIME_CHANNEL_LABEL = 'realtime';
  private readonly EVENT_CHANNEL_LABEL = 'event';

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
          const channelType = this.resolveChannelType(conn);
          console.log(`Client connected on ${channelType} channel:`, conn.peer);
          this.setupConnectionHandlers(conn, channelType);
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
          this.connectToHost();
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

  private getOrCreatePeerChannels(peerId: string): PeerChannels {
    const existing = this.connections.get(peerId);
    if (existing) return existing;

    const channels: PeerChannels = {
      realtime: null,
      event: null,
    };
    this.connections.set(peerId, channels);
    return channels;
  }

  private resolveChannelType(connection: DataConnection): ChannelType {
    const metadataChannel = (connection.metadata as { channel?: string } | null | undefined)?.channel;
    if (metadataChannel === this.REALTIME_CHANNEL_LABEL) return 'realtime';
    if (metadataChannel === this.EVENT_CHANNEL_LABEL) return 'event';

    const label = (connection.label ?? '').toLowerCase();
    if (label === this.REALTIME_CHANNEL_LABEL) return 'realtime';
    if (label === this.EVENT_CHANNEL_LABEL) return 'event';

    const reliable = (connection as DataConnection & { reliable?: boolean }).reliable;
    if (reliable === false) return 'realtime';
    return 'event';
  }

  private setupConnectionHandlers(connection: DataConnection, explicitChannelType?: ChannelType): void {
    const channelType = explicitChannelType ?? this.resolveChannelType(connection);
    const channels = this.getOrCreatePeerChannels(connection.peer);
    channels[channelType] = connection;
    this.connections.set(connection.peer, channels);

    connection.on('open', () => {
      console.log(`Connection opened (${channelType}):`, connection.peer);

      if (channelType !== 'realtime') return;

      const wasConnected = this.connectedPeers.has(connection.peer);
      this.connectedPeers.add(connection.peer);
      this.reconnectAttempts = 0;
      const wasReconnecting = this.isReconnecting;
      this.isReconnecting = false;

      if (wasReconnecting && this.onReconnectedCallback) {
        this.onReconnectedCallback();
      }

      if (!wasConnected && this.onConnectedCallback) {
        this.onConnectedCallback(connection.peer);
      }
    });

    connection.on('data', (data) => {
      if (this.onMessageCallback) {
        this.onMessageCallback(data as NetworkMessage, connection.peer);
      }
    });

    connection.on('close', () => {
      console.log(`Connection closed (${channelType}):`, connection.peer);
      this.handleConnectionClosed(connection.peer, channelType, connection);
    });

    connection.on('error', (error) => {
      console.error(`Connection error (${channelType}):`, error);
    });
  }

  private handleConnectionClosed(peerId: string, channelType: ChannelType, connection: DataConnection): void {
    const channels = this.connections.get(peerId);
    if (channels && channels[channelType] === connection) {
      channels[channelType] = null;
      if (!channels.realtime && !channels.event) {
        this.connections.delete(peerId);
      } else {
        this.connections.set(peerId, channels);
      }
    }

    if (channelType === 'realtime') {
      const wasConnected = this.connectedPeers.delete(peerId);

      // Close reliable channel too; reconnect will recreate both channels.
      if (channels?.event?.open) {
        try {
          channels.event.close();
        } catch (error) {
          console.warn('Failed closing event channel during realtime disconnect:', error);
        }
      }

      if (this.isHost) {
        if (wasConnected) {
          console.log('Client disconnected. Waiting for reconnection...');
          this.isReconnecting = true;
          if (this.onDisconnectedCallback) {
            this.onDisconnectedCallback(peerId);
          }
        }
        return;
      }

      this.attemptReconnect(peerId);
      return;
    }

    // Restore reliable channel in the background while realtime play continues.
    if (!this.isHost && this.connectedPeers.has(peerId) && !this.isReconnecting) {
      this.openChannel(peerId, 'event');
    }
  }

  private attemptReconnect(peerId?: string): void {
    if (this.isHost) {
      // Hosts wait for clients to reconnect.
      return;
    }

    if (this.isReconnecting) return;

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
    this.closeAllChannels();

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
      } else {
        this.connectToHost();
      }
    }, 2000);
  }

  private openChannel(targetPeerId: string, channelType: ChannelType): void {
    if (!this.peer) return;

    const connection = this.peer.connect(targetPeerId, channelType === 'realtime'
      ? {
        reliable: false,
        label: this.REALTIME_CHANNEL_LABEL,
        metadata: { channel: this.REALTIME_CHANNEL_LABEL },
      }
      : {
        reliable: true,
        label: this.EVENT_CHANNEL_LABEL,
        metadata: { channel: this.EVENT_CHANNEL_LABEL },
      });

    this.setupConnectionHandlers(connection, channelType);
  }

  private connectToHost(): void {
    if (!this.peer || !this.storedHostPeerId) return;

    const channels = this.getOrCreatePeerChannels(this.storedHostPeerId);

    if (!channels.realtime) {
      this.openChannel(this.storedHostPeerId, 'realtime');
    }

    if (!channels.event) {
      this.openChannel(this.storedHostPeerId, 'event');
    }
  }

  private getPreferredChannel(message: NetworkMessage): ChannelType {
    switch (message.type) {
      case MessageType.INPUT_UPDATE:
      case MessageType.STATE_SYNC:
      case MessageType.PING:
        return 'realtime';
      default:
        return 'event';
    }
  }

  private getBestOpenConnection(channels: PeerChannels, preferred: ChannelType): DataConnection | null {
    const preferredConnection = channels[preferred];
    if (preferredConnection?.open) {
      return preferredConnection;
    }

    const fallback = preferred === 'realtime' ? channels.event : channels.realtime;
    if (fallback?.open) {
      return fallback;
    }

    return null;
  }

  private sendToPeer(peerId: string, message: NetworkMessage, preferred: ChannelType): void {
    const channels = this.connections.get(peerId);
    if (!channels) return;

    const connection = this.getBestOpenConnection(channels, preferred);
    if (!connection) return;

    connection.send(message);
  }

  public send(message: NetworkMessage, peerId?: string): void {
    const preferredChannel = this.getPreferredChannel(message);

    if (peerId) {
      this.sendToPeer(peerId, message, preferredChannel);
      return;
    }

    this.connections.forEach((_channels, remotePeerId) => {
      this.sendToPeer(remotePeerId, message, preferredChannel);
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
    return this.connectedPeers.size > 0;
  }

  public getIsReconnecting(): boolean {
    return this.isReconnecting;
  }

  public getPeerId(): string | null {
    return this.peer?.id || null;
  }

  public getRemotePeerId(): string | null {
    for (const peerId of this.connectedPeers.values()) {
      return peerId;
    }
    return null;
  }

  public getRemotePeerIds(): string[] {
    return Array.from(this.connectedPeers.values());
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
      const pingMessage: NetworkMessage = {
        type: MessageType.PING,
        timestamp: Date.now(),
      };
      try {
        this.send(pingMessage);
      } catch (e) {
        console.warn('Keep-alive ping failed:', e);
      }
    }, 10000); // Every 10 seconds
  }

  private closePeerChannels(peerId: string): void {
    const channels = this.connections.get(peerId);
    if (!channels) return;

    if (channels.realtime) {
      try {
        channels.realtime.close();
      } catch (error) {
        console.warn('Failed to close realtime channel:', error);
      }
    }

    if (channels.event) {
      try {
        channels.event.close();
      } catch (error) {
        console.warn('Failed to close event channel:', error);
      }
    }

    this.connections.delete(peerId);
    this.connectedPeers.delete(peerId);
  }

  private closeAllChannels(): void {
    for (const peerId of Array.from(this.connections.keys())) {
      this.closePeerChannels(peerId);
    }
    this.connections.clear();
    this.connectedPeers.clear();
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
    this.closeAllChannels();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
