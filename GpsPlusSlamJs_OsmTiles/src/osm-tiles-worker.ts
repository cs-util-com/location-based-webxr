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
import { dailyUpstreamCap, handleRequest } from "./routes";
import { parseTileCell } from "./tile-cell";

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

async function consumeOne(body: FillMessage, env: OsmTilesEnv): Promise<void> {
  const cell = parseTileCell(String(body.cell));
  if (cell === undefined || (body.kind !== "fill" && body.kind !== "refresh")) {
    console.log(JSON.stringify({ fill: "invalid-message", body }));
    return;
  }
  try {
    // Serial consumer: markers still flagged running belong to killed runs.
    await sweepPending(env.TILES, Date.now());
    await markPending(env.TILES, cell, Date.now(), true);
    const outcome = await fillTile(
      { cell, kind: body.kind, at: body.at },
      {
        bucket: env.TILES,
        fetchImpl: (input, init) => fetch(input, init),
        now: () => Date.now(),
        userAgent: env.USER_AGENT ?? DEFAULT_USER_AGENT,
        endpoints: DEFAULT_OVERPASS_ENDPOINTS,
        dailyUpstreamCap: dailyUpstreamCap(env),
        gzip: env.STORE_GZIP !== "false",
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
