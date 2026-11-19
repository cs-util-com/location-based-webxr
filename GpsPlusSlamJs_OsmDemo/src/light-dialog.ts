/**
 * OsmDemo's light dialog (plan 2026-09-24-2140-osm-demo-light-settings-dialog-plan):
 * the owner tunes the noon lighting live, reads the lit-surface brightness
 * and the heat-grid margin, and copies the result to paste back. A DOM
 * panel with its dependencies passed in, so it is tested without WebGL.
 *
 * @see light-dialog.ts.md
 */

import { veilLightnessBounds } from "./haze-veil.js";
import {
  DEFAULT_LIGHT_SETTINGS,
  LIGHT_SETTING_RANGES,
  rebaseLightSettings,
  skyBalanceOf,
  veilOf,
  type LightSettings,
} from "./light-settings.js";

/**
 * Why the veil is drawn at another lightness than the slider's: above its
 * colour's run, below it, or inside it but off the 0.1 grid the run is
 * checked on (`clampHazeVeil`). Only called for a held veil, whose colour
 * has bounds.
 */
function heldBecause(s: LightSettings): string {
  const { min, max } = veilLightnessBounds(s.hazeVeilTintA, s.hazeVeilTint)!;
  if (s.hazeVeilLightness > max) {
    return "brighter, this colour would pass the tone curve's knee or leave the screen's colours.";
  }
  if (s.hazeVeilLightness < min) {
    return "darker, this colour is outside the screen's colours.";
  }
  return "the nearest lightness the screen shows exactly in this colour.";
}

/** The heat grid must add at least this much mean chroma (DEC-R4-5). */
export const HEAT_GRID_MARGIN_BOUND = 5;

/** The sliders' labels, in the order they are shown. */
const LABELS: { readonly [K in keyof LightSettings]: string } = {
  gainMax: "Sunlit buildings and roads (gain at a high sun)",
  gainFromDeg: "Gain starts at sun elevation (°)",
  gainFullDeg: "Gain full at sun elevation (°)",
  buildingSkyLight: "Sky light on buildings",
  exposureEv: "Overall exposure (EV)",
  exposureAdaptation: "Auto-exposure strength (mostly dawn and dusk darkness)",
  hazeVisibilityKm: "Haze: visibility (km, lower is hazier)",
  hazeStartRatio: "Haze: fade starts at (share of the draw distance)",
  hazeVeilLightness:
    "Haze: veil lightness (L* on screen, 0 = the sky's colour)",
  hazeVeilTint:
    "Haze: veil blue-yellow (b* on screen, below 0 bluer, above 0 yellower)",
  hazeVeilTintA:
    "Haze: veil green-red (a* on screen, below 0 greener, above 0 redder)",
  hazeVeilRiseDeg: "Haze: veil up the sky (° above the horizon, 0 = none)",
  skyBalanceA:
    "Sky colour green-red (a* cast on the sky and its light, 0 = the model's)",
  skyBalanceB:
    "Sky colour blue-yellow (b* cast on the sky and its light, below 0 bluer)",
};

/**
 * The values applied when the slider is released, not while it is dragged:
 * a new haze visibility rebuilds the sky's tables, and a new sky balance
 * re-bakes the environment (six cube faces and a PMREM pass) at once, which
 * a drag would do at every input event, several a frame. Their readout
 * still follows the thumb.
 */
const APPLIED_ON_RELEASE: ReadonlySet<keyof LightSettings> = new Set([
  "hazeVisibilityKm",
  "skyBalanceA",
  "skyBalanceB",
]);

/** One measurement of the view as it stands. */
interface LightReadout {
  readonly litLuma: number;
  /** The chroma the heat grid adds; `null` when no grid is drawn. */
  readonly margin: number | null;
  /** What the margin was measured in (the ground mode's label). */
  readonly view: string;
}

