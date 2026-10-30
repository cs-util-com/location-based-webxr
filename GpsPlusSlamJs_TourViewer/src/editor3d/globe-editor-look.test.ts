/**
 * Why these tests matter: the editor on the globe view opens at street
 * level looking at the tour, hands the ground from the relief to the globe
 * surface by altitude without blinking at the line, and hides far or
 * crowded objects each frame; each of these is a promise the creator sees
 * at once, and none needs WebGL to check.
 */
import { describe, expect, it } from "vitest";

import { WGS84_ELLIPSOID, viewPoseEcef } from "gps-plus-slam-globe/view";

import {
  GLOBE_EDITOR_LOOK,
  aimView,
  globeEditorSettings,
  globeHidden,
  reliefCarries,
  streetView,
  viewPoseOf,
  type GlobeObjectOnScreen,
} from "./globe-editor-look.js";

const M_PER_DEG = 111_320;

describe("streetView", () => {
  // Why: the first view stands an eye height over the ground, backed off
  // to the south and looking north and down at the tour's centre.
  it("stands back south of the centre at eye height, looking at it", () => {
    const pose = streetView({ lat: 48, lng: 11 }, 515);
    const { backM, eyeM } = GLOBE_EDITOR_LOOK;
    expect((48 - pose.lat) * M_PER_DEG).toBeCloseTo(backM, 3);
    expect(pose.lng).toBe(11);
    expect(pose.altitudeKm * 1000).toBeCloseTo(515 + eyeM, 6);
    expect(pose.headingDeg).toBe(0);
    // Down at the centre's ground: tan(pitch) = eye / back.
    expect(Math.tan((-pose.pitchDeg * Math.PI) / 180)).toBeCloseTo(
      eyeM / backM,
      9,
    );
  });

  it("refuses a place or a ground that is not finite", () => {
    expect(() => streetView({ lat: Number.NaN, lng: 0 }, 0)).toThrow(
      RangeError,
    );
    expect(() => streetView({ lat: 0, lng: 0 }, Infinity)).toThrow(RangeError);
  });
});

describe("globeEditorSettings", () => {
  // Why: the editor's world frame follows the target (else the tour would
  // be drawn 6,400 km from the origin), the sky is drawn and no unfilled
  // pixel is painted magenta.
  it("follows the target with the sky on and no debug colour", () => {
    const s = globeEditorSettings();
    expect(s.worldFrame).toBe(1);
    expect(s.sky).toBe(1);
    expect(s.holeColor).toBe(0);
    expect(s.fovY).toBe(GLOBE_EDITOR_LOOK.fovYDeg);
    expect(globeEditorSettings()).toBe(s);
  });
});

describe("reliefCarries", () => {
  const { reliefCeilingM: ceiling, reliefBandM: band } = GLOBE_EDITOR_LOOK;

  it("carries the ground on the relief low and on the globe high", () => {
    expect(reliefCarries(2, false)).toBe(true);
    expect(reliefCarries(400_000, true)).toBe(false);
  });

  // Why: a camera hovering at the line would swap the ground every frame.
  it("keeps its carrier inside the band around the ceiling", () => {
    expect(reliefCarries(ceiling, true)).toBe(true);
    expect(reliefCarries(ceiling, false)).toBe(false);
    expect(reliefCarries(ceiling + band * 0.99, true)).toBe(true);
    expect(reliefCarries(ceiling + band, true)).toBe(false);
    expect(reliefCarries(ceiling - band * 0.99, false)).toBe(false);
    expect(reliefCarries(ceiling - band * 1.01, false)).toBe(true);
  });

  it("keeps its carrier for an altitude that is not a number", () => {
    expect(reliefCarries(Number.NaN, true)).toBe(true);
    expect(reliefCarries(Number.NaN, false)).toBe(false);
  });
});

