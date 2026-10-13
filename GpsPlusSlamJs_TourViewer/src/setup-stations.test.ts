/**
 * The setup page's stations (polish round M2b, the L5 look): which steps
 * are done, which is current, how far the route on the map is drawn, and
 * where back and next lead.
 *
 * Why these tests matter: the owner chose a page that shows one step at a
 * time as a station on a tour route. Its navigation must never offer a
 * "Next" past "Start creating" (P8) nor any row on the completion step
 * (P11), must never skip a step, and the drawn route must only ever grow
 * as the creator moves on - a route that shrank while they progressed
 * would read as going backwards.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { stationView, STATION_ROUTE_FRACTIONS } from "./setup-stations.js";
import { WIZARD_STEPS, type WizardStep } from "./wizard.js";

describe("stationView", () => {
  it("numbers the open step and marks the ones before it done", () => {
    const view = stationView("print");
    expect(view.number).toBe(3);
    expect(view.total).toBe(6);
    expect(view.states).toEqual([
      "done",
      "done",
      "current",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("offers no Back on the first step", () => {
    expect(stationView("host").back).toBeNull();
    expect(stationView("host").next).toBe("link");
  });

  it("offers no Next on the create step: Start creating is its action (P8)", () => {
    const view = stationView("measure");
    expect(view.back).toBe("hang");
    expect(view.next).toBeNull();
    expect(view.showNav).toBe(true);
  });

  it("shows no navigation row on the completion step (P11)", () => {
    const view = stationView("done");
    expect(view.showNav).toBe(false);
    expect(view.back).toBeNull();
    expect(view.next).toBeNull();
  });

  it("reads no open step as the first one, with nothing done", () => {
    expect(stationView(null)).toEqual(stationView("host"));
  });

  it("draws the whole route only at the completion step", () => {
    expect(stationView("done").routeFraction).toBe(1);
    expect(stationView("measure").routeFraction).toBeLessThan(1);
  });

  it("has one route fraction per step", () => {
    expect(STATION_ROUTE_FRACTIONS).toHaveLength(WIZARD_STEPS.length);
  });

  it("is consistent for every step (property)", () => {
    // Exactly one current station, the ones before it done, the ones after
    // it to do; back and next are the neighbours (where offered); the
    // route only grows with the step.
    const step = fc.constantFrom<WizardStep>(...WIZARD_STEPS);
    fc.assert(
      fc.property(step, step, (a, b) => {
        const va = stationView(a);
        const ia = WIZARD_STEPS.indexOf(a);
        expect(va.states.filter((s) => s === "current")).toHaveLength(1);
        expect(va.states.slice(0, ia).every((s) => s === "done")).toBe(true);
        expect(va.states.slice(ia + 1).every((s) => s === "todo")).toBe(true);
        expect(
          va.back === null || WIZARD_STEPS.indexOf(va.back) === ia - 1,
        ).toBe(true);
        expect(
          va.next === null || WIZARD_STEPS.indexOf(va.next) === ia + 1,
        ).toBe(true);
        const ib = WIZARD_STEPS.indexOf(b);
        const vb = stationView(b);
        expect(ia >= ib || va.routeFraction < vb.routeFraction).toBe(true);
      }),
    );
  });
});
