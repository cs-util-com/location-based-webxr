// Repo-meta test: a doc comment is attached to the declaration it describes.
//
// WHY THIS EXISTS. TypeScript attaches only the LAST doc comment preceding a
// declaration. So when two `/** … */` blocks sit back to back, the first one
// documents NOTHING: it is invisible in editor tooltips, in generated docs, and
// to anyone who reads the declaration rather than scrolling up past it. The
// text is still in the file, which is exactly why nobody notices — it looks
// like documentation and reads like documentation and is not attached to
// anything.
//
// WHAT ACTUALLY PRODUCES IT, because the mechanism is what makes it recur: a
// later session adds a helper, a constant or a second test and puts it
// immediately after an existing doc block instead of after the declaration that
// block belongs to. The sweep that found this (2026-09-22) turned up eleven,
// every one of that exact shape:
//
//   - `utils/logger.ts` — `createLogger`'s JSDoc, including its `@example`,
//     was stranded 130 lines above it behind `toSentryLevel`.
//   - `ar/occupancy-mesher.ts` — a 30-line Naive-Surface-Nets explanation for
//     `buildSmooth`, displaced by the constant it links to.
//   - `ar/camera-blit-capture.test.ts` — one test carried two "why this test
//     matters" blocks while the test next to it carried none, which is the
//     version of this defect that silently deletes a mandated comment.
//
// WHAT IT CANNOT DO, stated in full because a guard whose limits are unwritten
// gets read as covering everything:
//
//  - **It sees ONE workspace root.** `git ls-files` runs at the webxr repo
//    root, so `c:\gps\gps-plus-slam\GpsPlusSlamJs` — the core library — is
//    invisible to it, and it had one instance of its own
//    (`alignment-config.ts`). Making it cross-root would hardcode a sibling
//    path into CI, which is the coupling the pnpm-override rule keeps out.
//    **The primary repo therefore carries its own copy** at
//    `GpsPlusSlamJs_Investigation/src/regression/orphan-doc-comments.test.ts`,
//    scoped to the published library. A deliberate copy per root is DEC-H3's
//    answer for a package that cannot reach shared code, the same trade
//    `duplicate-helpers.test.js` documents for itself — so **if you change the
//    detector, change both.**
//  - **A `@typedef` / `@callback` block is exempt.** It declares a type by
//    itself and attaches to nothing by design, so two of them in a row is
//    correct JSDoc rather than a defect.
//  - **It only finds the BACK-TO-BACK shape.** A doc block separated from its
//    declaration by a plain `//` comment, a statement, or a blank line plus a
//    statement is equally orphaned and equally invisible here. That shape is
//    rarer and much noisier to detect, so it is deliberately out.
//  - **It cannot tell a displaced block from a deliberate section banner.**
//    Prose introducing a GROUP of declarations is a real and reasonable thing
//    to write; it just must not be spelled `/**`, because that spelling is a
//    claim about the next declaration. Write those as `/* … *\/` instead, and
//    the guard is satisfied without the text moving.
//  - **A file-header block is exempt**, and "header" includes a block placed
//    BELOW the imports, which is the prevailing style here. Treating those as
//    orphans reported about a third of every package, so the exemption is what
//    makes the guard usable rather than a nicety. The cost is real: a genuinely
//    displaced block in the import region is invisible to it.
//
// Enumerates the tracked-file list rather than a curated one, for the reason
// `max-file-size.test.js` sets out: a gate over a hand-maintained list only
// guards what someone already remembered.

import { describe, it, expect } from 'vitest';

import { readTracked, trackedFiles } from './tracked-tree.js';

/** Assembled rather than written out, so this file does not match itself. */
const OPEN = `/*${'*'}`;
const CLOSE = `${'*'}/`;

const SOURCE_PATTERN = /^[^/]+\/(src|config|scripts|playwright-tests)\/.*\.(ts|tsx|js|mjs|cjs)$/;

function trackedSourceFiles() {
  return trackedFiles()
    .filter((file) => SOURCE_PATTERN.test(file))
    .filter((file) => !file.endsWith('.d.ts'));
}

/**
 * The orphaned blocks in one file's text, as `{ line, firstLine }`.
 *
 * Exported so the LOGIC is covered even in a tree where it finds nothing — a
 * green result must not be ambiguous between "no file is affected" and "the
 * matcher matches nothing".
 *
 * `line` is 1-based, so it can be pasted straight into an editor.
 */
