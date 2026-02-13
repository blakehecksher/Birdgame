/**
 * AudioManager — Web Audio API based sound system.
 *
 * Features:
 * - Preloads audio files into AudioBuffers (like ModelLoader for models)
 * - Volume channels: master, sfx, ambient
 * - One-shot playback, looping, stop
 * - Graceful fallback: missing/failed sounds are silently ignored
 * - Respects browser autoplay policy (resumes AudioContext on first interaction)
 */

export interface SoundManifestEntry {
  key: string;
  path: string;
  optional?: boolean;
}

export type VolumeChannel = 'master' | 'sfx' | 'ambient';
type SoundChannel = 'sfx' | 'ambient';

interface ActiveSound {
  channel: SoundChannel;
  volume: number;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  element?: HTMLAudioElement;
}

class AudioManagerSingleton {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;

  private bufferCache = new Map<string, AudioBuffer>();
  private mediaFallbackCache = new Map<string, string>();
  private activeSounds = new Map<string, ActiveSound>();

  private volumes: Record<VolumeChannel, number> = {
    master: 0.7,
    sfx: 1.0,
    ambient: 0.4,
  };

  private initialized = false;
  private resumeHandler: (() => void) | null = null;
  private readonly resumeEvents = ['click', 'keydown', 'touchstart', 'touchend', 'pointerdown'] as const;

  /**
   * Initialize the AudioContext and gain graph.
   * Safe to call multiple times — only initializes once.
   */
  public init(): void {
    if (this.initialized) return;

    this.configureAudioSession();
    this.ctx = new AudioContext();

    // Gain graph: source → channel gain → master gain → destination
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volumes.master;
    this.masterGain.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.volumes.sfx;
    this.sfxGain.connect(this.masterGain);

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = this.volumes.ambient;
    this.ambientGain.connect(this.masterGain);

    this.initialized = true;

    // Handle browser autoplay policy: resume context on first user interaction
    if (this.ctx.state !== 'running') {
      this.resumeHandler = () => {
        void this.resumeContext();
      };
      this.addResumeListeners();
    }
  }

  /**
   * Best-effort resume for browsers that gate audio behind user interaction.
   * Listeners remain active until resume succeeds.
   */
  private async resumeContext(): Promise<void> {
    if (!this.ctx) return;
    this.configureAudioSession();
    const ctx = this.ctx;
    try {
      if (ctx.state !== 'running') {
        await ctx.resume();
      }
    } catch {
      return;
    }
    if (ctx.state === 'running') {
      this.removeResumeListeners();
    }
  }

  private addResumeListeners(): void {
    if (!this.resumeHandler) return;
    for (const eventName of this.resumeEvents) {
      document.addEventListener(eventName, this.resumeHandler, { capture: true });
    }
  }

  private removeResumeListeners(): void {
    if (!this.resumeHandler) return;
    for (const eventName of this.resumeEvents) {
      document.removeEventListener(eventName, this.resumeHandler, true);
    }
    this.resumeHandler = null;
  }

  /**
   * Public manual resume hook for explicit user-gesture call sites.
   */
  public resume(): void {
    void this.resumeContext();
  }

  /**
   * iOS Safari/WebKit may route WebAudio through an "ambient" session that is
   * muted by Silent mode. Where supported (iOS 17+), request playback session.
   */
  private configureAudioSession(): void {
    type NavigatorWithAudioSession = Navigator & {
      audioSession?: { type?: string };
    };

    const nav = navigator as NavigatorWithAudioSession;
    const session = nav.audioSession;
    if (!session) return;

    try {
      if (session.type !== 'playback') {
        session.type = 'playback';
      }
    } catch {
      // Best-effort only; unsupported/blocked implementations should no-op.
    }
  }

  /**
   * Preload a manifest of sound files into AudioBuffers.
   */
  public async preload(entries: SoundManifestEntry[]): Promise<void> {
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    const base = import.meta.env.BASE_URL;

    const tasks = entries.map(async (entry) => {
      const url = `${base}${entry.path}`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.mediaFallbackCache.set(entry.key, url);
        const arrayBuffer = await response.arrayBuffer();
        try {
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          this.bufferCache.set(entry.key, audioBuffer);
        } catch (error) {
          if (!entry.optional) {
            console.error(`Failed to decode sound: ${entry.path}`, error);
          }
        }
      } catch (error) {
        if (!entry.optional) {
          console.error(`Failed to load sound: ${entry.path}`, error);
        }
        // Optional sounds silently ignored
      }
    });

