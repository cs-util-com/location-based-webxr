/**
 * The decision logic of the Overpass matrix sweep (W1, DEC-R5-1/DEC-R5-10).
 *
 * WHY THESE TESTS MATTER, and they are not the usual reason. Everything here
 * governs how hard this project hits **donated public infrastructure**. The
 * sweep the owner authorised moves ~1.2–3.4 GB across six URLs, and the whole
 * justification for running it at all is that it is spaced politely. A
 * politeness rule that exists only as a comment is not a rule — it is an
 * intention that the next refactor silently deletes.
 *
 * The specific bug these exist to make impossible: **the six URLs are three
 * operators, and the evidence is in this repo.** In `docs/overpass-endpoint-
 * benchmark.json`, `lz4.overpass-api.de` and `z.overpass-api.de` returned
 * byte-identical 67 973 393-byte bodies, and `overpass.private.coffee` and
 * `overpass.kumi.systems` returned byte-identical 66 348 574-byte bodies. A
 * cooldown keyed on the HOSTNAME therefore puts three times the intended rate on
 * FOSSGIS while reporting itself as polite — which is exactly the behaviour the
 * usage policies ask callers not to have, dressed as compliance.
 *
 * @see 2026-08-01-1140-osm-demo-feedback-round-5-plan.md §3
 */

import { describe, expect, it } from "vitest";

import {
  BACKOFF_BASE_MS,
  GIVE_UP_AFTER_REFUSALS,
  FORM_RUN_ORDER,
  OPERATOR_COOLDOWN_MS,
  QUERY_FORMS,
  REFUSAL_DECAY_MS,
  activeRefusals,
  backoffDelayMs,
  buildMatrixDocument,
  buildMatrixQuery,
  operatorForUrl,
  planCells,
  waitMsBeforeRequest,
} from "./benchmark-matrix.mjs";

const BBOX = { south: 50.93, west: 6.94, north: 50.95, east: 6.98 };
const KEYS = ["highway", "building"];

