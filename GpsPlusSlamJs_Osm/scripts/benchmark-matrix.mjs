/**
 * The decision logic of the Overpass matrix sweep — pure, and therefore tested.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE RUNNER. Everything here decides how hard
 * this project hits **donated public infrastructure**, and the sweep the owner
 * authorised (DEC-R5-10) moves ~1.2–3.4 GB across six URLs. The justification
 * for running it at all is that it is spaced politely — so the spacing has to be
 * an assertion rather than a comment. `benchmark-endpoints.mjs` does the I/O and
 * cannot be unit-tested; this file holds every rule that governs the load and
 * `benchmark-matrix.test.mjs` pins all of them.
 *
 * WHY IT IS `.mjs` AND NOT TYPESCRIPT, like `capture-fixtures.mjs`: it must run
 * under plain `node` with no build step, and a script that imports the package's
 * `.js` specifiers does not resolve under Node's type stripping (F23 records the
 * same constraint for the capture script). The cost is that its tests are
 * `.test.mjs`, which `config/vitest.config.ts` reaches for explicitly.
 *
 * THE ONE NON-OBVIOUS RULE, and the reason this file exists at all: **six URLs
 * are three operators.** `docs/overpass-endpoint-benchmark.json` shows
 * `lz4.overpass-api.de` and `z.overpass-api.de` returning byte-identical
 * 67 973 393-byte bodies, and `overpass.private.coffee` and
 * `overpass.kumi.systems` returning byte-identical 66 348 574-byte bodies. A
 * cooldown keyed on the hostname puts three times the intended rate on FOSSGIS
 * while reporting itself as polite.
 *
 * @see ../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-01-1140-osm-demo-feedback-round-5-plan.md §3
 */

/**
 * The three forms the sweep is a matrix over, in DEFINITION order.
 *
 * - `plain` — today's production query. The CONTROL: without it the other two
 *   have nothing to be a saving against.
 * - `clipped` — `out geom(bbox)`, which the 2026-07-28 results doc names as the
 *   highest-value lever: it prints only coordinates inside the box, which is
 *   what would remove the giant-relation tail.
 * - `areal-only` — the server-side analogue of what `capture-fixtures.mjs` does
 *   client-side. NOT "no relations": multipolygon and boundary relations are the
 *   ones this package actually renders, so dropping them would measure a query
 *   nobody would ship.
 */
export const QUERY_FORMS = Object.freeze([
  "plain",
  "clipped",
  "areal-only",
  // ADDED BY F31, and predicted by the sweep it follows rather than guessed at.
  // §2.1 of the results doc reasons that the two levers attack DIFFERENT things:
  // clipping still PRINTS a clipped fragment of every giant relation that
  // touches the box, while areal-only removes those relations from the result
  // set entirely. If that is right the combination should beat both, and it is
  // one more form in the same runner rather than a new investigation.
  "clipped-areal",
]);

/**
 * The order the forms are actually RUN in, which is not their definition order.
 *
 * Cheapest hypothesis first. DEC-R5-10 accepted a range of ~1.2–3.4 GB, and
 * which end the run lands on is decided here: if `clipped` collapses the
 * payload, running it first means the answer is known long before the expensive
 * plain-form leg finishes, and the run can be stopped early with the question
 * already answered. Running the control first would spend the most bytes to
 * learn the least.
 */
export const FORM_RUN_ORDER = Object.freeze([
  "clipped",
  "areal-only",
  "clipped-areal",
  "plain",
]);

/** Relation types this package treats as areal — mirrors `AREAL_RELATION_TYPES`. */
const AREAL_RELATION_TYPES = Object.freeze(["multipolygon", "boundary"]);

/**
 * Minimum spacing between two requests to one OPERATOR, milliseconds.
 *
 * 60 s rather than the existing script's 5 s `GAP_SECONDS`, and the difference
 * is not caution — it is arithmetic. That 5 s was chosen for a six-request run;
 * this one is 72 requests of comparable size, so the same gap would compress
 * more than an order of magnitude more load into the same shape of run. At 60 s
 * across three operators a 72-cell matrix has a cooldown floor of ~24 minutes,
 * comfortably inside the three-hour budget DEC-R5-9 set.
 */
export const OPERATOR_COOLDOWN_MS = 60_000;

