/**
 * Models for the model optimizer's tests, written and read by glTF-Transform
 * (a test-only reference implementation), so the code under test never
 * checks its own writing: a fixture is made by another writer, and every
 * result is read back by another reader and judged by the Khronos glTF
 * validator. Test-only.
 */
import {
  Document,
  NodeIO,
  type Node as GltfNode,
  type Texture,
  type TypedArray,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateBytes } from "gltf-validator";

import { heightField } from "./meshes.js";

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** The repo's real scanned models (the model LOD prototype's), by name. */
export const REAL_MODELS = ["rock", "coast-rock", "boulder"] as const;

export function realModel(name: (typeof REAL_MODELS)[number]): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../../public/prototypes/model-lod-1/${name}.glb`,
          import.meta.url,
        ),
      ),
    ),
  );
}

/** The header of a JPEG and of a PNG of `width` x `height`: enough for
 *  the tour's size check and a fake device, which never decodes them. */
export function jpegHeader(width = 64, height = 32): Uint8Array {
  return Uint8Array.of(
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    17,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  );
}

export function pngHeader(width = 64, height = 32): Uint8Array {
  const out = new Uint8Array(33);
  out.set([
    0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  ]);
  const view = new DataView(out.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}

type Floats = Float32Array<ArrayBuffer>;

export interface MeshSpec {
  readonly name: string;
  readonly positions: Floats;
  readonly normals?: Floats;
  readonly tangents?: Floats;
  readonly texcoords?: Floats;
  readonly indices?: Uint32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>;
}

/** A unit-ish box of 8 corners and 12 triangles, moved by `offset`. */
export function boxSpec(name: string, offset = [0, 0, 0], size = 1): MeshSpec {
  const corners: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < 8; i++) {
    const c = [i & 1, (i >> 1) & 1, (i >> 2) & 1];
    corners.push(...c.map((v, k) => v * size + offset[k]!));
    const n = c.map((v) => v - 0.5);
    const length = Math.hypot(n[0]!, n[1]!, n[2]!);
    normals.push(...n.map((v) => v / length));
    uvs.push(c[0]!, c[1]! * 0.5 + c[2]! * 0.25);
  }
  const faces = [
    [0, 1, 3],
    [0, 3, 2],
    [4, 6, 7],
    [4, 7, 5],
    [0, 4, 5],
    [0, 5, 1],
    [2, 3, 7],
    [2, 7, 6],
    [0, 2, 6],
    [0, 6, 4],
    [1, 5, 7],
    [1, 7, 3],
  ].flat();
  return {
    name,
    positions: Float32Array.from(corners),
    normals: Float32Array.from(normals),
    texcoords: Float32Array.from(uvs),
    indices: Uint32Array.from(faces),
  };
}

/** A textureless bumpy height field of `2 n²` triangles (4608 at the
 *  default 48, above the level-of-detail floor): geometry only, so a
 *  saved chain's index lists weigh most against the file's bytes. Its
 *  index list is 16-bit when `indices16`. */
export async function bumpyField(
  n = 48,
  indices16 = false,
): Promise<Uint8Array> {
  const mesh = heightField(
    n,
    (u, v) =>
      0.08 * Math.sin(7 * u) * Math.cos(5 * v) + 0.02 * Math.sin(23 * u),
  );
  return buildModel({
    meshes: [
      {
        name: "field",
        positions: mesh.positions as Float32Array<ArrayBuffer>,
        normals: mesh.normals as Float32Array<ArrayBuffer>,
        texcoords: mesh.uvs as Float32Array<ArrayBuffer>,
        indices: indices16
          ? Uint16Array.from(mesh.indices)
          : (mesh.indices as Uint32Array<ArrayBuffer>),
      },
    ],
  });
}

export interface ModelSpec {
  readonly meshes: readonly MeshSpec[];
  /** Material textures to add to every primitive. */
  readonly baseColor?: "jpeg" | "png";
  readonly normalMap?: "jpeg" | "png";
  readonly alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  /** Each texture's width and height (64 x 32 when left out). */
  readonly textureSize?: readonly [number, number];
  /** Each mesh's node transform. */
  readonly transform?: {
    readonly translation: [number, number, number];
    readonly rotation: [number, number, number, number];
    readonly scale: [number, number, number];
  };
  /** Draw mesh 0 from a second node too. */
  readonly instanceTwice?: boolean;
  /** Mesh 1 reuses mesh 0's position accessor. */
  readonly sharePositions?: boolean;
  readonly skinned?: boolean;
  readonly morphed?: boolean;
  readonly animated?: boolean;
}

function accessor(
  doc: Document,
  type: "VEC2" | "VEC3" | "VEC4" | "SCALAR",
  array: TypedArray,
) {
  return doc
    .createAccessor()
    .setType(type)
    .setArray(array)
    .setBuffer(doc.getRoot().listBuffers()[0]!);
}

function texture(
  doc: Document,
  kind: "jpeg" | "png",
  [w, h]: readonly [number, number],
): Texture {
  return doc
    .createTexture()
    .setMimeType(kind === "jpeg" ? "image/jpeg" : "image/png")
    .setImage(kind === "jpeg" ? jpegHeader(w, h) : pngHeader(w, h));
}

function addMaterial(doc: Document, spec: ModelSpec) {
  const material = doc
    .createMaterial("m")
    .setAlphaMode(spec.alphaMode ?? "OPAQUE");
  const size = spec.textureSize ?? [64, 32];
  if (spec.baseColor)
    material.setBaseColorTexture(texture(doc, spec.baseColor, size));
  if (spec.normalMap)
    material.setNormalTexture(texture(doc, spec.normalMap, size));
  return material;
}

function addSkin(doc: Document, node: GltfNode, count: number): void {
  const joint = doc.createNode("joint");
  node.addChild(joint);
  const skin = doc
    .createSkin()
    .addJoint(joint)
    .setInverseBindMatrices(
      accessor(doc, "SCALAR", new Float32Array(16))
        .setType("MAT4")
        .setArray(
          Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        ),
    );
  node.setSkin(skin);
  const prim = node.getMesh()!.listPrimitives()[0]!;
  prim.setAttribute(
    "JOINTS_0",
    accessor(doc, "VEC4", new Uint8Array(count * 4)),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  prim.setAttribute("WEIGHTS_0", accessor(doc, "VEC4", weights));
}

/** A model written by glTF-Transform to `spec`. */
export async function buildModel(spec: ModelSpec): Promise<Uint8Array> {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene();
  const material = addMaterial(doc, spec);
  let firstPositions = null as ReturnType<typeof accessor> | null;
  const nodes = spec.meshes.map((m, i) => {
    const positions =
      spec.sharePositions === true && i === 1 && firstPositions !== null
        ? firstPositions
        : accessor(doc, "VEC3", m.positions);
    firstPositions ??= positions;
    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", positions)
      .setMaterial(material);
    if (m.normals)
      prim.setAttribute("NORMAL", accessor(doc, "VEC3", m.normals));
    if (m.tangents)
      prim.setAttribute("TANGENT", accessor(doc, "VEC4", m.tangents));
    if (m.texcoords)
      prim.setAttribute("TEXCOORD_0", accessor(doc, "VEC2", m.texcoords));
    if (m.indices) prim.setIndices(accessor(doc, "SCALAR", m.indices));
    if (spec.morphed === true && i === 0) {
      prim.addTarget(
        doc
          .createPrimitiveTarget()
          .setAttribute(
            "POSITION",
            accessor(doc, "VEC3", new Float32Array(m.positions.length)),
          ),
      );
    }
    const node = doc
      .createNode(`node-${m.name}`)
      .setMesh(doc.createMesh(m.name).addPrimitive(prim));
    if (spec.transform) {
      node
        .setTranslation(spec.transform.translation)
        .setRotation(spec.transform.rotation)
        .setScale(spec.transform.scale);
    }
    scene.addChild(node);
    return node;
  });
  if (spec.instanceTwice === true) {
    scene.addChild(
      doc
        .createNode("again")
        .setMesh(nodes[0]!.getMesh())
        .setTranslation([5, 0, 0]),
    );
  }
  if (spec.skinned === true)
    addSkin(doc, nodes[0]!, spec.meshes[0]!.positions.length / 3);
  if (spec.animated === true) {
    const sampler = doc
      .createAnimationSampler()
      .setInput(accessor(doc, "SCALAR", Float32Array.of(0, 1)))
      .setOutput(accessor(doc, "VEC3", Float32Array.of(0, 0, 0, 0, 1, 0)));
    doc
      .createAnimation("move")
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(nodes[0]!)
          .setTargetPath("translation")
          .setSampler(sampler),
      );
  }
  return io.writeBinary(doc);
}

/** The bending tube's shape: an open tube of radius 0.2 along y from 0 to
 *  2, `rings` rings of `segments` vertices (plus a texture seam copy),
 *  bound to two bones, one at y = 0 and one at the bend, y = 1. */
const TUBE = { radius: 0.2, length: 2, bend: 1 } as const;

/** The upper bone's weight at height `y`: 0 below the bend's band
 *  (0.8 to 1.2), 1 above it, smooth in between. */
function tubeWeight(y: number): number {
  const u = Math.min(1, Math.max(0, (y - 0.8) / 0.4));
  return u * u * (3 - 2 * u);
}

/** The tube as a plain mesh, its straight sides at rest. */
export function tubeSpec(rings = 41, segments = 16): MeshSpec {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let r = 0; r < rings; r++) {
    const y = (TUBE.length * r) / (rings - 1);
    for (let s = 0; s <= segments; s++) {
      const a = (2 * Math.PI * s) / segments;
      positions.push(TUBE.radius * Math.cos(a), y, TUBE.radius * Math.sin(a));
      normals.push(Math.cos(a), 0, Math.sin(a));
      uvs.push(s / segments, r / (rings - 1));
    }
  }
  const indices: number[] = [];
  const side = segments + 1;
  for (let r = 0; r + 1 < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * side + s;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    name: "tube",
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    texcoords: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}

/** `positions` of the tube bent by `degrees` about z at the bend, by a
 *  linear blend of the two bones written here independently of the code
 *  under test (the weights are a function of height, so it poses any
 *  subset of the tube's vertices). */
export function bendTube(
  positions: Float32Array,
  degrees: number,
): Float32Array {
  const a = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
    const w = tubeWeight(y);
    const dy = y - TUBE.bend;
    const rx = c * x - s * dy;
    const ry = s * x + c * dy + TUBE.bend;
    out[i] = (1 - w) * x + w * rx;
    out[i + 1] = (1 - w) * y + w * ry;
    out[i + 2] = z;
  }
  return out;
}

/**
 * The tube as a skinned model: a root bone at the origin and an upper
 * bone at the bend (its child), the tube's node bound to both, and, with
 * `clip`, a 1 s clip "bend" turning the upper bone about z through
 * `degrees` (0, 45 and 90 when left out), keys evenly spaced, linear
 * unless `interpolation` says otherwise (a cubic spline's tangents are
 * 0). Synthetic: two bones, one clip, a smooth
 * cylinder; a real character has many bones, several clips and weights
 * over four joints.
 *
 * With `units: "cm"` the tube is stored in centimetres under a root bone
 * scaled by 0.01, as many character exports are: posed, it stands as
 * large as the metre tube. With `door`, a clip moves a node no skin
 * reads (a door beside the character). With `rigid`, each vertex follows one
 * bone alone (the lower one up to the bend, the upper one above it) and
 * names it first, as exporters sort joints by weight: every vertex then
 * has weights [1, 0, 0, 0], and only its joints say which bone it
 * follows.
 */
export async function bendingTube(options: {
  readonly clip: boolean;
  readonly degrees?: readonly number[];
  readonly interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
  readonly units?: "m" | "cm";
  readonly door?: boolean;
  readonly rigid?: boolean;
  /** The tube's rings and segments (`tubeSpec`'s defaults when left out). */
  readonly rings?: number;
  readonly segments?: number;
}): Promise<Uint8Array> {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene();
  const spec = tubeSpec(options.rings, options.segments);
  const unit = options.units === "cm" ? 100 : 1;
  const prim = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      accessor(
        doc,
        "VEC3",
        spec.positions.map((v) => v * unit),
      ),
    )
    .setAttribute("NORMAL", accessor(doc, "VEC3", spec.normals!))
    .setAttribute("TEXCOORD_0", accessor(doc, "VEC2", spec.texcoords!))
    .setIndices(accessor(doc, "SCALAR", spec.indices!))
    .setMaterial(doc.createMaterial("m"));
  const count = spec.positions.length / 3;
  const joints = new Uint8Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const y = spec.positions[3 * i + 1]!;
    if (options.rigid === true) {
      joints.set([y > TUBE.bend + 1e-6 ? 1 : 0, 0, 0, 0], 4 * i);
      weights.set([1, 0, 0, 0], 4 * i);
    } else {
      const w = tubeWeight(y);
      joints.set([0, 1, 0, 0], 4 * i);
      weights.set([1 - w, w, 0, 0], 4 * i);
    }
  }
  prim.setAttribute("JOINTS_0", accessor(doc, "VEC4", joints));
  prim.setAttribute("WEIGHTS_0", accessor(doc, "VEC4", weights));
  const root = doc
    .createNode("root-bone")
    .setScale([1 / unit, 1 / unit, 1 / unit]);
  const upper = doc
    .createNode("upper-bone")
    .setTranslation([0, TUBE.bend * unit, 0]);
  root.addChild(upper);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const upperInverse = [...identity];
  upperInverse[13] = -TUBE.bend * unit;
  const skin = doc
    .createSkin()
    .addJoint(root)
    .addJoint(upper)
    .setSkeleton(root)
    .setInverseBindMatrices(
      accessor(
        doc,
        "SCALAR",
        Float32Array.from([...identity, ...upperInverse]),
      ).setType("MAT4"),
    );
  const node = doc
    .createNode("tube")
    .setMesh(doc.createMesh("tube").addPrimitive(prim))
    .setSkin(skin);
  scene.addChild(root).addChild(node);
  if (options.door === true) {
    const door = doc.createNode("door");
    scene.addChild(door);
    const sampler = doc
      .createAnimationSampler()
      .setInput(accessor(doc, "SCALAR", Float32Array.of(0, 1)))
      .setOutput(accessor(doc, "VEC3", Float32Array.of(0, 0, 0, 1, 0, 0)));
    doc
      .createAnimation("open")
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(door)
          .setTargetPath("translation")
          .setSampler(sampler),
      );
  }
  if (options.clip) {
    const quarter = (deg: number) => {
      const h = (deg * Math.PI) / 360;
      return [0, 0, Math.sin(h), Math.cos(h)];
    };
    const degrees = options.degrees ?? [0, 45, 90];
    const interpolation = options.interpolation ?? "LINEAR";
    const keys = degrees.map((d) =>
      interpolation === "CUBICSPLINE"
        ? [0, 0, 0, 0, ...quarter(d), 0, 0, 0, 0]
        : quarter(d),
    );
    const sampler = doc
      .createAnimationSampler()
      .setInput(
        accessor(
          doc,
          "SCALAR",
          Float32Array.from(degrees, (_, k) => k / (degrees.length - 1)),
        ),
      )
      .setOutput(accessor(doc, "VEC4", Float32Array.from(keys.flat())))
      .setInterpolation(interpolation);
    doc
      .createAnimation("bend")
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(upper)
          .setTargetPath("rotation")
          .setSampler(sampler),
      );
  }
  return io.writeBinary(doc);
}

/** Each drawn primitive's positions in world space, per mesh name, as
 *  glTF-Transform reads them (normalized integers turned back into their
 *  values, node transforms applied). Instances of one mesh are sorted so
 *  two files compare whatever their node order. */
export async function worldPositions(
  bytes: Uint8Array,
): Promise<Map<string, Float64Array[]>> {
  const doc = await io.readBinary(bytes);
  const out = new Map<string, Float64Array[]>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION")!;
      const points = new Float64Array(position.getCount() * 3);
      const p: number[] = [];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p);
        for (let r = 0; r < 3; r++) {
          points[i * 3 + r] =
            m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!;
        }
      }
      out.set(mesh.getName(), [...(out.get(mesh.getName()) ?? []), points]);
    }
  }
  for (const list of out.values())
    list.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
  return out;
}

/** The largest distance between matching points of two `worldPositions`,
 *  and the largest diagonal of a mesh's box; throws when the meshes or
 *  point counts differ. */
export function largestShift(
  before: Map<string, Float64Array[]>,
  after: Map<string, Float64Array[]>,
): { shift: number; diagonal: number } {
  if ([...before.keys()].sort().join() !== [...after.keys()].sort().join()) {
    throw new Error("the meshes differ");
  }
  let shift = 0;
  let diagonal = 0;
  for (const [name, list] of before) {
    const other = after.get(name)!;
    if (other.length !== list.length)
      throw new Error(`${name}: instance count`);
    list.forEach((points, k) => {
      const moved = other[k]!;
      if (moved.length !== points.length)
        throw new Error(`${name}: point count`);
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < points.length; i += 3) {
        let d = 0;
        for (let c = 0; c < 3; c++) {
          d += (points[i + c]! - moved[i + c]!) ** 2;
          lo[c] = Math.min(lo[c]!, points[i + c]!);
          hi[c] = Math.max(hi[c]!, points[i + c]!);
        }
        shift = Math.max(shift, Math.sqrt(d));
      }
      diagonal = Math.max(
        diagonal,
        Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!),
      );
    });
  }
  return { shift, diagonal };
}

/** The Khronos validator's errors for `bytes` (warnings and infos are
 *  not failures; an unused object is an info). Images are not decoded:
 *  the fakes are no real pictures. */
export async function validatorErrors(bytes: Uint8Array): Promise<string[]> {
  const report = await validateBytes(bytes, {
    ignoredIssues: ["IMAGE_UNRECOGNIZED_FORMAT", "IMAGE_DATA_INVALID"],
  });
  return report.issues.messages
    .filter((m) => m.severity === 0)
    .map((m) => `${m.code} ${m.pointer ?? ""} ${m.message}`);
}
