/**
 * The asset optimizer check page's wiring (`asset-optimizer-check.html`):
 * the editor's own picture, sound and 3D model optimizers run on a chosen
 * or sample file at the chosen setting and steps either side, each result
 * shown next to the original, and `window.assetOptimizerCheck` for the e2e
 * (`playwright-tests/editor-asset-optimizers.spec.js`). The pure measures
 * are `asset-optimizer-check.ts`, the large model view's state
 * `model-compare-view.ts`. Importing this module starts the page.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";
import { readGlbChunks } from "gps-plus-slam-app-framework/utils/glb-chunks";
import { guardSlidersIn } from "gps-plus-slam-app-framework/utils/slider-scroll-guard";
import {
  ASSET_OPTIMIZERS,
  type OptimizeOutcome,
} from "../editor/asset-shelf/asset-optimizers.js";
import {
  createOptimizerHost,
  spawnOptimizerWorker,
} from "../editor/asset-shelf/optimizer-client.js";
import {
  OPTIMIZER_SETTINGS,
  type ModelSettings,
  type OptimizerSettings,
} from "../editor/asset-shelf/optimizer-settings.js";
import type { ModelReport } from "../editor/asset-shelf/model-step.js";
import {
  detailReadout,
  detailStops,
  formatBytes,
  formatCount,
} from "../editor/asset-shelf/shelf-panel-model.js";
import {
  bestLag,
  cartoonPicturePixels,
  commonColourShare,
  glbByteShares,
  lumaOf,
  pictureErrors,
  ssim,
  testPicturePixels,
  testSoundPlanes,
  wavOf,
} from "./asset-optimizer-check.js";
import {
  DEFAULT_TEXTURE_STEP,
  INITIAL_MODEL_VIEW,
  TEXTURE_STEPS,
  framePose,
  modelViewReducer,
  variantSettings,
  type ModelViewAction,
  type ModelViewState,
  type Vec3,
} from "./model-compare-view.js";
import photoUrl from "../../playwright-tests/fixtures/asset-optimizer/photo-oberammergau-street.jpg?url";
import speechDeUrl from "../../playwright-tests/fixtures/asset-optimizer/speech-de-frau-holle.mp3?url";
import speechEnUrl from "../../playwright-tests/fixtures/asset-optimizer/speech-en-the-raven.mp3?url";
import pianoUrl from "../../playwright-tests/fixtures/asset-optimizer/music-piano-schubert-d664.flac?url";
import orchestraUrl from "../../playwright-tests/fixtures/asset-optimizer/music-orchestra-egmont.flac?url";
import bustUrl from "../../playwright-tests/fixtures/asset-optimizer/model-marble-bust.glb?url";
import boxUrl from "../../playwright-tests/fixtures/asset-optimizer/model-utility-box.glb?url";

/** The page's element `id`; throws when the page lacks it. */
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`the page has no #${id}`);
  return found as T;
}

guardSlidersIn(document);

const host = createOptimizerHost(spawnOptimizerWorker);
const status = byId("status");
const say = (text: string): void => {
  status.textContent = text;
};

type Optimized = Extract<OptimizeOutcome, { kind: "optimized" }> & {
  readonly ms: number;
};

/** One run of a shipped optimizer row, with its own settings. */
async function run(
  kind: "image" | "audio" | "model",
  source: Blob,
  settings: OptimizerSettings,
): Promise<Optimized> {
  const optimizer = ASSET_OPTIMIZERS[kind];
  if (optimizer === null) throw new Error(`no optimizer for ${kind}`);
  const started = performance.now();
  const outcome = await optimizer.optimize(source, {
    signal: new AbortController().signal,
    progress: () => {},
    settings,
    host,
  });
  const ms = Math.round(performance.now() - started);
  if (outcome.kind !== "optimized") throw new Error(outcome.reason);
  return { ...outcome, ms };
}

const optimizePicture = (
  source: Blob,
  maxSidePx: number,
  quality: number,
): Promise<Optimized> =>
  run("image", source, {
    ...OPTIMIZER_SETTINGS,
    picture: { ...OPTIMIZER_SETTINGS.picture, maxSidePx, quality },
  });

/** `channels` (1 or 2) overrides the music setting's; a mono source
 *  is speech, always one channel. */
const optimizeSound = (
  source: Blob,
  bitsPerSecond: number,
  channels: 1 | 2 = OPTIMIZER_SETTINGS.music.channels,
): Promise<Optimized> =>
  run("audio", source, {
    ...OPTIMIZER_SETTINGS,
    speech: { ...OPTIMIZER_SETTINGS.speech, bitsPerSecond },
    music: { ...OPTIMIZER_SETTINGS.music, bitsPerSecond, channels },
  });

/** The real sample files (SOURCES.md next to them). */
const SAMPLE_URLS = new Map<string, string>([
  ["photo", photoUrl],
  ["speech-de", speechDeUrl],
  ["speech-en", speechEnUrl],
  ["piano", pianoUrl],
  ["orchestra", orchestraUrl],
]);

