/**
 * Round icon button (HUD plan 2026-09-20).
 *
 * Builds a `<button>` from an inline SVG and a label. Pure DOM, no store, no
 * Three.js. Styling lives in `icon-button.css` and keys off `aria-pressed`, so
 * the DOM state and the visual state cannot drift apart.
 *
 * `label` is written to both `aria-label` and `title` (identical): a sighted
 * mouse user gets the tooltip, assistive tech gets the name.
 */

type IconButtonVariant = "default" | "danger";

export interface IconButtonOptions {
  /** Inline SVG markup. Use `currentColor` so CSS controls the color. */
  readonly icon: string;
  /** Written to `aria-label` and `title`. Name the action the tap performs. */
  readonly label: string;
  /** When defined the button is a toggle and carries `aria-pressed`. */
  readonly pressed?: boolean;
  /** `danger` = permanently red-tinted (a destructive action). */
  readonly variant?: IconButtonVariant;
}

export interface IconButton {
  readonly element: HTMLButtonElement;
  setLabel(label: string): void;
  /** No-op unless the button was created with `pressed`. */
  setPressed(pressed: boolean): void;
  /** Spinning ring + `aria-busy`. Does NOT disable the button. */
  setBusy(busy: boolean): void;
  /** Transient red ring + icon (distinct from the permanent `danger` variant). */
  setError(error: boolean): void;
}

export function createIconButton(options: IconButtonOptions): IconButton {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "icon-btn";
  if (options.variant === "danger") element.classList.add("icon-btn--danger");

  const glyph = document.createElement("span");
  glyph.className = "icon-btn-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML = options.icon;
  element.appendChild(glyph);

  const isToggle = options.pressed !== undefined;
  if (options.pressed !== undefined) {
    element.setAttribute("aria-pressed", String(options.pressed));
  }

  const button: IconButton = {
    element,
    setLabel(label) {
      element.setAttribute("aria-label", label);
      element.title = label;
    },
    setPressed(pressed) {
      if (!isToggle) return;
      element.setAttribute("aria-pressed", String(pressed));
    },
    setBusy(busy) {
      element.classList.toggle("icon-btn--busy", busy);
      if (busy) element.setAttribute("aria-busy", "true");
      else element.removeAttribute("aria-busy");
    },
    setError(error) {
      element.classList.toggle("icon-btn--error", error);
    },
  };
  button.setLabel(options.label);
  return button;
}