export function orphanedDocBlocks(text) {
  const lines = text.split('\r\n').join('\n').split('\n');

  // Header territory: everything up to the first line that is not blank, not a
  // comment and NOT AN IMPORT. The import exclusion is what makes this usable
  // here: placing the file overview below the import block is the prevailing
  // style in this repo, and treating those as orphans would report about a
  // third of every package.
  let firstStatement = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const isHeaderish =
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('import(') ||
      // The continuation lines of a multi-line import: the named specifiers
      // (optionally `type`-qualified or aliased), and the `} from '…';` that
      // closes the list. The `type ` prefix is not a detail — leaving it out
      // reported `site-barriers.test.ts`'s file header as an orphan, because
      // one specifier in its import list happened to be a type.
      trimmed.startsWith('} from ') ||
      /^(type )?[A-Za-z_$][\w$]*( as [A-Za-z_$][\w$]*)?,?$/.test(trimmed);
    if (isHeaderish) continue;
    firstStatement = i;
    break;
  }

  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== OPEN) continue;
    let end = i;
    while (end < lines.length && !lines[end].trim().endsWith(CLOSE)) end++;
    if (end >= lines.length) break;

    let next = end + 1;
    while (next < lines.length && lines[next].trim() === '') next++;

    // A `@typedef` / `@callback` block DECLARES A TYPE BY ITSELF and attaches
    // to nothing by design, so it is not an orphan however many blocks follow
    // it. Nothing in this root trips it today; it is here because the primary
    // repo's copy of this guard needs it (two in a row in
    // `GpsPlusSlamJs/scripts/test-timing/gate-lock.mjs`) and the two detectors
    // are meant to agree — see the note below on why there are two at all.
    const isStandaloneTypeDecl = /@(typedef|callback)\b/.test(
      lines.slice(i, end + 1).join('\n')
    );

    if (
      next < lines.length &&
      lines[next].trim() === OPEN &&
      i > firstStatement &&
      !isStandaloneTypeDecl
    ) {
      found.push({
        line: i + 1,
        firstLine: (lines[i + 1] ?? '').trim().replace(/^\*\s?/, ''),
      });
    }
    i = end;
  }
  return found;
}

describe('doc-comment attachment guard', () => {
  describe('orphanedDocBlocks', () => {
    it('finds a block that another block immediately follows', () => {
      // The shape the whole guard exists for, at its smallest.
      const text = [
        'const x = 1;',
        '',
        OPEN,
        ' * Documents nothing.',
        ' ' + CLOSE,
        OPEN,
        ' * Documents `y`.',
        ' ' + CLOSE,
        'const y = 2;',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text)).toEqual([
        { line: 3, firstLine: 'Documents nothing.' },
      ]);
    });

    it('accepts a block that reaches its declaration', () => {
      const text = [
        'const x = 1;',
        '',
        OPEN,
        ' * Documents `y`.',
        ' ' + CLOSE,
        'const y = 2;',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text)).toEqual([]);
    });

    it('exempts the file header, however many blocks precede the first statement', () => {
      // A file overview followed by the first declaration's own doc is the
      // conventional shape, not a defect — and it is common enough that failing
      // on it would make the guard unusable.
      const text = [
        OPEN,
        ' * The file.',
        ' ' + CLOSE,
        OPEN,
        ' * Documents `y`.',
        ' ' + CLOSE,
        'const y = 2;',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text)).toEqual([]);
    });

    it('ignores a plain block comment, which makes no claim about what follows', () => {
      // The escape hatch the failure message points at: prose introducing a
      // group of declarations is legitimate, and `/*` rather than `/**` is how
      // it says so.
      const text = [
        'const x = 1;',
        '',
        '/*',
        ' * A section banner.',
        ' ' + CLOSE,
        OPEN,
        ' * Documents `y`.',
        ' ' + CLOSE,
        'const y = 2;',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text)).toEqual([]);
    });

    it('exempts a `@typedef` block, which attaches to nothing by design', () => {
      // Correct JSDoc, not a defect: a typedef declares a type by itself, so
      // two in a row is the normal way to write two of them. The primary
      // repo's copy of this guard reported three such blocks before the
      // exemption existed.
      const text = [
        'const x = 1;',
        '',
        OPEN,
        ' * @typedef {object} Thing',
        ' * @property {string} id',
        ' ' + CLOSE,
        OPEN,
        ' * @typedef {object} Other',
        ' ' + CLOSE,
        'const y = 2;',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text)).toEqual([]);
    });

    it('reports every occurrence in a file, not just the first', () => {
      // `recording-options.ts` carried two, 700 lines apart. A guard that
      // stopped at the first would have taken two sweeps to clear one file.
      const block = (body) => [OPEN, ` * ${body}`, ' ' + CLOSE];
      const text = [
        'const x = 1;',
        '',
        ...block('First orphan.'),
        ...block('Documents `y`.'),
        'const y = 2;',
        '',
        ...block('Second orphan.'),
        ...block('Documents `z`.'),
        'const z = 3;',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text).map((hit) => hit.firstLine)).toEqual([
        'First orphan.',
        'Second orphan.',
      ]);
    });
  });

  it('lists a non-trivial number of files (the scan below is not vacuous)', () => {
    // Why this test matters: an empty listing (a wrong cwd, a broken git, a
    // pathspec that stopped matching) makes the scan below pass having read
    // nothing. `git ls-files` run from a subdirectory lists paths relative
    // to it, and a filter anchored at the package level then matches none.
    expect(trackedSourceFiles().length).toBeGreaterThan(1000);
  });

  it('no tracked source file has a doc comment attached to nothing', () => {
    const offenders = [];
    for (const file of trackedSourceFiles()) {
      let text;
      try {
        text = readTracked(file);
      } catch {
        continue; // tracked but deleted in the working tree
      }
      for (const hit of orphanedDocBlocks(text)) {
        offenders.push(`${file}:${hit.line}  ${hit.firstLine.slice(0, 70)}`);
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            'These doc comments are followed immediately by another doc comment,',
            'so TypeScript attaches only the second one and the first documents',
            'nothing — it is invisible in tooltips and in generated docs.',
            '',
            'Fix by MOVING the block down to the declaration it describes. If it',
            `is prose about a GROUP of declarations, spell it /* instead of ${OPEN}`,
            'so it stops claiming to document the next one.',
            '',
            ...offenders,
          ].join('\n')
    ).toEqual([]);
  });
});
