/**
 * Batching geometry into spatial chunks so it can be culled (W20, R4-16).
 *
 * THE DEFECT THIS ADDRESSES. `buildMesh` merged every building in a fetch tile
 * into ONE `MeshData`, and the demo turned that into one `THREE.Mesh`. three
 * frustum-culls per `Object3D`, so one mesh is all-or-nothing: distance and
 * frustum culling are unavailable **by construction**. The notes noticed the
 * symptom directly — geometry three, four, five kilometres away still being
 * drawn, in a demo whose destination is AR with a 200–300 m far plane.
 *
 * The old comment in `demo-worker.ts` said as much: _"ONE merged geometry: this
 * view shows one working set at a time and is always wholly on screen… even
 * though the package's general guidance is to batch per res-8/res-9 cell."_ The
 * premise stopped being true when DEC-R2-8 grew the extent to 2.8 km.
 *
 * WHY A METRIC GRID RATHER THAN LITERAL H3 CELLS, which is a deviation from the
 * plan and worth stating. The purpose here is CULLING, not indexing: a chunk
 * only has to be a compact group of nearby geometry with a bounding box. Keying
 * on real H3 cells would need a projection back to lat/lng per piece of
 * geometry, which is a per-building round trip bought for an alignment nothing
 * downstream reads. The cell size is taken FROM the H3 ladder so the grain still
 * matches the guidance the old comment referred to.
 *
 * THE TRADE, STATED: draw calls go from one per layer to one per occupied chunk
 * per layer. At the current 2.8 km extent and a res-8 grain that is up to ~9
 * chunks; `draw-cost.ts` puts the real number in the status line so the trade is
 * measured rather than argued.
 *
 * @see chunk-meshes.ts.md
 */

import { srgbToLinear } from "./srgb.js";
import type { EnuPoint } from "./enu.js";
import { mergeMeshes } from "./extrude.js";
import type { VertexRange } from "./extrude.js";
import type { MeshData } from "./mesh-data.js";

/**
 * Chunk size in metres, from the H3 resolution ladder.
 *
 * A res-8 cell is ~920 m across; that is the grain the package's own guidance
 * names, and at the 2.8 km terrain extent it gives a 3x3-ish grid — few enough
 * draw calls to be free, coarse enough that a chunk is worth culling as a unit.
 */
export const CHUNK_SIZE_M = 920;

/** One batch of geometry, with the grid cell it belongs to. */
export interface MeshChunk {
  /** `"<col>,<row>"` in chunk units. Stable, and useful in a test failure. */
  readonly key: string;
  readonly mesh: MeshData;
  /**
   * Per-vertex RGB in 0..1, or `undefined` when the caller supplied no colours
   * (W22/W23).
   *
   * WHY THE COLOUR LIVES ON THE CHUNK AND NOT ON `MeshData`. A chunk is one draw
   * call, and the whole point of chunking is that it stays one — so a chunk
   * holding a hundred buildings of twelve different classes cannot use a
   * per-material colour without becoming a hundred draw calls. Per-vertex is the
   * only way to keep both. It is attached HERE rather than threaded through
   * `MeshBuilder` and every builder because this is the exact seam where
   * per-feature colour meets per-chunk batching, and nothing upstream needs it.
   */
  readonly colors?: Float32Array;
  /**
   * Per-vertex height within the vertex's OWN feature, 0 at its base and 1 at
   * its top. Present only when `shellRandOf` was supplied.
   *
   * **Per FEATURE, not per chunk and not above the terrain.** A `building:part`
   * starting at `min_height` reads 0 at its own base, so each part breathes over
   * its own extent rather than over the tower it belongs to. That is the right
   * behaviour for a shell effect and the wrong one for anything measuring
   * absolute height — hence the name.
   *
   * A zero-height feature (degenerate footprint, flat plate) yields 0
   * everywhere rather than a division by zero.
   */
  readonly height01?: Float32Array;
  /**
   * A stable per-feature random in 0..1, repeated on every vertex of that
   * feature. Present only when `shellRandOf` was supplied.
   *
   * Exists so a shell effect can be phase-offset per building. Without it every
   * building pulses in lockstep and the city reads as one organism.
   */
  readonly featureRand?: Float32Array;
  /**
   * One colour buffer per look, present only when `looksOf` was supplied:
   * three bytes per vertex, the sRGB codes the look paints, filled from the
   * same merge as `colors` (look 0's codes are `colors`' before any
   * conversion). A renderer decodes them with `LOOK_COLOUR_DECODE`: the
   * "linear" row for building chunks (as `linearChunkColours` converts
   * `colors`), the "raw" row for road chunks. Bytes, not floats: K looks
   * cost 3 B per vertex each, so four take what one Float32 colour takes.
   */
  readonly lookColours?: readonly Uint8Array[];
}

