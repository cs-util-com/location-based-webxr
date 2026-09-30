/**
 * Scroll-gesture guard for native `<input type="range">` controls.
 *
 * A range input inside a scrollable panel is a touch trap: the browser jumps
 * the thumb to the finger on touch-down (before any scroll intent can be
 * known) and, in Chromium, locks its own drag direction on the first move it
 * sees with no threshold, so by its source a scroll whose first move reaching
 * it is sideways can keep dragging the thumb. Users scrolling a settings panel
 * therefore edited settings by accident (recorder field feedback 2026-07-27;
 * every demo panel, owner report 2026-09-30).
 *
 * The guard admits exactly two touch interactions and rejects everything else:
 * an explicit horizontal drag, and a short deliberate tap (committed on release,
 * once it is clear the finger neither travelled nor lingered). A vertical swipe
 * — or a slow press that could be the start of one — leaves the value untouched
 * and the panel free to scroll. Mouse pointers are never guarded; click-to-set
 * on the track is expected desktop behaviour and involves no scrolling.
 *
 * `guardSlidersIn(document)` once per page covers every range input the page
 * has now or creates later.
 *
 * @see slider-scroll-guard.ts.md
 */

/**
 * The gesture rule. Exported for measurements (the threshold sweep); pages
 * use the default and never tune it per slider.
 */
export interface SliderGuardTuning {
  /**
   * Travel (CSS px) along the dominant axis before a gesture's direction is
   * trusted. Below it the gesture is undecided and the slider stays frozen.
   */
  readonly intentPx: number;
  /**
   * Steepest angle above the horizontal (degrees, exclusive) that still
   * counts as a horizontal drag; anything steeper is a scroll. 45 means
   * "|dx| > |dy|".
   */
  readonly horizontalMaxDeg: number;
  /**
   * Longest press (ms) still treated as a tap. A quick poke is a deliberate
   * "set it here"; anything slower could be the dwell at the start of a
   * scroll, so it is discarded rather than guessed at.
   */
  readonly tapMaxMs: number;
}

/**
 * The shipped rule. 12 px (owner decision 2026-09-30, up from 10) is still
 * small enough that a deliberate drag feels immediate, and large enough that
 * a scroll leaning 40 degrees off vertical that starts with a sideways twitch
 * stays a scroll (swept 4-16 px and 30-60 degrees, see the sidecar).
 */
export const SLIDER_GUARD_TUNING: SliderGuardTuning = Object.freeze({
  intentPx: 12,
  horizontalMaxDeg: 45,
  tapMaxMs: 300,
});

/** How the current gesture is classified. */
type GestureIntent = 'undecided' | 'horizontal' | 'scroll';

interface ActiveGesture {
  readonly input: HTMLInputElement;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  /** Value before the browser's jump-to-position default action ran. */
  readonly startValue: string;
  /** Most recent value the browser wrote and the guard suppressed. */
  pendingValue: string | null;
  intent: GestureIntent;
  /** A `touchstart` for this gesture reached the slider. */
  touchSeen: boolean;
  /**
   * The browser cancelled the pointer (it took the gesture over for
   * scrolling), but its touch sequence is still running, and by Blink's
   * source it keeps writing the value on every `touchmove` when its own
   * direction lock said horizontal. Held until that sequence ends. (A
   * headless run did not reproduce such writes: a defence, see the sidecar.)
   */
  awaitingTouchEnd: boolean;
}

/** Live installs per root, so a second install on the same root is shared. */
const installs = new WeakMap<
  EventTarget,
  { count: number; remove: () => void }
>();

function asRangeInput(target: EventTarget | null): HTMLInputElement | null {
  const el = target as Element | null;
  return typeof el?.matches === 'function' && el.matches('input[type="range"]')
    ? (el as HTMLInputElement)
    : null;
}

/**
 * Guard every range input under `root` (the root itself included) against
 * touch scrolling, including inputs added after this call.
 *
 * Listeners sit in the CAPTURE phase on `root`, so the guard runs before any
 * listener on the slider itself, whatever the registration order. Installing
 * twice on the same root is harmless: the calls share one install, removed
 * when the last disposer runs.
 *
 * Range inputs inside a shadow root are not reached (their events are
 * retargeted to the host); guard the shadow root itself for those.
 *
 * @param root - usually `document`; an element scopes the guard to its subtree
 * @param tuning - the gesture rule; leave it at the default
 * @returns a disposer; calling it more than once is harmless
 */
export function guardSlidersIn(
  root: Document | Element,
  tuning: SliderGuardTuning = SLIDER_GUARD_TUNING
): () => void {
  const existing = installs.get(root);
  if (existing) {
    existing.count += 1;
  } else {
    installs.set(root, { count: 1, remove: attach(root, tuning) });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = installs.get(root);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    installs.delete(root);
    entry.remove();
  };
}