describe("globeHidden", () => {
  const knobs = { hidePx: 3, crowdPx: 24, fovYDeg: 50, viewportPx: 900 };
  const station = (
    id: string,
    distanceM: number,
    x: number,
    y = 100,
  ): GlobeObjectOnScreen => ({
    id,
    kind: "station",
    radiusM: 10,
    distanceM,
    screen: { x, y },
  });
  const none = { stations: new Set<string>(), codes: new Set<string>() };

  it("hides an object too small on screen, and shows it again near", () => {
    // 10 m at 1,000 km: far under 3 px.
    const far = globeHidden([station("a", 1e6, 0)], none, knobs, null);
    expect([...far.stations]).toEqual(["a"]);
    const near = globeHidden([station("a", 100, 0)], far, knobs, null);
    expect(near.stations.size).toBe(0);
  });

  // Why: the size rule's hysteresis is kept across frames through `was`:
  // an object hidden last frame needs half again the threshold to show.
  it("keeps a hidden object hidden inside the band", () => {
    const focal = 900 / (2 * Math.tan((25 * Math.PI) / 180));
    // The distance at which a 10 m radius covers `px` on screen.
    const at = (px: number) => (2 * 10 * focal) / px;
    const hidden = { stations: new Set(["a"]), codes: new Set<string>() };
    expect(
      globeHidden([station("a", at(4), 0)], hidden, knobs, null).stations.has(
        "a",
      ),
    ).toBe(true);
    expect(
      globeHidden([station("a", at(4), 0)], none, knobs, null).stations.has(
        "a",
      ),
    ).toBe(false);
  });

  it("hides a code by its own size, apart from the stations", () => {
    const code: GlobeObjectOnScreen = {
      id: "c1",
      kind: "code",
      radiusM: 0.1,
      distanceM: 5000,
      screen: { x: 0, y: 0 },
    };
    const out = globeHidden([code, station("a", 100, 400)], none, knobs, null);
    expect([...out.codes]).toEqual(["c1"]);
    expect(out.stations.size).toBe(0);
  });

  // Why: two stations a few pixels apart both hide (the owner's rule), the
  // selected one never does, and one hidden by size is no one's neighbour.
  it("hides crowded stations, never the selected one", () => {
    const pins = [
      station("a", 100, 0),
      station("b", 100, 10),
      station("c", 100, 500),
    ];
    expect([...globeHidden(pins, none, knobs, null).stations].sort()).toEqual([
      "a",
      "b",
    ]);
    expect([...globeHidden(pins, none, knobs, "a").stations]).toEqual(["b"]);
    const tiny = [station("a", 100, 0), station("b", 1e7, 10)];
    expect([...globeHidden(tiny, none, knobs, null).stations]).toEqual(["b"]);
  });

  it("never hides the selected station by size, nor one behind the camera by crowding", () => {
    expect(
      globeHidden([station("a", 1e7, 0)], none, knobs, "a").stations.size,
    ).toBe(0);
    const behind: GlobeObjectOnScreen = {
      ...station("b", 100, 0),
      screen: null,
    };
    expect(
      globeHidden([station("a", 100, 0), behind], none, knobs, null).stations
        .size,
    ).toBe(0);
  });
});

describe("aimView", () => {
  // Why: a flight to a station or Frame looks down at it from the south,
  // far enough to fit it: the camera's line of sight passes through it.
  it("looks down at the place from the south, farther for a larger one", () => {
    const { aimPitchDeg, backM } = GLOBE_EDITOR_LOOK;
    const near = aimView({ lat: 48, lng: 11 }, 520, 1);
    const far = aimView({ lat: 48, lng: 11 }, 520, 100);
    for (const pose of [near, far]) {
      expect(pose.pitchDeg).toBe(aimPitchDeg);
      expect(pose.headingDeg).toBe(0);
      const backOff = (48 - pose.lat) * M_PER_DEG;
      const up = pose.altitudeKm * 1000 - 520;
      // On the line of sight: up / back = tan(-pitch).
      expect(up / backOff).toBeCloseTo(
        Math.tan((-aimPitchDeg * Math.PI) / 180),
        6,
      );
      expect(Math.hypot(up, backOff)).toBeGreaterThanOrEqual(backM - 1e-9);
    }
    expect(far.altitudeKm).toBeGreaterThan(near.altitudeKm);
  });

  it("refuses a radius or a height that is not finite", () => {
    expect(() => aimView({ lat: 0, lng: 0 }, 0, Number.NaN)).toThrow(
      RangeError,
    );
    expect(() => aimView({ lat: 0, lng: 0 }, Infinity, 1)).toThrow(RangeError);
  });
});

describe("viewPoseOf", () => {
  // Why: the shell's compass and tilt, North up and Top view read the
  // camera back as a view; read back, a placed view is the view placed.
  it("reads back the view a camera was placed at", () => {
    for (const view of [
      { lat: 48.1, lng: 11.6, altitudeKm: 0.52, headingDeg: 0, pitchDeg: -3 },
      { lat: -33.9, lng: 151.2, altitudeKm: 2, headingDeg: 135, pitchDeg: -60 },
      { lat: 10, lng: -70, altitudeKm: 30, headingDeg: 270, pitchDeg: 10 },
    ]) {
      const back = viewPoseOf(
        WGS84_ELLIPSOID,
        viewPoseEcef(WGS84_ELLIPSOID, view),
      );
      expect(back.lat).toBeCloseTo(view.lat, 9);
      expect(back.lng).toBeCloseTo(view.lng, 9);
      expect(back.altitudeKm).toBeCloseTo(view.altitudeKm, 6);
      expect(back.headingDeg).toBeCloseTo(view.headingDeg, 6);
      expect(back.pitchDeg).toBeCloseTo(view.pitchDeg, 6);
    }
  });

  it("gives a heading in [0, 360)", () => {
    const back = viewPoseOf(
      WGS84_ELLIPSOID,
      viewPoseEcef(WGS84_ELLIPSOID, {
        lat: 0,
        lng: 0,
        altitudeKm: 1,
        headingDeg: -90,
        pitchDeg: 0,
      }),
    );
    expect(back.headingDeg).toBeCloseTo(270, 6);
  });
});
