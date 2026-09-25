import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { replayRecording } from "gps-plus-slam-app-framework/state";
import { selectGpsPositions } from "gps-plus-slam-app-framework/state";
import { beforeAll, describe, expect, it } from "vitest";

import { createAuthoringSession } from "./authoring-session.js";
import { createFilesAssetProvider } from "./files-asset-provider.js";
import { MIN_BREADCRUMB_DISTANCE_M } from "../core/breadcrumb-sampler.js";
import type { PositionSource } from "./gps-position-source.js";
import type { AuthoringSliceState } from "../../../store/authoring-slice.js";
import type { TourCoord } from "../../../store/types.js";
import { approxDistanceMetres } from "gps-plus-slam-app-framework/geo";

/**
 * Replay e2e (TASK.md §2.3 component 10, second test level): feed the REAL
 * raw GPS fixes from a Task 1 outdoor walk through the authoring session and
 * assert the sampled breadcrumb trail behaves correctly on genuinely noisy
 * device GPS — deterministic, on a desktop, no phone (plan AU8).
 *
 * Unlike components 4/7/8 (which replay the fused/odometry world-space
 * path), this feeds the RAW `GpsPositions` (`.latitude`/`.longitude`,
 * inherited from `RawGpsPoint`) — exactly what `startGpsWatch` would have
 * delivered live during the original recording, which is what component 10
 * actually consumes (plan AU2: raw, pre-anchoring lat/lon).
 */

function toTourCoord(p: {
  latitude: number;
  longitude: number;
  altitude?: number;
}): TourCoord {
  return p.altitude === undefined
    ? { lat: p.latitude, lon: p.longitude }
    : { lat: p.latitude, lon: p.longitude, altitude: p.altitude };
}

const recordingsDir = fileURLToPath(
  new URL("../../../../recordings/", import.meta.url),
);
const recordingFiles = readdirSync(recordingsDir)
  .filter((f) => f.endsWith(".zip"))
  .sort();

if (recordingFiles.length === 0) {
  throw new Error(`No recording zips found in ${recordingsDir}`);
}

describe.each(recordingFiles)(
  "authoring session replay e2e — real Task 1 walk (%s)",
  (filename) => {
    let path: TourCoord[];

    beforeAll(async () => {
      const zipPath = join(recordingsDir, filename);
      const state = await replayRecording(
        new Uint8Array(readFileSync(zipPath)),
      );
      path = selectGpsPositions(state).map(toTourCoord);
    }, 60_000);

    it("has a real, non-trivial recorded path to replay", () => {
      expect(path.length).toBeGreaterThan(10);
    });

    it("samples a breadcrumb trail where every consecutive pair is at least MIN_BREADCRUMB_DISTANCE_M apart", () => {
      const initialDraft: AuthoringSliceState = {
        name: "",
        description: "",
        assets: [],
        waypoints: [],
        breadcrumb: [],
      };
      let draft = initialDraft;
      let capturedSource!: (pos: TourCoord) => void;
      const positionSource: PositionSource = {
        subscribe(onPosition) {
          capturedSource = onPosition;
          return () => undefined;
        },
      };

      createAuthoringSession({
        positionSource,
        dispatch: (action) => {
          if (action.type === "authoring/addBreadcrumbPoint") {
            draft = {
              ...draft,
              breadcrumb: [...draft.breadcrumb, action.payload],
            };
          }
        },
        getState: () => ({ authoring: draft }),
        filesAssetProvider: createFilesAssetProvider({
          createObjectUrl: () => "blob:fake",
        }),
      });

      for (const pos of path) capturedSource(pos);

      expect(draft.breadcrumb.length).toBeGreaterThan(1);
      for (let i = 1; i < draft.breadcrumb.length; i++) {
        const a = draft.breadcrumb[i - 1]!;
        const b = draft.breadcrumb[i]!;
        const d = approxDistanceMetres(a.lat, a.lon, b.lat, b.lon);
        expect(d).toBeGreaterThanOrEqual(MIN_BREADCRUMB_DISTANCE_M);
      }
    });

    it("dropped waypoints land at the exact recorded position and the resulting export validates", () => {
      const initialDraft: AuthoringSliceState = {
        name: "Replay Test Tour",
        description: "",
        assets: [],
        waypoints: [],
        breadcrumb: [],
      };
      let draft = initialDraft;
      let capturedSource!: (pos: TourCoord) => void;
      const positionSource: PositionSource = {
        subscribe(onPosition) {
          capturedSource = onPosition;
          return () => undefined;
        },
      };

      const session = createAuthoringSession({
        positionSource,
        dispatch: (action) => {
          if (action.type === "authoring/addBreadcrumbPoint") {
            draft = {
              ...draft,
              breadcrumb: [...draft.breadcrumb, action.payload],
            };
          } else if (action.type === "authoring/addWaypoint") {
            draft = {
              ...draft,
              waypoints: [
                ...draft.waypoints,
                {
                  id: action.payload.id,
                  position: action.payload.position,
                  prefetchRadius: 25,
                  activeRadius: 10,
                  content: {},
                },
              ],
            };
          }
        },
        getState: () => ({ authoring: draft }),
        filesAssetProvider: createFilesAssetProvider({
          createObjectUrl: () => "blob:fake",
        }),
      });

      const dropIndices = [
        Math.floor(path.length * 0.25),
        Math.floor(path.length * 0.75),
      ];
      let nextDropIndex = 0;
      path.forEach((pos, i) => {
        capturedSource(pos);
        if (i === dropIndices[nextDropIndex]) {
          session.dropWaypoint();
          nextDropIndex += 1;
        }
      });

      expect(draft.waypoints).toHaveLength(2);
      expect(draft.waypoints[0]!.position).toEqual(path[dropIndices[0]!]);
      expect(draft.waypoints[1]!.position).toEqual(path[dropIndices[1]!]);

      const { tour } = session.exportTour();
      expect(tour.waypoints).toHaveLength(2);
    });
  },
);
