import { describe, expect, it } from "vitest";

import { answerOf, requestOf, transferOf } from "./cut-protocol.js";
import { blankImage } from "./rgba-image.js";
import type { SheetAnalysis } from "./sheet-analyze.js";

function result(): SheetAnalysis {
  const frames = [0, 1, 2, 3].map(() => blankImage(4, 8));
  return {
    frames,
    steadyFrames: [frames[0]!, blankImage(4, 8), blankImage(4, 8), frames[3]!],
    check: {} as SheetAnalysis["check"],
    mode: "white",
    gaps: [1, 2, 3],
    size: { w: 10, h: 10 },
  };
}

// Why these tests matter: neither side trusts the other's messages; a
// malformed request is ignored by the Worker, and a malformed result fails
// its job instead of leaving the page waiting forever.
describe("requestOf", () => {
  it("takes a cut with or without a picture", () => {
    expect(requestOf({ type: "cut", job: 1, settings: {} })).toEqual({
      type: "cut",
      job: 1,
      settings: {},
    });
    const picture = new Blob(["x"], { type: "image/png" });
    expect(requestOf({ type: "cut", job: 2, picture })?.picture).toBe(picture);
  });

  it("ignores anything else", () => {
    expect(requestOf(null)).toBeNull();
    expect(requestOf({ type: "run", job: 1 })).toBeNull();
    expect(requestOf({ type: "cut", job: 1.5 })).toBeNull();
    expect(requestOf({ type: "cut", job: 1, picture: "file.png" })).toBeNull();
  });
});

describe("answerOf", () => {
  it("reads phases, results and failures", () => {
    expect(
      answerOf({ type: "phase", job: 1, phase: "poses", state: "running" }),
    ).not.toBeNull();
    expect(answerOf({ type: "done", job: 1, result: result() })).not.toBeNull();
    expect(
      answerOf({
        type: "failed",
        job: 1,
        phase: "read",
        code: "decode",
        message: "m",
        detail: {},
      }),
    ).not.toBeNull();
  });

  it("turns a done whose frames do not read into a failure of its job", () => {
    const bad = { ...result(), frames: [blankImage(4, 8)] };
    expect(answerOf({ type: "done", job: 7, result: bad })).toMatchObject({
      type: "failed",
      job: 7,
      code: "failed",
    });
    const mixed = {
      ...result(),
      frames: [0, 1, 2].map(() => blankImage(4, 8)).concat(blankImage(5, 8)),
    };
    expect(answerOf({ type: "done", job: 8, result: mixed })).toMatchObject({
      type: "failed",
    });
  });

  it("ignores unknown phases, states and shapes", () => {
    expect(
      answerOf({ type: "phase", job: 1, phase: "dance", state: "running" }),
    ).toBeNull();
    expect(
      answerOf({ type: "phase", job: 1, phase: "read", state: "maybe" }),
    ).toBeNull();
    expect(answerOf({ type: "failed", job: 1, phase: "read" })).toBeNull();
    expect(
      answerOf({ type: "phase", phase: "read", state: "done" }),
    ).toBeNull();
    expect(answerOf(42)).toBeNull();
  });
});

describe("transferOf", () => {
  it("lists every buffer once, though idle and beckon appear in both sets", () => {
    expect(transferOf(result())).toHaveLength(6);
  });
});
