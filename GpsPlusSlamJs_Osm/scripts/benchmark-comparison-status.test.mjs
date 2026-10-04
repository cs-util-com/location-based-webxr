import { describe, expect, it } from "vitest";
import { runComparison } from "./benchmark-comparison-run.mjs";

/**
 * Status gating in the bounded runner.
 *
 * WHY THIS FILE EXISTS. The 2026-09-19 comparison run fired blind into
 * `overpass-api.de`'s dispatcher on a fixed 60-second cooldown. Of 37 planned
 * cases it sent 13, and the two-failure guard discarded 24 — failures the
 * server had never queued in the first place. Worse, three ~10 s 504s could not
 * be attributed, because nothing recorded whether a slot was free when they
 * arrived; the run therefore reported "the server was busy" while its own
 * recovery artifact showed the same host serving a 19.7 s query between two of
 * them.
 *
 * Both problems are the same missing reading, so both are covered here.
 */

const cell = (id, operator = "fossgis") => ({
  id,
  operator,
  url: "https://example.test/api/interpreter",
  query: "query",
  encoding: "raw",
});

function harness({ outcomes = [], statuses = [], overrides = {} } = {}) {
  let time = 0;
  const statusCalls = [];
  const measureCalls = [];
  return {
    statusCalls,
    measureCalls,
    get time() {
      return time;
    },
    options: {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      measure: async (request) => {
        measureCalls.push({ at: time, request });
        time += 1000;
        return outcomes.shift() ?? { ok: true, bytes: 10 };
      },
      readStatus: async ({ url }) => {
        statusCalls.push({ at: time, url });
        return statuses.shift() ?? { ok: true, waitMs: 0, slotsAvailable: 2 };
      },
      save: () => {},
      log: () => {},
      budgetMs: 600_000,
      ...overrides,
    },
  };
}

describe("status-gated comparison runner", () => {
  it("waits the reported slot time instead of firing into a full dispatcher", async () => {
    // WHY: the blind cooldown assumes a slot frees on a fixed schedule. When
    // the server says a slot is 22 s away, issuing at 0 s buys a refusal and,
    // after two of them, the operator is dropped for the rest of the run.
    const h = harness({
      statuses: [
        { ok: true, waitMs: 22_000, slotsAvailable: 0 },
        { ok: true, waitMs: 0, slotsAvailable: 1 },
      ],
    });
    const result = await runComparison([cell("a")], h.options);

    expect(h.statusCalls[0].at).toBe(0);
    // Waited, then re-read rather than trusting the first snapshot's estimate.
    expect(h.statusCalls[1].at).toBe(22_000);
    expect(h.measureCalls).toHaveLength(1);
    expect(h.measureCalls[0].at).toBe(22_000);
    expect(result.results[0].statusBefore).toEqual({
      ok: true,
      waitMs: 0,
      slotsAvailable: 1,
    });
  });

  it("records the free-slot count beside every failure, so a fast 504 is attributable", async () => {
    // WHY THIS IS THE POINT OF THE WHOLE CHANGE: a 504 arriving in ~10 s with
    // slots still free is a query killed on arrival, not queueing (2026-07-28
    // §2). Without a reading at refusal time the two are indistinguishable, and
    // the wrong one gets written into the report.
    const h = harness({
      outcomes: [{ ok: false, status: "504 Gateway Timeout", bytes: 695 }],
      statuses: [
        { ok: true, waitMs: 0, slotsAvailable: 2 },
        { ok: true, waitMs: 0, slotsAvailable: 2, runningQueries: 0 },
      ],
    });
    const result = await runComparison([cell("a")], h.options);

    const row = result.results[0];
    expect(row.ok).toBe(false);
    expect(row.statusBefore.slotsAvailable).toBe(2);
    // Read AGAIN after the refusal: "slots were free before" is weaker evidence
    // than "slots were free before and after".
    expect(row.statusAfter.slotsAvailable).toBe(2);
    expect(h.statusCalls).toHaveLength(2);
  });

  it("does not spend a status read after a successful request", async () => {
    // WHY: the reading exists to attribute failures. Reading after every
    // success would double the request count against the same operator for no
    // diagnostic gain.
    const h = harness({ outcomes: [{ ok: true, bytes: 10 }] });
    const result = await runComparison([cell("a")], h.options);
    expect(h.statusCalls).toHaveLength(1);
    expect(result.results[0].statusAfter).toBeUndefined();
  });

  it("proceeds on the blind cooldown when the status endpoint cannot be read", async () => {
    // WHY: status reading is an optimisation. A host that refuses /api/status
    // must still be measurable, or adding this gate would narrow the benchmark
    // rather than widen it.
    const h = harness({
      statuses: [{ ok: false, waitMs: 0, error: "HTTP 504" }],
    });
    const result = await runComparison([cell("a")], h.options);
    expect(h.measureCalls).toHaveLength(1);
    expect(result.results[0].statusBefore.ok).toBe(false);
    expect(result.results[0].ok).toBe(true);
  });

  it("skips rather than waiting past the budget for a slot", async () => {
    // WHY: a 10-minute slot wait inside a 15-minute budget would consume the
    // run for one measurement. Skipping keeps the remaining arms reachable and
    // leaves an explicit disposition in the artifact.
    const h = harness({
      statuses: [{ ok: true, waitMs: 400_000, slotsAvailable: 0 }],
      overrides: { budgetMs: 60_000 },
    });
    const result = await runComparison([cell("a")], h.options);
    expect(h.measureCalls).toHaveLength(0);
    expect(result.results[0].skipped).toMatch(/slot/i);
  });

  it("runs unchanged when no status reader is supplied", async () => {
    // WHY: every existing caller and every historical artifact predates this
    // gate. Status reading must be opt-in so old invocations stay reproducible.
    const h = harness();
    const result = await runComparison([cell("a")], {
      ...h.options,
      readStatus: undefined,
    });
    expect(h.statusCalls).toHaveLength(0);
    expect(result.results[0].ok).toBe(true);
    expect(result.results[0].statusBefore).toBeUndefined();
  });
});
