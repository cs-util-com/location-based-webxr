// Repo-meta test: retracted res-7 payload figures do not reappear as live claims.
//
// Why this test matters: the same defect has now landed three times, and each
// time it was found by a human reading rather than by any gate.
//
//  1. 2026-08-09 — `21,847 elements` was withdrawn as a res-7 feature count
//     (`resolutions.ts` FETCH_RES, N2/W2), and four sites in committed source
//     went on quoting it. Fixed 2026-08-11 (funnel plan §2.2).
//  2. 2026-08-03 — the areal-only query shipped as F32 at **21.1 MB** per res-7
//     tile, and `resolutions.ts` went on saying **~68 MB / 23–110 s** while
//     additionally describing areal-only as an unadopted investigation. Nine
//     more sites repeated the derived "28–68 MB".
//  3. 2026-08-11 — a fresh plan (the click-path stage-timing plan) built its
//     whole cold-cache prior on the 68 MB figure, because a stale production
//     doc comment was the most quotable source for it.
//
// **A number is not retracted until nothing quotes it as current.** Retraction
// notes are cheap to write and invisible to every existing gate: nothing
// type-checks a comment, and a wrong number in a JSDoc block is the input to
// the next plan, which is exactly how (3) happened. This test is the gate that
// could have caught all three.
//
// What it does NOT do: judge whether a number is right. It only enforces that
// the specific figures this repo has formally retracted appear near an explicit
// retraction marker, so a reader meeting one cannot mistake it for current.
// Introducing a NEW wrong number is still invisible here, and no automated
// check can fix that.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The figures this repo has formally retracted, with what replaced them.
 *
 * Each entry's `pattern` is deliberately tight. A loose `/68/` would match line
 * numbers, byte offsets and half the hex in the tree; the unit suffix is what
 * makes a match mean "someone is stating a payload".
 */
const RETRACTED = [
  {
    pattern: /\b28[.,]31\s?mb\b/i,
    label: '28.31 MB (retracted 2026-08-09, N2/W2 — under half the real payload)',
    witness: '(28.31 MB) of decompressed JSON',
  },
  {
    pattern: /\b21[,  ]8(00|47)\b/,
    label: '21,847 / 21,800 elements (retracted 2026-08-09 — a res-7 tile is estimated at ~40–116 k)',
    witness: 'returned 21,847 elements in one query',
  },
  {
    pattern: /(?<![\d.])(6[78](\.\d{1,2})?|28[–-]68)\s?mb\b/i,
    label: '~68 MB / 28–68 MB per res-7 tile (superseded 2026-08-03 by F32 areal-only, 21.1 MB)',
    witness: 'a res-7 tile is ~68 MB of decompressed JSON',
  },
  {
    // Bare `~28 MB` — the retracted 28.31 rounded. The lookbehind keeps it off
    // decimals that merely end in 28.
    pattern: /(?<![\d.])28\s?mb\b/i,
    label:
      'bare ~28 MB per res-7 tile (the retracted 28.31 MB, rounded — superseded, 21.1 MB)',
    witness: 'the corpus is ~28 MB on disk',
  },
  {
    // BOTH ranges, and the first version of this guard listed only `23–110 s`.
    // Every one of the twelve latency sites it was written for said
    // `18–110 s`, so the pattern matched nothing that had ever been wrong in
    // this tree and missed everything that had. Found by review, and it is the
    // sharpest available reminder that a guard must be checked against the
    // defect it names rather than against the sentence that describes it.
    pattern: /\b(18|23)[–-]110\s?s\b/,
    label:
      '18–110 s / 23–110 s per res-7 tile (the 18.2 s lower bound is retracted, and the range predates areal-only)',
    witness: 'costs an 18–110 s download',
  },
  {
    // CONTEXT REQUIRED, unlike every other entry (r504 review). The others key
    // on something that occurs nowhere else — `28.31 MB`, `18–110 s`,
    // `20 s median` — and the element-count entry was deliberately given a
    // separator requirement for the same reason. `18.2 s` is a BARE DURATION,
    // and this guard scans every tracked `.ts` and `.md` in the tree, which is
    // full of second-scale timings: without an anchor the first unrelated
    // 18.2-second measurement turns the gate red. A gate that cries wolf gets
    // disabled. Broader exposure than the docs copy, so it matters more here.
    pattern: /\b18\.2\s?s\b/,
    context: /\b(tile|res-7|payload|overpass)\b/i,
    label:
      '18.2 s per res-7 tile (retracted 2026-08-09 together with the payload it was measured beside)',
    witness: 'a res-7 tile fetched in 18.2 s',
  },
  {
    // The figure THIS repo published on 2026-08-11 and withdrew the same day.
    // It came from a production comment, was propagated to 15 sites, and had no
    // artefact behind it: the only checked-in areal-only res-7 timings are
    // 15.1 / 32.9 / 82.9 / 91.1 s, and the sweep doc that produced them
    // disclaims its own latencies as non-replicating. Listed so that a number
    // this repo has already been wrong about once cannot return unmarked.
    pattern: /~?20\s?s\s+median/i,
    label:
      '"~20 s median" (never supported — docs/overpass-matrix-sweep.json measures 15–91 s, non-replicating)',
    witness: 'measured at a ~20 s median across hosts',
  },
];