/** First backoff step. Never below the ordinary cooldown — see `backoffDelayMs`. */
export const BACKOFF_BASE_MS = OPERATOR_COOLDOWN_MS;

/** Ceiling on one backoff wait, so a wedged host cannot eat the whole budget. */
export const BACKOFF_MAX_MS = 15 * 60_000;

/**
 * How many refusals an OPERATOR gets before the refusing hostname is dropped.
 *
 * DEC-R5-1: _"a host that says no twice is dropped from the remainder of the run
 * and recorded as such"_. A 429 is DATA — "this host refuses this query form at
 * this size" is one of the answers the sweep exists to produce — but continuing
 * past a second one is not persistence, it is ignoring a documented policy.
 *
 * THE BUDGET IS THE OPERATOR'S AND THE DROP IS THE HOSTNAME'S, which is not a
 * hedge — they answer different questions. Counting per hostname let FOSSGIS's
 * three names absorb two refusals each, six before the operator was out; the
 * 2026-08-01 sweep recorded ten refusals where the rule allows six. Dropping per
 * operator instead would lose "this particular name is down", which the sweep is
 * also trying to measure.
 *
 * **A CONSEQUENCE WORTH KNOWING: with this at 2, the exponential in
 * {@link backoffDelayMs} is unreachable.** The first refusal backs off at
 * `attempt = 0` and the second gives up, so only the base delay (or a longer
 * `Retry-After`) can ever be used. The schedule is kept because it is the thing
 * that has to be right if this constant is ever raised, and its tests document
 * the shape rather than the current reachability.
 */
export const GIVE_UP_AFTER_REFUSALS = 2;

/**
 * How long a refusal counts against an operator's budget, in milliseconds
 * (F29).
 *
 * **THE RATE WAS NEVER THE PROBLEM; THE PERMANENCE WAS.** Under the original
 * rule a hostname dropped on its second refusal stayed dropped for the whole
 * run, and over the 34-minute 2026-08-01 sweep that cost **46 of 84 cells** —
 * including the ENTIRE second-city leg, which was the clean test of the relation
 * hypothesis (F30). A 504 at minute two was still holding a host out at minute
 * thirty, by which point it says nothing about the server's current state.
 *
 * Decaying the budget keeps the politeness per unit time exactly as DEC-R5-1
 * specified — two refusals close together still drops the host — while letting a
 * long sweep recover from a transient failure.
 *
 * TEN MINUTES, bounded from both sides by the run this is for. Requests to one
 * operator are already a minute apart ({@link OPERATOR_COOLDOWN_MS}), so a
 * window of seconds would forget a genuine refusal between consecutive attempts
 * and amount to no rule at all; a window at or above the 34-minute run length
 * would decay nothing and change nothing.
 */
export const REFUSAL_DECAY_MS = 10 * 60_000;

/**
 * How many of an operator's refusals still count, given when they happened.
 *
 * A PURE FUNCTION OF TIMESTAMPS rather than a counter that is incremented and
 * never decremented, which is what makes the decay testable without waiting ten
 * minutes — and testing a give-up rule by actually waiting is how a rule ends up
 * untested.
 */
export function activeRefusals(refusals, { now }) {
  if (!Array.isArray(refusals)) return 0;
  return refusals.filter((refusal) => now - refusal.at < REFUSAL_DECAY_MS)
    .length;
}

/**
 * Hostname → operator.
 *
 * Keys are hostnames rather than full URLs so a path change cannot silently
 * un-group a host. An UNKNOWN host becomes its own operator: "assume
 * independent" is the safe default for spacing, where the opposite mistake
 * (lumping a new endpoint in with an unrelated one) throttles it for no reason.
 */
const OPERATOR_BY_HOSTNAME = Object.freeze({
  "overpass-api.de": "fossgis",
  "lz4.overpass-api.de": "fossgis",
  "z.overpass-api.de": "fossgis",
  "overpass.private.coffee": "private.coffee",
  // The wiki records kumi.systems as having BECOME private.coffee, and the
  // 2026-07-28 benchmark shows both returning byte-identical bodies.
  "overpass.kumi.systems": "private.coffee",
  "maps.mail.ru": "vk-maps",
});

