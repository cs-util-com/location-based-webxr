/**
 * Synthetic Terrarium heights for every page and suite that draws the
 * globe's relief without a network: the design system's globe and
 * terrain-carrier labs (generated in the page) and the apps' e2e (encoded
 * in Node by the workspace's Terrarium encoder,
 * `scripts/e2e/terrarium-png.mjs`). One surface for all of them, so a
 * suite that asserts a height reads the same ground the page draws.
 *
 * Test support only: production never imports it.
 */

const DEG = Math.PI / 180;

/** The URL template the labs hand the terrain carrier. */
export const SYNTHETIC_HEIGHTS_URL = "/globe-terrain-synthetic/{z}/{x}/{y}.png";

/**
 * The surface (m) at a place (degrees): a 1 km plateau with ridges of
 * about 5-50 km (0-2,200 m), lowered by `seaM` (a coast where it goes
 * below 0, which is clamped to the sea at 0).
 */
export function syntheticHeightM(latDeg: number, lngDeg: number, seaM = 0) {
  return Math.max(
    -seaM,
    1000 -
      seaM +
      900 *
        Math.sin((2 * Math.PI * lngDeg) / 0.5) *
        Math.sin((2 * Math.PI * latDeg) / 0.4) +
      300 *
        Math.sin((2 * Math.PI * lngDeg) / 0.07) *
        Math.cos((2 * Math.PI * latDeg) / 0.06),
  );
}

/**
 * The surface at the centre of pixel (`col`, `row`) of Web Mercator tile
 * `z/x/y`, `size` px square. RangeError for a tile or pixel outside the
 * pyramid.
 */
export function syntheticPixelHeightM(
  tile: { z: number; x: number; y: number },
  col: number,
  row: number,
  { size = 256, seaM = 0 }: { size?: number; seaM?: number } = {},
): number {
  const { z, x, y } = tile;
  const n = 2 ** z;
  const inside = (v: number, max: number) =>
    Number.isInteger(v) && v >= 0 && v < max;
  if (
    !(Number.isInteger(z) && z >= 0) ||
    !inside(x, n) ||
    !inside(y, n) ||
    !inside(col, size) ||
    !inside(row, size)
  ) {
    throw new RangeError(
      `no pixel ${col},${row} of ${size} px tile ${z}/${x}/${y}`,
    );
  }
  const merc = Math.PI * (1 - (2 * (y + (row + 0.5) / size)) / n);
  const lat = Math.atan(Math.sinh(merc)) / DEG;
  const lng = ((x + (col + 0.5) / size) / n) * 360 - 180;
  return syntheticHeightM(lat, lng, seaM);
}

/**
 * A synthetic Terrarium tile as a PNG, made in a page (`OffscreenCanvas`):
 * h + 32768 = r * 256 + g + b / 256. `size` px square (256, AWS
 * Terrarium's; a smoke serving Mapterhorn's tiles asks for 512).
 */
export async function syntheticTile(
  z: number,
  x: number,
  y: number,
  seaM = 0,
  size = 256,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D context for a synthetic tile");
  const img = ctx.createImageData(size, size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const h = syntheticPixelHeightM({ z, x, y }, col, row, { size, seaM });
      const v = h + 32768;
      const i = 4 * (row * size + col);
      img.data[i] = Math.floor(v / 256);
      img.data[i + 1] = Math.floor(v) % 256;
      img.data[i + 2] = Math.floor((v - Math.floor(v)) * 256);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * Serves `SYNTHETIC_HEIGHTS_URL` from the page (wrapping `window.fetch`)
 * and records every height tile asked for, synthetic or the live
 * Terrarium's (`z/x/y`). Returns the record: `requests` and the synthetic
 * PNGs' `bytes()`.
 */
export function installSyntheticHeights({ seaM = 0 } = {}): {
  requests: string[];
  bytes: () => number;
} {
  const requests: string[] = [];
  let bytes = 0;
  const fetchOwn = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const synthetic =
      /\/globe-terrain-synthetic\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
    const live = /\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
    const m = synthetic ?? live;
    if (m) requests.push(`${m[1]}/${m[2]}/${m[3]}`);
    if (!synthetic) return fetchOwn(input, init);
    const [z, x, y] = synthetic.slice(1).map(Number) as [
      number,
      number,
      number,
    ];
    const blob = await syntheticTile(z, x, y, seaM);
    bytes += blob.size;
    return new Response(blob, { headers: { "Content-Type": "image/png" } });
  };
  return { requests, bytes: () => bytes };
}
