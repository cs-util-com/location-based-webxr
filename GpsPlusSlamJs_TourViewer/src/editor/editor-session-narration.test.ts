/**
 * Why these tests matter: a narration is two files beside the block - the
 * voice (an audio asset at `content/<id>.<ext>`) and its read-along text
 * (`timing/<blockId>.json`) - and the session is what turns the Narration
 * section's changes into them. Each change must be one undo step, the
 * save must write the voice's bytes and the timing in the same zip as the
 * `tour.json` naming them (a zip naming a file it lacks does not open),
 * and every refusal must change nothing. The timing as it stands is read
 * from the opened file before any save and from the newest save after
 * one; a timing that cannot be read is said, never treated as none.
 * Real zips, read back with the viewer's opener.
 */
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourAsset,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_TIMING_MAX_BYTES } from "gps-plus-slam-app-framework/ar/tour-timing";
import { beforeAll, describe, expect, it } from "vitest";

import { openTourFile } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { tourOf, withWorldObjects } from "../test-support/tour-of.js";
import { importTiming } from "./narration/timing-import.js";
import { createEditorSession, NOT_IN_TOUR } from "./editor-session.js";

beforeAll(() => {
  createTourViewerStore();
});

const BODY = "The mill turned all day. The miller slept at night.";
const VTT = [
  "WEBVTT",
  "",
  "00:00.000 --> 00:02.000",
  "The mill turned all day.",
  "",
  "00:02.000 --> 00:04.000",
  "The miller slept at night.",
  "",
].join("\n");

const ESSAY: TourObject = {
  id: "t1",
  kind: "longText",
  view: "reading",
  title: "The mill",
  body: BODY,
  createdAtIso: "2026-10-31T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
};

const PIN: TourObject = {
  id: "p1",
  kind: "shortText",
  view: "pin",
  caption: "A pin",
  createdAtIso: "2026-10-31T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
};

/** The timing of `VTT` for `BODY`, compact. */
async function timingText(): Promise<string> {
  const done = await importTiming(BODY, VTT, "en");
  if (done.timing === null) throw new Error("the fixture does not line up");
  return JSON.stringify(done.timing);
}

async function editorOf(
  objects: readonly TourObject[],
  files: readonly { path: string; data: string }[] = [],
  assets: TourAsset[] = [],
) {
  const manifest = tourOf(objects, { assets });
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
    ...files,
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  const editor = createEditorSession({ session, manifest, levels: new Map() });
  return { session, editor };
}

function entryText(bytes: Uint8Array, name: string): string {
  return new TextDecoder().decode(readStoredEntryBytes(bytes, name));
}

describe("a narration added in the editor", () => {
  it("writes the voice and the timing in the same save as the tour naming them", async () => {
    const { session, editor } = await editorOf([ESSAY]);
    const voice = new Blob(["RIFF-voice-bytes"], { type: "audio/wav" });
    expect(
      await editor.editNarration("t1", {
        kind: "voice",
        file: voice,
        fileName: "Mill Voice.WAV",
        durationMs: 4000,
      }),
    ).toEqual({ kind: "edited" });
    const text = await timingText();
    expect(await editor.editNarration("t1", { kind: "timing", text })).toEqual({
      kind: "edited",
    });
    // One text changed: a page counts each object once, however many of
    // its parts (here its voice and its timing) changed (`changeCount`).
    expect(editor.changeCount()).toBe(1);
    expect(await editor.narration("t1")).toEqual({
      kind: "narration",
      hasVoice: true,
      audioId: expect.any(String),
      durationMs: 4000,
      timingText: text,
      timingUnread: false,
    });

    const saved = await editor.save({ keepScan: false });
    const bytes = new Uint8Array(await saved.blob.arrayBuffer());
    const tour = withWorldObjects(
      parseTourManifest(JSON.parse(entryText(bytes, "tour.json"))),
    );
    const essay = tour.objects.find((o) => o.id === "t1");
    if (essay?.kind !== "longText" || essay.narration === undefined) {
      throw new Error("the essay lost its narration");
    }
    expect(essay.narration.timing).toBe("timing/t1.json");
    expect(essay.narration.durationMs).toBe(4000);
    const asset = tour.assets.find((a) => a.id === essay.narration?.audio);
    expect(asset?.kind).toBe("audio");
    expect(asset?.path).toMatch(/^content\/[\w-]+\.wav$/);
    expect(entryText(bytes, asset?.path ?? "")).toBe("RIFF-voice-bytes");
    expect(entryText(bytes, "timing/t1.json")).toBe(text);
    expect(editor.changeCount()).toBe(0);

    // After the save the timing is read from the newest bytes.
    expect((await editor.narration("t1")).kind).toBe("narration");
    await session.close();
  });

  it("undoes the timing and the voice one step each", async () => {
    const { session, editor } = await editorOf([ESSAY]);
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["v"]),
      fileName: "v.mp3",
    });
    await editor.editNarration("t1", {
      kind: "timing",
      text: await timingText(),
    });
    editor.undo();
    expect(await editor.narration("t1")).toMatchObject({
      hasVoice: true,
      timingText: null,
    });
    editor.undo();
    expect(await editor.narration("t1")).toMatchObject({ hasVoice: false });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("takes the timing off and keeps the voice, and the save writes no timing entry", async () => {
    const { session, editor } = await editorOf([ESSAY]);
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["v"]),
      fileName: "v.ogg",
    });
    await editor.editNarration("t1", {
      kind: "timing",
      text: await timingText(),
    });
    expect(await editor.editNarration("t1", { kind: "removeTiming" })).toEqual({
      kind: "edited",
    });
    expect(await editor.editNarration("t1", { kind: "removeTiming" })).toEqual({
      kind: "unchanged",
    });
    const saved = await editor.save({ keepScan: false });
    const bytes = new Uint8Array(await saved.blob.arrayBuffer());
    expect(readStoredEntryBytes(bytes, "timing/t1.json")).toBeUndefined();
    expect(await editor.narration("t1")).toMatchObject({
      hasVoice: true,
      timingText: null,
    });
    await session.close();
  });
});

