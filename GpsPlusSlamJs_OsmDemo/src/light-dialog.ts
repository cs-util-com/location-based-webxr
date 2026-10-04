/**
 * OsmDemo's light dialog (plan 2026-09-24-2140-osm-demo-light-settings-dialog-plan):
 * the owner tunes the noon lighting live, reads the lit-surface brightness
 * and the heat-grid margin, and copies the result to paste back. A DOM
 * panel with its dependencies passed in, so it is tested without WebGL.
 *
 * @see light-dialog.ts.md
 */

import {
  DEFAULT_LIGHT_SETTINGS,
  LIGHT_SETTING_RANGES,
  type LightSettings,
} from "./light-settings.js";

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
};

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
}

export interface LightDialog {
  readonly open: boolean;
  toggle(): void;
  close(): void;
  /** Re-reads the brightness when open (the page calls it on a sun move). */
  refresh(): void;
  readonly settings: LightSettings;
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

  const panel = document.createElement("section");
  panel.id = "light-dialog";
  panel.className = "plate prose";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Light settings");
  const heading = document.createElement("h2");
  heading.textContent = "Light";
  panel.append(heading);

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

  for (const [field, input] of inputs) {
    input.addEventListener("input", () => {
      let next: LightSettings = { ...settings, [field]: Number(input.value) };
      // The ramp must rise: a start dragged past the end moves the end.
      if (!(next.gainFullDeg > next.gainFromDeg)) {
        next =
          field === "gainFromDeg"
            ? { ...next, gainFullDeg: next.gainFromDeg + 1 }
            : { ...next, gainFromDeg: next.gainFullDeg - 1 };
      }
      apply(next);
    });
    // The brightness on release, not on every drag event: each reading is a
    // full-frame readback (plan §7 item 4).
    input.addEventListener("change", brightness);
  }

  reset.addEventListener("click", () => {
    apply(DEFAULT_LIGHT_SETTINGS);
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
  // the l key, so focus starts outside it.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const setExpanded = (expanded: boolean) =>
    deps.opener?.setAttribute("aria-expanded", String(expanded));
  deps.opener?.setAttribute("aria-controls", panel.id);
  setExpanded(false);

  const open = () => {
    panel.hidden = false;
    document.addEventListener("keydown", onKey);
    setExpanded(true);
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
    dispose() {
      document.removeEventListener("keydown", onKey);
      panel.remove();
    },
  };
}
