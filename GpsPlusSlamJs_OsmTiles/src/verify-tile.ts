/**
 * One verify of a reported tile, as the serial queue consumer runs it: the
 * stored bytes are judged here, never by the report, so a good tile survives
 * any number of reports and a bad one is deleted with a growing backoff.
 *
 * @see verify-tile.ts.md
 */

import type { FillMessage, TileBucket } from "./bindings";
import { readBodyEnds } from "./body-window";
import {
  clearVerified,
  readDaily,
  readVerifiedEtag,
  recordBadTile,
  writeDaily,
  writeVerified,
} from "./fill-state";
import {
  BODY_HEAD_BYTES,
  BODY_TAIL_BYTES,
  checkOverpassHead,
  checkOverpassTail,
} from "./overpass-body-check";
import { tileObjectKey } from "./tile-cell";

export interface VerifyDeps {
  readonly bucket: TileBucket;
  readonly now: () => number;
  /** Verifies one UTC day may run, all cells together. */
  readonly dailyVerifyCap: number;
}

export interface VerifyOutcome {
  readonly cell: string;
  readonly kind: "verify";
  readonly outcome: "missing" | "stale" | "verified" | "cap" | "good" | "bad";
  /** For `bad`: the check that failed (`encoding` for a gzip error). */
  readonly reason?: string;
  readonly wallMs: number;
}

/** Strong form of an ETag: the edge sends `W/"..."` for what it compressed. */
export function strongEtag(etag: string): string {
  return etag.startsWith("W/") ? etag.slice(2) : etag;
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
  if ((await readVerifiedEtag(bucket, message.cell)) === object.httpEtag) {
    await discard();
    return done("verified");
  }
  // Counted BEFORE the work, as fills count upstream requests: a verify the
  // runtime kills (CPU) still counts against the day's cap.
  const daily = await readDaily(bucket, now());
  if (daily.verifies >= deps.dailyVerifyCap) {
    await discard();
    return done("cap");
  }
  await writeDaily(bucket, now(), { ...daily, verifies: daily.verifies + 1 });

  const gzip = object.httpMetadata?.contentEncoding === "gzip";
  let reason: string | undefined;
  try {
    const ends = await readBodyEnds(
      object.body,
      gzip,
      BODY_HEAD_BYTES,
      BODY_TAIL_BYTES,
    );
    const decoder = new TextDecoder();
    const tail = checkOverpassTail(decoder.decode(ends.tail));
    // The tile's own age is not judged against today's clock here: only a
    // head without a valid timestamp is bad (Infinity: never "future").
    const head = checkOverpassHead(
      decoder.decode(ends.head),
      Number.POSITIVE_INFINITY,
    );
    if (!head.ok) reason = head.reason;
    else if (!tail.ok) reason = tail.reason;
  } catch {
    reason = "encoding";
  }
  if (reason === undefined) {
    await writeVerified(bucket, message.cell, object.httpEtag);
    return done("good");
  }
  await bucket.delete(key);
  await clearVerified(bucket, message.cell);
  await recordBadTile(bucket, message.cell, now(), reason);
  return done("bad", reason);
}
