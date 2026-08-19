/**
 * The terrain gate — W3's join, and the case that broke the design before it.
 *
 * Why these tests matter:
 * W3 unblocks the refresh from the DEM grid, which is worth seconds per click
 * and is only safe while something still guarantees the mesh is built on the
 * terrain of ITS OWN position. The first design guaranteed that by message
 * order; these tests exist because message order does not hold (DEC-R3-20) —
 * `loadTerrain` is `latestOnly`-wrapped and only queues while busy, so an
 * `update` can genuinely reach the worker first. The decisive test is
 * "waits for a centre that has not been requested yet".
 *
 * @see terrain-gate.ts.md
 */

import { describe, expect, it, vi } from "vitest";

import { createTerrainGate, needsTerrainFor } from "./terrain-gate.js";

const HERE = { lat: 50.9413, lng: 6.9583 };
const THERE = { lat: 50.9231, lng: 6.9445 };

/** A gate whose timeout is driven by the test rather than by the clock. */
function gateWithManualTimer() {
  const timers: (() => void)[] = [];
  const gate = createTerrainGate({
    timeoutMs: 1000,
    setTimer: (run) => {
      timers.push(run);
      return timers.length - 1;
    },
    clearTimer: () => undefined,
  });
  return { gate, fireTimeout: () => timers.forEach((run) => run()) };
}

/** Resolves to true only if `promise` settles within the current task queue. */
async function settledNow(promise: Promise<void>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    Promise.resolve().then(() => false),
  ]);
}

