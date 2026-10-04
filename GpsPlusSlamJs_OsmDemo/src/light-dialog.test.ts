// @vitest-environment jsdom
/**
 * Tests for the light dialog (plan 2026-09-24-2140).
 *
 * Why this file matters: the owner tunes the noon by it. A slider that did
 * not reach the view, a Reset that left a value behind, a check that never
 * left "Measuring…", or a Copy that claimed success on a failure would each
 * mislead him while the page looked fine. The UI rule (async actions show an
 * in-progress state and end in the durable result) is asserted for both the
 * check and the copy, on success and on failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEAT_GRID_MARGIN_BOUND,
  createLightDialog,
  type LightDialogDeps,
} from "./light-dialog.js";
import {
  DEFAULT_LIGHT_SETTINGS,
  type LightSettings,
} from "./light-settings.js";

// Each test leaves no panel behind: jsdom resolves "#id" through the
// document, so a duplicate id from an earlier test would hide this one's.
afterEach(() => document.body.replaceChildren());

/** `defaultFrame` leaves `nextFrame` out, so the dialog uses its own. */
function setup(
  overrides: Partial<LightDialogDeps> = {},
  { defaultFrame = false } = {},
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const onChange = vi.fn<(s: LightSettings) => void>();
  const measure = vi.fn<LightDialogDeps["measure"]>(() => ({
    litLuma: 64.8,
    margin: 5.5,
    view: "CPU ground + slope",
  }));
  const showError = vi.fn<(message: string) => void>();
  const opener = document.createElement("button");
  document.body.append(opener);
  const frames: (() => void)[] = [];
  const dialog = createLightDialog({
    parent,
    opener,
    initial: DEFAULT_LIGHT_SETTINGS,
    onChange,
    measure,
    copyText: (s) => `light: gain ${s.gainMax}`,
    writeClipboard: () => Promise.resolve(),
    showError,
    ...(defaultFrame
      ? {}
      : { nextFrame: (callback: () => void) => frames.push(callback) }),
    ...overrides,
  });
  const $ = <T extends HTMLElement>(id: string) =>
    parent.querySelector<T>(`#${id}`)!;
  const slide = (field: keyof LightSettings, value: number) => {
    const input = $<HTMLInputElement>(`light-${field}`);
    input.value = String(value);
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
  };
  return {
    dialog,
    parent,
    opener,
    onChange,
    measure,
    showError,
    frames,
    $,
    slide,
  };
}

