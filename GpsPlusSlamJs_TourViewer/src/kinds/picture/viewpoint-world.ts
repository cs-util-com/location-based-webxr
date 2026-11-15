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
import type { TourPictureBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
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
import {
  canvasTexture,
  type WorldEnv,
  type WorldPart,
} from "../../world-part.js";
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
  PORTAL_PLATE,
  VIEWER_PLATE,
  viewerStand,
  viewpointPlane,
  type PortalLook,
} from "./viewpoint-looks.js";
import { buildPictureSheet } from "./picture-sheet.js";
import {
  canvasPicturePainters,
  type PicturePainters,
} from "./picture-paint.js";
import { tagLine } from "./plate.js";
import {
  isSpotGuideView,
  spotGuideShade,
  type SpotGuideView,
} from "./spot-guide.js";
import { spotGuideLook } from "./spot-guide-look.js";
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

/** The viewer halo's glow: its base and pulse (a share of full), the
 *  pulse's rate (radians a second), and how far off (m) it glows at
 *  `farShare` of that, softer until the visitor comes near. */
const VIEWER_HALO = {
  base: 0.35,
  pulse: 0.25,
  rate: 2.2,
  nearM: 4.5,
  farShare: 0.5,
} as const;

/** The viewer plate's words: generic, since a tour's picture has no
 *  short name to put in them. */
const VIEWER_PLATE_LINES = ["Step up to it", "and see it as it was"] as const;
const PORTAL_PLATE_HINT = "Look through the frame";

/** What the part decodes and paints with (fakes in unit tests). */
export interface ViewpointWorldDeps {
  readonly decode?: (blob: Blob) => Promise<Texture | null>;
  readonly painters?: PicturePainters;
}

/** One frame's reading of the visitor against the viewpoint. */
interface Reading {
  readonly dtS: number;
  readonly reach: ViewpointReach;
  /** The clock for what pulses: 0 throughout when the visitor asked for
   *  less motion. */
  readonly seconds: number;
  /** The visitor, in the viewpoint's frame. */
  readonly viewer: readonly [number, number, number];
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

  /** The guide to the spot, for every view but the viewer (its own mark):
   *  shown each frame with how far the picture has taken over. */
  const withGuide = (
    texture: Texture,
    aspect: number,
    painters: PicturePainters,
    tappable: Object3D[],
  ): ((reading: Reading, takeover: number) => void) => {
    if (!isSpotGuideView(view)) return () => undefined;
    const guideView: SpotGuideView = view;
    const drawn = texture.image as CanvasImageSource | null | undefined;
    const guide = spotGuideLook(
      viewpoint,
      guideView,
      block.year,
      drawn === null || drawn === undefined ? null : { image: drawn, aspect },
      painters,
    );
    tappable.push(guide.group);
    return ({ reach, viewer, seconds }, takeover) => {
      guide.show(
        spotGuideShade(guideView, reach.distanceM, takeover),
        viewer,
        seconds,
      );
    };
  };

  const buildLook = (texture: Texture, aspect: number): ViewpointLook => {
    const root = new Group();
    const painters = deps.painters ?? canvasPicturePainters();
    const card = (
      size: readonly [number, number],
      line1: string,
      line2: string | undefined,
      ppm: number,
      year?: string,
    ): Texture =>
      canvasTexture(
        painters.card({
          widthM: size[0],
          heightM: size[1],
          year,
          line1,
          line2,
          ppm,
        }),
      );
    const tappable: Object3D[] = [];
    const guide = withGuide(texture, aspect, painters, tappable);
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
      tappable.push(fill.holder);
      return {
        root,
        tappable,
        show(reading) {
          const { reach } = reading;
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
          guide(reading, on);
        },
      };
    }
    if (view === "window") {
      const phrase = tagLine(undefined, block.caption);
      const portal: PortalLook = portalLook(
        viewpoint,
        aspect,
        texture,
        phrase === ""
          ? card(
              PORTAL_PLATE.paintM,
              PORTAL_PLATE_HINT,
              undefined,
              600,
              block.year,
            )
          : card(
              PORTAL_PLATE.paintM,
              phrase,
              PORTAL_PLATE_HINT,
              600,
              block.year,
            ),
      );
      root.add(portal.group);
      tappable.push(portal.group);
      const uniforms = portal.opening.material.uniforms;
      return {
        root,
        tappable,
        show(reading) {
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
          guide(reading, 1);
        },
      };
    }
    const plane = viewpointPlane(viewpoint, aspect, texture);
    root.add(plane.holder);
    if (view === "viewer") {
      const stand = viewerStand(
        viewpoint,
        card(VIEWER_PLATE.paintM, ...VIEWER_PLATE_LINES, 500),
      );
      root.add(stand.group);
      const halo = stand.halo.material;
      return {
        root,
        tappable: [stand.group, plane.holder],
        show({ reach, seconds }) {
          const k = editing ? 0 : viewpointAlpha(reach, VIEWER_FADE);
          // The viewer gives way to the picture.
          setOpacity(stand.materials, 1 - k);
          stand.group.visible = k < 0.99;
          plane.mesh.material.opacity = editing ? EDITOR_PICTURE_ALPHA : k;
          const H = VIEWER_HALO;
          halo.opacity =
            (1 - k) *
            (H.base + H.pulse * Math.sin(H.rate * seconds)) *
            (reach.distanceM < H.nearM ? 1 : H.farShare);
        },
      };
    }
    tappable.push(plane.holder);
    if (view === "sharpen") {
      return {
        root,
        tappable,
        show(reading) {
          const k = editing
            ? EDITOR_PICTURE_ALPHA
            : viewpointAlpha(reading.reach, SHARPEN_FADE);
          plane.mesh.material.opacity = k;
          guide(reading, k);
        },
      };
    }
    // Then and now.
    return {
      root,
      tappable,
      show(reading) {
        const { reach, dtS } = reading;
        if (editing) {
          plane.mesh.material.opacity = EDITOR_PICTURE_ALPHA;
          guide(reading, 0);
          return;
        }
        const k = viewpointAlpha(reach, THEN_NOW_FADE);
        const near = smoothstep(
          THEN_NOW_FADE.ramp[0],
          THEN_NOW_FADE.ramp[1],
          reach.distanceM,
        );
        thenNow = stepThenNow(thenNow, {
          dtS,
          near,
          offAxisDeg: reach.offAxisDeg,
          shown: true,
        });
        if (thenNow.aligned) openSlider();
        else closeSliderNow();
        setSlider?.(thenNow.fade);
        plane.mesh.material.opacity = k * thenNow.fade;
        guide(reading, near);
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
      look?.show({
        dtS,
        reach,
        seconds: env.reduceMotion?.() === true ? 0 : frame.seconds,
        viewer: frame.viewer,
      });
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
