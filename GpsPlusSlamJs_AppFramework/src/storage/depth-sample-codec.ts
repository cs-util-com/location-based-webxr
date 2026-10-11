/**
 * The packed depth sample (scan pass S2, plan
 * `GpsPlusSlamJs_Docs/docs/2026-10-08-0640-scan-pass-s2-binary-depth-plan.md`):
 * a recorded `recording/recordDepthSample` action whose point grid is
 * written as bytes - the g x g depths as little-endian float32, the colours
 * as one byte per channel, each base64url - inside the action's JSON, with
 * `points` written empty. A reader built before S2 therefore sees a sample
 * with no depth instead of a missing field.
 *
 * Lossless by construction: a sample is packed only when the packed form
 * holds it exactly (the sampler's full grid, float32 depths, byte colours
 * on every point or none); anything else is written as it was. The
 * recording's writer packs (`opfs-storage.ts` `writeAction`), the shared
 * parse unpacks (`zip-reader.ts` `loadActionsFromEntries`), so every reader
 * of a recording sees today's actions.
 *
 * @see depth-sample-codec.ts.md
 */

import {
  decodeBase64Url,
  encodeBase64Url,
} from '../utils/qr-payload/base64url';

/** The one action type this codec packs. */
export const DEPTH_SAMPLE_ACTION_TYPE = 'recording/recordDepthSample';

/** The largest grid side either side accepts: the largest any app
 *  records (the Recorder's setting allows 2..64; the samplers default to
 *  16 and 24). It bounds what one entry of an untrusted recording can make
 *  a reader allocate - 4 096 points (the M5d + S2 milestone review's #6);
 *  a larger grid is written as JSON, still losslessly. */
export const MAX_PACKED_GRID_SIZE = 64;

/** The packed form's version; a reader refuses any other. */
const GRID_VERSION = 1;

/** The keys a sampler point carries; a point with any other is not packed,
 *  as the packed form has no place for it. */
const POINT_KEYS = new Set(['screenX', 'screenY', 'depthM', 'rgb']);

/** A recorded action as the writer is handed it and the reader parses it. */
type Action = { readonly type: unknown; readonly payload?: unknown };

/** What the reader makes of one parsed action. */
export type UnpackResult =
  | { readonly ok: true; readonly action: unknown }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDepthAction(
  action: unknown
): action is Action & { readonly payload: Record<string, unknown> } {
  return (
    isRecord(action) &&
    action.type === DEPTH_SAMPLE_ACTION_TYPE &&
    isRecord(action.payload)
  );
}

/** The sampler's position of point `i` on a g x g grid (`depth-sampler.ts`
 *  `sampleGrid`: row-major, edges avoided). */
function screenOf(i: number, g: number): [number, number] {
  const row = Math.floor(i / g);
  const col = i % g;
  return [(col + 1) / (g + 1), (row + 1) / (g + 1)];
}

function isByte(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 255
  );
}

/** The colour of a point, or null when it has none; undefined when it has
 *  one the packed form cannot hold. */
function colourOf(point: Record<string, unknown>): number[] | null | undefined {
  const rgb = point.rgb;
  if (rgb === undefined) return null;
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(isByte)) {
    return undefined;
  }
  return rgb;
}

function isFloat32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.fround(value) === value
  );
}

/** The buffers a grid is packed into. */
interface PackedBuffers {
  readonly depths: DataView;
  readonly colours: Uint8Array;
}

/** Writes point `i` of a g x g grid into `out`: 'coloured' or 'plain' as
 *  it has a colour, null when the packed form cannot hold it exactly. */
function packPoint(
  point: unknown,
  i: number,
  g: number,
  out: PackedBuffers
): 'coloured' | 'plain' | null {
  if (!isRecord(point)) return null;
  if (Object.keys(point).some((key) => !POINT_KEYS.has(key))) return null;
  const [x, y] = screenOf(i, g);
  const depth = point.depthM;
  if (point.screenX !== x || point.screenY !== y || !isFloat32(depth)) {
    return null;
  }
  const colour = colourOf(point);
  if (colour === undefined) return null;
  // JSON writes -0 as 0; so does the packed form.
  out.depths.setFloat32(4 * i, depth === 0 ? 0 : depth, true);
  if (colour === null) return 'plain';
  out.colours.set(colour, 3 * i);
  return 'coloured';
}

