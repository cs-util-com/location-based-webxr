import { describe, expect, it } from "vitest";

import { answerOf, requestOf } from "./measure-protocol";

const png = () => new Blob(["x"], { type: "image/png" });
const request = (over: Record<string, unknown> = {}) => ({
  type: "measure",
  job: 1,
  a: png(),
  b: png(),
  turn: null,
  methods: { sift: true, aliked: false, siftLightGlue: false },
  sizes: [640],
  pair: "1a",
  ...over,
});
const size = { width: 4, height: 2 };
const done = (over: Record<string, unknown> = {}) => ({
  type: "done",
  job: 3,
  results: [{ id: "sift", label: "SIFT", sizes: [] }],
  frames: { a: size, b: size },
  settings: "runs: 1",
  measureMs: 12,
  ...over,
});

// Why these tests matter: the page and the worker are separate programs;
// a malformed message on either side must be dropped (or answered as
// failed), never read as a pair to measure or a result to store.
describe("requestOf", () => {
  it("accepts a well-formed request, with and without a turn", () => {
    expect(requestOf(request())).not.toBeNull();
    for (const turn of [0, 90, 180]) {
      expect(requestOf(request({ turn }))).not.toBeNull();
    }
  });

  it("refuses a request with a bad field", () => {
    for (const bad of [
      { type: "cut" },
      { job: 0 },
      { job: 1.5 },
      { a: "not a blob" },
      { turn: 45 },
      { methods: { sift: true } },
      { sizes: [0] },
      { sizes: "640" },
      // No size, or one that is not a finite number, measures nothing.
      { sizes: [] },
      { sizes: [Infinity] },
      { sizes: [NaN] },
      { pair: 1 },
    ]) {
      expect(requestOf(request(bad))).toBeNull();
    }
    expect(requestOf(null)).toBeNull();
    expect(requestOf("measure")).toBeNull();
  });
});

describe("answerOf", () => {
  it("accepts progress, done and failed answers", () => {
    expect(answerOf({ type: "progress", job: 2, line: "x" })).not.toBeNull();
    expect(answerOf({ type: "failed", job: 2, message: "x" })).not.toBeNull();
    expect(answerOf(done())).toMatchObject({ type: "done", measureMs: 12 });
  });

  it("refuses an answer with a bad field", () => {
    expect(answerOf({ type: "progress", job: 2 })).toBeNull();
    expect(answerOf({ type: "failed", job: 2, message: 3 })).toBeNull();
    expect(answerOf({ type: "other", job: 2 })).toBeNull();
    expect(answerOf({ type: "progress", line: "x" })).toBeNull();
    for (const bad of [
      { results: "x" },
      { results: [{ id: "sift" }] },
      { frames: { a: size } },
      { frames: { a: size, b: { width: 0, height: 2 } } },
      { settings: null },
      { measureMs: Number.NaN },
    ]) {
      expect(answerOf(done(bad))).toBeNull();
    }
  });
});