/**
 * What one look paints on one item: its wall colour (packed `0xrrggbb`) and
 * its roof, as `colourOf` and `roofOf` give them for a single look.
 */
export interface LookPaint {
  readonly colour: number;
  readonly roof?: RoofPaint | undefined;
}

/** Which chunk an ENU point falls in. */
export function chunkKeyFor(point: EnuPoint, sizeM = CHUNK_SIZE_M): string {
  return `${Math.floor(point.x / sizeM)},${Math.floor(point.y / sizeM)}`;
}

/**
 * Groups per-feature meshes into chunks and merges within each.
 *
 * ORDER IS PRESERVED WITHIN A CHUNK, and chunks come out in first-seen order, so
 * the result is deterministic — two runs over the same features produce the same
 * buffers. That matters because the demo's e2e suite compares rendered frames.
 *
 * An empty input produces NO chunks rather than one empty chunk: an empty
 * `BufferGeometry` in the scene is still a draw call and a disposal obligation,
 * and "the layer drew nothing" should look like nothing.
 */
export function chunkMeshes<T>(
  items: readonly T[],
  meshOf: (item: T) => MeshData,
  positionOf: (item: T) => EnuPoint,
  sizeM = CHUNK_SIZE_M,
  /**
   * Packed `0xrrggbb` per item, when the layer is coloured per feature.
   *
   * Omitted for layers that are one colour throughout — a colour buffer nobody
   * varies is bytes and a shader define bought for nothing.
   */
  colourOf?: (item: T) => number,
  /**
   * A stable 0..1 random per feature, when the layer feeds a shell shader.
   *
   * **Supplying this produces BOTH `featureRand` AND `height01`**, and the
   * bundling is deliberate rather than lazy: the AR shell shader needs the two
   * together (one for phase offset, one for the vertical term), neither has any
   * other consumer, and `height01` can only be computed HERE — after this
   * function knows each feature's own vertex range and before `mergeMeshes`
   * dissolves the boundaries between features. Splitting them into two
   * parameters would mean walking the parts twice for one effect.
   *
   * Omitted for every layer that does not draw a shell, so nobody pays the two
   * extra `Float32Array`s for bytes they never read.
   */
  shellRandOf?: (item: T) => number,
  /**
   * The item's ROOF colour and where its roof is, or `undefined` for an item
   * whose roof is its wall colour. Read only together with `colourOf`.
   *
   * A ROOF VERTEX IS ONE IN `vertexRanges`, review finding 3. The ranges are
   * the roof builder's own surfaces (`RoofMesh.surfaceVertices`), so the floor
   * of a floating part and the gable ends a roof brings with it (both outside
   * them) keep the wall colour, while an onion's lower, downward-facing half is
   * roof. Until 2026-11-07 it was "the normal points up", which drew half a
   * copper onion in the wall colour, and until M2 of the skeleton-roof plan the
   * gables were told apart by a normal epsilon.
   */
  roofOf?: (item: T) => RoofPaint | undefined,
  /**
   * Every look's paint of the item, one entry per look and the same count
   * for every item, when the layer carries K looks (`MeshChunk.lookColours`).
   * The geometry is merged ONCE and each look's buffer filled from the same
   * parts, so a vertex holds every look's colour of its own feature. Needs
   * `colourOf` (the single-look `colors`, look 0's by the caller's
   * contract); RangeError without it, or when items disagree on the count.
   */
  looksOf?: (item: T) => readonly LookPaint[],
): MeshChunk[] {
  if (looksOf !== undefined && colourOf === undefined) {
    throw new RangeError("chunkMeshes: looks need a colour function");
  }
  const partOf = (item: T, mesh: MeshData): ChunkPart => ({
    mesh,
    colour: colourOf?.(item) ?? 0xffffff,
    roof: roofOf?.(item),
    rand: shellRandOf?.(item) ?? 0,
    looks: looksOf?.(item),
  });
  let lookCount: number | undefined;
  const grouped = new Map<string, ChunkPart[]>();
  for (const item of items) {
    const mesh = meshOf(item);
    // A feature that produced no triangles must not create a chunk — see above.
    if (mesh.triangleCount === 0) continue;
    const key = chunkKeyFor(positionOf(item), sizeM);
    const list = grouped.get(key) ?? [];
    const part = partOf(item, mesh);
    list.push(part);
    lookCount = checkedLookCount(lookCount, part.looks);
    grouped.set(key, list);
  }
  return [...grouped].map(([key, parts]) => {
    const mesh = mergeMeshes(parts.map((part) => part.mesh));
    // WALKED IN THE SAME ORDER AS THE COLOUR FILL BELOW, because `mergeMeshes`
    // preserves order and that is the only thing keeping a per-vertex value on
    // the feature it belongs to.
    const shell =
      shellRandOf === undefined
        ? undefined
        : shellAttributes(parts, mesh.positions.length / 3);
    if (colourOf === undefined) {
      return shell === undefined ? { key, mesh } : { key, mesh, ...shell };
    }
    const vertexCount = mesh.positions.length / 3;
    const colors = fillColours(
      new Float32Array(vertexCount * 3),
      parts,
      (part) => part,
      BYTE_TO_UNIT,
    );
    const looks =
      lookCount === undefined
        ? {}
        : { lookColours: lookColoursOf(parts, lookCount, vertexCount) };
    return shell === undefined
      ? { key, mesh, colors, ...looks }
      : { key, mesh, colors, ...shell, ...looks };
  });
}

