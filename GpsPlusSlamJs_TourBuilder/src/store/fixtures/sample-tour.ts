/**
 * Canonical sample tour — one tour, three waypoints, two assets.
 *
 * The single fixture shared by `store.test.ts` and the demo page so tests and
 * the interactive panel exercise identical data. `sample-tour.json` is the
 * hand-written on-disk mirror of this object (kept in sync); this typed const
 * is the source of truth for code. It passes `validateTour` by construction —
 * `store.test.ts` asserts that so drift is caught.
 *
 * Coverage baked in: wp-1 has a sprite + audio + transcript, wp-2 is
 * transcript-only, wp-3 is empty (a pure breadcrumb stop). That lets selector
 * tests hit the model / sprite / empty branches of `selectWaypointVisual` and
 * the visited/next-unvisited logic without inline fixtures.
 */

import type { Tour } from "../types.js";

export const sampleTour: Tour = {
  id: "tour-castle",
  name: "Castle Ruins Walk",
  description: "A short walk through the old castle grounds.",
  assets: [
    { id: "asset-gate", type: "sprite", filename: "assets/asset-gate.png" },
    { id: "asset-intro", type: "audio", filename: "assets/asset-intro.mp3" },
  ],
  waypoints: [
    {
      id: "wp-1",
      position: { lat: 52.5163, lon: 13.3777, altitude: 34 },
      prefetchRadius: 25,
      activeRadius: 10,
      content: {
        sprite: "asset-gate",
        audio: "asset-intro",
        transcript: "Sir Aldric guarded this gate for thirty winters.",
      },
    },
    {
      id: "wp-2",
      position: { lat: 52.5165, lon: 13.3781 },
      prefetchRadius: 20,
      activeRadius: 8,
      content: {
        transcript: "The inner courtyard once held a market every spring.",
      },
    },
    {
      id: "wp-3",
      position: { lat: 52.5168, lon: 13.3786 },
      prefetchRadius: 15,
      activeRadius: 6,
      content: {},
    },
  ],
  breadcrumb: [
    { lat: 52.5163, lon: 13.3777 },
    { lat: 52.5165, lon: 13.3781 },
    { lat: 52.5168, lon: 13.3786 },
  ],
};
