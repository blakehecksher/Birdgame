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

interface ActiveSound {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export type VolumeChannel = 'master' | 'sfx' | 'ambient';

class AudioManagerSingleton {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;

  private bufferCache = new Map<string, AudioBuffer>();
  private activeSounds = new Map<string, ActiveSound>();

  private volumes: Record<VolumeChannel, number> = {
    master: 0.7,
    sfx: 1.0,
    ambient: 0.4,
  };

  private initialized = false;
  private resumeHandler: (() => void) | null = null;

  /**
   * Initialize the AudioContext and gain graph.
   * Safe to call multiple times — only initializes once.
   */
  public init(): void {
    if (this.initialized) return;

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
    if (this.ctx.state === 'suspended') {
      this.resumeHandler = () => {
        this.ctx?.resume();
        if (this.resumeHandler) {
          document.removeEventListener('click', this.resumeHandler);
          document.removeEventListener('keydown', this.resumeHandler);
          this.resumeHandler = null;
        }
      };
      document.addEventListener('click', this.resumeHandler);
      document.addEventListener('keydown', this.resumeHandler);
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
      try {
        const response = await fetch(`${base}${entry.path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.bufferCache.set(entry.key, audioBuffer);
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
    const buffer = this.bufferCache.get(key);
    if (!buffer || !this.ctx) return null;

    const channelGain = channel === 'ambient' ? this.ambientGain! : this.sfxGain!;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(channelGain);

    const id = `${key}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.activeSounds.set(id, { source, gain });

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
    const buffer = this.bufferCache.get(key);
    if (!buffer || !this.ctx) return null;

    const channelGain = channel === 'ambient' ? this.ambientGain! : this.sfxGain!;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(channelGain);

    const id = `loop_${key}`;

    // Stop existing loop with same key
    this.stop(id);

    this.activeSounds.set(id, { source, gain });
    source.start();
    return id;
  }

  /**
   * Stop a playing sound by its ID.
   */
  public stop(id: string): void {
    const active = this.activeSounds.get(id);
    if (!active) return;

    try {
      active.source.stop();
    } catch {
      // Already stopped
    }
    this.activeSounds.delete(id);
  }

  /**
   * Stop all sounds on a given channel, or all sounds.
   */
  public stopAll(channel?: 'sfx' | 'ambient'): void {
    for (const [id, active] of this.activeSounds) {
      if (channel) {
        const isAmbient = id.startsWith('loop_');
        if ((channel === 'ambient') !== isAmbient) continue;
      }
      try {
        active.source.stop();
      } catch {
        // Already stopped
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
    return this.bufferCache.has(key);
  }

  /**
   * Cleanup all resources.
   */
  public dispose(): void {
    this.stopAll();

    if (this.resumeHandler) {
      document.removeEventListener('click', this.resumeHandler);
      document.removeEventListener('keydown', this.resumeHandler);
      this.resumeHandler = null;
    }

    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }

    this.bufferCache.clear();
    this.masterGain = null;
    this.sfxGain = null;
    this.ambientGain = null;
    this.initialized = false;
  }
}

/** Singleton instance — import and use directly. */
export const AudioManager = new AudioManagerSingleton();
