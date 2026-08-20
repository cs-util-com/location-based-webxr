// Repo-meta test: behaviour this repo has REMOVED is not still described as current.
//
// Why this test matters: `retracted-osm-figures.test.js` guards retracted
// *numbers*. This is the same defect class for retracted *behaviour*, and it
// has now happened once, expensively:
//
//   2026-06-06 — `createGpsAnchor`'s **large-jump bypass** (an on-screen snap
//   that overrode the frustum gate on a >2°/4 m/20 m alignment delta) was
//   removed, because once the whole frame rides one lerped `arWorldGroup`
//   matrix a large jump is already absorbed smoothly for the entire view, so a
//   per-anchor on-screen snap only manufactured a visible hard jump. The
//   removal is recorded in `gps-anchor.ts.md`. THREE README sites went on
//   describing the bypass as live for over two months — including the public
//   front page of the repo.
//
//   Found 2026-08-20, and not by a gate: by a fact-check of marketing drafts
//   that had faithfully paraphrased the stale README into claims that were the
//   exact inverse of the shipped code. A wrong sentence in a README is the
//   input to everything downstream — the next plan, the next article, the next
//   developer's mental model — which is precisely how a doc bug becomes a
//   public credibility problem.
//
// What it does NOT do: judge whether a description is right. It enforces only
// that specific, formally-removed behaviours are not stated as current. A NEW
// wrong description is still invisible here, and no automated check fixes that.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Behaviours this repo has removed, each with the sentences that actually
 * shipped describing them as live.
 *
 * `witnesses` is not decoration. `retracted-osm-figures.test.js` records that
 * its first latency pattern matched nothing that had ever been wrong in this
 * tree and missed everything that had — so every pattern here is asserted
 * against the real historical text below, and a pattern that stops matching
 * its own witness fails the suite.
 */
const REMOVED_BEHAVIOURS = [
  {
    pattern: /\blarge(r)?\s+alignment\s+jumps?\b[^.]{0,140}?\b(bypass|force|override)/i,
    label:
      "createGpsAnchor's large-jump bypass (removed 2026-06-06 — the on-screen commit is suppressed regardless of correction size; see gps-anchor.ts.md)",
    witnesses: [
      'larger alignment jumps bypass that gate so the object does not stay in a stale location',
      'Large alignment jumps still force a correction so content does not remain in a stale location.',
    ],
  },
  {
    pattern: /\balignment\s+drifts?\s+far\s+enough\b/i,
    label:
      'the "corrects anyway once drift is large enough" phrasing of the same removed bypass (removed 2026-06-06)',
    witnesses: [
      'while still correcting if alignment drifts far enough that content would otherwise be left in a stale spot',
    ],
  },
  {
    // NOT a behaviour removal — a retracted MEASUREMENT, kept here rather than
    // in the figures guard because it is a claim about how the system behaves
    // over time, and because it reached three READMEs and four articles from a
    // single unsourced sentence. The corpus (51 recordings) puts the median at
    // ~120 s to come within a metre of the estimate's own final answer, with
    // ~7 m still remaining at ~20 s. The two are not the same quantity, which
    // is precisely why the short form must not circulate unqualified.
    // CONTEXT REQUIRED, like the sibling guard's bare-duration entry: "15
    // seconds" alone appears in timeouts, budgets and test durations all over
    // this tree, and a guard that cries wolf gets disabled. The context words
    // are what make a match mean "someone is stating a convergence time".
    //
    // The pattern was ALSO wrong on first writing — it required "of walking"
    // and so missed one of the two sentences that actually shipped ("for
    // roughly 15 seconds in representative outdoor conditions"). The
    // witness check below caught it, which is the entire reason that check
    // exists.
    pattern: /\b(?:roughly|about|after|for)\s+(?:15|fifteen)\s+seconds\b/i,
    context: /\b(?:walk|walked|walking|drift|alignment|converg)/i,
    label:
      '"roughly 15 seconds of walking" as a convergence claim (retracted 2026-08-20 — the only corpus measurement is a ~2 min median)',
    witnesses: [
      'After roughly 15 seconds of walking in representative outdoor conditions, visible drift typically drops well below raw GPS',
      'Once the user has walked for roughly 15 seconds in representative outdoor conditions, the solver has enough baseline',
    ],
  },
];

