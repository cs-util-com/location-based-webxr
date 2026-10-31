// @vitest-environment jsdom
/**
 * Why these tests matter: the run is where the owner's rules for the
 * approach meet the frame loop - the bar finishes on landing and goes,
 * an input in the 3D view takes the camera where it is, a list click
 * retargets, the line stays while anything still loads and then goes for
 * good, and the bar and line are announced as a progress bar and a polite
 * status. A wrong phase here would be an input fought or a line that
 * never leaves.
 */
import { afterEach, describe, expect, it } from "vitest";

import { aimView, streetView } from "./globe-editor-look.js";
import { approachFlight } from "./globe-approach-flight.js";
import { createApproachRun, LINE_FADE_MS } from "./globe-approach-run.js";
import { LINE_HOLD_MS } from "./approach-status.js";

const GROUND_M = 515.5;
const GOAL = streetView({ lat: 46.948, lng: 7.4474 }, GROUND_M);
const none = { tour: 0, textures: 0, buildings: 0 };

function run(reducedMotion = false) {
  const box = document.createElement("div");
  document.body.append(box);
  const flight = approachFlight(GOAL, GROUND_M, { reducedMotion });
  const r = createApproachRun({ box, flight, startMs: 0, reducedMotion });
  return { box, flight, r };
}

/** Step the run at `t` with the camera where the flight has it. */
function stepAt(
  r: ReturnType<typeof run>["r"],
  t: number,
  pending = none,
): void {
  const pose = r.poseAt(t);
  r.step(t, pose?.altitudeKm ?? GOAL.altitudeKm, pending);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("createApproachRun", () => {
  it("shows a progress bar with a value and a polite line", () => {
    // Why: the owner's accessibility rule - a progressbar role with a
    // value, the line announced politely.
    const { box, r } = run();
    stepAt(r, 0);
    const bar = box.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("0");
    expect(bar?.getAttribute("aria-label")).toBe("Loading tour");
    const line = box.querySelector('[role="status"]');
    expect(line?.getAttribute("aria-live")).toBe("polite");
    expect(line?.textContent).toBe("Loading tour");
  });

  it("moves the bar with the camera and finishes it on landing", () => {
    // Why: the bar is driven by the camera's height, never by a timer of
    // its own, and reaches its end exactly when the camera lands.
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
      progress: null,
    });
    expect(r.holdsStations()).toBe(false);
    expect(r.poseAt(flight.durationMs + 1)).toBeNull();
    const bar = box.querySelector<HTMLElement>('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("100");
    expect(bar?.hidden).toBe(true);
  });

  it("lets the creator take the camera where it is", () => {
    // Why: an input in the 3D view takes over at once; the run must stop
    // giving poses, or the controls and the flight would fight.
    const { r } = run();
    stepAt(r, 3_000);
    r.takeOver(3_000);
    expect(r.poseAt(3_016)).toBeNull();
    expect(r.stats().ended).toBe("taken");
    expect(r.holdsStations()).toBe(false);
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

  it("keeps the line after the landing while things load, then fades it for good", () => {
    // Why: the owner's rule - only the line stays while buildings or
    // textures are still coming, and fades out when they are in; once
    // gone it must not come back on every later pan.
    const { box, flight, r } = run();
    const land = flight.durationMs;
    stepAt(r, land, { tour: 0, textures: 3, buildings: 0 });
    stepAt(r, land + LINE_HOLD_MS, { tour: 0, textures: 3, buildings: 0 });
    expect(r.stats().line).toBe("Loading textures");
    const root = box.querySelector<HTMLElement>(".approach")!;
    stepAt(r, land + 2 * LINE_HOLD_MS);
    expect(root.classList.contains("gone")).toBe(true);
    expect(r.stats().line).toBeNull();
    expect(root.hidden).toBe(false);
    stepAt(r, land + 2 * LINE_HOLD_MS + LINE_FADE_MS);
    expect(root.hidden).toBe(true);
    stepAt(r, land + 10_000, { tour: 0, textures: 9, buildings: 0 });
    expect(root.hidden).toBe(true);
    expect(r.finished(land + 10_000, 3)).toBe(true);
  });

  it("does not hide the line while flying, whatever is pending", () => {
    // Why: a wordless bar mid-flight is the "looks stuck" the owner ruled
    // out.
    const { r } = run();
    for (let t = 0; t < 5_000; t += 100) stepAt(r, t);
    expect(r.stats().line).toBe("Loading tour");
  });

  it("under reduced motion lands soon and drops the line without a fade", () => {
    // Why: reduced motion shortens the flight and the pop-in, and must
    // not leave a fading line either.
    const { box, flight, r } = run(true);
    expect(flight.durationMs).toBeLessThanOrEqual(3_000);
    stepAt(r, flight.durationMs);
    stepAt(r, flight.durationMs + LINE_HOLD_MS);
    expect(box.querySelector<HTMLElement>(".approach")!.hidden).toBe(true);
  });

  it("removes its element on dispose", () => {
    // Why: closing the view must not leave the bar over the next one.
    const { box, r } = run();
    r.dispose();
    expect(box.querySelector(".approach")).toBeNull();
  });
});
