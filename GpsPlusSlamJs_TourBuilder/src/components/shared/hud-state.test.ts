import { describe, expect, it } from "vitest";

import {
  autopilotLabel,
  buildingsAppearance,
  mapLabel,
  wayfindingLabel,
  type HudBuildingsStatus,
} from "./hud-state.js";

describe("toggle labels name the action the tap performs", () => {
  it("map", () => {
    expect(mapLabel(false)).toBe("Show map");
    expect(mapLabel(true)).toBe("Hide map");
  });
  it("autopilot", () => {
    expect(autopilotLabel(false)).toBe("Auto-walk");
    expect(autopilotLabel(true)).toBe("Stop auto-walk");
  });
  it("wayfinding", () => {
    expect(wayfindingLabel(false)).toBe("Wayfinding");
    expect(wayfindingLabel(true)).toBe("Stop wayfinding");
  });
});

describe("buildingsAppearance (spec §2b)", () => {
  const cases: ReadonlyArray<
    [HudBuildingsStatus, boolean, boolean, boolean, string]
  > = [
    ["off", false, false, false, "Show buildings"],
    ["idle", false, true, false, "Loading buildings…"],
    ["loading", false, true, false, "Loading buildings…"],
    ["loaded", true, false, false, "Hide buildings"],
    ["failed", false, false, true, "Buildings failed — tap to retry"],
  ];
  it.each(cases)("%s", (status, pressed, busy, error, label) => {
    expect(buildingsAppearance(status)).toEqual({
      pressed,
      busy,
      error,
      label,
    });
  });
});
