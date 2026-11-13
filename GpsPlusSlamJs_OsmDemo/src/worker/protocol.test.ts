import { describe, expect, it } from "vitest";

import {
  isWorkerEnvelope,
  isWorkerNotice,
  isWorkerReply,
  type WorkerCallKind,
} from "./protocol.js";

/**
 * Every call kind, as a `Record` over the union: a kind added to
 * `WorkerCalls` and missing here is a type error in `typecheck:tests`, so
 * this list cannot fall behind the protocol the way the guard's own set did.
 */
const EVERY_KIND = {
  init: true,
  update: true,
  cellMesh: true,
  explain: true,
  geoEvent: true,
  planRoute: true,
  terrain: true,
  terrainUpgrade: true,
} satisfies Record<WorkerCallKind, true>;

describe("isWorkerEnvelope", () => {
  // WHY: the worker's `message` handler drops anything this guard rejects,
  // and a dropped request is a promise that never settles. `terrainUpgrade`
  // was missing from the guard's set (2026-10-06, the globe city plan's
  // review R19), so OsmDemo's DEM upgrade waited forever and never reached
  // the page; nothing failed, because every test used a fake worker.
  it.each(Object.keys(EVERY_KIND))("accepts a %s request", (kind) => {
    expect(isWorkerEnvelope({ id: 1, kind, payload: {} })).toBe(true);
  });

  // WHY: the guard is also what keeps foreign messages (devtools, other
  // libraries posting to the worker) from being dispatched as calls.
  it("rejects an unknown kind, a missing id and a malformed abort", () => {
    expect(isWorkerEnvelope({ id: 1, kind: "nope", payload: {} })).toBe(false);
    expect(isWorkerEnvelope({ kind: "init", payload: {} })).toBe(false);
    expect(isWorkerEnvelope({ id: 1, kind: "abort" })).toBe(false);
    expect(isWorkerEnvelope({ id: 1, kind: "abort", target: 3 })).toBe(true);
    expect(isWorkerEnvelope(null)).toBe(false);
  });
});

describe("isWorkerNotice", () => {
  // WHY: a notice is the worker's one unsolicited message (a foreground tile
  // download started). It must never be mistaken for a reply, or it would
  // settle some pending call, and a reply must never be mistaken for a notice.
  it("accepts a download notice and nothing a reply could be", () => {
    const notice = { notice: "downloadStarted" };
    expect(isWorkerNotice(notice)).toBe(true);
    expect(isWorkerReply(notice)).toBe(false);
    expect(isWorkerNotice({ id: 1, ok: true, value: undefined })).toBe(false);
    expect(isWorkerNotice({ notice: "somethingElse" })).toBe(false);
    expect(isWorkerNotice(null)).toBe(false);
  });
});
