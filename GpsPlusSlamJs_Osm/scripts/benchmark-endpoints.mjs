#!/usr/bin/env node
/**
 * Times the public Overpass instances on one identical res-7 tile.
 *
 * Run on demand only — it hits donated public infrastructure:
 *
 *   node scripts/benchmark-endpoints.mjs
 *   node scripts/benchmark-endpoints.mjs --lat 50.9413 --lng 6.9583
 *   node scripts/benchmark-endpoints.mjs --res 8 --host lz4   # one host, one res
 *   node scripts/benchmark-endpoints.mjs --matrix              # W1's full sweep
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST, same rule as `capture-fixtures.mjs`: a
 * test that touches the network is a test that fails when a public server is
 * down, and this one additionally puts ~21 MB and tens of seconds of server CPU on a
 * volunteer-run instance — and in `--matrix` mode ~1.2–3.4 GB and ~25–70 minutes
 * of it. It must never run in a gate.
 *
 * ONE QUERY PER HOST, SERIALISED, ONE PASS — in the DEFAULT mode. That is an
 * ethical constraint, not a technical one: these instances' usage policies
 * explicitly ask callers not to generate this load. The statistical consequence
 * is real and must survive into the results doc: **a single sample cannot
 * support "host A is faster than host B"**. It supports weaker claims that are
 * still worth having — reachable or not, answers this query form or 504s on it,
 * same order of magnitude or an order out.
 *
 * `--matrix` DELIBERATELY BREAKS THE "ONE PASS" HALF OF THAT RULE, and only with
 * the owner's explicit authorisation (DEC-R5-10, taken twice against a stated
 * cost). What it does NOT relax is the RATE: the volume is spread across a
 * per-OPERATOR cooldown, backoff on refusal, a give-up after two refusals and a
 * hard runtime budget. Every one of those rules lives in `benchmark-matrix.mjs`
 * and is unit-tested, because a politeness rule that is only a comment is not a
 * rule. **Six URLs are three operators** — see that file for the byte-identical
 * responses that prove it.
 *
 * FIRST BYTE IS REPORTED SEPARATELY FROM LAST BYTE on purpose. Overpass spends
 * most of a large query executing server-side before it streams anything, so
 * the two numbers separate a slow query planner from a slow pipe — different
 * problems with different remedies.
 *
 * The narrative plan and results live in the docs repo
 * (`GpsPlusSlamJs_Docs/docs/2026-07-28-2336-overpass-endpoint-benchmark-plan.md`
 * and its `-results.md` sibling). Only the machine-readable JSON stays here,
 * next to the script that writes it.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { latLngToCell, cellToBoundary } from "h3-js";

import {
  GIVE_UP_AFTER_REFUSALS,
  activeRefusals,
  REFUSAL_DECAY_MS,
  OPERATOR_COOLDOWN_MS,
  backoffDelayMs,
  buildMatrixDocument,
  buildMatrixQuery,
  operatorForUrl,
  planCells,
  QUERY_FORMS,
  waitMsBeforeRequest,
} from "./benchmark-matrix.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Matches `FETCH_RES` in `src/spatial/resolutions.ts`.
 *
 * Overridable with `--res`. **And the answer that override produced is the
 * opposite of the obvious one**, so it is recorded here: shrinking the bbox
 * barely shrinks the payload. Measured on `lz4`, 2026-07-29, same centre.
 *
 * **SUPERSEDED as a property of the production query, though not as a
 * measurement** — the three figures below are the `nwr` form, retired by F32 on
 * 2026-08-03. Under areal-only the payload tracks area again (res 7 → res 9 is
 * 21x, not 1.8x), so what follows explains a behaviour this app no longer
 * exhibits. Kept because the sweep still runs all three forms, and the contrast
 * is the point of running them.
 *
 * Under the previous `nwr` form, then:
 *
 * - res 7 (4.55 km² hexagon) — 68.0 MB
 * - res 8 (0.65 km²) — 42.7 MB
 * - res 9 (0.093 km²) — 38.7 MB
 *
 * **49x less ground for 1.8x less data.** The cause is `out geom`, which prints
 * the FULL geometry of every element that INTERSECTS the bbox — the OSM wiki is
 * explicit that "constituent ways or relations may extend beyond these bounds".
 * A handful of city-scale ways (rivers, landuse multipolygons, boundaries,
 * power lines) dominate the bytes, and every bbox in Cologne intersects them
 * whatever its size.
 *
 * So `FETCH_RES` is NOT the lever on payload it looks like. The lever the wiki
 * points at is `out geom(south,west,north,east)`, which emits only coordinates
 * inside the box — see the results doc for why that is not a drop-in change.
 */
