import { describe, expect, it } from "vitest";

import {
  initialLifecycleState,
  onBuild,
  onHide,
  onLoadFailed,
  onLoadResolved,
  onShow,
  onTeardown,
  type LifecycleIntent,
  type VisualLifecycleState,
} from "./visual-lifecycle.js";

const kinds = (intents: readonly LifecycleIntent[]): string[] =>
  intents.map((i) => i.kind);

/** Walk the happy path up to "loaded and attached, still invisible". */
function prefetched(): VisualLifecycleState {
  const built = onBuild(initialLifecycleState());
  return onLoadResolved(built.state, 0).state;
}

describe("the happy path", () => {
  it("starts a load tagged with the current generation on build", () => {
    const { state, intents } = onBuild(initialLifecycleState());
    expect(intents).toEqual([{ kind: "startLoad", generation: 0 }]);
    expect(state.load).toBe("loading");
  });

  it("attaches without showing when the load lands before ACTIVE", () => {
    const built = onBuild(initialLifecycleState());
    const { state, intents } = onLoadResolved(built.state, 0);
    expect(kinds(intents)).toEqual(["attach"]);
    expect(state.visible).toBe(false); // parsed, instantiated, INVISIBLE (§2.5.3)
  });

  it("shows an already-loaded visual immediately on ACTIVE", () => {
    const { intents, state } = onShow(prefetched());
    expect(kinds(intents)).toEqual(["show"]);
    expect(state.visible).toBe(true);
  });

  it("hides on the way back down but keeps the model warm", () => {
    const shown = onShow(prefetched()).state;
    const { state, intents } = onHide(shown);
    expect(kinds(intents)).toEqual(["hide"]);
    expect(state.load).toBe("loaded"); // NOT torn down — contract §2.5
  });
});

describe("re-entry while a load is in flight", () => {
  it("does not fire a second load", () => {
    const first = onBuild(initialLifecycleState());
    const second = onBuild(first.state);
    expect(second.intents).toEqual([]);
  });

  it("does not re-fetch a model that is still warm", () => {
    const again = onBuild(prefetched());
    expect(again.intents).toEqual([]);
  });
});

describe("ACTIVE arriving before the load resolves", () => {
  it("records the wish instead of dropping the knight", () => {
    const loading = onBuild(initialLifecycleState()).state;
    const wanted = onShow(loading);
    expect(wanted.intents).toEqual([]);
    expect(wanted.state.wantVisible).toBe(true);
  });

  it("attaches AND shows when the load finally lands", () => {
    const loading = onBuild(initialLifecycleState()).state;
    const wanted = onShow(loading).state;
    const { state, intents } = onLoadResolved(wanted, 0);
    // Ordering matters: nothing is ever shown before it was attached.
    expect(kinds(intents)).toEqual(["attach", "show"]);
    expect(state.visible).toBe(true);
  });
});

describe("the stale-load race", () => {
  it("discards a load that resolves after the waypoint went IDLE", () => {
    const loading = onBuild(initialLifecycleState()).state;
    const torn = onTeardown(loading);
    expect(kinds(torn.intents)).toEqual(["teardown"]);
    expect(torn.state.generation).toBe(1);

    const late = onLoadResolved(torn.state, 0); // resolved with the OLD generation
    expect(kinds(late.intents)).toEqual(["discard"]);
    expect(late.state.load).toBe("none"); // never attached
  });

  it("discards a load left over from a previous approach even after re-entry", () => {
    const loading = onBuild(initialLifecycleState()).state;
    const torn = onTeardown(loading).state; // generation 1
    const rebuilt = onBuild(torn); // fresh load, generation 1
    const late = onLoadResolved(rebuilt.state, 0); // the OLD one lands
    expect(kinds(late.intents)).toEqual(["discard"]);
    expect(late.state.load).toBe("loading"); // the new load is untouched
  });

  it("bumps the generation on every teardown", () => {
    let state = initialLifecycleState();
    for (let i = 0; i < 3; i++) {
      state = onBuild(state).state;
      state = onTeardown(state).state;
    }
    expect(state.generation).toBe(3);
  });

  it("emits no teardown when there is nothing to tear down", () => {
    expect(onTeardown(initialLifecycleState()).intents).toEqual([]);
  });
});

describe("load failure (contract D14b soft-fail)", () => {
  it("puts up a fallback and never emits discard", () => {
    // A rejected getAssetUrl never incremented the ref-count, so releasing it
    // here would be a double-release — the reason `discard` is absent.
    const loading = onBuild(initialLifecycleState()).state;
    const { state, intents } = onLoadFailed(loading, 0);
    expect(kinds(intents)).toEqual(["fallback"]);
    expect(state.load).toBe("failed");
  });

  it("shows the fallback right away when the waypoint is already ACTIVE", () => {
    const loading = onBuild(initialLifecycleState()).state;
    const wanted = onShow(loading).state;
    expect(kinds(onLoadFailed(wanted, 0).intents)).toEqual([
      "fallback",
      "show",
    ]);
  });

  it("ignores a failure from a stale generation", () => {
    const loading = onBuild(initialLifecycleState()).state;
    const torn = onTeardown(loading).state;
    expect(onLoadFailed(torn, 0).intents).toEqual([]);
  });

  it("retries on the next approach, because teardown resets the load state", () => {
    const loading = onBuild(initialLifecycleState()).state;
    const failed = onLoadFailed(loading, 0).state;
    const torn = onTeardown(failed).state;
    expect(kinds(onBuild(torn).intents)).toEqual(["startLoad"]);
  });
});

describe("idempotence", () => {
  it("does not re-show an already visible visual", () => {
    const shown = onShow(prefetched()).state;
    expect(onShow(shown).intents).toEqual([]);
  });

  it("does not re-hide an already hidden visual", () => {
    expect(onHide(prefetched()).intents).toEqual([]);
  });
});
