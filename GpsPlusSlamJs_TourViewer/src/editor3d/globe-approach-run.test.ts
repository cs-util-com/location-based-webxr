// @vitest-environment jsdom
/**
 * Why these tests matter: the run is where the owner's rules for the
 * approach meet the frame loop - the bar finishes on landing and the box
 * goes a beat later, an input in the 3D view takes the camera where it is
 * (the box goes at once), a list click retargets, and the bar is announced
 * as a progress bar. The box carries only its title and the bar: the owner
 * dropped the detail line under it, which said "Loading textures" for the
 * whole flight and after it without telling him anything. A wrong phase
 * here would be an input fought or a box that never leaves.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APPROACH_TITLE,
  BAR_DONE_MS,
  createApproachRun,
  type ApproachDriver,
} from "./globe-approach-run.js";

const START_KM = 8_000;

/**
 * A flight as the run sees it: started by the first drive, landing
 * `durationMs` later (0: a cut, landed on its first frame), falling
 * evenly from `START_KM`; the bar is the share fallen. It records what
 * the run asked of it.
 */
function fakeDriver(durationMs = 13_000) {
  let startedAt: number | null = null;
  const calls: string[] = [];
  const driver: ApproachDriver & {
    calls: string[];
    altitudeKm(nowMs: number): number;
  } = {
    durationMs,
    calls,
    start(nowMs) {
      calls.push(`start ${nowMs}`);
      startedAt ??= nowMs;
    },
    drive(nowMs) {
      return nowMs - (startedAt ?? nowMs) < durationMs;
    },
    retarget(place, groundM) {
      calls.push(`retarget ${place.lat} ${place.lng} ${groundM}`);
    },
    takeOver(nowMs) {
      calls.push(`takeOver ${nowMs}`);
    },
    bar: (altitudeKm) => 1 - altitudeKm / START_KM,
    altitudeKm(nowMs) {
      const t =
        durationMs > 0 ? (nowMs - (startedAt ?? nowMs)) / durationMs : 1;
      return START_KM * (1 - Math.min(1, Math.max(0, t)));
    },
  };
  return driver;
}

function run(reducedMotion = false, durationMs = reducedMotion ? 0 : 13_000) {
  const box = document.createElement("div");
  document.body.append(box);
  const flight = fakeDriver(durationMs);
  const r = createApproachRun({ box, driver: flight, reducedMotion });
  r.drive(0);
  return { box, flight, r };
}

/** One frame at `t`: the run drives the camera, then reads its altitude. */
function stepAt(
  r: ReturnType<typeof run>["r"],
  t: number,
  flight?: ReturnType<typeof fakeDriver>,
): void {
  r.drive(t);
  r.step(t, flight?.altitudeKm(t) ?? 0);
}

/** The box's root element. */
const rootOf = (box: HTMLElement) =>
  box.querySelector<HTMLElement>(".approach")!;

afterEach(() => {
  document.body.replaceChildren();
});

