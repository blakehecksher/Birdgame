/**
 * DeviceDetector - Utility for detecting device capabilities and recommending performance settings
 *
 * Used by NetworkManager to adapt tick rates based on device type and capabilities.
 */

export class DeviceDetector {
  /**
   * Detects if the current device is a mobile device (phone or tablet)
   */
  static isMobile(): boolean {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  /**
   * Detects if the current device is a low-end mobile device
   * Heuristic: mobile device with < 4GB RAM
   *
   * Note: navigator.deviceMemory is only available in Chrome/Edge
   */
  static isLowEndDevice(): boolean {
    if (!this.isMobile()) return false;

    // TypeScript doesn't know about deviceMemory, so we cast
    const nav = navigator as any;
    const memory = nav.deviceMemory;

    // If deviceMemory is not available, assume it's not low-end
    // (better to over-perform than under-perform)
    if (!memory) return false;

    return memory < 4;
  }

  /**
   * Returns recommended network tick rate based on device capabilities
   *
   * - Low-end mobile: 20Hz (conservative for battery/thermal)
   * - Standard mobile: 30Hz (balanced)
   * - Desktop: 30Hz (current baseline, can be increased to 45Hz in Phase 3)
   */
  static getRecommendedTickRate(): number {
    if (this.isLowEndDevice()) {
      console.log('[DeviceDetector] Low-end mobile detected, recommending 20Hz tick rate');
      return 20;
    }

    if (this.isMobile()) {
      console.log('[DeviceDetector] Mobile device detected, recommending 30Hz tick rate');
      return 30;
    }

    console.log('[DeviceDetector] Desktop device detected, recommending 30Hz tick rate');
    return 30;
  }

  /**
   * Returns a human-readable device type string for UI display
   */
  static getDeviceTypeString(): string {
    if (this.isLowEndDevice()) return 'Mobile (Low-End)';
    if (this.isMobile()) return 'Mobile';
    return 'Desktop';
  }

  /**
   * Returns detailed device info for debugging
   */
  static getDeviceInfo(): {
    isMobile: boolean;
    isLowEnd: boolean;
    recommendedTickRate: number;
    deviceType: string;
    userAgent: string;
    deviceMemory?: number;
  } {
    const nav = navigator as any;
    return {
      isMobile: this.isMobile(),
      isLowEnd: this.isLowEndDevice(),
      recommendedTickRate: this.getRecommendedTickRate(),
      deviceType: this.getDeviceTypeString(),
      userAgent: navigator.userAgent,
      deviceMemory: nav.deviceMemory,
    };
  }
}
