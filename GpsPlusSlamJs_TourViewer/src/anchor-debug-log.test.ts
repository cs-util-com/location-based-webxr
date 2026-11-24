import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  LogLevel,
} from "gps-plus-slam-app-framework/utils/logger";
import {
  createAnchorDebugLog,
  FRAME_REGRESSION_LIMIT_MS,
  MIN_AB_TURNS,
  MIN_FRAME_SAMPLES,
  PASS_P95_LIMIT_MS,
  startAnchorDebugLog,
  summarizeSamples,
} from "./anchor-debug-log.js";
import type { DeferredAnchorPassSample } from "gps-plus-slam-app-framework/ar/deferred-anchors";

type DeferredAnchorCommit = DeferredAnchorPassSample["commits"][number];

const sample = (
  passMs: number,
  traversals: number,
  dt = 1 / 60,
  deferring = true,
  commits: readonly DeferredAnchorCommit[] = [],
): DeferredAnchorPassSample => ({
  passMs,
  dt,
  deferring,
  counts: { sphereTests: 0, traversals, windowOpen: false, followUpdates: 0 },
  commits,
});

const commit = (
  kind: DeferredAnchorCommit["kind"],
  outFrames = 0,
  queued = 0,
): DeferredAnchorCommit => ({
  key: "station:a",
  kind,
  waitMs: 900,
  movedM: 2,
  pendingFrames: 5,
  outFrames,
  queued,
});

/**
 * An `anchors=ab` session: `turns` turns of each half, on first, each
 * `frames` passes long, with the frame times `onDt` and `offDt` (s).
 */
function abSession(
  log: ReturnType<typeof createAnchorDebugLog>,
  turns: number,
  frames: number,
  onDt: (i: number) => number,
  offDt: (i: number) => number,
): void {
  for (let t = 0; t < turns; t += 1) {
    for (let i = 0; i < frames; i += 1) log.pass(sample(0.1, 0, onDt(i), true));
    for (let i = 0; i < frames; i += 1)
      log.pass(sample(0.05, 0, offDt(i), false));
  }
}

const entry = (tag: string, message: string) => ({
  timestamp: 0,
  level: LogLevel.INFO,
  tag,
  message,
});

describe("summarizeSamples", () => {
  // Why: the pass criteria read p95 and max; nearest rank means each is a
  // value that occurred, and non-finite values (a missing dt) are skipped.
  it("gives nearest-rank p50/p95, max, mean and count of the finite values", () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    values.push(NaN, Infinity);
    expect(summarizeSamples(values)).toEqual({
      p50: 50,
      p95: 95,
      max: 100,
      mean: 50.5,
      count: 100,
    });
  });

  it("is null when no value is finite", () => {
    expect(summarizeSamples([])).toBeNull();
    expect(summarizeSamples([NaN])).toBeNull();
  });
});

