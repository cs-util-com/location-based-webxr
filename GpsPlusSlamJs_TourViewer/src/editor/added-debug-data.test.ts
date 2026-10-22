/**
 * The editor's "Add debug data…" words (M2 step 5 of the debug-captures
 * plan, Q-C): an added file is shown, never refused for being another
 * tour's, and the line under the debug layer says whose it is and that it
 * is shown in place of the tour's own walk.
 *
 * Why these tests matter: the added file is never saved, and the creator
 * cannot tell from the map whether the captures are this tour's - the line
 * is the only place that says so, and it must never call another tour's
 * walk this tour's.
 */
import { describe, expect, it } from "vitest";

import {
  ADD_DEBUG_LABELS,
  addedDebugLine,
  createAddDebugButton,
  notAddedLine,
} from "./added-debug-data.js";

describe("addedDebugLine", () => {
  it("names the added file and says it is not saved with the tour", () => {
    const line = addedDebugLine({
      fileName: "castle-debug.zip",
      match: "this-tour",
      identity: { tour: "Castle", file: "castle.zip" },
      tourCarriesWalk: false,
    });
    expect(line).toBe("Added from castle-debug.zip, not saved with the tour.");
  });

  it("says a bundle saved from another tour is another tour's, naming it", () => {
    const line = addedDebugLine({
      fileName: "x-debug.zip",
      match: "other-tour",
      identity: { tour: "Harbour", file: "harbour.zip" },
      tourCarriesWalk: false,
    });
    expect(line).toBe(
      'Added from x-debug.zip, not saved with the tour. It was saved from another tour ("Harbour", harbour.zip), not this one.',
    );
    // An identity without a title or a file name says only that.
    expect(
      addedDebugLine({
        fileName: "x-debug.zip",
        match: "other-tour",
        identity: { tour: null, file: null },
        tourCarriesWalk: false,
      }),
    ).toBe(
      "Added from x-debug.zip, not saved with the tour. It was saved from another tour, not this one.",
    );
  });

  it("says a plain recording is a recording, not saved from this tour", () => {
    expect(
      addedDebugLine({
        fileName: "walk.zip",
        match: "recording",
        identity: null,
        tourCarriesWalk: false,
      }),
    ).toBe(
      "Added from walk.zip, not saved with the tour. It is a recording, not saved from this tour.",
    );
  });

  it("says the added file is shown in place of the tour's own walk", () => {
    // Why (plan M2 step 5): the creator chose the added file, so it wins -
    // and the line must say which one the map shows.
    expect(
      addedDebugLine({
        fileName: "castle-debug.zip",
        match: "this-tour",
        identity: { tour: "Castle", file: "castle.zip" },
        tourCarriesWalk: true,
      }),
    ).toBe(
      "Added from castle-debug.zip, not saved with the tour. It is shown in place of the tour's own walk.",
    );
  });
});

describe("the add's other words", () => {
  it("says why a file was not added", () => {
    expect(notAddedLine("This file carries no recording.")).toBe(
      "Not added: This file carries no recording.",
    );
  });

  it("labels the button idle and while it reads", () => {
    expect(ADD_DEBUG_LABELS).toEqual({
      idle: "Add debug data…",
      adding: "Adding the debug data…",
    });
  });
});

describe("the button while a file is added", () => {
  // Why (r901 review #3, the async-UI rule): reading an added file can take
  // seconds, so the button says so and takes no second click meanwhile -
  // and it must come back, idle and enabled, on every path: a file shown,
  // a file refused in words, and a read that threw. A button left
  // disabled after a refusal would end the creator's way to add the right
  // file.
  function button() {
    return { disabled: false, textContent: ADD_DEBUG_LABELS.idle as string };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  for (const [end, after] of [
    ["added", "a file shown"],
    ["refused", "a file refused in words"],
    ["threw", "a read that threw"],
  ] as const) {
    it(`shows it is adding, then is idle and enabled again after ${after}`, async () => {
      const b = button();
      const add = createAddDebugButton(b);
      const work = deferred<string>();
      const run = add.run(() => work.promise);
      expect(b.disabled).toBe(true);
      expect(b.textContent).toBe(ADD_DEBUG_LABELS.adding);
      expect(add.busy()).toBe(true);
      const settled = run.then(
        (value) => ({ value }),
        (err: unknown) => ({ threw: String(err) }),
      );
      if (end === "threw") work.reject(new Error("unreadable"));
      else work.resolve(end);
      expect(await settled).toEqual(
        end === "threw" ? { threw: "Error: unreadable" } : { value: end },
      );
      expect(b.disabled).toBe(false);
      expect(b.textContent).toBe(ADD_DEBUG_LABELS.idle);
      expect(add.busy()).toBe(false);
    });
  }

  // Why: the map's panel and the 3D view's top bar each have the button;
  // an add from either holds both, so neither starts a second one.
  it("drives every button it is given", async () => {
    const panel = button();
    const bar = button();
    const add = createAddDebugButton(panel, bar);
    const work = deferred<string>();
    const run = add.run(() => work.promise);
    for (const b of [panel, bar]) {
      expect(b.disabled).toBe(true);
      expect(b.textContent).toBe(ADD_DEBUG_LABELS.adding);
    }
    work.resolve("added");
    await run;
    for (const b of [panel, bar]) {
      expect(b.disabled).toBe(false);
      expect(b.textContent).toBe(ADD_DEBUG_LABELS.idle);
    }
  });

  it("starts nothing while an add runs, and the next one once it ended", async () => {
    const b = button();
    const add = createAddDebugButton(b);
    const first = deferred<string>();
    let calls = 0;
    const running = add.run(() => {
      calls += 1;
      return first.promise;
    });
    await expect(
      add.run(() => {
        calls += 1;
        return Promise.resolve("second");
      }),
    ).resolves.toBeNull();
    expect(calls).toBe(1);
    first.resolve("first");
    await running;
    await expect(add.run(() => Promise.resolve("next"))).resolves.toBe("next");
  });
});
