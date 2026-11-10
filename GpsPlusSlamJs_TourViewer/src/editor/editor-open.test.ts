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
  TOUR_MANIFEST_MINOR,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  droppedBlockFieldsLine,
  droppedChildrenLine,
  droppedDetailsLine,
  droppedFolderScalesLine,
  droppedStationFieldsLine,
  NOT_A_TOUR,
  NOT_A_ZIP,
  openedNoticeLines,
  openTourForEditing,
  showOpenedNotices,
} from "./editor-open.js";
import { createEditorSession } from "./editor-session.js";
import { stationContent, storyOf } from "../test-support/station-content.js";
import { tourOf } from "../test-support/tour-of.js";

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
          version: 5,
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
    expect(out.dropped.map((d) => ("field" in d ? d.field : d.kind))).toEqual([
      "cover",
      "contact",
    ]);
    expect(droppedDetailsLine(out.dropped)).toBe(
      "This tour's cover and contact could not be read, so the editor left them out: the next save writes the tour without them. Set them again in the tour's details.",
    );
    expect(droppedDetailsLine([])).toBeNull();
    expect(droppedDetailsLine(out.dropped.slice(1))).toBe(
      "This tour's contact could not be read, so the editor left it out: the next save writes the tour without it. Set it again in the tour's details.",
    );
    await out.session.close();
  });

  it("counts only the tour's details as details, never a block's or a character's dropped field", () => {
    // Why: the reader's drops share one list. A block's note or a
    // character's frames sheet left out is no tour detail; counted as one,
    // the line read "This tour's undefined could not be read".
    expect(
      droppedDetailsLine([
        { kind: "field", block: "b1", field: "note", reason: "too long" },
        { kind: "block", block: "b2", reason: "unknown kind" },
        {
          kind: "character",
          character: "wendel",
          field: "characters[0].frames",
          reason: "no image",
        },
        { kind: "character", character: "ada", reason: "no image" },
      ]),
    ).toBeNull();
    expect(
      droppedDetailsLine([
        { kind: "field", block: "b1", field: "note", reason: "too long" },
        { field: "cover", reason: "gone" },
      ]),
    ).toBe(
      "This tour's cover could not be read, so the editor left it out: the next save writes the tour without it. Set it again in the tour's details.",
    );
  });

  it("names the stations whose description or card image the reader dropped, by their names, apart from the details (G2 build plan M1a)", async () => {
    // Why: a station's card image (format minor 2) whose photo or image
    // is gone, or a description or image a hand edit broke, is dropped by
    // the reader instead of failing the tour (Q14). It must be said like a
    // dropped detail - never lost silently by the next save - but it is no
    // tour detail, so it is neither counted as one nor told to be set again
    // in the tour's details. A station is named as the rail names it (its
    // title, else "Station N"), never by the random id a creator never
    // sees.
    const at = { lat: 48.1, lon: 11.5, alt: 520, rotation: [0, 0, 0, 1] };
    const bare = (id: string, extra: Record<string, unknown>) => ({
      id,
      geo: at,
      activateRadiusM: 50,
      foundRadiusM: 25,
      ...stationContent([]),
      ...extra,
    });
    const file = await zipFile([
      {
        path: "tour.json",
        data: JSON.stringify({
          version: 5,
          minor: 0,
          stations: [
            bare("k3f9", { title: "The old well", image: "gone" }),
            bare("q7x2", { image: "lost" }),
            bare("z1m8", { description: 42 }),
          ],
          cover: "gone",
        }),
      },
    ]);
    const out = await openTourForEditing(file);
    expect(out.kind).toBe("opened");
    if (out.kind !== "opened") return;
    expect(out.dropped.map((d) => ("field" in d ? d.field : d.kind))).toEqual([
      "image",
      "image",
      "description",
      "cover",
    ]);
    expect(droppedDetailsLine(out.dropped)).toBe(
      "This tour's cover could not be read, so the editor left it out: the next save writes the tour without it. Set it again in the tour's details.",
    );
    expect(droppedStationFieldsLine(out.dropped, out.manifest)).toBe(
      'The card images of "The old well" and "Station 2" name pictures this tour no longer has. The description of "Station 3" could not be read. The editor left them out: the next save writes those stations without them.',
    );
    expect(droppedStationFieldsLine(out.dropped.slice(1), out.manifest)).toBe(
      'The card image of "Station 2" names a picture this tour no longer has. The description of "Station 3" could not be read. The editor left them out: the next save writes those stations without them.',
    );
    expect(droppedStationFieldsLine(out.dropped.slice(2), out.manifest)).toBe(
      'The description of "Station 3" could not be read. The editor left it out: the next save writes the station without it.',
    );
    // A malformed card image (no cause) is unreadable, not gone.
    expect(
      droppedStationFieldsLine(
        [{ field: "image", station: "z1m8", reason: "not an id" }],
        out.manifest,
      ),
    ).toBe(
      'The card image of "Station 3" could not be read. The editor left it out: the next save writes the station without it.',
    );
    expect(droppedStationFieldsLine(out.dropped.slice(3), out.manifest)).toBe(
      null,
    );
    await out.session.close();
  });

  it("names the blocks whose text the reader dropped, by their names, and says the next save writes them without it", async () => {
    // Why: a text over its cap (a transcript, a caption, a description)
    // is left out by the reader rather than failing the tour, so the next
    // save writes the block without it. Unsaid, that is a silent loss of
    // what the creator wrote. The line names each block as the editor's
    // panels do (its title, else its caption), never by the random id.
    const pin = (id: string, caption: string) =>
      ({
        id,
        kind: "shortText",
        view: "pin",
        caption,
        createdAtIso: "2026-11-07T00:00:00.000Z",
        geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
      }) as const;
    const wire = JSON.parse(
      serializeTourManifest(
        tourOf([pin("b1", "The gate"), pin("b2", "The well")]),
      ),
    ) as { stations: { children: Record<string, unknown>[] }[] };
    for (const station of wire.stations) {
      for (const child of station.children) {
        child.description = "x".repeat(161);
      }
    }
    const out = await openTourForEditing(
      await zipFile([{ path: "tour.json", data: JSON.stringify(wire) }]),
    );
    expect(out.kind).toBe("opened");
    if (out.kind !== "opened") return;
    expect(out.dropped).toHaveLength(2);
    expect(droppedBlockFieldsLine(out.dropped, out.manifest)).toBe(
      'A text of "The gate" and "The well" could not be read, so the editor left it out: the next save writes those items without it. Write it again in the item.',
    );
    expect(droppedBlockFieldsLine(out.dropped.slice(1), out.manifest)).toBe(
      'A text of "The well" could not be read, so the editor left it out: the next save writes the item without it. Write it again in the item.',
    );
    // A block nobody kept is named by its id; details, stations and whole
    // blocks are other lines.
    expect(
      droppedBlockFieldsLine(
        [
          { kind: "field", block: "zz9", field: "title", reason: "too long" },
          { kind: "block", block: "b3", reason: "unknown kind" },
          { field: "cover", reason: "gone" },
        ],
        out.manifest,
      ),
    ).toBe(
      'A text of "zz9" could not be read, so the editor left it out: the next save writes the item without it. Write it again in the item.',
    );
    expect(droppedBlockFieldsLine([], out.manifest)).toBeNull();
    await out.session.close();
  });

  it("says nothing about the plain folders a tour opened with: the editor keeps them", async () => {
    // Why: the editor keeps plain folders and the next save writes them
    // back, so no notice about losing them may appear; one would tell the
    // creator of a loss that no longer happens. A story is a folder too
    // in the file, and sets nothing off either.
    const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
    const pin = {
      id: "p1",
      kind: "shortText",
      view: "pin",
      caption: "Gate",
      pose: POSE,
    } as const;
    const card = {
      id: "c1",
      kind: "shortText",
      view: "card",
      caption: "Hi",
      pose: POSE,
    } as const;
    const tourJson = (children: unknown[]) =>
      JSON.stringify({
        version: 5,
        minor: 0,
        order: "fixed",
        assets: [],
        stations: [
          {
            id: "well",
            title: "The well",
            geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
            activateRadiusM: 50,
            foundRadiusM: 25,
            hint: "arrow",
            children,
          },
        ],
      });
    const grouped = await openTourForEditing(
      await zipFile([
        {
          path: "tour.json",
          data: tourJson([
            storyOf("s", [card]),
            {
              id: "f",
              kind: "folder",
              pose: { position: [5, 0, 0], rotation: [0, 0, 0, 1] },
              children: [pin],
            },
          ]),
        },
      ]),
    );
    expect(grouped.kind).toBe("opened");
    if (grouped.kind !== "opened") return;
    expect(openedNoticeLines(grouped.dropped, grouped.manifest)).toEqual([]);
    await grouped.session.close();
    const plain = await openTourForEditing(
      await zipFile([
        { path: "tour.json", data: tourJson([storyOf("s", [card]), pin]) },
      ]),
    );
    expect(plain.kind).toBe("opened");
    if (plain.kind !== "opened") return;
    expect(openedNoticeLines(plain.dropped, plain.manifest)).toEqual([]);
    await plain.session.close();
  });

  it("says which folders' sizes and how many items a newer editor's tour lost, and that the next save writes it without them", async () => {
    // Why: a tour from a newer editor may carry a folder's size this
    // editor cannot show and items it cannot read. The reader leaves both
    // out rather than refusing the tour, so the next save writes the tour
    // without them; unsaid, that is a silent loss. The folders are named
    // as the tree names them (their names, never the random id).
    const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
    const pin = (id: string) => ({
      id,
      kind: "shortText",
      view: "pin",
      caption: `Pin ${id}`,
      pose: POSE,
    });
    const data = JSON.stringify({
      version: 5,
      // A newer minor than this reader's: read leniently.
      minor: TOUR_MANIFEST_MINOR + 1,
      order: "fixed",
      assets: [],
      stations: [
        {
          id: "well",
          title: "The well",
          geo: { lat: 48.52, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
          activateRadiusM: 50,
          foundRadiusM: 25,
          hint: "arrow",
          children: [
            {
              id: "f1",
              kind: "folder",
              title: "Benches",
              pose: POSE,
              scale: 2,
              children: [
                pin("a"),
                {
                  id: "f2",
                  kind: "folder",
                  pose: POSE,
                  scale: 0.5,
                  children: [pin("b")],
                },
              ],
            },
            { id: "h1", kind: "hologram", pose: POSE },
            pin("c"),
          ],
        },
      ],
    });
    const out = await openTourForEditing(
      await zipFile([{ path: "tour.json", data }]),
    );
    expect(out.kind).toBe("opened");
    if (out.kind !== "opened") return;
    expect(openedNoticeLines(out.dropped, out.manifest)).toEqual([
      'The folders "Benches" and a folder without a name have a size this editor cannot show yet, so it shows their items at their own size: the next save writes the folders without it.',
      "An item of this tour could not be read (a newer editor made it), so the editor left it out: the next save writes the tour without it.",
    ]);
    await out.session.close();
    // One folder, two items, and nothing to say.
    const scale = (folder: string) =>
      ({ kind: "folderScale", folder, reason: "r" }) as const;
    expect(
      droppedFolderScalesLine([scale("f1"), scale("f1")], out.manifest),
    ).toBe(
      'The folder "Benches" has a size this editor cannot show yet, so it shows the folder\'s items at their own size: the next save writes the folder without it.',
    );
    expect(
      droppedChildrenLine([
        { kind: "child", child: "x", reason: "r" },
        { kind: "block", block: "y", reason: "r" },
        { kind: "child", child: "x", reason: "r" },
      ]),
    ).toBe(
      "2 items of this tour could not be read (a newer editor made them), so the editor left them out: the next save writes the tour without them.",
    );
    expect(droppedFolderScalesLine([], out.manifest)).toBeNull();
    expect(
      droppedChildrenLine([
        { kind: "field", block: "b", field: "title", reason: "r" },
      ]),
    ).toBeNull();
  });

  it("shows every opened notice, then a superseded draft's line, as toasts that stay until closed", () => {
    // Why: these lines are instructions (set it again, write it again), so
    // a toast that went after a few seconds would take them away before
    // they were read; and the page closes them with the file, so each
    // toast must come back to it.
    const shown: [string, undefined, null][] = [];
    const toasts = showOpenedNotices(["one", "two"], "draft", (...args) => {
      shown.push(args);
      return `toast:${args[0]}`;
    });
    expect(shown).toEqual([
      ["one", undefined, null],
      ["two", undefined, null],
      ["draft", undefined, null],
    ]);
    expect(toasts).toEqual(["toast:one", "toast:two", "toast:draft"]);
    expect(showOpenedNotices([], null, () => 1)).toEqual([]);
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

  // Why: a tour of an older format is refused, never converted, in the
  // words the phone uses; the page needs the file's key to delete the
  // draft this browser kept for it.
  it("refuses a tour of an older format in its own words, with the file's key", async () => {
    const file = await zipFile([
      {
        path: "tour.json",
        data: JSON.stringify({ version: 3, minor: 0, stations: [] }),
      },
    ]);
    const out = await openTourForEditing(file);
    expect(out).toMatchObject({
      kind: "refused",
      reason:
        "This tour is in an older format (version 3) that this version of the app no longer opens; it has to be made again.",
    });
    if (out.kind !== "refused") return;
    expect(out.olderFormat?.fileKey).toMatch(/^local-file:/);
    expect(out.olderFormat?.error.version).toBe(3);
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
    expect("captureSpots" in saved.written).toBe(false);
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