describe("createApproachRun", () => {
  it("shows the title over a progress bar with a value, and nothing else", () => {
    // Why: the owner's accessibility rule - a progressbar role with a
    // value and a name; and his verdict on the detail line: gone, only
    // "Loading tour" and the bar stay.
    const { box, flight, r } = run();
    stepAt(r, 0, flight);
    const bar = box.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("0");
    expect(bar?.getAttribute("aria-label")).toBe("Loading tour");
    const title = box.querySelector<HTMLElement>(".approach-title");
    expect(title?.textContent).toBe(APPROACH_TITLE);
    expect(title?.hidden).toBe(false);
    expect(box.querySelector(".approach-line")).toBeNull();
    expect(box.querySelector('[role="status"]')).toBeNull();
    expect(rootOf(box).children).toHaveLength(2);
    expect(r.stats()).not.toHaveProperty("line");
  });

  it("moves the bar with the camera, finishes it on landing, and goes after its hold", () => {
    // Why: the bar is driven by the camera's height, never by a timer of
    // its own, and reaches its end exactly when the camera lands; it
    // stays full for a beat so its finish is seen, then the whole box
    // goes (it used to wait for the line, which is gone).
    const { box, flight, r } = run();
    stepAt(r, flight.durationMs / 2, flight);
    const mid = r.stats().progress ?? -1;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(r.holdsStations()).toBe(true);
    stepAt(r, flight.durationMs);
    expect(r.stats()).toMatchObject({
      phase: "arrived",
      ended: "landed",
      flying: false,
      progress: 1,
    });
    expect(r.holdsStations()).toBe(false);
    expect(r.drive(flight.durationMs + 1)).toBe(false);
    const bar = box.querySelector<HTMLElement>('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("100");
    stepAt(r, flight.durationMs + BAR_DONE_MS - 1);
    expect(rootOf(box).hidden).toBe(false);
    expect(r.stats().progress).toBe(1);
    stepAt(r, flight.durationMs + BAR_DONE_MS);
    expect(rootOf(box).hidden).toBe(true);
    expect(r.stats().progress).toBeNull();
  });

  it("goes after the bar's hold however long the ground still loads, and stays gone", () => {
    // Why: the box's end used to follow the line, which waited for the
    // last tile; with the line gone nothing may keep the box over the
    // view after the landing, and the run takes no load counts at all.
    const { box, flight, r } = run();
    const land = flight.durationMs;
    for (let t = land; t <= land + BAR_DONE_MS; t += 16) stepAt(r, t);
    stepAt(r, land + BAR_DONE_MS);
    expect(rootOf(box).hidden).toBe(true);
    stepAt(r, land + 60_000);
    expect(rootOf(box).hidden).toBe(true);
    expect(r.step.length).toBe(2);
  });

  it("is finished once the arrival is over and the box is gone, not before", () => {
    // Why: the view frees the run on `finished`; ending it with the box
    // still up would leave a full bar over the view for good.
    const { flight, r } = run();
    const land = flight.durationMs;
    stepAt(r, land);
    expect(r.finished(land, 3)).toBe(false);
    stepAt(r, land + BAR_DONE_MS);
    expect(r.finished(land + BAR_DONE_MS, 3)).toBe(false);
    stepAt(r, land + 60_000);
    expect(r.finished(land + 60_000, 3)).toBe(true);
  });

  it("lets the creator take the camera where it is, the box gone at once", () => {
    // Why: an input in the 3D view takes over at once; the run must stop
    // giving poses, or the controls and the flight would fight. A taken
    // bar did not finish, so it does not stay to be seen finishing.
    const { box, flight, r } = run();
    stepAt(r, 3_000);
    r.takeOver(3_000);
    expect(r.drive(3_016)).toBe(false);
    expect(flight.calls).toContain("takeOver 3000");
    expect(r.stats().ended).toBe("taken");
    expect(r.holdsStations()).toBe(false);
    stepAt(r, 3_016);
    expect(rootOf(box).hidden).toBe(true);
    // The stations pop in from the takeover.
    expect(r.pop(0, 3_000)?.scale).toBe(0);
    expect(r.pop(0, 3_000 + 5_000)?.scale).toBe(1);
  });

  it("retargets a flight to a station picked mid-flight", () => {
    // Why: a list click mid-flight sends the flight there (the flight's own
    // leg from where the camera is), and the flight still ends; after the
    // landing the caller places the camera itself.
    const { flight, r } = run();
    stepAt(r, 4_000);
    expect(r.retarget({ lat: 46.9485, lng: 7.448 }, 515.5)).toBe(true);
    expect(flight.calls).toContain("retarget 46.9485 7.448 515.5");
    expect(r.stats().retargets).toBe(1);
    stepAt(r, 60_000);
    expect(r.stats().ended).toBe("landed");
    expect(r.retarget({ lat: 46.9, lng: 7.4 }, 515.5)).toBe(false);
    expect(r.stats().retargets).toBe(1);
  });

  it("starts the flight on its first drive, once", () => {
    // Why: the flight's clock starts at the first drawn frame, not when
    // the view was made (the first frame can come much later).
    const { flight, r } = run();
    r.drive(16);
    r.drive(32);
    expect(flight.calls.filter((c) => c.startsWith("start"))).toEqual([
      "start 0",
    ]);
  });

  it("reports the flight's length, 0 for a cut", () => {
    // Why: the page's checks read how long the flight was meant to take;
    // under reduced motion it is a cut, no flight at all.
    expect(run().r.stats().durationMs).toBe(13_000);
    expect(run(true).r.stats().durationMs).toBe(0);
  });

  it("does not hide the box while flying", () => {
    // Why: a box that goes mid-flight is the "looks stuck" the owner
    // ruled out; the title says what happens while the bar moves.
    const { box, r } = run();
    for (let t = 0; t < 5_000; t += 100) stepAt(r, t);
    expect(rootOf(box).hidden).toBe(false);
    expect(box.querySelector(".approach-title")?.textContent).toBe(
      APPROACH_TITLE,
    );
  });

  it("under reduced motion lands on its first frame and goes after the same hold", () => {
    // Why: reduced motion cuts to the end view (no flight) and shortens
    // the pop-in; the hold is no motion, so the finish is still seen.
    const { box, flight, r } = run(true);
    expect(flight.durationMs).toBe(0);
    r.step(0, 0);
    expect(r.stats().ended).toBe("landed");
    expect(rootOf(box).hidden).toBe(false);
    stepAt(r, flight.durationMs + BAR_DONE_MS);
    expect(rootOf(box).hidden).toBe(true);
  });

  /** A run that reports to `done` when its box goes. */
  const reporting = (done: () => void) => {
    const box = document.createElement("div");
    document.body.append(box);
    const flight = fakeDriver();
    const r = createApproachRun({
      box,
      driver: flight,
      reducedMotion: false,
      onDone: done,
    });
    r.drive(0);
    return { flight, r };
  };

  it("calls onDone once, after the bar's hold that follows a landing", () => {
    // Why: the editor unfolds its rail when the bar goes; a call before the
    // hold, or a second one, would unfold it at the wrong time.
    const done = vi.fn();
    const { flight, r } = reporting(done);
    const land = flight.durationMs;
    stepAt(r, land);
    expect(done).not.toHaveBeenCalled();
    stepAt(r, land + BAR_DONE_MS - 1);
    expect(done).not.toHaveBeenCalled();
    stepAt(r, land + BAR_DONE_MS);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("landed");
    stepAt(r, land + 60_000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("calls onDone once, at once after a takeover, saying it was taken", () => {
    // Why: a taken bar goes at once; the editor unfolds the rail only at a
    // landing, so a takeover (a click, a wheel, "+") must say it was one,
    // or the rail opens over the whole globe at any height.
    const done = vi.fn();
    const { r } = reporting(done);
    stepAt(r, 3_000);
    r.takeOver(3_000);
    stepAt(r, 3_016);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("taken");
    stepAt(r, 60_000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("does not call onDone when disposed before the box goes", () => {
    // Why: a view closed mid-flight never landed; the editor gives the
    // rail back on its own close.
    const box = document.createElement("div");
    const done = vi.fn();
    const r = createApproachRun({
      box,
      driver: fakeDriver(),
      reducedMotion: false,
      onDone: done,
    });
    r.drive(0);
    stepAt(r, 1_000);
    r.dispose();
    expect(done).not.toHaveBeenCalled();
  });

  it("removes its element on dispose", () => {
    // Why: closing the view must not leave the bar over the next one.
    const { box, r } = run();
    r.dispose();
    expect(box.querySelector(".approach")).toBeNull();
  });
});
