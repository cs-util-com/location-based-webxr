/**
 * Racing two operators for one tile.
 *
 * WHY THIS EXISTS. Measured 2026-09-21 on the production res-7 query: within
 * the shipped 45 s deadline, one attempt at a time served **4 of 9** tiles at a
 * 32.2 s median, while racing two distinct operators served **7 of 9** at
 * 27.0 s. Most of that is the success rate rather than the latency - in 3 of
 * the 9 races the first-drawn operator failed outright, and there the race did
 * not make the tile faster, it made the tile arrive.
 *
 * THE FIRST ATTEMPT AT THIS BROKE A GUARD AND WAS REVERTED, which is why the
 * first test below is the one about concurrency rather than the one about
 * winning. `maxConcurrent` gates TILES, so a racing tile silently made two
 * requests against a budget that thought it had made one - a client configured
 * for two in-flight requests made four, against donated servers whose
 * advertised `Rate limit: 2` is what that number was sized from. The race now
 * takes a second unit of that same budget and simply does not race when there
 * is none.
 *
 * Tests that are NOT about racing pin a single-endpoint pool, which makes a
 * race impossible - see `overpass-source.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { latLngToCell } from "h3-js";

import { OverpassSource } from "./overpass-source.js";
import { FETCH_RES } from "../spatial/resolutions.js";

const TILE = latLngToCell(50.9231, 6.9445, FETCH_RES);

/** Two operators, which is the minimum a race needs. */
const TWO_OPERATORS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const OK_BODY = JSON.stringify({ elements: [] });

function jsonResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeSource(
  fetchImpl: ReturnType<typeof vi.fn>,
  overrides: Partial<ConstructorParameters<typeof OverpassSource>[0]> = {},
) {
  return new OverpassSource({
    userAgent: "gps-plus-slam-osm-tests/1.0 (+https://example.invalid)",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    random: () => 0,
    now: () => 1_000_000,
    sleepImpl: () => Promise.resolve(),
    endpoints: TWO_OPERATORS,
    ...overrides,
  });
}

/** The host part of a request URL, for asserting WHO was asked. */
function hostsHit(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map((call) => new URL(String(call[0])).host);
}

describe("the race never exceeds the client's own concurrency budget", () => {
  it("keeps in-flight requests at or below `maxConcurrent`, racing included", async () => {
    // THE GUARD THAT REVERTED THE FIRST ATTEMPT. It is first in the file
    // deliberately: this number was sized against what the servers advertise,
    // and exceeding it is how one client gets an operator to block every user
    // of this library.
    let concurrent = 0;
    let peak = 0;
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          concurrent++;
          peak = Math.max(peak, concurrent);
          setTimeout(() => {
            concurrent--;
            resolve(jsonResponse(OK_BODY));
          }, 0);
        }),
    );
    const source = makeSource(fetchImpl, { maxConcurrent: 2 });

    const tiles = [
      TILE,
      latLngToCell(48.137, 11.575, FETCH_RES),
      latLngToCell(53.55, 9.99, FETCH_RES),
    ];
    await Promise.all(tiles.map((tile) => source.fetchTile(tile)));

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("does NOT race when there is no spare concurrency", async () => {
    // A consumer who configured one in-flight request gets one, not two. This
    // is also why the extra unit is taken opportunistically rather than by
    // making the gate weighted: a weight of two against a cap of one would
    // wait forever on a queue nothing can drain.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const source = makeSource(fetchImpl, { maxConcurrent: 1 });

    await source.fetchTile(TILE);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("what the race actually does", () => {
  it("asks TWO DISTINCT operators at once", async () => {
    // Same-host concurrency is refused - measured in three independent runs
    // (1/9, 1/4, 1/9). `planEndpointOrder` returns distinct operators first,
    // and the race asserts that rather than trusting it, because a later
    // change to the draw would otherwise land us in the one arrangement every
    // measurement says does not work.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => new Promise<Response>(() => {}));
    const source = makeSource(fetchImpl, { maxConcurrent: 2 });

    void source.fetchTile(TILE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const hosts = hostsHit(fetchImpl);
    expect(hosts).toHaveLength(2);
    expect(new Set(hosts).size).toBe(2);
  });

  it("returns the FIRST answer and cancels the other", async () => {
    // The loser's cancellation must not be mistaken for the caller's abort,
    // which is why each racer gets a private controller. If it were, a race
    // would surface as "the user navigated away" and the tile would be
    // silently missing.
    const aborted: boolean[] = [];
    const fetchImpl = vi
      .fn()
      .mockImplementation((url: string, init: RequestInit) => {
        const slow = String(url).includes("maps.mail.ru");
        if (!slow) return Promise.resolve(jsonResponse(OK_BODY));
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted.push(true);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });
    const source = makeSource(fetchImpl, { maxConcurrent: 2 });

    const result = await source.fetchTile(TILE);

    expect(result.tile).toBe(TILE);
    expect(aborted).toEqual([true]);
  });

  it("records BOTH requests, so quota use is not understated", async () => {
    // `stats.requests` and the attempt log are what this client's load on
    // donated infrastructure is read from. A race that reported one request
    // would make the thing we are being careful about invisible.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const source = makeSource(fetchImpl, { maxConcurrent: 2 });

    await source.fetchTile(TILE);

    expect(source.stats.requests).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("still serves the tile when the FIRST-drawn operator fails", async () => {
    // The measured win, in miniature: in 3 of 9 races the first-drawn operator
    // failed outright and the race is what made the tile arrive at all.
    const fetchImpl = vi
      .fn()
      .mockImplementation((url: string) =>
        String(url).includes("lz4")
          ? Promise.resolve(new Response("upstream error", { status: 504 }))
          : Promise.resolve(jsonResponse(OK_BODY)),
      );
    const source = makeSource(fetchImpl, { maxConcurrent: 2 });

    const result = await source.fetchTile(TILE);

    expect(result.tile).toBe(TILE);
  });
});
