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
    pattern: /\b28[.,]31\s?MB\b/,
    label: '28.31 MB (retracted 2026-08-09, N2/W2 — under half the real payload)',
  },
  {
    pattern: /\b21[,  ]?8(00|47)\b/,
    label: '21,847 / 21,800 elements (retracted 2026-08-09 — a res-7 tile is estimated at ~40–116 k)',
  },
  {
    pattern: /\b(6[78](\.\d)?|28[–-]68)\s?MB\b/,
    label: '~68 MB / 28–68 MB per res-7 tile (superseded 2026-08-03 by F32 areal-only, 21.1 MB)',
  },
  {
    pattern: /\b23[–-]110\s?s\b/,
    label: '23–110 s per res-7 tile (superseded 2026-08-03 by F32 areal-only, ~20 s median)',
  },
];

/**
 * Language that marks a figure as history rather than as a current claim.
 *
 * Two families, and both are needed:
 *
 * - **Retraction** — the figure is formally dead (`retracted`, `withdrawn`,
 *   `superseded`, `corrected from`, `used to say`).
 * - **Contrast** — the figure is alive as the OTHER side of a comparison, which
 *   is how the F32 change is documented everywhere it is explained: "21.1 MB
 *   against the previous `nwr` form's 68.0 MB" is not a stale claim, it is the
 *   measurement that retired one.
 *
 * **Deliberately narrow within each family.** The first version accepted "no
 * longer", "stale" and "was wrong", and that was a bug rather than generosity:
 * `demo-pipeline.ts:554` states "28–68 MB" two lines under "that no longer
 * works", a sentence about a code path and not about the number beside it. A
 * marker set made of ordinary English rehabilitates by coincidence, which is
 * indistinguishable from not having the gate at all.
 */
const RETRACTION_MARKERS =
  /\b(retracted|retraction|retracts|withdrawn|withdraws|superseded|supersedes|pre-F32|corrected from|used to (say|quote|be)|once quoted|the previous \S+ form|instead of|it was `?nwr)\b/i;

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
 */
const EXEMPT =
  /(^|\/)(dist|node_modules|coverage)\/|(^|\/)pnpm-lock\.yaml$|(^|\/)retracted-osm-figures\.test\.js$/;

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
      for (const { pattern, label } of RETRACTED) {
        if (!pattern.test(line)) continue;
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
    ];
    for (const claim of claims) {
      expect(
        RETRACTED.some((entry) => entry.pattern.test(claim)),
        `${claim} should be recognised as a retracted figure`,
      ).toBe(true);
    }

    // And the shapes that must NOT trip it: a res-8 payload, an unrelated
    // measurement in the same units, and a bare number with no unit.
    for (const innocent of [
      'res 8: 42.7 MB',
      'the mesh build is 68 ms',
      'line 68 of the handler',
      'a 21.1 MB tile at a ~20 s median',
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
      'this is an obsolete code path',
    ]) {
      expect(
        RETRACTION_MARKERS.test(coincidence),
        `"${coincidence}" must NOT count as a retraction`,
      ).toBe(false);
    }
  });
});
