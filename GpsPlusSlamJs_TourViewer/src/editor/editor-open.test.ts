/**
 * Why these tests matter: the editor opens files anyone can make. A tour
 * must open with its manifest and codes; a Recorder or scan zip, a broken
 * tour.json and a file that is not a zip must each be refused with a
 * sentence the creator can act on, never shown as an empty map (M6 E1
 * plan review #8). Real zips, the viewer's real opener.
 */
import { describe, expect, it } from "vitest";
import {
  packFilesAsZip,
  rebuildZipWithEntries,
} from "gps-plus-slam-app-framework/storage";
import { sampleRecordingBytes } from "../test-support/sample-recording.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  droppedDetailsLine,
  NOT_A_TOUR,
  NOT_A_ZIP,
  openTourForEditing,
} from "./editor-open.js";
import { createEditorSession } from "./editor-session.js";

async function zipFile(
  entries: { path: string; data: string }[],
  name = "tour.zip",
): Promise<File> {
  return new File([await packFilesAsZip(entries)], name, {
    type: "application/zip",
  });
}

describe("openTourForEditing", () => {
  it("opens a tour with its manifest and codes", async () => {
    const file = await zipFile([
      {
        path: "tour.json",
        data: serializeTourManifest({
          ...createEmptyTourManifest(),
          title: "Altstadt walk",
        }),
      },
    ]);
    const out = await openTourForEditing(file);
    expect(out.kind).toBe("opened");
    if (out.kind !== "opened") return;
    expect(out.manifest.title).toBe("Altstadt walk");
    expect(out.fileName).toBe("tour.zip");
    await out.session.close();
  });

  it("names the details the reader dropped, so a save never loses them silently", async () => {
    // Why (M4a review #6): a description or contact the format's reader
    // drops (a hand-edited file) was simply gone from the next save, with
    // nothing said. The open now reports which ones, in the page's words.
    const file = await zipFile([
      {
        path: "tour.json",
        data: JSON.stringify({
          version: 3,
          minor: 0,
          stations: [],
          description: "Fine.",
          contact: "call me",
          cover: "gone",
        }),
      },
    ]);
    const out = await openTourForEditing(file);
    expect(out.kind).toBe("opened");
    if (out.kind !== "opened") return;
    expect(out.manifest.description).toBe("Fine.");
    expect(out.dropped.map((d) => d.field)).toEqual(["cover", "contact"]);
    expect(droppedDetailsLine(out.dropped)).toBe(
      "This tour's cover and contact could not be read, so the editor left them out: the next save writes the tour without them. Set them again in the tour's details.",
    );
    expect(droppedDetailsLine([])).toBeNull();
    expect(droppedDetailsLine(out.dropped.slice(1))).toBe(
      "This tour's contact could not be read, so the editor left it out: the next save writes the tour without it. Set it again in the tour's details.",
    );
    await out.session.close();
  });

  it("refuses a zip that carries no tour.json and no code", async () => {
    const file = await zipFile([{ path: "session.json", data: "{}" }]);
    await expect(openTourForEditing(file)).resolves.toEqual({
      kind: "refused",
      reason: NOT_A_TOUR,
    });
  });

  it("refuses a broken tour.json and says it cannot be read", async () => {
    const file = await zipFile([{ path: "tour.json", data: "{ not json" }]);
    const out = await openTourForEditing(file);
    expect(out).toMatchObject({ kind: "refused" });
    if (out.kind !== "refused") return;
    expect(out.reason).toMatch(/^This tour cannot be read: /);
  });

  it("refuses a file that is not a zip before reading it", async () => {
    const open = () => Promise.reject(new Error("must not be called"));
    await expect(
      openTourForEditing(new File(["hello"], "notes.txt"), {
        open,
      }),
    ).resolves.toEqual({ kind: "refused", reason: NOT_A_ZIP });
  });

  it("words an opener's refusal as the viewer does", async () => {
    const out = await openTourForEditing(
      new File(["not a zip at all"], "broken.zip", { type: "application/zip" }),
    );
    expect(out.kind).toBe("refused");
  });
});

describe("openTourForEditing starts no station for the walk's debug camera captures", () => {
  // Why this test matters: the walk's camera captures are debug data, not
  // part of the tour. The open put them into stations once (a bake that
  // started an automatic walk-N station for every frame no station held),
  // so a save published them as the tour's content. A tour carrying a
  // recording now opens as its file has it - the same on the desktop as on
  // the phone - and the document the editor session opens holds no
  // captures and no station for them.
  it("opens a tour carrying a recording with no station and no captures", async () => {
    const zip = await rebuildZipWithEntries(
      new Blob([sampleRecordingBytes()]),
      [
        {
          path: "tour.json",
          data: serializeTourManifest(createEmptyTourManifest()),
        },
      ],
    );
    const out = await openTourForEditing(
      new File([zip], "walked.zip", { type: "application/zip" }),
    );
    if (out.kind !== "opened") throw new Error(out.reason);
    expect(out.manifest).toEqual(createEmptyTourManifest());
    const editor = createEditorSession({
      session: out.session,
      manifest: out.manifest,
      levels: out.levels,
    });
    expect(editor.model().items.filter((i) => i.kind === "station")).toEqual(
      [],
    );
    const saved = await editor.save({ keepScan: true });
    expect(saved.written.stations).toEqual([]);
    expect(saved.written.captureSpots).toBeUndefined();
    await out.session.close();
  });

  it("opens a tour without a recording as it is", async () => {
    const file = await zipFile([
      {
        path: "tour.json",
        data: serializeTourManifest(createEmptyTourManifest()),
      },
    ]);
    const out = await openTourForEditing(file);
    if (out.kind !== "opened") throw new Error(out.reason);
    expect(out.manifest).toEqual(createEmptyTourManifest());
    await out.session.close();
  });
});