/**
 * Guard one range input: `guardSlidersIn(input)`.
 *
 * @deprecated Prefer one `guardSlidersIn(document)` per page, which also
 *   covers sliders created later.
 */
export function guardSliderAgainstScroll(input: HTMLInputElement): () => void {
  return guardSlidersIn(input);
}

function attach(root: EventTarget, tuning: SliderGuardTuning): () => void {
  let gesture: ActiveGesture | null = null;
  const tanMax = Math.tan((tuning.horizontalMaxDeg * Math.PI) / 180);

  const onPointerDown = (event: PointerEvent): void => {
    const input = asRangeInput(event.target);
    if (!input) return;
    // Only touch/pen gestures can be confused with scrolling. An unknown
    // pointerType (synthetic events, older engines) is treated as touch —
    // failing towards "guard it" keeps the reported bug fixed either way.
    if (event.pointerType === 'mouse') return;
    // A second finger never re-starts a live gesture. The SAME pointer
    // starting again means its end event was lost, and a gesture that only
    // waits for its touch sequence to end has no live pointer: both re-arm,
    // because a frozen slider would be a far worse failure than a re-armed one.
    if (
      gesture &&
      !gesture.awaitingTouchEnd &&
      event.pointerId !== gesture.pointerId
    ) {
      return;
    }
    gesture = {
      input,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      // Listeners run before the default action, so this is the pre-tap value.
      startValue: input.value,
      pendingValue: null,
      intent: 'undecided',
      touchSeen: false,
      awaitingTouchEnd: false,
    };
  };

  const onTouchStart = (event: Event): void => {
    if (gesture && asRangeInput(event.target) === gesture.input) {
      gesture.touchSeen = true;
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    // 'horizontal' hands the gesture to the browser; 'scroll' is sticky, so a
    // long swipe that drifts sideways can never flip into a value change.
    if (gesture.intent !== 'undecided') return;

    const dx = Math.abs(event.clientX - gesture.startX);
    const dy = Math.abs(event.clientY - gesture.startY);
    if (Math.max(dx, dy) < tuning.intentPx) return;
    gesture.intent = dy < dx * tanMax ? 'horizontal' : 'scroll';
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const ended = gesture;
    gesture = null; // clear first: the tap commit below must not be suppressed

    if (ended.intent === 'horizontal') return; // the browser already applied it

    // A short poke that never travelled is a deliberate "set it here", so
    // replay the value the browser had written and let the app see it. A slow
    // press is never a tap: it may be a scroll's dwell.
    const tapped = ended.pendingValue;
    if (
      ended.intent !== 'undecided' ||
      event.timeStamp - ended.startTime > tuning.tapMaxMs ||
      tapped === null ||
      tapped === ended.startValue
    ) {
      ended.input.value = ended.startValue;
      return;
    }

    ended.input.value = tapped;
    ended.input.dispatchEvent(new Event('input', { bubbles: true }));
    ended.input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.intent === 'horizontal') {
      gesture = null;
      return;
    }
    // The browser took the gesture over for scrolling: never a tap.
    gesture.input.value = gesture.startValue;
    if (gesture.touchSeen) {
      gesture.intent = 'scroll';
      gesture.awaitingTouchEnd = true;
    } else {
      gesture = null;
    }
  };

  const onTouchEnd = (event: Event): void => {
    if (!gesture?.awaitingTouchEnd) return;
    if (asRangeInput(event.target) !== gesture.input) return;
    gesture.input.value = gesture.startValue;
    gesture = null;
  };

  const onValueEvent = (event: Event): void => {
    if (!gesture || gesture.intent === 'horizontal') return;
    if (asRangeInput(event.target) !== gesture.input) return;
    if (!gesture.awaitingTouchEnd) gesture.pendingValue = gesture.input.value;
    gesture.input.value = gesture.startValue;
    event.stopImmediatePropagation();
  };

  const capture: AddEventListenerOptions = { capture: true };
  const passive: AddEventListenerOptions = { capture: true, passive: true };
  const listeners: ReadonlyArray<
    readonly [string, EventListener, AddEventListenerOptions]
  > = [
    ['pointerdown', onPointerDown as EventListener, capture],
    ['pointermove', onPointerMove as EventListener, capture],
    ['pointerup', onPointerUp as EventListener, capture],
    ['pointercancel', onPointerCancel as EventListener, capture],
    ['touchstart', onTouchStart, passive],
    ['touchend', onTouchEnd, passive],
    ['touchcancel', onTouchEnd, passive],
    ['input', onValueEvent, capture],
    ['change', onValueEvent, capture],
  ];
  for (const [type, handler, options] of listeners) {
    root.addEventListener(type, handler, options);
  }

  return () => {
    gesture = null;
    for (const [type, handler, options] of listeners) {
      root.removeEventListener(type, handler, options);
    }
  };
}
