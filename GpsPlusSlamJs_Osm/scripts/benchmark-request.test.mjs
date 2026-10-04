import { describe, expect, it } from "vitest";
import { measureRequest } from "./benchmark-request.mjs";

const options = {
  url: "https://example.test/api/interpreter",
  query: "[out:json];out;",
};
const jsonResponse = (body) => new Response(JSON.stringify(body));
const run = (body) =>
  measureRequest(options, { fetchImpl: async () => jsonResponse(body) });

describe("measureRequest", () => {
  // WHY: HTTP 200 alone accepts Overpass runtime failures as fast successes.
  it("accepts empty elements but rejects runtime remarks, HTML and HTTP errors", async () => {
    expect((await run({ elements: [] })).ok).toBe(true);
    expect(
      (await run({ elements: [], remark: "runtime error: timeout" })).ok,
    ).toBe(false);
    expect(
      (
        await measureRequest(options, {
          fetchImpl: async () => new Response("<html>failure</html>"),
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await measureRequest(options, {
          fetchImpl: async () => new Response("{}", { status: 429 }),
        })
      ).httpStatus,
    ).toBe(429);
    expect((await run({})).ok).toBe(false);
  });

  // WHY: only the POST encoding should differ between the transport arms.
  it("sends raw or form data with the same headers", async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => {
      requests.push(init);
      return jsonResponse({ elements: [] });
    };
    await measureRequest({ ...options, encoding: "raw" }, { fetchImpl });
    await measureRequest(options, { fetchImpl });
    expect(requests[0].body).toBe(options.query);
    expect(String(requests[1].body)).toBe(
      new URLSearchParams({ data: options.query }).toString(),
    );
    expect(requests[0].headers).toEqual(requests[1].headers);
  });

  // WHY: timestamps and server element ordering must not masquerade as data loss.
  it("hashes canonical elements while retaining the OSM timestamp", async () => {
    const a = await run({
      osm3s: { timestamp_osm_base: "first" },
      elements: [
        { type: "node", id: 2, tags: { b: "b", a: "a" } },
        { type: "way", id: 1 },
      ],
    });
    const b = await run({
      osm3s: { timestamp_osm_base: "second" },
      elements: [
        { id: 1, type: "way" },
        { tags: { a: "a", b: "b" }, id: 2, type: "node" },
      ],
    });
    expect(a.semanticHash).toBe(b.semanticHash);
    expect(a.osmTimestamp).toBe("first");
    expect(a.counts).toEqual({ node: 1, way: 1, relation: 0 });
    expect(
      (await run({ elements: [{ type: "node", id: 3 }] })).semanticHash,
    ).not.toBe(a.semanticHash);
  });

  // WHY: a stalled body must not escape the request deadline after headers arrive.
  it("bounds a stalled body and retains partial bytes", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    const result = await measureRequest(
      { ...options, timeoutMs: 20 },
      { fetchImpl: async () => new Response(stream) },
    );
    expect(result.ok).toBe(false);
    expect(result.bytes).toBe(1);
    expect(result.error).toMatch(/deadline/i);
  });

  // WHY: a fetch which never returns headers must also obey the client deadline.
  it("bounds a stalled connection before headers", async () => {
    let signal;
    const result = await measureRequest(
      { ...options, timeoutMs: 20 },
      {
        fetchImpl: (_url, init) => {
          signal = init.signal;
          return new Promise(() => {});
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.headersMs).toBeNull();
    expect(signal.aborted).toBe(true);
  });

  // WHY: caps must cancel the reader before consuming further chunks.
  it("cancels oversized bodies and preserves network causes", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await measureRequest(
      { ...options, maxBytes: 4 },
      { fetchImpl: async () => new Response(stream) },
    );
    expect(result.ok).toBe(false);
    expect(result.bytes).toBe(5);
    expect(cancelled).toBe(true);
    const failed = await measureRequest(options, {
      fetchImpl: async () => {
        throw new Error("fetch failed", { cause: { code: "ECONNRESET" } });
      },
    });
    expect(failed.error).toContain("ECONNRESET");
  });
});
