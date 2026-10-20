/**
 * Why these tests matter: the bake at open decides once, when a creator
 * opens a recording, where its photos stand - the tour's own spots, else
 * the recording replayed, else none and why. The stations the page shows
 * from then on are the ones a Finish writes, so the bake must match the
 * rule exactly and must never fail an open.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ArchiveLimitError,
  loadActionsFromZip,
  readZipEntries,
} from "gps-plus-slam-app-framework/storage";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { captureSpotsForRebuild, walkAtOpen } from "./tour-document-bake.js";
import {
  SAMPLE_PHOTOS,
  sampleRecordingBytes,
} from "./test-support/sample-recording.js";
import { tourOf } from "./test-support/v3-tour.js";
import {
  type CaptureSpotsInWorld,
  withWalkPhotos,
  worldCaptureSpots,
} from "./tour-content.js";

function manifestOf(): TourManifest {
  return tourOf([]);
}

/** Spots that let the walk go (any valid ones), as the bake gives them. */
const SPOTS: CaptureSpotsInWorld = {
  fixes: 3,
  gpsAccuracyMedianM: 4,
  captures: [
    {
      image: "images/frame-000002.jpg",
      geo: { lat: 48, lon: 11, alt: 500, rotation: [0, 0, 0, 1] },
    },
  ],
};

describe("captureSpotsForRebuild (M6 E0b: the photos' spots for a save)", () => {
  // Why: the tour's own spots, else baked from its recording, else none -
  // and only a cap or a failed integrity check fails the save. The phone's
  // Finish had this inline; a desktop save of an older tour with a
  // recording must publish the same file the phone would (E0 review #5).
  /** A tour whose spots are already in its stations. */
  const own = withWalkPhotos(manifestOf(), SPOTS);
  const noRecording = {
    hasRecording: false,
    entries: [],
    loadSessionMeta: () => Promise.resolve(null),
    loadRecordingActions: () => Promise.resolve(null),
  };

  it("takes the tour's own spots without reading the recording", async () => {
    const read = vi.fn(() => Promise.resolve(null));
    await expect(
      captureSpotsForRebuild(
        { ...noRecording, hasRecording: true, loadRecordingActions: read },
        own,
      ),
    ).resolves.toEqual({ spots: worldCaptureSpots(own) });
    expect(read).not.toHaveBeenCalled();
  });

  it("has none for a tour without a recording", async () => {
    await expect(
      captureSpotsForRebuild(noRecording, manifestOf()),
    ).resolves.toEqual({});
  });

  it("says why when the recording cannot be read, and does not fail the save", async () => {
    const out = await captureSpotsForRebuild(
      {
        ...noRecording,
        hasRecording: true,
        loadRecordingActions: () => Promise.reject(new Error("bad entry")),
      },
      manifestOf(),
    );
    expect(out).toEqual({
      notPlaced: "reading the recording failed: bad entry",
    });
  });

  it("fails the save on a cap or a failed integrity check", async () => {
    for (const error of [
      new ArchiveLimitError("archive-bytes", 1, 2),
      new TourIntegrityError("bad-signature", "the signature does not match"),
    ]) {
      await expect(
        captureSpotsForRebuild(
          {
            ...noRecording,
            hasRecording: true,
            loadRecordingActions: () => Promise.reject(error),
          },
          manifestOf(),
        ),
      ).rejects.toBe(error);
    }
  });

  it("passes on a bake that declines as the reason", async () => {
    const out = await captureSpotsForRebuild(
      { ...noRecording, hasRecording: true },
      manifestOf(),
    );
    expect(out).toEqual({ notPlaced: "no recording in this tour" });
  });

  it("says a walk that names no photo of the tour places nothing, and gives no reason a Finish would show", async () => {
    // Why (the M4b milestone review #3): such a walk was kept by every
    // lean Finish with "the recorded photos could not be placed ... so the
    // walk recording stays" - about photos that do not exist.
    const bytes = sampleRecordingBytes();
    const actions = (await loadActionsFromZip(bytes)).map((e) => e.action);
    const out = await captureSpotsForRebuild(
      {
        hasRecording: true,
        // The recording's photos are not in this tour.
        entries: (await readZipEntries(bytes))
          .filter((e) => !e.directory && !SAMPLE_PHOTOS.includes(e.filename))
          .map((e) => ({ filename: e.filename, isImage: false })),
        loadSessionMeta: () => Promise.resolve({ odomCoordVersion: 5 }),
        loadRecordingActions: () => Promise.resolve(actions),
      },
      manifestOf(),
    );
    expect(out).toEqual({ placesNothing: true });
  });
});

