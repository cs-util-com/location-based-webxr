/**
 * A code's automatic-move memory on its level file (code book plan, M6
 * v5.1): the spot an automatic move left and the spots holding a second
 * print, as the optional `qr.spots` next to the level's own pose. Visitors'
 * parser (`parseQrLevel`) drops the field, so only the Tour Viewer's
 * authoring reads it, and it reads it LENIENTLY: a damaged entry is dropped,
 * never a reason to reject the level. Every re-mint of a stored code goes
 * through `remintedLevel` (`visit-settle.ts`), which carries it with
 * {@link carryCodeSpots}.
 *
 * @see level-spots.ts.md
 */

import {
  parseQrLevel,
  type QrMintQuality,
} from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import type { CodeSpotMemory } from "./code-spots.js";

/** One known spot: its pose and, when it was minted, its quality. */
export interface StoredSpot {
  readonly geo: QrGeoPose;
  readonly mintQuality?: QrMintQuality;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored spot validated by the level's own rules; its quality is dropped
 *  alone when only the quality is broken; null when the pose is. */
function spotOf(value: unknown): StoredSpot | null {
  if (!isRecord(value)) return null;
  const parse = (qr: Record<string, unknown>) =>
    parseQrLevel({ version: 1, qr }).qr;
  try {
    const qr = parse({ geo: value["geo"], mintQuality: value["mintQuality"] });
    return qr.geo === undefined ? null : asSpot(qr.geo, qr.mintQuality);
  } catch {
    try {
      const qr = parse({ geo: value["geo"] });
      return qr.geo === undefined ? null : { geo: qr.geo };
    } catch {
      return null;
    }
  }
}

const asSpot = (
  geo: QrGeoPose,
  mintQuality: QrMintQuality | undefined,
): StoredSpot => (mintQuality === undefined ? { geo } : { geo, mintQuality });

/** The level's JSON object, or null when it is not one. */
function objectOf(
  json: string,
): ({ qr: Record<string, unknown> } & Record<string, unknown>) | null {
  try {
    const data = JSON.parse(json) as unknown;
    return isRecord(data) && isRecord(data["qr"])
      ? (data as { qr: Record<string, unknown> } & Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The code's known spots: the level's own pose as the current one, plus the
 * remembered `previous` and `copies`. Null when the level has no saved pose
 * or does not parse as a level.
 */
export function readCodeSpots(json: string): CodeSpotMemory<StoredSpot> | null {
  const data = objectOf(json);
  if (data === null) return null;
  let current: StoredSpot;
  try {
    const qr = parseQrLevel(data).qr;
    if (qr.geo === undefined) return null;
    current = asSpot(qr.geo, qr.mintQuality);
  } catch {
    return null;
  }
  const spots = data.qr["spots"];
  const raw = isRecord(spots) ? spots : {};
  const copies = Array.isArray(raw["copies"]) ? raw["copies"] : [];
  return {
    current,
    previous: spotOf(raw["previous"]),
    copies: copies.flatMap((c: unknown) => {
      const s = spotOf(c);
      return s === null ? [] : [s];
    }),
  };
}

/** `qr.spots` for a memory, or undefined when it remembers nothing. */
function spotsField(
  memory: Pick<CodeSpotMemory<StoredSpot>, "previous" | "copies">,
): Record<string, unknown> | undefined {
  if (memory.previous === null && memory.copies.length === 0) return undefined;
  return {
    ...(memory.previous === null ? {} : { previous: memory.previous }),
    ...(memory.copies.length === 0 ? {} : { copies: memory.copies }),
  };
}

/** The `qr` fields a memory writes: the current spot and the rest. */
const SPOT_KEYS = new Set(["geo", "mintQuality", "spots"]);

/** `json` with `qr` updated; every other field kept as it was. */
function withQr(
  data: { qr: Record<string, unknown> } & Record<string, unknown>,
  qr: Record<string, unknown>,
): string {
  return JSON.stringify({ ...data, qr });
}

/**
 * The level `json` holding `memory`: its current spot as the level's pose and
 * quality (a quality the spot lacks is removed), the rest as `qr.spots`
 * (removed when empty). The printed size and the content stay as they were.
 *
 * @throws SyntaxError when `json` is not a level object
 */
export function writeCodeSpots(
  json: string,
  memory: CodeSpotMemory<StoredSpot>,
): string {
  const data = objectOf(json);
  if (data === null) throw new SyntaxError("not a level file");
  const rest = Object.fromEntries(
    Object.entries(data.qr).filter(([k]) => !SPOT_KEYS.has(k)),
  );
  const spots = spotsField(memory);
  return withQr(data, {
    ...rest,
    geo: memory.current.geo,
    ...(memory.current.mintQuality === undefined
      ? {}
      : { mintQuality: memory.current.mintQuality }),
    ...(spots === undefined ? {} : { spots }),
  });
}

/**
 * The freshly minted level `toJson` with the memory of the level it replaces
 * (`fromJson`): the one seam every re-mint of a stored code goes through.
 * Returns `toJson` itself when there is nothing to carry.
 */
export function carryCodeSpots(fromJson: string, toJson: string): string {
  const from = readCodeSpots(fromJson);
  const spots = from === null ? undefined : spotsField(from);
  const to = objectOf(toJson);
  if (spots === undefined || to === null) return toJson;
  return withQr(to, { ...to.qr, spots });
}