/** The packed grid of `points`, or null when the packed form cannot hold
 *  them exactly (every point must, with a colour on all of them or none). */
function packGrid(points: unknown): Record<string, unknown> | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  const g = Math.round(Math.sqrt(points.length));
  if (g * g !== points.length || g > MAX_PACKED_GRID_SIZE) return null;
  const out: PackedBuffers = {
    depths: new DataView(new ArrayBuffer(4 * g * g)),
    colours: new Uint8Array(3 * g * g),
  };
  const kinds = new Set(points.map((p: unknown, i) => packPoint(p, i, g, out)));
  if (kinds.size !== 1 || kinds.has(null)) return null;
  return {
    v: GRID_VERSION,
    size: g,
    depthF32: encodeBase64Url(new Uint8Array(out.depths.buffer)),
    ...(kinds.has('coloured') ? { rgb: encodeBase64Url(out.colours) } : {}),
  };
}

/**
 * The action as the recording writes it: a depth sample whose points the
 * packed form holds exactly, packed; any other action (or sample) as it
 * is. Reads the action only (the store freezes it) and never throws - a
 * throw here would fail the write of every depth sample.
 */
export function packDepthAction(action: unknown): unknown {
  try {
    if (!isDepthAction(action)) return action;
    const grid = packGrid(action.payload.points);
    if (grid === null) return action;
    return { ...action, payload: { ...action.payload, points: [], grid } };
  } catch {
    return action;
  }
}

function isGridSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_PACKED_GRID_SIZE
  );
}

/** The `bytes` bytes a packed field encodes, or null. Its length is
 *  checked on the text before anything is decoded or allocated: base64url
 *  without padding is ceil(4 n / 3) characters. */
function decodeField(text: unknown, bytes: number): Uint8Array | null {
  if (typeof text !== 'string' || text.length !== Math.ceil((4 * bytes) / 3)) {
    return null;
  }
  return decodeBase64Url(text);
}

/** The sampler's points of a g x g grid from its decoded fields. */
function gridPoints(
  g: number,
  depthBytes: Uint8Array,
  colours: Uint8Array | null
): unknown[] {
  const depths = new DataView(
    depthBytes.buffer,
    depthBytes.byteOffset,
    depthBytes.byteLength
  );
  const points: unknown[] = [];
  for (let i = 0; i < g * g; i++) {
    const [screenX, screenY] = screenOf(i, g);
    const depthM = depths.getFloat32(4 * i, true);
    const rgb = colours?.subarray(3 * i, 3 * i + 3);
    points.push({
      screenX,
      screenY,
      depthM,
      ...(rgb ? { rgb: [...rgb] } : {}),
    });
  }
  return points;
}

/** The points of a packed grid, or the reason it cannot be read. */
function unpackGrid(grid: unknown): unknown[] | string {
  if (!isRecord(grid)) return 'the packed depth grid is not an object';
  if (grid.v !== GRID_VERSION) return 'unknown packed depth version';
  const g = grid.size;
  if (!isGridSize(g)) return 'packed depth grid size out of range';
  const depths = decodeField(grid.depthF32, 4 * g * g);
  if (depths === null) return 'packed depths are damaged (length or encoding)';
  if (grid.rgb === undefined) return gridPoints(g, depths, null);
  const colours = decodeField(grid.rgb, 3 * g * g);
  if (colours === null)
    return 'packed colours are damaged (length or encoding)';
  return gridPoints(g, depths, colours);
}

/**
 * A parsed action as every reader of a recording sees it: a packed depth
 * sample with its points back, exactly as the JSON form would have given
 * them; any other action as it is. A damaged packed grid is refused with
 * its reason (the caller skips the action, as it skips malformed JSON),
 * never thrown: a visitor's join reads a tour's recording, so the grid is
 * untrusted. A grid next to points is not one the writer makes; the
 * points are kept as written.
 */
export function unpackDepthAction(action: unknown): UnpackResult {
  if (!isDepthAction(action) || action.payload.grid === undefined) {
    return { ok: true, action };
  }
  const { grid, ...payload } = action.payload;
  const written = payload.points;
  if (Array.isArray(written) && written.length > 0) {
    return { ok: true, action: { ...action, payload } };
  }
  const points = unpackGrid(grid);
  if (typeof points === 'string') return { ok: false, reason: points };
  return { ok: true, action: { ...action, payload: { ...payload, points } } };
}
