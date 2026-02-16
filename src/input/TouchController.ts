import * as THREE from 'three';
import { InputState } from '../core/InputManager';
import { GAME_CONFIG } from '../config/constants';

export class TouchController {
  private container: HTMLElement;
  private thrustBtn: HTMLElement;
  private attitudeBase: HTMLElement;
  private attitudeKnob: HTMLElement;
  private ascendBtn: HTMLElement;
  private descendBtn: HTMLElement;

  // Touch tracking
  private thrustTouchId: number | null = null;
  private attitudeTouchId: number | null = null;
  private ascendTouchId: number | null = null;
  private descendTouchId: number | null = null;

  // Right stick state (normalized)
  private attitudeX: number = 0;
  private attitudeY: number = 0;

  // Smoothed state consumed by flight input.
  private smoothedAttitudeX: number = 0;
  private smoothedAttitudeY: number = 0;

  // Right stick geometry
  private attitudeCenterX: number = 0;
  private attitudeCenterY: number = 0;
  private attitudeRadius: number = 0;

  // Bound handlers for cleanup
  private readonly onTouchStartBound: (e: TouchEvent) => void;
  private readonly onTouchMoveBound: (e: TouchEvent) => void;
  private readonly onTouchEndBound: (e: TouchEvent) => void;
  private readonly onResizeBound: () => void;

  constructor() {
    // Create DOM structure
    this.container = document.createElement('div');
    this.container.id = 'touch-controls';

    this.thrustBtn = document.createElement('div');
    this.thrustBtn.className = 'thrust-btn';
    this.thrustBtn.textContent = 'GO';

    this.attitudeBase = document.createElement('div');
    this.attitudeBase.className = 'attitude-stick-base';

    this.attitudeKnob = document.createElement('div');
    this.attitudeKnob.className = 'attitude-stick-knob';
    this.attitudeBase.appendChild(this.attitudeKnob);

    const centerButtons = document.createElement('div');
    centerButtons.className = 'touch-center-buttons';

    this.ascendBtn = document.createElement('div');
    this.ascendBtn.className = 'touch-btn touch-btn-ascend';
    this.ascendBtn.textContent = 'UP';

    this.descendBtn = document.createElement('div');
    this.descendBtn.className = 'touch-btn touch-btn-descend';
    this.descendBtn.textContent = 'DN';

    centerButtons.appendChild(this.ascendBtn);
    centerButtons.appendChild(this.descendBtn);

    this.container.appendChild(this.thrustBtn);
    this.container.appendChild(centerButtons);
    this.container.appendChild(this.attitudeBase);

    const overlay = document.getElementById('ui-overlay');
    if (overlay) {
      overlay.appendChild(this.container);
    }

    // Bind handlers
    this.onTouchStartBound = (e) => this.onTouchStart(e);
    this.onTouchMoveBound = (e) => this.onTouchMove(e);
    this.onTouchEndBound = (e) => this.onTouchEnd(e);
    this.onResizeBound = () => this.updateAttitudeGeometry();

    // Attach events to container
    this.container.addEventListener('touchstart', this.onTouchStartBound, { passive: false });
    this.container.addEventListener('touchmove', this.onTouchMoveBound, { passive: false });
    this.container.addEventListener('touchend', this.onTouchEndBound, { passive: false });
    this.container.addEventListener('touchcancel', this.onTouchEndBound, { passive: false });

    window.addEventListener('resize', this.onResizeBound);
    requestAnimationFrame(() => this.updateAttitudeGeometry());
  }

  private static isTargetInsideControl(target: EventTarget | null, control: HTMLElement): boolean {
    return target instanceof Node && (target === control || control.contains(target));
  }

