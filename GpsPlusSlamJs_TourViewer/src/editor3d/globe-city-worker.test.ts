import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OVERPASS_ENDPOINTS,
  OSM_TILES_BASE_URL,
} from "gps-plus-slam-osm";

/** The worker scope the shell talks to, with every reply kept. */
function workerScope() {
  const posted: Record<string, unknown>[] = [];
  const scope: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: (message: unknown) => void;
  } = {
    onmessage: null,
    postMessage: (message) => posted.push(message as Record<string, unknown>),
  };
  vi.stubGlobal("self", scope);
  return { scope, posted };
}

const OVERPASS_HOSTS = new Set(
  DEFAULT_OVERPASS_ENDPOINTS.map((endpoint) => new URL(endpoint).hostname),
);
const TILES_HOST = new URL(OSM_TILES_BASE_URL).hostname;

/** An Overpass answer with nothing in it (as the host stores one). */
const EMPTY_ANSWER = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: "2026-11-01T00:00:00Z" },
  elements: [],
});

/**
 * The network as the worker sees it: every request recorded in order, the
 * tile host answering `tileHost` for a stored tile and 404 for a fill (a
 * refusal: the race at once), Overpass an empty answer, everything else
 * (the height tiles) 404.
 */
function network(tileHost: 200 | 404) {
  const asked: { host: string; method: string; path: string }[] = [];
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      asked.push({ host: url.hostname, method, path: url.pathname });
      if (url.hostname === TILES_HOST) {
        return Promise.resolve(
          method === "GET" && tileHost === 200
            ? new Response(EMPTY_ANSWER, { status: 200 })
            : new Response("nf", { status: 404 }),
        );
      }
      if (OVERPASS_HOSTS.has(url.hostname)) {
        return Promise.resolve(
          new Response(EMPTY_ANSWER, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("nf", { status: 404 }));
    },
  );
  return asked;
}

const LOAD = {
  kind: "load",
  id: 3,
  target: { lat: 47.3769, lng: 8.5417 },
  zoom: 12,
};

describe("globe-city-worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // Why: the shell is the only place the core meets the worker's message
  // loop; a load for a place that is not a place must come back as the
  // core's refusal (a failed city, then the end), so the page never waits
  // on a load that will not start. Nothing is fetched for it.
  it("wires the core to the worker's messages: a target that is no place is refused", async () => {
    const { scope, posted } = workerScope();
    await import("./globe-city-worker.js");
    expect(scope.onmessage).toBeTypeOf("function");
    scope.onmessage?.({
      data: {
        kind: "load",
        id: 7,
        target: { lat: Number.NaN, lng: 7 },
        zoom: 12,
      },
    });
    expect(posted).toEqual([
      expect.objectContaining({ id: 7, kind: "city", ok: false }),
      { id: 7, kind: "finished", outcome: "invalid-target" },
    ]);
  });

  // Why: the editor's city reads the project's own tile host before the
  // donated Overpass servers, as OsmDemo does. The Globe core asks the host
  // only when its app passes the base URL, so this shell is the one place
  // the editor opts in; without it every city load goes to the race. A 404
  // (not stored) and a refused fill must hand the tile to the race at once,
  // so a host without the tile costs the editor two requests and no wait.
  it("asks the project's tile host for a city tile before the Overpass race, which takes over on a 404", async () => {
    const { scope } = workerScope();
    const asked = network(404);
    await import("./globe-city-worker.js");
    scope.onmessage?.({ data: LOAD });
    await vi.waitFor(
      () => {
        expect(asked.some((r) => OVERPASS_HOSTS.has(r.host))).toBe(true);
      },
      { timeout: 10_000 },
    );
    scope.onmessage?.({ data: { kind: "abort", id: LOAD.id } });
    const firstHost = asked.findIndex((r) => r.host === TILES_HOST);
    const firstRace = asked.findIndex((r) => OVERPASS_HOSTS.has(r.host));
    expect(firstHost).toBeGreaterThanOrEqual(0);
    expect(firstHost).toBeLessThan(firstRace);
    const tile = asked[firstHost];
    expect(tile?.method).toBe("GET");
    expect(tile?.path).toMatch(/^\/osm\/v\d+\/[0-9a-f]{15}\.json\.gz$/);
    // The fill was asked for and refused before the race took the tile.
    const fill = asked.findIndex(
      (r) => r.host === TILES_HOST && r.method === "POST",
    );
    expect(fill).toBeGreaterThan(firstHost);
    expect(fill).toBeLessThan(firstRace);
  });

  // Why: the other half of the contract - a tile the host has stored is
  // read from it alone, so the donated servers are never asked for it.
  it("reads a stored tile from the host alone: the race is never asked", async () => {
    const { scope, posted } = workerScope();
    const asked = network(200);
    await import("./globe-city-worker.js");
    scope.onmessage?.({ data: LOAD });
    // A progress reply comes after a job settled: by then the first tile
    // has been answered.
    await vi.waitFor(
      () => {
        expect(posted.some((m) => m["kind"] === "progress")).toBe(true);
      },
      { timeout: 10_000 },
    );
    scope.onmessage?.({ data: { kind: "abort", id: LOAD.id } });
    expect(asked.some((r) => r.host === TILES_HOST)).toBe(true);
    expect(asked.some((r) => OVERPASS_HOSTS.has(r.host))).toBe(false);
  });
});
