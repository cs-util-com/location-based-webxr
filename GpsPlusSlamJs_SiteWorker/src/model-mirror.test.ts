import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  handleModelMirror,
  MIRRORED_MODELS,
  MODEL_MIRROR_PREFIX,
} from "./model-mirror";

const NAME = "sift-lightglue.onnx";
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
