/**
 * A base64 `data:` URI decoded to its bytes, with the decoded size checked
 * against a cap from the URI's length alone, before anything is decoded.
 * glTF allows only base64 data URIs, and a model's text is untrusted, so
 * anything else (percent-encoded data, stray characters, misplaced or
 * missing padding) is refused rather than decoded leniently. Pure: no
 * I/O, never throws.
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
  | { readonly ok: false; readonly why: 'malformed' }
  | {
      readonly ok: false;
      readonly why: 'too-large';
      /** The bytes the payload would decode to. */
      readonly size: number;
    };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** How many bytes a strict base64 `payload` decodes to (its length must be
 *  a multiple of 4; padding counted off). */
export function decodedLengthOf(payload: string): number {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
}

/** A base64 `data:` URI's MIME type and payload (a whole number of base64
 *  quads), or null for any other text. */
function base64Parts(uri: unknown): { mime: string; payload: string } | null {
  if (typeof uri !== 'string' || !uri.startsWith('data:')) return null;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const header = uri.slice(5, comma).split(';');
  if (header.length < 2 || header[header.length - 1] !== 'base64') return null;
  const payload = uri.slice(comma + 1);
  return payload.length % 4 === 0 ? { mime: header[0] ?? '', payload } : null;
}

/** `uri`'s bytes, when it is a base64 `data:` URI of at most `maxBytes`
 *  decoded bytes. */
export function decodeDataUri(uri: string, maxBytes: number): DataUriRead {
  const parts = base64Parts(uri);
  if (parts === null) return { ok: false, why: 'malformed' };
  const { mime, payload } = parts;
  const size = decodedLengthOf(payload);
  if (size > maxBytes) return { ok: false, why: 'too-large', size };
  if (!BASE64.test(payload)) return { ok: false, why: 'malformed' };
  let text: string;
  try {
    text = atob(payload);
  } catch {
    return { ok: false, why: 'malformed' };
  }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return { ok: true, bytes, mime };
}
