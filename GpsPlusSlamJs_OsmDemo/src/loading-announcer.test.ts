/**
 * Deciding WHEN to tell the user "we are loading".
 *
 * WHY THIS IS ITS OWN MODULE AND NOT THREE LINES IN `main.ts`. The demo's only
 * loading signal today is the header status line, and `index.html` hides it
 * whenever the header is collapsed - which is exactly what a user does to give
 * the 3D view the screen. A toast is the channel that survives that, and the
 * owner asked for one. But a toast fires on an EDGE, and every edge available
 * here is the wrong one:
 *
 * - the store's `loading.phase` goes idle after the FIRST of five rings, so it
 *   is not "a refresh is running" (see `latest-only.ts`'s `onBusyChange`);
 * - `refresh()` cannot tell a map click from a GPS fix, because the walking
 *   agent, the AR controller and the map click all arrive through one
 *   `positionChanged` subscriber - so the toast has to be ARMED at the gesture,
 *   where intent is still known;
 * - and an armed latch that nothing consumes is a toast waiting to fire on some
 *   later AUTOMATIC refresh, which is the one thing the owner ruled out.
 *
 * Every test below is about one of those, plus the two things the shared toast
 * does that surprise a caller: it replaces rather than stacks, and a repeat
 * `show()` on an attached element does not restart its CSS animation.
 *
 * @see loading-announcer.ts.md
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANNOUNCE_DELAY_MS,
  createLoadingAnnouncer,
  LOADING_MESSAGE,
  type LoadingSurface,
} from "./loading-announcer.js";

/**
 * Records what the surface was asked to do, in order.
 *
 * The ORDER is half the point: `clear` before `show` is what restarts the bar,
 * and a spy pair alone cannot show that.
 */
function recordingToast() {
  const calls: string[] = [];
  const show = vi.fn((message: string) => {
    calls.push(`show:${message}`);
  });
  const clear = vi.fn(() => {
    calls.push("clear");
  });
  const toast: LoadingSurface = { show, clear };
  return { toast, show, clear, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  return () => {
    vi.useRealTimers();
  };
});