/**
 * Language that marks the behaviour as history or as an explicit negation,
 * rather than as a live claim.
 *
 * Deliberately narrow, for the reason the sibling guard records at length: a
 * marker set made of ordinary English rehabilitates by coincidence, which is
 * indistinguishable from not having the gate. Each entry here either names the
 * removal or negates the specific verb the pattern matched.
 */
const MARKERS =
  /\b(removed|retracted|superseded|no longer exists|does not (force|bypass|override|stay)|not size-limited|no large-jump)\b/i;

/** @returns {string[]} tracked .md and .ts files, excluding this guard itself */
function trackedDocs() {
  return execFileSync('git', ['ls-files', '*.md', '*.ts'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.endsWith('retracted-behaviour-claims.test.js'));
}

/**
 * ONE pass over the tree for ALL patterns, memoised.
 *
 * The scan covers ~1850 tracked files and ~3.7 MB. Re-reading that per
 * behaviour put the suite over vitest's default 5 s timeout the moment a
 * second behaviour was added — i.e. the guard's cost grew with exactly the
 * thing it is meant to accumulate, which would have made every future entry
 * an argument about test speed instead of about correctness.
 *
 * @type {Map<string, string[]> | undefined}
 */
let offendersByLabel;

/** @returns {Map<string, string[]>} label → "file:line" of live claims */
function scanTree() {
  if (offendersByLabel !== undefined) {
    return offendersByLabel;
  }
  const found = new Map(REMOVED_BEHAVIOURS.map(({ label }) => [label, []]));
  for (const file of trackedDocs()) {
    let text;
    try {
      text = readFileSync(resolve(repoRoot, file), 'utf8');
    } catch {
      continue; // deleted-but-tracked during a rebase; not this gate's job
    }
    // Cheap pre-filter: the overwhelming majority of files contain none of the
    // trigger words, and skipping their line split is what keeps this under a
    // second. Every entry's context words must appear here, or that entry
    // silently stops being enforced on files the filter drops.
    if (!/alignment|walk|drift|converg/i.test(text)) {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      if (MARKERS.test(line)) {
        return;
      }
      for (const { pattern, context, label } of REMOVED_BEHAVIOURS) {
        if (!pattern.test(line)) {
          continue;
        }
        // A context requirement is a per-entry narrowing: the pattern says
        // "this shape of words", the context says "and it is about this".
        if (context && !context.test(line)) {
          continue;
        }
        found.get(label)?.push(`${file}:${index + 1}`);
      }
    });
  }
  offendersByLabel = found;
  return found;
}

describe('removed behaviour is not described as current', () => {
  // Why this test matters: it proves the patterns are not vacuous. A guard that
  // matches nothing passes forever and protects nothing — the exact failure
  // mode the sibling guard was rewritten for.
  it.each(REMOVED_BEHAVIOURS)(
    'matches the sentences that actually shipped: $label',
    ({ pattern, context, witnesses }) => {
      for (const witness of witnesses) {
        expect(witness).toMatch(pattern);
        if (context) {
          expect(witness).toMatch(context);
        }
      }
    }
  );

  it('accepts a corrected sentence that names the removal', () => {
    // The replacement text must pass, or the guard blocks its own fix.
    const corrected =
      'A per-anchor large-jump bypass existed until 2026-06-06 and was removed: ' +
      'a large alignment jump does not force an on-screen correction.';
    const matched = REMOVED_BEHAVIOURS.some(({ pattern }) =>
      pattern.test(corrected)
    );
    expect(matched).toBe(true);
    expect(corrected).toMatch(MARKERS);
  });

  it.each(REMOVED_BEHAVIOURS)(
    'is not stated as current anywhere in the tree: $label',
    ({ label }) => {
      const offenders = scanTree().get(label) ?? [];
      expect(
        offenders,
        `${label}\nStated as current at:\n  ${offenders.join('\n  ')}`
      ).toEqual([]);
    }
  );
});
