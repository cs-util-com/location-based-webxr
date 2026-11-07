/**
 * Why these tests matter: a write's asset rule asks every long text of
 * every undo and redo step which assets its body names
 * (`historyAssetIds` -> `stepAssetIds` -> `bodyAssets`), and the editor
 * runs `manifestToWrite` on every document change. A history holds up to
 * 200 steps, so a memo keyed by body string and bounded to a few dozen
 * missed on every lookup once the history held more bodies than that,
 * and every change re-parsed every past body (about 2 ms each for a long
 * one). A step of the history never changes, so its answer is kept by
 * the block object itself: a second write parses no past body again.
 */
import type { TourLocalPose } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  createEmptyTourManifest,
  parseTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { parseTourMarkdown } from "gps-plus-slam-app-framework/ar/tour-markdown";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it, vi } from "vitest";

import {
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import { stationContent, storyOf } from "./test-support/station-content.js";

// The real parser, watched: each call is counted.
vi.mock("gps-plus-slam-app-framework/ar/tour-markdown", { spy: true });

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const POSE: TourLocalPose = { position: [3, 0, 1], rotation: [0, 0, 0, 1] };

const OPENED: TourManifest = parseTourManifest({
  ...createEmptyTourManifest(),
  minor: 0,
  stations: [
    {
      id: "gate",
      title: "The gate",
      geo: { lat: 48.52, lon: 9.05, alt: 400, headingDeg: 0 },
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow",
      ...stationContent([
        storyOf("gate-story", [
          {
            id: "intro",
            kind: "longText",
            view: "card",
            title: "The siege",
            body: "In 1632 the gate held.",
            pose: POSE,
            advance: { mode: "tap" },
          },
        ]),
      ]),
    },
  ],
});

/** The document after `edits` edits of the long text's body, each a
 *  distinct body, so the undo history holds `edits` bodies. */
function editedTimes(edits: number): TourDocumentState {
  let state = reduce(
    initialTourDocumentState,
    act.opened({ manifest: OPENED }),
  );
  for (let i = 0; i < edits; i += 1) {
    state = reduce(
      state,
      act.stationEdited({
        stationId: "gate",
        edit: {
          storyText: {
            block: "intro",
            field: "body",
            value: `Version ${String(i)} of the siege.`,
          },
        },
        what: "the text of a story block",
      }),
    );
  }
  return state;
}

describe("manifestToWrite: the history's bodies are read once", () => {
  it.each([65, 100, 200])(
    "a second write with %i past bodies parses none of them again",
    (edits) => {
      const state = editedTimes(edits);
      expect(state.past.length).toBeGreaterThanOrEqual(
        Math.min(edits, 200) - 1,
      );
      expect(manifestToWrite(state)).not.toBeNull();
      const parsed = vi.mocked(parseTourMarkdown);
      parsed.mockClear();
      expect(manifestToWrite(state)).not.toBeNull();
      // At most the current body (which may be a new object per write).
      expect(parsed.mock.calls.length).toBeLessThanOrEqual(1);
    },
  );
});
