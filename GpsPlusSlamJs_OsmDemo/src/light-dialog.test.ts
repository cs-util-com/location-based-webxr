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
import { veilLightnessBounds } from "./haze-veil.js";
import {
  DEFAULT_LIGHT_SETTINGS,
  lightDefaultsFor,
  parseLightLink,
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

  // WHY (city look, haze inside the city): the two haze values are tuned
  // here like every other light value, within the URL's bounds, and an
  // untouched dialog shows today's haze.
  it("offers the haze visibility and start, at today's values", () => {
    const { $, slide, onChange } = setup();
    const vis = $<HTMLInputElement>("light-hazeVisibilityKm");
    const start = $<HTMLInputElement>("light-hazeStartRatio");
    expect([vis.min, vis.max, vis.value]).toEqual(["9", "60", "45"]);
    expect([start.min, start.max, start.value]).toEqual(["0", "0.9", "0.66"]);
    slide("hazeVisibilityKm", 15);
    slide("hazeStartRatio", 0.2);
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LIGHT_SETTINGS,
      hazeVisibilityKm: 15,
      hazeStartRatio: 0.2,
    });
  });

  // WHY: the veil is tuned here like the haze; at its default (lightness 0)
  // the haze keeps the sky's colour, so an untouched dialog changes nothing.
  it("offers the haze veil, off by default, and applies it live", () => {
    const { $, slide, onChange } = setup();
    const l = $<HTMLInputElement>("light-hazeVeilLightness");
    const t = $<HTMLInputElement>("light-hazeVeilTint");
    const a = $<HTMLInputElement>("light-hazeVeilTintA");
    expect([l.min, l.max, l.value]).toEqual(["0", "90", "0"]);
    expect([t.min, t.max, t.value]).toEqual(["-24", "40", "-4"]);
    expect([a.min, a.max, a.value]).toEqual(["-10", "10", "0"]);
    expect(l.parentElement!.textContent).toContain("0 = the sky");
    expect(a.parentElement!.textContent).toContain("a*");
    slide("hazeVeilLightness", 76);
    slide("hazeVeilTint", -6);
    slide("hazeVeilTintA", 2);
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LIGHT_SETTINGS,
      hazeVeilLightness: 76,
      hazeVeilTint: -6,
      hazeVeilTintA: 2,
    });
  });

  // WHY: a colour can only be shown up to a lightness that stays below the
  // tone curve's knee. A slider asking for more must never silently draw
  // something else: the dialog says the veil is held, and at which L*, and
  // the note goes once the colour can be shown as asked. Reset clears it.
  it("says when the veil's lightness is held for its colour", () => {
    const { $, slide } = setup();
    const note = $<HTMLElement>("light-veil-note");
    expect(note.hidden).toBe(true);
    slide("hazeVeilLightness", 90);
    slide("hazeVeilTint", 40);
    const max = veilLightnessBounds(0, 40)!.max;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain(`L* ${max}`);
    expect(note.textContent).toContain("knee");
    slide("hazeVeilLightness", 60);
    expect(note.hidden).toBe(true);
    // Too dark for a strong yellow: held at the colour's floor.
    slide("hazeVeilLightness", 10);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain(`L* ${veilLightnessBounds(0, 40)!.min}`);
    $("light-reset").click();
    expect(note.hidden).toBe(true);
  });

  // WHY: a hand-written link may state a lightness off the 0.1 grid that the
  // screen does not show exactly; the view draws the nearest grid point, and
  // the note must name that cause rather than the knee or the gamut.
  it("names the grid when an off-grid lightness is drawn at its nearest tenth", () => {
    const { $ } = setup({
      initial: {
        ...DEFAULT_LIGHT_SETTINGS,
        hazeVeilLightness: 28.22,
        hazeVeilTint: -21,
        hazeVeilTintA: -10,
      },
    });
    const note = $<HTMLElement>("light-veil-note");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(
      "Veil shown at L* 28.2: the nearest lightness the screen shows exactly in this colour.",
    );
  });

  // WHY: a new visibility rebuilds the sky's tables, so a drag that applied
  // every step rebuilt them at every whole km. The value is applied once, on
  // release; its readout still follows the thumb while it moves.
  it("applies the haze visibility on release, its readout live", () => {
    const { $, onChange } = setup();
    const vis = $<HTMLInputElement>("light-hazeVisibilityKm");
    const out = vis.parentElement!.querySelector("output")!;
    vis.value = "20";
    vis.dispatchEvent(new Event("input"));
    expect(out.value).toBe("20");
    expect(onChange).not.toHaveBeenCalled();
    vis.value = "15";
    vis.dispatchEvent(new Event("input"));
    vis.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LIGHT_SETTINGS,
      hazeVisibilityKm: 15,
    });
  });

  // WHY: every other value is cheap to apply, so it stays live on the drag.
  it("applies the other values while they are dragged", () => {
    const { $, onChange } = setup();
    const start = $<HTMLInputElement>("light-hazeStartRatio");
    start.value = "0.3";
    start.dispatchEvent(new Event("input"));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LIGHT_SETTINGS,
      hazeStartRatio: 0.3,
    });
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

  // WHY: the dialog stacks over the settings drawer, whose own Escape
  // listener sits on `window` and skips a key already handled. If the
  // dialog did not mark its Escape handled, one press would close both
  // layers and focus would go back to a button in a hidden drawer.
  it("marks its Escape handled, so the panel under it stays open", () => {
    const { dialog } = setup();
    dialog.toggle();
    const key = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(key);
    expect(dialog.open).toBe(false);
    expect(key.defaultPrevented).toBe(true);
    // Closed, the key is not the dialog's to take.
    const later = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  // WHY: the back arrow is how a touch user leaves the dialog for the
  // drawer it covers; it must close the dialog and hand focus back.
  it("closes from its back arrow and returns focus to the opener", () => {
    const { dialog, opener, $ } = setup();
    opener.focus();
    dialog.toggle();
    const back = $<HTMLButtonElement>("light-back");
    expect(back.getAttribute("aria-label")).toBe("Back to settings");
    back.focus();
    back.click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
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

  it("resets to the scheme's defaults, and moves onto a new scheme's", () => {
    // Why this test matters: urban is tuned with its own light, so Reset
    // must land on urban's light while urban is shown, and a scheme switch
    // must carry what the viewer set while the untouched rest follows.
    const urban = lightDefaultsFor("urban");
    const { dialog, onChange, slide, $ } = setup({
      initial: urban,
      defaults: urban,
    });
    expect(dialog.defaults).toBe(urban);
    slide("gainMax", 2);
    $("light-reset").click();
    expect(onChange).toHaveBeenLastCalledWith(urban);
    slide("hazeVisibilityKm", 15);
    dialog.setDefaults(DEFAULT_LIGHT_SETTINGS);
    expect(dialog.defaults).toBe(DEFAULT_LIGHT_SETTINGS);
    const moved = { ...DEFAULT_LIGHT_SETTINGS, hazeVisibilityKm: 15 };
    expect(dialog.settings).toEqual(moved);
    expect(onChange).toHaveBeenLastCalledWith(moved);
    expect($<HTMLInputElement>("light-hazeVeilLightness").value).toBe("0");
  });

  it("keeps a veil switched off on urban across urban, today and back to urban", () => {
    // Why this test matters: 0 is today's default, so the value alone reads
    // as untouched under today and the way back to urban would bring the veil
    // again; the dialog remembers that the viewer set it, by the link or the
    // slider, until Reset.
    const urban = lightDefaultsFor("urban");
    const off = { ...urban, hazeVeilLightness: 0 };
    const fromLink = setup({ initial: off, defaults: urban });
    fromLink.dialog.setDefaults(DEFAULT_LIGHT_SETTINGS);
    fromLink.dialog.setDefaults(urban);
    expect(fromLink.dialog.settings).toEqual(off);
    fromLink.dialog.dispose();

    const bySlider = setup({ initial: urban, defaults: urban });
    bySlider.slide("hazeVeilLightness", 0);
    bySlider.dialog.setDefaults(DEFAULT_LIGHT_SETTINGS);
    bySlider.dialog.setDefaults(urban);
    expect(bySlider.dialog.settings).toEqual(off);
    // Reset forgets it: the next switch moves every value again.
    bySlider.$("light-reset").click();
    bySlider.dialog.setDefaults(DEFAULT_LIGHT_SETTINGS);
    expect(bySlider.dialog.settings).toEqual(DEFAULT_LIGHT_SETTINGS);
  });

  it("keeps a link-stated value that equals the scheme's default across a switch", () => {
    // Why this test matters: `veil=0` under today equals today's default, so
    // the value alone reads as untouched and a switch to urban would bring
    // urban's veil back over what the link stated. The link's own key list
    // says it was set.
    const link = parseLightLink("?light=v1:veil=0", DEFAULT_LIGHT_SETTINGS);
    const { dialog } = setup({
      initial: link.settings,
      defaults: DEFAULT_LIGHT_SETTINGS,
      stated: link.stated,
    });
    const urban = lightDefaultsFor("urban");
    dialog.setDefaults(urban);
    expect(dialog.settings).toEqual({ ...urban, hazeVeilLightness: 0 });
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

  // Why this test matters: the ambient occlusion switch is the one control
  // here that is not a light setting. It must reach the view at once, show
  // the brightness it now gives (the AO darkens the lit surfaces the readout
  // measures), and stay out of the light settings, so Copy, Reset and the
  // link never carry it.
  it("switches the ambient occlusion at once and re-reads the brightness", () => {
    const onAo = vi.fn<(on: boolean) => void>();
    const { dialog, onChange, measure, $ } = setup({
      ambientOcclusion: { initial: true, onChange: onAo },
    });
    const box = $<HTMLInputElement>("light-ao");
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(true);
    expect(box.closest("label")?.textContent).toContain("Ambient occlusion");
    dialog.toggle();
    measure.mockClear();
    box.click();
    expect(onAo).toHaveBeenCalledWith(false);
    expect(box.checked).toBe(false);
    expect(measure).toHaveBeenCalledWith(false);
    $<HTMLButtonElement>("light-reset").click();
    expect(box.checked).toBe(false);
    expect(onAo).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls.every(([s]) => !("ambientOcclusion" in s))).toBe(
      true,
    );
  });

  it("has no ambient occlusion switch when the page offers none", () => {
    const { $ } = setup();
    expect($("light-ao")).toBeNull();
  });
});