/**
 * Language that marks a figure as history rather than as a current claim.
 *
 * Two families, and both are needed:
 *
 * - **Retraction** — the figure is formally dead (`retracted`, `withdrawn`,
 *   `superseded`, `corrected from`, `used to say/quote` — but NOT the bare
 *   `used to be`, which is ordinary English about anything at all).
 * - **Contrast** — the figure is alive as the OTHER side of a comparison, which
 *   is how the F32 change is documented everywhere it is explained: "21.1 MB
 *   against the previous `nwr` form's 68.0 MB" is not a stale claim, it is the
 *   measurement that retired one.
 *
 * **Deliberately narrow within each family.** The first version accepted "no
 * longer", "stale" and "was wrong", and that was a bug rather than generosity:
 * `demo-pipeline.ts:554` then read "28–68 MB" two lines under "that no longer
 * works", a sentence about a code path and not about the number beside it. (It
 * reads `~21 MB` now — the sweep that this test gated fixed it. The example is
 * kept as history, in the past tense, because a test about false statements in
 * comments must not contain one.) A marker set made of ordinary English
 * rehabilitates by coincidence, which is indistinguishable from not having the
 * gate at all.
 *
 * **`instead of` was here and has been removed**, for the second instance of
 * exactly the bug above: it is the commonest two-word contrast phrase in
 * English, it says nothing about the number beside it, and "the mesh is built
 * in the worker instead of on the main thread" three lines from a reintroduced
 * `~68 MB` would have rehabilitated it silently. It was holding up exactly one
 * legitimate site, which now says `against the previous nwr form` like its
 * neighbours. A marker must name the form or the retraction, never merely
 * contrast two things.
 */
