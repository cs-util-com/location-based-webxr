/**
 * Why these tests matter: the field log is how the travelling box's knobs
 * are chosen. One walk per condition is logged at 10 Hz on the phone,
 * copied as text, and every knob set is then replayed offline from it, so
 * nobody walks once per knob value. The log must therefore keep the newest
 * part of a long walk (a ring), sample at 10 Hz whatever the frame rate
 * and on every frame where the want, the place or the finger changes, with
 * the app's own time step since the sample before, keep every press,
 * release, place change and Mark at its own time, stay small enough for a
 * phone's clipboard, reach the clipboard only through the page's seam (or
 * a file, as the fallback), empty itself after either, read back what it
 * wrote, and the replay must run the app's own rules: a lower threshold
 * docks later on a retreat, a wider keep band changes place less often at
 * the edge, and the lock after a release holds across a logged release.
 */
import { LogLevel } from "gps-plus-slam-app-framework/utils/logger";
import { describe, expect, it } from "vitest";

import { createAnchorDebugLog } from "./anchor-debug-log.js";

import type { TravelFrameSample } from "./travelling-box.js";
import {
  createTravelLog,
  parseTravelLog,
  replayPlaces,
  replaySelfCheck,
  TRAVEL_LOG_PERIOD_MS,
  wireTravelLogButtons,
  type TravelLog,
} from "./travelling-box-log.js";
import {
  TRAVELLING_BOX_DEFAULTS,
  type PlateMetrics,
  type TravellingBoxKnobs,
} from "./travelling-box-rules.js";

const KNOBS = TRAVELLING_BOX_DEFAULTS;

/** A plate on screen with letters of `px` CSS px. */
function metricsOf(px: number): PlateMetrics {
  return {
    valid: true,
    onScreen: true,
    ndcX: 0,
    ndcY: -0.2,
    letterPxH: px,
    letterPxW: px,
    letterPx: px,
    linePx: px * 1.3,
  };
}

/** One frame as the controller reports it. */
function sample(
  at: number,
  over: Partial<TravelFrameSample> & { readonly px?: number } = {},
): TravelFrameSample {
  const { px = 20, ...rest } = over;
  return {
    at,
    dtS: 0.1,
    first: false,
    surface: "words:t1",
    travelling: true,
    hideWhy: null,
    slotFree: true,
    canFold: false,
    finger: false,
    place: "plate",
    want: "plate",
    wantWhy: "readable",
    metrics: metricsOf(px),
    angleDeg: 0,
    distM: 3,
    pxPerM: 508,
    ...rest,
  };
}

/** `seconds` of frames at `fps`, from `from` ms, each from `at(t)`. */
function frames(
  log: TravelLog,
  seconds: number,
  fps: number,
  at: (t: number) => Partial<TravelFrameSample> & { px?: number } = () => ({}),
  from = 0,
): number {
  const step = 1000 / fps;
  let t = from;
  for (let i = 0; i < seconds * fps; i++) {
    t = from + i * step;
    log.frame(sample(t, { dtS: step / 1000, ...at(t) }));
  }
  return t;
}

