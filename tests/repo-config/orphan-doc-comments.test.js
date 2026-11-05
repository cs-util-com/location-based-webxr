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
 * Whether a line opens a doc block: OPEN first on it, alone or with text
 * after it on the same line (a one-line block is a doc comment too; it is
 * the shape a bare-OPEN match missed twice in one review). An empty
 * comment (OPEN directly closed) is not one.
 */
function opensDocBlock(line) {
  const trimmed = line.trim();
  return trimmed.startsWith(OPEN) && !trimmed.startsWith(`${OPEN}/`);
}

/** A block's first words: the text on its opening line, else the next. */
function firstTextOf(lines, start, end) {
  const opening = lines[start].trim().slice(OPEN.length).replace(CLOSE, '').trim();
  if (opening !== '' || start === end) return opening;
  return (lines[start + 1] ?? '').trim().replace(/^\*\s?/, '');
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
    if (!opensDocBlock(lines[i])) continue;
    // The block ends at the first CLOSE after its opening: on the same line
    // for a one-line block, which is as much a doc comment as a long one.
    const openAt = lines[i].indexOf(OPEN) + OPEN.length;
    let end = i;
    let closeAt = lines[i].indexOf(CLOSE, openAt);
    while (closeAt < 0 && ++end < lines.length) {
      closeAt = lines[end].indexOf(CLOSE);
    }
    if (end >= lines.length) break;

    // Code after the block on its own last line is what it documents (an
    // inline `@type` cast, a one-line member): attached, whatever follows.
    if (lines[end].slice(closeAt + CLOSE.length).trim() !== '') {
      i = end;
      continue;
    }

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
      opensDocBlock(lines[next]) &&
      i > firstStatement &&
      !isStandaloneTypeDecl
    ) {
      found.push({ line: i + 1, firstLine: firstTextOf(lines, i, end) });
    }
    i = end;
  }
  return found;
}

/**
 * The orphans this guard found when it learned the one-line shapes
 * (2026-11-04), per file, in packages that change was not about: each is a
 * real displaced doc block, left for a cleanup of its own so that change
 * stayed out of those packages' gates. A file may hold at most its count;
 * the scan below fails once a count is higher than the file needs, so the
 * list only shrinks. Never add to it: fix the new block instead.
 */
const KNOWN_ORPHANS = Object.freeze({
  'GpsPlusSlamJs_AppFramework/src/ar/occupancy-mesher.ts': 1,
  'GpsPlusSlamJs_AppFramework/src/ar/qr/qr-tracking-controller.ts': 1,
  'GpsPlusSlamJs_AppFramework/src/storage/remote-range-byte-source.test.ts': 1,
  'GpsPlusSlamJs_AppFramework/src/visualization/atmosphere/cloud-slab.ts': 1,
  'GpsPlusSlamJs_AppFramework/src/visualization/atmosphere/sky-atmosphere.ts': 1,
  'GpsPlusSlamJs_AppFramework/src/visualization/leaflet-map-overlay.ts': 1,
  'GpsPlusSlamJs_Landing/src/scene/story-timeline.ts': 1,
  'GpsPlusSlamJs_Osm/src/mesh/barrier-gates.test.ts': 1,
  'GpsPlusSlamJs_Osm/src/mesh/buildings.test.ts': 1,
  'GpsPlusSlamJs_Osm/src/mesh/poi-models.test.ts': 1,
  'GpsPlusSlamJs_Osm/src/mesh/poi-primitives.ts': 1,
  'GpsPlusSlamJs_Osm/src/nav/obstacles.test.ts': 3,
  'GpsPlusSlamJs_Osm/src/places/geo-event.test.ts': 1,
  'GpsPlusSlamJs_Osm/src/spatial/spatial-query.bench.ts': 1,
  'GpsPlusSlamJs_Osm/src/testdata/fixture-formatting.test.ts': 1,
  'GpsPlusSlamJs_OsmDemo/src/building-view.ts': 2,
  'GpsPlusSlamJs_OsmDemo/src/demo-pipeline.test.ts': 2,
  'GpsPlusSlamJs_OsmDemo/src/picker-places.ts': 1,
  'GpsPlusSlamJs_OsmDemo/src/terrain-cycle.test.ts': 1,
  'GpsPlusSlamJs_RecorderApp/src/ar/ar-session-resources.ts': 1,
  'GpsPlusSlamJs_RecorderApp/src/ui/session-summary.ts': 1,
});

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

    it('finds a long block displaced by a one-line block', () => {
      // A class's JSDoc left above a constant added before the class, the
      // constant documented in one line: the bare-OPEN match saw only the
      // first block's opening and never looked at what followed.
      const text = [
        'const x = 1;',
        '',
        OPEN,
        ' * Documents the class.',
        ' ' + CLOSE,
        `${OPEN} Documents the constant. ${CLOSE}`,
        'const y = 2;',
        'class Z {}',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text)).toEqual([
        { line: 3, firstLine: 'Documents the class.' },
      ]);
    });

    it('finds a one-line block followed by another block', () => {
      // A stray one-line doc in front of a helper's own: the shape that
      // opened neither block on a bare OPEN line.
      const text = [
        'const x = 1;',
        '',
        `${OPEN} Documents nothing. ${CLOSE}`,
        `${OPEN} Documents \`y\`. ${CLOSE}`,
        'const y = 2;',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text)).toEqual([
        { line: 3, firstLine: 'Documents nothing.' },
      ]);
    });

    it('finds a block whose text starts on its opening line', () => {
      // OPEN with text after it, running on to a further line, then another
      // block.
      const text = [
        'const x = 1;',
        '',
        `${OPEN} Documents nothing,`,
        ' *  over two lines. ' + CLOSE,
        OPEN,
        ' * Documents `y`.',
        ' ' + CLOSE,
        'const y = 2;',
        '',
      ].join('\n');

      expect(orphanedDocBlocks(text)).toEqual([
        { line: 3, firstLine: 'Documents nothing,' },
      ]);
    });

    it('accepts a one-line block with its code after it on the same line', () => {
      // An inline cast or a one-line member documented in place is attached
      // to the code after it, whatever the next line holds; an empty
      // comment opens no block.
      const text = [
        'const x = 1;',
        '',
        `${OPEN} @type {any} ${CLOSE} (globalThis).a = 1;`,
        `${OPEN} Documents \`y\`. ${CLOSE}`,
        'const y = 2;',
        `${OPEN}/`,
        `${OPEN} Documents \`z\`. ${CLOSE}`,
        'const z = 3;',
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
    /** Files that hold fewer orphans than their KNOWN_ORPHANS count now. */
    const shrunk = [];
    for (const file of trackedSourceFiles()) {
      let text;
      try {
        text = readTracked(file);
      } catch {
        continue; // tracked but deleted in the working tree
      }
      const hits = orphanedDocBlocks(text);
      const known = KNOWN_ORPHANS[file] ?? 0;
      if (hits.length < known) shrunk.push(`${file}: ${hits.length} of ${known}`);
      if (hits.length <= known) continue;
      for (const hit of hits) {
        offenders.push(`${file}:${hit.line}  ${hit.firstLine.slice(0, 70)}`);
      }
    }

    // The list only shrinks: a file whose count fell is lowered there, so
    // the room it left cannot take a new orphan unnoticed.
    expect(
      shrunk,
      'These files hold fewer orphans than KNOWN_ORPHANS allows: lower (or remove) their counts.'
    ).toEqual([]);

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
