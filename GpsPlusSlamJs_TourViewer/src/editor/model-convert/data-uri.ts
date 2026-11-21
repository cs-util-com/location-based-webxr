/**
 * A base64 `data:` URI decoded to its bytes, with the decoded size checked
 * against a cap from the URI's length alone, before anything is decoded.
 * glTF allows only base64 data URIs, and a `.gltf` is untrusted text, so
 * anything else (percent-encoded data, stray characters, misplaced
 * padding) is refused rather than decoded leniently. Pure: no I/O, never
 * throws.
 *
 * @see data-uri.ts.md
 */

export type DataUriRead =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array<ArrayBuffer>;
      /** The MIME type before any `;parameter`, possibly empty. */
      readonly mime: string;
    }
  | { readonly ok: false; readonly why: "malformed" | "too-large" };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** How many bytes a strict base64 `payload` decodes to (its length must be
 *  a multiple of 4; padding counted off). */
export function decodedLengthOf(payload: string): number {
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
}

/** `uri`'s bytes, when it is a base64 `data:` URI of at most `maxBytes`
 *  decoded bytes. */
export function decodeDataUri(uri: string, maxBytes: number): DataUriRead {
  if (typeof uri !== "string" || !uri.startsWith("data:")) {
    return { ok: false, why: "malformed" };
  }
  const comma = uri.indexOf(",");
  if (comma < 0) return { ok: false, why: "malformed" };
  const header = uri.slice(5, comma).split(";");
  if (header.length < 2 || header[header.length - 1] !== "base64") {
    return { ok: false, why: "malformed" };
  }
  const payload = uri.slice(comma + 1);
  if (payload.length % 4 !== 0) return { ok: false, why: "malformed" };
  if (decodedLengthOf(payload) > maxBytes) {
    return { ok: false, why: "too-large" };
  }
  if (!BASE64.test(payload)) return { ok: false, why: "malformed" };
  let text: string;
  try {
    text = atob(payload);
  } catch {
    return { ok: false, why: "malformed" };
  }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return { ok: true, bytes, mime: header[0] ?? "" };
}