const FETCH_RES = 7;

/** Cologne — the demo's default area, and where the corpus was captured. */
const DEFAULT_CENTRE = { lat: 50.9413, lng: 6.9583 };

/**
 * Global-coverage, free, no-API-key instances, from the OSM wiki's Overpass API
 * page (checked 2026-07-28).
 *
 * Regional instances (Switzerland, Britain and Ireland, Virginia, Ethiopia) are
 * excluded deliberately: they hold regional extracts, so a Cologne tile would
 * measure "does not have this data" rather than speed — the kind of comparison
 * that produces a confident wrong conclusion. Geofabrik (payment) and
 * FairwayMapper (API key) are excluded as unusable for an unattended default.
 */
const ENDPOINTS = [
  {
    url: "https://overpass-api.de/api/interpreter",
    note: "FOSSGIS main",
  },
  {
    url: "https://lz4.overpass-api.de/api/interpreter",
    note: "FOSSGIS backend — included to CONFIRM it shares the main quota, not as a competitor",
  },
  {
    url: "https://z.overpass-api.de/api/interpreter",
    note: "FOSSGIS backend — likewise",
  },
  {
    url: "https://overpass.private.coffee/api/interpreter",
    note: "Private.coffee — the canonical name the wiki now lists",
  },
  {
    url: "https://overpass.kumi.systems/api/interpreter",
    note: "legacy alias this package hardcodes; the wiki says it became private.coffee",
  },
  {
    url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    note: "VK Maps",
  },
];

/** Seconds to wait between hosts. Politeness, not correctness. */
const GAP_SECONDS = 5;

/**
 * Where `--matrix` writes when `--out` is not given.
 *
 * This file is cited BY NAME in `src/spatial/resolutions.ts` as the source of
 * the 15.1 / 32.9 / 82.9 / 91.1 s figures a good deal of this repo's latency
 * reasoning rests on. See {@link resolveOutputPath}.
 */
const DEFAULT_OUT_NAME = "overpass-matrix-sweep.json";

/**
 * The `--matrix` output path, or an exit if writing there would destroy data.
 *
 * **FAIL CLOSED, because the first version of `--out` did not actually disarm
 * anything.** It left the default pointing at {@link DEFAULT_OUT_NAME} and the
 * write unconditional, so it added a safety you had to remember to engage —
 * and `stringArg` treats a value starting with `--` as absent, so the plausible
 * typo `--out --repeats 2` fell back to the default and would have overwritten
 * the protected artefact anyway.
 *
 * Refusing costs a retyped command. The failure it replaces destroys a
 * measurement that took ~20 minutes of donated server time and that production
 * constants cite.
 *
 * It EXITS rather than returning a result the caller must branch on: this is a
 * CLI entry point, there is exactly one sensible response to either refusal,
 * and `runMatrix` is already at its complexity limit.
 */
function resolveOutputPath(outDir, outName) {
  const outPath = join(outDir, outName);
  // `--out ../../elsewhere.json` would escape `docs/`. A flag whose purpose is
  // protecting one directory should not be able to write outside it.
  if (!resolve(outPath).startsWith(resolve(outDir))) {
    console.error(`--out must name a file inside ${outDir}`);
    process.exit(1);
  }
  if (existsSync(outPath) && !process.argv.includes("--force")) {
    console.error(
      `refusing to overwrite ${outPath}\n` +
        `  pass --out <new-name>.json for a new run, or --force to replace it.\n` +
        `  (dated names are the convention: overpass-sweep-YYYY-MM-DD-<what>.json)`,
    );
    process.exit(1);
  }
  return outPath;
}