describe("walkAtOpen (the recording's photos baked when it is opened)", () => {
  // Why these tests matter: a creator's recording is baked once, when it
  // opens, and its photos stand in the tour's stations from then on (the
  // stations the page shows are the ones written). An open must never
  // fail for the bake: a bake that cannot place the photos opens the tour
  // without them and says why.
  const sampleSource = async (
    overrides: Partial<Parameters<typeof walkAtOpen>[0]> = {},
  ): Promise<Parameters<typeof walkAtOpen>[0]> => {
    const bytes = sampleRecordingBytes();
    const actions = (await loadActionsFromZip(bytes)).map((e) => e.action);
    return {
      hasRecording: true,
      entries: (await readZipEntries(bytes))
        .filter((e) => !e.directory)
        .map((e) => ({
          filename: e.filename,
          isImage: SAMPLE_PHOTOS.includes(e.filename),
        })),
      loadSessionMeta: () => Promise.resolve({ odomCoordVersion: 5 }),
      loadRecordingActions: () => Promise.resolve(actions),
      ...overrides,
    };
  };

  it("bakes the recording's photos into stations of the tour it opens", async () => {
    const opened = await walkAtOpen(await sampleSource(), manifestOf());
    expect(opened.photos.spots?.captures.length).toBeGreaterThan(0);
    expect(opened.manifest).toEqual(
      withWalkPhotos(manifestOf(), opened.photos.spots!),
    );
    expect(opened.manifest.stations.length).toBeGreaterThan(0);
    // The format reads what the bake made.
    expect(() =>
      parseTourManifest(JSON.parse(serializeTourManifest(opened.manifest))),
    ).not.toThrow();
  });

  it("opens a tour that has its photos as it is, without reading the recording", async () => {
    const own = withWalkPhotos(manifestOf(), SPOTS);
    const read = vi.fn(() => Promise.resolve(null));
    const opened = await walkAtOpen(
      await sampleSource({ loadRecordingActions: read }),
      own,
    );
    expect(opened.manifest).toBe(own);
    expect(read).not.toHaveBeenCalled();
  });

  it("opens a declined bake's tour as it is, saying why", async () => {
    const base = manifestOf();
    const opened = await walkAtOpen(
      await sampleSource({ loadRecordingActions: () => Promise.resolve(null) }),
      base,
    );
    expect(opened).toEqual({
      manifest: base,
      photos: { notPlaced: "no recording in this tour" },
    });
  });

  it("never fails the open: a cap or a failed integrity check is the reason", async () => {
    const base = manifestOf();
    for (const error of [
      new ArchiveLimitError("archive-bytes", 1, 2),
      new TourIntegrityError("bad-signature", "the signature does not match"),
    ]) {
      const opened = await walkAtOpen(
        await sampleSource({
          loadRecordingActions: () => Promise.reject(error),
        }),
        base,
      );
      expect(opened.manifest).toBe(base);
      expect(opened.photos.notPlaced).toContain(error.message);
    }
  });

  it("opens a tour without a recording as it is, with nothing to say", async () => {
    const base = manifestOf();
    await expect(
      walkAtOpen(await sampleSource({ hasRecording: false }), base),
    ).resolves.toEqual({ manifest: base, photos: {} });
  });
});