const RETRACTION_MARKERS =
  /\b(retracted|retraction|retracts|withdrawn|withdraws|superseded|supersedes|pre-F32|corrected from|used to (say|quote)|once quoted|the previous \S+ form|it was `?nwr)\b/i;

/**
 * How far from a hit its marker may sit: 3 lines before, 2 after.
 *
 * **Asymmetric on purpose, and this is the setting the test was tuned on — so
 * treat it as calibration rather than as a law.** A symmetric ±8 let
 * `resolutions.ts`'s live "~68 MB" claim pass, because a "CORRECTED FROM"
 * sentence four lines BELOW retracted a *different* number: the check missed
 * the single most load-bearing offender in the tree, the one it exists for.
 * Preceding-only was then too strict — `affordance-index.ts:1106` states
 * "~21,800" and calls it retracted on the very next line, which is ordinary
 * prose order.
 *
 * The generalisation behind the numbers: a marker introduces its figure, or
 * follows it within the same sentence. Two lines of slack is about one wrapped
 * sentence in this repo's comment style.
 */
const WINDOW_BEFORE = 3;
const WINDOW_AFTER = 2;

/** Extensions worth scanning: anything a human reads for a number. */
const SCANNED = /\.(ts|tsx|js|mjs|cjs|md)$/;

/**
 * Paths exempt from the scan.
 *
 * `dist/` is generated from `src/`, so flagging it would report every offence
 * twice and demand a rebuild to go green. Lockfiles and testdata are data, not
 * prose. This test file itself necessarily contains every pattern it forbids.
 *
 * **`test-timings.md` is exempt and that exemption is load-bearing**, not
 * tidiness. Those files are regenerated by the gate on every run and are full
 * of millisecond durations — `21787`, `21919`, `21563` are all in the tree
 * today — so a digit pattern that reached them would go red on a dice roll,
 * against files CLAUDE.md forbids hand-editing. There would be no legal way to
 * go green. The element-count pattern additionally requires a thousands
 * separator for the same reason; belt and braces, because this failure mode
 * blocks the whole gate rather than merely nagging.
 */
const EXEMPT =
  /(^|\/)(dist|node_modules|coverage)\/|(^|\/)pnpm-lock\.yaml$|(^|\/)test-timings\.md$|(^|\/)retracted-osm-figures\.test\.js$/;

function trackedFiles() {
  return execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
    .split('\n')
    .filter((line) => line !== '');
}

/**
 * Every place a retracted figure is stated without a nearby retraction marker.
 *
 * Returned as `path:line — label` strings rather than as a count, because the
 * whole value of this test on a red run is telling you which comment to fix.
 */
function unmarkedClaims(files) {
  const offenders = [];
  for (const file of files) {
    if (EXEMPT.test(file) || !SCANNED.test(file)) continue;
    let lines;
    try {
      lines = readFileSync(resolve(repoRoot, file), 'utf8').split('\n');
    } catch {
      continue; // a tracked path that is not readable is another test's problem
    }
    for (const [index, line] of lines.entries()) {
      for (const { pattern, label, context } of RETRACTED) {
        if (!pattern.test(line)) continue;
        // Digits that are unremarkable on their own need the line to say what
        // they are about — see the `context` field on the `18.2 s` entry.
        if (context !== undefined && !context.test(line)) continue;
        const window = lines
          .slice(Math.max(0, index - WINDOW_BEFORE), index + WINDOW_AFTER + 1)
          .join('\n');
        if (RETRACTION_MARKERS.test(window)) continue;
        offenders.push(`${file}:${index + 1} — ${label}`);
      }
    }
  }
  return offenders;
}

describe('retracted res-7 payload figures are never stated as current', () => {
  const files = trackedFiles();

  it('finds a non-trivial number of tracked files (the check is actually running)', () => {
    // Guards the failure mode where `git ls-files` returns nothing — from a
    // wrong cwd or a broken git — and every assertion below passes vacuously.
    expect(files.length).toBeGreaterThan(100);
  });

  it('quotes no retracted figure without a retraction marker beside it', () => {
    expect(unmarkedClaims(files)).toEqual([]);
  });

  it('recognises a retracted figure and the note that rehabilitates it', () => {
    // Pinned because the whole test turns on this pair of judgements, and a
    // pattern that matched nothing would make the assertion above pass forever.
    const claims = [
      'a res-7 tile is ~68 MB of decompressed JSON',
      'the features are 28–68 MB and must not cross',
      'returned 200 OK in 18.2 s (28.31 MB, 21,847 elements)',
      '23–110 s depending on the host',
      'a tile is 28-68 MB, so stopping between tiles',
      // The families the FIRST version of this guard was blind to, each pinned
      // by the exact string that was actually in the tree.
      'costs an 18–110 s download, and the rest are skipped',
      'a first visit is an 18-110 s res-7 Overpass fetch',
      'a real Overpass fetch, measured at 18.2 s for a res-7 tile',
      'a res-7 tile is ~28 MB of decompressed JSON per tile',
      '~28 MB and ~18 s of server CPU',
      // And the figure this repo itself published wrongly on 2026-08-11.
      'a res-7 tile is ~21 MB at a ~20 s median',
      'measured 21.1 MB at a 20 s median across three hosts',
      // Case-insensitivity, and the six-host sweep's two-decimal figures.
      'the body was 68 mb',
      'the sweep reported 66.35 MB and 67.97 MB',
    ];
    for (const claim of claims) {
      expect(
        RETRACTED.some((entry) => entry.pattern.test(claim)),
        `${claim} should be recognised as a retracted figure`,
      ).toBe(true);
    }

    // AND ONE WITNESS PER PATTERN, CARRIED IN THE ENTRY, because the `.some()`
    // loop above cannot tell a live pattern from a dead one: as long as ANY
    // entry matches a claim, a pattern broken into matching nothing stays
    // invisible. That is not hypothetical — a sed meant to escape a narrow
    // no-break space turned the element-count pattern into one matching
    // nothing, and every test stayed green because a different pattern caught
    // the same example.
    //
    // CO-LOCATED RATHER THAN PAIRED BY INDEX (r504 review). A parallel array
    // guarded by `toHaveLength` catches a count mismatch and never a
    // MISALIGNMENT, so inserting a pattern mid-list while appending its witness
    // at the end shifts every later pair and the failure then blames the wrong
    // entry. A field cannot slide.
    //
    // This is the second copy of a deliberately duplicated guard, and the
    // duplication decayed AGAIN: the fix landed in the docs copy first and this
    // one kept the index pairing until 2026-08-12. That is the argument for
    // making misalignment structurally impossible rather than for remembering
    // to sync.
    for (const entry of RETRACTED) {
      expect(
        entry.pattern.test(entry.witness),
        `${entry.label} matched nothing — is it dead?`,
      ).toBe(true);
      if (entry.context !== undefined) {
        expect(
          entry.context.test(entry.witness),
          `${entry.label} has a context requirement its own witness fails`,
        ).toBe(true);
      }
    }

    // And the shapes that must NOT trip it: a res-8 payload, an unrelated
    // measurement in the same units, and a bare number with no unit.
    for (const innocent of [
      'res 8: 42.7 MB',
      'the mesh build is 68 ms',
      'line 68 of the handler',
      // Res-10 payloads share the digits of the retracted res-7 one. Without
      // the lookbehind these read as `68 MB` and `28 MB` and the gate would go
      // red on the smallest, most current figures in the sweep.
      'res 10: 0.68 MB',
      'the tile came back at 1.67 MB',
      'the fixture is 0.28 MB after minification',
      // A `durationMs` from the gate's own regenerated timings. Belt to the
      // test-timings exemption's braces.
      '"durationMs":21847',
      '"durationMs":21800',
      // The current figures must never be flagged.
      'a res-7 tile is ~21 MB',
      '21.1 MB per res-7 tile',
    ]) {
      expect(
        RETRACTED.some((entry) => entry.pattern.test(innocent)),
        `${innocent} should NOT be flagged`,
      ).toBe(false);
    }

    expect(RETRACTION_MARKERS.test('The ~21,800 this used to quote is RETRACTED')).toBe(true);
    expect(RETRACTION_MARKERS.test('A res-7 tile is ~68 MB of decompressed JSON')).toBe(false);
  });

  it('does not accept ordinary English as a retraction marker', () => {
    // The regression this test was born with. `demo-pipeline.ts:554` sits two
    // lines under "that no longer works" — a sentence about a code path, not
    // about the payload figure beside it — and a marker set containing "no
    // longer" silently rehabilitated it. A gate that can be satisfied by
    // coincidence is not a gate.
    for (const coincidence of [
      'that no longer works, because answering it there would mean',
      'the fixture is stale and needs recapturing',
      'the first attempt was wrong about the mechanism',
      // Removed after review found it was the same bug a second time: the
      // commonest contrast phrase in English, saying nothing about the number.
      'the mesh is built in the worker instead of on the main thread',
      'the value used to be read from the store',
      'this is an obsolete code path',
    ]) {
      expect(
        RETRACTION_MARKERS.test(coincidence),
        `"${coincidence}" must NOT count as a retraction`,
      ).toBe(false);
    }
  });
});