/**
 * The key list and query form, kept identical to `capture-fixtures.mjs`.
 *
 * Read from that file rather than duplicated a third time: the package has
 * already paid once for a divergent copy of this list, and
 * `capture-script-query.test.ts` pins the capture script's copy to
 * `OVERPASS_SELECT_KEYS`. Reading it here inherits that guarantee instead of
 * creating a new thing to keep in sync.
 */
function selectKeysFromCaptureScript() {
  const source = readFileSync(join(__dirname, "capture-fixtures.mjs"), "utf8");
  const block = /const SELECT_KEYS = \[([\s\S]*?)\];/.exec(source);
  if (block?.[1] === undefined) {
    throw new Error(
      "Could not read SELECT_KEYS from capture-fixtures.mjs — has it been restructured?",
    );
  }
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function buildQuery(bbox, keys) {
  return [
    `[out:json][timeout:180][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];`,
    `(${keys.map((key) => `nwr["${key}"];`).join("")});`,
    "out geom;",
  ].join("\n");
}

function bboxOfCell(cell) {
  const boundary = cellToBoundary(cell);
  const lats = boundary.map(([lat]) => lat);
  const lngs = boundary.map(([, lng]) => lng);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  };
}

/**
 * Drains the body, recording first-byte time and size into `progress`.
 *
 * Streamed rather than `.text()` because first-byte is not observable
 * otherwise. `progress` is mutated rather than returned so a failure PART WAY
 * through a multi-megabyte body still reports how far it got — "died after
 * 40 MB" and
 * "never connected" are different diagnoses.
 */
async function readBody(response, started, progress) {
  const reader = response.body?.getReader();
  if (reader === undefined) return;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (progress.firstByteMs === null) {
      progress.firstByteMs = performance.now() - started;
    }
    progress.bytes += value.byteLength;
  }
}

