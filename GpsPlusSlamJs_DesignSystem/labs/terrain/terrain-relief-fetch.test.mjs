/**
 * Tests for the relief region's tile fetch, shared by the terrain lab and
 * the globe lab's detail region.
 *
 * Why this file matters: a region is a batch of tiles, and one tile that
 * fails (an HTTP error, a network error, a timeout) must become a gap the
 * pipeline marks as no data, never a rejected batch that loses the rest.
 * The URL must be the template's, so the synthetic heights' route serves
 * the smokes and the live tiles serve the page.
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import {
  TILE_TIMEOUT_MS,
  fetchTerrariumTiles,
} from "./terrain-relief-fetch.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchTerrariumTiles", () => {
  it("fills the template, keeps each tile's bytes and makes every failure a gap", async () => {
    const asked = [];
    globalThis.fetch = async (url, init) => {
      asked.push(url);
      assert.ok(init.signal instanceof AbortSignal, "bounded by a timeout");
      if (url.endsWith("/8/1/2.png")) throw new TypeError("network down");
      if (url.endsWith("/8/2/2.png")) return new Response("", { status: 404 });
      return new Response(new Uint8Array([1, 2, 3]));
    };
    const progress = [];
    const out = await fetchTerrariumTiles(
      [
        { z: 8, x: 0, y: 2 },
        { z: 8, x: 1, y: 2 },
        { z: 8, x: 2, y: 2 },
      ],
      "/h/{z}/{x}/{y}.png",
      (done) => progress.push(done),
    );
    assert.deepEqual(asked, ["/h/8/0/2.png", "/h/8/1/2.png", "/h/8/2/2.png"]);
    assert.equal(out[0].bytes.byteLength, 3);
    assert.equal(out[0].url, "/h/8/0/2.png");
    assert.equal(out[1].bytes, null);
    assert.equal(out[2].bytes, null);
    assert.deepEqual(
      out.map(({ z, x, y }) => [z, x, y]),
      [
        [8, 0, 2],
        [8, 1, 2],
        [8, 2, 2],
      ],
    );
    assert.deepEqual(progress.sort(), [1, 2, 3]);
  });

  it("bounds every request at 30 s", () => {
    assert.equal(TILE_TIMEOUT_MS, 30_000);
  });
});
