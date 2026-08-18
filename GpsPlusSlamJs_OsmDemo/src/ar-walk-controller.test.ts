/**
 * The walk controller — the state the gate needs, held in one place.
 *
 * WHY A CONTROLLER RATHER THAN TWO `let`s IN `main.ts`. The gate is a pure
 * function, but it needs three pieces of state that have to agree: where the
 * data currently in the scene was fetched for, whether a pass is running, and
 * where the session was anchored. M1 of this plan shipped three modules that
 * were each correct in isolation with nothing asserting they were connected,
 * and four green gates passed all three. State that lives in `main.ts` is state
 * no test can reach.
 *
 * @see ar-walk-controller.ts.md
 */

import { describe, it, expect, vi } from "vitest";

import { startArWalk } from "./ar-walk-controller.js";
import { AR_REFRESH_DISTANCE_M, FAR_TRAVEL_WARN_M } from "./ar-walking.js";

const ORIGIN = { lat: 50.9413, lng: 6.9583 };

function north(metres: number): { lat: number; lng: number } {
  return { lat: ORIGIN.lat + metres / 111_320, lng: ORIGIN.lng };
}

/** A refetch that never settles until the test lets it. */
function pendingRefetch() {
  const calls: { lat: number; lng: number }[] = [];
  let release: () => void = () => undefined;
  const refetch = vi.fn((position: { lat: number; lng: number }) => {
    calls.push(position);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  return { refetch, calls, release: () => release() };
}

describe("startArWalk", () => {
  it("refetches once the user has walked past the threshold", () => {
    const { refetch, calls } = pendingRefetch();
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    walk.positionChanged(north(AR_REFRESH_DISTANCE_M + 10));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.lat).toBeCloseTo(north(AR_REFRESH_DISTANCE_M + 10).lat, 6);
  });

  it("ignores the small steps a 1 Hz watch is made of", () => {
    // THE STARVATION CASE. Ten fixes a few metres apart is what standing at a
    // crossing looks like; each one reaching `refresh` aborts the last.
    const { refetch } = pendingRefetch();
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    for (let i = 1; i <= 10; i++) walk.positionChanged(north(i * 3));

    expect(refetch).not.toHaveBeenCalled();
  });

  it("measures from the LAST REFETCH, not from the session origin", async () => {
    // The distinction that makes a continuous walk work. Measuring from the
    // origin would refetch once at 100 m and then on EVERY subsequent fix,
    // since every one of them is also more than 100 m from the origin — the
    // starvation case arriving by the opposite route.
    const { refetch, calls, release } = pendingRefetch();
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    walk.positionChanged(north(110));
    release();
    await Promise.resolve();
    await Promise.resolve();
    // 30 m further on: past the threshold from the ORIGIN, nowhere near it
    // from the last refetch.
    walk.positionChanged(north(140));

    expect(calls).toHaveLength(1);
  });

  it("refetches again once the user walks a further threshold", async () => {
    const { refetch, calls, release } = pendingRefetch();
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    walk.positionChanged(north(110));
    release();
    await Promise.resolve();
    await Promise.resolve();
    walk.positionChanged(north(250));

    expect(calls).toHaveLength(2);
  });

  it("does not start a second pass while the first is running", () => {
    // §2.6's other half. `refresh` is `latestOnly`: a second call aborts the
    // run in flight, so a fast walker crossing the threshold twice during one
    // slow pass would abort the run that was about to publish — and the view
    // would stay empty for as long as they kept walking.
    const { refetch, calls } = pendingRefetch();
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    walk.positionChanged(north(110));
    walk.positionChanged(north(250));
    walk.positionChanged(north(400));

    expect(calls).toHaveLength(1);
  });

  it("re-opens the gate after a pass FAILS, not only after it succeeds", async () => {
    // The `finally` this pins. A rejected refetch that left `inFlight` true
    // would wedge the gate shut for the rest of the session: one failed fetch
    // and AR silently stops following the user, with no error after the first.
    const refetch = vi
      .fn<(p: { lat: number; lng: number }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    walk.positionChanged(north(110));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    walk.positionChanged(north(250));

    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("advances its reference even though the failed pass drew nothing", async () => {
    // A judgement call, recorded because it could reasonably go the other way.
    // Holding the reference back after a failure would retry from the old
    // position — but the user has walked on, and the data they need is where
    // they ARE. Retrying the place they left is the wrong fetch.
    const refetch = vi
      .fn<(p: { lat: number; lng: number }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    walk.positionChanged(north(110));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 30 m past the FAILED position — under the threshold from there, over it
    // from the origin.
    walk.positionChanged(north(140));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("warns once the user is far from where the session was anchored", () => {
    const { refetch, release } = pendingRefetch();
    const warn = vi.fn();
    const walk = startArWalk({ origin: ORIGIN, dataAt: ORIGIN, refetch, warn });

    walk.positionChanged(north(FAR_TRAVEL_WARN_M + 100));
    release();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("km"));
  });

  it("stays quiet close to the anchor", () => {
    const { refetch } = pendingRefetch();
    const warn = vi.fn();
    const walk = startArWalk({ origin: ORIGIN, dataAt: ORIGIN, refetch, warn });

    walk.positionChanged(north(AR_REFRESH_DISTANCE_M + 10));

    expect(warn).not.toHaveBeenCalled();
  });

  it("KEEPS warning as the user goes further, rather than warning once", async () => {
    // "Warn from 2 km and keep warning past 5 km" (§2.4), and the repetition is
    // deliberate rather than sloppy: the number in the message is the thing the
    // user's decision turns on, and it is growing. A single toast at the 2 km
    // crossing is stale advice by 4 km — the placement is measurably worse and
    // nothing has said so.
    //
    // The cadence is bounded by the refetch gate itself: warnings can only
    // arrive one per 100 m of walking, roughly one per 71 s.
    const { refetch, release } = pendingRefetch();
    const warn = vi.fn();
    const walk = startArWalk({ origin: ORIGIN, dataAt: ORIGIN, refetch, warn });

    walk.positionChanged(north(2100));
    release();
    await Promise.resolve();
    await Promise.resolve();
    walk.positionChanged(north(6000));

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toContain("6.0");
  });

  it("gates from where the DATA is, not from where the session was anchored", () => {
    // A REAL BUG, not a hypothetical (r509 review). `zero` is the first locate
    // fix and immutable; the scene's data was fetched for the store position,
    // which a map click moves without touching `zero`. Seeding the gate from
    // `origin` meant that after "locate at A, click 2 km away, enter AR at A",
    // every real fix was ~0 m from the seed — the gate never opened and AR
    // showed the city from 2 km away, indefinitely and with no error.
    const { refetch } = pendingRefetch();
    const walk = startArWalk({
      origin: ORIGIN,
      // The data is 2 km north; the user is standing at the origin.
      dataAt: north(2000),
      refetch,
      warn: vi.fn(),
    });

    // A fix at the origin: 0 m from `origin`, 2 km from where the data is.
    walk.positionChanged(north(1));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("reopens the gate when refetch throws SYNCHRONOUSLY", () => {
    // The `try` this pins. A synchronous throw escapes before any `.finally`
    // attached to the returned promise, so the gate would stay shut for the
    // rest of the session — the exact failure the async path's `finally` is
    // there to prevent, arriving by a route it does not cover.
    const refetch = vi.fn(() => {
      throw new Error("synchronous");
    });
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    walk.positionChanged(north(110));
    walk.positionChanged(north(250));

    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("stops refetching once disposed", () => {
    // The session ended. A fix that arrives after teardown must not resample
    // terrain against an AR datum the desktop view is no longer using.
    const { refetch } = pendingRefetch();
    const walk = startArWalk({
      origin: ORIGIN,
      dataAt: ORIGIN,
      refetch,
      warn: vi.fn(),
    });

    walk.dispose();
    walk.positionChanged(north(500));

    expect(refetch).not.toHaveBeenCalled();
  });
});
