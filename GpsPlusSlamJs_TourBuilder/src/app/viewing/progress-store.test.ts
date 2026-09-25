import { describe, expect, it, vi } from "vitest";

import {
  clearProgress,
  persistProgress,
  readProgress,
  restoreProgress,
  type ProgressStorage,
} from "./progress-store.js";

function fakeStorage(seed: Record<string, string> = {}): ProgressStorage & {
  readonly data: Record<string, string>;
} {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const throwingStorage: ProgressStorage = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("quota", "QuotaExceededError");
  },
  removeItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
};

describe("persistProgress / readProgress", () => {
  it("round-trips visited ids for a tour", () => {
    const storage = fakeStorage();

    persistProgress("tour-a", ["wp-1", "wp-2"], storage);

    expect(readProgress("tour-a", storage)).toEqual(["wp-1", "wp-2"]);
  });

  it("keeps tours separate", () => {
    const storage = fakeStorage();

    persistProgress("tour-a", ["wp-1"], storage);
    persistProgress("tour-b", ["wp-9"], storage);

    expect(readProgress("tour-a", storage)).toEqual(["wp-1"]);
    expect(readProgress("tour-b", storage)).toEqual(["wp-9"]);
  });

  it("returns an empty list for an unknown tour", () => {
    expect(readProgress("never-seen", fakeStorage())).toEqual([]);
  });

  it("survives corrupt JSON without throwing", () => {
    const storage = fakeStorage({ "tour:tour-a": "{not json" });

    expect(readProgress("tour-a", storage)).toEqual([]);
  });

  it("survives well-formed JSON of the wrong shape", () => {
    const storage = fakeStorage({ "tour:tour-a": '{"visited":"wp-1"}' });

    expect(readProgress("tour-a", storage)).toEqual([]);
  });

  it("drops non-string entries rather than restoring garbage", () => {
    const storage = fakeStorage({
      "tour:tour-a": '{"visited":["wp-1",7,null]}',
    });

    expect(readProgress("tour-a", storage)).toEqual(["wp-1"]);
  });

  it("degrades silently when storage throws (private mode / quota)", () => {
    expect(() =>
      persistProgress("tour-a", ["wp-1"], throwingStorage),
    ).not.toThrow();
    expect(readProgress("tour-a", throwingStorage)).toEqual([]);
  });
});

describe("restoreProgress", () => {
  it("dispatches one markWaypointVisited action per stored id", () => {
    const storage = fakeStorage();
    persistProgress("tour-a", ["wp-1", "wp-3"], storage);
    const dispatched: { type: string; payload: string }[] = [];
    const dispatch = vi.fn((action: { type: string; payload: string }) => {
      dispatched.push(action);
    });

    restoreProgress(dispatch, "tour-a", storage);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatched.map((action) => action.payload)).toEqual([
      "wp-1",
      "wp-3",
    ]);
    expect(dispatched[0]!.type).toBe("tourProgress/markWaypointVisited");
  });

  it("dispatches nothing for a tour with no stored progress", () => {
    const dispatch = vi.fn();

    restoreProgress(dispatch, "tour-a", fakeStorage());

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not restore another tour's progress", () => {
    const storage = fakeStorage();
    persistProgress("tour-b", ["wp-9"], storage);
    const dispatch = vi.fn();

    restoreProgress(dispatch, "tour-a", storage);

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("clearProgress", () => {
  it("removes only that tour's key", () => {
    const storage = fakeStorage();
    persistProgress("tour-a", ["wp-1"], storage);
    persistProgress("tour-b", ["wp-9"], storage);

    clearProgress("tour-a", storage);

    expect(readProgress("tour-a", storage)).toEqual([]);
    expect(readProgress("tour-b", storage)).toEqual(["wp-9"]);
  });

  it("degrades silently when storage throws", () => {
    expect(() => clearProgress("tour-a", throwingStorage)).not.toThrow();
  });
});
