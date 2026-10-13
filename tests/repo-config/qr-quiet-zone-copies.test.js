// Why this test matters: the QR quiet zone is a SCANNING requirement that a
// printed sheet either meets or does not, and it is applied by two entirely
// separate printing paths - the browser print stylesheet (CSS padding around
// `#print-canvas`) and the hand-written PDF (`qr-print-pdf.ts`). Until r665
// the number was written out three times with nothing holding the copies
// together, while `qr-print-pdf.ts`'s own comment warned that two printing
// paths disagreeing about the quiet zone produce two DIFFERENT physical
// artefacts from one declared size - a code that measures 16 cm on one path
// and something else on the other, which silently corrupts the scale the
// visitor's pose solve is handed.
//
// The TypeScript sites now import one constant, so they cannot drift. A
// stylesheet cannot import, so this guard is what holds the rest. It follows
// `design-accent-copies.test.js`, the repo's existing pattern for "a literal
// that cannot read its source must still equal it".
//
// It also pins the ceiling's derivation, because that is where the number
// was previously invisible: `MAX_HOME_PRINTABLE_SIDE_M` was a bare
// `0.19 / 1.16`, in which the quiet zone appears only as the `.16` and no
// reader would find it by searching for the fraction.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

const SOURCE = 'GpsPlusSlamJs_AppFramework/src/utils/qr-payload/qr-quiet-zone.ts';
const PLAN = 'GpsPlusSlamJs_AppFramework/src/utils/qr-payload/qr-print-plan.ts';
const PDF = 'GpsPlusSlamJs_AppFramework/src/utils/qr-payload/qr-print-pdf.ts';

/** The single source: the exported fraction, read out of its declaration. */
function quietZoneFraction() {
  const m = /export const QR_QUIET_ZONE_FRACTION = ([0-9.]+);/.exec(
    read(SOURCE)
  );
  if (m === null) {
    throw new Error(`${SOURCE} must export QR_QUIET_ZONE_FRACTION as a literal`);
  }
  return Number(m[1]);
}

/**
 * Every app page that draws a quiet zone, DISCOVERED rather than listed.
 *
 * A hardcoded list is a comment claiming to be a mechanism: the next app
 * with a print stylesheet would be silently uncovered, which is the exact
 * failure this file exists to prevent (M1/M3 review #7).
 *
 * The discovery is one level deep - `<package>/index.html` - which covers
 * every app in this repo's layout and would NOT see print markup at a
 * nested path. Stated rather than widened: a glob over every HTML file in
 * the tree would read node_modules and build output, and the layout is a
 * repo convention with its own guards (PR #439 review).
 */
function printMarkupFiles() {
  return readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('GpsPlusSlam'))
    .map((entry) => `${entry.name}/index.html`)
    .filter((rel) => {
      try {
        return read(rel).includes('#print-quiet');
      } catch {
        return false; // no index.html in that package
      }
    });
}

describe('every copy of the QR quiet zone equals the one exported fraction', () => {
  const fraction = quietZoneFraction();
  const markup = printMarkupFiles();

  it('is a sane fraction at all (a guard against a typo becoming the source)', () => {
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(0.25);
  });

  it('finds no app page printing a code from its own stylesheet (PDF only)', () => {
    // Since the Tour Viewer's polish round M0b no page prints a code from
    // the browser's print dialog: its "fit to page" rescales, and a
    // rescaled code measures the world wrong (A10). The PDF writer is the
    // one printing path, and it imports the fraction (below). This keeps
    // the discovery in place, so a page that brings a print stylesheet back
    // fails here and has to be held to the fraction again - the copies this
    // file used to check per page (the scaled padding, no other padding,
    // the percentage in prose) went with the Tour Viewer's stylesheet.
    expect(markup).toEqual([]);
  });

  it('the PDF writer imports it rather than restating it', () => {
    const source = read(PDF);
    expect(source).toContain(
      "import { QR_QUIET_ZONE_FRACTION } from './qr-quiet-zone.js';"
    );
    expect(source).toContain(
      'const DEFAULT_QUIET_FRACTION = QR_QUIET_ZONE_FRACTION;'
    );
    // And no second literal sneaking back in.
    expect(source).not.toMatch(/DEFAULT_QUIET_FRACTION\s*=\s*[0-9]/);
  });

  it('the source module stays a leaf, so the PDF writer can stay one too', () => {
    // `qr-print-pdf.ts` is a hand-written writer that deliberately imports
    // nothing else. Putting the constant in `qr-print-plan.ts` would have
    // dragged the launch-URL builder, the dictionary codec and base32 into
    // it to read one float.
    expect(read(SOURCE)).not.toMatch(/^import /m);
  });

  it('the home-printable ceiling is derived from it, not from a baked factor', () => {
    const source = read(PLAN);
    expect(source).toContain(
      'HOME_PRINTABLE_WIDTH_M / QR_PRINT_FOOTPRINT_FACTOR'
    );
    // The old form. Its value is bit-identical at 0.08, so a revert to it
    // would pass every numeric test while making the number invisible again.
    expect(source).not.toContain('0.19 / 1.16');
  });
});
