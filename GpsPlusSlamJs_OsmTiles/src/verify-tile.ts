/**
 * One verify of a reported tile, as the serial queue consumer runs it: the
 * stored bytes are judged here, never by the report, so a report never
 * deletes a good tile, and a bad one is deleted with a growing backoff.
 *
 * @see verify-tile.ts.md
 */

import type { FillMessage, TileBucket } from "./bindings";
import {
  BodyTooLarge,
  MAX_TILE_DECODED_BYTES,
  readBodyEnds,
  SourceReadError,
} from "./body-window";
import {
  clearVerified,
  readDaily,
  readVerified,
  recordBadTile,
  VERIFIED_TTL_MS,
  writeDaily,
  writeVerified,
} from "./fill-state";
import {
  BODY_HEAD_BYTES,
  BODY_TAIL_BYTES,
  hasTopLevelRemark,
} from "./overpass-body-check";
import { tileObjectKey } from "./tile-cell";

export interface VerifyDeps {
  readonly bucket: TileBucket;
  readonly now: () => number;
  /** Verifies one UTC day may run, all cells together. */
  readonly dailyVerifyCap: number;
  /** Decoded bytes at which the read stops and the tile is bad. */
  readonly maxDecodedBytes?: number;
}

export interface VerifyOutcome {
  readonly cell: string;
  readonly kind: "verify";
  readonly outcome:
    "missing" | "stale" | "verified" | "unfinished" | "cap" | "good" | "bad";
  /**
   * For `bad`: the check that failed (`encoding` for a gzip error,
   * `too-large` past the decoded bound).
   */
  readonly reason?: string;
  readonly wallMs: number;
}

/** Strong form of an ETag: the edge sends `W/"..."` for what it compressed. */
export function strongEtag(etag: string): string {
  return etag.startsWith("W/") ? etag.slice(2) : etag;
}

/**
 * What proves a stored tile bad, from its two ends, or undefined. Only
 * positive evidence counts, since a delete costs the operators a refill
 * and anyone can report: a head that is no JSON object, a top-level remark
 * (a partial answer), or an end that does not close the object at all.
 * The fill's stricter tail pattern (the layout Overpass writes today)
 * is not used here: a later layout must not get complete tiles deleted. A
 * body cut exactly after an element's closing brace passes; the client
 * still rejects it when it parses, and its report then refetches the tile.
 */
function storedTileFault(head: string, tail: string): string | undefined {
  if (!head.trimStart().startsWith("{")) return "not-json";
  if (hasTopLevelRemark(tail)) return "remark";
  if (!tail.trimEnd().endsWith("}")) return "incomplete";
  return undefined;
}

export async function verifyTile(
  message: FillMessage,
  deps: VerifyDeps,
): Promise<VerifyOutcome> {
  const started = deps.now();
  const done = (
    outcome: VerifyOutcome["outcome"],
    reason?: string,
  ): VerifyOutcome => ({
    cell: message.cell,
    kind: "verify",
    outcome,
    ...(reason === undefined ? {} : { reason }),
    wallMs: Math.max(0, deps.now() - started),
  });
  const { bucket, now } = deps;
  const key = tileObjectKey(message.cell);
  const object = await bucket.get(key);
  if (object === null) return done("missing");
  const discard = async (): Promise<void> => {
    await object.body.cancel().catch(() => undefined);
  };
  if (
    message.etag !== undefined &&
    strongEtag(message.etag) !== object.httpEtag
  ) {
    await discard();
    return done("stale");
  }
  const memo = await readVerified(bucket, message.cell);
  if (memo?.etag === object.httpEtag) {
    if (memo.state === "started") {
      // The last verify of this object never finished (the runtime killed
      // it); it would be killed again. The report endpoint refetches it.
      await discard();
      return done("unfinished");
    }
    if (now() - memo.at < VERIFIED_TTL_MS) {
      await discard();
      return done("verified");
    }
  }
  // Counted BEFORE the work, as fills count upstream requests: a verify the
  // runtime kills (CPU) still counts against the day's cap.
  const daily = await readDaily(bucket, now());
  if (daily.verifies >= deps.dailyVerifyCap) {
    await discard();
    return done("cap");
  }
  await writeDaily(bucket, now(), { ...daily, verifies: daily.verifies + 1 });
  await writeVerified(bucket, message.cell, object.httpEtag, now(), "started");

  const gzip = object.httpMetadata?.contentEncoding === "gzip";
  let reason: string | undefined;
  try {
    const ends = await readBodyEnds(
      object.body,
      gzip,
      BODY_HEAD_BYTES,
      BODY_TAIL_BYTES,
      deps.maxDecodedBytes ?? MAX_TILE_DECODED_BYTES,
      object.size,
    );
    const decoder = new TextDecoder();
    reason = storedTileFault(
      decoder.decode(ends.head),
      decoder.decode(ends.tail),
    );
  } catch (error) {
    // A failed read of the stored object is no evidence about the tile: no
    // verdict, and the memo stays `started`, so the next report refetches
    // the tile (`replace`) instead of deleting it.
    if (error instanceof SourceReadError) throw error;
    reason = error instanceof BodyTooLarge ? "too-large" : "encoding";
  }
  if (reason === undefined) {
    await writeVerified(bucket, message.cell, object.httpEtag, now());
    return done("good");
  }
  await bucket.delete(key);
  await clearVerified(bucket, message.cell);
  await recordBadTile(bucket, message.cell, now(), reason);
  return done("bad", reason);
}
