/**
 * Scroll-gesture guard for native `<input type="range">` controls.
 *
 * A range input inside a scrollable panel is a touch trap: the browser jumps
 * the thumb to the finger on pointer-down (before any scroll intent can be
 * known) and then keeps tracking the finger while it travels down the panel.
 * Users scrolling a settings panel therefore edited settings by accident
 * (recorder field feedback 2026-07-27).
 *
 * The guard admits exactly two touch interactions and rejects everything else:
 * an explicit horizontal drag, and a short deliberate tap (committed on release,
 * once it is clear the finger neither travelled nor lingered). A vertical swipe
 * — or a slow press that could be the start of one — leaves the value untouched
 * and the panel free to scroll. Mouse pointers are never guarded; click-to-set
 * on the track is expected desktop behaviour and involves no scrolling.
 *
 * Pair it with `touch-action: pan-y` on the slider so the browser also
 * *performs* the scroll instead of swallowing the gesture.
 *
 * @see slider-scroll-guard.ts.md
 */

/**
 * Travel (CSS px) a gesture must cover before its direction is trusted. Below
 * this the gesture is undecided and the slider stays frozen — small enough that
 * a deliberate drag feels immediate, large enough that the first few pixels of
 * a scroll never register as an edit.
 */
const GESTURE_INTENT_PX = 10;

/**
 * Longest press (ms) still treated as a tap. A quick poke is a deliberate "set
 * it here"; anything slower could be the dwell at the start of a scroll, so it
 * is discarded rather than guessed at.
 */
const TAP_MAX_MS = 300;

/** How the current gesture is classified. */
type GestureIntent = 'undecided' | 'horizontal' | 'scroll';

interface ActiveGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  /** Value before the browser's jump-to-position default action ran. */
  readonly startValue: string;
  /** Most recent value the browser wrote and the guard suppressed. */
  pendingValue: string | null;
  intent: GestureIntent;
}

/**
 * Install the guard on one range input.
 *
 * Attach it BEFORE the application's own `input` listener: at-target listeners
 * fire in registration order, which is what allows the guard's
 * `stopImmediatePropagation()` to shield later listeners from suppressed
 * events.
 *
 * @param input - the range input to guard (any input element is accepted;
 *   guarding a non-range input is harmless but pointless)
 * @returns a disposer that removes every listener and restores plain behaviour
 */
export function guardSliderAgainstScroll(input: HTMLInputElement): () => void {
  let gesture: ActiveGesture | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    // Only touch/pen gestures can be confused with scrolling. An unknown
    // pointerType (synthetic events, older engines) is treated as touch —
    // failing towards "guard it" keeps the reported bug fixed either way.
    if (event.pointerType === 'mouse') return;
    // A second finger never re-starts the gesture. The SAME pointer starting
    // again means its end event was lost (touch pointers are implicitly
    // captured, so this should not happen — but a frozen slider would be a far
    // worse failure than a re-armed one), so fall through and re-arm.
    if (gesture && event.pointerId !== gesture.pointerId) return;
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      // Listeners run before the default action, so this is the pre-tap value.
      startValue: input.value,
      pendingValue: null,
      intent: 'undecided',
    };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    // 'horizontal' hands the gesture to the browser; 'scroll' is sticky, so a
    // long swipe that drifts sideways can never flip into a value change.
    if (gesture.intent !== 'undecided') return;

    const dx = Math.abs(event.clientX - gesture.startX);
    const dy = Math.abs(event.clientY - gesture.startY);
    if (dy >= GESTURE_INTENT_PX && dy >= dx) {
      gesture.intent = 'scroll';
    } else if (dx >= GESTURE_INTENT_PX && dx > dy) {
      gesture.intent = 'horizontal';
    }
  };

  const endGesture = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const ended = gesture;
    gesture = null; // clear first: the tap commit below must not be suppressed

    if (ended.intent === 'horizontal') return; // the browser already applied it

    // A short poke that never travelled is a deliberate "set it here", so
    // replay the value the browser had written and let the app see it. A
    // pointercancel is the browser taking the gesture over for scrolling and
    // is never a tap; neither is a slow press, which may be a scroll's dwell.
    const tapped = ended.pendingValue;
    const isTap =
      event.type === 'pointerup' &&
      ended.intent === 'undecided' &&
      event.timeStamp - ended.startTime <= TAP_MAX_MS &&
      tapped !== null &&
      tapped !== ended.startValue;

    if (!isTap || tapped === null) {
      input.value = ended.startValue;
      return;
    }

    input.value = tapped;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const onValueEvent = (event: Event): void => {
    if (!gesture || gesture.intent === 'horizontal') return;
    gesture.pendingValue = input.value;
    input.value = gesture.startValue;
    event.stopImmediatePropagation();
  };

  input.addEventListener('pointerdown', onPointerDown);
  input.addEventListener('pointermove', onPointerMove);
  input.addEventListener('pointerup', endGesture);
  input.addEventListener('pointercancel', endGesture);
  input.addEventListener('input', onValueEvent);
  input.addEventListener('change', onValueEvent);

  return () => {
    gesture = null;
    input.removeEventListener('pointerdown', onPointerDown);
    input.removeEventListener('pointermove', onPointerMove);
    input.removeEventListener('pointerup', endGesture);
    input.removeEventListener('pointercancel', endGesture);
    input.removeEventListener('input', onValueEvent);
    input.removeEventListener('change', onValueEvent);
  };
}
