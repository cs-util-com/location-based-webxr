/**
 * Why this test matters: every compass setter is a **silent no-op before the
 * first GPS fix** — the reducer returns state unchanged while `gpsData` is
 * null. So the failure this file exists to prevent is a slider that accepts a
 * drag, shows the new number, and dispatches into a void: the UI and the store
 * then disagree for the rest of the session, with nothing on screen saying so.
 * The latch-and-flush tests are the ones carrying that weight.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";

import { COMPASS_INFLUENCE_DEFAULT } from "./compass-influence.js";
import { createArCompassControl } from "./ar-compass-control.js";

function harness(initialInfluence?: number) {
  const root = document.createElement("div");
  document.body.append(root);
  const onChange = vi.fn();
  const control = createArCompassControl({
    root,
    onChange,
    ...(initialInfluence === undefined ? {} : { initialInfluence }),
  });
  const slider = (): HTMLInputElement => {
    const found = root.querySelector("input");
    if (found === null) throw new Error("no slider");
    return found;
  };
  const drag = (to: number): void => {
    slider().value = String(to);
    slider().dispatchEvent(new Event("input"));
  };
  return { root, onChange, control, slider, drag };
}

describe("createArCompassControl", () => {
  it("stays OUT of the overlay root until attached", () => {
    // `#ar-root` is `position: fixed; inset: 0` and hidden only while `:empty`.
    const { root, control } = harness();
    expect(root.children).toHaveLength(0);
    control.attach();
    expect(root.children).toHaveLength(1);

    // AND IT CARRIES `.ar-compass`, which is a contract with the stylesheet
    // rather than decoration (round three, G9, DEC-W5). Placement is now a
    // property of `#ar-root`'s column, and the e2e that measures it has to
    // attach its OWN element carrying this class — a real AR session is
    // unreachable in headless Chromium. So this assertion is the seam that
    // keeps that test measuring the thing this module actually builds; without
    // it, renaming the class here would move the slider back into the middle of
    // the view with the whole suite green.
    expect(root.children[0]?.className).toBe("ar-compass");
  });

  it("removes itself on dispose, and both calls are idempotent", () => {
    const { root, control } = harness();
    control.attach();
    control.attach();
    expect(root.children).toHaveLength(1);
    control.dispose();
    control.dispose();
    expect(root.children).toHaveLength(0);
  });

  it("starts at the library's own default", () => {
    const { control } = harness();
    expect(control.influence()).toBe(COMPASS_INFLUENCE_DEFAULT);
  });

  it("is DISABLED and says why until a fix has landed", () => {
    // Every setter no-ops while the store's gps state is null. A control that
    // takes a drag and discards it is worse than one visibly not ready.
    const { root, control, slider } = harness();
    control.attach();

    expect(slider().disabled).toBe(true);
    expect(root.textContent).toContain("waiting for a GPS fix");

    control.setReady(true);
    expect(slider().disabled).toBe(false);
    expect(root.textContent).not.toContain("waiting for a GPS fix");
  });

  it("LATCHES a change made before the fix, and flushes it when one arrives", () => {
    // The failure this whole file is about: without the latch the drag is lost
    // and the UI disagrees with the store for the rest of the session.
    const { control, onChange, drag } = harness();
    control.attach();

    drag(0.6);
    expect(onChange).not.toHaveBeenCalled();
    expect(control.influence()).toBe(0.6);

    control.setReady(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ voteWeight: 0.6, rotationPriorEnabled: true }),
    );
  });

  it("does NOT re-dispatch on a later readiness change with nothing pending", () => {
    // `setReady` runs on every fix in the wiring; re-applying each time would
    // re-dispatch four settings once a second forever.
    //
    // COUNTS INCLUDE THE INITIAL DISPATCH since the PR #311 review: becoming
    // ready now applies whatever the control is showing, so the baseline is one
    // call rather than none. The property under test is unchanged — a REPEATED
    // `setReady(true)` must add nothing.
    const { control, onChange, drag } = harness();
    control.attach();
    control.setReady(true);
    expect(onChange).toHaveBeenCalledTimes(1); // the initial value
    drag(0.4);
    expect(onChange).toHaveBeenCalledTimes(2); // the drag

    control.setReady(true);
    control.setReady(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("dispatches the FULL silencing combination at zero", () => {
    // Three settings, not one — see `compass-influence.ts`. Asserted through
    // the control because that is the path the user actually takes.
    const { control, onChange, drag } = harness();
    control.attach();
    control.setReady(true);

    drag(0);
    expect(onChange).toHaveBeenLastCalledWith({
      rotationPriorEnabled: false,
      coldStartOverrideEnabled: false,
      experimentEnabled: false,
      voteWeight: 0,
    });
  });

  it("reports while dragging, not only when the finger lifts", () => {
    // A range control fires `change` on release; listening for that alone would
    // leave the readout lagging the thumb across the whole drag.
    const { root, control, drag } = harness();
    control.attach();
    control.setReady(true);

    drag(0.35);
    expect(root.textContent).toContain("compass 0.35");
  });

  it("names both ends rather than only numbering them", () => {
    const { root, control, drag } = harness();
    control.attach();
    control.setReady(true);

    drag(0);
    expect(root.textContent).toContain("GPS only");
    drag(1);
    expect(root.textContent).toContain("full");
  });

  it("warns that a change takes ~15-30 fixes to show", () => {
    // The applied bearing is smoothed at 0.15 per GPS event. An instrument that
    // looks broken for half a minute gets dragged again, which restarts it.
    const { root, control } = harness();
    control.attach();
    control.setReady(true);
    expect(root.textContent).toMatch(/15–30 fixes/);
  });

  it("gives the slider an accessible name", () => {
    const { control, slider } = harness();
    control.attach();
    expect(slider().getAttribute("aria-label")).toMatch(/compass/i);
  });
});

/**
 * Why these tests matter: found in review of PR #311. The control shows a value
 * from the moment it is built, so until something dispatches it the readout and
 * the store disagree — and they disagree about `coldStartOverrideEnabled`, whose
 * library default is ON while every slider position clears it. A session that
 * never touched the slider was measuring settings the UI did not describe, and
 * the field notes from it would look like data.
 */
describe("createArCompassControl — the initial value reaches the store", () => {
  it("dispatches what it is SHOWING as soon as it can, untouched", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onChange = vi.fn();
    const control = createArCompassControl({ root, onChange });
    control.attach();

    // Nobody has dragged anything.
    expect(onChange).not.toHaveBeenCalled();
    control.setReady(true);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        voteWeight: COMPASS_INFLUENCE_DEFAULT,
        // THE FIELD THAT MADE THIS A REAL BUG rather than a tidiness point: the
        // library default is ON, so without the dispatch the cold-start override
        // was still driving yaw while the slider claimed to be the only input.
        coldStartOverrideEnabled: false,
      }),
    );
  });

  it("dispatches a NON-default starting value too", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onChange = vi.fn();
    const control = createArCompassControl({
      root,
      onChange,
      initialInfluence: 0,
    });
    control.attach();
    control.setReady(true);

    // Zero is the position where silence would be least visible and most wrong.
    expect(onChange).toHaveBeenLastCalledWith({
      rotationPriorEnabled: false,
      coldStartOverrideEnabled: false,
      experimentEnabled: false,
      voteWeight: 0,
    });
  });

  it("still does not dispatch twice for a repeated setReady", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onChange = vi.fn();
    const control = createArCompassControl({ root, onChange });
    control.attach();
    control.setReady(true);
    control.setReady(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