describe("createLightDialog", () => {
  it("starts hidden, opens with the brightness, and closes on Escape", () => {
    const { dialog, $, measure } = setup();
    expect(dialog.open).toBe(false);
    dialog.toggle();
    expect(dialog.open).toBe(true);
    expect(measure).toHaveBeenCalledTimes(1);
    expect($("light-readout").textContent).toBe("Lit surfaces 64.8");
    // Bubbling, as a real key press is.
    $("light-dialog").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(dialog.open).toBe(false);
  });

  // WHY (review, 2026-09-24): the dialog opens by its button or the l key, so
  // focus is OUTSIDE it and a panel-only Escape did nothing. Focus moves in on
  // open and back to the opener on close, and the opener says whether it is
  // expanded.
  it("closes on Escape from anywhere, and moves focus in and back out", () => {
    const { dialog, opener, $ } = setup();
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(opener.getAttribute("aria-controls")).toBe("light-dialog");
    opener.focus();
    dialog.toggle();
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe($("light-gainMax"));
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(dialog.open).toBe(false);
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(opener);
    // Closed, Escape is no longer the dialog's: it must not reopen or throw.
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(dialog.open).toBe(false);
  });

  // WHY: the brightness on a slider release is a readback of its own; the
  // margin's second render is only for the check (review finding 13).
  it("measures the brightness alone on release, and the margin only on the check", () => {
    const { measure, slide, $, frames } = setup();
    slide("gainMax", 2);
    expect(measure).toHaveBeenLastCalledWith(false);
    $("light-check").click();
    frames.shift()!();
    expect(measure).toHaveBeenLastCalledWith(true);
  });

  // WHY (review finding 2): DEC-LIGHT-5's comparison is made by moving the
  // sun and reading the number, so a readout left from the previous sun
  // would mislead. The page calls refresh() on every sun move.
  it("refreshes the brightness while open, and does nothing while closed", () => {
    const { dialog, measure, $ } = setup();
    dialog.refresh();
    expect(measure).not.toHaveBeenCalled();
    dialog.toggle();
    measure.mockReturnValue({ litLuma: 82.3, margin: null, view: "x" });
    dialog.refresh();
    expect($("light-readout").textContent).toBe("Lit surfaces 82.3");
  });

  // WHY: every slider must reach the view live, and show its value.
  it("applies a slider live and shows its value", () => {
    const { onChange, $, slide } = setup();
    slide("gainMax", 2);
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LIGHT_SETTINGS,
      gainMax: 2,
    });
    expect(
      $<HTMLOutputElement>("light-gainMax").nextElementSibling!.textContent,
    ).toBe("2");
    slide("exposureEv", -2.5);
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LIGHT_SETTINGS,
      gainMax: 2,
      exposureEv: -2.5,
    });
  });

  // WHY: the gain ramp must rise; a start dragged past the end moves the end.
  it("keeps the ramp rising", () => {
    const { onChange, slide } = setup();
    slide("gainFromDeg", 50);
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.gainFromDeg).toBe(50);
    expect(last.gainFullDeg).toBe(51);
    // And the other way round: an end dragged below the start moves the start.
    slide("gainFullDeg", 10);
    const back = onChange.mock.calls.at(-1)![0];
    expect(back.gainFullDeg).toBe(10);
    expect(back.gainFromDeg).toBe(9);
  });

  it("resets every value to the shipped look", () => {
    const { dialog, onChange, slide, $ } = setup();
    slide("gainMax", 2);
    slide("buildingSkyLight", 2);
    $("light-reset").click();
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_LIGHT_SETTINGS);
    expect(dialog.settings).toEqual(DEFAULT_LIGHT_SETTINGS);
    expect($<HTMLInputElement>("light-gainMax").value).toBe(
      String(DEFAULT_LIGHT_SETTINGS.gainMax),
    );
  });

  // WHY (UI rule): the check shows "Measuring…" until the measurement ends,
  // and ends in the result; pass and fail are both named.
  it("checks the heat grid through an in-progress state to the result", () => {
    const { $, frames, measure } = setup();
    const check = $<HTMLButtonElement>("light-check");
    check.click();
    expect(check.textContent).toBe("Measuring…");
    expect(check.disabled).toBe(true);
    frames.shift()!();
    expect(check.textContent).toBe("Check heat grid");
    expect(check.disabled).toBe(false);
    expect($("light-readout").textContent).toContain("adds 5.50");
    expect($("light-readout").textContent).toContain("ok");
    // The margin is for this view only, and the ground mode is part of it.
    expect($("light-readout").textContent).toContain("CPU ground + slope");
    measure.mockReturnValue({
      litLuma: 80,
      margin: HEAT_GRID_MARGIN_BOUND - 0.1,
      view: "x",
    });
    check.click();
    frames.shift()!();
    expect($("light-readout").textContent).toContain("below the bound");
    measure.mockReturnValue({ litLuma: 80, margin: null, view: "x" });
    check.click();
    frames.shift()!();
    expect($("light-readout").textContent).toContain("Turn on the heat grid");
  });

  it("ends the check in an error message when the measurement throws", () => {
    const { $, frames, measure } = setup();
    measure.mockImplementation(() => {
      throw new Error("no GL");
    });
    const check = $<HTMLButtonElement>("light-check");
    check.click();
    frames.shift()!();
    expect($("light-readout").textContent).toContain(
      "Could not measure: no GL",
    );
    expect(check.disabled).toBe(false);
  });

  // WHY (review finding 4): an animation frame callback runs BEFORE that
  // frame's paint, so doing the synchronous renders inside it meant
  // "Measuring…" was never on screen. The default waits for a frame and then
  // a task, which runs after the paint.
  it("by default measures only after a frame has painted", () => {
    vi.useFakeTimers();
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafs.push(cb);
      return rafs.length;
    });
    try {
      const { $, measure } = setup({}, { defaultFrame: true });
      $("light-check").click();
      expect(rafs).toHaveLength(1);
      rafs[0]!(0);
      expect(measure).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(measure).toHaveBeenCalledWith(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  // WHY (UI rule): Copy ends in "Copied" or "Copy failed", never silently.
  it("copies the settings, and says so on success and on failure", async () => {
    const writes: string[] = [];
    const ok = setup({
      writeClipboard: (text) => {
        writes.push(text);
        return Promise.resolve();
      },
    });
    ok.slide("gainMax", 1.8);
    const copy = ok.$<HTMLButtonElement>("light-copy");
    copy.click();
    expect(copy.textContent).toBe("Copying…");
    await vi.waitFor(() => expect(copy.textContent).toBe("Copied"));
    expect(writes).toEqual(["light: gain 1.8"]);
    ok.dialog.dispose();
    const bad = setup({
      writeClipboard: () => Promise.reject(new Error("denied")),
    });
    const copyBad = bad.$<HTMLButtonElement>("light-copy");
    copyBad.click();
    await vi.waitFor(() => expect(copyBad.textContent).toBe("Copy failed"));
    expect(copyBad.disabled).toBe(false);
    // The reason goes to the page's error channel (the root CLAUDE.md rule).
    expect(bad.showError).toHaveBeenCalledWith("Could not copy: denied");
  });

  // WHY (review finding 5): navigator.clipboard is undefined on an insecure
  // origin, so the write can throw BEFORE any promise exists; the button
  // must still come back. And "Copied" is a claim about the settings copied,
  // so a later change takes it back.
  it("recovers from a copy that throws at once, and drops a stale Copied", async () => {
    const thrown = setup({
      writeClipboard: () => {
        throw new TypeError("no clipboard");
      },
    });
    const copy = thrown.$<HTMLButtonElement>("light-copy");
    copy.click();
    await vi.waitFor(() => expect(copy.textContent).toBe("Copy failed"));
    expect(copy.disabled).toBe(false);
    expect(thrown.showError).toHaveBeenCalledWith(
      "Could not copy: no clipboard",
    );
    thrown.dialog.dispose();
    const ok = setup();
    const copyOk = ok.$<HTMLButtonElement>("light-copy");
    copyOk.click();
    await vi.waitFor(() => expect(copyOk.textContent).toBe("Copied"));
    ok.slide("gainMax", 2);
    expect(copyOk.textContent).toBe("Copy");
  });
});
