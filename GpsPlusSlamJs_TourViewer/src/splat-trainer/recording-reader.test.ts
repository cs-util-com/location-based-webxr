import { describe, expect, it } from "vitest";
import type { Matrix4 } from "gps-plus-slam-app-framework/core";
import {
  ArchiveLimitError,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";
import { SEGMENTING_ACTION_TYPES } from "gps-plus-slam-app-framework/state/segmenting-actions";
import { WIDE_TEST_PROJECTION } from "gps-plus-slam-app-framework/test-utils/synthetic-depth-samples";
import { pinholeFromProjection } from "gps-plus-slam-app-framework/utils/pinhole-from-projection";

import {
  buildSyntheticRecording,
  SYNTHETIC_DEPTH_GRID,
  SYNTHETIC_FRAME_SIZE,
  SYNTHETIC_LAST_MODIFIED,
  SYNTHETIC_PROJECTION,
} from "../test-support/synthetic-recording.js";
import { readZipBlobEntry } from "../zip-blob.js";
import {
  ASPECT_TOL,
  PROJ_TOL,
  readRecordingPhotos,
  readSplatInputs,
  type SplatInputs,
  type SplatInputsRead,
} from "./recording-reader.js";

/**
 * Why these tests matter: the reader is the trainer's only door to a
 * recording. A wrong pose, lens or frame size here trains a splat that
 * looks plausible and is wrong everywhere, and a recording it should
 * refuse (an old era, a moved coordinate frame, a changed lens) trains
 * garbage with no warning. Every refusal must reach the creator as words.
 */

async function readOk(file: Blob): Promise<SplatInputs> {
  const read = await readSplatInputs(file);
  if (read.kind !== "read") throw new Error(`refused: ${read.reason}`);
  return read.inputs;
}

function reasonOf(read: SplatInputsRead): string {
  if (read.kind !== "refused") throw new Error("expected a refusal");
  return read.reason;
}

/** The test projection with element `index` moved by `delta`. */
function nudged(index: number, delta: number): Matrix4 {
  const m = [...SYNTHETIC_PROJECTION];
  m[index] = (m[index] ?? 0) + delta;
  return m as unknown as Matrix4;
}

describe("readSplatInputs on the synthetic walk", () => {
  it("gives back every capture's recorded pose, time and photo entry, in walk order", async () => {
    // Why: the trainer's cameras are these poses; a reordered, converted
    // or dropped pose puts every photo in the wrong place.
    const rec = await buildSyntheticRecording();
    const inputs = await readOk(rec.file);
    expect(inputs.captures.map((c) => c.position)).toEqual(
      rec.poses.map((p) => p.position),
    );
    expect(inputs.captures.map((c) => c.rotation)).toEqual(
      rec.poses.map((p) => p.rotation),
    );
    expect(inputs.captures.map((c) => c.capturedAt)).toEqual(rec.capturedAt);
    expect(inputs.captures.map((c) => c.entry)).toEqual(rec.photoEntries);
    // The walk turns at every capture, so a rotation paired with another
    // capture's position cannot pass the comparison above.
    const rotations = new Set(rec.poses.map((p) => JSON.stringify(p.rotation)));
    expect(rotations.size).toBe(rec.poses.length);
  });

  it("orders the captures by their capture time, not by when they were written", async () => {
    // Why: a photo can be written after a later one (encoding takes its
    // own time), and every spacing, speed and window downstream assumes
    // the walk runs forward in time; a negative median spacing was the
    // symptom.
    const rec = await buildSyntheticRecording({ frames: 5, intervalMs: -700 });
    const inputs = await readOk(rec.file);
    expect(inputs.captures.map((c) => c.entry)).toEqual(
      [...rec.photoEntries].reverse(),
    );
    expect(inputs.census.medianSpacingS).toBe(0.7);
  });

  it("keeps the recorded order and reports no time spacing when a capture has no time", async () => {
    // Why: one untimed capture cannot be placed in time; sorting around it
    // would invent an order, and a spacing across it would mislead.
    const rec = await buildSyntheticRecording({
      frames: 4,
      extraEntries: [
        { path: "images/untimed.jpg", data: new Uint8Array([0xff, 0xd8]) },
        {
          path: "actions/900000.json",
          data: JSON.stringify({
            type: "gpsData/add2dImage",
            payload: {
              imageFile: "images/untimed.jpg",
              position: [9, 1.5, 0],
              rotation: [0, 0, 0, 1],
              ...SYNTHETIC_FRAME_SIZE,
            },
          }),
        },
      ],
    });
    const inputs = await readOk(rec.file);
    expect(inputs.captures.map((c) => c.entry)).toEqual([
      ...rec.photoEntries,
      "images/untimed.jpg",
    ]);
    expect(inputs.census.medianSpacingS).toBeNull();
  });

  it("takes the lens from the depth samples' projection exactly, with no half-pixel step", async () => {
    // Why: a second pixel-convention step after `pinholeFromProjection`
    // shifts every principal point by half a pixel, which no later sweep
    // can see. The test projection is centred, so the principal point
    // must be exactly the frame's centre.
    const inputs = await readOk((await buildSyntheticRecording()).file);
    const { width, height } = SYNTHETIC_FRAME_SIZE;
    expect(inputs.intrinsics).toEqual(
      pinholeFromProjection(SYNTHETIC_PROJECTION, width, height),
    );
    expect(inputs.intrinsics.cx).toBe(width / 2);
    expect(inputs.intrinsics.cy).toBe(height / 2);
    expect(inputs.projectionMatrix).toEqual(SYNTHETIC_PROJECTION);
  });

  it("counts the walk exactly in its census", async () => {
    // Why: the census is what a creator sees before committing to a long
    // run; a wrong count or spacing misleads that choice.
    const inputs = await readOk(
      (
        await buildSyntheticRecording({
          frames: 6,
          spacingM: 0.5,
          intervalMs: 800,
        })
      ).file,
    );
    const { pathM, medianSpacingM, ...rest } = inputs.census;
    expect(pathM).toBeCloseTo(2.5, 12);
    expect(medianSpacingM).toBeCloseTo(0.5, 12);
    expect(rest).toEqual({
      frames: 6,
      skippedFrames: 0,
      medianSpacingS: 0.8,
      frameWidth: SYNTHETIC_FRAME_SIZE.width,
      frameHeight: SYNTHETIC_FRAME_SIZE.height,
      depthSamples: 6,
      projectionSpread: 0,
      era: 5,
    });
  });

  it("reads packed depth samples back to the points that were recorded", async () => {
    // Why: the Recorder writes depth packed; a reader that saw only the
    // packed payload's empty `points` would find no depth at all.
    const rec = await buildSyntheticRecording();
    const written = JSON.parse(
      await (await readZipBlobEntry(rec.file, "actions/000001.json")).text(),
    ) as { type: string; payload: { points: unknown[]; grid?: unknown } };
    expect(written.type).toBe("recording/recordDepthSample");
    expect(written.payload.points).toEqual([]);
    expect(written.payload.grid).toBeDefined();

    const inputs = await readOk(rec.file);
    expect(inputs.depthSamples.map((s) => s.points)).toEqual(
      rec.depthSamples.map((s) => s.points),
    );
    expect(inputs.depthSamples[0]?.points).toHaveLength(
      SYNTHETIC_DEPTH_GRID ** 2,
    );
  });

  it("reads unpacked depth samples the same way", async () => {
    const rec = await buildSyntheticRecording({ packDepth: false });
    const inputs = await readOk(rec.file);
    expect(inputs.depthSamples.map((s) => s.points)).toEqual(
      rec.depthSamples.map((s) => s.points),
    );
  });

  it("fingerprints the file: stable for the same bytes, changed by any action", async () => {
    // Why: a resumed training must be refused for another file; the
    // fingerprint is what tells two recordings apart.
    const a = await readOk((await buildSyntheticRecording()).file);
    const b = await readOk((await buildSyntheticRecording()).file);
    const c = await readOk(
      (await buildSyntheticRecording({ spacingM: 0.51 })).file,
    );
    const file = (await buildSyntheticRecording()).file;
    expect(a.fingerprint).toEqual({
      size: file.size,
      lastModified: SYNTHETIC_LAST_MODIFIED,
      contentKey: expect.stringMatching(/^local-file:[0-9a-f]{32}$/),
    });
    expect(b.fingerprint).toEqual(a.fingerprint);
    expect(c.fingerprint.contentKey).not.toBe(a.fingerprint.contentKey);
    const blob = await readOk(new Blob([file]));
    expect(blob.fingerprint.lastModified).toBeNull();
  });

  it("tells apart two recordings whose files differ only in content, not in size", async () => {
    // Why: a corrected copy of a walk can keep every file's length; only
    // the content checksum separates it from the original, so a key of
    // names and sizes alone would let resume mix the two.
    const withAction = (value: number) =>
      buildSyntheticRecording({
        extraEntries: [
          {
            path: "actions/900000.json",
            data: JSON.stringify({ type: "x/y", payload: { v: value } }),
          },
        ],
      });
    const one = await withAction(1);
    const two = await withAction(2);
    expect(two.file.size).toBe(one.file.size);
    const a = await readOk(one.file);
    const b = await readOk(two.file);
    expect(b.fingerprint.contentKey).not.toBe(a.fingerprint.contentKey);
  });
});

describe("readSplatInputs skips what it cannot use", () => {
  it("skips and counts captures whose photo the zip lacks, measuring the path through the rest", async () => {
    // Why: a capture with no photo cannot train; dropping it silently
    // would hide a damaged recording from the census.
    const rec = await buildSyntheticRecording({
      frames: 6,
      spacingM: 0.5,
      missingPhotos: [1, 5],
    });
    const inputs = await readOk(rec.file);
    expect(inputs.census.frames).toBe(4);
    expect(inputs.census.skippedFrames).toBe(2);
    expect(inputs.census.pathM).toBeCloseTo(2, 12);
    expect(inputs.captures.map((c) => c.entry)).toEqual(
      [0, 2, 3, 4].map((i) => rec.photoEntries[i]),
    );
  });

  it("skips and counts a capture that names no file", async () => {
    const rec = await buildSyntheticRecording({
      extraEntries: [
        {
          path: "actions/900000.json",
          data: JSON.stringify({
            type: "gpsData/add2dImage",
            payload: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
          }),
        },
      ],
    });
    const inputs = await readOk(rec.file);
    expect(inputs.census.frames).toBe(6);
    expect(inputs.census.skippedFrames).toBe(1);
  });

  it("keeps the last pose of a photo captured twice, once", async () => {
    // Why: the zip keeps a re-captured file's last write, so only the
    // last pose belongs to the photo it carries.
    const rec = await buildSyntheticRecording({
      extraEntries: [
        {
          path: "actions/900000.json",
          data: JSON.stringify({
            type: "gpsData/add2dImage",
            payload: {
              imageFile: "images/frame-000001.jpg",
              position: [9, 9, 9],
              rotation: [0, 0, 0, 1],
              screenRotation: 0,
              capturedAt: 0,
              ...SYNTHETIC_FRAME_SIZE,
            },
          }),
        },
      ],
    });
    const inputs = await readOk(rec.file);
    expect(inputs.census.frames).toBe(6);
    expect(inputs.captures[0]?.position).toEqual([9, 9, 9]);
  });

  it("judges the photo size by the capture it keeps, not by one it replaced", async () => {
    // Why: only the last capture of a file belongs to the photo the zip
    // carries; a size the replaced capture recorded says nothing about it.
    const rec = await buildSyntheticRecording({
      frameSizeAt: (i) =>
        i === 0 ? { width: 48, height: 64 } : SYNTHETIC_FRAME_SIZE,
      extraEntries: [
        {
          path: "actions/900000.json",
          data: JSON.stringify({
            type: "gpsData/add2dImage",
            payload: {
              imageFile: "images/frame-000001.jpg",
              position: [9, 9, 9],
              rotation: [0, 0, 0, 1],
              capturedAt: 0,
              ...SYNTHETIC_FRAME_SIZE,
            },
          }),
        },
      ],
    });
    const inputs = await readOk(rec.file);
    expect(inputs.census.frames).toBe(6);
    expect(inputs.census.frameWidth).toBe(SYNTHETIC_FRAME_SIZE.width);
  });

  it("skips a capture with a broken pose whose photo the zip lacks", async () => {
    // Why: a capture without its photo is skipped whatever it says; its
    // pose cannot matter, so it must not refuse the whole recording.
    const rec = await buildSyntheticRecording({
      extraEntries: [
        {
          path: "actions/900000.json",
          data: JSON.stringify({
            type: "gpsData/add2dImage",
            payload: { imageFile: "images/gone.jpg", position: ["0", 0, 0] },
          }),
        },
      ],
    });
    const inputs = await readOk(rec.file);
    expect(inputs.census.frames).toBe(6);
    expect(inputs.census.skippedFrames).toBe(1);
  });

  it("finds a re-zipped recording's photos under its wrapping folder", async () => {
    // Why: zipping a recording's folder wraps every entry in it, while a
    // capture names its photo relative to the recording; read by bare
    // name, every capture was skipped and the recording refused.
    const rec = await buildSyntheticRecording({ folder: "mytour/" });
    const inputs = await readOk(rec.file);
    expect(inputs.census.frames).toBe(6);
    expect(inputs.census.skippedFrames).toBe(0);
    expect(
      inputs.captures.every((c) => c.entry.startsWith("mytour/images/")),
    ).toBe(true);
  });
});

describe("readSplatInputs refuses, in words", () => {
  it.each([4, 5])("accepts era %s", async (era) => {
    const inputs = await readOk((await buildSyntheticRecording({ era })).file);
    expect(inputs.census.era).toBe(era);
  });

  it.each([
    ["era 3", 3],
    ["a missing era", undefined],
    ["a fractional era", 4.5],
    ["an era written as text", "5"],
  ])("refuses %s as predating the format", async (_name, era) => {
    // Why: eras 1-3 frame their raw poses differently, and training on
    // them without migration gives wrongly placed cameras.
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ era })).file,
    );
    expect(reasonOf(read)).toBe(
      "The recording predates the current format (no migration here).",
    );
  });

  it("refuses an era newer than this page knows", async () => {
    // Why: a newer era's raw poses may be framed in a way this build
    // cannot read; "predates" would be untrue for it.
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ era: 6 })).file,
    );
    expect(reasonOf(read)).toMatch(/newer than this page understands/);
  });

  it("refuses a recording without session.json", async () => {
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ era: "no-session" })).file,
    );
    expect(reasonOf(read)).toBe(
      "The recording has no session.json, so its format is unknown.",
    );
  });

  it.each([...SEGMENTING_ACTION_TYPES])(
    "refuses a recording whose coordinate frame moved mid-walk (%s)",
    async (type) => {
      // Why: poses on the two sides of a tracking restart or loop closure
      // live in different frames; one splat across them doubles the scene.
      const read = await readSplatInputs(
        (await buildSyntheticRecording({ midWalkActionType: type })).file,
      );
      expect(reasonOf(read)).toBe(
        "The recording's coordinate frame changed mid-walk (tracking restart or loop closure).",
      );
    },
  );

  it("refuses a recording without depth, since the lens is unknown", async () => {
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ depth: false })).file,
    );
    expect(reasonOf(read)).toBe(
      "This recording has no depth data, so the camera's lens is unknown. Record with depth on.",
    );
    // Why: the page words this refusal by its code, never by matching the
    // sentence, so a reworded reason cannot change the page's heading.
    expect(read.kind === "refused" && read.code).toBe("no-depth");
  });

  it("refuses depth data that carries no lens, in its own words", async () => {
    // Why: a recording made with depth on, before depth samples carried
    // the projection, must not be told to "record with depth on".
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ projectionAt: () => null })).file,
    );
    expect(reasonOf(read)).toBe(
      "This recording's depth data does not include the camera's lens, so the lens is unknown. Recordings from a current recorder include it.",
    );
    // A recording that has depth is not a "no depth" refusal.
    expect(read.kind === "refused" && read.code).toBeUndefined();
  });

  it("refuses depth data whose lens is there but whose poses are broken, in its own words", async () => {
    // Why: telling the creator their recording lacks the lens, when it has
    // one and the samples are damaged, sends them to re-record with a
    // recorder that already writes it.
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ brokenDepthPose: true })).file,
    );
    expect(reasonOf(read)).toBe(
      "This recording's depth data carries the camera's lens, but its camera poses or depth points are unreadable, so the lens cannot be used.",
    );
  });

  it("ignores a change of the near and far planes, which are not part of the lens", async () => {
    // Why: an app may move its clip planes after the first frames; only
    // the focal and centre terms (elements 0, 5, 8 and 9) are the lens,
    // so a moved plane must neither refuse nor count as spread.
    const moved = [...SYNTHETIC_PROJECTION];
    moved[10] = (moved[10] ?? 0) + 0.02;
    moved[14] = (moved[14] ?? 0) + 0.18;
    const inputs = await readOk(
      (
        await buildSyntheticRecording({
          projectionAt: (i) =>
            i === 0 ? SYNTHETIC_PROJECTION : (moved as unknown as Matrix4),
        })
      ).file,
    );
    expect(inputs.census.projectionSpread).toBe(0);
  });

  it("refuses a lens whose shape does not fit the photos", async () => {
    // Why: a square frustum on 4:3 photos gives pixels a third wider than
    // tall; trained as it is, every view would be stretched.
    const read = await readSplatInputs(
      (
        await buildSyntheticRecording({
          projectionAt: () => WIDE_TEST_PROJECTION,
        })
      ).file,
    );
    expect(reasonOf(read)).toBe(
      "The recording's lens does not fit the shape of its photos (it would stretch them by 33.3 %).",
    );
  });

  it("names a stretch just past the tolerance with one decimal", async () => {
    // Why: rounded to whole percent, a 2.4 % stretch read "2 %", the same
    // number as the tolerance it was refused for.
    const read = await readSplatInputs(
      (
        await buildSyntheticRecording({
          projectionAt: () => nudged(0, (SYNTHETIC_PROJECTION[0] ?? 0) * 0.024),
        })
      ).file,
    );
    expect(reasonOf(read)).toBe(
      "The recording's lens does not fit the shape of its photos (it would stretch them by 2.4 %).",
    );
  });

  it("never prints the tolerance itself for a stretch just past it", async () => {
    // Why: one decimal rounds a 2.03 % stretch to "2.0 %", which reads as
    // the 2 % tolerance it was refused for.
    const read = await readSplatInputs(
      (
        await buildSyntheticRecording({
          projectionAt: () =>
            nudged(0, (SYNTHETIC_PROJECTION[0] ?? 0) * 0.0203),
        })
      ).file,
    );
    expect(reasonOf(read)).toBe(
      "The recording's lens does not fit the shape of its photos (it would stretch them by just over 2 %).",
    );
  });

  it("accepts a lens whose shape fits the photos within the tolerance", async () => {
    // Why: real lenses differ from square pixels by a fraction of a
    // percent; that must never refuse a good recording.
    const inputs = await readOk(
      (
        await buildSyntheticRecording({
          projectionAt: () =>
            nudged(0, (SYNTHETIC_PROJECTION[0] ?? 0) * ASPECT_TOL * 0.5),
        })
      ).file,
    );
    expect(inputs.intrinsics.fx / inputs.intrinsics.fy).toBeCloseTo(
      1 + ASPECT_TOL * 0.5,
      6,
    );
  });

  it("refuses a zip that holds more than one recording", async () => {
    // Why: actions from two walks would be read as one, with the folder
    // and era of the first; the poses of the second would sit in the
    // wrong frame.
    const read = await readSplatInputs(
      (
        await buildSyntheticRecording({
          folder: "first/",
          extraEntries: [
            { path: "second/session.json", data: '{"odomCoordVersion":5}' },
            {
              path: "second/actions/000001.json",
              data: JSON.stringify({ type: "gpsData/setZeroPos", payload: {} }),
            },
          ],
        })
      ).file,
    );
    expect(reasonOf(read)).toBe(
      "This zip holds more than one recording (first/, second/). Give the trainer one recording at a time.",
    );
  });

  it("accepts projection jitter within the tolerance and reports its spread", async () => {
    // Why: float round-off between samples must never refuse a good
    // recording; the spread still shows in the census. A centre term
    // (element 8, zero here) moves by exactly the jitter on the floor of 1.
    const jitter = PROJ_TOL / 2;
    const inputs = await readOk(
      (
        await buildSyntheticRecording({
          projectionAt: (i) =>
            i === 3 ? nudged(8, jitter) : SYNTHETIC_PROJECTION,
        })
      ).file,
    );
    expect(inputs.census.projectionSpread).toBeCloseTo(jitter, 12);
  });

  it("refuses a lens that changed beyond the tolerance, naming the spread", async () => {
    const read = await readSplatInputs(
      (
        await buildSyntheticRecording({
          projectionAt: (i) =>
            i === 3 ? nudged(8, 0.01) : SYNTHETIC_PROJECTION,
        })
      ).file,
    );
    expect(reasonOf(read)).toBe(
      "The camera's lens changed during the recording: its projection differs by up to 0.010, more than the 0.0001 allowed.",
    );
  });

  it("refuses a degenerate lens", async () => {
    const zero = new Array<number>(16).fill(0) as unknown as Matrix4;
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ projectionAt: () => zero })).file,
    );
    expect(reasonOf(read)).toBe("The recording's lens data cannot be used.");
  });

  it("refuses captures that do not record their photo size", async () => {
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ frameSizeAt: () => null })).file,
    );
    expect(reasonOf(read)).toMatch(/does not say how large its photos are/);
  });

  it("refuses photos of different sizes", async () => {
    const read = await readSplatInputs(
      (
        await buildSyntheticRecording({
          frameSizeAt: (i) =>
            i === 2 ? { width: 48, height: 64 } : SYNTHETIC_FRAME_SIZE,
        })
      ).file,
    );
    expect(reasonOf(read)).toBe(
      "The recording's photos are not all the same size.",
    );
  });

  it("refuses a recording none of whose photos the zip carries", async () => {
    const read = await readSplatInputs(
      (await buildSyntheticRecording({ frames: 3, missingPhotos: [0, 1, 2] }))
        .file,
    );
    expect(reasonOf(read)).toBe(
      "None of the recording's camera captures has its photo in the zip.",
    );
  });

  it("refuses a recording with no camera captures", async () => {
    const read = await readSplatInputs(
      (
        await buildSyntheticRecording({
          frames: 0,
          extraEntries: [
            {
              path: "actions/000001.json",
              data: JSON.stringify({ type: "gpsData/setZeroPos", payload: {} }),
            },
          ],
        })
      ).file,
    );
    expect(reasonOf(read)).toBe("The recording has no camera captures.");
  });

  it("refuses a capture whose pose is not numbers", async () => {
    const read = await readSplatInputs(
      (
        await buildSyntheticRecording({
          extraEntries: [
            {
              path: "actions/900000.json",
              data: JSON.stringify({
                type: "gpsData/add2dImage",
                payload: {
                  imageFile: "images/frame-000001.jpg",
                  position: ["0", 0, 0],
                  rotation: [0, 0, 0, 1],
                },
              }),
            },
          ],
        })
      ).file,
    );
    expect(reasonOf(read)).toBe(
      "The camera capture images/frame-000001.jpg carries no valid pose.",
    );
  });

  it("refuses a file that is not a zip", async () => {
    const read = await readSplatInputs(new File(["hello"], "notes.zip"));
    expect(reasonOf(read)).toBe("This file is not a zip recording.");
  });

  it("refuses a zip that holds no recording", async () => {
    const zip = await packFilesAsZip([{ path: "readme.txt", data: "hi" }]);
    expect(reasonOf(await readSplatInputs(zip))).toBe(
      "This zip holds no recording (it has no actions).",
    );
  });
});

