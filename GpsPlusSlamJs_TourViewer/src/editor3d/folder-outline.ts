/**
 * What the 3D view draws round a selected plain folder, which has no
 * drawing of its own: a light teal box around each of its items (an item
 * moved meanwhile is followed), and, with its gizmo, a dashed outline
 * square to its heading round them all with its name on a tag at the
 * outline's front left. Nothing for another selection.
 *
 * @see folder-outline.ts.md
 */
import * as THREE from "three";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeEntries } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { FOLDER_PREFIX } from "../editor/editor-model.js";
import { folderName } from "../editor/folder-commands.js";
import { folderChains } from "../tour-content.js";
import {
  groupHull,
  type Footprint,
  type GroupHull,
  type WorldPoint,
} from "./gizmo-maths.js";

/** The outline's colour: the tree's folder teal. */
const FOLDER_OUTLINE_COLOUR = 0x57c4b8;

/** How strongly the outline shows (0..1): light, so it never hides the
 *  selection's own outline or the item. */
const OUTLINE_OPACITY = 0.6;

/** The dashed outline's margin beyond the items' footprints (m). */
export const FOLDER_HULL_PAD_M = 0.3;

/** The dashes and gaps of the outline (m). */
const DASH_M = 0.3;
const GAP_M = 0.18;

/** The name tag's height on the screen (px), whatever the distance. */
const TAG_PX = 22;

/** The tag's canvas: its height (px) and the most of a name it shows. */
const TAG_CANVAS_H = 64;
const TAG_MAX_CHARS = 32;

/** The ids of the free items the plain folder `folderId` holds at any
 *  depth, in the tour's order; none for a folder the tour lacks. */
export function folderItemIds(
  tour: Pick<TourManifest, "stations"> | null,
  folderId: string,
): string[] {
  if (tour === null || folderId === "") return [];
  return tour.stations.flatMap((station) =>
    tourFreeEntries(station)
      .filter((entry) => entry.folder.includes(folderId))
      .map((entry) => entry.block.id),
  );
}

/** The name the tree shows for the plain folder `folderId`, or null for
 *  a folder the tour lacks. */
function folderTitleOf(
  tour: Pick<TourManifest, "stations"> | null,
  folderId: string,
): string | null {
  for (const station of tour?.stations ?? []) {
    const folder = folderChains(station).get(folderId)?.at(-1);
    if (folder !== undefined) return folderName(folder);
  }
  return null;
}

/** Where the folder's gizmo stands this frame: its pivot, its heading and
 *  the metres a screen pixel covers one metre from the camera. */
interface FolderGizmoAt {
  readonly centre: WorldPoint;
  readonly headingDeg: number;
  readonly spritePerPx: number;
}

/** What the outline draws now (the page's checks). */
export interface FolderOutlineShown {
  /** How many item boxes show. */
  readonly boxes: number;
  /** The dashed outline, or null. */
  readonly hull: GroupHull | null;
  /** The name on the tag, or null. */
  readonly tag: string | null;
}

export interface FolderOutline {
  /** Each frame: the boxes around the items of the folder `selected`
   *  names (`folder:<id>`), none for another selection; with `gizmo`
   *  (the folder's own, drawn this frame) the dashed outline and the name
   *  tag too. */
  update(
    tour: TourManifest | null,
    selected: string | null,
    gizmo?: FolderGizmoAt | null,
  ): void;
  /** How many boxes show (the page's checks). */
  count(): number;
  /** The dashed outline drawn now, or null (the page's checks). */
  hull(): GroupHull | null;
  /** The name on the tag shown now, or null (the page's checks). */
  tag(): string | null;
  dispose(): void;
}

/** `text` drawn on a teal-edged dark pill in `canvas` (sized to it). */
function drawTag(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const font = "600 34px system-ui, sans-serif";
  ctx.font = font;
  const shown =
    text.length > TAG_MAX_CHARS
      ? `${text.slice(0, TAG_MAX_CHARS - 1)}...`
      : text;
  const pad = 14;
  const mark = 22;
  canvas.width = Math.ceil(ctx.measureText(shown).width + 3 * pad + mark);
  canvas.height = TAG_CANVAS_H;
  // A resize clears the canvas and its settings.
  ctx.font = font;
  ctx.fillStyle = "rgba(20, 30, 32, 0.9)";
  ctx.strokeStyle = "#57c4b8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#57c4b8";
  ctx.fillRect(pad, (canvas.height - mark) / 2, mark, mark);
  ctx.fillStyle = "#e6f4f2";
  ctx.textBaseline = "middle";
  ctx.fillText(shown, 2 * pad + mark, canvas.height / 2 + 1);
}

