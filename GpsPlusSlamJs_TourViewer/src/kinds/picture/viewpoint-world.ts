/**
 * The part of a picture seen from a viewpoint, behind the one world door
 * (`world-part.ts`): then and now, sharpen, the viewer, the finder and the
 * window. Each hangs the picture where the camera saw the place
 * (`viewpoint-looks.ts`) and shows it by where the visitor stands and
 * looks (`viewpoint-fade.ts`); then and now blends it with today
 * (`then-now-fade.ts`) and, lined up, hands the visitor a slider
 * (`then-now-slider.ts`).
 *
 * The viewpoint is in the station's frame, so moving the picture's pose
 * never moves where it lines up: the part's look sits in an anchor that
 * undoes the part's own pose (and size) every frame.
 *
 * @see viewpoint-world.ts.md
 */
import type {
  TourPictureBlock,
  TourPictureViewpoint,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";
import {
  Group,
  Quaternion,
  Vector3,
  type Material,
  type MeshBasicMaterial,
  type Object3D,
  type Texture,
} from "three";

import { smoothstep } from "../../smoothstep.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";
import {
  THEN_NOW_START,
  stepThenNow,
  takeOverThenNow,
  type ThenNowState,
} from "./then-now-fade.js";
import { buildThenNowSlider } from "./then-now-slider.js";
import {
  FINDER_FADE,
  SHARPEN_FADE,
  THEN_NOW_FADE,
  VIEWER_FADE,
  viewpointAlpha,
  viewpointReach,
  type ViewpointReach,
} from "./viewpoint-fade.js";
import {
  FINDER_INK_COLOR,
  FINDER_ON_SPOT_COLOR,
  finderCorners,
  portalLook,
  spotMarker,
  viewerStand,
  viewpointPlane,
  type PortalLook,
} from "./viewpoint-looks.js";
import { buildPictureSheet } from "./picture-sheet.js";
import {
  decodePicture,
  markDrawnAspect,
  pictureAspect,
} from "./picture-decode.js";

/** The views this part stands. */
const VIEWPOINT_PART_VIEWS = new Set<string>([
  "thenNow",
  "sharpen",
  "viewer",
  "finder",
  "window",
]);

/** How much the editor shows of a picture that otherwise fades by place:
 *  enough to place it by, not so much it hides the place. */
export const EDITOR_PICTURE_ALPHA = 0.55;
/** The finder's centre crop: 18 degrees either side, at most the lens. */
const FINDER_HALF_DEG = 18;

/** What the part decodes with (a fake in unit tests). */
export interface ViewpointWorldDeps {
  readonly decode?: (blob: Blob) => Promise<Texture | null>;
}

/** One frame's reading of the visitor against the viewpoint. */
interface Reading {
  readonly dtS: number;
  readonly reach: ViewpointReach;
}

/** A built look: what it draws, what takes a tap, and how it shows a
 *  frame's reading. */
interface ViewpointLook {
  readonly root: Group;
  readonly tappable: readonly Object3D[];
  show(reading: Reading): void;
}

const facingWorld = new Vector3();
const parentTurn = new Quaternion();

function setOpacity(materials: readonly Material[], opacity: number): void {
  for (const m of materials) m.opacity = opacity;
}

/** The spot marker, fading as the picture takes over (`k`, 0 to 1). */
function withMarker(
  viewpoint: TourPictureViewpoint,
  root: Group,
): (k: number) => void {
  const marker = spotMarker(viewpoint);
  root.add(marker.group);
  return (k) => {
    marker.material.opacity = 0.9 * (1 - 0.7 * k);
  };
}

/**
 * `block`'s part, or null for a view this file does not stand or a block
 * without a viewpoint (the renderer draws that as a plane). Its `ready`
 * settles once the look stands and rejects when the image cannot be read
 * or decoded.
 */
export function viewpointWorld(
  block: TourPictureBlock,
  env: WorldEnv,
  deps: ViewpointWorldDeps = {},
): WorldPart | null {
  const viewpoint = block.viewpoint;
  if (!VIEWPOINT_PART_VIEWS.has(block.view) || viewpoint === undefined) {
    return null;
  }
  const view = block.view;
  const decode = deps.decode ?? decodePicture;
  const editing = env.mode === "edit";
  const screen = env.mode === "play" ? env.screen : undefined;

  const object = new Group();
  object.name = `picture-${view}-part`;
  /** Undoes the part's pose: its children stand in the station's frame. */
  const anchor = new Group();
  anchor.matrixAutoUpdate = false;
  anchor.visible = false;
  object.add(anchor);
  const tapTarget = new Group();
  anchor.add(tapTarget);

  let gone = false;
  let look: ViewpointLook | null = null;
  let picture: Texture | null = null;
  let image: Blob | null = null;
  let lastSeconds: number | null = null;
  let closeSheet: (() => void) | null = null;
  let closeSlider: (() => void) | null = null;
  let thenNow: ThenNowState = THEN_NOW_START;
  let setSlider: ((fade: number) => void) | null = null;

  const closeSliderNow = (): void => {
    const close = closeSlider;
    closeSlider = null;
    setSlider = null;
    close?.();
  };

  const openSlider = (): void => {
    if (screen === undefined || closeSlider !== null || gone) return;
    closeSlider = screen.show((host) => {
      const slider = buildThenNowSlider(
        host,
        { year: block.year, caption: block.caption },
        thenNow.fade,
        (fade) => {
          thenNow = takeOverThenNow(thenNow, fade);
        },
      );
      setSlider = slider.set;
      return slider.dispose;
    });
  };

  const buildLook = (texture: Texture, aspect: number): ViewpointLook => {
    const root = new Group();
    const marker = withMarker(viewpoint, root);
    if (view === "finder") {
      const crop = Math.min(
        1,
        Math.tan(FINDER_HALF_DEG * (Math.PI / 180)) /
          Math.tan((viewpoint.hfovDeg * Math.PI) / 360),
      );
      const corners = finderCorners(viewpoint, aspect, crop);
      const fill = viewpointPlane(viewpoint, aspect, texture, undefined, crop);
      root.add(fill.holder, corners.under, corners.ink);
      const ink = corners.ink.material as MeshBasicMaterial;
      const under = corners.under.material as MeshBasicMaterial;
      return {
        root,
        tappable: [fill.holder],
        show({ reach }) {
          const on = smoothstep(
            FINDER_FADE.ramp[0],
            FINDER_FADE.ramp[1],
            reach.distanceM,
          );
          const k = editing ? 0.5 : viewpointAlpha(reach, FINDER_FADE);
          fill.mesh.material.opacity = k;
          ink.opacity = 1 - 0.35 * k;
          under.opacity = 0.55 * (1 - 0.6 * k);
          ink.color.setHex(on > 0.5 ? FINDER_ON_SPOT_COLOR : FINDER_INK_COLOR);
          marker(on);
        },
      };
    }
    if (view === "window") {
      const portal: PortalLook = portalLook(viewpoint, aspect, texture);
      root.add(portal.group);
      const uniforms = portal.opening.material.uniforms;
      return {
        root,
        tappable: [portal.group],
        show() {
          // The plane in the world, for the shader: the part moves with
          // the session's alignment.
          root.updateWorldMatrix(true, false);
          const m = root.matrixWorld;
          const p = portal.plane;
          (uniforms["uC"]?.value as Vector3).copy(p.center).applyMatrix4(m);
          (uniforms["uR"]?.value as Vector3)
            .copy(p.right)
            .transformDirection(m);
          (uniforms["uU"]?.value as Vector3).copy(p.up).transformDirection(m);
          (uniforms["uN"]?.value as Vector3)
            .copy(p.normal)
            .transformDirection(m);
          marker(1);
        },
      };
    }
    const plane = viewpointPlane(viewpoint, aspect, texture);
    root.add(plane.holder);
    if (view === "viewer") {
      const stand = viewerStand(viewpoint);
      root.add(stand.group);
      return {
        root,
        tappable: [stand.group, plane.holder],
        show({ reach }) {
          const k = editing ? 0 : viewpointAlpha(reach, VIEWER_FADE);
          // The viewer gives way to the picture.
          setOpacity(stand.materials, 1 - k);
          stand.group.visible = k < 0.99;
          plane.mesh.material.opacity = editing ? EDITOR_PICTURE_ALPHA : k;
          marker(k);
        },
      };
    }
    if (view === "sharpen") {
      return {
        root,
        tappable: [plane.holder],
        show({ reach }) {
          const k = editing
            ? EDITOR_PICTURE_ALPHA
            : viewpointAlpha(reach, SHARPEN_FADE);
          plane.mesh.material.opacity = k;
          marker(k);
        },
      };
    }
    // Then and now.
    return {
      root,
      tappable: [plane.holder],
      show({ reach, dtS }) {
        if (editing) {
          plane.mesh.material.opacity = EDITOR_PICTURE_ALPHA;
          marker(0);
          return;
        }
        const k = viewpointAlpha(reach, THEN_NOW_FADE);
        thenNow = stepThenNow(thenNow, {
          dtS,
          near: smoothstep(
            THEN_NOW_FADE.ramp[0],
            THEN_NOW_FADE.ramp[1],
            reach.distanceM,
          ),
          offAxisDeg: reach.offAxisDeg,
          shown: true,
        });
        if (thenNow.aligned) openSlider();
        else closeSliderNow();
        setSlider?.(thenNow.fade);
        plane.mesh.material.opacity = k * thenNow.fade;
        marker(k);
      },
    };
  };

  const ready = env
    .loadAsset(block.image)
    .then(async (blob) => {
      const texture = await decode(blob);
      if (texture === null) {
        throw new Error(`the picture ${block.image} cannot be shown`);
      }
      return { blob, texture };
    })
    .then(({ blob, texture }) => {
      if (gone) {
        texture.dispose();
        return;
      }
      const aspect = pictureAspect(texture);
      look = buildLook(texture, aspect);
      markDrawnAspect(object, aspect);
      anchor.add(look.root);
      // Cast against through the part's target, in the same frame.
      for (const t of look.tappable) tapTarget.add(t);
      picture = texture;
      image = blob;
    });

  const openSheet = (): void => {
    if (screen === undefined || closeSheet !== null || gone) return;
    const shown = image;
    closeSliderNow();
    closeSheet = screen.show((host) => {
      const url = shown === null ? null : URL.createObjectURL(shown);
      const cleanUp = buildPictureSheet(
        host,
        {
          title: block.title,
          year: block.year,
          caption: block.caption,
          credit: block.credit,
          alt: block.alt,
          imageUrl: url,
        },
        () => {
          const close = closeSheet;
          closeSheet = null;
          close?.();
        },
      );
      return () => {
        cleanUp();
        if (url !== null) URL.revokeObjectURL(url);
      };
    });
  };

  return {
    object,
    tapTarget,
    ready,
    ...(screen === undefined ? {} : { tap: openSheet }),
    update(frame) {
      // The anchor undoes the part's own pose and size.
      object.updateMatrix();
      anchor.matrix.copy(object.matrix).invert();
      anchor.matrixWorldNeedsUpdate = true;
      anchor.visible = true;
      const dtS = lastSeconds === null ? 0 : frame.seconds - lastSeconds;
      lastSeconds = frame.seconds;
      let facing: [number, number, number] = [Number.NaN, 0, 0];
      const camera = frame.camera;
      const parent = object.parent;
      if (camera !== undefined) {
        camera.getWorldDirection(facingWorld);
        if (parent !== null) {
          parent.getWorldQuaternion(parentTurn).invert();
          facingWorld.applyQuaternion(parentTurn);
        }
        facing = [facingWorld.x, facingWorld.y, facingWorld.z];
      }
      const reach = viewpointReach(frame.viewer, facing, viewpoint);
      look?.show({ dtS, reach });
    },
    dispose() {
      gone = true;
      closeSliderNow();
      const close = closeSheet;
      closeSheet = null;
      close?.();
      const drawn = look;
      look = null;
      image = null;
      if (drawn !== null) {
        for (const t of [drawn.root, ...drawn.tappable]) {
          t.removeFromParent();
          disposeObject3D(t);
        }
      }
      // The portal's shader holds the picture outside any material map.
      picture?.dispose();
      picture = null;
    },
  };
}
