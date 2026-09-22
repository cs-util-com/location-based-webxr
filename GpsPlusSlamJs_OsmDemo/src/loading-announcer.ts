/**
 * Decides WHEN the demo says "we are loading". The surface it drives is
 * `loading-overlay.ts`, centred on the 3D scene; this module owns only the
 * timing, and is tested on a fake clock because that is the part where the
 * mistakes live.
 *
 * WHY THE STATUS LINE IS NOT ENOUGH. `index.html` hides `#status` and its whole
 * block under `header[data-collapsed="true"]`, and collapsing the header is
 * precisely what a user does to give the 3D view the screen. A res-7 tile takes
 * tens of seconds, so the app can look frozen for half a minute with nothing on
 * screen to say otherwise. The toast is the channel that survives a collapsed
 * header; this module decides when it is allowed to appear.
 *
 * THE THREE THINGS THAT MAKE THAT DECISION NON-TRIVIAL:
 *
 * 1. **"A refresh is running" is not the store's `loading.phase`.**
 *    `refresh-cycle.ts` dispatches `fetchStarted` once, before the ring loop,
 *    and every ring's `snapshotReady` puts the phase back to idle - so the phase
 *    is idle for most of the wait. The honest signal is `latestOnly`'s `busy`,
 *    which is why that module gained `onBusyChange`.
 * 2. **`refresh()` cannot tell who called it.** A map click, a GPS fix, the
 *    walking agent and the AR controller all arrive through one
 *    `positionChanged` subscriber. The owner asked for the toast on
 *    user-initiated refreshes only, so intent is latched at the gesture - the
 *    one place it is still known - and read here.
 * 3. **A latch nothing consumes is a bug waiting to fire.** A gesture can arm
 *    without ever producing a refresh, and the latch would then be consumed by
 *    some later automatic refresh, popping a toast the user never asked for.
 *    Hence {@link LoadingAnnouncerOptions.armTtlMs}.
 *
 * AND TWO THINGS THE SHARED TOAST DOES THAT A CALLER MUST KNOW. It replaces
 * rather than stacks, so the loading toast is a SEPARATE instance from the error
 * toast; and on a replacement it neither re-appends its element nor changes its
 * class, so a CSS animation on it does not restart. That is why every show here
 * is preceded by a clear.
 *
 * @see loading-announcer.ts.md
 */

/**
 * The surface this drives. Structurally what `loading-overlay.ts` provides,
 * and deliberately NOT the framework's `Toast`: a toast owns its own
 * lifetime, and the whole point of this decision logic is that the surface
 * leaves when the DATA says so, not when a timer does.
 */
export interface LoadingSurface {
  show(message: string): void;
  clear(): void;
}

/**
 * How long a refresh must run before it is announced.
 *
 * Owner decision, revised from 400 ms once the measurement was on the table:
 * the fastest refetch path in this demo is 1880 ms, so nothing in the hundreds
 * of milliseconds discriminates between a quick refresh and a slow one. At 1 s
 * the delay still lands well inside every real wait, and it keeps the toast off
 * a future fast path rather than having to be re-litigated then.
 */
export const ANNOUNCE_DELAY_MS = 1_000;

/**
 * How long an unconsumed gesture stays armed.
 *
 * Every gesture wired to {@link LoadingAnnouncer.arm} dispatches its refresh
 * synchronously, so in practice the latch is consumed in the same task. This is
 * the guard for the paths that do not: a gesture whose refresh is coalesced
 * away, or one that never starts at all.
 */
const DEFAULT_ARM_TTL_MS = 5_000;

/** What the toast says. Never empty: an empty toast announces nothing to AT. */
export const LOADING_MESSAGE = "Loading OpenStreetMap data…";

export interface LoadingAnnouncerOptions {
  /** The surface to announce on. */
  readonly toast: LoadingSurface;
  /** Overrides {@link ANNOUNCE_DELAY_MS}. */
  readonly delayMs?: number;
  /** Overrides {@link DEFAULT_ARM_TTL_MS}. */
  readonly armTtlMs?: number;
}

