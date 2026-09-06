/**
 * Unit tests for the HUD status summary.
 *
 * Why these tests matter: the status line is the observable surface the
 * Playwright walk-flow spec asserts the REAL HUD's hysteresis transitions
 * against. The counts must derive from the presenter's actual output
 * (camera children by name + visibility) — miscounting here would make the
 * e2e green while the HUD misbehaves, or vice versa.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { formatHudStatus, summarizeHudScene } from "./hud-status";

const indicator = (name: string, visible: boolean, isSprite?: boolean) => ({
  name,
  visible,
  ...(isSprite === undefined ? {} : { isSprite }),
});

describe("summarizeHudScene", () => {
  it("counts visible arrows and rings by presenter mesh name", () => {
    const children = [
      indicator("wayfinding-arrow", true),
      indicator("wayfinding-arrow", false),
      indicator("wayfinding-circle", true),
      indicator("wayfinding-label", true), // labels are not indicators
      indicator("unrelated-child", true),
    ];
    const targets = [new THREE.Vector3(0, 0, -5), new THREE.Vector3(3, 0, 0)];
    const summary = summarizeHudScene(
      children,
      new THREE.Vector3(0, 0, 0),
      targets,
    );
    expect(summary).toEqual({
      targets: 2,
      arrows: 1,
      rings: 1,
      hidden: 0,
      nearest: 3,
      indicatorStyle: "procedural",
      entrance: null,
    });
  });

  // Why these tests matter: the indicator style is THE observable the
  // image-sprite toggle e2e asserts against — the framework keeps the same
  // child names for sprite and mesh indicators, so only the object kind
  // (`isSprite`) distinguishes the two paths. Visibility must not matter
  // (style is knowable even while everything is hidden), and the label
  // sprite (always a THREE.Sprite) must never drag the style to "image".
  it("reports the image style from sprite-kind indicators, hidden ones included", () => {
    const summary = summarizeHudScene(
      [
        indicator("wayfinding-arrow", false, true),
        indicator("wayfinding-circle", false, true),
        indicator("wayfinding-label", true, true), // label never counts
      ],
      new THREE.Vector3(),
      [new THREE.Vector3(0, 0, -5)],
    );
    expect(summary.indicatorStyle).toBe("image");
  });

  it("reports mixed when sprite and mesh indicators coexist, null with none", () => {
    const mixed = summarizeHudScene(
      [
        indicator("wayfinding-arrow", true, true),
        indicator("wayfinding-circle", true),
      ],
      new THREE.Vector3(),
      [new THREE.Vector3(0, 0, -5)],
    );
    expect(mixed.indicatorStyle).toBe("mixed");
    const none = summarizeHudScene([], new THREE.Vector3(), []);
    expect(none.indicatorStyle).toBeNull();
  });

  it("derives hidden as targets without a visible indicator", () => {
    const summary = summarizeHudScene(
      [indicator("wayfinding-arrow", true)],
      new THREE.Vector3(),
      [
        new THREE.Vector3(0, 0, -5),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(2, 0, 0),
      ],
    );
    expect(summary.hidden).toBe(2);
  });

  it("reports null nearest with no targets (and hidden never goes negative)", () => {
    const summary = summarizeHudScene(
      [indicator("wayfinding-circle", true)], // stale child, no targets
      new THREE.Vector3(),
      [],
    );
    expect(summary.nearest).toBeNull();
    expect(summary.hidden).toBe(0);
  });
});

describe("formatHudStatus", () => {
  it("formats counts, the nearest distance to one decimal, and the style", () => {
    expect(
      formatHudStatus({
        targets: 4,
        arrows: 3,
        rings: 1,
        hidden: 0,
        nearest: 19.234,
        indicatorStyle: "procedural",
        entrance: null,
      }),
    ).toBe(
      "targets 4 · arrows 3 · rings 1 · hidden 0 · nearest 19.2 m · " +
        "procedural indicators",
    );
    expect(
      formatHudStatus({
        targets: 4,
        arrows: 3,
        rings: 1,
        hidden: 0,
        nearest: 19.234,
        indicatorStyle: "image",
        entrance: null,
      }),
    ).toContain("image indicators");
  });

  it("renders a dash with no nearest target and omits an unknown style", () => {
    const line = formatHudStatus({
      targets: 0,
      arrows: 0,
      rings: 0,
      hidden: 0,
      nearest: null,
      indicatorStyle: null,
      entrance: null,
    });
    expect(line).toContain("nearest –");
    expect(line).not.toContain("indicators");
  });
});

describe("the entrance readout", () => {
  // Why these tests matter: the readout is the owner's on-device cost
  // number (the HUD diamond entrance plan, M4) — the one place a Quest
  // frame's redraw cost becomes visible. It must appear only while an
  // entrance runs (a settled HUD says nothing) and carry the stats verbatim.
  const children = [indicator("wayfinding-circle", true, true)];
  const at = new THREE.Vector3(0, 0, 0);
  const targets = [new THREE.Vector3(0, 0, -5)];

  it("carries the presenter's stats through the summary, null when not passed", () => {
    const stats = {
      redraws: 2,
      drawMs: 0.0412,
      animating: 1,
      entranceMs: 0.61,
      peakDrawMs: 0.09,
    };
    expect(summarizeHudScene(children, at, targets, stats).entrance).toBe(
      stats,
    );
    expect(summarizeHudScene(children, at, targets).entrance).toBeNull();
  });

  it("prints the per-frame AND the accumulated readout while an entrance animates or redrew, and nothing once settled", () => {
    // The accumulated total and the peak are what clear the browser clock's
    // 100 µs floor on a desktop (owner decision, 2026-09-06).
    const summary = summarizeHudScene(children, at, targets, {
      redraws: 2,
      drawMs: 0.0412,
      animating: 1,
      entranceMs: 0.61,
      peakDrawMs: 0.09,
    });
    expect(formatHudStatus(summary)).toBe(
      "targets 1 · arrows 0 · rings 1 · hidden 0 · nearest 5.0 m · image indicators" +
        " · entrance 1 animating · 2 redraws · 0.04 ms · total 0.61 ms · peak 0.09 ms",
    );
    const settled = summarizeHudScene(children, at, targets, {
      redraws: 0,
      drawMs: 0,
      animating: 0,
      entranceMs: 0.61,
      peakDrawMs: 0.09,
    });
    expect(formatHudStatus(settled)).not.toContain("entrance");
    // The settling frame itself: one last redraw, nothing animating any more.
    const last = summarizeHudScene(children, at, targets, {
      redraws: 1,
      drawMs: 0.03,
      animating: 0,
      entranceMs: 0.64,
      peakDrawMs: 0.09,
    });
    expect(formatHudStatus(last)).toContain(
      "entrance 0 animating · 1 redraws · 0.03 ms · total 0.64 ms",
    );
  });
});
