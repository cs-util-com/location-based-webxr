/**
 * The light teal outline around each item of a selected plain folder in
 * the 3D view: a folder has no drawing of its own, so the boxes are how
 * the creator sees which items it groups. One box per drawn item, around
 * its drawing as it stands this frame (an item moved meanwhile is
 * followed); nothing for another selection.
 *
 * @see folder-outline.ts.md
 */
import * as THREE from "three";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeEntries } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { FOLDER_PREFIX } from "../editor/editor-model.js";

/** The outline's colour: the tree's folder teal. */
const FOLDER_OUTLINE_COLOUR = 0x57c4b8;

/** How strongly the outline shows (0..1): light, so it never hides the
 *  selection's own outline or the item. */
const OUTLINE_OPACITY = 0.6;

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

export interface FolderOutline {
  /** Each frame: the boxes around the items of the folder `selected`
   *  names (`folder:<id>`), none for another selection. */
  update(tour: TourManifest | null, selected: string | null): void;
  /** How many boxes show (the page's checks). */
  count(): number;
  dispose(): void;
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

  let shown = 0;
  return {
    update(tour, selected) {
      const ids =
        selected?.startsWith(FOLDER_PREFIX) === true
          ? folderItemIds(tour, selected.slice(FOLDER_PREFIX.length))
          : [];
      ensure(ids.length);
      shown = 0;
      for (const id of ids) {
        const box = new THREE.Box3();
        for (const o of deps.itemObjects(id)) {
          o.updateWorldMatrix(true, true);
          part.setFromObject(o);
          if (!part.isEmpty()) box.union(part);
        }
        if (box.isEmpty()) continue;
        const helper = helpers[shown];
        if (helper === undefined) continue;
        helper.box.copy(box);
        helper.visible = true;
        shown += 1;
      }
      for (let i = shown; i < helpers.length; i += 1) {
        const helper = helpers[i];
        if (helper !== undefined) helper.visible = false;
      }
    },
    count: () => shown,
    dispose() {
      for (const helper of helpers) {
        helper.removeFromParent();
        helper.geometry.dispose();
      }
      helpers.length = 0;
      material.dispose();
      shown = 0;
    },
  };
}
