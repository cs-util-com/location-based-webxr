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
      readonly reason: "not-json" | "no-timestamp" | "remark" | "incomplete";
    };

const TIMESTAMP = /"timestamp_osm_base"\s*:\s*"([0-9TZ:-]{20})"/;
/** A top-level remark follows the closed elements array. */
const TOP_LEVEL_REMARK = /\]\s*,\s*"remark"\s*:/;
/** A complete answer ends with the elements array and the object closing. */
const COMPLETE_END = /\]\s*\}\s*$/;

export function checkOverpassBody(bytes: Uint8Array): BodyCheck {
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
  return { ok: true, osmBase: match[1] as string };
}
