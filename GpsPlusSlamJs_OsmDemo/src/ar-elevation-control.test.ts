/**
 * Why this test matters: two of these assertions guard regressions that have
 * already shipped in this repo — an element left in `#ar-root` keeping a
 * full-viewport layer over the page when AR is off, and a control that fires its
 * expensive callback for a press that changed nothing. The rest is the contract
 * the AR wiring depends on.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";

import { NUDGE_LIMIT_M, NUDGE_STEP_M } from "./elevation-nudge.js";
import { createArElevationControl } from "./ar-elevation-control.js";

function harness() {
  const root = document.createElement("div");
  document.body.append(root);
  const onChange = vi.fn();
  const control = createArElevationControl({ root, onChange });
  const buttons = () => [...root.querySelectorAll("button")];
  const press = (label: string) => {
    const target = buttons().find((b) => b.textContent === label);
    if (target === undefined) throw new Error(`no ${label} button`);
    target.click();
  };
  return { root, onChange, control, press };
}

describe("createArElevationControl", () => {
  it("stays OUT of the overlay root until attached", () => {
    // `#ar-root` is `position: fixed; inset: 0` and hidden only while `:empty`,
    // so a speculatively attached control covers the whole page whenever AR is
    // not running. That regression has shipped here once already.
    const { root, control } = harness();
    expect(root.children).toHaveLength(0);
    control.attach();
    expect(root.children).toHaveLength(1);
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

  it("raises and lowers by one step, and reports each change", () => {
    const { control, onChange, press } = harness();
    control.attach();

    press("+");
    expect(control.offsetM()).toBe(NUDGE_STEP_M);
    expect(onChange).toHaveBeenLastCalledWith(NUDGE_STEP_M);

    press("−");
    press("−");
    expect(control.offsetM()).toBe(-NUDGE_STEP_M);
    expect(onChange).toHaveBeenLastCalledWith(-NUDGE_STEP_M);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("shows the value, signed, including zero", () => {
    const { root, control, press } = harness();
    control.attach();
    expect(root.textContent).toContain("0 m");
    press("+");
    expect(root.textContent).toContain("+1 m");
    press("−");
    press("−");
    expect(root.textContent).toContain("−1 m");
  });

  it("does NOT fire onChange for a press that moved nothing", () => {
    // `onChange` re-attaches the whole city's transform. Firing it at the bound
    // would rebuild that for free, every press, for as long as the user leans on
    // the button.
    const { control, onChange, press } = harness();
    control.attach();
    for (let i = 0; i < NUDGE_LIMIT_M + 5; i += 1) press("+");
    expect(control.offsetM()).toBe(NUDGE_LIMIT_M);
    expect(onChange).toHaveBeenCalledTimes(NUDGE_LIMIT_M / NUDGE_STEP_M);
  });

  it("gives both buttons an accessible name", () => {
    // `#ar-root` is no longer inert, so its contents are reachable — and a bare
    // "+" glyph tells a screen-reader user nothing.
    const { root, control } = harness();
    control.attach();
    for (const b of root.querySelectorAll("button")) {
      expect(b.getAttribute("aria-label")).toMatch(/map by/);
    }
  });
});
