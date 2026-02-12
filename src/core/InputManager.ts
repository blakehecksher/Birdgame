export interface InputState {
  forward: number; // 0 to 1 (W only)
  strafe: number; // -1 to 1 (bank input: A/D)
  ascend: number; // -1 to 1
  mouseX: number; // Mouse delta X
  mouseY: number; // Mouse delta Y
  scrollDelta: number; // Scroll wheel delta for camera zoom
}

export class InputManager {
  private keys: Set<string> = new Set();
  private mouseDelta: { x: number; y: number } = { x: 0, y: 0 };
  private scrollDelta: number = 0;
  private canvas: HTMLCanvasElement;
  private isPointerLocked: boolean = false;
  private readonly keyDownHandler: (e: KeyboardEvent) => void;
  private readonly keyUpHandler: (e: KeyboardEvent) => void;
  private readonly canvasClickHandler: () => void;
  private readonly pointerLockHandler: () => void;
  private readonly mouseMoveHandler: (e: MouseEvent) => void;
  private readonly wheelHandler: (e: WheelEvent) => void;
  private readonly isTouchDevice: boolean;
  private mobileInput = {
    forward: 0,
    strafe: 0,
    pitch: 0,
  };
  private touchJoystickContainer: HTMLDivElement | null = null;
  private activeTouchId: number | null = null;
  private readonly joystickRadius = 44;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isTouchDevice =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches;
    this.keyDownHandler = (e) => this.onKeyDown(e);
    this.keyUpHandler = (e) => this.onKeyUp(e);
    this.canvasClickHandler = () => this.requestPointerLock();
    this.pointerLockHandler = () => this.onPointerLockChange();
    this.mouseMoveHandler = (e) => this.onMouseMove(e);
    this.wheelHandler = (e) => this.onWheel(e);
    this.setupEventListeners();
    if (this.isTouchDevice) {
      this.setupTouchJoystick();
    }
  }

  private setupEventListeners(): void {
    // Keyboard events
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);

    // Mouse events for pointer lock
    if (!this.isTouchDevice) {
      this.canvas.addEventListener('click', this.canvasClickHandler);
    }
    document.addEventListener('pointerlockchange', this.pointerLockHandler);
    document.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (
      event.code === 'ArrowUp' ||
      event.code === 'ArrowDown' ||
      event.code === 'Space'
    ) {
      event.preventDefault();
    }
    this.keys.add(event.code);
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.code);
  }

  private requestPointerLock(): void {
    if (this.isTouchDevice) {
      return;
    }
    if (!this.isPointerLocked) {
      this.canvas.requestPointerLock();
    }
  }

  private setupTouchJoystick(): void {
    const uiOverlay = document.getElementById('ui-overlay');
    if (!uiOverlay) return;

    const container = document.createElement('div');
    container.setAttribute('aria-label', 'Flight joystick');
    container.style.position = 'absolute';
    container.style.left = '24px';
    container.style.bottom = '24px';
    container.style.width = `${this.joystickRadius * 2}px`;
    container.style.height = `${this.joystickRadius * 2}px`;
    container.style.borderRadius = '50%';
    container.style.border = '2px solid rgba(255, 255, 255, 0.55)';
    container.style.background = 'rgba(0, 0, 0, 0.25)';
    container.style.backdropFilter = 'blur(2px)';
    container.style.touchAction = 'none';
    container.style.pointerEvents = 'auto';
    container.style.zIndex = '60';

    const knob = document.createElement('div');
    const knobSize = this.joystickRadius;
    knob.style.position = 'absolute';
    knob.style.left = `${this.joystickRadius - knobSize / 2}px`;
    knob.style.top = `${this.joystickRadius - knobSize / 2}px`;
    knob.style.width = `${knobSize}px`;
    knob.style.height = `${knobSize}px`;
    knob.style.borderRadius = '50%';
    knob.style.background = 'rgba(255, 255, 255, 0.75)';
    knob.style.border = '1px solid rgba(255,255,255,0.9)';
    knob.style.boxShadow = '0 3px 10px rgba(0,0,0,0.35)';
    knob.style.transform = 'translate(0px, 0px)';

    container.appendChild(knob);
    uiOverlay.appendChild(container);

    container.addEventListener('touchstart', (event) => {
      event.preventDefault();
      const touch = event.changedTouches[0];
      if (!touch) return;
      this.activeTouchId = touch.identifier;
      this.updateJoystickFromTouch(touch, container, knob);
    }, { passive: false });

    container.addEventListener('touchmove', (event) => {
      if (this.activeTouchId === null) return;
      const touch = Array.from(event.changedTouches).find(
        (t) => t.identifier === this.activeTouchId
      );
      if (!touch) return;
      event.preventDefault();
      this.updateJoystickFromTouch(touch, container, knob);
    }, { passive: false });

    const stopTouch = (event: TouchEvent): void => {
      if (this.activeTouchId === null) return;
      const touch = Array.from(event.changedTouches).find(
        (t) => t.identifier === this.activeTouchId
      );
      if (!touch) return;
      event.preventDefault();
      this.activeTouchId = null;
      this.mobileInput.forward = 0;
      this.mobileInput.strafe = 0;
      this.mobileInput.pitch = 0;
      knob.style.transform = 'translate(0px, 0px)';
    };

    container.addEventListener('touchend', stopTouch, { passive: false });
    container.addEventListener('touchcancel', stopTouch, { passive: false });

    this.touchJoystickContainer = container;
  }

  private updateJoystickFromTouch(
    touch: Touch,
    container: HTMLDivElement,
    knob: HTMLDivElement
  ): void {
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const rawX = touch.clientX - centerX;
    const rawY = touch.clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const limitedDistance = Math.min(this.joystickRadius, distance);
    const angle = Math.atan2(rawY, rawX);

    const dx = Math.cos(angle) * limitedDistance;
    const dy = Math.sin(angle) * limitedDistance;
    const normalizedX = dx / this.joystickRadius;
    const normalizedY = dy / this.joystickRadius;
    const radialAmount = limitedDistance / this.joystickRadius;

    this.mobileInput.strafe = normalizedX;
    this.mobileInput.pitch = normalizedY;
    this.mobileInput.forward = radialAmount;

    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private onPointerLockChange(): void {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
  }

  private onMouseMove(event: MouseEvent): void {
    if (this.isPointerLocked) {
      this.mouseDelta.x += event.movementX;
      this.mouseDelta.y += event.movementY;
    }
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.scrollDelta += Math.sign(event.deltaY);
  }

  /**
   * Get current input state
   */
  public getInputState(): InputState {
    const input: InputState = {
      forward: 0,
      strafe: 0,
      ascend: 0,
      mouseX: this.mouseDelta.x,
      mouseY: this.mouseDelta.y,
      scrollDelta: this.scrollDelta,
    };

    // Forward thrust (W only)
    if (this.keys.has('KeyW')) input.forward += 1;

    if (this.isTouchDevice) {
      input.forward = Math.max(input.forward, this.mobileInput.forward);
      input.strafe = this.mobileInput.strafe;
      // Touch pitch is mapped to the existing reticle pitch pathway.
      const touchPitchAsMouseDelta = 4;
      input.mouseY += this.mobileInput.pitch * touchPitchAsMouseDelta;
    }

    // Strafe left/right (A/D)
    if (this.keys.has('KeyD')) input.strafe += 1;
    if (this.keys.has('KeyA')) input.strafe -= 1;

    // Ascend/descend (Space/Shift)
    if (this.keys.has('Space')) input.ascend += 1;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) input.ascend -= 1;

    // Arrow-key pitch support (mapped to mouse-Y deltas).
    // ArrowUp behaves like moving mouse up; ArrowDown like moving mouse down.
    const keyboardPitchDelta = 10;
    if (this.keys.has('ArrowUp')) input.mouseY -= keyboardPitchDelta;
    if (this.keys.has('ArrowDown')) input.mouseY += keyboardPitchDelta;

    // Reset deltas after reading
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.scrollDelta = 0;

    return input;
  }

  /**
   * Check if a specific key is pressed
   */
  public isKeyPressed(code: string): boolean {
    return this.keys.has(code);
  }

  /**
   * Release pointer lock
   */
  public releasePointerLock(): void {
    if (this.isPointerLocked) {
      document.exitPointerLock();
    }
  }

  /**
   * Check if pointer is locked
   */
  public isLocked(): boolean {
    return this.isPointerLocked;
  }

  /**
   * Clear pressed keys and pending mouse deltas.
   */
  public resetInputState(): void {
    this.keys.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.scrollDelta = 0;
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    if (!this.isTouchDevice) {
      this.canvas.removeEventListener('click', this.canvasClickHandler);
    }
    document.removeEventListener('pointerlockchange', this.pointerLockHandler);
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.removeEventListener('wheel', this.wheelHandler);
    if (this.touchJoystickContainer) {
      this.touchJoystickContainer.remove();
      this.touchJoystickContainer = null;
    }
  }
}
