/**
 * Decides when the demo says "we are loading" in a channel the header cannot
 * hide.
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

import type { Toast } from "gps-plus-slam-app-framework/utils/toast-core";

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
 * The toast's lifetime, and therefore what its bar measures.
 *
 * A CEILING, not the usual lifetime: the toast normally goes when the data
 * lands. This only decides how long it stays on a wait that outlives it - and
 * the bar drains over exactly this span, which is the one duration the bar can
 * promise honestly. A bar scaled to the FETCH would read 100% while a median
 * cold tile still had ten seconds to go.
 *
 * The CSS animation that draws the bar must use the same number;
 * `loading-toast-duration.test.ts` is what keeps the two from drifting.
 */
export const LOADING_TOAST_LINGER_MS = 15_000;

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
export const LOADING_TOAST_MESSAGE = "Loading OpenStreetMap data…";

/**
 * The toast element's class while loading.
 *
 * `toast-core` REPLACES the class name rather than adding to it, so the base
 * `toast` class has to be repeated here or the element loses its look.
 *
 * `toast--timed` is the design system's atom for a toast that draws its own
 * countdown; its bar drains over `--t-toast-timed`, which must stay equal to
 * {@link LOADING_TOAST_LINGER_MS} — `loading-toast-duration.test.ts` is what
 * holds the two together. Placement comes from the element's `id`, which
 * `index.html` positions; the class name is replaced on every show and would
 * take the placement with it.
 */
const LOADING_TOAST_CLASS = "toast toast--timed";

export interface LoadingAnnouncerOptions {
  /** The surface to announce on. A SEPARATE instance from the error toast. */
  readonly toast: Toast;
  /** Overrides {@link ANNOUNCE_DELAY_MS}. */
  readonly delayMs?: number;
  /** Overrides {@link LOADING_TOAST_LINGER_MS}. */
  readonly lingerMs?: number;
  /** Overrides {@link DEFAULT_ARM_TTL_MS}. */
  readonly armTtlMs?: number;
}

export interface LoadingAnnouncer {
  /** A user gesture happened. The refresh it starts may be announced. */
  arm(): void;
  /** Wired to `latestOnly`'s `onBusyChange`. */
  busyChanged(busy: boolean): void;
  /** A snapshot reached the map. Takes the toast down at once. */
  dataArrived(): void;
  /** Drops every pending timer and any toast still showing. */
  dispose(): void;
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
  const lingerMs = options.lingerMs ?? LOADING_TOAST_LINGER_MS;
  const armTtlMs = options.armTtlMs ?? DEFAULT_ARM_TTL_MS;

  let armed = false;
  let busy = false;
  /** Tracked rather than asked, because `Toast` cannot be asked. */
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
    if (delayTimer !== undefined) return;
    disarm();
    delayTimer = setTimeout(() => {
      delayTimer = undefined;
      // CLEAR THEN SHOW, ALWAYS. See the module docstring: a replacement leaves
      // the element attached and its class unchanged, so the bar's animation
      // would not restart and would finish on the previous show's schedule.
      toast.clear();
      toast.show(LOADING_TOAST_MESSAGE, {
        className: LOADING_TOAST_CLASS,
        lingerMs,
      });
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

    dispose() {
      disarm();
      hide();
    },
  };
}
