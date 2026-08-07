/**
 * Pointer-gesture simulation helpers for jsdom tests.
 *
 * jsdom implements neither `PointerEvent` nor the native behaviour of
 * `<input type="range">`, so touch-gesture tests have to synthesize both: the
 * pointer stream AND the value writes a real browser performs. These helpers
 * keep that simulation in one place so every consumer of
 * `utils/slider-scroll-guard` agrees on what "a swipe" and "a tap" mean.
 *
 * @see pointer-gestures.md
 */

/** One point of a gesture path, in client coordinates. */
export interface GesturePoint {
  readonly x: number;
  readonly y: number;
}

export interface PointerEventOverrides {
  readonly x?: number;
  readonly y?: number;
  readonly pointerType?: string;
  readonly pointerId?: number;
  /** Overrides the event's `timeStamp` (gesture duration is read from it). */
  readonly timeStamp?: number;
}

/**
 * Build a pointer event. Synthesized from `MouseEvent` (which already carries
 * `clientX`/`clientY`) plus the pointer-specific fields consumers read.
 */
export function createPointerEvent(
  type: string,
  init: PointerEventOverrides = {}
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
  });
  Object.defineProperty(event, 'pointerType', {
    value: init.pointerType ?? 'touch',
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  if (init.timeStamp !== undefined) {
    Object.defineProperty(event, 'timeStamp', { value: init.timeStamp });
  }
  return event;
}

/**
 * Apply the value write a native range input performs for a pointer at `x`:
 * the thumb follows the finger and an `input` event is fired. The x coordinate
 * doubles as the resulting value, which keeps the assertions readable.
 */
export function applyNativeSliderValue(
  input: HTMLInputElement,
  x: number
): void {
  input.value = String(x);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export interface SliderGestureOptions {
  readonly pointerType?: string;
  /** How the browser ends the gesture: released, or taken over for scrolling. */
  readonly end?: 'up' | 'cancel';
  /**
   * Milliseconds between pointer-down and the final pointer-up. Defaults to a
   * value above any tap threshold, so a gesture is only a "tap" when a test
   * says so explicitly.
   */
  readonly durationMs?: number;
}

/** Well above the guard's tap window — the deliberate default for swipes. */
const DEFAULT_GESTURE_MS = 1000;

/**
 * Drive a full gesture over a range input the way Blink does: the thumb jumps
 * to the touch position already on pointer-down — before any scroll intent
 * could be known — and follows every subsequent move.
 *
 * Event timestamps are synthetic and spread evenly across `durationMs`, so tap
 * -vs-press behaviour is deterministic rather than dependent on how fast the
 * test machine dispatches events.
 *
 * @param input - the (possibly guarded) range input
 * @param path - at least one point; `x` becomes the value the browser writes
 * @throws if `path` is empty
 */
export function simulateNativeSliderGesture(
  input: HTMLInputElement,
  path: readonly GesturePoint[],
  options: SliderGestureOptions = {}
): void {
  const first = path[0];
  if (!first) {
    throw new Error('simulateNativeSliderGesture: path must not be empty');
  }
  const pointerType = options.pointerType ?? 'touch';
  const duration = options.durationMs ?? DEFAULT_GESTURE_MS;
  const stepMs = duration / Math.max(1, path.length - 1);

  input.dispatchEvent(
    createPointerEvent('pointerdown', {
      x: first.x,
      y: first.y,
      pointerType,
      timeStamp: 0,
    })
  );
  applyNativeSliderValue(input, first.x);

  path.slice(1).forEach((point, index) => {
    input.dispatchEvent(
      createPointerEvent('pointermove', {
        x: point.x,
        y: point.y,
        pointerType,
        timeStamp: (index + 1) * stepMs,
      })
    );
    applyNativeSliderValue(input, point.x);
  });

  const last = path[path.length - 1] ?? first;
  input.dispatchEvent(
    createPointerEvent(
      options.end === 'cancel' ? 'pointercancel' : 'pointerup',
      {
        x: last.x,
        y: last.y,
        pointerType,
        timeStamp: duration,
      }
    )
  );
}