export interface LightDialogDeps {
  /** Where the panel is added (the 3D view's container). */
  readonly parent: HTMLElement;
  /** The button that opens it: told whether it is expanded, and focused again on close. */
  readonly opener?: HTMLElement;
  readonly initial: LightSettings;
  /**
   * What Reset returns to: the colour scheme's light (`lightDefaultsFor`),
   * the shipped look when left out. `setDefaults` moves it later.
   */
  readonly defaults?: LightSettings;
  /**
   * The fields the page's link stated (`parseLightLink`): a scheme switch
   * keeps them, even where a value equals the scheme's default.
   */
  readonly stated?: ReadonlySet<keyof LightSettings>;
  /** Applies a setting live (the view, the URL). */
  readonly onChange: (settings: LightSettings) => void;
  /**
   * Renders and measures the view as it stands; the margin's second render
   * only when `withMargin`. May throw (no GL, a grid still building).
   */
  readonly measure: (withMargin: boolean) => LightReadout;
  /** The Copy text for the current settings. */
  readonly copyText: (settings: LightSettings) => string;
  readonly writeClipboard: (text: string) => Promise<void>;
  /** The page's error channel, for a failed copy. */
  readonly showError: (message: string) => void;
  /** Runs `callback` once the in-progress state has painted. */
  readonly nextFrame?: (callback: () => void) => void;
  /**
   * The ambient occlusion switch, when the page offers one. Not a light
   * setting: Copy, Reset and the light link never carry it.
   */
  readonly ambientOcclusion?: {
    readonly initial: boolean;
    readonly onChange: (on: boolean) => void;
  };
}

export interface LightDialog {
  readonly open: boolean;
  toggle(): void;
  close(): void;
  /** Re-reads the brightness when open (the page calls it on a sun move). */
  refresh(): void;
  readonly settings: LightSettings;
  /** The defaults Reset returns to and the light link is written against. */
  readonly defaults: LightSettings;
  /**
   * The fields the viewer set (by the link or a slider), a fresh copy; the
   * time-of-day blend keeps these and lets the others follow each look.
   */
  readonly touched: ReadonlySet<keyof LightSettings>;
  /**
   * Moves onto new defaults (the page calls it on a colour scheme switch):
   * a value still at the old default takes the new one, a value the viewer
   * set keeps it (`rebaseLightSettings`), and the result is applied.
   */
  setDefaults(next: LightSettings): void;
  dispose(): void;
}

const formatLuma = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "n/a");

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * A frame, then a task: an animation-frame callback runs BEFORE that frame's
 * paint, so synchronous work inside it would hide the in-progress state it
 * follows.
 */
const afterPaint = (callback: () => void) => {
  requestAnimationFrame(() => setTimeout(callback, 0));
};

