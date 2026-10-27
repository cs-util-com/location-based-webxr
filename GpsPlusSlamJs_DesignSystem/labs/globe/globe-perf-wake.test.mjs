/**
 * Tests for the recorder's screen wake lock.
 *
 * Why this file matters: a phone locks its screen after 30 s to 2 min of
 * no touch, and the sweep must not be touched for about ten minutes. A
 * locked screen hides the page, which voids the run in progress and
 * stalls the sweep; without a lock the phone test is wasted. The lock is
 * asked for at the start, asked for again when the page comes back (a
 * browser drops it whenever the page is hidden), released at the end, and
 * every refusal and loss is recorded, so the export says whether the
 * screen was kept awake and the tester is told when it was not.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createWakeKeeper } from "./globe-perf-wake.js";

/** A document whose visibility the test sets; it fires visibilitychange. */
function fakeDoc() {
  const listeners = new Set();
  return {
    visibilityState: "visible",
    addEventListener(type, fn) {
      if (type === "visibilitychange") listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === "visibilitychange") listeners.delete(fn);
    },
    set(state) {
      this.visibilityState = state;
      for (const fn of [...listeners]) fn();
    },
    listeners,
  };
}

/** A wake-lock API: `refuse` makes the next requests fail. */
function fakeWakeLock() {
  const api = {
    refuse: null,
    requests: 0,
    sentinels: [],
    async request(type) {
      api.requests += 1;
      assert.equal(type, "screen");
      if (api.refuse) throw api.refuse;
      const listeners = new Set();
      const sentinel = {
        released: false,
        addEventListener(t, fn) {
          if (t === "release") listeners.add(fn);
        },
        async release() {
          if (sentinel.released) return;
          sentinel.released = true;
          for (const fn of listeners) fn();
        },
      };
      api.sentinels.push(sentinel);
      return sentinel;
    },
  };
  return api;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createWakeKeeper", () => {
  it("holds the screen from start to stop and releases it at the end", async () => {
    const wakeLock = fakeWakeLock();
    const doc = fakeDoc();
    const keeper = createWakeKeeper({ wakeLock, doc });
    assert.equal(await keeper.start(), true);
    assert.equal(keeper.report().held, true);
    await keeper.stop();
    assert.equal(wakeLock.sentinels[0].released, true);
    assert.deepEqual(keeper.report(), {
      supported: true,
      held: false,
      everHeld: true,
      requests: 1,
      refused: [],
      lost: 0,
      reacquired: 0,
      heldThroughout: true,
    });
    // Stopped: a later return to the page asks for nothing.
    doc.set("visible");
    await tick();
    assert.equal(wakeLock.requests, 1);
    assert.equal(doc.listeners.size, 0);
  });
  it("asks again when the page comes back after the browser dropped the lock", async () => {
    const wakeLock = fakeWakeLock();
    const doc = fakeDoc();
    const keeper = createWakeKeeper({ wakeLock, doc });
    await keeper.start();
    // Hidden: the browser releases the lock itself.
    doc.set("hidden");
    await wakeLock.sentinels[0].release();
    assert.equal(keeper.report().held, false);
    doc.set("visible");
    await tick();
    const r = keeper.report();
    assert.equal(r.held, true);
    assert.equal(r.lost, 1);
    assert.equal(r.reacquired, 1);
    assert.equal(r.requests, 2);
    assert.equal(r.heldThroughout, false);
    await keeper.stop();
  });
  it("records a refusal and reports the screen as not kept awake", async () => {
    const wakeLock = fakeWakeLock();
    wakeLock.refuse = Object.assign(new Error("battery saver"), {
      name: "NotAllowedError",
    });
    const keeper = createWakeKeeper({ wakeLock, doc: fakeDoc() });
    assert.equal(await keeper.start(), false);
    const r = keeper.report();
    assert.equal(r.held, false);
    assert.equal(r.everHeld, false);
    assert.equal(r.heldThroughout, false);
    assert.deepEqual(r.refused, ["NotAllowedError: battery saver"]);
    await keeper.stop();
  });
  it("reads a browser without the API as unsupported, never throws", async () => {
    const keeper = createWakeKeeper({ wakeLock: undefined, doc: fakeDoc() });
    assert.equal(await keeper.start(), false);
    assert.equal(keeper.report().supported, false);
    assert.equal(keeper.report().heldThroughout, false);
    await keeper.stop();
  });
  it("keeps at most ten refusals", async () => {
    const wakeLock = fakeWakeLock();
    wakeLock.refuse = new Error("no");
    const doc = fakeDoc();
    const keeper = createWakeKeeper({ wakeLock, doc });
    await keeper.start();
    for (let i = 0; i < 15; i++) {
      doc.set("visible");
      await tick();
    }
    assert.equal(keeper.report().refused.length, 10);
    await keeper.stop();
  });
});
