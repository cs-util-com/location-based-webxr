import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { NEW_TOUR_FILE_NAME, newTourFile, startNewTour } from "./new-tour.js";
import { tourFileKeyOfFile, openTourFile } from "../tour-session.js";
import { editorDraftKey } from "./editor-draft.js";
import { newTourManifest } from "../starter-tour.js";

const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);

/**
 * Why these tests matter: a draft is found by the file's key. Two new
 * tours are byte-identical but for their minted id, so without the id they
 * would share one key and the second would be offered the first one's
 * edits as its own.
 */
describe("a new tour's file", () => {
  it("gives two new tours two different keys, so two different drafts", async () => {
    const first = await tourFileKeyOfFile(await newTourFile());
    const second = await tourFileKeyOfFile(await newTourFile());
    expect(first).not.toBe(second);
    expect(editorDraftKey(first)).not.toBe(editorDraftKey(second));
  });

  // Why: the control - the id, not anything random in the zip, is what
  // tells them apart; the same id is the same tour and finds its draft.
  it("keys by its minted id: one id, one key", async () => {
    const a1 = await tourFileKeyOfFile(await newTourFile({ mint: () => ID_A }));
    const a2 = await tourFileKeyOfFile(await newTourFile({ mint: () => ID_A }));
    const b = await tourFileKeyOfFile(await newTourFile({ mint: () => ID_B }));
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  // Why: the file must open as a tour - an empty one, under its name.
  it("opens as an empty tour named new-tour.zip", async () => {
    const file = await newTourFile({ mint: () => ID_A });
    expect(file.name).toBe(NEW_TOUR_FILE_NAME);
    const opened = await openTourFile(file);
    try {
      expect(opened.archive.url).toBe(await tourFileKeyOfFile(file));
    } finally {
      await opened.close();
    }
  });

  // Why: an id outside the manifest's rule would be dropped on read and
  // leave the tour keyed by content again; it is refused instead.
  it("refuses a minted id outside the manifest's id rule", () => {
    expect(() => newTourManifest(() => "not ok!")).toThrow(RangeError);
    expect(() => newTourManifest(() => "")).toThrow(RangeError);
  });

  // Why: any id the rule allows becomes the tour's key (a property, not
  // two examples).
  it("keys every valid minted id by that id", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/),
        async (id) => {
          const key = await tourFileKeyOfFile(
            await newTourFile({ mint: () => id }),
          );
          expect(key.endsWith(`tour:${id}`)).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });
});

/**
 * Why these tests matter: a browser opens the save dialog only close to a
 * click, so it must be asked before the first await - as the sample does -
 * and a pick the tour never reaches must be settled.
 */
describe("starting a new tour", () => {
  function deps(open: (file: File) => Promise<boolean>) {
    const log: string[] = [];
    return {
      log,
      deps: {
        askSaveFile: (name: string) => {
          log.push(`ask ${name}`);
          return "pick";
        },
        open: async (file: File) => {
          log.push(`open ${file.name}`);
          return open(file);
        },
        keepInChosenFile: (_file: File, pick: string) =>
          log.push(`keep ${pick}`),
        settleUnusedPick: (pick: string) => log.push(`settle ${pick}`),
        failed: (reason: string) => log.push(`failed ${reason}`),
      },
    };
  }

  it("asks where to save before anything is awaited, then opens and keeps it", async () => {
    const { log, deps: d } = deps(() => Promise.resolve(true));
    const started = startNewTour(d);
    expect(log).toEqual([`ask ${NEW_TOUR_FILE_NAME}`]);
    expect(await started).toBe(true);
    expect(log).toEqual([
      `ask ${NEW_TOUR_FILE_NAME}`,
      `open ${NEW_TOUR_FILE_NAME}`,
      "keep pick",
    ]);
  });

  it("settles the pick when the tour did not open", async () => {
    const { log, deps: d } = deps(() => Promise.resolve(false));
    expect(await startNewTour(d)).toBe(false);
    expect(log.at(-1)).toBe("settle pick");
  });

  it("settles the pick and says why when the open throws", async () => {
    const { log, deps: d } = deps(() => Promise.reject(new Error("boom")));
    expect(await startNewTour(d)).toBe(false);
    expect(log).toContain("failed boom");
    expect(log.at(-1)).toBe("settle pick");
  });

  it("settles the pick and says why when no tour can be made", async () => {
    const { log, deps: d } = deps(() => Promise.resolve(true));
    expect(await startNewTour({ ...d, mint: () => "bad id" })).toBe(false);
    expect(log.some((l) => l.startsWith("open"))).toBe(false);
    expect(log.at(-1)).toBe("settle pick");
  });
});