/**
 * The look count after one more item: the first item's count, which every
 * later item must repeat. RangeError for a different or zero count.
 */
function checkedLookCount(
  count: number | undefined,
  looks: readonly LookPaint[] | undefined,
): number | undefined {
  if (looks === undefined) return count;
  if (looks.length === 0 || (count !== undefined && looks.length !== count)) {
    throw new RangeError(
      `chunkMeshes: every item needs the same number of looks, got ${looks.length} and ${count ?? looks.length}`,
    );
  }
  return looks.length;
}

/** One sRGB byte buffer per look, filled from the same parts as `colors`. */
function lookColoursOf(
  parts: readonly ChunkPart[],
  lookCount: number,
  vertexCount: number,
): Uint8Array[] {
  return Array.from({ length: lookCount }, (_, k) =>
    fillColours(
      new Uint8Array(vertexCount * 3),
      parts,
      (part) => part.looks?.[k] ?? part,
      (byte) => byte,
    ),
  );
}

/** One item's mesh with what `chunkMeshes` paints on it. */
interface ChunkPart {
  readonly mesh: MeshData;
  readonly colour: number;
  readonly roof: RoofPaint | undefined;
  readonly rand: number;
  readonly looks: readonly LookPaint[] | undefined;
}

/** A roof colour and the vertices of the item's mesh it applies to. */
export interface RoofPaint {
  /** Packed `0xrrggbb`. */
  readonly colour: number;
  /** Half-open vertex ranges of the roof in the item's own mesh. */
  readonly vertexRanges: readonly VertexRange[];
}

/** A colour byte as the 0..1 value `colors` holds. */
const BYTE_TO_UNIT = (byte: number): number => byte / 255;

/**
 * The per-vertex colours of one chunk's parts, in merge order, into `out`
 * (three entries a vertex), each channel byte written as `encode(byte)`.
 * ONE fill for the single-look Float32 `colors` and the K look bytes, so
 * the two can never disagree on which vertex is whose.
 *
 * FLAT PER FEATURE, never interpolated across one: a building whose walls
 * faded from one class colour to its neighbour's would read as a gradient
 * someone chose. The merge preserves order, so filling in the same order is
 * what keeps a colour on the feature it belongs to. A part with a roof colour
 * paints the vertices of its roof ranges with it; ranges are
 * clamped to the part's own vertices, so a bad range cannot paint a neighbour.
 */
function fillColours<A extends Float32Array | Uint8Array>(
  out: A,
  parts: readonly ChunkPart[],
  paintOf: (part: ChunkPart) => LookPaint,
  encode: (byte: number) => number,
): A {
  let at = 0;
  for (const part of parts) {
    const count = part.mesh.positions.length / 3;
    const paint = paintOf(part);
    paintRange(out, at, 0, count, paint.colour, encode);
    const roof = paint.roof;
    for (const range of roof?.vertexRanges ?? []) {
      const from = Math.max(0, range.start);
      const to = Math.min(range.end, count);
      paintRange(out, at, from, to, roof?.colour ?? paint.colour, encode);
    }
    at += count * 3;
  }
  return out;
}