describe("readSplatInputs holds the archive caps", () => {
  // Why: the file comes from anywhere; a crafted zip must not make the
  // page read or inflate without bound. Each cap's refusal is the
  // framework's own sentence.
  it("refuses a file over the archive size cap before reading it", async () => {
    const { file } = await buildSyntheticRecording();
    const read = await readSplatInputs(file, {
      limits: { maxArchiveBytes: file.size - 1 },
    });
    expect(reasonOf(read)).toBe(
      new ArchiveLimitError("archive-bytes", file.size - 1).message,
    );
  });

  it("refuses a zip whose directory is over the directory cap", async () => {
    // Why: the directory is read in one piece; a crafted zip with a huge
    // directory must be refused before that read, not after.
    const { file } = await buildSyntheticRecording();
    const read = await readSplatInputs(file, {
      limits: { maxDirectoryBytes: 64 },
    });
    expect(reasonOf(read)).toBe(
      new ArchiveLimitError("directory-bytes", 64).message,
    );
  });

  it("refuses a zip over the entry-count cap", async () => {
    const { file } = await buildSyntheticRecording();
    const read = await readSplatInputs(file, { limits: { maxEntries: 5 } });
    expect(reasonOf(read)).toBe(
      new ArchiveLimitError("entry-count", 5).message,
    );
  });

  it("refuses a text entry over the text cap", async () => {
    const { file } = await buildSyntheticRecording();
    const read = await readSplatInputs(file, {
      limits: { maxTextEntryBytes: 64 },
    });
    expect(reasonOf(read)).toBe(
      new ArchiveLimitError("entry-bytes", 64).message,
    );
  });

  it("refuses a zip that inflates past its total budget", async () => {
    const { file } = await buildSyntheticRecording({ frames: 12 });
    const limit = 2048;
    const read = await readSplatInputs(file, {
      limits: {
        totalFloorBytes: limit,
        maxTotalBytes: limit,
        totalRatio: 0.01,
      },
    });
    expect(reasonOf(read)).toBe(
      new ArchiveLimitError("total-bytes", limit).message,
    );
  });

  it("rejects an invalid cap override as a programming mistake, not a refusal", async () => {
    // Why: a cap of 0 or NaN would refuse everything or nothing; it is a
    // caller's bug and must not read as a bad file.
    const { file } = await buildSyntheticRecording({ frames: 1 });
    await expect(
      readSplatInputs(file, { limits: { maxEntries: 0 } }),
    ).rejects.toThrow(RangeError);
  });

  it("refuses an action file over the action size cap", async () => {
    const big = JSON.stringify({ type: "x", payload: "a".repeat(1_100_000) });
    const { file } = await buildSyntheticRecording({
      extraEntries: [{ path: "actions/900000.json", data: big }],
    });
    expect(reasonOf(await readSplatInputs(file))).toMatch(
      /^The recording could not be read \(Action file "actions\/900000\.json" .* exceeds maximum allowed size/,
    );
  });
});

describe("readRecordingPhotos", () => {
  // Why: the GPU trainer reads only a window's photos, in the job's order;
  // a reordered list trains each camera on another camera's photo, and a
  // missing entry must fail in words instead of training on nothing.
  it("reads the named photos in the order asked", async () => {
    const rec = await buildSyntheticRecording();
    const names = [rec.photoEntries[2], rec.photoEntries[0]].filter(
      (n): n is string => n !== undefined,
    );
    const photos = await readRecordingPhotos(rec.file, names);
    const expected = await Promise.all(
      names.map((n) => readZipBlobEntry(rec.file, n)),
    );
    expect(photos).toHaveLength(2);
    for (const [i, p] of photos.entries()) {
      expect(new Uint8Array(await p.arrayBuffer())).toEqual(
        new Uint8Array(await (expected[i] as Blob).arrayBuffer()),
      );
    }
  });

  it("rejects, naming it, a photo the recording lacks", async () => {
    const rec = await buildSyntheticRecording();
    await expect(readRecordingPhotos(rec.file, ["nope.jpg"])).rejects.toThrow(
      /nope\.jpg/,
    );
  });
});

describe("read progress", () => {
  // Why: a recording holds one small file per action, thousands of them,
  // and reading them is the slow part on a phone. The reader says how many
  // of them it has read, of a total it knows before reading the first, so
  // the page can show a bar that only moves forward and ends full.
  it("reports each text entry it reads, of a total known up front", async () => {
    const { file } = await buildSyntheticRecording({ frames: 10 });
    const seen: [number, number][] = [];
    const read = await readSplatInputs(file, {
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(read.kind).toBe("read");
    const total = seen[0]?.[1] ?? 0;
    // session.json and at least one action file per photo.
    expect(total).toBeGreaterThan(10);
    expect(seen.map(([done]) => done)).toEqual([...Array(total + 1).keys()]);
    expect(seen.every(([, t]) => t === total)).toBe(true);
  });
});
