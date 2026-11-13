/**
 * A picture's part in the world, behind the one world door
 * (`world-part.ts`): a framed print (`framed.ts`) or a cut-out standing on
 * the ground (`cutout.ts`), in the editor and in play alike; a view seen
 * from a viewpoint is `viewpoint-world.ts`'s part. A tap in play
 * opens the picture's sheet on the page's screen (`picture-sheet.ts`): a
 * framed print's with the picture, a cut-out's with its words only.
 *
 * The part is a group the renderer places at the block's pose and turns
 * by it; the look lands in it once the image is read, built at the
 * prototype's width and scaled to the block's (`widthM`), so a resize
 * preview scales from what was drawn (`placement/place-scale.ts`).
 *
 * @see world.ts.md
 */

import type { TourPictureBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";
import { Group, type Object3D, type Texture } from "three";

import { markPlaceScale } from "../../placement/place-scale.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";
import { buildCutoutLook, type CutoutLook } from "./cutout.js";
import { buildFramedLook, PICTURE_REFERENCE_WIDTH_M } from "./framed.js";
import {
  canvasPicturePainters,
  type PicturePainters,
} from "./picture-paint.js";
import { decodePicture, pictureAspect } from "./picture-decode.js";
import { buildPictureSheet } from "./picture-sheet.js";
import { viewpointWorld } from "./viewpoint-world.js";

/** What the part decodes and paints with (fakes in unit tests). */
export interface PictureWorldDeps {
  /** The image file as an upright texture; null: it cannot be shown.
   *  Default: the tour's capped decode at half size, as a picture plane's. */
  readonly decode?: (blob: Blob) => Promise<Texture | null>;
  readonly painters?: PicturePainters;
}

/**
 * `block`'s part: null for a view no part stands (the plane, which the
 * renderer draws itself, the card, a viewpoint view without a viewpoint,
 * drawn as a plane); a viewpoint view's is `viewpointWorld`'s. Its
 * `ready` settles once the look stands and rejects when the image cannot
 * be read or decoded; the renderer then takes the part out.
 */
export function pictureWorld(
  block: TourPictureBlock,
  env: WorldEnv,
  deps: PictureWorldDeps = {},
): WorldPart | null {
  if (block.view !== "framed" && block.view !== "cutout") {
    return viewpointWorld(
      block,
      env,
      deps.decode === undefined ? {} : { decode: deps.decode },
    );
  }
  const view = block.view;
  const decode = deps.decode ?? decodePicture;
  const object = new Group();
  object.name = `picture-${view}-part`;
  const tapTarget = new Group();
  object.add(tapTarget);
  let gone = false;
  let look: Object3D | null = null;
  let cutout: CutoutLook | null = null;
  let image: Blob | null = null;
  let closeSheet: (() => void) | null = null;

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
      const painters = deps.painters ?? canvasPicturePainters();
      const aspect = pictureAspect(texture);
      let built: { root: Group; tapTarget: Group };
      if (view === "framed") {
        built = buildFramedLook(
          texture,
          aspect,
          { year: block.year, caption: block.caption, credit: block.credit },
          painters,
        );
      } else {
        cutout = buildCutoutLook(
          texture,
          aspect,
          block.showTag === false
            ? null
            : { year: block.year, title: block.title, caption: block.caption },
          painters,
        );
        built = cutout;
      }
      const inner = built.root;
      inner.scale.setScalar(block.widthM / PICTURE_REFERENCE_WIDTH_M);
      markPlaceScale(inner, block.widthM);
      // The look's tap meshes are cast against through the part's target.
      tapTarget.add(inner);
      look = inner;
      image = blob;
    });

  // The sheet opens in play only, on the page's screen.
  const screen = env.mode === "play" ? env.screen : undefined;
  const openSheet = (): void => {
    if (screen === undefined || closeSheet !== null || gone) return;
    const shown = image;
    closeSheet = screen.show((host) => {
      // Made in the build: a panel pushed aside is built again.
      const url =
        view === "framed" && shown !== null ? URL.createObjectURL(shown) : null;
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
      cutout?.face(object, frame.viewer);
    },
    dispose() {
      gone = true;
      const close = closeSheet;
      closeSheet = null;
      close?.();
      const drawn = look;
      look = null;
      cutout = null;
      image = null;
      if (drawn !== null) {
        drawn.removeFromParent();
        disposeObject3D(drawn);
      }
    },
  };
}
