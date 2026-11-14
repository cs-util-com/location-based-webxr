/**
 * A GLB written by hand, for the tests that need a broken file no glTF
 * writer would produce. Test support only.
 */

/** A GLB of `json` and `bin`, written by hand to make broken files. */
export function handGlb(json: object, bin = new Uint8Array(0)): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (text.length + 3) & ~3;
  const binLength = (bin.length + 3) & ~3;
  const total = 12 + 8 + jsonLength + (bin.length > 0 ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  if (bin.length > 0) {
    view.setUint32(20 + jsonLength, binLength, true);
    view.setUint32(24 + jsonLength, 0x004e4942, true);
    out.set(bin, 28 + jsonLength);
  }
  return out;
}

/** The first bytes of a 1x1 PNG (its signature and header chunk): enough
 *  for the tour's check to read an embedded image's size. */
export function pngHead(): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(36);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}

/** `count` buffer views of `pngHead` each, back to back. */
export function pngViews(count: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(36 * count);
  for (let i = 0; i < count; i++) out.set(pngHead(), 36 * i);
  return out;
}