export function createFolderOutline(deps: {
  readonly scene: THREE.Object3D;
  /** An item's drawn objects (its label, its plane, its model). */
  readonly itemObjects: (id: string) => readonly THREE.Object3D[];
}): FolderOutline {
  const material = new THREE.LineBasicMaterial({
    color: FOLDER_OUTLINE_COLOUR,
    transparent: true,
    opacity: OUTLINE_OPACITY,
    depthTest: false,
  });
  const helpers: THREE.Box3Helper[] = [];
  const part = new THREE.Box3();

  // The dashed outline: four corners, closed by the loop.
  const ringMaterial = new THREE.LineDashedMaterial({
    color: FOLDER_OUTLINE_COLOUR,
    dashSize: DASH_M,
    gapSize: GAP_M,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(12), 3),
    ),
    ringMaterial,
  );
  ring.renderOrder = 10;
  ring.frustumCulled = false;
  ring.visible = false;
  deps.scene.add(ring);

  // The name tag: a pill of the same size on the screen at any distance.
  // Its picture is made at its first showing (a page without a document,
  // a test's, draws none).
  let tagCanvas: HTMLCanvasElement | null = null;
  let tagTexture: THREE.CanvasTexture | null = null;
  const tagMaterial = new THREE.SpriteMaterial({
    depthTest: false,
    depthWrite: false,
    transparent: true,
    sizeAttenuation: false,
  });
  const tagSprite = new THREE.Sprite(tagMaterial);
  // Its left end on the outline's corner, centred on the line.
  tagSprite.center.set(0, 0.5);
  tagSprite.renderOrder = 11;
  tagSprite.visible = false;
  // Only a picture: a press on it reaches what stands behind.
  tagSprite.raycast = () => undefined;
  deps.scene.add(tagSprite);
  let tagText: string | null = null;
  let tagDrawn: string | null = null;
  let hullNow: GroupHull | null = null;

  /** `n` helpers in the scene, the rest hidden. */
  const ensure = (n: number) => {
    while (helpers.length < n) {
      const helper = new THREE.Box3Helper(new THREE.Box3());
      const own = helper.material;
      if (!Array.isArray(own)) own.dispose();
      helper.material = material;
      helper.renderOrder = 10;
      deps.scene.add(helper);
      helpers.push(helper);
    }
  };

  /** The outline and the tag named `title` round `footprints` at
   *  `gizmo`; hidden without either. */
  const drawHull = (
    title: string | null,
    gizmo: FolderGizmoAt | null,
    footprints: readonly Footprint[],
  ) => {
    const hull =
      gizmo === null || title === null
        ? null
        : groupHull(
            gizmo.centre,
            gizmo.headingDeg,
            footprints,
            FOLDER_HULL_PAD_M,
          );
    hullNow = hull;
    tagText = hull === null ? null : title;
    ring.visible = hull !== null;
    tagSprite.visible = hull !== null;
    if (hull === null || gizmo === null || title === null) return;
    const y = gizmo.centre.y;
    const position = ring.geometry.getAttribute("position");
    hull.corners.forEach((c, i) => {
      position.setXYZ(i, c.x, y, c.z);
    });
    position.needsUpdate = true;
    ring.geometry.computeBoundingSphere();
    ring.computeLineDistances();
    if (tagDrawn !== title && typeof document !== "undefined") {
      tagCanvas ??= document.createElement("canvas");
      drawTag(tagCanvas, title);
      tagTexture?.dispose();
      // A new texture: the canvas may have changed its size.
      tagTexture = new THREE.CanvasTexture(tagCanvas);
      tagTexture.colorSpace = THREE.SRGBColorSpace;
      tagMaterial.map = tagTexture;
      tagMaterial.needsUpdate = true;
      tagDrawn = title;
    }
    const h = TAG_PX * gizmo.spritePerPx;
    const aspect =
      tagCanvas === null ? 1 : tagCanvas.width / Math.max(1, tagCanvas.height);
    tagSprite.scale.set(h * aspect, h, 1);
    tagSprite.position.set(hull.tag.x, y, hull.tag.z);
  };

  let shown = 0;
  return {
    update(tour, selected, gizmo = null) {
      const folderId =
        selected?.startsWith(FOLDER_PREFIX) === true
          ? selected.slice(FOLDER_PREFIX.length)
          : null;
      const ids = folderId === null ? [] : folderItemIds(tour, folderId);
      ensure(ids.length);
      shown = 0;
      const footprints: Footprint[] = [];
      for (const id of ids) {
        // Straight into the next helper's own box: no box per item a frame.
        const helper = helpers[shown];
        if (helper === undefined) continue;
        helper.box.makeEmpty();
        for (const o of deps.itemObjects(id)) {
          o.updateWorldMatrix(true, true);
          part.setFromObject(o);
          if (!part.isEmpty()) helper.box.union(part);
        }
        if (helper.box.isEmpty()) continue;
        helper.visible = true;
        shown += 1;
        const { min, max } = helper.box;
        footprints.push({ minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z });
      }
      for (let i = shown; i < helpers.length; i += 1) {
        const helper = helpers[i];
        if (helper !== undefined) helper.visible = false;
      }
      drawHull(
        folderId === null ? null : folderTitleOf(tour, folderId),
        gizmo,
        footprints,
      );
    },
    count: () => shown,
    hull: () => hullNow,
    tag: () => tagText,
    dispose() {
      for (const helper of helpers) {
        helper.removeFromParent();
        helper.geometry.dispose();
      }
      helpers.length = 0;
      material.dispose();
      ring.removeFromParent();
      ring.geometry.dispose();
      ringMaterial.dispose();
      tagSprite.removeFromParent();
      tagMaterial.dispose();
      tagTexture?.dispose();
      tagTexture = null;
      tagDrawn = null;
      shown = 0;
      hullNow = null;
      tagText = null;
    },
  };
}
