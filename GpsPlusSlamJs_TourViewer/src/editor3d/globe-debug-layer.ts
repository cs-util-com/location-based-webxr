/**
 * The debug layer on the globe view: the recording's camera captures as
 * small thumbnails at their places, and the walk through them as one
 * line, under the tour's frame (x east, y up, z south at the tour's
 * centre). It draws what the page's debug layer drew on the map
 * (`debug-capture-layer.ts`, read through the store's `debugLayer` slice);
 * it is debug data, never the tour's content, so nothing in it is picked,
 * selected or saved.
 *
 * The thumbnails are one draw: instanced quads over one atlas texture, each
 * a fixed size on screen (`THUMB_WIDTH_PX` wide, the picture's aspect),
 * placed in the vertex shader at its capture's point. A capture whose
 * thumbnail has not come yet is a small white dot, as on the map. The atlas
 * is a canvas sized for the captures (cells of up to `CELL_PX`, at most
 * `ATLAS_MAX_PX` square), uploaded at most every `UPLOAD_EVERY_MS` while
 * thumbnails come. The line is three's screen-space line (`Line2`), drawn
 * only when asked: the tour's own walk is drawn by the arrival's marks
 * (`globe-approach-marks.ts`), so a second line over it would only hide
 * it.
 *
 * Both reach the GPU relative to the first capture, whose point is the
 * objects' position: the GPU's numbers are 32-bit, and a scan thousands
 * of km from the tour's centre (a new tour opens over the creator's part
 * of the world) would jitter by pixels if its points were (measured in
 * `globe-debug-precision.test.ts`); the position goes into three's
 * 64-bit model-view matrix instead.
 *
 * @see globe-debug-layer.ts.md
 */
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/** A thumbnail's width on screen (CSS px), the map's. */
export const THUMB_WIDTH_PX = 32;
/** A capture without its thumbnail yet: a dot this wide (CSS px). */
const DOT_PX = 8;
/** An atlas cell's side at most (px): a thumbnail decoded for a
 *  high-density screen is twice `THUMB_WIDTH_PX` wide. */
const CELL_PX = 64;
/** The atlas's side at most (px): a thousand cells of `CELL_PX`; a longer
 *  walk gets smaller cells. */
export const ATLAS_MAX_PX = 2048;
/** The atlas is uploaded at most this often while thumbnails come. */
const UPLOAD_EVERY_MS = 250;
/** The line: a cool white, apart from the walk's accent. */
const LINE_COLOUR = 0xdff3ff;
const LINE_PX = 2;
const LINE_OPACITY = 0.85;
/** The line floats this far over the captures' heights (m), as the walk. */
const LINE_LIFT_M = 0.05;

/** A picture the atlas can draw (`source`: an `<img>` or a canvas, in
 *  practice) and its pixel size. */
interface AtlasPicture {
  readonly source: unknown;
  readonly width: number;
  readonly height: number;
}

/** Where the atlas's pixels live (a canvas in the page; a fake in tests). */
export interface AtlasSurface {
  /** The texture's image (the canvas). */
  readonly image: unknown;
  /** Size the surface to `px` square, cleared. */
  reset(px: number): void;
  /** Draw `picture` into the rectangle. */
  draw(source: unknown, x: number, y: number, w: number, h: number): void;
}

/** A canvas as the atlas's surface. */
function canvasAtlasSurface(): AtlasSurface {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return {
    image: canvas,
    reset(px) {
      canvas.width = px;
      canvas.height = px;
    },
    draw(source, x, y, w, h) {
      canvas
        .getContext("2d")
        ?.drawImage(source as CanvasImageSource, x, y, w, h);
    },
  };
}

/** The atlas's layout for `count` captures: its side and its cells'. */
export function atlasLayout(count: number): {
  readonly px: number;
  readonly cellPx: number;
  readonly columns: number;
} {
  const n = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  const columns = Math.ceil(Math.sqrt(n));
  const cellPx = Math.max(
    1,
    Math.min(CELL_PX, Math.floor(ATLAS_MAX_PX / columns)),
  );
  let px = 1;
  while (px < columns * cellPx) px *= 2;
  return { px: Math.min(ATLAS_MAX_PX, px), cellPx, columns };
}

/**
 * Where a picture `w` x `h` goes in cell `index`: the largest rectangle of
 * its aspect inside the cell, at the cell's top left (canvas pixels), and
 * its place in the texture (u, v of its bottom left and its size; the
 * texture is flipped, v up), inset half a texel on each side so the
 * linear filter never reads the neighbouring cell.
 */
