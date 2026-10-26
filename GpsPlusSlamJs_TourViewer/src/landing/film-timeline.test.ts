/**
 * Why these tests matter: the hero film is a pure function of one number,
 * the timeline position. Pause, resume, a jump to a part, play once and the
 * progress bar all rest on the mapping from that position to "which part,
 * which moment of it, which camera". A wrong segment boundary shows a
 * part's last frame for its first second, or lets the camera move while a
 * part already acts (the scene's "one moving thing at a time" rule).
 */
import { describe, expect, it } from "vitest";

import { createTimeline, type BeatSpec } from "./film-timeline.js";

const BEATS: readonly BeatSpec[] = [
  { durS: 4, views: [{ atS: 0, view: "over" }] },
  { durS: 2, views: [{ atS: 0, view: "close" }] },
  { durS: 3, views: [{ atS: 0, view: "close" }] },
  {
    durS: 6,
    views: [
      { atS: 0, view: "close" },
      { atS: 3, view: "over" },
    ],
  },
];
const PACE = { speed: 1, holdS: 0, camS: 1, settleS: 0.25 };

describe("film timeline: lengths", () => {
  it("adds a camera move before a part whose view changes and a settle before one whose view stays", () => {
    const tl = createTimeline(BEATS, PACE);
    // leads: 0 (first part), 1 (over -> close), 0.25, 0.25 (close stays)
    expect(tl.totalS).toBeCloseTo(4 + 2 + 3 + 6 + 1 + 0.25 + 0.25, 9);
    expect(tl.segments.map((s) => s.leadS)).toEqual([0, 1, 0.25, 0.25]);
  });

  it("stretches only the acting by 1 / speed, not the camera moves", () => {
    const tl = createTimeline(BEATS, { ...PACE, speed: 0.5 });
    expect(tl.totalS).toBeCloseTo(2 * 15 + 1.5, 9);
  });

  it("holds after every part but the last, which ends the film", () => {
    const tl = createTimeline(BEATS, { ...PACE, holdS: 2 });
    expect(tl.segments.map((s) => s.holdS)).toEqual([2, 2, 2, 0]);
    expect(tl.totalS).toBeCloseTo(15 + 1.5 + 6, 9);
  });

  it("lays the segments end to end from 0 to the total", () => {
    const tl = createTimeline(BEATS, { ...PACE, holdS: 1.5 });
    expect(tl.segments[0]?.startS).toBe(0);
    for (let i = 1; i < tl.segments.length; i++) {
      expect(tl.segments[i]?.startS).toBeCloseTo(tl.segments[i - 1]!.endS, 12);
    }
    expect(tl.segments.at(-1)?.endS).toBeCloseTo(tl.totalS, 12);
  });
});

describe("film timeline: position", () => {
  const tl = createTimeline(BEATS, { ...PACE, holdS: 1 });

  it("starts at part 0, moment 0", () => {
    expect(tl.positionAt(0)).toMatchObject({
      beat: 0,
      phase: "act",
      storyT: 0,
      finished: false,
    });
  });

  it("is in the camera lead at a part's start, the part shown at its moment 0", () => {
    const p = tl.positionAt(tl.startOf(1));
    expect(p).toMatchObject({ beat: 1, phase: "lead", storyT: 0 });
  });

  it("acts at speed after the lead", () => {
    const s = tl.segments[1]!;
    const p = tl.positionAt(s.startS + s.leadS + 0.5);
    expect(p.beat).toBe(1);
    expect(p.phase).toBe("act");
    expect(p.storyT).toBeCloseTo(0.5, 12);
  });

  it("holds the part's last moment during the reading hold", () => {
    const s = tl.segments[1]!;
    const p = tl.positionAt(s.startS + s.leadS + s.actS + 0.5);
    expect(p).toMatchObject({ beat: 1, phase: "hold", storyT: 2 });
  });

  it("is finished at the total and beyond, on the last part's last moment", () => {
    for (const t of [tl.totalS, tl.totalS + 5]) {
      expect(tl.positionAt(t)).toMatchObject({
        beat: 3,
        storyT: 6,
        finished: true,
        segmentProgress: 1,
      });
    }
  });

  it("reads garbage as the start, never as a jump to the end", () => {
    for (const t of [Number.NaN, -3, Number.NEGATIVE_INFINITY]) {
      expect(tl.positionAt(t)).toMatchObject({ beat: 0, storyT: 0 });
    }
  });

  it("reports how far through its segment the position is, for the bar's fill", () => {
    const s = tl.segments[2]!;
    const mid = (s.startS + s.endS) / 2;
    expect(tl.positionAt(mid).segmentProgress).toBeCloseTo(0.5, 12);
  });
});

describe("film timeline: camera", () => {
  const tl = createTimeline(BEATS, PACE);

  it("holds the first part's view still from the start", () => {
    expect(tl.cameraAt(0)).toEqual({ from: "over", to: "over", k: 1 });
  });

  it("moves to a part's new view during its lead, arriving as the part starts acting", () => {
    const s = tl.segments[1]!;
    expect(tl.cameraAt(s.startS)).toEqual({ from: "over", to: "close", k: 0 });
    expect(tl.cameraAt(s.startS + 0.5).k).toBeCloseTo(0.5, 12);
    expect(tl.cameraAt(s.startS + s.leadS)).toEqual({
      from: "over",
      to: "close",
      k: 1,
    });
  });

  it("moves within a part where the part changes its view", () => {
    const s = tl.segments[3]!;
    const at = s.startS + s.leadS + 3;
    expect(tl.cameraAt(at)).toEqual({ from: "close", to: "over", k: 0 });
    expect(tl.cameraAt(at + 1)).toEqual({ from: "close", to: "over", k: 1 });
  });

  it("starts a jump's camera from the previous part's view, so a jump arrives the way playing does", () => {
    const s = tl.segments[1]!;
    expect(tl.cameraAt(tl.startOf(1))).toEqual(tl.cameraAt(s.startS));
  });
});

describe("film timeline: input validation", () => {
  it("refuses an empty film, a bad duration, a bad first view and a bad pace", () => {
    expect(() => createTimeline([], PACE)).toThrow(RangeError);
    expect(() =>
      createTimeline([{ durS: 0, views: [{ atS: 0, view: "a" }] }], PACE),
    ).toThrow(RangeError);
    expect(() =>
      createTimeline([{ durS: 1, views: [{ atS: 0.2, view: "a" }] }], PACE),
    ).toThrow(RangeError);
    expect(() =>
      createTimeline(
        [
          {
            durS: 1,
            views: [
              { atS: 0, view: "a" },
              { atS: 1, view: "b" },
            ],
          },
        ],
        PACE,
      ),
    ).toThrow(RangeError);
    for (const bad of [
      { ...PACE, speed: 0 },
      { ...PACE, speed: Number.NaN },
      { ...PACE, holdS: -1 },
      { ...PACE, camS: 0 },
      { ...PACE, settleS: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => createTimeline(BEATS, bad)).toThrow(RangeError);
    }
  });

  it("refuses a start of a part that does not exist", () => {
    const tl = createTimeline(BEATS, PACE);
    expect(() => tl.startOf(4)).toThrow(RangeError);
    expect(() => tl.startOf(-1)).toThrow(RangeError);
    expect(() => tl.startOf(1.5)).toThrow(RangeError);
  });
});