/** Times one endpoint. Never throws — a dead host is a RESULT, not an error. */
async function timeEndpoint(endpoint, query) {
  const started = performance.now();
  const progress = { firstByteMs: null, bytes: 0 };
  const base = { url: endpoint.url, note: endpoint.note };
  const finish = (extra) => ({
    ...base,
    ...extra,
    firstByteMs:
      progress.firstByteMs === null ? null : Math.round(progress.firstByteMs),
    totalMs: Math.round(performance.now() - started),
    bytes: progress.bytes,
  });

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      headers: {
        // Every instance asks for an identifying User-Agent; the FOSSGIS policy
        // makes it a requirement rather than a courtesy.
        "User-Agent":
          "gps-plus-slam-osm endpoint benchmark (github.com/cs-util-com)",
      },
    });
    const retryAfter = response.headers.get("retry-after");
    await readBody(response, started, progress);
    return finish({
      ok: response.ok,
      status: `${response.status} ${response.statusText}`,
      ...(retryAfter === null ? {} : { retryAfter }),
    });
  } catch (error) {
    return finish({
      ok: false,
      status: `network error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : fallback;
}

/** A single string CLI value, e.g. `--out sweep-2026-08-19.json`. */
function stringArg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  // A flag with nothing after it, or followed by the next flag, is a typo
  // rather than a request for the empty string.
  return value === undefined || value.startsWith("--") ? fallback : value;
}

/** Comma-separated numeric CLI list, e.g. `--resolutions 7,8,9`. */
function listArg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const parsed = String(process.argv[at + 1] ?? "")
    .split(",")
    .map(Number)
    .filter(Number.isFinite);
  return parsed.length > 0 ? parsed : fallback;
}

/**
 * Comma-separated STRING CLI list, e.g. `--forms clipped,areal-only`.
 *
 * Separate from `listArg` rather than generalised, because that one coerces
 * with `Number` and filters on `Number.isFinite` — handed a form name it would
 * silently return the fallback, i.e. the full matrix, which is the opposite of
 * what a narrowing flag must do when it is mistyped.
 */
function stringListArg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const parsed = String(process.argv[at + 1] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const unknown = parsed.filter((value) => !QUERY_FORMS.includes(value));
  if (unknown.length > 0) {
    // LOUD, not a silent fallback to everything. A typo here would otherwise
    // spend the full 112-cell budget when ~12 was intended.
    throw new Error(
      `Unknown query form(s): ${unknown.join(", ")}. Known: ${QUERY_FORMS.join(", ")}`,
    );
  }
  return parsed.length > 0 ? parsed : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A refusal is a REFUSAL, not a failure to be retried indefinitely.
 *
 * 429 is the explicit one. 504 counts too: on a query this size it means the
 * server started the work and gave up, which is the same message expressed as
 * exhaustion rather than as policy — asking again immediately is the same
 * discourtesy either way.
 */
function isRefusal(result) {
  return /\b(429|504)\b/.test(result.status ?? "");
}

/** Heidelberg — 2 non-areal relations against Cologne's 84 (see the plan §3). */
const SECOND_CITY = { lat: 49.4122, lng: 8.7101, label: "heidelberg-altstadt" };

/**
 * W1's full sweep (DEC-R5-1, DEC-R5-10).
 *
 * The rules that bound the load all live in `benchmark-matrix.mjs` and are
 * unit-tested; this function is the I/O around them. What it adds on top is the
 * two things only a running process can do: **write after every cell** so three
 * unattended hours cannot be lost to a laptop sleep, and **stop cleanly at a
 * runtime budget** rather than at the end of the matrix.
 */
/**
 * Lets a dropped host back in once its operator has been quiet (F29).
 *
 * RE-ADMISSION IS THE POINT, not the decay on its own. A decaying counter beside
 * a permanent drop would be decoration: the host would still never be tried
 * again. A host stays out only while its operator’s refusals are still recent;
 * once they age past `REFUSAL_DECAY_MS` it is tried again.
 *
 * Its own function because `runMatrix` is already at the complexity ceiling, and
 * because "when does a host come back" is a rule worth being able to point at.
 */
function readmitIfQuiet({ hostname, cell, dropped, refusals, notes }) {
  if (!dropped.has(hostname)) return;
  const recent = activeRefusals(refusals[cell.operator], { now: Date.now() });
  if (recent >= GIVE_UP_AFTER_REFUSALS) return;
  dropped.delete(hostname);
  const minutes = Math.round(REFUSAL_DECAY_MS / 60000);
  notes.push(
    `${hostname} re-admitted: ${cell.operator} has not refused in the last ${minutes} min`,
  );
  console.log(`  ${hostname} re-admitted after a quiet ${minutes} min`);
}

async function runMatrix() {
  const centre = {
    lat: arg("lat", DEFAULT_CENTRE.lat),
    lng: arg("lng", DEFAULT_CENTRE.lng),
  };
  const resolutions = listArg("resolutions", [7, 8, 9, 10]);
  const budgetMs = arg("budget-minutes", 180) * 60_000;
  const keys = selectKeysFromCaptureScript();

  // `--forms areal-only` narrows the sweep to one query form.
  //
  // ADDED AFTER THE 2026-08-03 RUN, and the reason is a gap that run left: the
  // full matrix spends most of its budget on forms already decided, and the
  // form actually ADOPTED (`areal-only`) came out with n=1 at res 7, n=1 at
  // res 8 and no successful res-9 sample at all — because every other host was
  // in a refusal cooldown during its legs. A 112-cell run cannot be repeated to
  // fix that; a one-form run of ~12 cells can.
  //
  // It also breaks the position confound the full run has: forms run in a fixed
  // order, so the one scheduled first gets the freshest hosts and the one
  // scheduled last inherits every refusal. A single-form run gives that form the
  // whole budget.
  const forms = stringListArg("forms", [...QUERY_FORMS]);
  // `--repeats N` measures each cell N times, in N interleaved rounds.
  //
  // ADDED 2026-08-19 for DEC-T4, which asks for "a distribution rather than a
  // single sample". Everything this script has produced so far is n=1 per cell,
  // and `resolutions.ts` is explicit that Overpass latency "does not replicate
  // at all" — four res-7 samples spanning 15.1 to 91.1 s. A comparison drawn
  // from single samples on either side of it cannot mean anything, and this
  // repo has already had to retract three latency figures that were quoted as
  // if it could.
  const repeats = Math.max(1, arg("repeats", 1));
  const cells = planCells({
    hosts: ENDPOINTS,
    resolutions,
    forms,
    repeats,
  }).map((cell) => ({
    ...cell,
    centre,
    site: "cologne-cathedral",
  }));

  // The optional final leg (plan §3): the same form x resolution sweep at a site
  // with almost no non-areal relations. If Heidelberg barely moves while Cologne
  // collapses, the relation hypothesis is PROVED rather than assumed. Last, so a
  // run cut short still has the primary matrix.
  if (process.argv.includes("--second-city")) {
    cells.push(...secondCityCells(resolutions));
  }

  const outDir = join(__dirname, "..", "docs");
  mkdirSync(outDir, { recursive: true });
  // `--out <name>` writes somewhere other than the canonical artefact.
  //
  // ADDED 2026-08-19 BECAUSE THE DEFAULT PATH IS A LOADED GUN. It is
  // unconditional, and `overpass-matrix-sweep.json` is the artefact
  // `spatial/resolutions.ts` cites by name for the 15.1 / 32.9 / 82.9 / 91.1 s
  // figures that half this repo's latency reasoning rests on. A second
  // `--matrix` run silently overwrote it, and the only warning was that nobody
  // had done it yet. A run that is not meant to REPLACE the reference should
  // say so on the command line.
  const outPath = resolveOutputPath(outDir, stringArg("out", DEFAULT_OUT_NAME));

  const results = [];
  const lastRequestAt = {};
  const refusals = {};
  const dropped = new Set();
  const notes = [];
  const startedAt = Date.now();

  const write = (extraNotes = []) => {
    writeFileSync(
      outPath,
      `${JSON.stringify(
        buildMatrixDocument({
          centre,
          keyCount: keys.length,
          cells,
          results,
          measuredAt: new Date(startedAt).toISOString(),
          notes: [...notes, ...extraNotes],
        }),
        null,
        2,
      )}\n`,
    );
  };

  console.log(
    `matrix: ${cells.length} cells · ${resolutions.length} resolutions · ${ENDPOINTS.length} URLs across ${new Set(ENDPOINTS.map((e) => operatorForUrl(e.url))).size} operators`,
  );
  console.log(
    `per-operator cooldown ${OPERATOR_COOLDOWN_MS / 1000}s · budget ${budgetMs / 60_000} min · writing ${outPath} after every cell\n`,
  );
  // NO WRITE HERE. An empty document written before the first request destroys
  // the artefact that incremental writing exists to protect: kill a long run at
  // hour two, restart it, and the previous results are gone at t=0 — before the
  // new run has produced anything to replace them. The first write now happens
  // after the first cell resolves, so a restart can only ever overwrite a
  // document with one that has real content in it.
  //
  // (There is still no RESUME path — nothing reads this file back. That is F30's
  // neighbour and is filed rather than pretended: the stable cell ids exist so a
  // resume can be written, not because one exists.)

  for (const cell of cells) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > budgetMs) {
      notes.push(
        `stopped at the ${budgetMs / 60_000}-minute runtime budget after ${results.length} of ${cells.length} cells`,
      );
      console.log(`\nbudget reached — stopping cleanly`);
      break;
    }

    const hostname = new URL(cell.url).hostname;
    readmitIfQuiet({ hostname, cell, dropped, refusals, notes });
    if (dropped.has(hostname)) {
      // Recorded rather than silently skipped: "this host refused and was
      // dropped" is one of the answers the sweep exists to produce, and a gap in
      // the results would otherwise read as a cell nobody thought to run.
      //
      // Reached only while the refusals are still RECENT — see the re-admission
      // above.
      results.push({
        ...cellRecord(cell),
        skipped: "host dropped after refusals",
      });
      write();
      continue;
    }

    const wait = waitMsBeforeRequest({
      operator: cell.operator,
      now: Date.now(),
      lastRequestAt,
    });
    if (wait > 0) await sleep(wait);

    const tile = latLngToCell(cell.centre.lat, cell.centre.lng, cell.res);
    const bbox = bboxOfCell(tile);
    const query = buildMatrixQuery({ bbox, keys, form: cell.form });

    process.stdout.write(
      `[${results.length + 1}/${cells.length}] ${cell.form} res${cell.res} ${hostname} … `,
    );
    const measured = await timeEndpoint(cell, query);
    // STAMPED WHEN THE RESPONSE FINISHES, not when the request starts. Set
    // before the await, the cooldown is start-to-start: a cell whose download
    // takes longer than the cooldown leaves ZERO quiet before that operator's
    // next hit, and it is the heaviest cells that do that. The recorded sweep
    // had ten of thirty-eight attempted cells over 60 s, the longest 221 s — so
    // the "60 s between hits" the file claims was not what the heaviest cells
    // got. End-to-start is what the narrative says and what a server feels.
    lastRequestAt[cell.operator] = Date.now();
    const mb = (measured.bytes / 1_000_000).toFixed(2);
    console.log(`${measured.status} · ${measured.totalMs} ms · ${mb} MB`);

    if (isRefusal(measured)) {
      // COUNTED PER OPERATOR, NOT PER HOSTNAME, and that is the whole thesis of
      // `benchmark-matrix.mjs` applied to the one place that had missed it. The
      // cooldown and the backoff already key on the operator; this counter did
      // not, so FOSSGIS's three hostnames were each allowed two refusals — six
      // before the operator was fully out. The recorded 2026-08-01 sweep shows
      // exactly that: FOSSGIS said no four times and private.coffee four times,
      // ten refusals absorbed where the documented rule allows six.
      //
      // The GIVE-UP still drops the HOSTNAME, because "this name is down" and
      // "this operator is refusing" are different results and the sweep should
      // record both — but the budget that triggers it is the operator's.
      // TIMESTAMPS, NOT A COUNTER (F29). The budget DECAYS: a refusal older
      // than `REFUSAL_DECAY_MS` no longer counts, so two refusals close
      // together still drop the host — DEC-R5-1 unchanged — while a 504 at
      // minute two stops holding a host out at minute thirty. Under the old
      // permanent rule that cost 46 of 84 cells on a 34-minute sweep, including
      // the whole second-city leg.
      refusals[cell.operator] = [
        ...(refusals[cell.operator] ?? []),
        { at: Date.now() },
      ];
      const count = activeRefusals(refusals[cell.operator], {
        now: Date.now(),
      });
      if (count >= GIVE_UP_AFTER_REFUSALS) {
        dropped.add(hostname);
        notes.push(
          `${hostname} dropped after ${count} recent refusals against ${cell.operator} (${measured.status})`,
        );
        console.log(
          `  ${cell.operator} has refused ${count}x — dropping ${hostname} for the rest of the run`,
        );
      } else {
        // Back off the OPERATOR, not the hostname: a 429 from lz4 is FOSSGIS
        // saying no, and immediately querying z.overpass-api.de would be
        // ignoring a refusal from the same servers.
        const delay = backoffDelayMs(count - 1, {
          retryAfterSeconds: Number(measured.retryAfter),
        });
        lastRequestAt[cell.operator] =
          Date.now() + delay - OPERATOR_COOLDOWN_MS;
        console.log(
          `  backing off ${Math.round(delay / 1000)}s for ${cell.operator}`,
        );
      }
    }

    results.push({ ...cellRecord(cell), tile, ...measured });
    write();
  }

  write();
  const gb = (
    results.reduce((sum, r) => sum + (r.bytes ?? 0), 0) / 1_000_000_000
  ).toFixed(2);
  console.log(
    `\n${results.length}/${cells.length} cells · ${gb} GB moved · ${Math.round((Date.now() - startedAt) / 60_000)} min`,
  );
  console.log(`wrote ${outPath}`);
}

/**
 * The optional final leg: the same form x resolution sweep at a site with almost
 * no non-areal relations. If Heidelberg barely moves while Cologne collapses,
 * the relation hypothesis is PROVED rather than assumed.
 */
function secondCityCells(resolutions) {
  // One host, and lz4 specifically: every earlier per-resolution measurement
  // in this repo was taken there, so this leg stays comparable to them.
  const host = ENDPOINTS.find((e) => e.url.includes("lz4")) ?? ENDPOINTS[0];
  if (host === undefined) {
    throw new Error("--second-city needs at least one endpoint to run on");
  }
  return [
    ...planCells({ hosts: [host], resolutions }).map((cell) => ({
      ...cell,
      id: `${SECOND_CITY.label}:${cell.id}`,
      centre: { lat: SECOND_CITY.lat, lng: SECOND_CITY.lng },
      site: SECOND_CITY.label,
    })),
  ];
}

/** The plan fields copied onto every result, so a row is readable on its own. */
function cellRecord(cell) {
  return {
    id: cell.id,
    url: cell.url,
    operator: cell.operator,
    res: cell.res,
    form: cell.form,
    site: cell.site,
  };
}

async function main() {
  if (process.argv.includes("--matrix")) return runMatrix();

  const centre = {
    lat: arg("lat", DEFAULT_CENTRE.lat),
    lng: arg("lng", DEFAULT_CENTRE.lng),
  };
  const res = arg("res", FETCH_RES);
  // `--host <substring>` narrows the sweep to one instance. Measuring a
  // RESOLUTION question across six donated servers would be six times the load
  // for an answer that only needs one of them held constant.
  const hostFilter = process.argv.includes("--host")
    ? process.argv[process.argv.indexOf("--host") + 1]
    : undefined;
  const hosts =
    hostFilter === undefined
      ? ENDPOINTS
      : ENDPOINTS.filter((e) => e.url.includes(hostFilter));
  const cell = latLngToCell(centre.lat, centre.lng, res);
  const bbox = bboxOfCell(cell);
  const keys = selectKeysFromCaptureScript();
  const query = buildQuery(bbox, keys);

  console.log(`res-${res} tile ${cell} around ${centre.lat}, ${centre.lng}`);
  console.log(
    `${keys.length} keys, union form, one query per host, serialised`,
  );
  console.log(`${ENDPOINTS.length} hosts, ${GAP_SECONDS}s gap between them\n`);

  const results = [];
  for (const [index, endpoint] of hosts.entries()) {
    process.stdout.write(`${endpoint.url} … `);
    const result = await timeEndpoint(endpoint, query);
    results.push(result);
    const mb = (result.bytes / 1_000_000).toFixed(2);
    console.log(
      `${result.status} · first byte ${result.firstByteMs ?? "—"} ms · total ${result.totalMs} ms · ${mb} MB`,
    );
    if (index < hosts.length - 1) {
      await new Promise((r) => setTimeout(r, GAP_SECONDS * 1000));
    }
  }

  const out = {
    measuredAt: new Date().toISOString(),
    cell,
    res,
    centre,
    bbox,
    keyCount: keys.length,
    // Recorded so a reader of the JSON can tell WHAT was asked, not just how
    // long it took — a timing without its query is not reproducible.
    query,
    results,
  };
  const outDir = join(__dirname, "..", "docs");
  mkdirSync(outDir, { recursive: true });
  // Per-resolution filename, so a resolution sweep does not overwrite the host
  // sweep it is meant to be compared against.
  const outPath = join(outDir, `overpass-endpoint-benchmark-res${res}.json`);
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${outPath}`);
}

await main();
