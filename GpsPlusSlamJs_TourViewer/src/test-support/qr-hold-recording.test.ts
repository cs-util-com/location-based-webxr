import { describe, expect, it } from "vitest";
import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";

import {
  parseViewerRecording,
  type RecordedAction,
} from "./qr-hold-recording.js";
import { replayVotePath, TODAY_KNOBS } from "./qr-hold-replay.js";

const fix = (id: string, timestamp: number): RecordGpsEventPayload => ({
  odomPosition: [0, 0, 0],
  odomRotation: [0, 0, 0, 1],
  rawGpsPoint: {
    id,
    latitude: 47.5,
    longitude: 8.7,
    latLongAccuracy: 5,
    timestamp,
  },
});

// Why (PR #623 bot review): a veto whose recovery left no action behind -
// zero re-fed batches (the `retractVotes() ?? { batches: 0 }` fallback in
// `viewer-placement.ts`) and no reset or cleared overrides before it - had
// an empty block, so `Math.min()` anchored it at Infinity and the replay
// had no `veto` event at all. Under `veto: "as-recorded"` the replayed
// code then kept voting where the phone ignored it. The veto must stay,
// anchored at its own `codeIgnored` entry, and the notes must say why.
describe("parseViewerRecording: a veto with no recovery actions", () => {
  it("keeps the veto, after the next GPS event, and notes the empty recovery", () => {
    const actions: RecordedAction[] = [
      { type: "gpsData/recordGpsEvent", payload: fix("gps-1", 1_000) },
      {
        type: "tourViewing/codeIgnored",
        payload: { text: "CODE-A", atMs: 1_500, recovery: { batches: 0 } },
      },
      { type: "gpsData/recordGpsEvent", payload: fix("gps-2", 2_000) },
    ];
    const parsed = parseViewerRecording(actions);
    const kinds = parsed.events.map((e) => e.kind);
    expect(kinds).toEqual(["fix", "fix", "veto"]);
    expect(parsed.events[2]).toEqual({
      kind: "veto",
      text: "CODE-A",
      retracted: false,
    });
    expect(parsed.notes.some((n) => /no recovery actions/.test(n))).toBe(true);
  });
});

// Why (PR #624 bot review): an empty recovery block means the phone took
// nothing back - its vote sink was gone, so `retractVotes()` never ran and
// the `?? { batches: 0 }` fallback was logged. The replay used to retract
// for every veto all the same, resetting the GPS history and re-feeding the
// fixes where the phone's history stayed as it was, so everything
// GPS-derived after that veto differed from the session it replays. The
// event now says whether the phone retracted, and the replay follows it.
describe("a replayed veto retracts only where the phone did", () => {
  /** An AR entry (the sink's clear, so the replay has a sink), a fix, the
   *  veto's actions, then the fix the veto is placed after. */
  const recording = (veto: RecordedAction[]): RecordedAction[] => [
    { type: "gpsData/setAlignmentOverrides", payload: null },
    { type: "gpsData/recordGpsEvent", payload: fix("gps-1", 1_000) },
    ...veto,
    { type: "gpsData/recordGpsEvent", payload: fix("gps-2", 2_000) },
  ];
  const resets = (parsed: ReturnType<typeof parseViewerRecording>): number =>
    replayVotePath(parsed.events, TODAY_KNOBS).dispatched.filter(
      (a) => a.type === "gpsData/resetGpsSessionData",
    ).length;

  it("does not reset the GPS history for a veto whose recovery left no action", () => {
    const parsed = parseViewerRecording(
      recording([
        {
          type: "tourViewing/codeIgnored",
          payload: { text: "CODE-A", atMs: 1_500, recovery: { batches: 0 } },
        },
      ]),
    );
    expect(parsed.events.find((e) => e.kind === "veto")).toEqual({
      kind: "veto",
      text: "CODE-A",
      retracted: false,
    });
    expect(resets(parsed)).toBe(0);
  });

  it("resets it for a veto whose recovery the phone recorded", () => {
    const parsed = parseViewerRecording(
      recording([
        { type: "gpsData/setAlignmentOverrides", payload: null },
        { type: "gpsData/resetGpsSessionData" },
        {
          type: "gpsData/recordGpsEventBatch",
          payload: { events: [fix("gps-1", 1_000)] },
        },
        {
          type: "tourViewing/codeIgnored",
          payload: { text: "CODE-A", atMs: 1_500, recovery: { batches: 1 } },
        },
      ]),
    );
    expect(parsed.events.find((e) => e.kind === "veto")).toEqual({
      kind: "veto",
      text: "CODE-A",
      retracted: true,
    });
    expect(resets(parsed)).toBe(1);
  });

  // Why (PR #627 bot review): the recording says how many batches the
  // phone re-fed (`recovery.batches`), but the walk-back over them stops at
  // the first action that is neither a batch nor a `tourViewing/*` log
  // entry. A veto whose batches are not where the walk-back expects them
  // left an empty block, read as "nothing taken back", so the replay
  // skipped a retraction the phone made. The recorded count decides too.
  it("still resets it when the phone re-fed batches the walk-back cannot find", () => {
    const parsed = parseViewerRecording(
      recording([
        {
          type: "gpsData/recordGpsEvent",
          payload: fix("gps-1b", 1_200),
        },
        {
          type: "tourViewing/codeIgnored",
          payload: { text: "CODE-A", atMs: 1_500, recovery: { batches: 1 } },
        },
      ]),
    );
    expect(parsed.events.find((e) => e.kind === "veto")).toEqual({
      kind: "veto",
      text: "CODE-A",
      retracted: true,
    });
    expect(resets(parsed)).toBe(1);
    expect(parsed.notes.some((n) => /re-fed batches not found/.test(n))).toBe(
      true,
    );
  });
});