describe("buildMatrixQuery", () => {
  it("offers exactly the three forms the sweep is a matrix over", () => {
    // WHY: the matrix's whole point is that the RESOLUTION axis is already known
    // not to matter — res 9 returned 38.7 MB against res 7's ~68 MB for 49x less
    // ground, both figures from the previous `nwr` form, which is exactly the
    // axis the FORM dimension went on to move.
    // If the form axis silently collapsed to one entry the run would be
    // 24 expensive cells re-measuring the axis that has no answer in it.
    // FOUR SINCE F31. The combined form was added because §2.1 of the results
    // doc reasons the two levers attack different things and should compose —
    // clipping still prints a fragment of every giant relation touching the box,
    // while areal-only removes those relations from the result set entirely.
    expect([...QUERY_FORMS]).toEqual([
      "plain",
      "clipped",
      "areal-only",
      "clipped-areal",
    ]);
  });

  it("builds the plain form as today's production query", () => {
    // WHY: this form is the CONTROL. If it drifts from what production sends,
    // the other two forms are being compared against a straw man and the whole
    // sweep answers a question nobody asked.
    const query = buildMatrixQuery({ bbox: BBOX, keys: KEYS, form: "plain" });
    expect(query).toContain(
      `[bbox:${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}]`,
    );
    expect(query).toContain('nwr["highway"];');
    expect(query).toContain('nwr["building"];');
    expect(query).toMatch(/out geom;$/m);
  });

  it("clips the printed geometry to the tile's own bbox", () => {
    // WHY: this is the lever the 2026-07-28 results doc names as highest-value —
    // `out geom(south,west,north,east)` emits only coordinates inside the box,
    // which is what would remove the giant-relation tail. Getting the argument
    // ORDER wrong would silently clip to somewhere else on earth and return an
    // empty body, which reads as "the lever works spectacularly".
    const query = buildMatrixQuery({ bbox: BBOX, keys: KEYS, form: "clipped" });
    expect(query).toMatch(
      new RegExp(
        `out geom\\(${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}\\);`,
      ),
    );
    // The selection is unchanged — only the printing differs, so a size
    // difference between this and `plain` is attributable to clipping alone.
    expect(query).toContain('nwr["highway"];');
  });

  it("selects only areal relations in the areal-only form", () => {
    // WHY: "exclude relations" taken literally would drop multipolygon buildings
    // and boundaries — the ones this package DOES render — so the honest
    // server-side analogue of `capture-fixtures.mjs` is areal-only, matching
    // `AREAL_RELATION_TYPES` = {multipolygon, boundary}.
    const query = buildMatrixQuery({
      bbox: BBOX,
      keys: KEYS,
      form: "areal-only",
    });
    expect(query).toContain('nw["highway"];');
    expect(query).toContain('relation["highway"]["type"="multipolygon"];');
    expect(query).toContain('relation["highway"]["type"="boundary"];');
    // No bare `nwr`, or the relation restriction does nothing.
    expect(query).not.toContain('nwr["highway"];');
  });

  it("never builds the key-regex form that 504s", () => {
    // WHY: measured 2026-07-28 — the union form returns 200 in 18.2 s where the
    // key-regex form 504s in 8 s on the same tile. `capture-script-query.test.ts`
    // pins the capture script against exactly this regression; the sweep is the
    // third place that could reintroduce it.
    for (const form of QUERY_FORMS) {
      const query = buildMatrixQuery({ bbox: BBOX, keys: KEYS, form });
      expect(query).not.toMatch(/\[~/);
    }
  });

  it("rejects an unknown form rather than silently sending the plain one", () => {
    // WHY: a typo'd form that quietly measures `plain` three times would produce
    // three identical rows and the conclusion "the form makes no difference".
    expect(() =>
      buildMatrixQuery({ bbox: BBOX, keys: KEYS, form: "bounded" }),
    ).toThrow(/bounded/);
  });
});

describe("operatorForUrl", () => {
  it("collapses the three FOSSGIS names onto one operator", () => {
    // WHY: this is the assertion the politeness claim rests on. See the file
    // header for the byte-identical responses that prove the shared backend.
    const fossgis = [
      "https://overpass-api.de/api/interpreter",
      "https://lz4.overpass-api.de/api/interpreter",
      "https://z.overpass-api.de/api/interpreter",
    ].map(operatorForUrl);
    expect(new Set(fossgis).size).toBe(1);
  });

  it("collapses private.coffee and its kumi.systems alias", () => {
    // WHY: the wiki records kumi.systems as having become private.coffee, and
    // the benchmark shows both returning byte-identical bodies.
    expect(
      operatorForUrl("https://overpass.private.coffee/api/interpreter"),
    ).toBe(operatorForUrl("https://overpass.kumi.systems/api/interpreter"));
  });

  it("keeps genuinely separate operators separate", () => {
    // WHY: over-collapsing is the opposite failure — it would serialise
    // independent servers behind one cooldown and turn a 3-hour run into a
    // 9-hour one for no politeness gain.
    const operators = new Set(
      [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      ].map(operatorForUrl),
    );
    expect(operators.size).toBe(3);
  });

  it("gives an unknown host its own operator rather than lumping it in", () => {
    // WHY: a new endpoint added to ENDPOINTS without touching the mapping must
    // default to "assume independent", not to "share whatever bucket sorts
    // first" — the latter would throttle it against an unrelated server.
    expect(operatorForUrl("https://overpass.example.org/api/interpreter")).toBe(
      "overpass.example.org",
    );
  });
});

describe("backoffDelayMs", () => {
  it("grows strictly with each attempt", () => {
    // WHY: a flat retry is not a backoff. A server that says 429 and is asked
    // again at the same rate is being ignored.
    const delays = [0, 1, 2, 3].map((attempt) => backoffDelayMs(attempt));
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it("never returns less than the base cooldown", () => {
    // WHY: the backoff exists on top of the cooldown, not instead of it. A first
    // retry shorter than the ordinary spacing would make a refusal the FASTEST
    // path back to the same server.
    expect(backoffDelayMs(0)).toBeGreaterThanOrEqual(BACKOFF_BASE_MS);
  });

  it("honours a Retry-After header over its own schedule when that is longer", () => {
    // WHY: `Retry-After` is the server stating its own terms. Computing a
    // shorter delay and using it is a refusal to listen.
    expect(backoffDelayMs(0, { retryAfterSeconds: 600 })).toBe(600_000);
    // ...and a SHORTER Retry-After does not shorten our own spacing.
    expect(backoffDelayMs(2, { retryAfterSeconds: 1 })).toBe(backoffDelayMs(2));
  });

  it("gives up after two refusals", () => {
    // WHY: DEC-R5-1's rule. "A host that says no twice is dropped and recorded
    // as such" — a 429 is data, and continuing past it is not persistence, it is
    // ignoring a documented usage policy.
    expect(GIVE_UP_AFTER_REFUSALS).toBe(2);
  });

  it("documents a schedule that only matters if the give-up is raised", () => {
    // HONESTY ABOUT REACH, because the tests above look like they describe live
    // behaviour and do not. With the give-up at 2, `backoffDelayMs` is only ever
    // called with attempt 0 — the second refusal drops the host instead of
    // waiting — so the exponential and BACKOFF_MAX_MS are unreachable today.
    // They are kept and tested because they are what has to be correct the
    // moment the constant changes, and a reader deserves to know which of these
    // assertions is load-bearing right now.
    expect(backoffDelayMs(0)).toBe(BACKOFF_BASE_MS);
  });
});

describe("planCells", () => {
  const HOSTS = [
    { url: "https://overpass-api.de/api/interpreter" },
    { url: "https://lz4.overpass-api.de/api/interpreter" },
    { url: "https://overpass.private.coffee/api/interpreter" },
  ];

  it("produces one cell per host x resolution x form", () => {
    const cells = planCells({
      hosts: HOSTS,
      resolutions: [7, 8],
      forms: ["plain", "clipped"],
    });
    expect(cells).toHaveLength(3 * 2 * 2);
  });

  it("orders the form axis outermost, cheapest-hypothesis first", () => {
    // WHY: DEC-R5-10 accepted ~1.2-3.4 GB, and which end of that range the run
    // actually lands on depends on this order. If `clipped` collapses the
    // payload, running it FIRST means the answer is known before the expensive
    // plain-form leg is half done and the run can be stopped early. Ordering by
    // host would interleave the expensive form throughout.
    const cells = planCells({
      hosts: HOSTS,
      resolutions: [7],
      forms: ["plain", "clipped", "areal-only"],
    });
    expect(cells.slice(0, 3).map((c) => c.form)).toEqual([
      "clipped",
      "clipped",
      "clipped",
    ]);
  });

  it("never schedules two cells of one OPERATOR back to back while another is free", () => {
    // WHY: this is the whole politeness mechanism, and asserting it per hostname
    // would pass while the run was three times over the rate on FOSSGIS. The two
    // FOSSGIS URLs must be separated by the private.coffee one.
    const cells = planCells({
      hosts: HOSTS,
      resolutions: [7],
      forms: ["plain"],
    });
    const operators = cells.map((cell) => operatorForUrl(cell.url));
    for (let i = 1; i < operators.length; i += 1) {
      expect(operators[i]).not.toBe(operators[i - 1]);
    }
  });

  it("gives every cell a stable id so a resumed run can skip what is done", () => {
    // WHY: three hours unattended means a kill, a sleep or a crash is likely,
    // and "which cells do I still owe" must be answerable from the partial
    // document rather than by re-running everything.
    const cells = planCells({
      hosts: HOSTS,
      resolutions: [7, 8],
      forms: ["plain"],
    });
    const ids = cells.map((cell) => cell.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
  });
});

describe("waitMsBeforeRequest", () => {
  // A synthetic clock rather than real sleeping: a test that waits a minute to
  // prove a minute-long cooldown is a test nobody runs, and this rule is the one
  // that must never be quietly disabled.
  const T0 = 1_000_000;

  it("does not delay the first request to an operator", () => {
    expect(
      waitMsBeforeRequest({ operator: "fossgis", now: T0, lastRequestAt: {} }),
    ).toBe(0);
  });

  it("holds a second request to the same operator for the full cooldown", () => {
    // WHY: the entire politeness claim. Without this the run is 72 back-to-back
    // large queries against volunteer servers.
    expect(
      waitMsBeforeRequest({
        operator: "fossgis",
        now: T0 + 1000,
        lastRequestAt: { fossgis: T0 },
        cooldownMs: OPERATOR_COOLDOWN_MS,
      }),
    ).toBe(OPERATOR_COOLDOWN_MS - 1000);
  });

  it("counts a DIFFERENT hostname of the same operator against that cooldown", () => {
    // WHY: this is the bug the whole file exists to make impossible. `lz4` and
    // `z.overpass-api.de` are one FOSSGIS deployment, so a request to one must
    // delay a request to the other. Keyed per hostname this returns 0 and the
    // run goes 3x over the intended rate while reporting itself as polite.
    const operator = operatorForUrl(
      "https://z.overpass-api.de/api/interpreter",
    );
    expect(
      waitMsBeforeRequest({
        operator,
        now: T0,
        lastRequestAt: {
          [operatorForUrl("https://lz4.overpass-api.de/api/interpreter")]: T0,
        },
      }),
    ).toBe(OPERATOR_COOLDOWN_MS);
  });

  it("lets an unrelated operator go immediately", () => {
    // WHY: over-collapsing is the opposite failure — it would serialise
    // independent servers and turn a 3-hour run into a 9-hour one for nothing.
    expect(
      waitMsBeforeRequest({
        operator: "vk-maps",
        now: T0,
        lastRequestAt: { fossgis: T0 },
      }),
    ).toBe(0);
  });

  it("never returns a negative wait once the cooldown has elapsed", () => {
    expect(
      waitMsBeforeRequest({
        operator: "fossgis",
        now: T0 + OPERATOR_COOLDOWN_MS * 3,
        lastRequestAt: { fossgis: T0 },
      }),
    ).toBe(0);
  });
});

describe("buildMatrixDocument", () => {
  const CELLS = [
    { id: "a", url: "https://x/api", res: 7, form: "plain" },
    { id: "b", url: "https://y/api", res: 7, form: "plain" },
  ];

  it("describes a run interrupted after one cell as one cell, not as truncated", () => {
    // WHY: the existing script writes once at the end, so a killed run loses
    // everything. Over three hours that is not a tail risk. A partial document
    // must be VALID and must say how far it got.
    const doc = buildMatrixDocument({
      centre: { lat: 50.9413, lng: 6.9583 },
      keyCount: 32,
      cells: CELLS,
      results: [{ id: "a", ok: true, bytes: 100, totalMs: 10 }],
      measuredAt: "2026-08-01T12:00:00.000Z",
    });
    expect(doc.results).toHaveLength(1);
    expect(doc.complete).toBe(false);
    expect(doc.plannedCells).toBe(2);
  });

  it("marks a finished run complete", () => {
    const doc = buildMatrixDocument({
      centre: { lat: 50.9413, lng: 6.9583 },
      keyCount: 32,
      cells: CELLS,
      results: [
        { id: "a", ok: true, bytes: 100, totalMs: 10 },
        { id: "b", ok: false, bytes: 0, totalMs: 5 },
      ],
      measuredAt: "2026-08-01T12:00:00.000Z",
    });
    expect(doc.complete).toBe(true);
  });

  it("totals the bytes actually moved, so the cost claim is measured not estimated", () => {
    // WHY: DEC-R5-10 accepted an ESTIMATE of 1.2-3.4 GB. The run should report
    // what it really cost, because that number is what a later reader will use
    // to decide whether to do this again.
    const doc = buildMatrixDocument({
      centre: { lat: 50.9413, lng: 6.9583 },
      keyCount: 32,
      cells: CELLS,
      results: [
        { id: "a", ok: true, bytes: 1_000_000, totalMs: 10 },
        { id: "b", ok: true, bytes: 2_500_000, totalMs: 20 },
      ],
      measuredAt: "2026-08-01T12:00:00.000Z",
    });
    expect(doc.totals.bytes).toBe(3_500_000);
    expect(doc.totals.byOperator).toBeDefined();
  });
});

/**
 * The fourth query form, and a refusal budget that decays — F31 and F29.
 *
 * BOTH COME FROM THE 2026-08-01 SWEEP'S OWN RESULTS rather than from taste.
 *
 * F31: `clipped` and `areal-only` each cut the res-7 payload substantially
 * (the previous `plain` form's 67.9 MB -> 30.3 and 21.1), and §2.1 of the
 * results doc reasons that they
 * attack different things — clipping still PRINTS a fragment of every giant
 * relation that touches the box, while areal-only removes those relations from
 * the result set. If that reasoning holds, the combination should beat both, and
 * it is one more form in the same runner.
 *
 * F29: two refusals dropped a hostname for the remainder, and over a 34-minute
 * run that cost 46 of 84 cells — including the entire second-city leg. **The
 * rate is not the problem; the permanence is.** A budget that decays with time
 * keeps the same politeness per minute while letting a long sweep recover from a
 * transient 504.
 */
describe("the combined query form (F31)", () => {
  it("is offered as a fourth form", () => {
    expect(QUERY_FORMS).toContain("clipped-areal");
  });

  it("selects like areal-only AND prints like clipped", () => {
    // The whole point of the form: the two levers are independent, so the
    // combination must show both. A form that only did one would produce a row
    // indistinguishable from an existing one and the sweep would report a
    // confident non-result.
    const query = buildMatrixQuery({
      bbox: { south: 1, west: 2, north: 3, east: 4 },
      keys: ["amenity"],
      form: "clipped-areal",
    });
    // areal-only selection: `nw[...]` plus typed relations, never bare `nwr`.
    expect(query).toContain('nw["amenity"];');
    expect(query).not.toContain('nwr["amenity"];');
    // clipped printing.
    expect(query).toContain("out geom(1,2,3,4);");
  });

  it("runs LAST of the cheap forms but before the control", () => {
    // The run order exists so that if the budget runs out, the cheap forms have
    // already answered and only the control is missing — and the control is the
    // one with independent measurements to fall back on.
    const order = [...FORM_RUN_ORDER];
    expect(order).toContain("clipped-areal");
    expect(order.indexOf("clipped-areal")).toBeLessThan(order.indexOf("plain"));
  });

  it("keeps every form in the run order, so none is silently unrunnable", () => {
    // A form present in QUERY_FORMS but absent from FORM_RUN_ORDER would never
    // be scheduled, and the sweep would report "no data" for it rather than
    // "never asked".
    expect([...FORM_RUN_ORDER].sort()).toEqual([...QUERY_FORMS].sort());
  });
});

describe("the refusal budget decays (F29)", () => {
  it("forgets a refusal after the decay window", () => {
    // The fix for the permanence. A host that said no once an hour ago is not
    // the same evidence as a host that said no twice in a minute.
    expect(activeRefusals([{ at: 0 }], { now: REFUSAL_DECAY_MS + 1 })).toBe(0);
  });

  it("still counts refusals inside the window", () => {
    expect(activeRefusals([{ at: 0 }, { at: 1000 }], { now: 2000 })).toBe(2);
  });

  it("drops a host on two refusals CLOSE TOGETHER, exactly as before", () => {
    // F29 must not become "be less polite". Two refusals inside the window is
    // still a drop, which is DEC-R5-1 unchanged.
    const recent = [{ at: 1000 }, { at: 2000 }];
    expect(activeRefusals(recent, { now: 2000 })).toBeGreaterThanOrEqual(
      GIVE_UP_AFTER_REFUSALS,
    );
  });

  it("lets a host back in after a long quiet period", () => {
    // The 34-minute sweep is the case: a 504 at minute 2 must not still be
    // holding a host out at minute 30.
    const old = [{ at: 0 }, { at: 60_000 }];
    expect(
      activeRefusals(old, { now: 60_000 + REFUSAL_DECAY_MS + 1 }),
    ).toBeLessThan(GIVE_UP_AFTER_REFUSALS);
  });

  it("uses a window shorter than a long sweep but longer than a burst", () => {
    // Bounded from both sides by the run it is for: the recorded sweep took
    // 34 minutes, so a window at or above that decays nothing; a window of
    // seconds would forget a genuine refusal between consecutive requests, which
    // are spaced a minute apart by OPERATOR_COOLDOWN_MS.
    expect(REFUSAL_DECAY_MS).toBeGreaterThan(OPERATOR_COOLDOWN_MS * 2);
    expect(REFUSAL_DECAY_MS).toBeLessThan(30 * 60_000);
  });
});
