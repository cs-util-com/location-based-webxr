import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  handleModelMirror,
  MIRRORED_MODELS,
  MODEL_MIRROR_PREFIX,
} from "./model-mirror";

const NAME = "sift-lightglue-3.13.0.onnx";
const PINNED = MIRRORED_MODELS[NAME]!;

function upstream(body: string, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  return {
    calls,
    fetch: (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(body, { headers }));
    },
  };
}

const req = (path: string, method = "GET") =>
  new Request(`https://site.test${path}`, { method });

// Why these tests matter: this route makes a public worker fetch from the
// internet on request, so it must only ever fetch the pinned files, and
// must not pass on a file of the wrong size as the model.
describe("handleModelMirror", () => {
  it("streams the pinned file as an immutable download", async () => {
    const up = upstream("model bytes", {
      "content-length": String(PINNED.bytes),
    });
    const r = await handleModelMirror(
      req(`${MODEL_MIRROR_PREFIX}${NAME}`),
      up.fetch,
    );
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("model bytes");
    expect(up.calls.map((c) => c.url)).toEqual([PINNED.upstream]);
    expect(r.headers.get("cache-control")).toContain("immutable");
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
  });

  // Why: an edge cache told to keep everything for a year could keep a
  // redirect to an expiring signed URL, or an upstream error, for a year.
  // The browser caches the immutable answer; the edge is not asked to.
  it("asks no edge cache to keep the upstream answer", async () => {
    const up = upstream("x", { "content-length": String(PINNED.bytes) });
    await handleModelMirror(req(`${MODEL_MIRROR_PREFIX}${NAME}`), up.fetch);
    expect(up.calls[0]!.init).not.toHaveProperty("cf");
  });

  it("names the release in the route, so an immutable URL always means the same bytes", () => {
    expect(Object.keys(MIRRORED_MODELS)).toEqual([
      "sift-lightglue-3.13.0.onnx",
    ]);
    expect(PINNED.upstream).toContain("/download/3.13.0/");
  });

  // Why: the names one character away from an allowed one, an encoded
  // letter and the object prototype's own keys must all stay unknown.
  it.each([
    "sift-lightglue-3.13.0.onnx.bak",
    "SIFT-LIGHTGLUE-3.13.0.ONNX",
    "sift-lightglue-3.13.0.onnx/",
    "%73ift-lightglue-3.13.0.onnx",
    "sift-lightglue.onnx",
    "__proto__",
    "constructor",
    "hasOwnProperty",
  ])(
    "answers 404 for the near miss %s without an upstream request",
    async (name) => {
      const up = upstream("x");
      const r = await handleModelMirror(
        req(`${MODEL_MIRROR_PREFIX}${name}`),
        up.fetch,
      );
      expect(r.status).toBe(404);
      expect(up.calls).toEqual([]);
    },
  );

  // Why: with no upstream content-length the size was never checked, so
  // the answer must not claim the pinned size either; the page's sha256
  // check still guards the bytes.
  it("claims no size the upstream did not send", async () => {
    const r = await handleModelMirror(
      req(`${MODEL_MIRROR_PREFIX}${NAME}`),
      upstream("model bytes").fetch,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBeNull();
    expect(await r.text()).toBe("model bytes");
    const pinned = await handleModelMirror(
      req(`${MODEL_MIRROR_PREFIX}${NAME}`),
      upstream("x", { "content-length": String(PINNED.bytes) }).fetch,
    );
    expect(pinned.headers.get("content-length")).toBe(String(PINNED.bytes));
  });

  it("answers HEAD without a body", async () => {
    const up = upstream("x");
    const r = await handleModelMirror(
      req(`${MODEL_MIRROR_PREFIX}${NAME}`, "HEAD"),
      up.fetch,
    );
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
    expect(up.calls[0]!.init?.method).toBe("HEAD");
  });

  it("refuses other methods and a wrong upstream size", async () => {
    const post = await handleModelMirror(
      req(`${MODEL_MIRROR_PREFIX}${NAME}`, "POST"),
      upstream("x").fetch,
    );
    expect(post.status).toBe(405);
    const short = await handleModelMirror(
      req(`${MODEL_MIRROR_PREFIX}${NAME}`),
      upstream("x", { "content-length": "1" }).fetch,
    );
    expect(short.status).toBe(502);
    expect(await short.text()).toMatch(/size 1 is not the pinned/);
  });

  it("turns an upstream failure into a 502", async () => {
    const r = await handleModelMirror(
      req(`${MODEL_MIRROR_PREFIX}${NAME}`),
      () => Promise.resolve(new Response("gone", { status: 404 })),
    );
    expect(r.status).toBe(502);
    const thrown = await handleModelMirror(
      req(`${MODEL_MIRROR_PREFIX}${NAME}`),
      () => Promise.reject(new Error("dns")),
    );
    expect(thrown.status).toBe(502);
  });

  it("property: a name outside the allowlist never reaches the upstream", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 0, maxLength: 40 })
          .filter((s) => !Object.hasOwn(MIRRORED_MODELS, s)),
        async (name) => {
          const up = upstream("x");
          const path = `${MODEL_MIRROR_PREFIX}${encodeURIComponent(name)}`;
          const r = await handleModelMirror(req(path), up.fetch);
          expect(r.status).toBe(404);
          expect(up.calls).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
