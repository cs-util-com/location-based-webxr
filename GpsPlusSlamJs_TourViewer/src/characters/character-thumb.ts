/**
 * A character's list thumbnail (head and upper body of the resting pose)
 * and the "made today, 14:05" line: one look for the maker's library and
 * the tour editor's Characters list.
 *
 * @see character-thumb.ts.md
 */

/** Head and upper body of the figure in `blob`, as a 112 x 144 PNG data
 *  URL; empty when the picture has no figure or cannot be drawn. */
export async function cropThumb(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const w = bmp.width;
  const h = bmp.height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, w, h).data;
  let top = h;
  let bottom = 0;
  let left = w;
  let right = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (d[(y * w + x) * 4 + 3]! > 128) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  const out = document.createElement("canvas");
  out.width = 112;
  out.height = 144;
  if (bottom > top) {
    const figH = bottom - top;
    const ch = figH * 0.62;
    const cw = (ch * 112) / 144;
    out
      .getContext("2d")
      ?.drawImage(
        c,
        (left + right) / 2 - cw / 2,
        top - figH * 0.05,
        cw,
        ch,
        0,
        0,
        112,
        144,
      );
  }
  return out.toDataURL("image/png");
}

/** When a character was made, in words, against `now`. */
export function whenMade(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const days = Math.floor((now.getTime() - t.getTime()) / 864e5);
  if (days < 1 && now.getDate() === t.getDate()) {
    const time = t.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `made today, ${time}`;
  }
  if (days < 2) return "made yesterday";
  return `made ${String(days)} days ago`;
}
