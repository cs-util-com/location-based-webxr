import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_MAX_BYTES,
  AUTOSAVE_MAX_WAIT_MS,
  autosaveFits,
  createAutosave,
  type Autosave,
  type AutosaveOutcome,
  type AutosaveState,
} from "./autosave.js";

/**
 * Why these tests matter (M6 E2b-2, the E2b plan review #3, #7, #11): the
 * editor writes the creator's file by itself. A save that starts while a
 * delete can still be undone ends that undo; two saves at once race on one
 * file; a save that fails and is retried on every change is a write loop
 * against a file that refuses it; a delay that waits for quiet starves a
 * creator who never stops. Each is pinned here on fake timers.
 */

/** A page stand-in: a version counter for the edits, one for the file. */
function fakePage(options: { saveMs?: number; land?: () => boolean } = {}) {
  const page = {
    version: 0,
    saved: 0,
    held: false,
    calls: 0,
    inFlight: 0,
    maxInFlight: 0,
    states: [] as AutosaveState[],
  };
  const autosave = createAutosave({
    save: () => {
      page.calls += 1;
      page.inFlight += 1;
      page.maxInFlight = Math.max(page.maxInFlight, page.inFlight);
      const snapshot = page.version;
      return new Promise<AutosaveOutcome>((resolve) => {
        setTimeout(() => {
          page.inFlight -= 1;
          const ok = options.land?.() ?? true;
          if (ok) page.saved = snapshot;
          resolve(ok ? "saved" : "failed");
        }, options.saveMs ?? 100);
      });
    },
    held: () => page.held,
    pending: () => page.version > page.saved,
    onState: (s) => {
      page.states.push(s);
    },
  });
  autosave.enable(true);
  const edit = (): void => {
    page.version += 1;
    autosave.changed();
  };
  return { page, autosave, edit };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAutosave", () => {
  it("saves once, the delay after the last change, and a change restarts the delay", async () => {
    const { page, edit } = fakePage();
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 500);
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 500);
    expect(page.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(page.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(page.saved).toBe(2);
    expect(page.calls).toBe(1);
  });

  it("does not starve a creator who never stops: the max wait saves anyway", async () => {
    const { page, edit } = fakePage();
    // A change every half delay: the quiet the delay waits for never comes.
    for (
      let t = 0;
      t < AUTOSAVE_MAX_WAIT_MS + 1_000;
      t += AUTOSAVE_DELAY_MS / 2
    ) {
      edit();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS / 2);
    }
    expect(page.calls).toBe(1);
  });

  it("waits while held, and a poke after the hold starts the save that was due", async () => {
    const { page, autosave, edit } = fakePage();
    page.held = true;
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 4);
    expect(page.calls).toBe(0);
    expect(autosave.state()).toBe("held");
    page.held = false;
    autosave.poke();
    expect(page.calls).toBe(1);
  });

  // Why (E2b-2 milestone review #4): a field typed in and then put back
  // as it was commits nothing, so the page has no change to report and no
  // poke to give - and a save that fell due during the typing waited for
  // the NEXT change, however long that took.
  it("a hold that ends without a poke still saves: it is looked at again each delay", async () => {
    const { page, autosave, edit } = fakePage();
    edit();
    page.held = true;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(page.calls).toBe(0);
    expect(autosave.state()).toBe("held");
    page.held = false;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(page.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(page.saved).toBe(page.version);
  });

  it("a poke with no save due starts nothing", async () => {
    const { page, autosave, edit } = fakePage();
    autosave.poke();
    edit();
    autosave.poke();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS / 2);
    expect(page.calls).toBe(0);
  });

  it("runs one save at a time: a change during a save is saved after it", async () => {
    const { page, autosave, edit } = fakePage({
      saveMs: AUTOSAVE_DELAY_MS * 3,
    });
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(page.calls).toBe(1);
    edit();
    // The page still shows the save that runs.
    expect(autosave.state()).toBe("saving");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(page.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 10);
    expect(page.calls).toBe(2);
    expect(page.maxInFlight).toBe(1);
    expect(page.saved).toBe(2);
  });

  it("pauses after a save that did not land: fail, change, fail - no write loop", async () => {
    let land = false;
    const { page, autosave, edit } = fakePage({ land: () => land });
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 200);
    expect(page.calls).toBe(1);
    expect(autosave.state()).toBe("paused");
    edit();
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 4);
    expect(page.calls).toBe(1);
    // An explicit Save landed: autosave goes on - and pauses again on the
    // next failure, after one attempt.
    page.saved = page.version;
    autosave.saved();
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 200);
    expect(page.calls).toBe(2);
    expect(autosave.state()).toBe("paused");
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 4);
    expect(page.calls).toBe(2);
    land = true;
    autosave.saved();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 200);
    expect(page.calls).toBe(3);
    expect(page.saved).toBe(page.version);
  });

  it("a save the page found held when it began waits for the next poke or the delay, and is not paused", async () => {
    // Why: the page checks the file before it builds, an await; a delete
    // made in that moment would be in the save's snapshot and lose its
    // undo, so the page gives the save back as "held". It is tried again
    // at the next poke, or once per delay when no poke comes (E2b-2
    // milestone review #4) - never at once, in a loop.
    let answer: AutosaveOutcome = "held";
    let calls = 0;
    let done = false;
    const autosave = createAutosave({
      save: () => {
        calls += 1;
        done = answer === "saved";
        return Promise.resolve(answer);
      },
      held: () => false,
      pending: () => !done,
    });
    autosave.enable(true);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 1);
    expect(calls).toBe(1);
    expect(autosave.state()).toBe("held");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 10);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toBe(2);
    expect(autosave.state()).toBe("held");
    answer = "saved";
    autosave.poke();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    expect(autosave.state()).toBe("idle");
  });

  it("a save still running when the tour closed does not pause the next tour's", async () => {
    let fail: (outcome: AutosaveOutcome) => void = () => undefined;
    let calls = 0;
    let done = false;
    const autosave = createAutosave({
      save: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<AutosaveOutcome>((resolve) => {
            fail = resolve;
          });
        }
        done = true;
        return Promise.resolve("saved");
      },
      held: () => false,
      pending: () => !done,
    });
    autosave.enable(true);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 1);
    expect(calls).toBe(1);
    autosave.stop();
    autosave.enable(true);
    fail("failed");
    await vi.advanceTimersByTimeAsync(1);
    expect(autosave.state()).not.toBe("paused");
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 1);
    expect(calls).toBe(2);
  });

  it("a save that says it landed but leaves the changes pending is retried once per delay, never in a loop", async () => {
    // Why (defensive): the page's count and its save could disagree; a
    // re-arm from a change long past would fire at once, again and again.
    let calls = 0;
    const autosave = createAutosave({
      save: () => {
        calls += 1;
        return Promise.resolve("saved" as const);
      },
      held: () => false,
      pending: () => true,
    });
    autosave.enable(true);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 10 + 1);
    expect(calls).toBe(10);
  });

  it("a rejected save counts as one that did not land", async () => {
    const autosave = createAutosave({
      save: () => Promise.reject(new Error("the disk is full")),
      held: () => false,
      pending: () => true,
    });
    autosave.enable(true);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 1);
    expect(autosave.state()).toBe("paused");
  });

  it("an explicit save that did not land pauses it too", async () => {
    const { page, autosave, edit } = fakePage();
    autosave.failed();
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(page.calls).toBe(0);
    expect(autosave.state()).toBe("paused");
  });

  it("an explicit save that landed leaves nothing due when it carried everything", async () => {
    const { page, autosave, edit } = fakePage();
    edit();
    page.saved = page.version;
    autosave.saved();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(page.calls).toBe(0);
    expect(autosave.state()).toBe("idle");
  });

  it("saves nothing while off, and a change made before it was on is saved once it is", async () => {
    const page = { calls: 0 };
    const autosave: Autosave = createAutosave({
      save: () => {
        page.calls += 1;
        return Promise.resolve("saved" as const);
      },
      held: () => false,
      pending: () => page.calls === 0,
    });
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(page.calls).toBe(0);
    expect(autosave.state()).toBe("off");
    autosave.enable(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 1);
    expect(page.calls).toBe(1);
    autosave.enable(false);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(page.calls).toBe(1);
  });

  it("starts no save once nothing is pending", async () => {
    const { page, autosave, edit } = fakePage();
    edit();
    page.saved = page.version;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(page.calls).toBe(0);
    expect(autosave.state()).toBe("idle");
  });

  it("says its state: waiting, saving, idle", async () => {
    const { page, edit } = fakePage();
    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 200);
    expect(page.states).toEqual(["idle", "waiting", "saving", "idle"]);
  });

  it("a save given back as held keeps the max-wait anchor: a creator who never stops is still saved within the max wait", async () => {
    // Why (PR #626 bot finding 4): `run()` dropped the anchor of the first
    // unsaved change before the page answered; a "held" answer then left
    // the next deadline anchored at the first change AFTER it, so every
    // held attempt pushed the oldest change one more max wait out. Swept
    // over 1-3 held answers in a row; the bound is the max wait plus one
    // change interval per held attempt (each retry waits for the next
    // change or look, never a loop).
    const interval = AUTOSAVE_DELAY_MS / 2;
    for (const helds of [1, 2, 3]) {
      let calls = 0;
      let savedAt: number | null = null;
      // Fake time, counted by the loop (never a clock read): the save lands
      // within the step that starts at `elapsed`.
      let elapsed = 0;
      const autosave = createAutosave({
        save: () => {
          calls += 1;
          if (calls <= helds) return Promise.resolve("held");
          savedAt ??= elapsed;
          return Promise.resolve("saved");
        },
        held: () => false,
        pending: () => savedAt === null,
      });
      autosave.enable(true);
      // A change every half delay: the quiet the delay waits for never comes.
      for (; elapsed < 3 * AUTOSAVE_MAX_WAIT_MS; elapsed += interval) {
        autosave.changed();
        await vi.advanceTimersByTimeAsync(interval);
      }
      autosave.stop();
      expect(savedAt, `${String(helds)} held`).not.toBeNull();
      expect(savedAt ?? Infinity, `${String(helds)} held`).toBeLessThanOrEqual(
        AUTOSAVE_MAX_WAIT_MS + helds * interval,
      );
    }
  });

  it("refuses delays that are not positive numbers", () => {
    const deps = {
      save: () => Promise.resolve("saved" as const),
      held: () => false,
      pending: () => false,
    };
    expect(() => createAutosave({ ...deps, delayMs: 0 })).toThrow(RangeError);
    expect(() => createAutosave({ ...deps, maxWaitMs: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      createAutosave({ ...deps, delayMs: 5_000, maxWaitMs: 1_000 }),
    ).toThrow(RangeError);
  });
});

// Why (E2b-2 milestone review #3): every save of a tour rebuilds it with
// its entries hashed and rewrites the whole file, which a sync client then
// uploads again - about 6 s and a full write per GiB, every few seconds.
// The cost grows with the file, not with the timers, so autosave is on only
// up to a size; the cap is a judgement, not a measurement.
describe("autosaveFits", () => {
  it("is on up to the cap and off above it", () => {
    expect(AUTOSAVE_MAX_BYTES).toBe(200 * 1024 * 1024);
    expect(autosaveFits(0)).toBe(true);
    expect(autosaveFits(AUTOSAVE_MAX_BYTES)).toBe(true);
    expect(autosaveFits(AUTOSAVE_MAX_BYTES + 1)).toBe(false);
    expect(autosaveFits(10, 10)).toBe(true);
    expect(autosaveFits(11, 10)).toBe(false);
  });

  it("is off for a size that is not a size", () => {
    expect(autosaveFits(Number.NaN)).toBe(false);
    expect(autosaveFits(-1)).toBe(false);
    expect(autosaveFits(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
