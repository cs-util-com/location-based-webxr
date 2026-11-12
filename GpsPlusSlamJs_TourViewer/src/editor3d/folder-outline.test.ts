/**
 * Why these tests matter: a plain folder has no drawing of its own, so the
 * teal boxes are the only sign in the 3D view of which items it groups. A
 * box must stand around each of its items - and only its items, at any
 * folder depth - follow an item that moved, and go when the selection
 * leaves the folder.
 */
import * as THREE from "three";
import {
  parseTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { stationContent } from "../test-support/station-content.js";
import { tourOf } from "../test-support/tour-of.js";
import {
  FOLDER_HULL_PAD_M,
  createFolderOutline,
  folderItemIds,
} from "./folder-outline.js";

function pin(id: string) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    createdAtIso: "2026-11-09T00:00:00.000Z",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  } as const;
}
const at = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

/** Station "s": pin x free; folder "f" holding pin a and folder "g"
 *  holding pin b. */
function tour() {
  const wire = tourOf([], {
    stations: [
      {
        id: "s",
        title: "S",
        geo: { lat: 48, lon: 9, alt: 400, rotation: [0, 0, 0, 1] },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        ...stationContent([
          pin("x"),
          {
            id: "f",
            kind: "folder",
            pose: at,
            children: [
              pin("a"),
              { id: "g", kind: "folder", pose: at, children: [pin("b")] },
            ],
          },
        ]),
      },
    ],
  });
  return parseTourManifest(JSON.parse(serializeTourManifest(wire)));
}

describe("folderItemIds", () => {
  it("lists a folder's items at any depth, nothing for another id", () => {
    expect(folderItemIds(tour(), "f")).toEqual(["a", "b"]);
    expect(folderItemIds(tour(), "g")).toEqual(["b"]);
    expect(folderItemIds(tour(), "x")).toEqual([]);
    expect(folderItemIds(null, "f")).toEqual([]);
  });
});

describe("createFolderOutline", () => {
  it("boxes each drawn item of the selected folder and follows a move", () => {
    const scene = new THREE.Scene();
    const meshes = new Map(
      ["a", "b", "x"].map((id) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        scene.add(mesh);
        return [id, mesh] as const;
      }),
    );
    const outline = createFolderOutline({
      scene,
      itemObjects: (id) => {
        const mesh = meshes.get(id);
        return mesh === undefined ? [] : [mesh];
      },
    });
    const boxes = () =>
      scene.children.filter(
        (o): o is THREE.Box3Helper =>
          o instanceof THREE.Box3Helper && o.visible,
      );
    outline.update(tour(), "folder:f");
    expect(outline.count()).toBe(2);
    expect(boxes()).toHaveLength(2);
    meshes.get("b")?.position.set(10, 0, 0);
    outline.update(tour(), "folder:f");
    const centres = boxes().map((h) => h.box.getCenter(new THREE.Vector3()).x);
    // The moved item's box follows it to x = 10; the other stays.
    expect(centres.sort((p, q) => p - q)).toEqual([0, 10]);
    outline.update(tour(), "x");
    expect(outline.count()).toBe(0);
    expect(boxes()).toHaveLength(0);
    outline.update(tour(), "folder:nope");
    expect(outline.count()).toBe(0);
    outline.dispose();
    expect(scene.children.some((o) => o instanceof THREE.Box3Helper)).toBe(
      false,
    );
  });
  // Why: the dashed outline and the name tag are how the creator sees,
  // with the folder's gizmo, which items move together and what the group
  // is called; they ring the folder's items square to its heading, and go
  // with the selection (or with a gizmo the folder lacks).
  it("draws a dashed outline round the folder's items with its name at the front left, none for another selection", () => {
    const scene = new THREE.Scene();
    const meshes = new Map(
      [
        ["a", 2],
        ["b", -3],
      ].map(([id, x]) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        mesh.position.set(x as number, 0.5, 0);
        scene.add(mesh);
        return [id as string, mesh] as const;
      }),
    );
    const outline = createFolderOutline({
      scene,
      itemObjects: (id) => {
        const mesh = meshes.get(id);
        return mesh === undefined ? [] : [mesh];
      },
    });
    const dashed = () =>
      scene.children.filter(
        (o): o is THREE.LineLoop =>
          o instanceof THREE.LineLoop &&
          o.visible &&
          o.material instanceof THREE.LineDashedMaterial,
      );
    const gizmo = {
      centre: { x: 0, y: 0, z: 0 },
      headingDeg: 0,
      spritePerPx: 0.001,
    };
    outline.update(tour(), "folder:f", gizmo);
    expect(dashed()).toHaveLength(1);
    const hull = outline.hull();
    // Items from x -3.5 to 2.5 and z -0.5 to 0.5, padded.
    expect(hull?.corners[0]?.x).toBeCloseTo(-3.5 - FOLDER_HULL_PAD_M, 9);
    expect(hull?.corners[0]?.z).toBeCloseTo(-0.5 - FOLDER_HULL_PAD_M, 9);
    expect(hull?.corners[2]?.x).toBeCloseTo(2.5 + FOLDER_HULL_PAD_M, 9);
    expect(outline.tag()).toBe("Folder");
    const tag = scene.children.find(
      (o): o is THREE.Sprite => o instanceof THREE.Sprite && o.visible,
    );
    expect(tag?.position.x).toBeCloseTo(-3.5 - FOLDER_HULL_PAD_M, 9);
    // No gizmo (none drawn for it this frame): no outline, no tag.
    outline.update(tour(), "folder:f", null);
    expect(dashed()).toHaveLength(0);
    expect(outline.tag()).toBeNull();
    outline.update(tour(), "x", gizmo);
    expect(dashed()).toHaveLength(0);
    expect(outline.hull()).toBeNull();
    outline.dispose();
    expect(scene.children.some((o) => o instanceof THREE.Sprite)).toBe(false);
    expect(scene.children.some((o) => o instanceof THREE.LineLoop)).toBe(false);
  });

  it("draws no box for an item not drawn yet", () => {
    const scene = new THREE.Scene();
    const outline = createFolderOutline({ scene, itemObjects: () => [] });
    outline.update(tour(), "folder:f");
    expect(outline.count()).toBe(0);
    outline.dispose();
  });
});