describe("createTerrainGate", () => {
  it("waits for a centre that has NOT been requested yet, then releases", async () => {
    // THE CASE THAT DECIDED THE DESIGN (DEC-R3-20). The first version keyed the
    // join on message order — `terrain` is posted before `update`, so the pending
    // load must already be registered. It is not: `loadTerrain` is
    // `latestOnly`-wrapped, so while a DEM load is in flight a new position only
    // QUEUES, and a refresh that is idle posts its `update` synchronously first.
    // A gate that only knew about loads already begun would let that update
    // straight through, onto the previous position's relief — rebuilding exactly
    // the bug W3 exists to avoid, in the one case an ordering test cannot cover.
    const { gate } = gateWithManualTimer();

    const waiting = gate.waitFor(THERE);
    expect(await settledNow(waiting)).toBe(false);

    gate.settle(THERE);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("returns immediately when that centre has already settled — INCLUDING for a re-load", async () => {
    // The common path: the terrain for this position landed while the fetch and
    // the scoring were still running, which is the entire point of running them
    // concurrently. Waiting here would give back the seconds W3 just won.
    //
    // THE SAME THREE LINES ALSO PIN THE LIMITATION, which is why this test's
    // name says so rather than a second test restating it. `createTerrainGate`'s
    // header claimed until 2026-08-19 that "a new load for the same centre
    // clears it, so a re-load is waited for" — the opposite of what happens.
    // Nothing clears `settledKey`; `settle` only assigns, and the gate is never
    // told a load has STARTED, only that one finished. So a second load at an
    // unchanged centre is answered from the first one's result, and there is no
    // way to express "a re-load began" in a test because there is no API for it.
    //
    // A separate test was briefly added for this and was three identical lines
    // under a name it could not honour; review caught the duplication. The
    // limitation lives in the header, with the way to lift it (put the
    // distinguishing fact in `keyOf`, as `undulationM` already does).
    const { gate } = gateWithManualTimer();
    gate.settle(HERE);

    expect(await settledNow(gate.waitFor(HERE))).toBe(true);
  });

  it("does not release a waiter when a DIFFERENT centre settles", async () => {
    // Position is the whole key. A terrain load for somewhere else answers
    // nothing about the ground under this mesh — releasing on it would be the
    // stale-field bug with extra steps.
    const { gate } = gateWithManualTimer();

    const waiting = gate.waitFor(THERE);
    gate.settle(HERE);

    expect(await settledNow(waiting)).toBe(false);
  });

  it("forgets a settled centre as soon as a DIFFERENT centre settles", async () => {
    // Why this test matters: it is the ONLY thing that displaces the gate's
    // memory, because `settledKey` is a single slot with no other writer.
    //
    // RENAMED 2026-08-19. It used to be called "waits again after a NEW load
    // starts for a settled centre", which is not what it does: it settles
    // `THERE` in between, so what it actually proves is displacement by another
    // centre. The same-centre case it appeared to cover is pinned separately
    // below — and behaves the opposite way.
    const { gate } = gateWithManualTimer();
    gate.settle(HERE);
    expect(await settledNow(gate.waitFor(HERE))).toBe(true);

    gate.settle(THERE);
    const waiting = gate.waitFor(HERE);
    expect(await settledNow(waiting)).toBe(false);
    gate.settle(HERE);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("gives up when the caller's run is superseded", async () => {
    // A superseded update has nothing to build; holding it open would keep the
    // worker busy on ground the user has left.
    const { gate } = gateWithManualTimer();
    const controller = new AbortController();

    const waiting = gate.waitFor(THERE, controller.signal);
    expect(await settledNow(waiting)).toBe(false);

    controller.abort();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("returns immediately for an already-aborted run", async () => {
    const { gate } = gateWithManualTimer();
    const controller = new AbortController();
    controller.abort();

    expect(await settledNow(gate.waitFor(THERE, controller.signal))).toBe(true);
  });

  it("gives up on the timeout, so a dropped load cannot hang the mesh", async () => {
    // THE BACKSTOP, and the reason it exists rather than being "unreachable by
    // construction": every modelled path settles the gate, so reaching this
    // means something was dropped in a way nothing modelled — and a worker that
    // never replies is a demo that silently stops, which is strictly worse than
    // a mesh on a slightly stale surface.
    const { gate, fireTimeout } = gateWithManualTimer();

    const waiting = gate.waitFor(THERE);
    expect(await settledNow(waiting)).toBe(false);

    fireTimeout();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("removes its abort listener once released, so a long session cannot leak", async () => {
    // The gate is asked once per mesh build, i.e. three times per click, for the
    // life of the page. A listener left on a signal that outlives the wait is the
    // ordinary way that becomes a leak.
    const { gate } = gateWithManualTimer();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    const waiting = gate.waitFor(THERE, controller.signal);
    gate.settle(THERE);
    await waiting;

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("needsTerrainFor", () => {
  it("waits when no terrain has ever been loaded", () => {
    // The first mesh build of the session. Before W3 it could not happen — the
    // refresh was chained behind the terrain — and now it routinely does.
    expect(needsTerrainFor(undefined, HERE)).toBe(true);
  });

  it("does NOT wait when the held field already belongs to this position", () => {
    // THE COMMON PATH, and the regression the join can cause: a category change
    // and every widening ring re-enter the mesh build without moving the user.
    // Waiting there would stall each of them on the gate's full timeout — a demo
    // that hangs on every category switch, which is worse than the bug being
    // fixed.
    expect(needsTerrainFor(HERE, HERE)).toBe(false);
  });

  it("waits when the user has moved, in either coordinate", () => {
    expect(needsTerrainFor(HERE, THERE)).toBe(true);
    expect(needsTerrainFor(HERE, { lat: HERE.lat, lng: THERE.lng })).toBe(true);
    expect(needsTerrainFor(HERE, { lat: THERE.lat, lng: HERE.lng })).toBe(true);
  });
});

describe("the datum is part of the gate's identity (AR entry, 2026-08-14)", () => {
  /**
   * WHY THESE TESTS EXIST — a field report with two numbers.
   *
   * The owner entered AR and was "flying roughly 50 m above the OSM buildings";
   * they left, re-entered, and were "about 4 m below" — i.e. right, to within
   * ordinary GPS-altitude and DEM error. The first entry was wrong and the
   * second was fine, which is the signature of a field built against the wrong
   * DATUM rather than of a broken solve.
   *
   * The mechanism: `terrain-field.ts` uses the WINDOW-CENTRE height as its
   * datum for the desktop view (so heights come out as relief around zero) and
   * `−N` for AR (so heights come out ellipsoidal, ~99 m at Cologne, which is
   * where the fusion puts the camera). AR entry re-runs the pass at the
   * UNCHANGED store position, so a gate keyed on lat/lng alone answers "no new
   * terrain needed" and the mesh is built on the desktop field while the camera
   * is lifted to ellipsoidal height. On the second entry the AR field is
   * already held, which is why it looked fine.
   *
   * `demo-worker.ts:675-685` predicted exactly this class of failure — "if the
   * anchor ever gains a second mover … this has to key on the frame origin as
   * well … and it is silent". It named the wrong mover: the datum became the
   * second one, not the origin.
   */
  const AT = { lat: 50.9413, lng: 6.9583 };

  it("needs new terrain when the datum changes but the position does not", () => {
    // The AR-entry case exactly: same position, desktop field held, absolute
    // datum now required. Answering `false` here is the bug.
    expect(
      needsTerrainFor(
        { ...AT, undulationM: undefined },
        { ...AT, undulationM: 46.2 },
      ),
    ).toBe(true);
  });

  it("needs new terrain when AR leaves and the datum goes back to the window", () => {
    // The mirror case on AR exit, which has the same hole: the held field is
    // ellipsoidal and the desktop view wants relief around zero.
    expect(
      needsTerrainFor(
        { ...AT, undulationM: 46.2 },
        { ...AT, undulationM: undefined },
      ),
    ).toBe(true);
  });

  it("does NOT need new terrain when position and datum both match", () => {
    // The other half, and the one that keeps the gate cheap: a category change
    // or a widening ring must still skip the wait, or W3's win is given back.
    expect(
      needsTerrainFor(
        { ...AT, undulationM: 46.2 },
        { ...AT, undulationM: 46.2 },
      ),
    ).toBe(false);
    expect(
      needsTerrainFor(
        { ...AT, undulationM: undefined },
        { ...AT, undulationM: undefined },
      ),
    ).toBe(false);
  });

  it("keeps two datums at one position as SEPARATE settled entries", () => {
    // The gate remembers one settled centre. If the key ignored the datum, an
    // AR-entry wait would be released by the desktop field that settled before
    // it — the same bug one layer down, and the reason `keyOf` has to change
    // with the predicate rather than after it.
    const gate = createTerrainGate();
    gate.settle({ ...AT, undulationM: undefined });

    let released = false;
    void gate.waitFor({ ...AT, undulationM: 46.2 }).then(() => {
      released = true;
    });

    return Promise.resolve().then(() => {
      expect(released).toBe(false);
    });
  });
});
