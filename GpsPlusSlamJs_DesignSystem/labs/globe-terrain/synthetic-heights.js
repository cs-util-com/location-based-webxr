// Synthetic Terrarium heights for the globe and terrain-carrier pages and
// their smokes: generated in the page, so nothing leaves 127.0.0.1. One
// implementation for both pages (DEC-H3). See synthetic-heights.js.md.

const DEG = Math.PI / 180;

/** The URL template the pages hand the terrain carrier. */
export const SYNTHETIC_HEIGHTS_URL = "/globe-terrain-synthetic/{z}/{x}/{y}.png";

/**
 * A synthetic Terrarium tile: a 1 km plateau with ridges of about 5-50 km
 * (0-2,200 m) lowered by `seaM` (a coast where it goes below 0). Encoded
 * as Terrarium: h + 32768 = r * 256 + g + b / 256.
 */
export async function syntheticTile(z, x, y, seaM = 0) {
  const size = 256;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const n = 2 ** z;
  for (let py = 0; py < size; py++) {
    const merc = Math.PI * (1 - (2 * (y + (py + 0.5) / size)) / n);
    const lat = Math.atan(Math.sinh(merc)) / DEG;
    for (let px = 0; px < size; px++) {
      const lng = ((x + (px + 0.5) / size) / n) * 360 - 180;
      const h = Math.max(
        -seaM,
        1000 -
          seaM +
          900 *
            Math.sin((2 * Math.PI * lng) / 0.5) *
            Math.sin((2 * Math.PI * lat) / 0.4) +
          300 *
            Math.sin((2 * Math.PI * lng) / 0.07) *
            Math.cos((2 * Math.PI * lat) / 0.06),
      );
      const v = h + 32768;
      const i = 4 * (py * size + px);
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
export function installSyntheticHeights({ seaM = 0 } = {}) {
  const requests = [];
  let bytes = 0;
  const fetchOwn = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const synthetic = url.match(
      /\/globe-terrain-synthetic\/(\d+)\/(\d+)\/(\d+)\.png/,
    );
    const live = url.match(/\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    const m = synthetic ?? live;
    if (m) requests.push(`${m[1]}/${m[2]}/${m[3]}`);
    if (!synthetic) return fetchOwn(input, init);
    const [z, x, y] = synthetic.slice(1).map(Number);
    const blob = await syntheticTile(z, x, y, seaM);
    bytes += blob.size;
    return new Response(blob, { headers: { "Content-Type": "image/png" } });
  };
  return { requests, bytes: () => bytes };
}
