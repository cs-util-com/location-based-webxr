/**
 * Latest-wins coalescing.
 *
 * WHY THIS MATTERS ENOUGH TO BE ITS OWN MODULE. `main.ts` fires `refresh()` on
 * every map click and every category change, and `pipeline.update()` is a real
 * Overpass fetch — `capture-script-query.test.ts` records a res-7 tile at
 * **18.2 seconds**. Across that window the map stays clickable, so two clicks
 * produce two `pipeline.update()` calls racing into the same `AffordanceIndex`,
 * two `mapView.render()` calls, and a status line written by whichever settles
 * last — which may be the EARLIER position.
 *
 * The user-visible symptom is not "a race". It is "the map is showing the wrong
 * place", with a status line confidently describing that wrong place. Nothing
 * about it looks like a concurrency problem, which is what makes it expensive.
 *
 * Dropping clicks while busy would fix the race and break the demo's only
 * interaction, so the rule is latest-wins: the newest request always runs, and
 * superseded ones never do.
 *
 * Tested here rather than through the DOM because `main.ts` is wiring with no
 * unit tests and the e2e suite serves a canned fixture instantly — the overlap
 * window that makes this bug possible does not exist there. That is the same
 * gap the `?lat=&lng=` guard fell into on the previous PR.
 */

import { describe, expect, it, vi } from "vitest";

import { latestOnly } from "./latest-only.js";

/** A promise plus the handles to settle it, so tests control the ordering. */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("latestOnly", () => {
  it("runs the first call immediately", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = latestOnly(run);

    await refresh("a");

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("a");
  });

  it("never runs two at once", async () => {
    // The whole point: two concurrent `pipeline.update()` calls mutate one
    // `AffordanceIndex`, and its own tests only ever exercise it serially.
    const first = deferred();
    const run = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const refresh = latestOnly(run);

    const a = refresh("a");
    const b = refresh("b");
    expect(run).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.all([a, b]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs the LATEST queued input and skips the ones it superseded", async () => {
    // Clicking around the map is the demo's whole interaction, so dropping
    // clicks is not an acceptable way to prevent the overlap. What must be
    // dropped is the intermediate work, not the user's final intent.
    const first = deferred();
    const run = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const refresh = latestOnly(run);

    const a = refresh("a");
    const b = refresh("b");
    const c = refresh("c");

    first.resolve();
    await Promise.all([a, b, c]);

    const inputs = run.mock.calls.map((call) => String(call[0]));
    expect(inputs).toEqual(["a", "c"]);
  });

  it("ends on the newest input, so the view matches the last click", async () => {
    const seen: string[] = [];
    const gate = deferred();
    let first = true;
    const refresh = latestOnly(async (input: string) => {
      if (first) {
        first = false;
        await gate.promise;
      }
      seen.push(input);
    });

    const a = refresh("first");
    const b = refresh("second");
    gate.resolve();
    await Promise.all([a, b]);

    expect(seen[seen.length - 1]).toBe("second");
  });

  it("does not wedge when the runner rejects", async () => {
    // `refresh` catches its own errors today, but a wrapper that stops
    // accepting work after one failure would turn a transient Overpass 429 into
    // a permanently dead demo — a much worse failure than the one it replaced.
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("overpass 429"))
      .mockResolvedValue(undefined);
    const refresh = latestOnly(run);

    await refresh("a");
    await refresh("b");

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("reports whether work is in flight, so the UI can say so", async () => {
    const first = deferred();
    const run = vi.fn().mockReturnValue(first.promise);
    const refresh = latestOnly(run);

    expect(refresh.busy).toBe(false);
    const a = refresh("a");
    expect(refresh.busy).toBe(true);

    first.resolve();
    await a;
    expect(refresh.busy).toBe(false);
  });
});
