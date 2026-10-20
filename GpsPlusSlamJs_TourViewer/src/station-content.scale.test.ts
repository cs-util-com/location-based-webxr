import { describe, expect, it } from "vitest";
import { Group, Object3D, Texture } from "three";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { renderTourStation } from "./content-placement.js";
import { createStationContent, type ContentPart } from "./station-content.js";

/**
 * Why this test matters (visitor plan 2026-10-18-2349 §3, M2): the point of
 * drawing per station is that a 100-station town walk costs one station's
 * objects and textures in the scene, not a hundred. This builds such a
 * tour with the real station renderer and counts what stands in the scene
 * with one station present, while switching, and with "show all" - so a
 * regression that mounts every station (or keeps a left station's
 * textures) fails on a number, not on a feeling of slowness.
 */

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ZERO = { lat: 47.5, lon: 8.7 };
const NOW = "2026-10-19T08:00:00.000Z";
const STATIONS = 100;
const FADE = 400;

/** A 10 x 10 grid, 40 m apart; each station two pins and two photos. */
function tourOf(count: number): TourStation[] {
  return Array.from({ length: count }, (_, i) => {
    const geo = calcGpsCoords(ZERO, [
      40 * Math.floor(i / 10),
      0,
      40 * (i % 10),
    ]);
    const pose = (n: number) => ({
      position: [n, 1.5, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    });
    return {
      id: `s${String(i)}`,
      geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
      activateRadiusM: 50,
      foundRadiusM: 10,
      hint: "arrow",
      steps: [],
      items: [
        {
          id: `p${String(i)}a`,
          kind: "pin",
          label: "A",
          createdAtIso: NOW,
          pose: pose(1),
        },
        {
          id: `p${String(i)}b`,
          kind: "pin",
          label: "B",
          createdAtIso: NOW,
          pose: pose(2),
        },
        {
          id: `f${String(i)}a`,
          kind: "photo",
          image: `content/f${String(i)}a.jpg`,
          imageWidth: 4,
          imageHeight: 3,
          createdAtIso: NOW,
          pose: pose(3),
        },
        {
          id: `f${String(i)}b`,
          kind: "photo",
          image: `content/f${String(i)}b.jpg`,
          imageWidth: 4,
          imageHeight: 3,
          createdAtIso: NOW,
          pose: pose(4),
        },
      ],
    } satisfies TourStation;
  });
}

function harness() {
  const scene = new Group();
  const clock = { ms: 1000 };
  const live = new Set<Texture>();
  const content = createStationContent({
    scene,
    now: () => clock.ms,
    fadeMs: FADE,
  });
  for (const station of tourOf(STATIONS)) {
    const part: ContentPart = {
      render: (parent, alive) =>
        renderTourStation(station, {
          scene: parent,
          zero: ZERO,
          alive,
          makeLabel: () => ({
            object: new Object3D(),
            dispose: () => undefined,
          }),
          loadPhotoTexture: () => {
            const texture = new Texture();
            live.add(texture);
            texture.dispose = () => {
              live.delete(texture);
            };
            return Promise.resolve(texture);
          },
        }),
    };
    content.setPart(station.id, "items", part);
  }
  /** Every object under the scene root, the root itself not counted. */
  const objects = (): number => {
    let n = -1;
    scene.traverse(() => {
      n += 1;
    });
    return n;
  };
  const groups = (): number =>
    scene.children.filter((c) => c.name.startsWith("station-content:")).length;
  /** Let queued renders settle (each awaits its photos), then step. */
  const at = async (ms: number) => {
    clock.ms = ms;
    for (let i = 0; i < 4 * STATIONS; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    content.update(clock.ms);
  };
  return { content, objects, groups, live, at };
}

describe("a generated 100-station tour in the scene", () => {
  it("stands one station's objects and textures while one is present, and all only on show all", async () => {
    const h = harness();
    await h.at(1000);
    expect(h.objects()).toBe(0);

    h.content.show(new Set(["s0"]));
    await h.at(1000);
    await h.at(1000 + FADE);
    const one = h.objects();
    // One group: the station-content group, the station frame, the items'
    // group, two labels and two photo planes.
    expect(h.groups()).toBe(1);
    expect(one).toBe(7);
    expect(h.live.size).toBe(2);
    expect(h.content.shown().count).toBe(4);

    // Walking on: the left station fades out first, then the next mounts;
    // never two groups, and the left station's textures are freed. The next
    // station decodes during the fade-out (off the scene), so a switch holds
    // two stations' textures at its peak, never more.
    h.content.show(new Set(["s1"]));
    await h.at(1000 + FADE + FADE / 2);
    expect(h.groups()).toBe(1);
    expect(h.live.size).toBe(4);
    await h.at(1000 + 2 * FADE);
    await h.at(1000 + 3 * FADE);
    expect(h.groups()).toBe(1);
    expect(h.objects()).toBe(one);
    expect(h.live.size).toBe(2);

    h.content.show(new Set(tourOf(STATIONS).map((s) => s.id)));
    await h.at(1000 + 4 * FADE);
    await h.at(1000 + 5 * FADE);
    expect(h.groups()).toBe(STATIONS);
    expect(h.objects()).toBe(STATIONS * one);
    expect(h.live.size).toBe(2 * STATIONS);

    h.content.dispose();
    expect(h.objects()).toBe(0);
    expect(h.live.size).toBe(0);
  });
});