describe("createLoadingAnnouncer", () => {
  it("shows the toast once an armed refresh outlives the delay", () => {
    const { toast, show, calls } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.arm();
    announcer.busyChanged(true);
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);

    // CLEARED FIRST, ALWAYS. `toast-core.ts` skips the re-append when its
    // element is still attached and assigns an identical class name, so a
    // repeat `show()` does NOT restart the bar's CSS animation - it would
    // empty on the first show's schedule while the toast lived on the
    // second's. Detaching is what restarts it.
    expect(calls).toEqual(["clear", `show:${LOADING_MESSAGE}`]);
    expect(show).toHaveBeenCalledWith(LOADING_MESSAGE);
  });

  it("stays silent when the refresh finishes before the delay", () => {
    // The delay's whole purpose. No refresh in this app is measured faster than
    // 1880 ms so this cannot happen today, which is exactly why it is a unit
    // test on a fake clock and not an e2e: there is no real scenario to drive.
    const { toast, calls } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.arm();
    announcer.busyChanged(true);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS - 1);
    announcer.busyChanged(false);
    vi.advanceTimersByTime(10_000);

    expect(calls).toEqual([]);
  });

  it("NEVER shows for a refresh nobody asked for", () => {
    // THE ITEM. The walking agent and a moving GPS fix re-enter the same cycle
    // every few steps; without the latch the bottom of the screen would carry a
    // near-permanent toast during exactly the activity the 3D view is for.
    const { toast, show, calls } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    for (let step = 0; step < 5; step++) {
      announcer.busyChanged(true);
      vi.advanceTimersByTime(60_000);
      announcer.busyChanged(false);
    }

    expect(calls).toEqual([]);
    expect(show).not.toHaveBeenCalled();
  });

  it("hides the toast the moment the data lands, not when the widening ends", () => {
    // The owner's words: "instantly hide it once the data is loaded". `busy`
    // cannot give this - it stays true through four more rings of widening,
    // so a toast hidden on `busy` alone would sit over a filled map for tens of
    // seconds describing a load that visibly finished.
    const { toast, calls } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.arm();
    announcer.busyChanged(true);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    calls.length = 0;

    announcer.dataArrived();

    expect(calls).toEqual(["clear"]);
  });

  it("still hides on the busy edge, because a FAILED refresh publishes nothing", () => {
    // The mirror of the test above, and the reason both paths exist: a refresh
    // that fails never calls `dataArrived`, so without this the toast would
    // hang about until its linger ran out on the one outcome where the user
    // most needs to know the app has stopped trying.
    const { toast, calls } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.arm();
    announcer.busyChanged(true);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    calls.length = 0;

    announcer.busyChanged(false);

    expect(calls).toEqual(["clear"]);
  });

  it("does not re-show when a later ring publishes", () => {
    // Scoring publishes once per ring. Re-showing on each would flash the toast
    // five times over one wait, with the bar restarting each time.
    const { toast, show } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.arm();
    announcer.busyChanged(true);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    announcer.dataArrived();
    announcer.dataArrived();
    announcer.dataArrived();
    vi.advanceTimersByTime(60_000);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it("announces a gesture made while a refresh is ALREADY running", () => {
    // Clicking the map again 20 s into a fetch supersedes it, and `latestOnly`
    // reports no busy transition for a supersession - so waiting for one would
    // leave the second click with no feedback at all. The latch is therefore
    // read at BOTH edges: when busy rises, and when a gesture arrives while it
    // is already high.
    const { toast, show } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.busyChanged(true);
    vi.advanceTimersByTime(20_000);
    announcer.arm();
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it("consumes the latch, so one gesture cannot announce two refreshes", () => {
    const { toast, show } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.arm();
    announcer.busyChanged(true);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    announcer.busyChanged(false);

    // A later automatic refresh - a terrain rebuild, an agent step.
    announcer.busyChanged(true);
    vi.advanceTimersByTime(60_000);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it("EXPIRES a latch whose refresh never came, at every TTL", () => {
    // The failure this closes: a gesture can arm without ever producing a
    // refresh - a locate that times out, a rejected fix, a click the cycle
    // coalesces away. The latch would then sit set until some unrelated
    // AUTOMATIC refresh consumed it and popped a toast the user never asked
    // for, minutes later and with nothing on screen to explain it.
    //
    // SWEPT, because the plan claimed it was and it was not (cold review). The
    // shipped 5 s is one point in a range where nothing about the behaviour
    // should change, and the boundary is checked in both directions.
    for (const armTtlMs of [2_000, 5_000, 15_000]) {
      const expired = recordingToast();
      const a = createLoadingAnnouncer({ toast: expired.toast, armTtlMs });
      a.arm();
      vi.advanceTimersByTime(armTtlMs);
      a.busyChanged(true);
      vi.advanceTimersByTime(60_000);
      expect(expired.show, `expired at ${armTtlMs} ms`).not.toHaveBeenCalled();

      const kept = recordingToast();
      const b = createLoadingAnnouncer({ toast: kept.toast, armTtlMs });
      b.arm();
      vi.advanceTimersByTime(armTtlMs - 1);
      b.busyChanged(true);
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
      expect(kept.show, `kept at ${armTtlMs} ms`).toHaveBeenCalledTimes(1);
    }
  });

  it("does not leave a SECOND gesture's latch behind for an automatic refresh", () => {
    // THE HOLE THE COLD REVIEW FOUND, and it hid behind an early return:
    // `startDelay` returned before disarming when a countdown was already
    // pending, so an impatient second click inside the delay window re-armed
    // the latch and nothing consumed it. The next automatic refresh - an agent
    // step, a GPS fix, both of which re-enter this cycle every few seconds -
    // then announced itself.
    //
    // Two clicks inside one second is ordinary behaviour for someone who thinks
    // the app ignored the first one, which is to say: exactly the user this
    // feature exists for.
    const { toast, show } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.arm();
    announcer.busyChanged(true);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS / 2);
    announcer.arm();
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(show).toHaveBeenCalledTimes(1);

    // The refresh ends, and an automatic one follows well inside the TTL.
    announcer.busyChanged(false);
    announcer.busyChanged(true);
    vi.advanceTimersByTime(60_000);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it("behaves the same across a range of delays", () => {
    // The owner's rule: a verdict from one parameter value is provisional. The
    // delay moved from 400 ms to 1 s mid-plan, so what must hold is the
    // BEHAVIOUR at any of them, not an assertion pinned to the shipped number.
    for (const delayMs of [400, 1_000, 2_000]) {
      const { toast, show } = recordingToast();
      const announcer = createLoadingAnnouncer({ toast, delayMs });

      announcer.arm();
      announcer.busyChanged(true);
      vi.advanceTimersByTime(delayMs - 1);
      expect(show, `no toast before ${delayMs} ms`).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(show, `toast at ${delayMs} ms`).toHaveBeenCalledTimes(1);
    }
  });

  it("restarts the bar when a second gesture re-announces", () => {
    // `toast-core.ts` reuses one element: on a replacement it neither re-appends
    // it nor changes its class, so the CSS animation carries on from the first
    // show. Clearing detaches it, and the next show re-attaches - which is the
    // only reason the bar and the dismissal stay in step.
    const { toast, calls } = recordingToast();
    const announcer = createLoadingAnnouncer({ toast });

    announcer.arm();
    announcer.busyChanged(true);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    announcer.arm();
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);

    expect(calls).toEqual([
      "clear",
      `show:${LOADING_MESSAGE}`,
      "clear",
      `show:${LOADING_MESSAGE}`,
    ]);
  });
});
