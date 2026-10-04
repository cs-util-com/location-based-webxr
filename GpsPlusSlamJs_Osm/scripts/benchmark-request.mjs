import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function analyse(body) {
  const document = JSON.parse(body);
  if (!Array.isArray(document?.elements))
    throw new Error("JSON has no elements array");
  const remark = document.remark;
  if (remark !== undefined && String(remark).trim() !== "") {
    return {
      remark: String(remark),
      error: `Overpass remark: ${String(remark)}`,
    };
  }
  const counts = countElements(document.elements);
  const elements = [...document.elements].sort(
    (a, b) => a.type.localeCompare(b.type) || a.id - b.id,
  );
  return {
    elementCount: elements.length,
    counts,
    semanticHash: createHash("sha256")
      .update(JSON.stringify(canonical(elements)))
      .digest("hex"),
    osmTimestamp: document.osm3s?.timestamp_osm_base ?? null,
  };
}

function countElements(elements) {
  const counts = { node: 0, way: 0, relation: 0 };
  for (const element of elements) {
    if (
      !element ||
      !Object.hasOwn(counts, element.type) ||
      !Number.isSafeInteger(element.id)
    ) {
      throw new Error("Invalid OSM element type or id");
    }
    counts[element.type]++;
  }
  return counts;
}

async function readChunks(
  reader,
  deadline,
  result,
  started,
  maxBytes,
  controller,
) {
  const chunks = [];
  if (!reader) return chunks;
  for (;;) {
    const { done, value } = await Promise.race([reader.read(), deadline]);
    if (done) return chunks;
    if (result.firstByteMs === null)
      result.firstByteMs = Math.round(performance.now() - started);
    result.bytes += value.byteLength;
    if (result.bytes > maxBytes) {
      const error = new Error(
        `Response exceeds decoded body cap (${maxBytes} bytes)`,
      );
      controller.abort(error);
      void reader.cancel(error).catch(() => {});
      throw error;
    }
    chunks.push(value);
  }
}

function decodeResponse(chunks, response, result) {
  const decodeStarted = performance.now();
  try {
    const body = Buffer.concat(chunks).toString("utf8");
    if (!response.ok)
      result.error = `HTTP ${response.status}: ${body.slice(0, 1000)}`;
    else {
      Object.assign(result, analyse(body));
      result.ok = result.error === undefined;
    }
  } finally {
    result.decodeMs = Math.round(performance.now() - decodeStarted);
  }
}

/**
 * How this benchmark identifies itself to Overpass operators.
 *
 * Shared with `benchmark-status.mjs` rather than copied, because it carries a
 * contract in both directions. It is the courtesy that lets an operator
 * recognise and, if they wish, block this traffic — and it is load-bearing:
 * `overpass-api.de` answers `/api/status` with **HTTP 406** to a request
 * carrying no User-Agent, which is what Node's fetch sends by default.
 */
export const BENCHMARK_USER_AGENT =
  "gps-plus-slam-osm comparison benchmark (github.com/cs-util-com)";

function requestOptions(query, encoding, signal) {
  return {
    method: "POST",
    body: encoding === "raw" ? query : new URLSearchParams({ data: query }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": BENCHMARK_USER_AGENT,
    },
    signal,
  };
}

function validateOptions(encoding, timeoutMs, maxBytes) {
  if (!["raw", "form"].includes(encoding)) throw new Error("Unknown encoding");
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  ) {
    throw new Error("Positive timeoutMs and integer maxBytes required");
  }
}

function describeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return error?.cause?.code ? `${message} (${error.cause.code})` : message;
}

/** Measures decoded body bytes and network time separately from JSON analysis. */
export async function measureRequest(request, { fetchImpl = fetch } = {}) {
  const { url, query, encoding, timeoutMs, maxBytes } = {
    encoding: "form",
    timeoutMs: 210_000,
    maxBytes: 120_000_000,
    ...request,
  };
  validateOptions(encoding, timeoutMs, maxBytes);
  const started = performance.now();
  const result = {
    ok: false,
    httpStatus: null,
    status: "network error",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    headersMs: null,
    firstByteMs: null,
    totalMs: null,
    bytes: 0,
    decodeMs: 0,
    elementCount: null,
    counts: { node: 0, way: 0, relation: 0 },
    semanticHash: null,
  };
  const controller = new AbortController();
  let reader;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    const error = new Error(`Request deadline exceeded (${timeoutMs} ms)`);
    controller.abort(error);
    rejectDeadline(error);
    if (reader) void reader.cancel(error).catch(() => {});
  }, timeoutMs);
  const finishNetwork = () => {
    result.totalMs = Math.round(performance.now() - started);
    result.finishedAt = new Date().toISOString();
    clearTimeout(timer);
  };
  try {
    const response = await Promise.race([
      fetchImpl(url, requestOptions(query, encoding, controller.signal)),
      deadline,
    ]);
    result.headersMs = Math.round(performance.now() - started);
    result.httpStatus = response.status;
    result.status = `${response.status} ${response.statusText}`.trim();
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null) result.retryAfter = retryAfter;
    reader = response.body?.getReader();
    const chunks = await readChunks(
      reader,
      deadline,
      result,
      started,
      maxBytes,
      controller,
    );
    finishNetwork();
    decodeResponse(chunks, response, result);
  } catch (error) {
    if (result.totalMs === null) finishNetwork();
    result.error = describeError(error);
  } finally {
    clearTimeout(timer);
    if (reader) reader.releaseLock();
  }
  return result;
}
