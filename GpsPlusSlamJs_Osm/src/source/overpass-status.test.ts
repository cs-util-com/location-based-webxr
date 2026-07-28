/**
 * `/api/status` parser tests.
 *
 * Why these tests matter:
 * This parser is the only thing standing between the client and blind
 * rate-limit roulette. Every assertion below runs against a byte-for-byte
 * capture of a real server response (see `../testdata/api-status/README.md`),
 * because the failure mode of a hand-retyped expectation is that the parser
 * passes its tests and mis-reads production.
 *
 * The two shapes that actually bite are covered deliberately:
 *   - a free-slot count and a pending-slot line COEXIST, so reading only the
 *     count silently ignores the queue;
 *   - `Rate limit: 0` means UNLIMITED, not "no slots", so a naive numeric read
 *     makes the client refuse every request against an unlimited instance.
 *
 * @see overpass-status.ts.md
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseOverpassStatus,
  msUntilNextSlot,
  OverpassStatusParseError,
} from "./overpass-status.js";

const CAPTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "testdata",
  "api-status",
);
const capture = (name: string) => readFileSync(join(CAPTURES, name), "utf8");

const AT = (iso: string) => Date.parse(iso);

describe("parsing a real idle response", () => {
  const s = parseOverpassStatus(capture("idle.txt"));

  it("reads the client id, which is how we know the pool shares one allocation", () => {
    // All three pooled hosts returned this same id, which is the evidence that
    // rotating between them buys failover and not quota.
    expect(s.clientId).toBe("1354464119");
  });

  it("reads the server clock, so recovery times can be made relative to it", () => {
    // Deliberately NOT relative to our own clock: a phone with a skewed clock
    // would otherwise compute a wrong wait from a correct server timestamp.
    expect(s.serverTimeMs).toBe(AT("2026-07-28T08:29:55Z"));
  });

  it("reads the allocation and the free count", () => {
    expect(s.rateLimit).toBe(2);
    expect(s.slotsAvailable).toBe(2);
    expect(s.unlimited).toBe(false);
  });

  it("has no pending slots and no running queries", () => {
    expect(s.slotsAvailableAtMs).toEqual([]);
    expect(s.runningQueries).toBe(0);
  });

  it("keeps the announced backend, which is not stable enough to hardcode", () => {
    expect(s.announcedEndpoint).toBe("lambert.openstreetmap.de/");
  });
});

describe("parsing a real partially-consumed response", () => {
  // THE shape that a parser written against `idle.txt` alone gets wrong.
  const s = parseOverpassStatus(capture("partially-consumed.txt"));

  it("reads BOTH the free count and the pending slot", () => {
    expect(s.slotsAvailable).toBe(1);
    expect(s.slotsAvailableAtMs).toEqual([AT("2026-07-28T08:40:34Z")]);
  });

  it("prefers the absolute timestamp over the 'in N seconds' figure", () => {
    // Both are present and they agree here (08:40:04 + 30 s = 08:40:34). The
    // absolute one is authoritative because the relative one is only accurate
    // at the instant the response was generated, and we may read it later.
    expect(s.slotsAvailableAtMs[0]! - s.serverTimeMs).toBe(30_000);
  });
});

describe("parsing an exhausted response", () => {
  // Overpass omits the "N slots available now." line entirely when nothing is
  // free, so zero has to be inferred from its ABSENCE rather than read.
  const s = parseOverpassStatus(capture("exhausted.txt"));

  it("infers zero available from the missing count line", () => {
    expect(s.slotsAvailable).toBe(0);
  });

  it("reads every pending slot, in order", () => {
    expect(s.slotsAvailableAtMs).toEqual([
      AT("2026-07-28T08:40:34Z"),
      AT("2026-07-28T08:40:41Z"),
    ]);
  });

  it("reports the earliest recovery, which is what a caller waits for", () => {
    expect(s.nextSlotAtMs).toBe(AT("2026-07-28T08:40:34Z"));
  });
});

describe("Rate limit: 0 means unlimited, not blocked", () => {
  // The bug this prevents: treating 0 as a slot count makes the client refuse
  // every single request against an instance that has no limit at all —
  // including a self-hosted one, which is the configuration most likely to
  // report it. Silent, total, and it would look like the instance being down.
  const s = parseOverpassStatus(capture("unlimited.txt"));

  it("flags the response as unlimited", () => {
    expect(s.unlimited).toBe(true);
    expect(s.rateLimit).toBe(0);
  });

  it("reports availability rather than starvation", () => {
    expect(s.slotsAvailable).toBe(Number.POSITIVE_INFINITY);
    expect(s.nextSlotAtMs).toBeUndefined();
  });
});

describe("falling back to the relative 'in N seconds' figure", () => {
  // The absolute timestamp is preferred, but if it is unparseable the slot must
  // still be counted. Dropping it would make the budget look healthier than it
  // is — the one direction of error that burns quota rather than merely
  // wasting time.
  const withBadTimestamp = [
    "Connected as: 1",
    "Current time: 2026-07-28T08:40:04Z",
    "Rate limit: 2",
    "Slot available after: not-a-timestamp, in 45 seconds.",
    "Currently running queries (pid, space limit, time limit, start time):",
  ].join("\n");

  it("still records the pending slot, timed off the server clock", () => {
    const s = parseOverpassStatus(withBadTimestamp);
    expect(s.slotsAvailableAtMs).toEqual([AT("2026-07-28T08:40:04Z") + 45_000]);
  });

  it("drops a slot only when BOTH forms are unusable", () => {
    // Nothing usable left to record, and inventing a wait would be worse than
    // admitting we do not know one.
    const s = parseOverpassStatus(
      withBadTimestamp.replace("in 45 seconds.", "in ?? seconds."),
    );
    expect(s.slotsAvailableAtMs).toEqual([]);
  });
});

describe("msUntilNextSlot", () => {
  it("is 0 while a slot is free, whatever else the snapshot says", () => {
    expect(msUntilNextSlot(parseOverpassStatus(capture("idle.txt")))).toBe(0);
    expect(
      msUntilNextSlot(parseOverpassStatus(capture("partially-consumed.txt"))),
    ).toBe(0);
  });

  it("is the wait to the earliest recovery when nothing is free", () => {
    expect(msUntilNextSlot(parseOverpassStatus(capture("exhausted.txt")))).toBe(
      AT("2026-07-28T08:40:34Z") - AT("2026-07-28T08:40:12Z"),
    );
  });

  it("is 0 on an unlimited instance", () => {
    expect(msUntilNextSlot(parseOverpassStatus(capture("unlimited.txt")))).toBe(
      0,
    );
  });

  it("never returns a negative wait for a snapshot read after its own deadline", () => {
    // A status body can sit in a cache or a slow pipe; by the time it is parsed
    // the deadline may already have passed. A negative wait would flow into a
    // setTimeout as an immediate retry, which is fine, or into arithmetic that
    // makes a penalty shorter than it should be, which is not.
    const stale = [
      "Connected as: 1",
      "Current time: 2026-07-28T08:41:00Z",
      "Rate limit: 2",
      "Slot available after: 2026-07-28T08:40:34Z, in -26 seconds.",
      "Currently running queries (pid, space limit, time limit, start time):",
    ].join("\n");
    expect(msUntilNextSlot(parseOverpassStatus(stale))).toBe(0);
  });
});

describe("running-query accounting", () => {
  it("counts the rows under the running-queries header", () => {
    const s = parseOverpassStatus(
      [
        "Connected as: 1354464119",
        "Current time: 2026-07-28T08:50:00Z",
        "Rate limit: 2",
        "1 slots available now.",
        "Currently running queries (pid, space limit, time limit, start time):",
        "12345 536870912 180 2026-07-28T08:49:58Z",
      ].join("\n"),
    );
    expect(s.runningQueries).toBe(1);
  });
});

describe("defensive parsing — malformed input is rejected, never guessed", () => {
  // This parser reads an untrusted plain-text response from a third-party
  // server with no schema and no version. A partial parse that silently
  // defaulted to "plenty of slots" would turn a server change into a
  // quota-burning loop, so the boundary rejects instead.
  it("rejects a response with no Rate limit line", () => {
    expect(() =>
      parseOverpassStatus(
        "Connected as: 1\nCurrent time: 2026-07-28T08:00:00Z",
      ),
    ).toThrow(OverpassStatusParseError);
  });

  it("rejects a response with an unparseable current time", () => {
    expect(() =>
      parseOverpassStatus(
        "Connected as: 1\nCurrent time: not-a-date\nRate limit: 2\n2 slots available now.",
      ),
    ).toThrow(OverpassStatusParseError);
  });

  it("rejects an HTML error page, which is what a proxy returns on a bad day", () => {
    expect(() => parseOverpassStatus("<html><body>502</body></html>")).toThrow(
      OverpassStatusParseError,
    );
  });

  it("rejects an empty body", () => {
    expect(() => parseOverpassStatus("")).toThrow(OverpassStatusParseError);
    expect(() => parseOverpassStatus("   \n  ")).toThrow(
      OverpassStatusParseError,
    );
  });

  it("names the offending input in the error, so a log line is actionable", () => {
    expect(() => parseOverpassStatus("<html>nope</html>")).toThrow(
      /Rate limit/,
    );
  });

  it("tolerates CRLF line endings and trailing whitespace", () => {
    // Not hypothetical: these get through proxies and text editors, and a
    // \r left on the end of a number makes parseInt succeed but a regex
    // anchored with $ fail.
    const s = parseOverpassStatus(
      capture("partially-consumed.txt").replace(/\n/g, "\r\n") + "\r\n  ",
    );
    expect(s.slotsAvailable).toBe(1);
    expect(s.slotsAvailableAtMs).toHaveLength(1);
  });

  it("tolerates an unknown extra line, because the format is not versioned", () => {
    // Forward compatibility: a new informational line must not break parsing.
    // The complement of the strictness above — reject missing REQUIRED fields,
    // ignore unrecognised optional ones.
    const s = parseOverpassStatus(
      capture("idle.txt").replace(
        "Rate limit: 2",
        "Some future field: 42\nRate limit: 2",
      ),
    );
    expect(s.slotsAvailable).toBe(2);
  });
});

describe("a non-string body does not crash the error that reports it", () => {
  it("coerces instead of calling .slice on an object", () => {
    // `parseOverpassStatus` explicitly anticipates a non-string body — a proxy
    // returning JSON, a fetch mock handing back a parsed object. The error
    // constructor then called `body.slice(0, 200)` on it, so the guard threw a
    // TypeError from inside the error that exists to explain the problem,
    // turning a diagnosable parse failure into a confusing crash.
    expect(() => parseOverpassStatus({ rate: 2 } as unknown as string)).toThrow(
      OverpassStatusParseError,
    );
    expect(() => parseOverpassStatus(42 as unknown as string)).toThrow(
      OverpassStatusParseError,
    );
    expect(() => parseOverpassStatus(undefined as unknown as string)).toThrow(
      OverpassStatusParseError,
    );
  });
});
