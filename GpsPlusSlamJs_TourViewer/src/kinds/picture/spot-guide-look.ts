/**
 * The spot guide's meshes, in the viewpoint's frame (the station's:
 * north, up, east, the ground at height 0): the decal on the ground at
 * the spot, turned so its arrow points the way to face; the soft light
 * column standing on it; and the card on its post beside the spot,
 * turned to the visitor every frame. The column takes no tap; the decal
 * and the card are the guide's tappable parts, apart from it so that a
 * pick boxing them does not span the column. What shows how much is
 * `spot-guide.ts`'s; the part feeds its shade in.
 *
 * @see spot-guide-look.ts.md
 */
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from "three";

import { canvasTexture } from "../../world-part.js";
import type { PicturePainters } from "./picture-paint.js";
import {
  SPOT_BEAM,
  SPOT_CARD,
  SPOT_CARD_LINES,
  SPOT_DECAL_M,
  spotCardHasThumb,
  spotCardPlace,
  spotCardSize,
  spotCardTurn,
  type SpotGuideShade,
  type SpotGuideView,
} from "./spot-guide.js";
import { viewpointYaw } from "./viewpoint-looks.js";

const VS_BEAM = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/* Warm amber, strongest at the foot and gone at the top, with a slow
   ripple rising up it (the prototype's). */
const FS_BEAM = `uniform float uAlpha, uTime;
varying vec2 vUv;
void main() {
  float a = pow(1.0 - vUv.y, 1.6) * 0.55 * uAlpha
    * (0.85 + 0.15 * sin(uTime * 2.0 - vUv.y * 6.0));
  gl_FragColor = vec4(vec3(0.82, 0.55, 0.25), a);
  #include <colorspace_fragment>
}`;

/** The picture a card shows small: its image, its aspect (height over
 *  width), and whether the image is stored upside down. */
export interface SpotGuidePicture {
  readonly image: CanvasImageSource;
  readonly aspect: number;
  readonly flipped: boolean;
}

export interface SpotGuideLook {
  /** What takes no tap (the column), in the viewpoint's frame. */
  readonly group: Group;
  /** The decal and the card on its post, in the same frame: what a tap
   *  on the guide hits. The card takes none while it has given way. */
  readonly tappable: readonly Object3D[];
  /** Shows a frame: the shade, the visitor in the viewpoint's frame (the
   *  card turns to them) and the clock that ripples the column. */
  show(
    shade: SpotGuideShade,
    viewer: readonly [number, number, number],
    seconds: number,
  ): void;
}

/**
 * The guide of `view` to `viewpoint`: its card names the `year` and says
 * the view's two lines, over `picture` small where the view shows it.
 * The column takes no tap; the decal and the card do, as the picture.
 */
export function spotGuideLook(
  viewpoint: TourPictureViewpoint,
  view: SpotGuideView,
  year: string | undefined,
  picture: SpotGuidePicture | null,
  painters: PicturePainters,
): SpotGuideLook {
  const [px, , pz] = viewpoint.position;
  const group = new Group();
  group.name = "picture-spot";

  const decalMaterial = new MeshBasicMaterial({
    map: canvasTexture(painters.spotDecal()),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const decal = new Mesh(
    new PlaneGeometry(SPOT_DECAL_M, SPOT_DECAL_M),
    decalMaterial,
  );
  decal.name = "picture-spot-decal";
  decal.rotation.x = -Math.PI / 2;
  decal.renderOrder = 2;
  const turned = new Group();
  turned.name = "picture-spot-mark";
  turned.position.set(px, 0.02, pz);
  turned.rotation.y = viewpointYaw(viewpoint);
  turned.add(decal);

  const beamMaterial = new ShaderMaterial({
    uniforms: { uAlpha: { value: 1 }, uTime: { value: 0 } },
    vertexShader: VS_BEAM,
    fragmentShader: FS_BEAM,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const beam = new Mesh(
    new CylinderGeometry(
      SPOT_BEAM.radiusM,
      SPOT_BEAM.radiusM,
      SPOT_BEAM.heightM,
      16,
      1,
      true,
    ),
    beamMaterial,
  );
  beam.name = "picture-spot-beam";
  beam.position.set(px, SPOT_BEAM.heightM / 2, pz);
  // Light, not a thing: a tap passes through it.
  beam.raycast = () => undefined;

  const thumb = spotCardHasThumb(view) ? picture : null;
  const size = spotCardSize(thumb?.aspect ?? Number.NaN, thumb !== null);
  const [line1, line2] = SPOT_CARD_LINES[view];
  const cardMaterial = new MeshBasicMaterial({
    map: canvasTexture(
      painters.card({
        widthM: size.widthM,
        heightM: size.heightM,
        year,
        line1,
        line2,
        ...(thumb === null ? {} : { thumb }),
      }),
    ),
    transparent: true,
    toneMapped: false,
  });
  const card = new Mesh(
    new PlaneGeometry(size.widthM, size.heightM),
    cardMaterial,
  );
  card.name = "picture-spot-card";
  card.position.y = SPOT_CARD.liftM + size.heightM / 2;
  card.rotation.x = -SPOT_CARD.tiltRad;
  const postMaterial = new MeshStandardMaterial({
    color: 0x1d1915,
    roughness: 0.6,
    transparent: true,
  });
  const post = new Mesh(
    new CylinderGeometry(0.022, 0.03, SPOT_CARD.postM, 10),
    postMaterial,
  );
  post.name = "picture-spot-post";
  post.position.y = SPOT_CARD.postM / 2;
  const place = spotCardPlace(viewpoint);
  const stand = new Group();
  stand.name = "picture-spot-stand";
  stand.position.set(place.x, 0, place.z);
  stand.add(post, card);
  // A ray cast ignores visibility: the card and its post take a tap only
  // while they show.
  for (const mesh of [card, post]) {
    const cast = mesh.raycast.bind(mesh);
    mesh.raycast = (raycaster, hits) => {
      if (stand.visible) cast(raycaster, hits);
    };
  }

  group.add(beam);
  let turn = stand.rotation.y;
  return {
    group,
    tappable: [turned, stand],
    show(shade, viewer, seconds) {
      decalMaterial.opacity = shade.decal;
      beamMaterial.uniforms["uAlpha"]!.value = shade.beam;
      beamMaterial.uniforms["uTime"]!.value = seconds;
      beam.visible = shade.beam > 0.003;
      cardMaterial.opacity = shade.card;
      postMaterial.opacity = shade.card;
      stand.visible = shade.card > 0.01;
      turn = spotCardTurn(place.x, place.z, viewer[0], viewer[2], turn);
      stand.rotation.y = turn;
    },
  };
}
