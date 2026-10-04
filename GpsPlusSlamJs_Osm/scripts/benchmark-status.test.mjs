import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseOverpassStatus,
  msUntilNextSlot,
} from "../src/source/overpass-status.js";
import {
  parseStatus,
  msUntilSlot,
  statusUrlFor,
  fetchStatus,
} from "./benchmark-status.mjs";
import { BENCHMARK_USER_AGENT } from "./benchmark-request.mjs";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "testdata",
  "api-status",
);
const fixtures = readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".txt"))
  .map((name) => [name, readFileSync(path.join(FIXTURES, name), "utf-8")]);

describe("benchmark status parser", () => {
  it("finds the captured fixtures it is scoped to", () => {
    // WHY: every equivalence assertion below is vacuous over an empty list, and
    // a moved testdata folder would make this whole file pass while checking
    // nothing.
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        "idle.txt",
        "exhausted.txt",
        "partially-consumed.txt",
        "unlimited.txt",
      ]),
    );
  });

  it.each(fixtures)(
    "agrees with the production TypeScript parser on %s",
    (_name, text) => {
      // WHY THIS IS THE WHOLE POINT OF THE FILE: the benchmark scripts are
      // plain .mjs run by node directly, so they cannot import the .ts parser,
      // and a hand-copied second parser is exactly the thing that drifts
      // silently. Pinning both implementations to the SAME captured responses
      // and asserting field-by-field agreement makes drift a red gate instead
      // of a wrong measurement.
      const expected = parseOverpassStatus(text);
      const actual = parseStatus(text);
      expect(actual).toEqual(expected);
      expect(msUntilSlot(actual)).toBe(msUntilNextSlot(expected));
    },
  );

  it("refuses a body it cannot parse rather than guessing", () => {
    // WHY: a partial parse defaulting to "plenty of slots" turns an upstream
    // format change into a quota-burning loop; defaulting to "none" makes the
    // benchmark look permanently blocked. Both are worse than refusing.
    const bad = ["", "   ", "<html>503</html>", "Connected as: 1"];
    for (const body of bad) {
      expect(() => parseStatus(body)).toThrow();
    }
  });

  it("derives the status URL from an interpreter URL", () => {
    // WHY: the runner holds interpreter URLs; deriving avoids a second
    // hand-maintained host list that could disagree with the first.
    expect(statusUrlFor("https://z.overpass-api.de/api/interpreter")).toBe(
      "https://z.overpass-api.de/api/status",
    );
    expect(
      statusUrlFor("https://maps.mail.ru/osm/tools/overpass/api/interpreter"),
    ).toBe("https://maps.mail.ru/osm/tools/overpass/api/status");
    expect(() => statusUrlFor("https://example.com/other")).toThrow();
  });
});

describe("benchmark status fetching", () => {
  const idle = fixtures.find(([name]) => name === "idle.txt")[1];
  const exhausted = fixtures.find(([name]) => name === "exhausted.txt")[1];

  it("reports a free slot and no wait when the server is idle", async () => {
    const snapshot = await fetchStatus({
      url: "https://z.overpass-api.de/api/interpreter",
      fetchImpl: async () => new Response(idle, { status: 200 }),
    });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.slotsAvailable).toBe(2);
    expect(snapshot.waitMs).toBe(0);
  });

  it("reports the wait until the next slot when none is free", async () => {
    // WHY: 22 seconds is the FIRST pending slot in the fixture, not the last.
    // Waiting for the last would idle the benchmark for no reason; waiting for
    // none at all is what produced this run's discarded measurements.
    const snapshot = await fetchStatus({
      url: "https://z.overpass-api.de/api/interpreter",
      fetchImpl: async () => new Response(exhausted, { status: 200 }),
    });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.slotsAvailable).toBe(0);
    expect(snapshot.waitMs).toBe(22_000);
  });

  it("treats an unreadable status as unknown, never as a free slot", async () => {
    // WHY: status reading is an OPTIMISATION, so its failure must not block the
    // run - but it must also not be reported as evidence of a free slot, or a
    // later fast 504 would be misattributed to the query rather than to load.
    for (const fetchImpl of [
      async () => new Response("busy", { status: 504 }),
      async () => new Response("nonsense", { status: 200 }),
      async () => {
        throw new Error("ENOTFOUND");
      },
    ]) {
      const snapshot = await fetchStatus({
        url: "https://z.overpass-api.de/api/interpreter",
        fetchImpl,
      });
      expect(snapshot.ok).toBe(false);
      expect(snapshot.slotsAvailable).toBeUndefined();
      expect(snapshot.waitMs).toBe(0);
      expect(typeof snapshot.error).toBe("string");
    }
  });

  it("identifies the benchmark with the same User-Agent as its queries", async () => {
    // WHY THIS IS NOT COSMETIC: overpass-api.de answers `/api/status` with
    // **HTTP 406** to a request carrying no User-Agent, which is what Node's
    // fetch sends by default. Every status read failed that way on first
    // contact, and because a failed read is (correctly) non-blocking, the gate
    // would have silently degraded to the blind cooldown it exists to replace —
    // a green suite and a useless run. The header is also the courtesy that
    // lets an operator identify this traffic, so it is shared with the query
    // transport rather than copied.
    let seen;
    await fetchStatus({
      url: "https://z.overpass-api.de/api/interpreter",
      fetchImpl: async (_url, init) => {
        seen = init.headers;
        return new Response(idle, { status: 200 });
      },
    });
    expect(seen["User-Agent"]).toBe(BENCHMARK_USER_AGENT);
    expect(BENCHMARK_USER_AGENT).toMatch(/gps-plus-slam/);
  });

  it("bounds its own request so a hung status read cannot stall the run", async () => {
    // WHY: the status endpoint is on the same struggling host as the query; a
    // status read that hangs for the full request deadline would cost more than
    // the measurement it protects.
    const snapshot = await fetchStatus({
      url: "https://z.overpass-api.de/api/interpreter",
      timeoutMs: 10,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    });
    expect(snapshot.ok).toBe(false);
    expect(snapshot.error).toMatch(/abort/i);
  });
});