/**
 * Every hostname this table groups.
 *
 * Exported only so the cross-check against `src/source/overpass-operators.ts`
 * can compare KEY SETS in both directions. Walking one table and querying the
 * other catches a host missing from that other table, but not a host present
 * only in the one being walked — and both directions matter, because the two
 * tables are deliberately duplicated (this script runs under bare `node` with
 * no build step and cannot import from `src`).
 */
export function knownOperatorHostnames() {
  return OPERATOR_BY_HOSTNAME;
}

/** The hostname of a URL, or the URL itself when it will not parse. */
export function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** The operator behind a URL. Never throws — an unparseable URL is its own key. */
export function operatorForUrl(url) {
  const hostname = hostnameOf(url);
  return OPERATOR_BY_HOSTNAME[hostname] ?? hostname;
}

/**
 * Builds one cell's query.
 *
 * The SELECTION is identical across `plain` and `clipped` — only the printing
 * differs — so a size difference between those two is attributable to clipping
 * alone. `areal-only` is the one form that changes what is selected, and it says
 * so by construction rather than in a comment.
 *
 * @throws if `form` is not one of {@link QUERY_FORMS}. A typo'd form that
 *   quietly fell back to `plain` would produce identical rows and the confident
 *   wrong conclusion "the form makes no difference".
 */
export function buildMatrixQuery({ bbox, keys, form }) {
  if (!QUERY_FORMS.includes(form)) {
    throw new Error(
      `Unknown query form "${form}"; expected one of ${QUERY_FORMS.join(", ")}`,
    );
  }
  const header = `[out:json][timeout:180][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];`;

  // NEVER the key-regex form. Measured 2026-07-28: the union of exact-key
  // statements returns 200 where `[~"^(a|b|…)$"~"."]` 504s in 8 s on
  // the same tile, because the regex is a full-table scan.
  const areal = form === "areal-only" || form === "clipped-areal";
  const clipped = form === "clipped" || form === "clipped-areal";
  const selection = areal
    ? keys
        .map(
          (key) =>
            `nw["${key}"];` +
            AREAL_RELATION_TYPES.map(
              (type) => `relation["${key}"]["type"="${type}"];`,
            ).join(""),
        )
        .join("")
    : keys.map((key) => `nwr["${key}"];`).join("");

  const out = clipped
    ? `out geom(${bbox.south},${bbox.west},${bbox.north},${bbox.east});`
    : "out geom;";

  return [header, `(${selection});`, out].join("\n");
}

/**
 * Exponential backoff after a refusal, in milliseconds.
 *
 * FLOORED AT THE ORDINARY COOLDOWN, which is the part worth stating: the backoff
 * sits on top of the spacing rather than replacing it. A first retry shorter
 * than the normal gap would make being refused the FASTEST route back to the
 * same server.
 *
 * `Retry-After` wins whenever it is longer, because that is the server stating
 * its own terms; a shorter one never shortens our spacing.
 */
export function backoffDelayMs(attempt, { retryAfterSeconds } = {}) {
  const own = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  const requested =
    typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : 0;
  return Math.max(own, requested);
}

/**
 * How long to wait before hitting `operator`, given when it was last hit.
 *
 * Pure, and keyed on the OPERATOR rather than the hostname — the single rule
 * this whole file exists to enforce. Tested against a synthetic clock rather
 * than by sleeping, because a test that sleeps for a minute is a test nobody
 * runs.
 */
export function waitMsBeforeRequest({
  operator,
  now,
  lastRequestAt,
  cooldownMs = OPERATOR_COOLDOWN_MS,
}) {
  const last = lastRequestAt[operator];
  if (last === undefined) return 0;
  return Math.max(0, last + cooldownMs - now);
}

/**
 * The full matrix, ordered for politeness and for early answers.
 *
 * Two orderings are applied and they answer different questions:
 *
 * 1. **Form outermost, cheapest hypothesis first** (`FORM_RUN_ORDER`), so the
 *    expensive control leg is last and a run stopped early still answers "does
 *    clipping work".
 * 2. **Operators interleaved within each form/resolution group**, so the
 *    cooldown is spent waiting on OTHER operators rather than idling. The greedy
 *    is "take from the operator with the most remaining that is not the one just
 *    used", which is the standard adjacency-minimising reorder — with 3 FOSSGIS,
 *    2 private.coffee and 1 VK per group it produces no same-operator adjacency
 *    at all.
 */
