/**
 * Why these tests matter: the framework's OPFS store stopped importing the
 * logger so it can load in the design system's no-build labs (round-5 plan
 * 2026-10-01-0945 §3.6), and now warns through whatever its constructor is
 * given, `console.warn` by default. OsmDemo's worker must keep its store
 * failures on the framework logger (log buffer and Sentry Issue), and
 * nothing else would notice if it stopped: a failed cache write is silent
 * by design. So both halves are pinned here:
 * - `osmStoreWarn` reaches the logger (its buffer, under the store's tag);
 * - `demo-worker.ts` hands it to the store it opens. That half is a
 *   SOURCE-TEXT check, the same trade `plate-clip-call-site.test.ts` makes:
 *   the worker cannot be instantiated in a unit test, and the failure mode
 *   to catch is the option going missing.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LogLevel,
  clearLogBuffer,
  getLogBuffer,
} from "gps-plus-slam-app-framework/utils/logger";

import { osmStoreWarn } from "./osm-store-warn.js";

afterEach(() => {
  vi.restoreAllMocks();
  clearLogBuffer();
});

describe("osmStoreWarn", () => {
  it("logs through the framework logger under the store's tag", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    clearLogBuffer();
    osmStoreWarn("Could not persist OSM blob", { key: "osm/v2/a" });
    const entry = getLogBuffer().at(-1);
    expect(entry?.level).toBe(LogLevel.WARN);
    expect(entry?.tag).toBe("OsmBlobStore");
    expect(entry?.message).toContain("Could not persist OSM blob");
  });
});

describe("the worker's store wiring", () => {
  it("opens the tile store with osmStoreWarn", () => {
    const source = readFileSync(
      new URL("./demo-worker.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /openOsmStore\(\s*\{[^}]*\bwarn:\s*osmStoreWarn\b[^}]*\}\s*\)/,
    );
    expect(source).toMatch(
      /import\s*\{\s*osmStoreWarn\s*\}\s*from\s*"\.\/osm-store-warn\.js"/,
    );
  });
});
