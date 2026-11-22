import { describe, expect, it } from "vitest";

import { guardRun, HIDDEN_DURING_RUNS, type RunGuardEnv } from "./run-guard";

/** A page whose visibility the test flips, and a wake lock that records. */
function env(opts: { refuse?: boolean; noApi?: boolean; slow?: boolean } = {}) {
  let state: DocumentVisibilityState = "visible";
  const listeners = new Set<() => void>();
  const lines: string[] = [];
  let requests = 0;
  let held = 0;
  const pending: (() => void)[] = [];
  const lock = () => {
    const onRelease: (() => void)[] = [];
    let live = true;
    const drop = () => {
      if (live) {
        live = false;
        held--;
        onRelease.forEach((f) => f());
      }
    };
    held++;
    return {
      release: () => {
        drop();
        // A real sentinel may reject a second release; the guard must not care.
        return Promise.reject(new Error("already released"));
      },
      addEventListener: (_t: "release", f: () => void) => {
        onRelease.push(f);
      },
      /** The browser drops the lock itself when the page is hidden. */
      drop,
    };
  };
  const locks: ReturnType<typeof lock>[] = [];
  const grantOne = () => {
    const l = lock();
    locks.push(l);
    return l;
  };
  const e: RunGuardEnv = {
    doc: {
      get visibilityState() {
        return state;
      },
      addEventListener: (_t, f) => {
        listeners.add(f);
      },
      removeEventListener: (_t, f) => {
        listeners.delete(f);
      },
    },
    wakeLock: opts.noApi
      ? undefined
      : {
          request: () => {
            requests++;
            if (opts.refuse) {
              return Promise.reject(new Error("NotAllowedError"));
            }
            if (opts.slow) {
              return new Promise((r) => pending.push(() => r(grantOne())));
            }
            return Promise.resolve(grantOne());
          },
        },
    log: (l) => lines.push(l),
  };
  const flip = (s: DocumentVisibilityState) => {
    state = s;
    if (s === "hidden") {
      locks.splice(0).forEach((l) => l.drop());
    }
    [...listeners].forEach((f) => f());
  };
  return {
    e,
    flip,
    lines,
    listeners,
    grant: () => pending.splice(0).forEach((f) => f()),
    requests: () => requests,
    held: () => held,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

// Why these tests matter: a timing run on a phone whose screen turns off,
// or whose page goes to the background, measures a throttled page; the
// report must say so instead of passing those numbers as real ones.
describe("guardRun", () => {
  it("holds the screen wake lock for the run and releases it at the end", async () => {
    const t = env();
    const g = guardRun(t.e);
    await settle();
    expect(t.held()).toBe(1);
    g.end();
    await settle();
    expect(t.held()).toBe(0);
    expect(t.listeners.size).toBe(0);
    expect(g.wasHidden()).toBe(false);
  });

  it("records a hidden page and takes the lock again when it is visible", async () => {
    const t = env();
    const g = guardRun(t.e);
    await settle();
    t.flip("hidden");
    expect(g.wasHidden()).toBe(true);
    expect(t.held()).toBe(0);
    t.flip("visible");
    await settle();
    expect(t.requests()).toBe(2);
    expect(t.held()).toBe(1);
    g.end();
    expect(g.wasHidden()).toBe(true);
    expect(HIDDEN_DURING_RUNS).toBe("page was hidden during runs");
  });

  it("counts a page that is hidden already when the run starts", () => {
    const t = env();
    t.flip("hidden");
    const g = guardRun(t.e);
    expect(g.wasHidden()).toBe(true);
    expect(t.requests()).toBe(0);
    g.end();
  });

  it("logs a refused lock and lets the run go on", async () => {
    const t = env({ refuse: true });
    const g = guardRun(t.e);
    await settle();
    expect(t.lines).toEqual(["screen wake lock refused: NotAllowedError"]);
    g.end();
  });

  it("releases a lock granted only after the run ended", async () => {
    const t = env({ slow: true });
    const g = guardRun(t.e);
    g.end();
    t.grant();
    await settle();
    expect(t.held()).toBe(0);
  });

  it("works without the wake lock API", () => {
    const t = env({ noApi: true });
    const g = guardRun(t.e);
    t.flip("hidden");
    expect(g.wasHidden()).toBe(true);
    g.end();
    expect(t.lines).toEqual([]);
  });
});
