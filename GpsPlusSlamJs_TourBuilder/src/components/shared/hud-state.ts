/**
 * Pure wording/state mapping for the HUD's toggles (plan 2026-09-20-hud-icon-buttons).
 *
 * The HUD, not its caller, owns the wording: an icon-only button must never
 * carry a label that contradicts its icon or `aria-pressed`. Labels name the
 * action the tap performs.
 *
 * `HudBuildingsStatus` is structurally identical to the desktop-preview's
 * `OsmBuildingStatus` (components/desktop-preview/view/osm-building-layer.ts).
 * It is redeclared here so the shared HUD does not import from a sibling
 * component; callers can pass an `OsmBuildingStatus` directly.
 */

export type HudBuildingsStatus =
  "idle" | "loading" | "loaded" | "failed" | "off";

export function mapLabel(active: boolean): string {
  return active ? "Hide map" : "Show map";
}

export function autopilotLabel(active: boolean): string {
  return active ? "Stop auto-walk" : "Auto-walk";
}

export function wayfindingLabel(active: boolean): string {
  return active ? "Stop wayfinding" : "Wayfinding";
}

export interface BuildingsAppearance {
  readonly pressed: boolean;
  /** Spinner ring while the layer loads. The button stays clickable. */
  readonly busy: boolean;
  /** Red ring: the fetch failed and a tap retries. */
  readonly error: boolean;
  readonly label: string;
}

export function buildingsAppearance(
  status: HudBuildingsStatus,
): BuildingsAppearance {
  switch (status) {
    case "off":
      return {
        pressed: false,
        busy: false,
        error: false,
        label: "Show buildings",
      };
    case "idle": // only ever seen momentarily — the session loads straight away
    case "loading":
      return {
        pressed: false,
        busy: true,
        error: false,
        label: "Loading buildings…",
      };
    case "loaded":
      return {
        pressed: true,
        busy: false,
        error: false,
        label: "Hide buildings",
      };
    case "failed":
      return {
        pressed: false,
        busy: false,
        error: true,
        label: "Buildings failed — tap to retry",
      };
  }
}