describe("createAnchorDebugLog", () => {
  // Why: the copied section is what the field test pastes back: the pass,
  // traversal and frame-time numbers with their counts, then the lines.
  it("writes the anchor section with the numbers and the anchor lines", () => {
    const log = createAnchorDebugLog();
    for (let i = 1; i <= 20; i += 1) log.pass(sample(i / 10, i % 3));
    log.entry(
      entry(
        "DeferredAnchors",
        "commit out-of-view: station:a, waited 900 ms, moved 2.00 m",
      ),
    );
    log.entry(entry("Other", "not ours"));
    const lines = log.text().split("\n");
    expect(lines[0]).toBe("--- anchors ---");
    expect(lines).toContain("deferral on");
    expect(lines).toContain("passes 20 seen, last 20 summarized");
    expect(lines).toContain("pass ms p50 1.000 p95 1.900 max 2.000 (n 20)");
    expect(lines).toContain("traversals per pass mean 1.050 max 2 (n 20)");
    expect(lines).toContain("frame ms p50 16.7 p95 16.7 max 16.7 (n 20)");
    expect(lines).toContain("commits 0");
    expect(lines).toContain("lines 1");
    expect(lines.at(-1)).toMatch(
      /^\d\d:\d\d:\d\d\.\d\d\d commit out-of-view: station:a, waited 900 ms/,
    );
    expect(log.text()).not.toContain("not ours");
  });

  // Why: the buffers stay bounded on a long walk: the pass ring keeps the
  // newest passes, the line list drops the oldest and says how many.
  it("keeps the newest passes and lines only", () => {
    const log = createAnchorDebugLog({ passes: 4, lines: 2 });
    for (let i = 1; i <= 10; i += 1) log.pass(sample(i, 0));
    for (let i = 1; i <= 5; i += 1)
      log.entry(entry("DeferredAnchors", `l${String(i)}`));
    const text = log.text();
    expect(text).toContain("passes 10 seen, last 4 summarized");
    expect(text).toContain("pass ms p50 8.000 p95 10.000 max 10.000 (n 4)");
    expect(text).toContain("lines 2, 3 older dropped");
    expect(text).not.toMatch(/ l3$/m);
    expect(text).toMatch(/ l5$/m);
  });

  it("says when the deferral is off, and skips a pass without a frame time", () => {
    const log = createAnchorDebugLog({ deferral: false });
    log.pass(sample(0.1, 0, 0, false));
    expect(log.text()).toContain("deferral off (anchors=0)");
    expect(log.text()).toContain(
      "deferral off: pass ms p50 0.100 p95 0.100 max 0.100 (n 1), frame ms -",
    );
    expect(log.readout(0)[0]).toMatch(/^anchors off: /);
  });

  // Why: the readout runs on every camera frame; it recomputes once a
  // second. clear() runs after every Copy: it empties the lines that copy
  // carried, and keeps the numbers, so a copy in the middle of a run does
  // not throw the verdict's data away.
  it("recomputes the readout at most once a second; clear keeps the numbers", () => {
    const log = createAnchorDebugLog();
    expect(log.readout(0)).toEqual([]);
    log.pass(sample(0.2, 1));
    const first = log.readout(1000);
    expect(first).toEqual([
      "anchors on: pass p95 0.20 max 0.20 ms, trav 1.00/pass, frame p95 16.7 ms (1)",
      "anchor test: pass PASS, frame -, queue -",
    ]);
    log.pass(sample(5, 1));
    expect(log.readout(1500)).toEqual(first);
    expect(log.readout(2000)[0]).toContain("max 5.00 ms");
    log.entry(entry("DeferredAnchors", "window opened (jump)"));
    log.clear();
    expect(log.readout(3000)[0]).toContain("max 5.00 ms");
    expect(log.text()).toContain("passes 2 seen");
    expect(log.text()).toContain("lines 0");
    expect(log.text()).not.toContain("window opened");
  });

  // Why: the deferral line says what the page was opened with; an
  // `anchors=ab` session copied during its first turn has deferral-on
  // passes only and must still call itself an A/B session.
  it("labels the session by the switch it was opened with", () => {
    const ab = createAnchorDebugLog({ deferral: "ab" });
    expect(ab.text()).toContain("deferral on and off in turns (anchors=ab)");
    ab.pass(sample(0.1, 0));
    expect(ab.text()).toContain("deferral on and off in turns (anchors=ab)");
    expect(ab.readout(0)[0]).toMatch(/^anchors ab: /);
    expect(createAnchorDebugLog().text()).toContain("deferral on");
    expect(createAnchorDebugLog({ deferral: false }).text()).toContain(
      "deferral off (anchors=0)",
    );
  });

  it("refuses a size that is no positive integer", () => {
    expect(() => createAnchorDebugLog({ passes: 0 })).toThrow(RangeError);
    expect(() => createAnchorDebugLog({ lines: 1.5 })).toThrow(RangeError);
    expect(() =>
      createAnchorDebugLog({ deferral: "x" as unknown as boolean }),
    ).toThrow(RangeError);
  });
});

