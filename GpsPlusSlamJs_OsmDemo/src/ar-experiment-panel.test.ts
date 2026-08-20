/**
 * @vitest-environment jsdom
 *
 * Tests for the AR experimental-compass panel (DEC-Y10, Q2 step 5).
 *
 * Why these tests matter: five controls against a camera feed on a 390 px phone
 * is a layout that does not exist, so they live behind a gear and the panel is
 * closed by default. Three properties carry the feature — it stays out of the
 * way until asked for, it reports every control to one place, and it CLOSES
 * ITSELF on a change, because a panel left open covers the scene the change was
 * made to judge. That last one has a recorded defect behind it: G9 reported
 * exactly that about the compass slider.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createArExperimentPanel,
  type ArExperimentPanel,
} from "./ar-experiment-panel.js";
import { COMPASS_EXPERIMENT_DEFAULTS } from "./compass-influence.js";

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});

const build = (
  onChange = vi.fn(),
): { panel: ArExperimentPanel; onChange: ReturnType<typeof vi.fn> } => {
  const panel = createArExperimentPanel({
    root,
    initial: COMPASS_EXPERIMENT_DEFAULTS,
    onChange,
  });
  panel.attach();
  return { panel, onChange };
};

const gear = (): HTMLButtonElement => {
  const button = root.querySelector(".ar-gear");
  if (!(button instanceof HTMLButtonElement)) throw new Error("no gear");
  return button;
};

const body = (): HTMLElement => {
  const element = root.querySelector(".ar-experiments");
  if (!(element instanceof HTMLElement)) throw new Error("no panel");
  return element;
};

const control = (id: string): HTMLInputElement | HTMLSelectElement => {
  const element = root.querySelector(`#${id}`);
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLSelectElement)
  ) {
    throw new Error(`no control ${id}`);
  }
  return element;
};

describe("createArExperimentPanel", () => {
  it("is CLOSED on attach, so normal AR use is uncluttered", () => {
    build();
    expect(body().hidden).toBe(true);
    expect(gear().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on the gear and closes again on a second press", () => {
    build();
    gear().click();
    expect(body().hidden).toBe(false);
    expect(gear().getAttribute("aria-expanded")).toBe("true");
    gear().click();
    expect(body().hidden).toBe(true);
  });

  it("names itself for a screen reader, since a gear glyph says nothing", () => {
    build();
    expect(gear().getAttribute("aria-label")).toMatch(/experiment/i);
    expect(gear().getAttribute("aria-controls")).toBe(body().id);
    expect(body().id).not.toBe("");
  });

  it("CLOSES ITSELF when a control changes, so the scene is visible to judge", () => {
    // The whole reason the panel exists behind a gear: a change is made in
    // order to look at the buildings, and a panel still covering them defeats
    // it. G9 reported this about the compass slider; repeating it here would be
    // the same complaint with a new control.
    const { onChange } = build();
    gear().click();
    expect(body().hidden).toBe(false);

    const prior = control("ar-exp-prior") as HTMLInputElement;
    prior.checked = false;
    prior.dispatchEvent(new Event("change", { bubbles: true }));

    expect(body().hidden).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reports EVERY control's value on any single change", () => {
    // One callback carrying the whole configuration, not per-control deltas:
    // `compassSettingsFor` needs all of them together, and a partial update
    // would leave the store describing a mixture of two configurations.
    const { onChange } = build();
    gear().click();

    const gate = control("ar-exp-gate") as HTMLSelectElement;
    gate.value = "off";
    gate.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith({
      rotationPriorEnabled: true,
      trustGateMode: "off",
      pairSelectionEnabled: true,
      trustToleranceDeg: 15,
      webXRConsistencyEnabled: false,
    });
  });

  it("offers all three gate modes, because two would not be an experiment", () => {
    build();
    const gate = control("ar-exp-gate") as HTMLSelectElement;
    const values = [...gate.options].map((option) => option.value);
    expect(values).toEqual(["off", "binary", "ramp"]);
    // Starts where the demo ships, not at the library default.
    expect(gate.value).toBe("ramp");
  });

  it("offers the three trust tolerances the census swept", () => {
    // 8 is the library default and the RecorderApp's, where trust rarely
    // latches on a real phone; 15 is what this demo ships; 25 is the widest arm
    // the census measured. Anything else would be a value with no baseline.
    build();
    const tolerance = control("ar-exp-tolerance") as HTMLSelectElement;
    expect([...tolerance.options].map((option) => option.value)).toEqual([
      "8",
      "15",
      "25",
    ]);
    expect(tolerance.value).toBe("15");
  });

  it("starts every control at the shipped configuration", () => {
    build();
    expect((control("ar-exp-prior") as HTMLInputElement).checked).toBe(true);
    expect((control("ar-exp-pairs") as HTMLInputElement).checked).toBe(true);
    expect((control("ar-exp-consistency") as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("releases the DOM on dispose, and is idempotent", () => {
    const { panel } = build();
    panel.dispose();
    expect(root.querySelector(".ar-gear")).toBeNull();
    expect(() => {
      panel.dispose();
    }).not.toThrow();
  });
});