/** Builds the (hidden) panel and returns its handle. */
export function createLightDialog(deps: LightDialogDeps): LightDialog {
  const nextFrame = deps.nextFrame ?? afterPaint;
  let settings = deps.initial;
  let defaults = deps.defaults ?? DEFAULT_LIGHT_SETTINGS;
  // The fields the viewer set (by the link or a slider), so a scheme switch
  // keeps them even where a value equals the next scheme's default; Reset
  // clears it. A link's value equal to the default is known only by its key.
  const touched = new Set<keyof LightSettings>([
    ...(deps.stated ?? []),
    ...(Object.keys(settings) as (keyof LightSettings)[]).filter(
      (f) => settings[f] !== defaults[f],
    ),
  ]);

  const panel = document.createElement("section");
  panel.id = "light-dialog";
  panel.className = "plate prose";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Light settings");
  // THE BACK ARROW: the dialog stacks over the settings drawer it is opened
  // from, and going back closes it and leaves the drawer as it was.
  const head = document.createElement("div");
  head.className = "light-head";
  const back = document.createElement("button");
  back.type = "button";
  back.id = "light-back";
  back.className = "light-back";
  back.setAttribute("aria-label", "Back to settings");
  back.textContent = "‹";
  const heading = document.createElement("h2");
  heading.textContent = "Light";
  head.append(back, heading);
  panel.append(head);

  // Says when the veil's lightness is held for its colour (`veilOf`), so a
  // slider never silently draws a colour other than the one it names.
  const veilNote = document.createElement("p");
  veilNote.id = "light-veil-note";
  veilNote.className = "light-note";
  veilNote.hidden = true;
  veilNote.setAttribute("aria-live", "polite");

  // Says when the sky balance's cast leaves the screen's colours and a
  // channel is clipped to 0 (in the sliders' cool corner, the red), for the
  // same reason as the veil's note.
  const skyNote = document.createElement("p");
  skyNote.id = "light-sky-note";
  skyNote.className = "light-note";
  skyNote.hidden = true;
  skyNote.setAttribute("aria-live", "polite");
  skyNote.textContent =
    "Sky colour shown less cool than named: this cast is outside the screen's colours, so its red is dropped.";

  const inputs = new Map<keyof LightSettings, HTMLInputElement>();
  const values = new Map<keyof LightSettings, HTMLOutputElement>();
  for (const field of Object.keys(LABELS) as (keyof LightSettings)[]) {
    const range = LIGHT_SETTING_RANGES[field];
    const label = document.createElement("label");
    label.className = "light-row";
    const text = document.createElement("span");
    text.textContent = LABELS[field];
    const input = document.createElement("input");
    input.type = "range";
    input.id = `light-${field}`;
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    const value = document.createElement("output");
    value.htmlFor.add(input.id);
    label.append(text, input, value);
    panel.append(label);
    inputs.set(field, input);
    values.set(field, value);
    if (field === "hazeVeilTintA") panel.append(veilNote);
    if (field === "skyBalanceB") panel.append(skyNote);
  }

  let aoBox: HTMLInputElement | undefined;
  if (deps.ambientOcclusion !== undefined) {
    const label = document.createElement("label");
    label.className = "light-row";
    aoBox = document.createElement("input");
    aoBox.type = "checkbox";
    aoBox.id = "light-ao";
    aoBox.checked = deps.ambientOcclusion.initial;
    const text = document.createElement("span");
    text.textContent = "Ambient occlusion";
    label.append(aoBox, text);
    panel.append(label);
  }

  const readout = document.createElement("p");
  readout.id = "light-readout";
  readout.setAttribute("aria-live", "polite");
  const buttons = document.createElement("div");
  buttons.className = "light-buttons";
  const button = (id: string, text: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.className = "btn";
    b.textContent = text;
    buttons.append(b);
    return b;
  };
  const check = button("light-check", "Check heat grid");
  const copy = button("light-copy", "Copy");
  const reset = button("light-reset", "Reset");
  const closeButton = button("light-close", "Close");
  panel.append(readout, buttons);
  deps.parent.append(panel);

  const show = (s: LightSettings) => {
    for (const [field, input] of inputs) {
      input.value = String(s[field]);
      values.get(field)!.value = String(s[field]);
    }
    const drawn = veilOf(s)?.lightness;
    veilNote.hidden = drawn === undefined || drawn === s.hazeVeilLightness;
    if (drawn !== undefined && drawn !== s.hazeVeilLightness) {
      veilNote.textContent = `Veil shown at L* ${drawn}: ${heldBecause(s)}`;
    }
    skyNote.hidden = !(skyBalanceOf(s)?.some((c) => c === 0) ?? false);
  };
  const failed = (error: unknown) => `Could not measure: ${messageOf(error)}`;
  const brightness = () => {
    try {
      const { litLuma } = deps.measure(false);
      readout.textContent = `Lit surfaces ${formatLuma(litLuma)}`;
    } catch (error) {
      readout.textContent = failed(error);
    }
  };
  const apply = (next: LightSettings) => {
    settings = next;
    show(settings);
    // "Copied" was said of the settings before this change.
    copy.textContent = "Copy";
    deps.onChange(settings);
  };

  const applyField = (field: keyof LightSettings, input: HTMLInputElement) => {
    let next: LightSettings = { ...settings, [field]: Number(input.value) };
    // The ramp must rise: a start dragged past the end moves the end.
    if (!(next.gainFullDeg > next.gainFromDeg)) {
      next =
        field === "gainFromDeg"
          ? { ...next, gainFullDeg: next.gainFromDeg + 1 }
          : { ...next, gainFromDeg: next.gainFullDeg - 1 };
    }
    for (const f of Object.keys(next) as (keyof LightSettings)[]) {
      if (f === field || next[f] !== settings[f]) touched.add(f);
    }
    apply(next);
  };
  for (const [field, input] of inputs) {
    const onRelease = APPLIED_ON_RELEASE.has(field);
    input.addEventListener("input", () => {
      if (onRelease) values.get(field)!.value = input.value;
      else applyField(field, input);
    });
    // The brightness on release, not on every drag event: each reading is a
    // full-frame readback (plan §7 item 4).
    input.addEventListener("change", () => {
      if (onRelease) applyField(field, input);
      brightness();
    });
  }

  // Applied at once (the view redraws one frame); the brightness it now
  // gives is read back while the panel is open.
  aoBox?.addEventListener("change", () => {
    deps.ambientOcclusion?.onChange(aoBox.checked);
    if (!panel.hidden) brightness();
  });

  reset.addEventListener("click", () => {
    touched.clear();
    apply(defaults);
    brightness();
  });

  check.addEventListener("click", () => {
    check.disabled = true;
    check.textContent = "Measuring…";
    nextFrame(() => {
      try {
        const { litLuma, margin, view } = deps.measure(true);
        readout.textContent =
          margin === null
            ? `Lit surfaces ${formatLuma(litLuma)}. Turn on the heat grid (Cells) to check it.`
            : `Lit surfaces ${formatLuma(litLuma)}. Heat grid adds ${margin.toFixed(2)} ` +
              `(bound ${HEAT_GRID_MARGIN_BOUND}, at this view in ${view}): ` +
              (margin >= HEAT_GRID_MARGIN_BOUND ? "ok" : "below the bound");
      } catch (error) {
        readout.textContent = failed(error);
      } finally {
        check.disabled = false;
        check.textContent = "Check heat grid";
      }
    });
  });

  copy.addEventListener("click", () => {
    copy.disabled = true;
    copy.textContent = "Copying…";
    // Inside the chain, so a write that throws before any promise exists
    // (no clipboard on an insecure origin) still ends in "Copy failed".
    Promise.resolve()
      .then(() => deps.writeClipboard(deps.copyText(settings)))
      .then(
        () => {
          copy.textContent = "Copied";
        },
        (error: unknown) => {
          copy.textContent = "Copy failed";
          deps.showError(`Could not copy: ${messageOf(error)}`);
        },
      )
      .finally(() => {
        copy.disabled = false;
      });
  });

  // Escape from anywhere while open: the dialog is opened by its button or
  // the l key, so focus starts outside it. The key is marked handled, so a
  // panel under the dialog (the settings drawer) stays open: one Escape
  // closes one layer.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  const setExpanded = (expanded: boolean) =>
    deps.opener?.setAttribute("aria-expanded", String(expanded));
  deps.opener?.setAttribute("aria-controls", panel.id);
  setExpanded(false);

  const open = () => {
    panel.hidden = false;
    document.addEventListener("keydown", onKey);
    setExpanded(true);
    // A release-applied thumb may hold a value never committed (dragged,
    // then closed before the release); the panel opens on the settings in
    // force.
    show(settings);
    copy.textContent = "Copy";
    brightness();
    inputs.get("gainMax")?.focus();
  };
  const close = () => {
    if (panel.hidden) return;
    const hadFocus = panel.contains(document.activeElement);
    panel.hidden = true;
    document.removeEventListener("keydown", onKey);
    setExpanded(false);
    if (hadFocus) deps.opener?.focus();
  };
  closeButton.addEventListener("click", close);
  back.addEventListener("click", close);

  show(settings);
  return {
    get open() {
      return !panel.hidden;
    },
    toggle() {
      if (panel.hidden) open();
      else close();
    },
    close,
    refresh() {
      if (!panel.hidden) brightness();
    },
    get settings() {
      return settings;
    },
    get defaults() {
      return defaults;
    },
    get touched() {
      return new Set(touched);
    },
    setDefaults(next) {
      const from = defaults;
      defaults = next;
      apply(rebaseLightSettings(settings, from, next, touched));
    },
    dispose() {
      document.removeEventListener("keydown", onKey);
      panel.remove();
    },
  };
}