describe("the field test's verdicts", () => {
  // Why: the phone test is read off the pasted log alone, so the log must
  // compute each pass criterion itself and print PASS or FAIL with the
  // limit; a criterion without data says how to get it, never PASS.
  it("are not measured before the data exists", () => {
    const text = createAnchorDebugLog().text();
    expect(text).toContain("--- verdict ---");
    expect(text).toContain(
      "pass p95: not measured (no pass with the deferral on)",
    );
    expect(text).toContain(
      `frame p95 regression: not measured, open with &anchors=ab and stay about 90 s (turns on 0, off 0, need ${String(MIN_AB_TURNS)} each; frames on n 0, off n 0, need ${String(MIN_FRAME_SAMPLES)} each)`,
    );
    expect(text).toContain(
      "out-of-view commits within their queue: not measured (none yet)",
    );
  });

  // Why: the anchor pass criterion is the p95 with the deferral on; the
  // off half of an A/B session runs a cheaper follow pass, which must not
  // pull the p95 down. The limit is inclusive.
  it("judge the pass p95 on the deferral-on passes only, inclusive", () => {
    const log = createAnchorDebugLog();
    for (let i = 0; i < 100; i += 1) log.pass(sample(PASS_P95_LIMIT_MS, 0));
    for (let i = 0; i < 400; i += 1) log.pass(sample(0, 0, 1 / 60, false));
    expect(log.text()).toContain(
      `pass p95 ${PASS_P95_LIMIT_MS.toFixed(3)} ms (limit ${String(PASS_P95_LIMIT_MS)}): PASS`,
    );
    for (let i = 0; i < 11; i += 1) log.pass(sample(2, 0));
    expect(log.text()).toContain(
      `pass p95 2.000 ms (limit ${String(PASS_P95_LIMIT_MS)}): FAIL`,
    );
  });

  // Why: the frame-time criterion compares one session's two halves
  // (`anchors=ab`): p95 with the deferral on minus p95 with it off; a
  // regression over the limit fails. Next to it each half's share of long
  // frames (over 1.5 times the median), which a p95 alone can hide.
  it("compare the frame p95 of the two halves of an A/B session", () => {
    const ok = createAnchorDebugLog({ deferral: "ab" });
    // One frame in 50 of the deferral-on half is long (40 ms).
    abSession(
      ok,
      MIN_AB_TURNS,
      MIN_FRAME_SAMPLES,
      (i) => (i % 50 === 0 ? 0.04 : 0.0175),
      () => 0.017,
    );
    // The last off turn completes when the deferral comes back on.
    ok.pass(sample(0.1, 0, 0.0175, true));
    const okText = ok.text();
    expect(okText).toContain(
      `frame p95 regression 0.5 ms (on 17.5, off 17.0, limit ${String(FRAME_REGRESSION_LIMIT_MS)}; long frames on 2.0%, off 0.0%): PASS`,
    );
    expect(ok.readout(0)[1]).toBe(
      "anchor test: pass PASS, frame PASS, queue -",
    );

    const slow = createAnchorDebugLog({ deferral: "ab" });
    abSession(
      slow,
      MIN_AB_TURNS,
      MIN_FRAME_SAMPLES,
      () => 0.0185,
      () => 0.017,
    );
    slow.pass(sample(0.1, 0, 0.0185, true));
    expect(slow.text()).toContain(
      `frame p95 regression 1.5 ms (on 18.5, off 17.0, limit ${String(FRAME_REGRESSION_LIMIT_MS)}; long frames on 0.0%, off 0.0%): FAIL`,
    );
  });

  // Why: 300 frames fit in one 15 s turn, so a sample count alone would
  // compare one stretch of the walk with another (in front of the tower
  // against somewhere else). Each half needs three completed turns.
  it("wait for three completed turns of each half, and for enough frames", () => {
    const log = createAnchorDebugLog({ deferral: "ab" });
    abSession(
      log,
      MIN_AB_TURNS - 1,
      2 * MIN_FRAME_SAMPLES,
      () => 0.017,
      () => 0.017,
    );
    for (let i = 0; i < MIN_FRAME_SAMPLES; i += 1) log.pass(sample(0.1, 0));
    // Three turns on completed only once the deferral goes off again.
    expect(log.text()).toContain(
      `frame p95 regression: not measured, open with &anchors=ab and stay about 90 s (turns on ${String(MIN_AB_TURNS - 1)}, off ${String(MIN_AB_TURNS - 1)}, need ${String(MIN_AB_TURNS)} each; frames on n ${String(MIN_AB_TURNS * MIN_FRAME_SAMPLES * 2 - MIN_FRAME_SAMPLES)}, off n ${String((MIN_AB_TURNS - 1) * MIN_FRAME_SAMPLES * 2)}, need ${String(MIN_FRAME_SAMPLES)} each)`,
    );
    for (let i = 0; i < 2 * MIN_FRAME_SAMPLES; i += 1)
      log.pass(sample(0.05, 0, 0.017, false));
    log.pass(sample(0.1, 0));
    expect(log.text()).toMatch(/^frame p95 regression 0\.0 ms .*: PASS$/m);

    const short = createAnchorDebugLog({ deferral: "ab" });
    abSession(
      short,
      MIN_AB_TURNS,
      10,
      () => 0.017,
      () => 0.017,
    );
    short.pass(sample(0.1, 0));
    expect(short.text()).toContain(
      `(turns on ${String(MIN_AB_TURNS)}, off ${String(MIN_AB_TURNS)}, need ${String(MIN_AB_TURNS)} each; frames on n ${String(MIN_AB_TURNS * 10 + 1)}, off n ${String(MIN_AB_TURNS * 10)}, need ${String(MIN_FRAME_SAMPLES)} each)`,
    );
  });

  // Why: "frames waited per key": an out-of-view commit must land within
  // as many frames as keys were queued out of view with it (one commit
  // per pass, round robin); the log counts the commits by kind and any
  // that waited longer.
  it("count the commits and check each out-of-view one against its queue", () => {
    const log = createAnchorDebugLog();
    log.pass(sample(0.1, 1, 1 / 60, true, [commit("first")]));
    log.pass(sample(0.1, 1, 1 / 60, true, [commit("out-of-view", 1, 2)]));
    log.pass(sample(0.1, 1, 1 / 60, true, [commit("out-of-view", 2, 2)]));
    let text = log.text();
    expect(text).toContain("commits 3: first 1, out-of-view 2");
    expect(text).toContain(
      "out of view: most 2 frames (queue up to 2), 0 over their queue",
    );
    expect(text).toContain(
      "out-of-view commits within their queue (2 of 2): PASS",
    );
    expect(log.readout(0)[1]).toBe(
      "anchor test: pass PASS, frame -, queue PASS",
    );

    log.pass(sample(0.1, 1, 1 / 60, true, [commit("out-of-view", 4, 1)]));
    text = log.text();
    expect(text).toContain(
      "out of view: most 4 frames (queue up to 2), 1 over their queue",
    );
    expect(text).toContain(
      "out-of-view commits within their queue (2 of 3): FAIL",
    );
    expect(log.readout(10000)[1]).toBe(
      "anchor test: pass PASS, frame -, queue FAIL",
    );
    log.clear();
    expect(log.text()).toContain(
      "out-of-view commits within their queue (2 of 3): FAIL",
    );
  });
});

describe("startAnchorDebugLog", () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
  });

  // Why: the page's log is fed by the framework itself: the anchor
  // logger's lines reach it; the stop function ends the feed.
  it("collects the framework's DeferredAnchors log lines", () => {
    const started = startAnchorDebugLog();
    stop = started.stop;
    createLogger("DeferredAnchors").info("window opened (jump)");
    expect(started.log.text()).toMatch(/ window opened \(jump\)$/m);
    started.stop();
    createLogger("DeferredAnchors").info("after stop");
    expect(started.log.text()).not.toContain("after stop");
  });
});
