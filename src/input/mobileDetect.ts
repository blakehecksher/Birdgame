/**
 * Returns true on phones/tablets (touch screen + no fine pointer).
 * Uses CSS media query `(pointer: coarse)` which is more reliable than
 * user-agent sniffing and correctly excludes touchscreen laptops.
 */
export function isTouchDevice(): boolean {
  return (
    'ontouchstart' in window &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export type QualityTier = 'low' | 'high';

export function getQualityTier(): QualityTier {
  return isTouchDevice() ? 'low' : 'high';
}
