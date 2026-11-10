// @vitest-environment jsdom
/**
 * Why these tests matter: a placement row's `turns` says whether turning
 * a thing shows. The gizmo reads it, but the inspector draws its own
 * Heading field and writes its own turn, so a row that says "faces the
 * visitor" could still be turned there: a rotation nobody sees, written
 * into the tour, the very knob the row exists to remove. These tests hold
 * every posed (kind, view) of the format to its row in the inspector's
 * two consumers: the field it shows and the edit it writes.
 */
import { describe, expect, it } from "vitest";

import {
  TOUR_KINDS,
  type TourBlockKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type {
  TourBlock,
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { inspectorEdit } from "../editor/editor-shell/inspector-edits.js";
import { buildInspector } from "../editor/editor-shell/inspector-model.js";
import { drawInspector } from "../editor/editor-shell/shell-inspector.js";
import { blockPlacement } from "./placement-rows.js";

// The geodesy is licence-gated; the store's construction activates it.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ASSETS: TourManifest["assets"] = [
  { id: "pic", path: "content/pic.jpg", kind: "image" },
  { id: "snd", path: "content/snd.mp3", kind: "audio" },
  { id: "glb", path: "content/glb.glb", kind: "model" },
  { id: "knight", path: "content/knight.png", kind: "image" },
];

/** A block's own fields per kind. */
const FIELDS: Readonly<Record<TourBlockKind, object>> = {
  shortText: { caption: "Gate" },
  longText: { title: "The siege", body: "In 1632 the town was besieged." },
  picture: { image: "pic", widthM: 1 },
  video: { video: "vid" },
  audio: { audio: "snd" },
  model: { asset: "glb", sizeM: 1 },
  character: { name: "Herald", image: "knight", caption: "Hear ye!" },
};

/** Every posed (kind, view) of the format with its row's `turns`. */
const POSED = (Object.keys(TOUR_KINDS) as TourBlockKind[]).flatMap((kind) =>
  TOUR_KINDS[kind].views.flatMap((view) => {
    const row = blockPlacement(kind, view);
    return row?.posed === true
      ? [[`${kind}.${view}`, kind, view, row.turns] as const]
      : [];
  }),
);

/** `kind` in `view`, free in a station, turned 30 degrees. */
function stationWith(kind: TourBlockKind, view: string): TourStation {
  const half = (30 * Math.PI) / 360;
  const block = {
    id: "it",
    kind,
    view,
    createdAtIso: "2026-11-10T08:00:00Z",
    pose: {
      position: [0, 0, 2],
      rotation: [0, Math.sin(half), 0, Math.cos(half)],
    },
    ...FIELDS[kind],
  } as unknown as TourBlock;
  return {
    id: "a",
    title: "Station a",
    geo: { lat: 48.137393, lon: 11.575493, alt: 560, rotation: [0, 0, 0, 1] },
    activateRadiusM: 30,
    foundRadiusM: 8,
    hint: "arrow",
    children: [block],
  } as unknown as TourStation;
}

describe("the inspector against the placement rows", () => {
  it.each(POSED)(
    "%s shows and writes a heading exactly when its row says it turns",
    (_name, kind, view, turns) => {
      const stations = [stationWith(kind, view)];
      const model = buildInspector({
        selected: "it",
        stations,
        assets: ASSETS,
        codes: [],
      });
      expect(model?.kind).toBe("item");
      document.body.innerHTML =
        '<aside id="i"><div id="h"></div><div id="b"></div></aside>';
      const dock = {
        root: document.getElementById("i") as HTMLElement,
        head: document.getElementById("h") as HTMLElement,
        body: document.getElementById("b") as HTMLElement,
      };
      drawInspector(
        dock,
        model,
        { folded: false, positionOpen: true, busy: null },
        {
          show: () => undefined,
          sweep: () => undefined,
          clear: () => undefined,
        },
      );
      // The shown consumer: a Heading field to type.
      const field = dock.root.querySelector('[data-field="heading"]');
      expect(field !== null, "a Heading field shown").toBe(turns);
      // The written consumer: a typed heading becomes a turn.
      const edit = inspectorEdit({
        selected: "it",
        stations,
        origin: null,
        field: "heading",
        value: "75",
      });
      expect(edit.kind === "turn", `the edit ${edit.kind}`).toBe(turns);
    },
  );
});
