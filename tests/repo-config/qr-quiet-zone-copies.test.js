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

  it('finds at least one app drawing it, so the discovery cannot pass vacuously', () => {
    // Without this, a rename that stopped matching `#print-quiet` would turn
    // every assertion below into zero assertions, and the suite would go
    // green by looking at nothing.
    expect(markup.length).toBeGreaterThan(0);
  });

  it.each(markup)("%s's #print-quiet padding uses it", (rel) => {
    // `#print-quiet` is styled TWICE - a screen rule with a fixed padding,
    // and the @media print rule that scales it by the printed side. Only the
    // second is the quiet zone, so every block is scanned and the one
    // carrying a calc() is the one under test.
    const bodies = [...read(rel).matchAll(/#print-quiet\s*\{([^}]*)\}/g)].map(
      (block) => block[1]
    );
    const scaled = bodies
      .map((body) => /padding:\s*calc\(.*?\*\s*([0-9.]+)\s*\)\s*;/.exec(body))
      .filter((m) => m !== null);
    expect(
      scaled.length,
      `${rel} must scale #print-quiet's padding by the printed side, exactly once`
    ).toBe(1);
    expect(Number(scaled[0][1])).toBe(fraction);
  });

  it.each(markup)('%s adds no OTHER padding around the printed code', (rel) => {
    // The guard pins one declaration; the artefact is the sum of every
    // declaration. A second scaled padding on an enclosing element would
    // change the physical size while leaving this file green - the same
    // class of divergence it exists to prevent (M1/M3 review #7).
    const scaledPaddings = [
      ...read(rel).matchAll(
        /([#.][\w-]+)\s*\{[^}]*padding:\s*calc\([^;]*var\(--print-side[^;]*;/g
      ),
    ].map((m) => m[1]);
    expect(scaledPaddings).toEqual(['#print-quiet']);
  });

  it.each(markup)('%s states the same number in prose', (rel) => {
    // The comment above the print block explains WHY a 20 cm code does not
    // fit on A4, and quotes the fraction as a percentage. A comment that
    // contradicts the constant is exactly how the version-25 arithmetic
    // error started, so the prose is pinned too.
    const m = /quiet zone \(([0-9.]+)% of the side on each/.exec(read(rel));
    expect(m, `${rel} must state the quiet zone as a percentage`).not.toBeNull();
    expect(Number(m[1]) / 100).toBe(fraction);
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
