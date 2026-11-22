/**
 * A same-origin mirror for pinned model files whose host sends no CORS
 * headers (GitHub release downloads), so a check page can fetch them.
 * Serves only the names in its allowlist, each from one fixed upstream URL
 * with a known size; it never builds an upstream URL from the request.
 */

import { corsHeaders, type FetchLike } from "./drive-proxy";

/** The route prefix; the file name follows it. */
export const MODEL_MIRROR_PREFIX = "/api/model/";

export interface MirroredModel {
  readonly upstream: string;
  readonly bytes: number;
}

/** Every file this route serves. */
export const MIRRORED_MODELS: Readonly<Record<string, MirroredModel>> = {
  // COLMAP 3.13.0 release asset (BSD-3-Clause); the LightGlue weights it
  // carries are Apache-2.0. Its sha256 is checked by the page that loads it.
  "sift-lightglue-3.13.0.onnx": {
    upstream:
      "https://github.com/colmap/colmap/releases/download/3.13.0/sift-lightglue.onnx",
    bytes: 45_806_253,
  },
};

function jsonError(status: number, message: string, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

/**
 * Answers `GET|HEAD /api/model/<name>`: 404 for a name not in the
 * allowlist (no upstream request), 405 for other methods, 502 when the
 * upstream fails or its size is not the pinned one; else the body,
 * streamed, as an immutable download.
 */
export async function handleModelMirror(
  request: Request,
  fetchImpl: FetchLike,
): Promise<Response> {
  const cors = corsHeaders(request);
  const { pathname } = new URL(request.url);
  const name = pathname.slice(MODEL_MIRROR_PREFIX.length);
  const model = Object.hasOwn(MIRRORED_MODELS, name)
    ? MIRRORED_MODELS[name]
    : undefined;
  if (!pathname.startsWith(MODEL_MIRROR_PREFIX) || model === undefined) {
    return jsonError(404, `no mirrored model: ${name}`, cors);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const r = jsonError(405, "only GET and HEAD", cors);
    r.headers.set("allow", "GET, HEAD");
    return r;
  }
  let upstream: Response;
  try {
    upstream = await fetchImpl(model.upstream, {
      method: request.method,
      redirect: "follow",
    });
  } catch (e) {
    return jsonError(
      502,
      `upstream unreachable: ${e instanceof Error ? e.message : String(e)}`,
      cors,
    );
  }
  if (!upstream.ok) {
    return jsonError(502, `upstream answered ${String(upstream.status)}`, cors);
  }
  const length = upstream.headers.get("content-length");
  if (length !== null && Number(length) !== model.bytes) {
    await upstream.body?.cancel();
    return jsonError(
      502,
      `upstream size ${length} is not the pinned ${String(model.bytes)}`,
      cors,
    );
  }
  const headers = new Headers(cors);
  headers.set("content-type", "application/octet-stream");
  // Only a size the upstream sent, and so checked above, is passed on.
  if (length !== null) headers.set("content-length", length);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: 200,
    headers,
  });
}