describe("a narration the opened tour carries", () => {
  it("reads its timing from the opened file, and removing the voice takes both off as one step", async () => {
    const text = await timingText();
    const narrated: TourObject = {
      ...ESSAY,
      narration: { audio: "voice", timing: "timing/t1.json", synthetic: false },
    };
    const { session, editor } = await editorOf(
      [narrated],
      [
        { path: "content/voice.mp3", data: "voice" },
        { path: "timing/t1.json", data: text },
      ],
      [{ id: "voice", path: "content/voice.mp3", kind: "audio" }],
    );
    expect(await editor.narration("t1")).toMatchObject({
      hasVoice: true,
      audioId: "voice",
      timingText: text,
    });
    expect(await editor.editNarration("t1", { kind: "removeVoice" })).toEqual({
      kind: "edited",
    });
    expect(await editor.narration("t1")).toMatchObject({
      hasVoice: false,
      audioId: null,
      timingText: null,
    });
    editor.undo();
    expect(await editor.narration("t1")).toMatchObject({
      hasVoice: true,
      timingText: text,
    });
    await session.close();
  });
});

describe("what editNarration refuses, changing nothing", () => {
  it("refuses an unknown id, a block that is not a long text, a file that is not a sound, a timing without a voice and one over the cap", async () => {
    const { session, editor } = await editorOf([ESSAY, PIN]);
    expect(await editor.narration("ghost")).toEqual({
      kind: "refused",
      reason: NOT_IN_TOUR,
    });
    expect(await editor.narration("p1")).toMatchObject({ kind: "refused" });
    expect(
      await editor.editNarration("p1", {
        kind: "voice",
        file: new Blob(["v"]),
        fileName: "v.mp3",
      }),
    ).toMatchObject({ kind: "refused" });
    expect(
      await editor.editNarration("t1", {
        kind: "voice",
        file: new Blob(["v"]),
        fileName: "notes.txt",
      }),
    ).toMatchObject({ kind: "refused" });
    expect(
      await editor.editNarration("t1", { kind: "timing", text: "{}" }),
    ).toMatchObject({ kind: "refused" });
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["v"]),
      fileName: "v.mp3",
    });
    const before = editor.changeCount();
    expect(
      await editor.editNarration("t1", {
        kind: "timing",
        text: "x".repeat(TOUR_TIMING_MAX_BYTES + 1),
      }),
    ).toMatchObject({ kind: "refused" });
    expect(editor.changeCount()).toBe(before);
    await session.close();
  });
});

describe("the bytes the next save adds", () => {
  it("counts a timing text written since the last save", async () => {
    // Why: the archive room check and the autosave cap judge the next save
    // by `addedBytes`; a new timing is an entry that save writes too.
    const { session, editor } = await editorOf([ESSAY]);
    await editor.editNarration("t1", {
      kind: "voice",
      file: new Blob(["RIFF-voice-bytes"], { type: "audio/wav" }),
      fileName: "v.wav",
    });
    const voiceOnly = editor.addedBytes();
    expect(voiceOnly).toBe(16);
    const text = await timingText();
    await editor.editNarration("t1", { kind: "timing", text });
    expect(editor.addedBytes()).toBe(
      voiceOnly + new TextEncoder().encode(text).byteLength,
    );
    await editor.save({ keepScan: false });
    expect(editor.addedBytes()).toBe(0);
    await session.close();
  });
});
