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
    });
    expect(host.style.minHeight).toBe("");
    expect(keptUsesHeight(stored.get(USES_HEIGHT_KEY) ?? null, 390)).toBe(2391);
    unwatch();
  });

  it("keeps nothing for a host with no height, and survives storage that throws", () => {
    const stored = new Map<string, string>();
    keepUsesHeight(hostOf(0), {
      storage: { setItem: (k, v) => stored.set(k, v) },
      width: () => 390,
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
      })(),
    ).not.toThrow();
    expect(() =>
      keepUsesHeight(hostOf(2000), { storage: null, width: () => 390 })(),
    ).not.toThrow();
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

  it("reserves exactly what keptUsesHeight reads, for any stored value (property)", () => {
    // Most generated values are kept at the width read back, so the
    // reserving branch is exercised as often as the refusing ones.
    const stored = fc.oneof(
      { weight: 1, arbitrary: fc.constant(null) },
      { weight: 1, arbitrary: fc.string() },
      {
        weight: 6,
        arbitrary: fc
          .record({
            width: fc.oneof(
              { weight: 3, arbitrary: fc.constant(390) },
              { weight: 1, arbitrary: fc.integer({ min: 380, max: 400 }) },
              { weight: 1, arbitrary: fc.constant("390") },
            ),
            height: fc.oneof(
              { weight: 3, arbitrary: fc.double({ min: -100, max: 30000 }) },
              { weight: 1, arbitrary: fc.constant("2000") },
              { weight: 1, arbitrary: fc.constant(null) },
            ),
          })
          .map((v) => JSON.stringify(v)),
      },
    );
    let reserved = 0;
    fc.assert(
      fc.property(stored, (s) => {
        const kept = keptUsesHeight(s, 390);
        if (kept !== null) reserved += 1;
        expect(runInline(s, 390)).toBe(
          kept === null ? "" : `${String(kept)}px`,
        );
      }),
      { numRuns: 300 },
    );
    expect(reserved).toBeGreaterThan(30);
    expect(runInline(encodeUsesHeight(390, 2391.5), 390)).toBe("2391.5px");
  });

  it("reserves nothing where storage throws", () => {
    expect(runInline(encodeUsesHeight(390, 2000), 390, true)).toBe("");
  });
});