/** Writes `colour` on vertices `from`..`to` of the part at offset `at`. */
function paintRange(
  out: Float32Array | Uint8Array,
  at: number,
  from: number,
  to: number,
  colour: number,
  encode: (byte: number) => number,
): void {
  const r = encode((colour >> 16) & 0xff);
  const g = encode((colour >> 8) & 0xff);
  const b = encode(colour & 0xff);
  for (let i = from; i < to; i++) {
    const o = at + i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}

/**
 * `height01` and `featureRand` for one chunk's parts, in merge order.
 *
 * SPLIT OUT so the two loops in `chunkMeshes` stay readable, not because it is
 * reusable — it depends on the caller having the parts un-merged.
 *
 * The vertical range is taken from the part's OWN vertices (`positions[i+1]` is
 * the up axis in the render frame). A feature with no vertical extent — a flat
 * plate, a degenerate footprint — yields 0 rather than dividing by zero.
 */
function shellAttributes(
  parts: readonly { mesh: MeshData; rand: number }[],
  vertexCount: number,
): { height01: Float32Array; featureRand: Float32Array } {
  const height01 = new Float32Array(vertexCount);
  const featureRand = new Float32Array(vertexCount);
  let at = 0;
  for (const part of parts) {
    const positions = part.mesh.positions;
    const count = positions.length / 3;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const y = positions[i * 3 + 1]!;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    const span = max - min;
    for (let i = 0; i < count; i += 1) {
      height01[at] = span > 0 ? (positions[i * 3 + 1]! - min) / span : 0;
      featureRand[at] = part.rand;
      at += 1;
    }
  }
  return { height01, featureRand };
}

/**
 * The centroid of a mesh's vertices, in the RENDER frame.
 *
 * Used as a chunk key for geometry whose builder does not report a position.
 * The vertex average is not a guaranteed interior point — the same caveat
 * `buildings.ts`'s `representativePoint` records — but a chunk assignment only
 * has to be *consistent and nearby*, not exact: a building assigned to the
 * neighbouring chunk is culled with its neighbours, which is invisible.
 *
 * **`z` is negated back to ENU north** so the result can be compared with ENU
 * positions from the builders. Mixing the two frames here would scatter each
 * layer into a different set of chunks — self-consistent per layer, and
 * therefore invisible.
 */
export function meshCentroidEnu(mesh: MeshData): EnuPoint {
  const count = mesh.positions.length / 3;
  if (count === 0) return { x: 0, y: 0 };
  let x = 0;
  let z = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    x += mesh.positions[i] as number;
    z += mesh.positions[i + 2] as number;
  }
  return { x: x / count, y: -(z / count) };
}

/** sRGB byte to linear light, once per byte rather than once per vertex. */
const LINEAR_OF_BYTE = Float32Array.from({ length: 256 }, (_, i) =>
  srgbToLinear(i / 255),
);

/** Which row of `LOOK_COLOUR_DECODE` a layer's look codes take. */
export type LookColourDecode = "linear" | "raw";

/**
 * The exact decode of a look colour code, 256 x 2 Float32: entries 0..255
 * (row "linear") are sRGB to linear light, as `linearChunkColours` converts
 * building chunks; entries 256..511 (row "raw") are code / 255, as road
 * chunks keep them. A renderer uploads it as a float texture and looks a code
 * up, so a look at weight 1 draws bit for bit the fixed build's colour
 * (a uniform array would not fit: a phone has 256 uniform vectors a stage).
 */
export const LOOK_COLOUR_DECODE: Float32Array = Float32Array.from(
  { length: 512 },
  (_, i) => (i < 256 ? (LINEAR_OF_BYTE[i] ?? 0) : (i - 256) / 255),
);

/**
 * A look's codes decoded as a layer's `colors` would hold them: "linear"
 * for building chunks, "raw" for road chunks. New array; the input is kept.
 */
export function decodeLookColours(
  codes: Uint8Array,
  decode: LookColourDecode,
): Float32Array {
  if (decode !== "linear" && decode !== "raw") {
    throw new RangeError(
      `decode must be "linear" or "raw", got ${String(decode)}`,
    );
  }
  const offset = decode === "linear" ? 0 : 256;
  const out = new Float32Array(codes.length);
  for (let i = 0; i < codes.length; i++) {
    out[i] = LOOK_COLOUR_DECODE[offset + (codes[i] ?? 0)] ?? 0;
  }
  return out;
}

/**
 * The chunks with their vertex colours converted from sRGB to linear light
 * (city objects plan 2026-11-07-2315 section 7). Building chunks go through
 * it, because three.js shades in linear light and the palettes are sRGB; road
 * chunks do not, as the O3 picture the owner chose drew them raw.
 *
 * Returns new chunks with a new `colors` array and leaves the input as it
 * was, so a second call cannot convert twice. A chunk without colours is
 * passed through as is. A colour is read back to its byte first (the fill
 * writes byte / 255), so the conversion is a table lookup.
 */
export function linearChunkColours(chunks: readonly MeshChunk[]): MeshChunk[] {
  return chunks.map((chunk) => {
    const raw = chunk.colors;
    if (raw === undefined) return chunk;
    const colors = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const byte = Math.round((raw[i] ?? 0) * 255);
      colors[i] = LINEAR_OF_BYTE[byte < 0 ? 0 : byte > 255 ? 255 : byte] ?? 0;
    }
    return { ...chunk, colors };
  });
}
