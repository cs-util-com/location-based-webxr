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