export function atlasCell(
  layout: {
    readonly px: number;
    readonly cellPx: number;
    readonly columns: number;
  },
  index: number,
  w: number,
  h: number,
): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly uv: readonly [number, number, number, number];
} {
  const scale = Math.min(layout.cellPx / w, layout.cellPx / h);
  const dw = Math.max(1, Math.floor(w * scale));
  const dh = Math.max(1, Math.floor(h * scale));
  const x = (index % layout.columns) * layout.cellPx;
  const y = Math.floor(index / layout.columns) * layout.cellPx;
  const s = layout.px;
  // A one-pixel picture keeps its texel (an inset would leave it no size).
  const ix = dw > 1 ? 0.5 : 0;
  const iy = dh > 1 ? 0.5 : 0;
  return {
    x,
    y,
    w: dw,
    h: dh,
    uv: [
      (x + ix) / s,
      1 - (y + dh - iy) / s,
      (dw - 2 * ix) / s,
      (dh - 2 * iy) / s,
    ],
  };
}

const VERTEX = /* glsl */ `
attribute vec3 center;
attribute vec4 cell;
attribute vec2 sizePx;
uniform vec2 resolution;
varying vec2 vUv;
varying vec2 vCorner;
varying float vDot;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(center, 1.0);
  clip.xy += position.xy * sizePx * 2.0 / resolution * clip.w;
  gl_Position = clip;
  vUv = cell.xy + uv * cell.zw;
  vCorner = uv;
  vDot = cell.z > 0.0 ? 0.0 : 1.0;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D atlas;
uniform vec3 dotColour;
varying vec2 vUv;
varying vec2 vCorner;
varying float vDot;
void main() {
  if (vDot > 0.5) {
    float r = length(vCorner - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(r > 0.36 ? vec3(0.0) : dotColour, 1.0);
  } else {
    gl_FragColor = vec4(texture2D(atlas, vUv).rgb, 1.0);
  }
  #include <colorspace_fragment>
}
`;

/** A capture to draw: its name and its point in the tour's frame. */
export interface GlobeDebugCapture {
  readonly image: string;
  readonly at: THREE.Vector3;
}

interface GlobeDebugStats {
  readonly captures: number;
  readonly thumbs: number;
  /** The line's points (0: no line). */
  readonly linePoints: number;
  readonly shown: boolean;
  /** The atlas's side (px; 0 without captures). */
  readonly atlasPx: number;
  readonly uploads: number;
  /** Objects in the layer's group: at most the thumbnails and the line. */
  readonly objects: number;
}

export interface GlobeDebugLayer {
  /** The captures to draw, replacing any (null or none: nothing); a line
   *  through them when `line`. */
  set(captures: readonly GlobeDebugCapture[] | null, line: boolean): void;
  /** Capture `image`'s thumbnail into the atlas: false for a name not
   *  drawn, a picture without a size, or one already in. */
  thumb(image: string, picture: AtlasPicture): boolean;
  /** Whether capture `image` has its thumbnail. */
  hasThumb(image: string): boolean;
  show(on: boolean): void;
  /** Upload the atlas when thumbnails came (at most every
   *  `UPLOAD_EVERY_MS`, `now` in ms). */
  frame(now: number): void;
  /** The canvas's size in CSS px. */
  resize(widthPx: number, heightPx: number): void;
  stats(): GlobeDebugStats;
  /** Everything freed and taken out of the scene. */
  dispose(): void;
}