  private updateAttitudeGeometry(): void {
    const rect = this.attitudeBase.getBoundingClientRect();
    this.attitudeCenterX = rect.left + rect.width / 2;
    this.attitudeCenterY = rect.top + rect.height / 2;
    this.attitudeRadius = rect.width / 2;
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const target = touch.target;

      if (TouchController.isTargetInsideControl(target, this.thrustBtn)) {
        if (this.thrustTouchId === null) {
          this.thrustTouchId = touch.identifier;
          this.thrustBtn.classList.add('active');
        }
      } else if (TouchController.isTargetInsideControl(target, this.attitudeBase)) {
        if (this.attitudeTouchId === null) {
          this.attitudeTouchId = touch.identifier;
          this.updateAttitudeGeometry();
          this.updateAttitudeFromTouch(touch);
        }
      } else if (TouchController.isTargetInsideControl(target, this.ascendBtn)) {
        this.ascendTouchId = touch.identifier;
        this.ascendBtn.classList.add('active');
      } else if (TouchController.isTargetInsideControl(target, this.descendBtn)) {
        this.descendTouchId = touch.identifier;
        this.descendBtn.classList.add('active');
      }
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.attitudeTouchId) {
        this.updateAttitudeFromTouch(touch);
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.thrustTouchId) {
        this.thrustTouchId = null;
        this.thrustBtn.classList.remove('active');
      } else if (touch.identifier === this.attitudeTouchId) {
        this.attitudeTouchId = null;
        this.resetAttitudeStick();
      } else if (touch.identifier === this.ascendTouchId) {
        this.ascendTouchId = null;
        this.ascendBtn.classList.remove('active');
      } else if (touch.identifier === this.descendTouchId) {
        this.descendTouchId = null;
        this.descendBtn.classList.remove('active');
      }
    }
  }

  private updateAttitudeFromTouch(touch: Touch): void {
    const dx = touch.clientX - this.attitudeCenterX;
    const dy = touch.clientY - this.attitudeCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = this.attitudeRadius || GAME_CONFIG.TOUCH_STICK_RADIUS;

    const clampedDist = Math.min(dist, maxDist);
    const angle = Math.atan2(dy, dx);
    const clampedX = Math.cos(angle) * clampedDist;
    const clampedY = Math.sin(angle) * clampedDist;

    this.attitudeKnob.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;

    this.attitudeX = clampedX / maxDist;
    this.attitudeY = clampedY / maxDist;
  }

  private resetAttitudeStick(): void {
    this.attitudeX = 0;
    this.attitudeY = 0;
    this.attitudeKnob.style.transform = 'translate(-50%, -50%)';
  }

  private static smoothTowards(current: number, target: number, response: number, deltaTime: number): number {
    if (response <= 0) {
      return target;
    }
    const alpha = 1 - Math.exp(-response * deltaTime);
    return current + ((target - current) * alpha);
  }

  private updateSmoothedState(deltaTime: number): void {
    const stickResponse = this.attitudeTouchId === null
      ? GAME_CONFIG.TOUCH_STICK_RETURN_RATE
      : GAME_CONFIG.TOUCH_STICK_FOLLOW_RATE;

    this.smoothedAttitudeX = TouchController.smoothTowards(
      this.smoothedAttitudeX,
      this.attitudeX,
      stickResponse,
      deltaTime
    );
    this.smoothedAttitudeY = TouchController.smoothTowards(
      this.smoothedAttitudeY,
      this.attitudeY,
      stickResponse,
      deltaTime
    );

    const microSnap = GAME_CONFIG.TOUCH_MICRO_SNAP;
    if (Math.abs(this.smoothedAttitudeX) < microSnap) {
      this.smoothedAttitudeX = 0;
    }
    if (Math.abs(this.smoothedAttitudeY) < microSnap) {
      this.smoothedAttitudeY = 0;
    }
  }

  private mapSmoothedAttitudeToInput(): { strafe: number; mouseY: number; pitchAxis: number } {
    const deadzone = GAME_CONFIG.TOUCH_DEADZONE;
    const magnitude = Math.min(1, Math.hypot(this.smoothedAttitudeX, this.smoothedAttitudeY));
    if (magnitude < deadzone || magnitude <= Number.EPSILON) {
      return { strafe: 0, mouseY: 0, pitchAxis: 0 };
    }

    const normalizedMagnitude = (magnitude - deadzone) / (1 - deadzone);
    const strafeCurvedMagnitude = Math.pow(
      normalizedMagnitude,
      GAME_CONFIG.TOUCH_STICK_RESPONSE_EXPONENT
    );
    const pitchCurvedMagnitude = Math.pow(
      normalizedMagnitude,
      GAME_CONFIG.TOUCH_PITCH_RESPONSE_EXPONENT
    );
    const strafeAxisScale = strafeCurvedMagnitude / magnitude;
    const pitchAxisScale = pitchCurvedMagnitude / magnitude;
    const pitchAxis = THREE.MathUtils.clamp(this.smoothedAttitudeY * pitchAxisScale, -1, 1);

    return {
      strafe: this.smoothedAttitudeX * strafeAxisScale * GAME_CONFIG.TOUCH_STRAFE_SCALE,
      mouseY: pitchAxis * GAME_CONFIG.TOUCH_PITCH_SCALE,
      pitchAxis,
    };
  }

  public getInputState(deltaTime: number = 1 / 60): InputState {
    const clampedDelta = Math.max(1 / 240, Math.min(0.1, deltaTime));
    this.updateSmoothedState(clampedDelta);

    const { strafe, mouseY, pitchAxis } = this.mapSmoothedAttitudeToInput();
    // Keep touch pitch rate frame-rate invariant across typical mobile FPS ranges.
    // clampedDelta is already bounded to [1/240, 0.1], so this maps to [0.25, 6].
    const frameNormalization = clampedDelta * 60;

    return {
      forward: this.thrustTouchId !== null ? 1 : 0,
      strafe,
      ascend: (this.ascendTouchId !== null ? 1 : 0) + (this.descendTouchId !== null ? -1 : 0),
      mouseX: 0,
      mouseY: mouseY * frameNormalization,
      scrollDelta: 0,
      mobilePitchAutoCenter: true,
      mobilePitchAxis: pitchAxis,
    };
  }

  public show(): void {
    this.container.style.display = 'block';
    this.updateAttitudeGeometry();
  }

  public hide(): void {
    this.container.style.display = 'none';
    // Reset state
    this.thrustTouchId = null;
    this.attitudeTouchId = null;
    this.ascendTouchId = null;
    this.descendTouchId = null;
    this.smoothedAttitudeX = 0;
    this.smoothedAttitudeY = 0;
    this.resetAttitudeStick();
    this.thrustBtn.classList.remove('active');
    this.ascendBtn.classList.remove('active');
    this.descendBtn.classList.remove('active');
  }

  public dispose(): void {
    this.container.removeEventListener('touchstart', this.onTouchStartBound);
    this.container.removeEventListener('touchmove', this.onTouchMoveBound);
    this.container.removeEventListener('touchend', this.onTouchEndBound);
    this.container.removeEventListener('touchcancel', this.onTouchEndBound);
    window.removeEventListener('resize', this.onResizeBound);
    this.container.remove();
  }
}
