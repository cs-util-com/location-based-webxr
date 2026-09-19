import { describe, expect, it } from "vitest";
import { runComparison } from "./benchmark-comparison-run.mjs";

const cell = (id, operator = "fossgis") => ({
  id,
  operator,
  url: "https://example.test/api/interpreter",
  query: "query",
  encoding: "raw",
});

function harness(outcomes, overrides = {}) {
  let time = 0;
  const calls = [];
  const snapshots = [];
  return {
    calls,
    snapshots,
    options: {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      measure: async (request) => {
        calls.push({ at: time, request });
        time += 1000;
        return outcomes.shift() ?? { ok: true, bytes: 10 };
      },
      save: (value) => snapshots.push(structuredClone(value)),
      log: () => {},
      budgetMs: 300_000,
      ...overrides,
    },
  };
}

describe("bounded comparison runner", () => {
  // Why: spacing must be measured after body completion, not request start.
  it("spaces aliases of the same operator end-to-start and checkpoints every result", async () => {
    const h = harness([]);
    const result = await runComparison([cell("a"), cell("b")], h.options);
    expect(h.calls.map((call) => call.at)).toEqual([0, 61_000]);
    expect(result.totals).toMatchObject({ sent: 2, successful: 2, skipped: 0 });
    expect(h.snapshots.at(-1)).toEqual(result);
  });

  // Why: a cooldown must not lead to a request beyond the hard run budget.
  it("records budget-skipped cases without sending them", async () => {
    const h = harness([], { budgetMs: 30_000 });
    const result = await runComparison([cell("a"), cell("b")], h.options);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].request.timeoutMs).toBe(30_000);
    expect(result.totals).toMatchObject({ sent: 1, skipped: 1 });
    expect(result.results[1].skipped).toContain("budget");
  });

  // Why: refusals belong to the operator and failed/unsent rows are distinct.
  it("stops an operator after two failures but continues another operator", async () => {
    const h = harness([
      { ok: false, httpStatus: 504, bytes: 1 },
      { ok: false, httpStatus: 429, bytes: 2 },
    ]);
    const result = await runComparison(
      [cell("a"), cell("b"), cell("c"), cell("d", "other")],
      h.options,
    );
    expect(h.calls).toHaveLength(3);
    expect(result.totals).toMatchObject({
      sent: 3,
      failed: 2,
      skipped: 1,
      successful: 1,
    });
  });

  // Why: HTTP-date Retry-After must work just like numeric seconds.
  it.each(["120", "Thu, 01 Jan 1970 00:02:01 GMT"])(
    "honors Retry-After %s",
    async (retryAfter) => {
      const h = harness([{ ok: false, httpStatus: 429, bytes: 0, retryAfter }]);
      await runComparison([cell("a"), cell("b")], h.options);
      expect(h.calls[1].at).toBe(121_000);
    },
  );

  // Why: the total byte limit must also bound an individual remaining request.
  it("passes remaining byte allowance and never sends after it is exhausted", async () => {
    const h = harness([{ ok: true, bytes: 20 }], { maxTotalBytes: 20 });
    const result = await runComparison([cell("a"), cell("b")], h.options);
    expect(h.calls[0].request.maxBytes).toBe(20);
    expect(h.calls).toHaveLength(1);
    expect(result.results[1].skipped).toContain("byte");
  });
});
