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
import { afterEach, describe, expect, it } from "vitest";

import { aimView, streetView } from "./globe-editor-look.js";
import { approachFlight } from "./globe-approach-flight.js";
import {
  APPROACH_TITLE,
  BAR_DONE_MS,
  createApproachRun,
} from "./globe-approach-run.js";

const GROUND_M = 515.5;
const GOAL = streetView({ lat: 46.948, lng: 7.4474 }, GROUND_M);

function run(reducedMotion = false) {
  const box = document.createElement("div");
  document.body.append(box);
  const flight = approachFlight(GOAL, GROUND_M, { reducedMotion });
  const r = createApproachRun({ box, flight, startMs: 0, reducedMotion });
  return { box, flight, r };
}

/** Step the run at `t` with the camera where the flight has it. */
function stepAt(r: ReturnType<typeof run>["r"], t: number): void {
  const pose = r.poseAt(t);
  r.step(t, pose?.altitudeKm ?? GOAL.altitudeKm);
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
    const { box, r } = run();
    stepAt(r, 0);
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
    stepAt(r, flight.durationMs / 2);
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
    expect(r.poseAt(flight.durationMs + 1)).toBeNull();
    const bar = box.querySelector<HTMLElement>('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("100");
    stepAt(r, flight.durationMs + BAR_DONE_MS - 1);
    expect(rootOf(box).hidden).toBe(false);
    expect(r.stats().progress).toBe(1);
    stepAt(r, flight.durationMs + BAR_DONE_MS);
    expect(rootOf(box).hidden).toBe(true);
    expect(rootOf(box).dataset["phase"]).toBe("arrived");
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
    const { box, r } = run();
    stepAt(r, 3_000);
    r.takeOver(3_000);
    expect(r.poseAt(3_016)).toBeNull();
    expect(r.stats().ended).toBe("taken");
    expect(r.holdsStations()).toBe(false);
    stepAt(r, 3_016);
    expect(rootOf(box).hidden).toBe(true);
    // The stations pop in from the takeover.
    expect(r.pop(0, 3_000)?.scale).toBe(0);
    expect(r.pop(0, 3_000 + 5_000)?.scale).toBe(1);
  });

  it("retargets a flight to a station picked mid-flight", () => {
    // Why: a list click mid-flight sends the flight there, from where the
    // camera is, and the flight still ends.
    const { r } = run();
    const at = 4_000;
    const now = r.poseAt(at)!;
    const station = aimView({ lat: 46.9485, lng: 7.448 }, GROUND_M, 20);
    expect(r.retarget(at, now, station, GROUND_M)).toBe(true);
    expect(r.poseAt(at)).toEqual(now);
    expect(r.stats().retargets).toBe(1);
    stepAt(r, at + 60_000);
    expect(r.stats().ended).toBe("landed");
    expect(r.retarget(at + 60_001, station, GOAL, GROUND_M)).toBe(false);
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

  it("under reduced motion lands soon and goes after the same hold", () => {
    // Why: reduced motion shortens the flight and the pop-in; the hold is
    // no motion, so the finish is still seen.
    const { box, flight, r } = run(true);
    expect(flight.durationMs).toBeLessThanOrEqual(3_000);
    stepAt(r, flight.durationMs);
    expect(rootOf(box).hidden).toBe(false);
    stepAt(r, flight.durationMs + BAR_DONE_MS);
    expect(rootOf(box).hidden).toBe(true);
  });

  it("removes its element on dispose", () => {
    // Why: closing the view must not leave the bar over the next one.
    const { box, r } = run();
    r.dispose();
    expect(box.querySelector(".approach")).toBeNull();
  });
});