describe("the travelling box's field log", () => {
  // Why: the replay's time steps are the samples', so the log must keep
  // 10 a second on a 60 fps phone and on a 30 fps one alike.
  it("samples at 10 Hz whatever the frame rate", () => {
    for (const fps of [60, 30, 24]) {
      const log = createTravelLog({ knobs: KNOBS });
      frames(log, 3, fps);
      const n = log.samples().length;
      expect(n, `${String(fps)} fps`).toBeGreaterThanOrEqual(29);
      expect(n, `${String(fps)} fps`).toBeLessThanOrEqual(31);
    }
    expect(TRAVEL_LOG_PERIOD_MS).toBe(100);
  });

  // Why: the replay under the walk's own knobs must meet each change at
  // the app's frame, so a frame where the want, the place or the finger
  // changes is a sample too, carrying the app's settling time since the
  // sample before (its capped steps, not the clock).
  it("samples every change, with the app's time step since the sample before", () => {
    const log = createTravelLog({ knobs: KNOBS });
    for (let i = 0; i < 13; i++) {
      const want = i >= 5 ? "dock" : "plate";
      log.frame(sample(i * 16, { dtS: 0.016, want }));
    }
    const kept = log.samples();
    expect(kept.map((s) => s.t)).toEqual([0, 80, 192]);
    // A travel starts with no step behind it (the app's first frame too).
    expect(kept[0]!.dt).toBe(0);
    // 5 frames of 16 ms since t 0, then 7 since t 80 (the beat at 192).
    expect(kept[1]!.dt).toBeCloseTo(0.08, 4);
    expect(kept[2]!.dt).toBeCloseTo(0.112, 4);
    expect(kept[1]!.want).toBe("dock");
  });

  // Why: an Android clipboard carries about 1 MB at most and a paste of
  // megabytes is fragile, so a 6-minute walk must stay well under 300 KB;
  // the size of a full ring (6000 samples, ten minutes) is measured here
  // and stated in the sidecar.
  it("stays small: a 6-minute walk well under 300 KB", () => {
    const sizeOf = (n: number) => {
      const log = createTravelLog({ knobs: KNOBS });
      for (let i = 0; i < n; i++) {
        const t = 123_456 + i * 100;
        log.frame(
          sample(t, {
            distM: 3 + 9 * Math.abs(Math.sin(i / 300)),
            angleDeg: 40 * Math.sin(i / 53),
            dtS: 0.1,
            metrics: {
              ...metricsOf(12 + 7 * Math.sin(i / 37)),
              ndcX: 0.31 * Math.sin(i / 19),
              ndcY: -0.2 + 0.11 * Math.cos(i / 23),
            },
          }),
        );
      }
      return log.text().length;
    };
    const sixMinutes = sizeOf(3600);
    const full = sizeOf(6000);
    // Measured: about 55 bytes a sample, 198 KB for 6 minutes and 329 KB
    // for the full ring.
    expect(sixMinutes).toBeLessThan(210_000);
    expect(full).toBeLessThan(350_000);
  });

  // Why: a walk is minutes long and a phone's memory is not; the newest
  // part is what the Mark lines refer to, so the oldest goes first and the
  // copy says how much went.
  it("keeps the newest samples in a ring, and says how many it dropped", () => {
    const log = createTravelLog({ knobs: KNOBS, capacity: 50 });
    frames(log, 10, 60);
    const kept = log.samples();
    expect(kept).toHaveLength(50);
    expect(kept[0]!.t).toBeGreaterThan(4_900);
    expect(kept.at(-1)!.t).toBeGreaterThan(9_800);
    expect(log.size()).toMatchObject({ samples: 50, dropped: 50 });
    expect(log.text().split("\n")[0]).toContain('"dropped":50');
  });

  // Why: a press, a release and a place change last one frame; at 10 Hz a
  // sample could miss them, so they are events at their own time.
  it("logs every press, release, place change and Mark at its own time", () => {
    const log = createTravelLog({ knobs: KNOBS });
    log.frame(sample(0));
    log.frame(sample(16, { finger: true }));
    log.frame(sample(33, { finger: true }));
    log.frame(sample(50));
    log.place({ at: 66, surface: "words:t1", place: "dock", why: "too small" });
    log.mark(80);
    expect(log.events()).toEqual([
      { kind: "press", t: 16, surface: "words:t1" },
      { kind: "release", t: 50, surface: "words:t1" },
      {
        kind: "place",
        t: 66,
        surface: "words:t1",
        place: "dock",
        why: "too small",
      },
      { kind: "mark", t: 80 },
    ]);
  });

  // Why: the copied text is what is pasted into the docs folder and read
  // back by the replay; it must carry the knobs it ran with, every sample
  // with the growth that was applied, and survive a damaged paste (lines
  // that do not read are skipped and counted, never thrown on).
  it("writes text that reads back to the same samples and events", () => {
    const log = createTravelLog({ knobs: { ...KNOBS, thr: 14 } });
    frames(log, 1, 60, (t) => ({ px: 20 - t / 100, distM: 6 }));
    log.mark(500);
    const text = log.text();
    const read = parseTravelLog(`${text}\nnot json\n{"kind":"s"}\n`);
    expect(read.knobs?.thr).toBe(14);
    expect(read.samples).toEqual(log.samples());
    expect(read.events).toEqual(log.events());
    expect(read.skipped).toBe(2);
    // 6 m: the sign grew by 6 / 4.5.
    expect(read.samples[0]!.growth).toBeCloseTo(6 / 4.5, 2);
    expect(parseTravelLog("").samples).toEqual([]);
  });

  // Why: Copy log appends the anchor section (anchor-debug-log.ts) to the
  // travel text, so a normal paste carries it. The replay must read the
  // travel part exactly as without it, and count the appended lines as
  // skipped, one each, rather than misread or throw on one.
  it("reads a paste with the anchor appendix like the travel text alone", () => {
    const log = createTravelLog({ knobs: KNOBS });
    frames(log, 1, 30, (t) => ({ px: 20 - t / 100, distM: 6 }));
    log.mark(300);
    const anchors = createAnchorDebugLog();
    for (let i = 1; i <= 5; i += 1) {
      anchors.pass({
        passMs: i / 10,
        dt: 1 / 60,
        deferring: true,
        counts: {
          sphereTests: 0,
          traversals: i % 2,
          windowOpen: false,
          followUpdates: 0,
        },
      });
    }
    anchors.entry({
      timestamp: 0,
      level: LogLevel.INFO,
      tag: "DeferredAnchors",
      message: "window opened (jump)",
    });
    const travel = log.text();
    const appendix = anchors.text();
    const appendixLines = appendix
      .split("\n")
      .filter((line) => line.trim() !== "").length;
    expect(appendixLines).toBeGreaterThan(3);

    const alone = parseTravelLog(travel);
    const pasted = parseTravelLog(`${travel}\n${appendix}`);
    expect(pasted.knobs).toEqual(alone.knobs);
    expect(pasted.samples).toEqual(alone.samples);
    expect(pasted.events).toEqual(alone.events);
    expect(pasted.skipped).toBe(alone.skipped + appendixLines);
    expect(alone.skipped).toBe(0);
  });

  // Why: the plateau (where the sign's growth cancels the distance) is
  // what makes a threshold depend on the path; the readout gives it from
  // the phone's own lens, beside where the words are and why.
  it("reads out where the words are, the letter size, the lens and the plateau", () => {
    const log = createTravelLog({ knobs: KNOBS });
    expect(log.readout(null)).toEqual([]);
    log.frame(
      sample(0, {
        place: "dock",
        want: "dock",
        wantWhy: "too small",
        px: 9.84,
        distM: 9.2,
      }),
    );
    log.mark(10);
    const lines = log.readout({
      frames: 600,
      over33: 9,
      over50: 2,
      over100: 0,
      workAvgMs: 0.42,
      workMaxMs: 3,
      paints: 4,
      paintAvgMs: 1.5,
      paintMaxMs: 2,
    });
    expect(lines[0]).toContain("dock (too small)");
    expect(lines[0]).toContain("9.8");
    expect(lines[0]).toContain("9.2 m");
    expect(lines[0]).toContain("508 px/m");
    expect(lines[0]).toContain("plateau 15.4");
    expect(lines[1]).toContain("1 mark");
    expect(lines[1]).toContain("2/600 over 50 ms");
  });

  // Why: a press held when a travel ended must not come back as a release
  // on the next travel's first frame: the lock would count from it.
  it("logs no release at a new travel's first frame", () => {
    const log = createTravelLog({ knobs: KNOBS });
    log.frame(sample(0));
    log.frame(sample(100, { finger: true }));
    log.frame(sample(60_000, { surface: "words:t2" }));
    log.frame(sample(60_100, { surface: "words:t2" }));
    expect(log.events().map((e) => e.kind)).toEqual(["press"]);
  });
});

