/**
 * Whether raw Overpass bytes are a complete answer worth storing, judged
 * from the head and the tail only (no JSON.parse).
 *
 * @see overpass-body-check.ts.md
 */

/** Bytes of the start that must hold the `osm3s` block. */
export const BODY_HEAD_BYTES = 2048;

/** Bytes of the end that must show the closed elements array. */
const BODY_TAIL_BYTES = 512;

export type BodyCheck =
  | { readonly ok: true; readonly osmBase: string }
  | {
      readonly ok: false;
      readonly reason:
        | "not-json"
        | "no-timestamp"
        | "future-timestamp"
        | "remark"
        | "incomplete";
    };

const TIMESTAMP = /"timestamp_osm_base"\s*:\s*"([0-9TZ:-]{20})"/;
/** A top-level remark follows the closed elements array. */
const TOP_LEVEL_REMARK = /\]\s*,\s*"remark"\s*:/;
/**
 * A complete answer's end: the elements array closing after a blank line,
 * then the object. An element's own arrays (`nodes`, `geometry`,
 * `members`) also close in `]` and `}`, but never after a blank line, so
 * a body cut right after such an element does not match.
 */
const COMPLETE_END = /\n[ \t]*\n[ \t]*\][ \t]*\n?\}\s*$/;

/** How far ahead of the Worker's clock a data timestamp may be. */
const FUTURE_TOLERANCE_MS = 3_600_000;

/**
 * @param now - epoch ms; a data timestamp more than an hour after it is
 *   refused (it would win every newer-than comparison and block refreshes).
 */
export function checkOverpassBody(
  bytes: Uint8Array,
  now = Date.now(),
): BodyCheck {
  const decoder = new TextDecoder();
  const head = decoder.decode(bytes.subarray(0, BODY_HEAD_BYTES));
  if (!head.trimStart().startsWith("{"))
    return { ok: false, reason: "not-json" };
  const tail = decoder.decode(
    bytes.subarray(Math.max(0, bytes.length - BODY_TAIL_BYTES)),
  );
  if (TOP_LEVEL_REMARK.test(tail)) return { ok: false, reason: "remark" };
  if (!COMPLETE_END.test(tail)) return { ok: false, reason: "incomplete" };
  const match = TIMESTAMP.exec(head);
  if (match === null) return { ok: false, reason: "no-timestamp" };
  const osmBase = match[1] as string;
  if (Date.parse(osmBase) > now + FUTURE_TOLERANCE_MS) {
    return { ok: false, reason: "future-timestamp" };
  }
  return { ok: true, osmBase };
}