/** A sample file as a Blob. */
async function sample(name: string): Promise<Blob> {
  const url = SAMPLE_URLS.get(name);
  if (url === undefined) throw new Error(`no sample named ${name}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`the sample ${name} did not load (${response.status})`);
  }
  return response.blob();
}

const optimizeModel = (
  source: Blob,
  model: Partial<ModelSettings>,
): Promise<Optimized> =>
  run("model", source, {
    ...OPTIMIZER_SETTINGS,
    model: { ...OPTIMIZER_SETTINGS.model, ...model },
  });

const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
] as const;

/** `node` as a mesh, or null for any other object. */
const meshOf = (node: THREE.Object3D): THREE.Mesh | null =>
  (node as Partial<THREE.Mesh>).isMesh === true ? (node as THREE.Mesh) : null;

/** The texture in `material`'s `slot`, if it has one. */
function textureIn(
  material: THREE.Material | THREE.Material[],
  slot: (typeof TEXTURE_SLOTS)[number],
): THREE.Texture | null {
  if (Array.isArray(material)) return null;
  const value = (material as unknown as Record<string, unknown>)[slot];
  return value instanceof THREE.Texture ? value : null;
}

/** `blob` loaded by three.js, as the tour loads it. */
async function loadModel(blob: Blob): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), "");
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

const INDEX_BYTES: Readonly<Record<number, number>> = {
  5121: 1,
  5123: 2,
  5125: 4,
};

/** The parts of a GLB's JSON chunk `chainBytesOf` reads. */
interface GlbJson {
  readonly meshes?: readonly {
    readonly primitives?: readonly {
      readonly extras?: { readonly lod?: { readonly indices?: number } };
    }[];
  }[];
  readonly accessors?: readonly {
    readonly count: number;
    readonly componentType: number;
  }[];
}

/** The bytes of the coarser levels' index lists a file carries
 *  (`primitive.extras.lod.indices`), read from its JSON chunk. */
function chainBytesOf(bytes: Uint8Array): number {
  const chunks = readGlbChunks(bytes);
  if (!chunks.ok) throw new Error(`the file is no GLB: ${chunks.reason}`);
  const json = chunks.json as GlbJson;
  let sum = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const at = primitive.extras?.lod?.indices;
      const chain = at === undefined ? undefined : json.accessors?.[at];
      if (chain) sum += chain.count * (INDEX_BYTES[chain.componentType] ?? 0);
    }
  }
  return sum;
}

interface ModelFacts {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly triangles: number;
  readonly textureSide: number;
  readonly chainBytes: number;
  readonly inert: boolean;
}

/** What three.js makes of `blob`: its world box, triangles, largest
 *  texture side, the bytes of its saved coarser levels, and whether
 *  the tour's own check accepts the file. */
async function modelFacts(blob: Blob): Promise<ModelFacts> {
  const scene = await loadModel(blob);
  const box = new THREE.Box3().setFromObject(scene);
  let triangles = 0;
  let textureSide = 0;
  scene.traverse((object) => {
    const mesh = meshOf(object);
    if (!mesh) return;
    const geometry = mesh.geometry;
    triangles +=
      (geometry.index?.count ?? geometry.attributes.position!.count) / 3;
    for (const slot of TEXTURE_SLOTS) {
      const image = textureIn(mesh.material, slot)?.image as
        { readonly width: number; readonly height: number } | null | undefined;
      if (image) {
        textureSide = Math.max(textureSide, image.width, image.height);
      }
    }
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    triangles,
    textureSide,
    chainBytes: chainBytesOf(bytes),
    inert: checkGlbInert(bytes).ok,
  };
}

const VIEW = 256;
let renderer: THREE.WebGLRenderer | null = null;

interface Drawing {
  readonly luma: Float32Array;
  readonly url: string;
}

/** `blob` drawn from a camera framed on `box` (the original's): the
 *  drawing's luma and a data URL. */
async function drawModel(
  blob: Blob,
  box: { readonly min: Vec3; readonly max: Vec3 },
): Promise<Drawing> {
  renderer ??= new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(VIEW, VIEW, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x808080);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);
  const object = await loadModel(blob);
  scene.add(object);
  const radius =
    new THREE.Vector3(...box.max).distanceTo(new THREE.Vector3(...box.min)) / 2;
  const camera = new THREE.PerspectiveCamera(40, 1, radius / 50, radius * 10);
  const pose = framePose(box.min, box.max);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixels = new Uint8ClampedArray(VIEW * VIEW * 4);
  gl.readPixels(0, 0, VIEW, VIEW, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const url = renderer.domElement.toDataURL();
  // Read once, so its textures and buffers leave the GPU at once.
  disposeObject(object);
  return { luma: lumaOf(pixels), url };
}

/** One model run: the result, both files' facts, and the SSIM of the
 *  two drawings. */
async function compareModel(
  source: Blob,
  model: Partial<ModelSettings>,
): Promise<
  Optimized & {
    readonly before: ModelFacts;
    readonly after: ModelFacts;
    readonly drawnBefore: string;
    readonly drawnAfter: string;
    readonly ssim: number;
  }
> {
  const result = await optimizeModel(source, model);
  const before = await modelFacts(source);
  const after = await modelFacts(result.blob);
  const drawnBefore = await drawModel(source, before);
  const drawnAfter = await drawModel(result.blob, before);
  return {
    ...result,
    before,
    after,
    drawnBefore: drawnBefore.url,
    drawnAfter: drawnAfter.url,
    ssim: ssim(drawnBefore.luma, drawnAfter.luma, VIEW, VIEW),
  };
}

/** A canvas's 2D context; throws when the browser gives none. */
function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  return context;
}

/** A JPEG of the photo-like test picture. */
async function testPicture(
  width: number,
  height: number,
  seed = 1,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const pixels = testPicturePixels(width, height, seed);
  context2d(canvas).putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

/** A PNG of the generated cartoon figure, flat or shaded. */
async function cartoonPicture(
  width: number,
  height: number,
  shaded: boolean,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const pixels = cartoonPicturePixels(width, height, { shaded });
  context2d(canvas).putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  return canvas.convertToBlob({ type: "image/png" });
}

/** The RGBA pixels of `blob`, upright, scaled to `width` x `height`
 *  when given (`quality` "pixelated" keeps the colours unblended). */
async function pixelsOf(
  blob: Blob,
  width?: number,
  height?: number,
  quality: ResizeQuality = "high",
): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(
    blob,
    width
      ? {
          resizeWidth: width,
          ...(height === undefined ? {} : { resizeHeight: height }),
          resizeQuality: quality,
          imageOrientation: "from-image",
        }
      : { imageOrientation: "from-image" },
  );
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = context2d(canvas);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** `optimized` against `original` scaled to its size: SSIM, PSNR and
 *  the near-worst pixel error. */
async function comparePicture(
  original: Blob,
  optimized: Blob,
): Promise<{
  readonly ssim: number;
  readonly psnr: number;
  readonly nearWorst: number;
}> {
  const small = await createImageBitmap(optimized);
  const { width, height } = small;
  small.close();
  const before = await pixelsOf(original, width, height);
  const after = await pixelsOf(optimized, width, height);
  return {
    ssim: ssim(lumaOf(before), lumaOf(after), width, height),
    ...pictureErrors(before, after),
  };
}

/** The share of `blob`'s pixels in its `top` most common colours at
 *  `bits` bits a channel, read on a copy of at most 256 px a side
 *  (nearest pixel, so no colour is blended). */
async function colourShare(blob: Blob, top = 16, bits = 8): Promise<number> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  bitmap.close();
  return commonColourShare(
    await pixelsOf(blob, width, height, "pixelated"),
    top,
    bits,
  );
}

/** A WAV of a test sound. */
function testSound(
  kind: Parameters<typeof testSoundPlanes>[0],
  seconds: number,
  sampleRate: number,
  seed = 1,
): Blob {
  const planes = testSoundPlanes(kind, seconds, sampleRate, seed);
  return new Blob([new Uint8Array(wavOf(planes, sampleRate))], {
    type: "audio/wav",
  });
}

/** The SSIM of `optimized` against `original` scaled to its size. */
async function pictureSsim(original: Blob, optimized: Blob): Promise<number> {
  const small = await createImageBitmap(optimized);
  const { width, height } = small;
  const lumaAt = async (blob: Blob): Promise<Float32Array> => {
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
      imageOrientation: "from-image",
    });
    const context = context2d(new OffscreenCanvas(width, height));
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return lumaOf(context.getImageData(0, 0, width, height).data);
  };
  small.close();
  return ssim(await lumaAt(original), await lumaAt(optimized), width, height);
}

/** The decoded planes of `blob` at 48 kHz, as the editor decodes. */
async function decode(blob: Blob): Promise<Float32Array[]> {
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: 1,
    sampleRate: 48000,
  });
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  return Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  );
}

/** What an <audio> element says the sound lasts, in milliseconds,
 *  rounded as the narration editor rounds it. */
function durationMs(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(blob);
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(Math.round(audio.duration * 1000));
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("the sound could not be played"));
    });
    audio.src = url;
  });
}

const kib = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KiB`;

function card(
  parent: HTMLElement,
  chosen: boolean,
  media: HTMLElement,
  lines: readonly string[],
): void {
  const figure = document.createElement("figure");
  if (chosen) figure.className = "chosen";
  figure.append(media);
  const caption = document.createElement("figcaption");
  caption.textContent = lines.join(" - ");
  figure.append(caption);
  parent.append(figure);
}

const share = (part: number, whole: number): string => {
  const percent = (100 * part) / whole;
  return `${percent.toFixed(percent < 10 ? 1 : 0)} % of the original`;
};

interface PictureVariant {
  readonly label?: string;
  readonly side: number;
  readonly quality: number;
  readonly chosen?: boolean;
}

/** The photo setting (chosen) and its steps, then the flat-colour
 *  candidates; quality 1 is Chromium's lossless WebP. */
const PICTURE_VARIANTS: readonly PictureVariant[] = [
  { label: "photo setting", side: 1600, quality: 0.6, chosen: true },
  { side: 1600, quality: 0.5 },
  { side: 1600, quality: 0.75 },
  { side: 1280, quality: 0.6 },
  { side: 2048, quality: 0.6 },
  { label: "flat-colour candidate", side: 1600, quality: 0.9 },
  { label: "flat-colour candidate, lossless", side: 1600, quality: 1 },
];

const settingsOf = (v: PictureVariant): string =>
  `${v.side} px, ${v.quality === 1 ? "lossless" : `quality ${v.quality}`}`;

async function showPictures(source: Blob): Promise<void> {
  const out = byId("picture-results");
  out.replaceChildren();
  const original = document.createElement("img");
  original.src = URL.createObjectURL(source);
  original.alt = "The original picture";
  const flat = await colourShare(source);
  card(out, false, original, [
    "Original",
    kib(source.size),
    `${(100 * flat).toFixed(1)} % of its pixels in its 16 most common colours`,
  ]);
  let made = 0;
  for (const v of PICTURE_VARIANTS) {
    made++;
    say(
      `Making picture ${made} of ${PICTURE_VARIANTS.length}: ${settingsOf(v)}...`,
    );
    const result = await optimizePicture(source, v.side, v.quality);
    const score = await comparePicture(source, result.blob);
    const img = document.createElement("img");
    img.src = URL.createObjectURL(result.blob);
    img.alt = `The picture at ${settingsOf(v)}`;
    card(out, v.chosen === true, img, [
      v.label ? `${settingsOf(v)} (${v.label})` : settingsOf(v),
      `${result.width} x ${result.height}`,
      kib(result.blob.size),
      share(result.blob.size, source.size),
      `SSIM ${score.ssim.toFixed(4)}`,
      Number.isFinite(score.psnr)
        ? `PSNR ${score.psnr.toFixed(1)} dB`
        : "PSNR exact",
      `near-worst error ${score.nearWorst}`,
      `${result.ms} ms`,
    ]);
  }
  say(`Pictures done: ${PICTURE_VARIANTS.length} results.`);
}

interface SoundVariant {
  readonly bps: number;
  readonly channels: 1 | 2;
  readonly chosen?: boolean;
}

/** Speech (a mono source) and music (stereo, and made mono) steps,
 *  down to Opus's lowest bitrate; the chosen ones are the shelf's. */
const SPEECH_VARIANTS: readonly SoundVariant[] = [
  32000, 24000, 16000, 12000, 8000, 6000,
].map((bps) => ({ bps, channels: 1, chosen: bps === 24000 }));
const MUSIC_VARIANTS: readonly SoundVariant[] = [
  ...[96000, 64000, 48000, 32000, 24000, 16000].map((bps): SoundVariant => ({
    bps,
    channels: 2,
    chosen: bps === 64000,
  })),
  ...[32000, 24000, 16000, 12000].map((bps): SoundVariant => ({
    bps,
    channels: 1,
  })),
];

async function showSounds(source: Blob): Promise<void> {
  const out = byId("sound-results");
  out.replaceChildren();
  const planes = await decode(source);
  const speech = planes.length === 1;
  const variants = speech ? SPEECH_VARIANTS : MUSIC_VARIANTS;
  const frames = planes[0]?.length ?? 0;
  const original = document.createElement("audio");
  original.controls = true;
  original.src = URL.createObjectURL(source);
  card(out, false, original, [
    `Original (${speech ? "speech" : "music"})`,
    kib(source.size),
    `${frames} samples at 48 kHz`,
  ]);
  let made = 0;
  for (const v of variants) {
    made++;
    const settings = `Opus ${v.bps / 1000} kbps ${v.channels === 1 ? "mono" : "stereo"}`;
    say(`Making sound ${made} of ${variants.length}: ${settings}...`);
    const result = await optimizeSound(source, v.bps, v.channels);
    const after = (await decode(result.blob))[0]?.length ?? 0;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = URL.createObjectURL(result.blob);
    card(out, v.chosen === true, audio, [
      v.chosen ? `${settings} (chosen)` : settings,
      kib(result.blob.size),
      share(result.blob.size, source.size),
      after === frames
        ? "the original's length to the sample"
        : `${after} samples: NOT the original's length`,
      `${result.ms} ms to make`,
    ]);
  }
  say(`Sounds done: ${variants.length} results.`);
}

/** The original or a made variant, as the large view shows it. */
interface ModelEntry {
  readonly blob: Blob;
  readonly ms: number | null;
  readonly facts: ModelFacts;
  readonly bytes: ReturnType<typeof glbByteShares>;
  readonly ssim: number | null;
  readonly object: THREE.Group;
}

interface VariantEntry extends ModelEntry {
  readonly lod: ModelReport["lod"] | null;
}

/** A variant asked for: its entry once it is made. */
interface MadeRecord {
  entry: VariantEntry | null;
}

/** The one large view: three.js resources (not state), the original
 *  and the cache of made variants (resources too: files and scenes
 *  keyed by their settings). The sliders, the options, the wireframe
 *  look and the camera pose are `state`, changed only through
 *  `modelViewReducer`. */
const view: {
  state: ModelViewState;
  source: Blob | null;
  original: ModelEntry | null;
  originalDrawing: Drawing | null;
  made: Map<string, MadeRecord>;
  failure: { readonly key: string; readonly message: string } | null;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  controls: OrbitControls | null;
  shown: THREE.Group | null;
  shownEntry: ModelEntry | null;
} = {
  state: INITIAL_MODEL_VIEW,
  source: null,
  original: null,
  originalDrawing: null,
  made: new Map(),
  failure: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  shown: null,
  shownEntry: null,
};

/** The wireframe look's materials, shared by every model. */
const FLAT = new THREE.MeshStandardMaterial({
  color: 0xc8c8c8,
  flatShading: true,
  roughness: 1,
  metalness: 0,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const WIRE = new THREE.LineBasicMaterial({ color: 0x1a1a1a });

const TOGGLES: Readonly<
  Record<string, "original" | "webp" | "positions8" | "wireframe">
> = {
  "model-original": "original",
  "model-webp": "webp",
  "model-positions8": "positions8",
  "model-wire": "wireframe",
};

/** The view's three.js parts, once `setUpView` has made them. */
function parts(): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
} {
  const { renderer: r, scene, camera, controls } = view;
  if (!r || !scene || !camera || !controls) {
    throw new Error("the model view is not set up");
  }
  return { renderer: r, scene, camera, controls };
}

function setUpView(): void {
  if (view.renderer) return;
  const canvas = byId<HTMLCanvasElement>("model-canvas");
  view.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  view.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  view.scene = new THREE.Scene();
  view.scene.background = new THREE.Color(0x808080);
  view.scene.add(new THREE.HemisphereLight(0xffffff, 0x606060, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(1, 2, 1.5);
  view.scene.add(sun);
  view.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  view.controls = new OrbitControls(view.camera, canvas);
  view.controls.addEventListener("change", () => {
    dispatchView({ type: "camera", camera: poseOfCamera() });
  });
  new ResizeObserver(() => renderView()).observe(canvas);
  for (const [id, name] of Object.entries(TOGGLES)) {
    byId<HTMLInputElement>(id).addEventListener("change", (event) =>
      dispatchView({
        type: "toggle",
        name,
        on: (event.target as HTMLInputElement).checked,
      }),
    );
  }
  // "input" moves the readout while dragging; "change" (on release,
  // or each key press) asks for the variant.
  for (const [id, type] of [
    ["model-geometry", "geometry"],
    ["model-texture", "texture"],
  ] as const) {
    const slider = byId<HTMLInputElement>(id);
    slider.addEventListener("input", () =>
      sliderReadouts(
        type === "geometry" ? Number(slider.value) : null,
        type === "texture" ? Number(slider.value) : null,
      ),
    );
    slider.addEventListener("change", () =>
      dispatchView({ type, index: Number(slider.value) }),
    );
  }
}

const poseOfCamera = (): { position: Vec3; target: Vec3 } => {
  const { camera, controls } = parts();
  return {
    position: camera.position.toArray(),
    target: controls.target.toArray(),
  };
};

function dispatchView(action: ModelViewAction): void {
  view.state = modelViewReducer(view.state, action);
  requestShown();
  renderView();
}

/** `object`'s meshes in the wireframe look or textured as loaded;
 *  the wire lines are made the first time they are asked for. */
function lookOf(object: THREE.Object3D, wireframe: boolean): void {
  object.traverse((node) => {
    const mesh = meshOf(node);
    if (!mesh) return;
    const data = mesh.userData as {
      textured?: THREE.Material | THREE.Material[];
      wire?: THREE.LineSegments;
    };
    data.textured ??= mesh.material;
    if (wireframe && !data.wire) {
      const lines = new THREE.LineSegments(
        new THREE.WireframeGeometry(mesh.geometry),
        WIRE,
      );
      mesh.add(lines);
      data.wire = lines;
    }
    mesh.material = wireframe ? FLAT : data.textured;
    if (data.wire) data.wire.visible = wireframe;
  });
}

const shownSettings = (): ReturnType<typeof variantSettings> =>
  variantSettings(view.state);

/** Makes the variant the sliders name, once per setting; the view
 *  draws it when it is ready. */
function requestShown(): void {
  const variant = shownSettings();
  if (!variant || view.made.has(variant.key) || !view.source) return;
  const source = view.source;
  const record: MadeRecord = { entry: null };
  view.made.set(variant.key, record);
  if (view.failure?.key === variant.key) view.failure = null;
  say("Making the variant...");
  makeVariant(source, variant.model)
    .then((entry) => {
      if (view.source !== source) {
        disposeObject(entry.object);
        return;
      }
      record.entry = entry;
      say("Model ready.");
    })
    .catch((error: unknown) => {
      // A variant of a model no longer shown fails quietly; a real
      // failure is not cached, so asking for it again retries.
      if (view.source !== source) return;
      if (view.made.get(variant.key) === record) {
        view.made.delete(variant.key);
      }
      const message = error instanceof Error ? error.message : String(error);
      view.failure = { key: variant.key, message };
      say(`Failed: ${message}`);
    })
    .finally(() => renderView());
}

/** One variant: the optimizer run, what three.js makes of it, its
 *  bytes by kind and the SSIM of its drawing against the
 *  original's. The original and its drawing are taken before the
 *  first await: a model loaded meanwhile must not be compared with. */
async function makeVariant(
  source: Blob,
  model: Partial<ModelSettings>,
): Promise<VariantEntry> {
  const original = view.original;
  const originalDrawing = view.originalDrawing;
  if (!original || !originalDrawing) {
    throw new Error("no original model to compare with");
  }
  const result = await optimizeModel(source, model);
  const facts = await modelFacts(result.blob);
  const drawn = await drawModel(result.blob, original.facts);
  return {
    blob: result.blob,
    ms: result.ms,
    lod: result.model?.lod ?? null,
    facts,
    bytes: glbByteShares(new Uint8Array(await result.blob.arrayBuffer())),
    ssim: ssim(originalDrawing.luma, drawn.luma, VIEW, VIEW),
    object: await loadModel(result.blob),
  };
}

/** The readouts under the sliders, for the stops the state holds or,
 *  while a slider is dragged, the stop under the thumb. */
function sliderReadouts(
  geometryAt: number | null = null,
  textureAt: number | null = null,
): void {
  const g = geometryAt ?? view.state.geometry;
  const t = textureAt ?? view.state.texture;
  const stop = view.state.stops[g];
  const geometryOut = byId("model-geometry-out");
  if (stop) {
    const words = detailReadout(
      stop.triangles,
      view.state.trianglesBefore,
      stop.deviation,
      view.state.size,
    );
    geometryOut.textContent = `${words.share}${stop.share === null ? " (default)" : ""} - ${words.triangles} - ${words.deviation}`;
  } else {
    geometryOut.textContent = "";
  }
  const step = TEXTURE_STEPS[t];
  byId("model-texture-out").textContent = step
    ? `${step.label}${t === DEFAULT_TEXTURE_STEP ? " (default)" : ""}`
    : "";
}

/** The size panel and the facts line of `entry` (the original or a
 *  variant), or of a variant still being made. */
function sizeAndFacts(
  original: ModelEntry,
  entry: ModelEntry,
  waiting: string | null,
): void {
  byId("model-size-bytes").textContent = formatBytes(entry.blob.size);
  byId("model-size-share").textContent =
    entry === original
      ? "the original"
      : `${share(entry.blob.size, original.blob.size)} (${formatBytes(original.blob.size)})`;
  byId("model-size-split").textContent =
    `textures ${formatBytes(entry.bytes.textures)}, geometry ${formatBytes(entry.bytes.geometry)}`;
  const lines = [
    waiting ? `Making the variant (${waiting})...` : null,
    entry === original ? "Original" : "Variant",
    `${formatCount(entry.facts.triangles)} triangles${entry.facts.chainBytes > 0 ? ` (and coarser levels for the distance, ${formatBytes(entry.facts.chainBytes)})` : ""}`,
    `textures up to ${entry.facts.textureSide} px`,
    entry.ssim === null ? null : `SSIM ${entry.ssim.toFixed(4)}`,
    entry.ms === null ? null : `${entry.ms} ms to make`,
    entry.facts.inert ? null : "the tour's check REFUSES this file",
  ];
  byId("model-facts").textContent = lines
    .filter((line) => line !== null)
    .join(" - ");
}

/** Draws `view.state`: the asked model swapped in when it is ready
 *  (until then the one before stays; the camera is never touched),
 *  its look, the controls and the size panel. */
function renderView(): void {
  if (!view.renderer || !view.original) return;
  const { renderer: drawer, scene, camera } = parts();
  const { original, wireframe } = view.state;
  const variant = shownSettings();
  const record = variant ? view.made.get(variant.key) : undefined;
  const asked = original ? view.original : (record?.entry ?? null);
  const failed =
    !record && view.failure && view.failure.key === variant?.key
      ? view.failure.message
      : null;
  const entry = asked ?? view.shownEntry ?? view.original;
  if (view.shown !== entry.object) {
    if (view.shown) {
      scene.remove(view.shown);
      // Off the GPU while not drawn; three uploads it again if it is
      // shown again (its images stay on the CPU side).
      disposeObject(view.shown);
    }
    scene.add(entry.object);
    view.shown = entry.object;
    view.shownEntry = entry;
    view.state = modelViewReducer(view.state, {
      type: "shown",
      key: entry === view.original ? "original" : (variant?.key ?? "original"),
    });
  }
  lookOf(entry.object, wireframe);
  for (const [id, name] of Object.entries(TOGGLES)) {
    byId<HTMLInputElement>(id).checked = view.state[name];
  }
  const geometry = byId<HTMLInputElement>("model-geometry");
  geometry.max = String(Math.max(0, view.state.stops.length - 1));
  geometry.value = String(view.state.geometry);
  geometry.disabled = view.state.stops.length < 2;
  byId<HTMLInputElement>("model-texture").value = String(view.state.texture);
  sliderReadouts();
  const waiting = asked === null ? (failed ?? "the one before stays") : null;
  byId("model-view").setAttribute(
    "aria-busy",
    String(asked === null && !failed),
  );
  sizeAndFacts(view.original, entry, waiting);
  const canvas = drawer.domElement;
  const { clientWidth: width, clientHeight: height } = canvas;
  if (width === 0 || height === 0) return;
  const ratio = drawer.getPixelRatio();
  if (canvas.width !== Math.round(width * ratio)) {
    drawer.setSize(width, height, false);
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  drawer.render(scene, camera);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((node) => {
    const withParts = node as Partial<THREE.Mesh>;
    withParts.geometry?.dispose();
    const material = ((node.userData as { textured?: unknown }).textured ??
      withParts.material) as THREE.Material | THREE.Material[] | undefined;
    if (material && material !== FLAT && material !== WIRE) {
      for (const slot of TEXTURE_SLOTS) textureIn(material, slot)?.dispose();
      if (!Array.isArray(material)) material.dispose();
    }
  });
}

/** Lets go of the previous model, its variants and their scenes. */
function clearModels(): void {
  if (view.shown) parts().scene.remove(view.shown);
  view.shown = null;
  view.shownEntry = null;
  for (const record of view.made.values()) {
    if (record.entry) disposeObject(record.entry.object);
  }
  view.made = new Map();
  view.failure = null;
  if (view.original) disposeObject(view.original.object);
  view.original = null;
}

/** Loads `source`: the original, then the variant the sliders name
 *  at the default level, whose level of detail gives the geometry
 *  slider its stops (the shelf's own, `detailStops`). The camera is
 *  framed on the original's box. */
async function showModels(source: Blob): Promise<void> {
  setUpView();
  clearModels();
  const { camera, controls } = parts();
  view.source = source;
  const facts = await modelFacts(source);
  view.originalDrawing = await drawModel(source, facts);
  const original: ModelEntry = {
    blob: source,
    facts,
    bytes: glbByteShares(new Uint8Array(await source.arrayBuffer())),
    ssim: null,
    ms: null,
    object: await loadModel(source),
  };
  view.original = original;
  byId("model-caption").textContent =
    `Original: ${formatBytes(source.size)}, ${formatCount(facts.triangles)} triangles, textures up to ${facts.textureSide} px (${formatBytes(original.bytes.textures)} of texture bytes)`;
  say("Making the default variant...");
  const first: ModelViewState = {
    ...view.state,
    stops: [{ share: null, triangles: 0, deviation: 0 }],
    geometry: 0,
  };
  const defaults = variantSettings(first);
  if (defaults === null) throw new Error("no default variant");
  const entry = await makeVariant(source, defaults.model);
  const lod = entry.lod;
  const { stops, at } = detailStops({
    choices: lod?.choices ?? [],
    share: null,
    triangles: lod?.trianglesAfter ?? entry.facts.triangles,
    deviation: lod?.deviation ?? 0,
  });
  const { min, max } = facts;
  const pose = framePose(min, max);
  const diagonal = new THREE.Vector3(...max).distanceTo(
    new THREE.Vector3(...min),
  );
  camera.near = diagonal / 400;
  camera.far = diagonal * 50;
  camera.position.set(...pose.position);
  controls.target.set(...pose.target);
  controls.minDistance = diagonal * 0.05;
  controls.maxDistance = diagonal * 5;
  view.made.set(defaults.key, { entry });
  view.state = modelViewReducer(view.state, {
    type: "loaded",
    stops,
    geometry: at,
    trianglesBefore: lod?.trianglesBefore ?? facts.triangles,
    size: lod?.size ?? 0,
    camera: pose,
    shownKey: defaults.key,
  });
  byId("model-view").hidden = false;
  renderView();
  controls.update();
  say("Model ready.");
}

const testModel = async (name = "rock"): Promise<Blob> =>
  (await fetch(`./prototypes/model-lod-1/${name}.glb`)).blob();

/** The view's sample models: the scanned rock and the two Poly Haven
 *  models (SOURCES.md next to the fixtures). */
async function sampleModel(name: string): Promise<Blob> {
  if (name === "rock") return testModel("rock");
  const url = new Map([
    ["bust", bustUrl],
    ["box", boxUrl],
  ]).get(name);
  if (url === undefined) throw new Error(`no sample model named ${name}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`the model ${name} did not load (${response.status})`);
  }
  return response.blob();
}

/** What the view shows, for the e2e: its state, the camera as
 *  three.js has it, the shown file (the original or which variant,
 *  its triangles and bytes), whether the asked variant is still being
 *  made, and how many of the shown model's meshes have their wire
 *  lines drawn and their own (textured) material on, and what both
 *  renderers hold on the GPU (`gpu.view` the large view's,
 *  `gpu.draw` the fixed SSIM drawings'), so a leak shows. */
function modelView(): unknown {
  let wires = 0;
  let textured = 0;
  view.shown?.traverse((node) => {
    const mesh = meshOf(node);
    if (!mesh) return;
    if ((mesh.userData as { wire?: THREE.LineSegments }).wire?.visible) {
      wires++;
    }
    if (mesh.material !== FLAT) textured++;
  });
  const entry = view.shownEntry;
  const asked = shownSettings();
  const record = asked ? view.made.get(asked.key) : undefined;
  return {
    state: view.state,
    position: view.camera?.position.toArray() ?? null,
    target: view.controls?.target.toArray() ?? null,
    stops: view.state.stops,
    askedKey: asked?.key ?? null,
    shownKey: view.state.shownKey,
    busy:
      !view.state.original &&
      !record?.entry &&
      view.failure?.key !== asked?.key,
    triangles: entry?.facts.triangles ?? null,
    textureSide: entry?.facts.textureSide ?? null,
    bytes: entry?.blob.size ?? null,
    originalBytes: view.original?.blob.size ?? null,
    wires,
    textured,
    gpu: {
      view: view.renderer ? { ...view.renderer.info.memory } : null,
      draw: renderer ? { ...renderer.info.memory } : null,
    },
  };
}

/** `task` with a failure said in words; while it runs, the controls
 *  of `sectionId`'s section are disabled and the section is busy, so
 *  a second run cannot start under the first. Afterwards only the
 *  controls it disabled are enabled again, and `refresh` (the
 *  section's own render) sets the controls it rules, such as a
 *  geometry slider with a single stop. */
const guard =
  (
    task: () => Promise<void>,
    sectionId: string,
    refresh: (() => void) | null = null,
  ) =>
  (): void => {
    const section = byId(sectionId);
    const controls = [
      ...section.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        "button, input",
      ),
    ].filter((control) => !control.disabled);
    for (const control of controls) control.disabled = true;
    section.setAttribute("aria-busy", "true");
    void task()
      .catch((error: unknown) =>
        say(
          `Failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        for (const control of controls) control.disabled = false;
        section.removeAttribute("aria-busy");
        refresh?.();
      });
  };

/** `start` for the file a file input was given, if any. */
const onFile = (id: string, start: (file: File) => void): void => {
  byId<HTMLInputElement>(id).addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) start(file);
  });
};

onFile("picture-file", (file) => {
  guard(() => showPictures(file), "pictures")();
});
byId("picture-test").addEventListener(
  "click",
  guard(async () => {
    say("Loading the sample photo...");
    await showPictures(await sample("photo"));
  }, "pictures"),
);
for (const [id, shaded] of [
  ["picture-flat", false],
  ["picture-shaded", true],
] as const) {
  byId(id).addEventListener(
    "click",
    guard(async () => {
      say("Drawing the cartoon...");
      await showPictures(await cartoonPicture(2400, 1800, shaded));
    }, "pictures"),
  );
}
onFile("sound-file", (file) => {
  guard(() => showSounds(file), "sounds")();
});
for (const name of ["speech-de", "speech-en", "piano", "orchestra"]) {
  byId(`sound-${name}`).addEventListener(
    "click",
    guard(async () => {
      say("Loading the sample sound...");
      await showSounds(await sample(name));
    }, "sounds"),
  );
}

onFile("model-file", (file) => {
  guard(() => showModels(file), "models", renderView)();
});
for (const name of ["rock", "bust", "box"]) {
  byId(`model-${name}`).addEventListener(
    "click",
    guard(
      async () => {
        say("Loading the sample model...");
        await showModels(await sampleModel(name));
      },
      "models",
      renderView,
    ),
  );
}

// For the e2e (playwright-tests/editor-asset-optimizers.spec.js).
(window as unknown as { assetOptimizerCheck: unknown }).assetOptimizerCheck = {
  bestLag,
  optimizePicture,
  optimizeSound,
  sample,
  testPicture,
  cartoonPicture,
  testSound,
  pictureSsim,
  comparePicture,
  colourShare,
  decode,
  durationMs,
  optimizeModel,
  modelFacts,
  compareModel,
  testModel,
  sampleModel,
  modelView,
};
say("Ready.");