export function planCells({
  hosts,
  resolutions,
  forms = QUERY_FORMS,
  repeats = 1,
}) {
  const ordered = FORM_RUN_ORDER.filter((form) => forms.includes(form));
  const cells = [];

  for (const form of ordered) {
    for (const res of resolutions) {
      // REPEATS ARE A ROUND-LEVEL LOOP, not a per-cell one, and the difference
      // is the whole reason they exist.
      //
      // The question repeats answer is "what is the SPREAD of this host's
      // latency" — `resolutions.ts` records four res-7 samples at 15.1 / 32.9 /
      // 82.9 / 91.1 s and concludes the timings "do not replicate at all". Three
      // measurements of one host taken back to back would mostly measure one
      // moment: the same queue depth, the same neighbours, the same weather. So
      // round `r` runs the whole interleaved group before round `r+1` starts,
      // which spreads each host's samples across the run and lets the operator
      // cooldown fall between them for free.
      //
      // The round index rides the id, because two cells with the same id would
      // be indistinguishable in the artefact — and telling repeats apart is the
      // point of collecting them.
      for (let round = 0; round < repeats; round++) {
        const group = hosts.map((host) => ({
          // `operatorForUrl` for BOTH halves of the id. It promises never to
          // throw — an unparseable URL becomes its own key — and a bare
          // `new URL(...)` one expression later defeated exactly that guarantee.
          id: `${form}:res${res}:${operatorForUrl(host.url)}:${hostnameOf(host.url)}${repeats > 1 ? `:r${round}` : ""}`,
          url: host.url,
          note: host.note,
          operator: operatorForUrl(host.url),
          res,
          form,
          ...(repeats > 1 ? { round } : {}),
        }));
        cells.push(...interleaveByOperator(group));
      }
    }
  }
  return cells;
}

/** Reorders so consecutive entries come from different operators where possible. */
function interleaveByOperator(cells) {
  const remaining = new Map();
  for (const cell of cells) {
    const list = remaining.get(cell.operator) ?? [];
    list.push(cell);
    remaining.set(cell.operator, list);
  }

  const out = [];
  let previous;
  while (out.length < cells.length) {
    const candidates = [...remaining.entries()].filter(
      ([, list]) => list.length > 0,
    );
    // Prefer any operator other than the last one used; fall back to it only
    // when it is the only one left, which is when adjacency is unavoidable.
    const eligible = candidates.filter(([operator]) => operator !== previous);
    const pool = eligible.length > 0 ? eligible : candidates;
    // Most-remaining-first, so the operator with the largest share is spread
    // across the whole group rather than bunching at the end.
    pool.sort((a, b) => b[1].length - a[1].length);
    const picked = pool[0];
    out.push(picked[1].shift());
    previous = picked[0];
  }
  return out;
}

/**
 * The document written after EVERY cell, not once at the end.
 *
 * The existing script writes once when it finishes, which is fine for a
 * six-request run and unacceptable for a three-hour one: a kill, a crash or a
 * laptop sleep would lose everything. A partial document must be VALID and must
 * say how far it got — `complete` and `plannedCells` are what make "which cells
 * do I still owe" answerable without re-running anything.
 *
 * `totals` reports what the run REALLY cost. DEC-R5-10 accepted an estimate of
 * ~1.2–3.4 GB; the measured figure is what a later reader needs in order to
 * decide whether to do this again, and per-operator is the breakdown that
 * matters because FOSSGIS carries half the URLs.
 */
export function buildMatrixDocument({
  centre,
  keyCount,
  cells,
  results,
  measuredAt,
  notes,
}) {
  const byOperator = {};
  let bytes = 0;
  for (const result of results) {
    bytes += result.bytes ?? 0;
    const cell = cells.find((candidate) => candidate.id === result.id);
    const operator = cell?.operator ?? operatorForUrl(result.url ?? "");
    byOperator[operator] = (byOperator[operator] ?? 0) + (result.bytes ?? 0);
  }

  return {
    measuredAt,
    centre,
    keyCount,
    plannedCells: cells.length,
    complete: results.length >= cells.length,
    cooldownMs: OPERATOR_COOLDOWN_MS,
    ...(notes === undefined ? {} : { notes }),
    totals: {
      bytes,
      requests: results.length,
      byOperator,
    },
    cells,
    results,
  };
}
