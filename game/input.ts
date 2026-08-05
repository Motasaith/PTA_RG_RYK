import { Action, Binds } from './settings';

/**
 * Keyboard + mouse input.
 *
 * Two rules that the previous version got wrong:
 *  - mouse look is *delta* based and only consumed while the pointer is locked, so the
 *    camera never jumps when the cursor re-enters the window;
 *  - deltas are accumulated between frames and drained once per update, so a 240Hz mouse
 *    and a 60Hz update loop produce exactly the same turn rate.
 */
export class Input {
  private down = new Set<string>();
  private edge = new Set<string>();
  private capture: ((code: string) => void) | null = null;

  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** [left, middle, right] */
  buttons: [boolean, boolean, boolean] = [false, false, false];
  buttonEdge: [boolean, boolean, boolean] = [false, false, false];
  locked = false;
  /** Set false while a menu is open: movement stops, but the DOM keeps working. */
  enabled = true;

  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(
    private el: HTMLElement,
    public binds: Binds,
  ) {}

  attach(): void {
    addEventListener('keydown', this.onKeyDown, { passive: false });
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    addEventListener('mousemove', this.onMouseMove);
    addEventListener('mousedown', this.onMouseDown);
    addEventListener('mouseup', this.onMouseUp);
    this.el.addEventListener('wheel', this.onWheel, { passive: false });
    this.el.addEventListener('contextmenu', this.onContext);
    document.addEventListener('pointerlockchange', this.onLockEvent);
  }

  detach(): void {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    removeEventListener('mousemove', this.onMouseMove);
    removeEventListener('mousedown', this.onMouseDown);
    removeEventListener('mouseup', this.onMouseUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContext);
    document.removeEventListener('pointerlockchange', this.onLockEvent);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.capture) {
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(e.code);
      return;
    }
    // Stop the browser stealing Tab/Space/arrows mid-game.
    if (this.enabled && ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) return;
    this.down.add(e.code);
    this.edge.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onBlur = () => {
    this.down.clear();
    this.buttons = [false, false, false];
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return;
    const b = e.button === 2 ? 2 : e.button === 1 ? 1 : 0;
    if (!this.buttons[b]) this.buttonEdge[b] = true;
    this.buttons[b] = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    const b = e.button === 2 ? 2 : e.button === 1 ? 1 : 0;
    this.buttons[b] = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  private onContext = (e: Event) => e.preventDefault();

  private onLockEvent = () => {
    this.locked = document.pointerLockElement === this.el;
    if (!this.locked) {
      this.down.clear();
      this.buttons = [false, false, false];
    }
    this.onLockChange?.(this.locked);
  };

  requestLock(): void {
    const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  /** Used by the settings screen: the next key pressed is reported instead of acted on. */
  beginCapture(cb: (code: string) => void): void {
    this.capture = cb;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  isDown(a: Action): boolean {
    if (!this.enabled) return false;
    const codes = this.binds[a];
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i])) return true;
    return false;
  }

  justPressed(a: Action): boolean {
    if (!this.enabled) return false;
    const codes = this.binds[a];
    for (let i = 0; i < codes.length; i++) if (this.edge.has(codes[i])) return true;
    return false;
  }

  axis(neg: Action, pos: Action): number {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  /** Call once at the very end of a frame. */
  endFrame(): void {
    this.edge.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttonEdge = [false, false, false];
  }
}
