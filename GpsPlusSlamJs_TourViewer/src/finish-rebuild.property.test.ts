/**
 * Why this property matters: whatever mix of edits, additions and
 * deletions a page hands the shared Finish rules (M6 E0), the zip it writes
 * must carry exactly those objects - each id once, edits in place, deleted
 * photos' files gone, kept ones present - and must open again. The
 * example tests pin single cases; this one sweeps the mixes, on real zips.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourPicture,
  type TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { rebuildFinishedTour } from "./finish-rebuild.js";
import { tourOf, withWorldObjects } from "./test-support/tour-of.js";
import { openTourFile } from "./tour-session.js";

const HOSTED = ["a", "b", "c", "d"] as const;

function photo(id: string): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    imageAsset: {
      id: id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function pin(id: string, label: string): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: label,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

describe("rebuildFinishedTour (property)", () => {
  it("writes exactly the edited set: each id once, deleted photos' files gone, kept ones present, and the zip opens again", async () => {
    const hosted = HOSTED.map((id) => photo(id));
    const zip = await packFilesAsZip([
      {
        path: "tour.json",
        data: serializeTourManifest(tourOf(hosted)),
      },
      ...HOSTED.map((id) => ({ path: `content/${id}.jpg`, data: id })),
    ]);
    const tour = await openTourFile(
      new File([zip], "t.zip", { type: "application/zip" }),
    );
    const manifest = tourOf(hosted);
    const here = manifest.stations[0]!.id;
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...HOSTED]),
        fc.subarray([...HOSTED]),
        fc.uniqueArray(fc.constantFrom("n1", "n2", "n3"), { maxLength: 3 }),
        async (deleted, edited, added) => {
          const placed = [
            ...edited.map((id) => ({
              object: { ...photo(id), caption: `edited ${id}` },
            })),
            // A new pin as the tour document hands it over: seated in the
            // station holding it (the writer assigns none).
            ...added.map((id) => ({
              object: { ...pin(id, `new ${id}`), station: here },
            })),
          ];
          const result = await rebuildFinishedTour({
            tour,
            manifest,
            placed,
            deleted,
            levels: [],
            keepScan: false,
            previous: null,
          });
          // Read from the zip's bytes, not the in-memory report (E0 review #1).
          const bytes = new Uint8Array(await result!.blob.arrayBuffer());
          const carried = withWorldObjects(
            parseTourManifest(
              JSON.parse(
                new TextDecoder().decode(
                  readStoredEntryBytes(bytes, "tour.json"),
                ),
              ),
            ),
          );
          const ids = carried.objects.map((o) => o.id);
          expect(new Set(ids).size).toBe(ids.length);
          const expected = [
            ...HOSTED.filter((id) => !deleted.includes(id)),
            ...added,
          ];
          // As a set: since version 3 the order is the stations' (a new
          // pin joins the nearest station within R, D20).
          expect([...ids].sort()).toEqual([...expected].sort());
          const byId = new Map(carried.objects.map((o) => [o.id, o]));
          // A deletion wins over an edit of the same id.
          for (const id of edited.filter((e) => !deleted.includes(e))) {
            expect(byId.get(id)).toMatchObject({ caption: `edited ${id}` });
          }
          const names = readStoredCentralDirectory(bytes).map((e) => e.name);
          for (const id of HOSTED) {
            // Only a deletion takes a photo's file; an edit keeps it.
            expect(names.includes(`content/${id}.jpg`)).toBe(
              !deleted.includes(id),
            );
          }
          const reopened = await openTourFile(
            new File([result!.blob], "t.zip", { type: "application/zip" }),
          );
          await reopened.close();
        },
      ),
      { numRuns: 20 },
    );
    await tour.close();
  });

  // Why (B2a review finding 2): "captured photo" is decided by
  // picture.image === picture.id, and the finish used to remove a deleted
  // captured photo's file, and withPictureAssets drop its asset, without
  // asking whether another picture still names that image - so a save
  // could delete the file of an image the tour still lists, or write a
  // tour whose picture names an asset it no longer lists (every later
  // save refused). Over any sequence of deletions, chained finish on
  // finish: every image a written picture names is listed, every listed
  // asset's file is in the zip, and the zip opens again.
  it("never drops an image another picture still names, over any sequence of deletions", async () => {
    const CAPTURED = ["a", "b", "c"] as const;
    // Pictures that show a captured photo's image without being it.
    const sharer = (id: string, of: string): TourPicture => ({
      ...photo(of),
      id,
    });
    const hosted = [
      ...CAPTURED.map((id) => photo(id)),
      sharer("s1", "a"),
      sharer("s2", "b"),
    ];
    const ids = hosted.map((o) => o.id);
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(tourOf(hosted)) },
      ...CAPTURED.map((id) => ({ path: `content/${id}.jpg`, data: id })),
    ]);
    const tour = await openTourFile(
      new File([zip], "t.zip", { type: "application/zip" }),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.subarray(ids, { minLength: 1 }), {
          minLength: 1,
          maxLength: 3,
        }),
        async (rounds) => {
          let manifest = tourOf(hosted);
          let previous: { blob: Blob } | null = null;
          for (const deleted of rounds) {
            const result = await rebuildFinishedTour({
              tour,
              manifest,
              placed: [],
              deleted,
              levels: [],
              keepScan: false,
              previous,
            });
            const bytes = new Uint8Array(await result!.blob.arrayBuffer());
            const text = new TextDecoder().decode(
              readStoredEntryBytes(bytes, "tour.json"),
            );
            // Parsing checks the references: a picture naming an
            // unlisted asset is refused here.
            const carried = parseTourManifest(JSON.parse(text));
            const listed = new Set(carried.assets.map((a) => a.id));
            const unlisted = withWorldObjects(carried).objects.filter(
              (o) => o.kind === "picture" && !listed.has(o.image),
            );
            expect(unlisted).toEqual([]);
            const names = new Set(
              readStoredCentralDirectory(bytes).map((e) => e.name),
            );
            for (const asset of carried.assets) {
              expect(names.has(asset.path), asset.path).toBe(true);
            }
            const reopened = await openTourFile(
              new File([result!.blob], "t.zip", { type: "application/zip" }),
            );
            await reopened.close();
            manifest = result!.written;
            previous = { blob: result!.blob };
          }
        },
      ),
      { numRuns: 30 },
    );
    await tour.close();
  });
});
