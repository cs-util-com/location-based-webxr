// @vitest-environment jsdom
/**
 * Why these tests matter: the wizard reloads the page mid-setup on
 * purpose, and the browser restores the scroll to the setup before the use
 * cases' chunk has arrived. The page's CSS reserves a lower bound of the
 * section's height measured in one face; in a wider face (the CI's Linux
 * one, or a phone's own) the section mounts taller and pushed the setup
 * down by the difference. The height this tab measured itself is exact in
 * any face, so it is kept and reserved on the next load. The rule exists
 * twice: here and in `index.html`'s `#landing-uses-height`, a classic
 * script that must run before the first paint; these tests hold the copy
 * to the rule. A kept height must never come from another width, and
 * storage that throws must not break the page.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  encodeUsesHeight,
  keepUsesHeight,
  keptUsesHeight,
  USES_HEIGHT_KEY,
} from "./uses-height.js";

describe("keptUsesHeight", () => {
  it("reads back a height kept at the same width", () => {
    expect(keptUsesHeight(encodeUsesHeight(390, 2380.5), 390)).toBe(2380.5);
  });

  it("ignores a height kept at another width, and nothing kept", () => {
    expect(keptUsesHeight(encodeUsesHeight(844, 1500), 390)).toBeNull();
    expect(keptUsesHeight(null, 390)).toBeNull();
  });

  it("ignores what is not a positive height below 20 000 px", () => {
    for (const stored of [
      "",
      "not json",
      "null",
      "42",
      '"390"',
      "[390, 2000]",
      '{"width":390}',
      '{"width":"390","height":2000}',
      '{"width":390,"height":"2000"}',
      '{"width":390,"height":0}',
      '{"width":390,"height":-5}',
      '{"width":390,"height":20000}',
    ]) {
      expect(keptUsesHeight(stored, 390), stored).toBeNull();
    }
  });

  it("round-trips any height in range at any width (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4000 }),
        fc.double({ min: 0.01, max: 19999, noNaN: true }),
        (width, height) => {
          expect(keptUsesHeight(encodeUsesHeight(width, height), width)).toBe(
            height,
          );
          expect(
            keptUsesHeight(encodeUsesHeight(width, height), width + 1),
          ).toBeNull();
        },
      ),
    );
  });
});

describe("keepUsesHeight", () => {
  const noWindowResize = () => () => undefined;
  const hostOf = (height: number) => {
    const host = document.createElement("div");
    host.style.minHeight = "2500px";
    host.getBoundingClientRect = () => ({ height }) as unknown as DOMRect;
    return host;
  };

  it("drops the inline reservation and keeps the measured height at the width", () => {
    const stored = new Map<string, string>();
    const host = hostOf(2391);
    const unwatch = keepUsesHeight(host, {
      storage: { setItem: (k, v) => stored.set(k, v) },
      width: () => 390,
      onWindowResize: noWindowResize,
    });
    expect(host.style.minHeight).toBe("");
    expect(keptUsesHeight(stored.get(USES_HEIGHT_KEY) ?? null, 390)).toBe(2391);
    unwatch();
  });

  // The observer reports every resize of the section, most of them (the
  // window scrolled, a sibling moved) without a change of its height:
  // session storage is written only when the kept value would change.
  it("writes storage again only when the height or width changes", () => {
    const writes: string[] = [];
    let height = 2391;
    let width = 390;
    const host = hostOf(0);
    host.getBoundingClientRect = () => ({ height }) as unknown as DOMRect;
    const observed: (() => void)[] = [];
    const Real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        observed.push(cb);
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      const unwatch = keepUsesHeight(host, {
        storage: { setItem: (_k, v) => writes.push(v) },
        width: () => width,
        onWindowResize: noWindowResize,
      });
      const report = () => {
        for (const cb of observed) cb();
      };
      report();
      report();
      expect(writes).toHaveLength(1);
      height = 2400;
      report();
      report();
      width = 391;
      report();
      expect(
        writes.map((v) => keptUsesHeight(v, width) ?? keptUsesHeight(v, 390)),
      ).toEqual([2391, 2400, 2400]);
      expect(writes).toHaveLength(3);
      unwatch();
    } finally {
      globalThis.ResizeObserver = Real;
    }
  });

  it("keeps nothing for a host with no height, and survives storage that throws", () => {
    const stored = new Map<string, string>();
    keepUsesHeight(hostOf(0), {
      storage: { setItem: (k, v) => stored.set(k, v) },
      width: () => 390,
      onWindowResize: noWindowResize,
    })();
    expect(stored.size).toBe(0);
    expect(() =>
      keepUsesHeight(hostOf(2000), {
        storage: {
          setItem: () => {
            throw new Error("quota");
          },
        },
        width: () => 390,
        onWindowResize: noWindowResize,
      })(),
    ).not.toThrow();
    expect(() =>
      keepUsesHeight(hostOf(2000), {
        storage: null,
        width: () => 390,
        onWindowResize: noWindowResize,
      })(),
    ).not.toThrow();
  });

  // On a wide window the section is capped at the column's width, so a
  // window resized only in width leaves the section's size alone and its
  // observer never reports: the kept value would still carry the old
  // width, and the next load at the new width would reserve nothing. The
  // window's own resize keeps it again.
  it("keeps the height again at the new width when only the window's width changes", () => {
    const stored = new Map<string, string>();
    let width = 1440;
    const resized: (() => void)[] = [];
    let unlistened = 0;
    const unwatch = keepUsesHeight(hostOf(2391), {
      storage: { setItem: (k, v) => stored.set(k, v) },
      width: () => width,
      onWindowResize: (listener) => {
        resized.push(listener);
        return () => {
          unlistened += 1;
        };
      },
    });
    width = 1600;
    for (const listener of resized) listener();
    expect(keptUsesHeight(stored.get(USES_HEIGHT_KEY) ?? null, 1600)).toBe(
      2391,
    );
    unwatch();
    expect(unlistened).toBe(1);
  });

  // A real browser has a ResizeObserver, and there the unwatch is a
  // different function from the bare unlisten: it must let go of both the
  // observer and the window's resize, or a destroyed page keeps writing
  // storage on every window resize.
  it("lets go of the window's resize and the observer where there is one", () => {
    let unlistened = 0;
    let disconnected = 0;
    const Real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {
        disconnected += 1;
      }
    } as unknown as typeof ResizeObserver;
    try {
      const unwatch = keepUsesHeight(hostOf(2391), {
        storage: null,
        width: () => 390,
        onWindowResize: () => () => {
          unlistened += 1;
        },
      });
      unwatch();
      expect(unlistened).toBe(1);
      expect(disconnected).toBe(1);
    } finally {
      globalThis.ResizeObserver = Real;
    }
  });
});

describe("the landing-uses-height script in index.html", () => {
  const packageRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const html = readFileSync(resolve(packageRoot, "index.html"), "utf8");
  const match = /<script id="landing-uses-height">([\s\S]*?)<\/script>/.exec(
    html,
  );

  it("runs right after the use cases' host, before the setup stage", () => {
    expect(match).not.toBeNull();
    const hostAt = html.indexOf('<div id="landing-uses"');
    const scriptAt = html.indexOf('<script id="landing-uses-height">');
    const stageAt = html.indexOf('<div id="setup-stage"');
    expect(hostAt).toBeGreaterThan(0);
    expect(scriptAt).toBeGreaterThan(hostAt);
    expect(stageAt).toBeGreaterThan(scriptAt);
    expect(match?.[1]).toContain(JSON.stringify(USES_HEIGHT_KEY));
  });

  /** Runs the inline script against a stand-in page; the host's min-height. */
  function runInline(
    stored: string | null,
    width: number,
    storageThrows = false,
  ): string {
    const host = { style: { minHeight: "" } };
    const document = {
      getElementById: (id: string) => (id === "landing-uses" ? host : null),
    };
    const sessionStorage = {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("blocked");
        return key === USES_HEIGHT_KEY ? stored : null;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(
      "document",
      "sessionStorage",
      "window",
      match?.[1] ?? "",
    ) as (...args: unknown[]) => void;
    run(document, sessionStorage, { innerWidth: width });
    return host.style.minHeight;
  }

  // The parity is proven in two halves, so neither depends on how often a
  // random draw happens to land in it: every value valid by construction
  // must be reserved, height for height, and every other value (anything
  // at all, and the near misses around each condition, the exact 0 and
  // 20 000 px edges included) must give the inline copy the same answer as
  // keptUsesHeight. A single mixed property that counted its reserving
  // draws was flaky: that count is a random variable, not a proof.
  it("reserves every height keptUsesHeight keeps, height for height (property)", () => {
    const height = fc.oneof(
      fc.integer({ min: 1, max: 19999 }),
      fc.double({
        min: 0,
        max: 20000,
        minExcluded: true,
        maxExcluded: true,
        noNaN: true,
      }),
    );
    fc.assert(
      fc.property(height, (h) => {
        const s = encodeUsesHeight(390, h);
        expect(keptUsesHeight(s, 390)).toBe(h);
        expect(runInline(s, 390)).toBe(`${String(h)}px`);
      }),
      { numRuns: 300 },
    );
    expect(runInline(encodeUsesHeight(390, 2391.5), 390)).toBe("2391.5px");
  });

  it("answers as keptUsesHeight for any other stored value (property)", () => {
    const stored = fc.oneof(
      fc.constant(null),
      fc.string(),
      fc.json(),
      fc
        .record({
          width: fc.oneof(
            fc.constant(390),
            fc.integer({ min: 380, max: 400 }),
            fc.constant("390"),
          ),
          height: fc.oneof(
            fc.double({ min: -100, max: 30000 }),
            fc.constantFrom(0, -0, -1, 19999.999, 20000, 20000.001),
            fc.constant("2000"),
            fc.constant(null),
          ),
        })
        .map((v) => JSON.stringify(v)),
    );
    fc.assert(
      fc.property(stored, (s) => {
        const kept = keptUsesHeight(s, 390);
        expect(runInline(s, 390)).toBe(
          kept === null ? "" : `${String(kept)}px`,
        );
      }),
      { numRuns: 300 },
    );
    for (const edge of [0, 20000]) {
      expect(runInline(encodeUsesHeight(390, edge), 390)).toBe("");
    }
  });

  it("reserves nothing where storage throws", () => {
    expect(runInline(encodeUsesHeight(390, 2000), 390, true)).toBe("");
  });
});