/** The debug layer under `parent` (the tour's frame). */
export function createGlobeDebugLayer(
  parent: THREE.Object3D,
  surface: AtlasSurface = canvasAtlasSurface(),
): GlobeDebugLayer {
  const group = new THREE.Group();
  group.name = "debug-layer";
  parent.add(group);

  const texture = new THREE.Texture(surface.image as HTMLCanvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const resolution = new THREE.Vector2(1, 1);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      atlas: { value: texture },
      resolution: { value: resolution },
      dotColour: { value: new THREE.Color(0xffffff) },
    },
    toneMapped: false,
    // Sorted with the transparent line, so `renderOrder` puts the
    // thumbnails over it (opaque objects would draw first whatever it is).
    transparent: true,
  });
  const lineMaterial = new LineMaterial({
    color: LINE_COLOUR,
    linewidth: LINE_PX,
    transparent: true,
    opacity: LINE_OPACITY,
    depthWrite: false,
  });

  let mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  > | null = null;
  let line: Line2 | null = null;
  let linePoints = 0;
  /** Each drawn capture's instance, by name. */
  let index = new Map<string, number>();
  let thumbed = new Set<string>();
  let layout = atlasLayout(1);
  let atlasPx = 0;
  let dirty = false;
  let uploadedAt = -Infinity;
  let uploads = 0;
  let shown = true;

  const drop = () => {
    if (mesh !== null) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh = null;
    }
    if (line !== null) {
      line.removeFromParent();
      line.geometry.dispose();
      line = null;
    }
    linePoints = 0;
    index = new Map();
    thumbed = new Set();
    atlasPx = 0;
    dirty = false;
    // The atlas's storage and pixels too: a long walk's are 16 MB each.
    texture.dispose();
    surface.reset(1);
  };

  const cellAttribute = () =>
    mesh?.geometry.getAttribute("cell") as THREE.InstancedBufferAttribute;
  const sizeAttribute = () =>
    mesh?.geometry.getAttribute("sizePx") as THREE.InstancedBufferAttribute;

  return {
    set(captures, withLine) {
      drop();
      const drawn = (captures ?? []).filter(
        (c) =>
          typeof c.image === "string" &&
          [c.at.x, c.at.y, c.at.z].every(Number.isFinite),
      );
      const kept: GlobeDebugCapture[] = [];
      for (const c of drawn) {
        if (index.has(c.image)) continue;
        index.set(c.image, kept.length);
        kept.push(c);
      }
      if (kept.length === 0) return;
      layout = atlasLayout(kept.length);
      atlasPx = layout.px;
      surface.reset(layout.px);
      // A new size: the texture's storage (freed by `drop`) is made anew
      // at its upload.
      texture.needsUpdate = true;
      uploadedAt = -Infinity;

      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
      );
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      // Relative to the first capture: small numbers for the GPU's 32
      // bits, the anchor in the objects' 64-bit position.
      const anchor = kept[0]!.at.clone();
      const centers = new Float32Array(kept.length * 3);
      kept.forEach((c, i) => {
        centers.set(
          [c.at.x - anchor.x, c.at.y - anchor.y, c.at.z - anchor.z],
          i * 3,
        );
      });
      const sizes = new Float32Array(kept.length * 2).fill(DOT_PX);
      geometry.setAttribute(
        "center",
        new THREE.InstancedBufferAttribute(centers, 3),
      );
      geometry.setAttribute(
        "cell",
        new THREE.InstancedBufferAttribute(
          new Float32Array(kept.length * 4),
          4,
        ),
      );
      geometry.setAttribute(
        "sizePx",
        new THREE.InstancedBufferAttribute(sizes, 2),
      );
      geometry.instanceCount = kept.length;
      mesh = new THREE.Mesh(geometry, material);
      mesh.name = "debug-thumbs";
      // Placed in the shader: the quad's own bounds say nothing.
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.position.copy(anchor);
      group.add(mesh);

      if (withLine && kept.length >= 2) {
        const lineGeometry = new LineGeometry();
        lineGeometry.setPositions(
          kept.flatMap((c) => [
            c.at.x - anchor.x,
            c.at.y - anchor.y + LINE_LIFT_M,
            c.at.z - anchor.z,
          ]),
        );
        line = new Line2(lineGeometry, lineMaterial);
        line.name = "debug-walk";
        line.computeLineDistances();
        line.renderOrder = 1;
        line.position.copy(anchor);
        group.add(line);
        linePoints = kept.length;
      }
    },
    thumb(image, picture) {
      const i = index.get(image);
      if (i === undefined || thumbed.has(image) || mesh === null) return false;
      const { width, height } = picture;
      if (!(width > 0) || !(height > 0)) return false;
      const cell = atlasCell(layout, i, width, height);
      surface.draw(picture.source, cell.x, cell.y, cell.w, cell.h);
      const cells = cellAttribute();
      cells.setXYZW(i, ...cell.uv);
      cells.needsUpdate = true;
      const sizes = sizeAttribute();
      sizes.setXY(i, THUMB_WIDTH_PX, (THUMB_WIDTH_PX * height) / width);
      sizes.needsUpdate = true;
      thumbed.add(image);
      dirty = true;
      return true;
    },
    hasThumb: (image) => thumbed.has(image),
    show(on) {
      shown = on;
      group.visible = on;
    },
    frame(now) {
      if (!dirty || now - uploadedAt < UPLOAD_EVERY_MS) return;
      dirty = false;
      uploadedAt = now;
      texture.needsUpdate = true;
      uploads++;
    },
    resize(widthPx, heightPx) {
      const w = Math.max(1, Number.isFinite(widthPx) ? widthPx : 1);
      const h = Math.max(1, Number.isFinite(heightPx) ? heightPx : 1);
      resolution.set(w, h);
      lineMaterial.resolution.set(w, h);
    },
    stats: () => ({
      captures: index.size,
      thumbs: thumbed.size,
      linePoints,
      shown,
      atlasPx,
      uploads,
      objects: group.children.length,
    }),
    dispose() {
      drop();
      texture.dispose();
      material.dispose();
      lineMaterial.dispose();
      group.removeFromParent();
    },
  };
}
