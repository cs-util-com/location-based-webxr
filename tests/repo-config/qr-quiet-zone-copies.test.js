// Why this test matters: the QR quiet zone is a SCANNING requirement that a
// printed sheet either meets or does not, and it is applied by two entirely
// separate printing paths - the browser print stylesheet (CSS padding around
// `#print-canvas`) and the hand-written PDF (`qr-print-pdf.ts`). Until r665
// the number was written out three times with nothing holding the copies
// together, while `qr-print-pdf.ts`'s own comment warned that two printing
// paths disagreeing about the quiet zone produce two DIFFERENT physical
// artefacts from one declared size - a code that measures 16 cm on one path
// and something else on the other, which silently corrupts the PnP scale a
// visitor's pose solve depends on.
//
// The two TypeScript sites now import one exported constant, so they cannot
// drift. A stylesheet cannot import, so this guard is what holds the third.
// It follows `design-accent-copies.test.js`, the repo's existing pattern for
// "a literal that cannot read its source must still equal it".
//
// It also pins the ceiling's derivation, because that is where the number
// was previously invisible: `MAX_HOME_PRINTABLE_SIDE_M` was a bare
// `0.19 / 1.16`, in which the quiet zone appears only as the `.16` and no
// reader would find it by searching for the fraction.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

const PLAN = 'GpsPlusSlamJs_AppFramework/src/utils/qr-payload/qr-print-plan.ts';
const PDF = 'GpsPlusSlamJs_AppFramework/src/utils/qr-payload/qr-print-pdf.ts';
/** Every app whose print stylesheet draws the quiet zone itself. */
const PRINT_MARKUP = ['GpsPlusSlamJs_TourViewer/index.html'];

/** The single source: the exported fraction, read out of its declaration. */
function quietZoneFraction() {
  const m = /export const QR_QUIET_ZONE_FRACTION = ([0-9.]+);/.exec(read(PLAN));
  if (m === null) {
    throw new Error(`${PLAN} must export QR_QUIET_ZONE_FRACTION as a literal`);
  }
  return Number(m[1]);
}

describe('every copy of the QR quiet zone equals the one exported fraction', () => {
  const fraction = quietZoneFraction();

  it('is a sane fraction at all (a guard against a typo becoming the source)', () => {
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(0.25);
  });

  it.each(PRINT_MARKUP)("%s's #print-quiet padding uses it", (rel) => {
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

  it.each(PRINT_MARKUP)('%s states the same number in prose', (rel) => {
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
      "import { QR_QUIET_ZONE_FRACTION } from './qr-print-plan.js';"
    );
    expect(source).toContain(
      'const DEFAULT_QUIET_FRACTION = QR_QUIET_ZONE_FRACTION;'
    );
    // And no second literal sneaking back in.
    expect(source).not.toMatch(/DEFAULT_QUIET_FRACTION\s*=\s*[0-9]/);
  });

  it('the home-printable ceiling is derived from it, not from a baked factor', () => {
    const source = read(PLAN);
    expect(source).toContain(
      'HOME_PRINTABLE_WIDTH_M / (1 + 2 * QR_QUIET_ZONE_FRACTION)'
    );
    // The old form. Its value is bit-identical at 0.08, so a revert to it
    // would pass every numeric test while making the number invisible again.
    expect(source).not.toContain('0.19 / 1.16');
  });
});