export interface LoadingAnnouncer {
  /** A user gesture happened. The refresh it starts may be announced. */
  arm(): void;
  /** Wired to `latestOnly`'s `onBusyChange`. */
  busyChanged(busy: boolean): void;
  /**
   * A snapshot reached the map. Takes the toast down at once.
   *
   * **Call this only when there IS a snapshot.** Two actions replace it with
   * `undefined` - `placeChanged` and `fetchFailed` - and reporting those as
   * data arriving cancels a pending announcement for the gesture that caused
   * them. The site picker dispatches `placeChanged`, so the unguarded wiring
   * silenced the longest wait in the demo.
   */
  dataArrived(): void;
}

/**
 * Wires the decision. Nothing here touches the DOM: the toast does that, and
 * the clock is the ambient one, so tests run on `vi.useFakeTimers()`.
 */
export function createLoadingAnnouncer(
  options: LoadingAnnouncerOptions,
): LoadingAnnouncer {
  const { toast } = options;
  const delayMs = options.delayMs ?? ANNOUNCE_DELAY_MS;
  const armTtlMs = options.armTtlMs ?? DEFAULT_ARM_TTL_MS;

  let armed = false;
  let busy = false;
  /** Tracked rather than asked: the surface has no readable state. */
  let showing = false;
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let armTimer: ReturnType<typeof setTimeout> | undefined;

  function disarm(): void {
    armed = false;
    if (armTimer === undefined) return;
    clearTimeout(armTimer);
    armTimer = undefined;
  }

  function cancelDelay(): void {
    if (delayTimer === undefined) return;
    clearTimeout(delayTimer);
    delayTimer = undefined;
  }

  function hide(): void {
    cancelDelay();
    if (!showing) return;
    showing = false;
    toast.clear();
  }

  /**
   * Arms the countdown, consuming the latch.
   *
   * Idempotent while one is pending: two gestures inside the delay window are
   * one wait, and restarting the countdown would push the toast further away
   * the more impatiently the user clicked.
   */
  function startDelay(): void {
    // DISARMED FIRST, ABOVE THE EARLY RETURN, and the order is the whole point.
    // With it below, a second gesture inside the delay window re-armed the latch
    // and then returned without consuming it - leaving `armed` true with a fresh
    // TTL, for the next AUTOMATIC refresh to claim. An agent step or a GPS fix
    // within the TTL would then announce a refresh nobody asked for, which is
    // exactly the failure the TTL exists to prevent. Found in cold review.
    disarm();
    if (delayTimer !== undefined) return;
    delayTimer = setTimeout(() => {
      delayTimer = undefined;
      // CLEAR THEN SHOW, ALWAYS. The surface restarts its bar on a fresh
      // attach, so a show over an already-visible overlay would otherwise
      // continue the previous drain instead of starting this wait's own.
      toast.clear();
      toast.show(LOADING_MESSAGE);
      showing = true;
    }, delayMs);
  }

  return {
    arm() {
      armed = true;
      if (armTimer !== undefined) clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        armTimer = undefined;
        armed = false;
      }, armTtlMs);
      // READ AT BOTH EDGES. `latestOnly` reports no transition for a
      // supersession, so a click landing 20 s into a fetch would otherwise get
      // no feedback at all - the case where the user is most likely to think
      // the app ignored them.
      if (busy) startDelay();
    },

    busyChanged(next) {
      busy = next;
      if (next) {
        if (armed) startDelay();
        return;
      }
      // The falling edge is the only way a FAILED refresh takes the toast down:
      // it publishes no snapshot, so `dataArrived` never comes.
      hide();
    },

    dataArrived() {
      // The owner's "instantly hide it once the data is loaded". `busy` cannot
      // serve here - it stays true through four more rings of widening, long
      // after the map visibly filled.
      hide();
    },
  };
}
