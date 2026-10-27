/**
 * The landing's drawn code: a pattern that looks like a printed QR code
 * (21 x 21 modules, three finder squares) but encodes nothing, and the
 * small seeded generator that draws it. The film's poster and the cards'
 * pictures draw the same code.
 *
 * @see fake-code.ts.md
 */

/** A small xorshift generator in [0, 1): the same seed draws the same
 *  sequence. A seed of 0 (which would stay 0) is replaced. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 123456789;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** The modules on a side. */
export const FAKE_CODE_SIZE = 21;

/** The fake code's modules as one SVG path in a 21 x 21 box: about half
 *  the modules dark outside the three finder corners, which are drawn as
 *  a code's nested squares. The default seed is the one both pictures
 *  use. */
export function fakeCodePath(seed = Math.imul(8, 2654435761)): string {
  const n = FAKE_CODE_SIZE;
  const r = seededRandom(seed);
  const finder = (x: number, y: number): boolean =>
    (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!finder(x, y) && r() < 0.47) {
        d += `M${String(x)} ${String(y)}h1v1h-1z`;
      }
    }
  }
  for (const [fx, fy] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ] as const) {
    d += `M${String(fx)} ${String(fy)}h7v7h-7z`;
    d += `M${String(fx + 1)} ${String(fy + 1)}v5h5v-5z`;
    d += `M${String(fx + 2)} ${String(fy + 2)}h3v3h-3z`;
  }
  return d;
}