    await Promise.all(tasks);
  }

  /**
   * Play a one-shot sound effect.
   * Returns a playback ID that can be used to stop it early.
   */
  public play(key: string, channel: 'sfx' | 'ambient' = 'sfx', volume = 1.0): string | null {
    if (!this.ctx) return this.playMediaFallback(key, channel, volume, false);

    if (this.ctx.state !== 'running') {
      void this.resumeContext();
      const fallbackId = this.playMediaFallback(key, channel, volume, false);
      if (fallbackId) return fallbackId;
    }

    const buffer = this.bufferCache.get(key);
    if (!buffer) return this.playMediaFallback(key, channel, volume, false);

    const channelGain = channel === 'ambient' ? this.ambientGain! : this.sfxGain!;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(channelGain);

    const id = `${key}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.activeSounds.set(id, { channel, volume, source, gain });

    source.onended = () => {
      this.activeSounds.delete(id);
    };

    source.start();
    return id;
  }

  /**
   * Play a looping sound (e.g., ambient, wing flap).
   * Returns a stable ID for stopping later.
   */
  public playLoop(key: string, channel: 'sfx' | 'ambient' = 'ambient', volume = 1.0): string | null {
    const id = `loop_${key}`;
    if (!this.ctx) return this.playMediaFallback(key, channel, volume, true, id);

    if (this.ctx.state !== 'running') {
      void this.resumeContext();
      const fallbackId = this.playMediaFallback(key, channel, volume, true, id);
      if (fallbackId) return fallbackId;
    }

    const buffer = this.bufferCache.get(key);
    if (!buffer) return this.playMediaFallback(key, channel, volume, true, id);

    const channelGain = channel === 'ambient' ? this.ambientGain! : this.sfxGain!;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(channelGain);

    // Stop existing loop with same key
    this.stop(id);

    this.activeSounds.set(id, { channel, volume, source, gain });
    source.start();
    return id;
  }

  private playMediaFallback(
    key: string,
    channel: SoundChannel,
    volume: number,
    loop: boolean,
    idOverride?: string
  ): string | null {
    const src = this.mediaFallbackCache.get(key);
    if (!src) return null;

    const id = idOverride ?? `${key}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (idOverride) {
      this.stop(id);
    }

    const audio = new Audio(src);
    audio.loop = loop;
    audio.preload = 'auto';
    audio.volume = this.getEffectiveVolume(channel, volume);

    this.activeSounds.set(id, { channel, volume, element: audio });

    audio.onended = () => {
      if (!loop) {
        this.activeSounds.delete(id);
      }
    };

    void audio.play().catch(() => {
      this.activeSounds.delete(id);
    });

    return id;
  }

  /**
   * Stop a playing sound by its ID.
   */
  public stop(id: string): void {
    const active = this.activeSounds.get(id);
    if (!active) return;

    if (active.source) {
      try {
        active.source.stop();
      } catch {
        // Already stopped
      }
    }
    if (active.element) {
      active.element.pause();
      active.element.currentTime = 0;
    }

    this.activeSounds.delete(id);
  }

  /**
   * Stop all sounds on a given channel, or all sounds.
   */
  public stopAll(channel?: 'sfx' | 'ambient'): void {
    for (const [id, active] of this.activeSounds) {
      if (channel && active.channel !== channel) continue;

      if (active.source) {
        try {
          active.source.stop();
        } catch {
          // Already stopped
        }
      }
      if (active.element) {
        active.element.pause();
        active.element.currentTime = 0;
      }
      this.activeSounds.delete(id);
    }
  }

  /**
   * Set volume for a channel.
   */
  public setVolume(channel: VolumeChannel, value: number): void {
    this.volumes[channel] = Math.max(0, Math.min(1, value));

    switch (channel) {
      case 'master':
        if (this.masterGain) this.masterGain.gain.value = this.volumes.master;
        break;
      case 'sfx':
        if (this.sfxGain) this.sfxGain.gain.value = this.volumes.sfx;
        break;
      case 'ambient':
        if (this.ambientGain) this.ambientGain.gain.value = this.volumes.ambient;
        break;
    }

    for (const active of this.activeSounds.values()) {
      if (active.element) {
        active.element.volume = this.getEffectiveVolume(active.channel, active.volume);
      }
    }
  }

  /**
   * Get current volume for a channel.
   */
  public getVolume(channel: VolumeChannel): number {
    return this.volumes[channel];
  }

  /**
   * Check if a sound key is loaded and available.
   */
  public has(key: string): boolean {
    return this.bufferCache.has(key) || this.mediaFallbackCache.has(key);
  }

  private getEffectiveVolume(channel: SoundChannel, soundVolume: number): number {
    const v = soundVolume * this.volumes[channel] * this.volumes.master;
    return Math.max(0, Math.min(1, v));
  }

  /**
   * Cleanup all resources.
   */
  public dispose(): void {
    this.stopAll();

    this.removeResumeListeners();

    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }

    this.bufferCache.clear();
    this.mediaFallbackCache.clear();
    this.masterGain = null;
    this.sfxGain = null;
    this.ambientGain = null;
    this.initialized = false;
  }
}

/** Singleton instance — import and use directly. */
export const AudioManager = new AudioManagerSingleton();
