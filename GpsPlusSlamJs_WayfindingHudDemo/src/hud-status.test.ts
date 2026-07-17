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

const indicator = (name: string, visible: boolean) => ({ name, visible });

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
    });
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
  it("formats counts and the nearest distance to one decimal", () => {
    expect(
      formatHudStatus({
        targets: 4,
        arrows: 3,
        rings: 1,
        hidden: 0,
        nearest: 19.234,
      }),
    ).toBe("targets 4 · arrows 3 · rings 1 · hidden 0 · nearest 19.2 m");
  });

  it("renders a dash when there is no nearest target", () => {
    expect(
      formatHudStatus({
        targets: 0,
        arrows: 0,
        rings: 0,
        hidden: 0,
        nearest: null,
      }),
    ).toContain("nearest –");
  });
});
