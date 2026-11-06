/**
 * Why these tests matter: the editor on the globe is the default 3D view,
 * so the switch must be ON for every link that does not turn it off; the
 * one way back to the older 3D view and the map, `globe=0`, is temporary
 * until those views are removed, and an old `globe=1` link must keep
 * working. The tuning knobs set by hand in the link must
 * never turn a typo into a broken view: a value that is not a number in
 * range falls back to the default instead of hiding everything (0 px) or
 * nothing (Infinity).
 */
import { describe, expect, it } from "vitest";

import { GLOBE_SWITCH, readGlobeSwitch } from "./globe-switch.js";

describe("readGlobeSwitch", () => {
  // Why this test matters: the name stays raw here because this module must
  // not load the globe's code; the globe's own table judges it (and warns).
  it("hands the link's grade on as written", () => {
    expect(readGlobeSwitch("?grade=aces").grade).toBe("aces");
    expect(readGlobeSwitch("?grade=nope").grade).toBe("nope");
    expect(readGlobeSwitch("?globe=1").grade).toBeNull();
  });

  it("is on with its defaults for a link without the switch", () => {
    expect(readGlobeSwitch("")).toEqual({
      on: true,
      hidePx: GLOBE_SWITCH.hidePx.fallback,
      crowdPx: GLOBE_SWITCH.crowdPx.fallback,
      meteorDeg: 20,
      meteorLandDeg: 50,
      landAglM: 150,
      startKm: null,
      dust: 1,
      osmGain: GLOBE_SWITCH.osmGain.fallback,
      osmGainMode: "flat",
      cloudShadow: GLOBE_SWITCH.cloudShadow.fallback,
      cloudWind: GLOBE_SWITCH.cloudWind.fallback,
      buildings: 1,
      grade: null,
      clouds: "new",
      quality: null,
    });
    expect(readGlobeSwitch("?tour=https://example.org/walk.zip").on).toBe(true);
  });

  // Why: `clouds=old` is the way back to the old clouds for as long as
  // they exist; a mistyped value must not silently switch them on.
  it("reads the clouds' way back and the quality's name", () => {
    expect(readGlobeSwitch("?clouds=old").clouds).toBe("old");
    expect(readGlobeSwitch("?clouds=new").clouds).toBe("new");
    expect(readGlobeSwitch("?clouds=nope").clouds).toBe("new");
    expect(readGlobeSwitch("?quality=low").quality).toBe("low");
    expect(readGlobeSwitch("?quality=").quality).toBe("");
  });

  // Why: `globe=0` is the temporary way back to the older 3D view; any
  // other value, an old `globe=1` link among them, keeps the globe.
  it("is off only for globe=0", () => {
    expect(readGlobeSwitch("?globe=0").on).toBe(false);
    expect(readGlobeSwitch("globe=0").on).toBe(false);
    for (const value of ["1", "", "yes", "true", "2"]) {
      expect(readGlobeSwitch(`?globe=${value}`).on).toBe(true);
    }
  });

  it("reads both knobs", () => {
    expect(
      readGlobeSwitch("?globe=1&globeHidePx=5&globeCrowdPx=40"),
    ).toMatchObject({
      on: true,
      hidePx: 5,
      crowdPx: 40,
    });
    expect(readGlobeSwitch("?globeHidePx=2.5").hidePx).toBe(2.5);
  });

  // Why: a knob out of its range or not a number is a typo; the default
  // keeps the view usable, and the knob visibly has no effect.
  it("falls back to the default for a knob that is not a number in range", () => {
    const { hidePx, crowdPx } = GLOBE_SWITCH;
    for (const bad of ["", "abc", "NaN", "Infinity", "-1", "1e9"]) {
      expect(readGlobeSwitch(`?globeHidePx=${bad}`).hidePx).toBe(
        hidePx.fallback,
      );
      expect(readGlobeSwitch(`?globeCrowdPx=${bad}`).crowdPx).toBe(
        crowdPx.fallback,
      );
    }
    expect(readGlobeSwitch(`?globeHidePx=${hidePx.min}`).hidePx).toBe(
      hidePx.min,
    );
    expect(readGlobeSwitch(`?globeHidePx=${hidePx.min / 2}`).hidePx).toBe(
      hidePx.fallback,
    );
    expect(readGlobeSwitch(`?globeCrowdPx=${crowdPx.max}`).crowdPx).toBe(
      crowdPx.max,
    );
    // 0 turns the crowding off: no pin is ever closer than 0 px.
    expect(readGlobeSwitch("?globeCrowdPx=0").crowdPx).toBe(0);
  });

  // Why: the approach's meteor is tuned by eye from the link, as the globe
  // lab's is (same names): the start angle, the landing angle, the landing
  // height over the tour's ground and the start height.
  it("reads the approach's meteor knobs", () => {
    expect(
      readGlobeSwitch(
        "?globe=1&meteorDeg=30&meteorLandDeg=60&landAglM=300&startKm=65000",
      ),
    ).toMatchObject({
      meteorDeg: 30,
      meteorLandDeg: 60,
      landAglM: 300,
      startKm: 65_000,
    });
    for (const bad of ["0", "90", "abc"]) {
      expect(readGlobeSwitch(`?meteorDeg=${bad}`).meteorDeg).toBe(20);
      expect(readGlobeSwitch(`?meteorLandDeg=${bad}`).meteorLandDeg).toBe(50);
    }
    // The entry's floor is the globe lab's (10): a flatter line was never
    // flown or swept, so a link asking for one reads the default.
    expect(readGlobeSwitch("?meteorDeg=5").meteorDeg).toBe(20);
    expect(readGlobeSwitch("?meteorDeg=10").meteorDeg).toBe(10);
    expect(readGlobeSwitch("?landAglM=5").landAglM).toBe(150);
    expect(readGlobeSwitch("?startKm=10").startKm).toBeNull();
  });

  // Why: without startKm the flight starts where the globe lab's intro
  // zooms out to (derived from the view, so null here); the link's
  // startKm stays an explicit override, and a value out of its range
  // reads as no override rather than as some other fixed height.
  it("reads startKm as an override, and none without a valid one", () => {
    expect(readGlobeSwitch("?globe=1").startKm).toBeNull();
    expect(readGlobeSwitch("?startKm=8000").startKm).toBe(8_000);
    const { startKm } = GLOBE_SWITCH;
    expect(readGlobeSwitch(`?startKm=${startKm.min}`).startKm).toBe(
      startKm.min,
    );
    expect(readGlobeSwitch(`?startKm=${startKm.max}`).startKm).toBe(
      startKm.max,
    );
    for (const bad of ["", "abc", "Infinity", "-1", "499", "65001"]) {
      expect(readGlobeSwitch(`?startKm=${bad}`).startKm).toBeNull();
    }
  });

  // Why: the speed streaks are on by default on the approach, as the
  // globe lab's look; dust=0 is the A/B link that turns them off (and a
  // frame-time comparison's other half).
  it("reads the speed streaks on by default and off for dust=0", () => {
    expect(readGlobeSwitch("?globe=1").dust).toBe(1);
    expect(readGlobeSwitch("?globe=1&dust=0").dust).toBe(0);
    for (const bad of ["abc", "2", "-1"]) {
      expect(readGlobeSwitch(`?dust=${bad}`).dust).toBe(1);
    }
  });

  // Why: the buildings are on by default; buildings=0 is the developer's
  // link without them (no city worker, no Overpass traffic), a typo keeps
  // them.
  it("reads the buildings on by default and off for buildings=0", () => {
    expect(readGlobeSwitch("").buildings).toBe(1);
    expect(readGlobeSwitch("?buildings=0").buildings).toBe(0);
    for (const bad of ["abc", "2", "-1", ""]) {
      expect(readGlobeSwitch(`?buildings=${bad}`).buildings).toBe(1);
    }
  });

  // Why: the street map's darkening gain is a look choice tuned by eye;
  // the link's osmGain is its A/B switch, and a value out of its range
  // (one that would blank or brighten the map) reads as the default.
  it("reads the street map's gain, about 0.55 by default", () => {
    expect(GLOBE_SWITCH.osmGain.fallback).toBe(0.55);
    expect(readGlobeSwitch("?globe=1&osmGain=0.45").osmGain).toBe(0.45);
    expect(readGlobeSwitch("?globe=1&osmGain=1").osmGain).toBe(1);
    for (const bad of ["", "abc", "0", "0.1", "1.5", "-1", "Infinity"]) {
      expect(readGlobeSwitch(`?osmGain=${bad}`).osmGain).toBe(0.55);
    }
  });

  // Why: the gain's mode is the street map's A/B switch: flat (the map's
  // contrasts kept) unless the link asks for exactly "compress".
  it("reads the street map's gain mode, flat unless the link says compress", () => {
    expect(GLOBE_SWITCH.osmGainMode.fallback).toBe("flat");
    expect(readGlobeSwitch("?globe=1&osmGainMode=compress").osmGainMode).toBe(
      "compress",
    );
    for (const other of ["", "flat", "Compress", "x"]) {
      expect(readGlobeSwitch(`?osmGainMode=${other}`).osmGainMode).toBe("flat");
    }
  });

  // Why: the clouds' shadow and wind are the look's A/B knobs; the
  // editor's shadow is weaker than the lab's 0.5 so the tour reads under a
  // cloud, and a value out of range reads as the default. The wind floor
  // is 40 m/s: at the globe's 10 a cloud at 3 km moved 30 m in 3 s seen
  // from the landing (about half a degree), read as static clouds.
  it("reads the clouds' shadow (0.3 by default) and wind (40 by default)", () => {
    expect(GLOBE_SWITCH.cloudShadow.fallback).toBe(0.3);
    expect(GLOBE_SWITCH.cloudWind.fallback).toBe(40);
    expect(readGlobeSwitch("?cloudWind=10").cloudWind).toBe(10);
    expect(readGlobeSwitch("?globe=1&cloudShadow=0.6").cloudShadow).toBe(0.6);
    expect(readGlobeSwitch("?cloudShadow=0").cloudShadow).toBe(0);
    expect(readGlobeSwitch("?cloudWind=80").cloudWind).toBe(80);
    for (const bad of ["", "abc", "-0.1", "1.5", "NaN"]) {
      expect(readGlobeSwitch(`?cloudShadow=${bad}`).cloudShadow).toBe(0.3);
    }
    for (const bad of ["x", "-5", "2000"]) {
      expect(readGlobeSwitch(`?cloudWind=${bad}`).cloudWind).toBe(
        GLOBE_SWITCH.cloudWind.fallback,
      );
    }
  });

  // Why: the meteor never lands shallower than it enters ("shallow to
  // steep"); a landing angle under the start angle is held at
  // the start angle, a straight line.
  it("never lands shallower than the meteor enters", () => {
    expect(readGlobeSwitch("?meteorDeg=40&meteorLandDeg=30")).toMatchObject({
      meteorDeg: 40,
      meteorLandDeg: 40,
    });
  });

  it("keeps its defaults inside their own ranges", () => {
    for (const knob of [
      GLOBE_SWITCH.hidePx,
      GLOBE_SWITCH.crowdPx,
      GLOBE_SWITCH.meteorDeg,
      GLOBE_SWITCH.meteorLandDeg,
      GLOBE_SWITCH.landAglM,
      GLOBE_SWITCH.dust,
      GLOBE_SWITCH.osmGain,
      GLOBE_SWITCH.cloudShadow,
      GLOBE_SWITCH.cloudWind,
      GLOBE_SWITCH.buildings,
    ]) {
      expect(knob.fallback).toBeGreaterThanOrEqual(knob.min);
      expect(knob.fallback).toBeLessThanOrEqual(knob.max);
    }
  });
});
