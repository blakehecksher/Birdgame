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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.keyDownHandler = (e) => this.onKeyDown(e);
    this.keyUpHandler = (e) => this.onKeyUp(e);
    this.canvasClickHandler = () => this.requestPointerLock();
    this.pointerLockHandler = () => this.onPointerLockChange();
    this.mouseMoveHandler = (e) => this.onMouseMove(e);
    this.wheelHandler = (e) => this.onWheel(e);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Keyboard events
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);

    // Mouse events for pointer lock
    this.canvas.addEventListener('click', this.canvasClickHandler);
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
    if (!this.isPointerLocked) {
      this.canvas.requestPointerLock();
    }
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
    this.canvas.removeEventListener('click', this.canvasClickHandler);
    document.removeEventListener('pointerlockchange', this.pointerLockHandler);
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.removeEventListener('wheel', this.wheelHandler);
  }
}
