/**
 * The `osm-tiles` Worker entry (wrangler.toml `main`): the HTTP routes and
 * the serial queue consumer that fills tiles.
 *
 * @see osm-tiles-worker.ts.md
 */

import { DEFAULT_OVERPASS_ENDPOINTS } from "gps-plus-slam-osm/source/overpass-source";
import type { FillMessage, OsmTilesEnv } from "./bindings";
import { clearPending, markPending, sweepPending } from "./fill-state";
import { fillTile } from "./fill-tile";
import { dailyUpstreamCap, dailyVerifyCap, handleRequest } from "./routes";
import { parseTileCell } from "./tile-cell";
import { verifyTile } from "./verify-tile";

/** Sent to the operators when the `USER_AGENT` var is unset. */
const DEFAULT_USER_AGENT =
  "gps-plus-slam osm-tiles (+https://github.com/cs-util-com/location-based-webxr)";

export interface QueueBatch {
  readonly messages: readonly {
    readonly body: FillMessage;
    ack(): void;
  }[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A verify reads and may delete the stored tile; it is no fill, so it
 * neither marks nor clears the cell's pending marker (a fill of the same
 * cell may be queued behind it).
 */
async function verifyOne(
  cell: string,
  body: FillMessage,
  env: OsmTilesEnv,
): Promise<void> {
  try {
    const outcome = await verifyTile(
      {
        cell,
        kind: "verify",
        at: body.at,
        ...(typeof body.etag === "string" ? { etag: body.etag } : {}),
      },
      {
        bucket: env.TILES,
        now: () => Date.now(),
        dailyVerifyCap: dailyVerifyCap(env),
      },
    );
    console.log(JSON.stringify({ verify: outcome }));
  } catch (error) {
    console.log(
      JSON.stringify({ verify: "error", cell, error: describeError(error) }),
    );
  }
}

async function consumeOne(body: FillMessage, env: OsmTilesEnv): Promise<void> {
  const cell = parseTileCell(String(body.cell));
  const kind = body.kind;
  if (
    cell === undefined ||
    (kind !== "fill" && kind !== "refresh" && kind !== "verify")
  ) {
    console.log(JSON.stringify({ fill: "invalid-message", body }));
    return;
  }
  if (kind === "verify") {
    await verifyOne(cell, body, env);
    return;
  }
  try {
    // Serial consumer: markers still flagged running belong to killed runs.
    await sweepPending(env.TILES, Date.now());
    await markPending(env.TILES, cell, Date.now(), true);
    const outcome = await fillTile(
      { cell, kind, at: body.at },
      {
        bucket: env.TILES,
        fetchImpl: (input, init) => fetch(input, init),
        now: () => Date.now(),
        userAgent: env.USER_AGENT ?? DEFAULT_USER_AGENT,
        endpoints: DEFAULT_OVERPASS_ENDPOINTS,
        dailyUpstreamCap: dailyUpstreamCap(env),
      },
    );
    // One line per fill: what `wrangler tail` and the dashboard logs show.
    console.log(JSON.stringify({ fill: outcome }));
  } catch (error) {
    console.log(
      JSON.stringify({ fill: "error", cell, error: describeError(error) }),
    );
  } finally {
    await clearPending(env.TILES, cell).catch(() => undefined);
  }
}

export default {
  fetch(request: Request, env: OsmTilesEnv): Promise<Response> {
    return handleRequest(request, { env, now: () => Date.now() });
  },

  /**
   * Serial by configuration (`max_batch_size = 1`, `max_concurrency = 1`),
   * and every message is acknowledged: a failed tile is retried only through
   * its failure record, never by the queue re-sending the same request.
   */
  async queue(batch: QueueBatch, env: OsmTilesEnv): Promise<void> {
    for (const message of batch.messages) {
      await consumeOne(message.body, env);
      message.ack();
    }
  },
};