describe("the log's buttons", () => {
  function buttons() {
    const copy = { disabled: false, textContent: "Copy log" as string | null };
    const download = {
      disabled: false,
      textContent: "Download log" as string | null,
    };
    const mark = { disabled: false, textContent: "Mark" as string | null };
    const clicks = new Map<object, () => void>();
    const on = (b: object) => ({
      addEventListener: (_type: "click", fn: () => void) => clicks.set(b, fn),
    });
    return {
      copy: Object.assign(copy, on(copy)),
      download: Object.assign(download, on(download)),
      mark: Object.assign(mark, on(mark)),
      clicks,
    };
  }

  // Why: the copy is async (the async-UI rule): busy, then the outcome,
  // and it reaches the clipboard only through the page's seam, with the
  // log's whole text.
  it("copies the log through the seam, saying it is busy and how it went", async () => {
    const log = createTravelLog({ knobs: KNOBS });
    frames(log, 1, 60);
    const b = buttons();
    const written: string[] = [];
    let release: () => void = () => undefined;
    wireTravelLogButtons({
      copy: b.copy,
      download: b.download,
      mark: b.mark,
      save: () => Promise.resolve(true),
      log,
      write: (text) => {
        written.push(text);
        return new Promise<void>((r) => {
          release = r;
        });
      },
      now: () => 1234,
    });
    b.clicks.get(b.copy)?.();
    await Promise.resolve();
    expect(b.copy.disabled).toBe(true);
    expect(b.copy.textContent).toBe("Copying...");
    expect(written).toEqual([log.text()]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(b.copy.disabled).toBe(false);
    expect(b.copy.textContent).toBe("Log copied");
    // Copied, so emptied: the next copy holds the next run alone.
    expect(log.size().samples).toBe(0);
    expect(log.readout(null)).toEqual([
      "log cleared after the copy (10 samples)",
    ]);
  });

  // Why: the anchor field test and the QR instrument read their numbers
  // from the same Copy log: each section rides after the travel log in
  // turn, in the copy and in the download, and is emptied with it once
  // the text went out.
  it("appends the sections to the copied and downloaded text, and clears them", async () => {
    const log = createTravelLog({ knobs: KNOBS });
    frames(log, 1, 60);
    const b = buttons();
    const written: string[] = [];
    const saved: string[] = [];
    let cleared = 0;
    wireTravelLogButtons({
      copy: b.copy,
      download: b.download,
      mark: b.mark,
      save: (text) => {
        saved.push(text);
        return Promise.resolve(true);
      },
      log,
      write: (text) => {
        written.push(text);
        return Promise.resolve();
      },
      now: () => 0,
      appendices: [
        {
          text: () => ["--- anchors ---", "pass ms -"].join("\n"),
          clear: () => {
            cleared += 1;
          },
        },
        {
          text: () => "QRPERF",
          clear: () => {
            cleared += 10;
          },
        },
      ],
    });
    const travelText = log.text();
    b.clicks.get(b.copy)?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(written).toEqual([
      [travelText, "--- anchors ---", "pass ms -", "QRPERF"].join("\n"),
    ]);
    expect(cleared).toBe(11);
    b.clicks.get(b.download)?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(saved[0]?.endsWith("--- anchors ---\npass ms -\nQRPERF")).toBe(true);
    expect(cleared).toBe(22);
  });

  it("says a copy that failed, and stays usable", async () => {
    const log = createTravelLog({ knobs: KNOBS });
    const b = buttons();
    wireTravelLogButtons({
      copy: b.copy,
      download: b.download,
      mark: b.mark,
      save: () => Promise.resolve(true),
      log,
      write: () => Promise.reject(new Error("no clipboard")),
      now: () => 0,
    });
    b.clicks.get(b.copy)?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(b.copy.textContent).toBe("Copy failed");
    expect(b.copy.disabled).toBe(false);
  });

  // Why: a log too large for the clipboard goes out as a file instead,
  // async like the copy (busy, then the outcome); a saved log is emptied
  // like a copied one, a dismissed dialog keeps it and the label, and a
  // save that fails says so and keeps the log.
  it("downloads the log as the fallback, emptying it, or says how it ended", async () => {
    const log = createTravelLog({ knobs: KNOBS });
    frames(log, 1, 60);
    const b = buttons();
    const saved: string[] = [];
    let outcome: "fail" | "dismiss" | "save" = "fail";
    let finish: () => void = () => undefined;
    wireTravelLogButtons({
      copy: b.copy,
      download: b.download,
      mark: b.mark,
      log,
      write: undefined,
      save: (text) =>
        new Promise<boolean>((resolve, reject) => {
          finish = () => {
            if (outcome === "fail") {
              reject(new Error("no download"));
              return;
            }
            if (outcome === "save") saved.push(text);
            resolve(outcome === "save");
          };
        }),
      now: () => 0,
    });
    const settle = () => new Promise((r) => setTimeout(r, 0));
    b.clicks.get(b.download)?.();
    expect(b.download.disabled).toBe(true);
    expect(b.download.textContent).toBe("Saving...");
    finish();
    await settle();
    expect(b.download.textContent).toBe("Download failed");
    expect(b.download.disabled).toBe(false);
    expect(log.size().samples).toBe(10);
    outcome = "dismiss";
    b.clicks.get(b.download)?.();
    finish();
    await settle();
    expect(b.download.textContent).toBe("Download log");
    expect(log.size().samples).toBe(10);
    outcome = "save";
    const text = log.text();
    b.clicks.get(b.download)?.();
    finish();
    await settle();
    expect(saved).toEqual([text]);
    expect(b.download.textContent).toBe("Log downloaded");
    expect(log.size().samples).toBe(0);
    expect(log.readout(null)[0]).toContain("cleared after the download");
  });

  // Why: a Mark is the walker's "reading got hard here"; it must land in
  // the log at the moment of the tap and say how many there are.
  it("marks the log at the tap's time, counting the marks", () => {
    const log = createTravelLog({ knobs: KNOBS });
    const b = buttons();
    let now = 500;
    wireTravelLogButtons({
      copy: b.copy,
      download: b.download,
      mark: b.mark,
      save: () => Promise.resolve(true),
      log,
      write: () => Promise.resolve(),
      now: () => now,
    });
    b.clicks.get(b.mark)?.();
    now = 900;
    b.clicks.get(b.mark)?.();
    expect(log.events()).toEqual([
      { kind: "mark", t: 500 },
      { kind: "mark", t: 900 },
    ]);
    expect(b.mark.textContent).toBe("Mark (2)");
  });
});

describe("replaying a logged walk under other knobs", () => {
  /** A slow retreat from 2 m to 16 m over 28 s at 10 Hz, portrait (508
   *  px/m), the sign growing as the app grows it: the letter is the em,
   *  0.136 m, times the growth, over the distance (plan 9.1). */
  function retreat() {
    const log = createTravelLog({ knobs: KNOBS });
    for (let i = 0; i <= 280; i++) {
      const t = i * 100;
      const d = 2 + (14 * i) / 280;
      const growth = Math.min(1.6, Math.max(1, d / 4.5));
      const px = (508 * 0.136 * growth) / d;
      log.frame(sample(t, { px, distM: d }));
    }
    return { samples: log.samples(), events: log.events() };
  }
  const knobs = (over: Partial<TravellingBoxKnobs>): TravellingBoxKnobs => ({
    ...KNOBS,
    ...over,
  });
  const dockAt = (r: ReturnType<typeof replayPlaces>) =>
    r.changes.find((c) => c.place === "dock")?.t ?? null;

  // Why: the threshold's sweep (R1): from the one walk, each threshold's
  // dock distance; a lower one docks later on the retreat, and above the
  // plateau (15.4 px) the path decides: with the keep band a visitor who
  // reached the plate near the sign keeps it through the plateau, to
  // about 7.2 m (plan 9.1).
  it("docks later on a retreat the lower the threshold", () => {
    const walk = retreat();
    const at = [10, 12, 14, 16].map((thr) =>
      dockAt(replayPlaces(walk, knobs({ thr }))),
    );
    for (const t of at) expect(t).not.toBeNull();
    expect(at[0]!).toBeGreaterThan(at[1]!);
    expect(at[1]!).toBeGreaterThan(at[2]!);
    expect(at[2]!).toBeGreaterThan(at[3]!);
    // 16 px, kept down to 15.2 px, holds past the plateau's end at 7.2 m
    // (t of 10.4 s), and not much further.
    expect(at[3]!).toBeGreaterThan(10_400);
    expect(at[3]!).toBeLessThan(11_500);
    // 12 px, kept down to 11.4 px, holds to about 9.7 m (t near 15.4 s).
    expect(at[1]!).toBeGreaterThan(15_000);
    expect(at[1]!).toBeLessThan(16_500);
  });

  // Why: growth on or off is decided by replay: without the growth the
  // same threshold docks much nearer (12 px: 9.2 m to 5.8 m).
  it("docks nearer without the sign's growth", () => {
    const walk = retreat();
    const grown = dockAt(replayPlaces(walk, knobs({ grow: true })));
    const flat = dockAt(replayPlaces(walk, knobs({ grow: false })));
    expect(flat).not.toBeNull();
    expect(flat!).toBeLessThan(grown!);
  });

  // Why: the hysteresis sweep (R3): standing at the threshold distance,
  // the letter jitters around 12 px; a wider keep band changes place less
  // often, and the replay counts the changes per minute.
  it("counts fewer changes at the edge with a wider keep band", () => {
    const log = createTravelLog({ knobs: KNOBS });
    for (let i = 0; i < 600; i++) {
      // A slow sway around 11.6 px: under 12, above 12 x 0.95 at times.
      const px = 11.6 + 0.9 * Math.sin(i / 7);
      log.frame(sample(i * 100, { px }));
    }
    const walk = { samples: log.samples(), events: log.events() };
    const narrow = replayPlaces(walk, knobs({ keep: 0.95 }));
    const wide = replayPlaces(walk, knobs({ keep: 0.85 }));
    expect(narrow.count).toBeGreaterThan(wide.count);
    expect(narrow.minutes).toBeCloseTo(1, 1);
    expect(narrow.perMinute).toBeCloseTo(narrow.count / narrow.minutes, 5);
  });

  // Why: the lock sweep (R5): a scrub on the plate that ends with the
  // plate illegible must not fly the words away under the lifting finger;
  // the replay honours the lock from the logged release, and counts the
  // flights that start within 1 s of one.
  it("honours the lock across a logged release", () => {
    const log = createTravelLog({ knobs: KNOBS });
    // On the plate, readable; then a finger is down while the letter
    // falls below the threshold; it lifts at 3 s.
    for (let i = 0; i <= 60; i++) {
      const t = i * 100;
      log.frame(
        sample(t, { px: t < 1_000 ? 20 : 8, finger: t >= 500 && t < 3_000 }),
      );
    }
    const walk = { samples: log.samples(), events: log.events() };
    expect(walk.events.map((e) => e.kind)).toEqual(["press", "release"]);
    const none = replayPlaces(walk, knobs({ lock: 0 }));
    const long = replayPlaces(walk, knobs({ lock: 1 }));
    const noneDock = dockAt(none)!;
    const longDock = dockAt(long)!;
    // Nothing moves under the finger.
    expect(noneDock).toBeGreaterThanOrEqual(3_000);
    expect(longDock).toBeGreaterThanOrEqual(4_000);
    expect(longDock).toBeGreaterThan(noneDock);
    // Within 1 s of the release without a lock; at 1 s or later with one.
    expect(none.afterRelease).toBe(1);
    expect(long.afterRelease).toBe(0);
  });

  // Why: a log that holds two travels (the voice ended, another began)
  // starts each one hidden, as the app does, rather than carrying the
  // first one's place over.
  it("starts each travel anew", () => {
    const log = createTravelLog({ knobs: KNOBS });
    for (let i = 0; i < 10; i++) log.frame(sample(i * 100));
    for (let i = 0; i < 10; i++) {
      log.frame(sample(60_000 + i * 100, { surface: "words:t2" }));
    }
    const r = replayPlaces(
      { samples: log.samples(), events: log.events() },
      KNOBS,
    );
    expect(r.changes.map((c) => [c.surface, c.place])).toEqual([
      ["words:t1", "plate"],
      ["words:t2", "plate"],
    ]);
  });

  // Why: appearing and hiding follow the voice, not the knobs, so the
  // sweep compares the plate, dock and fold changes alone.
  it("counts the moves among plate, dock and fold apart from appearing", () => {
    const log = createTravelLog({ knobs: KNOBS });
    for (let i = 0; i < 60; i++) {
      log.frame(sample(i * 100, { px: i < 30 ? 20 : 6 }));
    }
    const r = replayPlaces(
      { samples: log.samples(), events: log.events() },
      KNOBS,
    );
    expect(r.changes.map((c) => c.place)).toEqual(["plate", "dock"]);
    expect(r.count).toBe(2);
    expect(r.moves).toBe(1);
    expect(r.movesPerMinute).toBeCloseTo(r.moves / r.minutes, 5);
  });

  // Why: the sweep's first step checks that the replay under the walk's
  // own knobs gives the changes the app logged; a mismatch is reported at
  // its index, never smoothed over.
  it("self-checks the replay against the logged changes", () => {
    const log = createTravelLog({ knobs: KNOBS });
    for (let i = 0; i < 10; i++) log.frame(sample(i * 100));
    log.place({ at: 0, surface: "words:t1", place: "plate", why: "readable" });
    const good = replaySelfCheck(parseTravelLog(log.text()));
    expect(good).toEqual({
      logged: 1,
      replayed: 1,
      matched: 1,
      maxLagMs: 0,
      firstMismatch: null,
    });
    log.place({
      at: 500,
      surface: "words:t1",
      place: "dock",
      why: "too small",
    });
    const bad = replaySelfCheck(parseTravelLog(log.text()));
    expect(bad?.matched).toBe(1);
    expect(bad?.firstMismatch?.index).toBe(1);
    expect(bad?.firstMismatch?.replayed).toBeNull();
    expect(replaySelfCheck({ ...parseTravelLog(""), knobs: null })).toBeNull();
  });
});
