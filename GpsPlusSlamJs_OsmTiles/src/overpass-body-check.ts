/**
 * Whether raw Overpass bytes are a complete answer worth storing, judged
 * from the head and the tail only (no JSON.parse).
 *
 * @see overpass-body-check.ts.md
 */

/** Bytes of the start that must hold the `osm3s` block. */
export const BODY_HEAD_BYTES = 2048;

/** Bytes of the end that must show the closed elements array. */
export const BODY_TAIL_BYTES = 512;

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

/** Whether a body's tail carries Overpass's top-level remark. */
export function hasTopLevelRemark(tail: string): boolean {
  return TOP_LEVEL_REMARK.test(tail);
}

type HeadReason = "not-json" | "no-timestamp" | "future-timestamp";
type TailReason = "remark" | "incomplete";

/**
 * The head checks alone, for a body whose tail is not at hand (a gzip
 * answer, of which only the start is inflated): a JSON object carrying a
 * valid data timestamp no more than an hour after `now`.
 *
 * @param head - the decoded first BODY_HEAD_BYTES (or fewer) of the body.
 */
export function checkOverpassHead(
  head: string,
  now = Date.now(),
):
  | { readonly ok: true; readonly osmBase: string }
  | { readonly ok: false; readonly reason: HeadReason } {
  if (!head.trimStart().startsWith("{"))
    return { ok: false, reason: "not-json" };
  const match = TIMESTAMP.exec(head);
  if (match === null) return { ok: false, reason: "no-timestamp" };
  const osmBase = match[1] as string;
  const base = Date.parse(osmBase);
  // The pattern admits shapes that are no date (month 13): such a value
  // would pass the future check (NaN compares false) and become the age.
  if (!Number.isFinite(base)) return { ok: false, reason: "no-timestamp" };
  if (base > now + FUTURE_TOLERANCE_MS) {
    return { ok: false, reason: "future-timestamp" };
  }
  return { ok: true, osmBase };
}

/**
 * The tail checks alone: no top-level remark (a partial answer), and the
 * elements array closed as a complete answer closes it.
 *
 * @param tail - the decoded last BODY_TAIL_BYTES (or fewer) of the body.
 */
export function checkOverpassTail(
  tail: string,
): { readonly ok: true } | { readonly ok: false; readonly reason: TailReason } {
  if (hasTopLevelRemark(tail)) return { ok: false, reason: "remark" };
  if (!COMPLETE_END.test(tail)) return { ok: false, reason: "incomplete" };
  return { ok: true };
}

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
  const tailCheck = checkOverpassTail(tail);
  if (!tailCheck.ok) return tailCheck;
  return checkOverpassHead(head, now);
}
