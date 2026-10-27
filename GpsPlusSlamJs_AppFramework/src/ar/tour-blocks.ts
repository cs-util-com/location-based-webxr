/**
 * A station's BLOCKS in `tour.json` version 4: one list of the things a
 * station shows - a short text, a long text, a picture, a video, a sound, a
 * 3D model, a character - each its data (the model), the creator's choice
 * of how it looks (the view) and where it stands (a local pose in the
 * station's frame). A block no story step shows is FREE: it stands in the
 * world while its station is shown, so its view must be a world view. A
 * block a `show` step names is a STORY block (`tour-story.ts`).
 *
 * Caps are counted ONE way, by {@link tourTextCount}, which the editor's
 * counters reuse: Unicode code points after trimming and collapsing every
 * whitespace run to one space, except a long text's body, counted in
 * UTF-16 units as written. A required text over its cap fails the file; an
 * optional one is left out and reported (the tour details' rule). Readers
 * keep every text exactly as written: only the count ignores whitespace.
 *
 * Defensive by the rule of `tour-manifest.ts`: hand-editable data, every
 * field checked at the boundary, every media reference resolved here (an
 * asset of the right kind), so a renderer never meets a dangling id.
 *
 * LENIENT for a NEWER MINOR: a later minor may add kinds, views and
 * fields, or widen a cap. Read from such a file, a block of an unknown
 * kind, naming an asset this reader does not have, or breaking a rule a
 * later minor may relax is skipped and reported, never failing the tour; a
 * block in an unknown view falls back to the kind's floor view
 * ({@link tourFloorView}): `card` for a story block, the kind's world view
 * for a free one, and a free block with no world view this reader draws is
 * skipped and reported. Structural faults (an id, a pose) fail at every
 * minor: no revision can make them valid.
 *
 * @see tour-blocks.ts.md
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import type { TourAsset, TourAssetKind } from './tour-assets.js';
import {
  assertUniqueTourIds,
  requireTourId,
  type TourFail,
} from './tour-fields.js';
import { parseTourLocalPose, type TourLocalPose } from './tour-items.js';

type Fail = TourFail;

/** What a block is. */
export type TourBlockKind =
  | 'shortText'
  | 'longText'
  | 'picture'
  | 'video'
  | 'audio'
  | 'model'
  | 'character';

/** The views this reader draws, per kind. A view joins the format with its
 *  renderer; `card` (the block in the scene card) exists for every kind. */
export const TOUR_BLOCK_VIEWS = {
  shortText: ['pin', 'card'],
  longText: ['card'],
  picture: ['plane', 'card'],
  video: ['card'],
  audio: ['card'],
  model: ['placed', 'stage', 'card'],
  character: ['stage', 'card'],
} as const satisfies Record<TourBlockKind, readonly string[]>;

type ViewOf<K extends TourBlockKind> = (typeof TOUR_BLOCK_VIEWS)[K][number];

/** The views a FREE block may stand in: drawn in the world for as long as
 *  its station is shown. `card` opens only when a step shows it, and a
 *  `stage` figure lives only while a story runs. */
const WORLD_VIEWS: ReadonlySet<string> = new Set(['pin', 'plane', 'placed']);

/** How a text cap is counted. */
export type TourTextUnit = 'codePoints' | 'utf16';

/** One text field's rule: its cap, the unit it is counted in, and whether
 *  the block needs it (required: fails the file when blank or over;
 *  optional: blank is absent, over is left out and reported). */
export interface TourTextRule {
  readonly max: number;
  readonly unit: TourTextUnit;
  readonly required: boolean;
}

const required = (max: number, unit: TourTextUnit = 'codePoints') =>
  ({ max, unit, required: true }) as const;
const optional = (max: number) =>
  ({ max, unit: 'codePoints', required: false }) as const;

/** Every capped text of every kind. */
export const TOUR_BLOCK_TEXT_RULES = {
  shortText: { caption: required(40), description: optional(160) },
  longText: { title: required(80), body: required(32_000, 'utf16') },
  picture: { title: optional(40), caption: optional(1200), alt: optional(300) },
  video: { title: optional(40), transcript: required(32_000) },
  audio: { title: optional(40), transcript: required(32_000) },
  model: { title: optional(80) },
  character: { name: required(80), caption: required(2000) },
} as const satisfies Record<TourBlockKind, Record<string, TourTextRule>>;

/**
 * A placed model's size: the scaled model's largest side (m), inclusive.
 * "Largest side" is measured ONE way, by every renderer and the editor:
 * the axis-aligned box of the glTF's default scene at rest pose, node
 * transforms included, in the glb's own units (glTF metres), before the
 * block's own rotation - the largest of its three extents. The scale
 * factor is `sizeM` over that length. A size, not a factor: a factor's
 * sensible range would depend on the model's own size.
 */
export const TOUR_MODEL_MIN_SIZE_M = 0.05;
export const TOUR_MODEL_MAX_SIZE_M = 500;

/** A picture's width in the world (m), inclusive. */
export const TOUR_PICTURE_MIN_WIDTH_M = 0.05;
export const TOUR_PICTURE_MAX_WIDTH_M = 50;

interface TourBlockEnvelope<K extends TourBlockKind> {
  /** Short path-safe id, unique among the tour's blocks (asset ids are a
   *  namespace of their own). */
  readonly id: string;
  readonly kind: K;
  readonly view: ViewOf<K>;
  /** Where it stands in its station's frame; views that do not use it
   *  (`card`, `stage`) ignore it. */
  readonly pose: TourLocalPose;
  /** When it was made, for the editor's ordering. */
  readonly createdAtIso?: string;
}

export interface TourShortTextBlock extends TourBlockEnvelope<'shortText'> {
  readonly caption: string;
  readonly description?: string;
}

export interface TourLongTextBlock extends TourBlockEnvelope<'longText'> {
  readonly title: string;
  /** The text's source, counted in UTF-16 units. */
  readonly body: string;
}

export interface TourPictureBlock extends TourBlockEnvelope<'picture'> {
  /** An image asset. */
  readonly image: string;
  readonly title?: string;
  readonly caption?: string;
  /** A plain description for a visitor who cannot see it. */
  readonly alt?: string;
  /** Its width in the world, in metres. */
  readonly widthM: number;
}

export interface TourVideoBlock extends TourBlockEnvelope<'video'> {
  /** A video asset. */
  readonly video: string;
  /** Its words, for a visitor who cannot hear it. */
  readonly transcript: string;
  readonly title?: string;
  /** An image asset shown while the clip waits. */
  readonly poster?: string;
}

export interface TourAudioBlock extends TourBlockEnvelope<'audio'> {
  /** An audio asset. */
  readonly audio: string;
  readonly transcript: string;
  readonly title?: string;
}

export interface TourModelBlock extends TourBlockEnvelope<'model'> {
  /** A model asset. */
  readonly asset: string;
  /** The scaled model's largest side in metres: required to place it,
   *  refused on the stage (mounted at its file's own size). */
  readonly sizeM?: number;
  readonly title?: string;
}

export interface TourCharacterBlock extends TourBlockEnvelope<'character'> {
  readonly name: string;
  /** A cut-out image asset. */
  readonly image: string;
  /** Captions always: what the character says, as text. */
  readonly caption: string;
  /** An optional voice clip (an audio asset). */
  readonly voice?: string;
}

export type TourBlock =
  | TourShortTextBlock
  | TourLongTextBlock
  | TourPictureBlock
  | TourVideoBlock
  | TourAudioBlock
  | TourModelBlock
  | TourCharacterBlock;

export type TourBlockView = TourBlock['view'];

/** What a reader left out: one field of a block, or a whole block it
 *  cannot show (a newer minor's). */
export type TourBlockDrop =
  | {
      readonly kind: 'field';
      readonly block: string;
      readonly field: string;
      readonly reason: string;
    }
  | { readonly kind: 'block'; readonly block: string; readonly reason: string };

/** A block as read, before its station's story says whether it is free:
 *  `knownView` false when its view is one this reader does not know (a
 *  newer minor's); `block.view` is then `card` until it is placed. */
export interface TourBlockRead {
  readonly block: TourBlock;
  readonly knownView: boolean;
}

/** How `tour-blocks` reads: the tour's assets, the caller's `fail`, a newer
 *  minor (`lenient`), and who hears what was left out. */
export interface TourBlocksReadOptions {
  readonly assets: readonly TourAsset[];
  readonly fail: Fail;
  readonly lenient?: boolean;
  readonly onDropped?: (drop: TourBlockDrop) => void;
}

/**
 * The count every cap is checked against, and every editor counter shows:
 * code points after trimming and collapsing each whitespace run to one
 * space (`codePoints`), or UTF-16 units exactly as written (`utf16`, the
 * long text body). A combining mark is a code point of its own; a
 * surrogate pair is one code point and two UTF-16 units.
 */
export function tourTextCount(
  text: string,
  unit: TourTextUnit = 'codePoints'
): number {
  if (unit === 'utf16') return text.length;
  return [...text.trim().replace(/\s+/gu, ' ')].length;
}

/** A text checked against its rule: the value as written, or why not
 *  (`blank` when it has nothing to count). */
export type TourBlockTextCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string; readonly blank?: true };

/** Whether `value` passes `rule`; never throws. */
export function checkTourBlockText(
  rule: TourTextRule,
  value: unknown
): TourBlockTextCheck {
  if (typeof value !== 'string') return { ok: false, reason: 'must be text' };
  if (value.trim() === '')
    return { ok: false, reason: 'is empty', blank: true };
  if (tourTextCount(value, rule.unit) > rule.max) {
    const unit = rule.unit === 'utf16' ? 'UTF-16 units' : 'characters';
    return {
      ok: false,
      reason: `is longer than ${String(rule.max)} ${unit}`,
    };
  }
  return { ok: true, value };
}

/**
 * The view a block falls back to when this reader does not know its own: a
 * story block's is `card`; a free block's is its kind's world view, or
 * null when this reader draws none for that kind (the block is skipped).
 */
export function tourFloorView(
  kind: TourBlockKind,
  placement: 'free' | 'story'
): TourBlockView | null {
  if (placement === 'story') return 'card';
  return FREE_FLOOR[kind];
}

const FREE_FLOOR: Record<TourBlockKind, TourBlockView | null> = {
  shortText: 'pin',
  longText: null,
  picture: 'plane',
  video: null,
  audio: null,
  model: 'placed',
  character: null,
};

/** Thrown inside one block's read when a lenient reader cannot show it;
 *  caught per block. Never escapes this module. */
class SkippedBlock extends Error {}

interface BlockContext {
  readonly at: string;
  readonly id: string;
  readonly assets: ReadonlyMap<string, TourAssetKind>;
  readonly fail: Fail;
  readonly lenient: boolean;
  readonly onDropped: ((drop: TourBlockDrop) => void) | undefined;
}

/** A rule a later minor may relax: skips the block for a lenient reader,
 *  fails the file for a strict one. */
function problem(ctx: BlockContext, message: string): never {
  if (ctx.lenient) throw new SkippedBlock(message);
  return ctx.fail(message);
}

type Fields = Readonly<Record<string, unknown>>;

function requiredText(
  v: Fields,
  field: string,
  rule: TourTextRule,
  ctx: BlockContext
): string {
  const checked = checkTourBlockText(rule, v[field]);
  if (checked.ok) return checked.value;
  return problem(ctx, `"${ctx.at}.${field}" ${checked.reason}`);
}

/** An optional text: absent when absent or blank; left out and reported
 *  (at this reader's own minor) when it breaks its rule. */
function optionalText<F extends string>(
  v: Fields,
  field: F,
  rule: TourTextRule,
  ctx: BlockContext
): Partial<Record<F, string>> {
  const value = v[field];
  if (value === undefined) return {};
  const checked = checkTourBlockText(rule, value);
  if (checked.ok) return { [field]: checked.value } as Record<F, string>;
  if (checked.blank !== true && !ctx.lenient) {
    ctx.onDropped?.({
      kind: 'field',
      block: ctx.id,
      field,
      reason: `"${ctx.at}.${field}" ${checked.reason}`,
    });
  }
  return {};
}

function assetRef(
  v: Fields,
  field: string,
  kind: TourAssetKind,
  ctx: BlockContext
): string {
  const value = v[field];
  if (typeof value === 'string' && ctx.assets.get(value) === kind) {
    return value;
  }
  const article = kind === 'image' || kind === 'audio' ? 'an' : 'a';
  return problem(
    ctx,
    `"${ctx.at}.${field}" must name ${article} ${kind} asset`
  );
}

function optionalAssetRef<F extends string>(
  v: Fields,
  field: F,
  kind: TourAssetKind,
  ctx: BlockContext
): Partial<Record<F, string>> {
  if (v[field] === undefined) return {};
  return { [field]: assetRef(v, field, kind, ctx) } as Record<F, string>;
}

/** A size in metres within `[min, max]`. Not a positive finite number
 *  fails at every minor (no revision makes it a size); outside the bound
 *  is a rule a later minor may widen. */
function metres(
  value: unknown,
  at: string,
  bounds: readonly [number, number],
  ctx: BlockContext
): number {
  const [min, max] = bounds;
  const message = `"${at}" must be a number of metres from ${String(min)} to ${String(max)}`;
  if (!isFiniteNumber(value) || value <= 0) return ctx.fail(message);
  if (value < min || value > max) return problem(ctx, message);
  return value;
}

/** A model's size by its view: required to place it, refused on the
 *  stage, optional in a card or a view this reader does not know. */
function modelSize(
  v: Fields,
  view: string | null,
  ctx: BlockContext
): { sizeM?: number } {
  if (v.sizeM === undefined) {
    if (view !== 'placed') return {};
    return problem(ctx, `"${ctx.at}.sizeM" is required for a placed model`);
  }
  if (view === 'stage') {
    return problem(
      ctx,
      `"${ctx.at}.sizeM" is only for a placed model: a staged one is shown at its file's own size`
    );
  }
  const bounds = [TOUR_MODEL_MIN_SIZE_M, TOUR_MODEL_MAX_SIZE_M] as const;
  return { sizeM: metres(v.sizeM, `${ctx.at}.sizeM`, bounds, ctx) };
}

type KindFields = (v: Fields, view: string | null, ctx: BlockContext) => Fields;

const rules = TOUR_BLOCK_TEXT_RULES;

/** Each kind's own fields, read in the order a writer writes them. */
const KIND_FIELDS: Record<TourBlockKind, KindFields> = {
  shortText: (v, _view, ctx) => ({
    caption: requiredText(v, 'caption', rules.shortText.caption, ctx),
    ...optionalText(v, 'description', rules.shortText.description, ctx),
  }),
  longText: (v, _view, ctx) => ({
    title: requiredText(v, 'title', rules.longText.title, ctx),
    body: requiredText(v, 'body', rules.longText.body, ctx),
  }),
  picture: (v, _view, ctx) => ({
    image: assetRef(v, 'image', 'image', ctx),
    ...optionalText(v, 'title', rules.picture.title, ctx),
    ...optionalText(v, 'caption', rules.picture.caption, ctx),
    ...optionalText(v, 'alt', rules.picture.alt, ctx),
    widthM: metres(
      v.widthM,
      `${ctx.at}.widthM`,
      [TOUR_PICTURE_MIN_WIDTH_M, TOUR_PICTURE_MAX_WIDTH_M],
      ctx
    ),
  }),
  video: (v, _view, ctx) => ({
    video: assetRef(v, 'video', 'video', ctx),
    transcript: requiredText(v, 'transcript', rules.video.transcript, ctx),
    ...optionalText(v, 'title', rules.video.title, ctx),
    ...optionalAssetRef(v, 'poster', 'image', ctx),
  }),
  audio: (v, _view, ctx) => ({
    audio: assetRef(v, 'audio', 'audio', ctx),
    transcript: requiredText(v, 'transcript', rules.audio.transcript, ctx),
    ...optionalText(v, 'title', rules.audio.title, ctx),
  }),
  model: (v, view, ctx) => ({
    asset: assetRef(v, 'asset', 'model', ctx),
    ...modelSize(v, view, ctx),
    ...optionalText(v, 'title', rules.model.title, ctx),
  }),
  character: (v, _view, ctx) => ({
    name: requiredText(v, 'name', rules.character.name, ctx),
    image: assetRef(v, 'image', 'image', ctx),
    caption: requiredText(v, 'caption', rules.character.caption, ctx),
    ...optionalAssetRef(v, 'voice', 'audio', ctx),
  }),
};

function isKind(value: unknown): value is TourBlockKind {
  return typeof value === 'string' && Object.hasOwn(KIND_FIELDS, value);
}

/** The block's view when this reader knows it; null for a lenient reader
 *  that does not (it falls back when placed). */
function viewOf(
  value: unknown,
  kind: TourBlockKind,
  ctx: BlockContext
): string | null {
  const views: readonly string[] = TOUR_BLOCK_VIEWS[kind];
  if (typeof value === 'string' && views.includes(value)) return value;
  if (ctx.lenient) return null;
  return ctx.fail(`"${ctx.at}.view" must be ${views.join(', ')} for a ${kind}`);
}

function createdAtOf(value: unknown, at: string, fail: Fail) {
  if (value === undefined) return {};
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fail(`"${at}.createdAtIso" must be an ISO-8601 timestamp`);
  }
  return { createdAtIso: value };
}

/** One block's id, checked at every minor. */
function blockIdOf(value: Fields, at: string, fail: Fail): string {
  return requireTourId(value.id, `${at}.id`, fail);
}

function readBlock(v: Fields, ctx: BlockContext): TourBlockRead {
  const pose = parseTourLocalPose(v.pose, `${ctx.at}.pose`, ctx.fail);
  const created = createdAtOf(v.createdAtIso, ctx.at, ctx.fail);
  const { kind } = v;
  if (!isKind(kind)) {
    return problem(
      ctx,
      `"${ctx.at}.kind" must be shortText, longText, picture, video, audio, model or character`
    );
  }
  const view = viewOf(v.view, kind, ctx);
  const fields = KIND_FIELDS[kind](v, view, ctx);
  const block = {
    id: ctx.id,
    kind,
    view: view ?? 'card',
    pose,
    ...created,
    ...fields,
  } as unknown as TourBlock;
  return { block, knownView: view !== null };
}

/**
 * Read one station's blocks (`value`, at `at`): each field checked, each
 * media reference resolved against `assets`, block ids unique. Their views
 * are settled by {@link placeTourBlocks} once the story is read. A lenient
 * reader skips (and reports) what it cannot show.
 */
export function readTourBlocks(
  value: unknown,
  at: string,
  options: TourBlocksReadOptions
): TourBlockRead[] {
  const fail: Fail = options.fail;
  if (!Array.isArray(value)) return fail(`"${at}" must be an array`);
  const assets = new Map(options.assets.map((a) => [a.id, a.kind] as const));
  const lenient = options.lenient === true;
  const ids: string[] = [];
  const read = (value as unknown[]).flatMap((v, i): TourBlockRead[] => {
    const blockAt = `${at}[${String(i)}]`;
    if (!isRecord(v)) return fail(`"${blockAt}" must be an object`);
    const id = blockIdOf(v, blockAt, fail);
    ids.push(id);
    const ctx: BlockContext = {
      at: blockAt,
      id,
      assets,
      fail,
      lenient,
      onDropped: options.onDropped,
    };
    try {
      return [readBlock(v, ctx)];
    } catch (err) {
      if (!(err instanceof SkippedBlock)) throw err;
      options.onDropped?.({ kind: 'block', block: id, reason: err.message });
      return [];
    }
  });
  assertUniqueTourIds(ids, 'block', fail);
  return read;
}

/** Block ids are unique across the tour, not only within a station. */
export function checkTourBlockIdsUnique(
  stations: readonly { readonly blocks: readonly { readonly id: string }[] }[],
  fail: Fail
): void {
  assertUniqueTourIds(
    stations.flatMap((s) => s.blocks.map((b) => b.id)),
    'block',
    fail
  );
}

/** The free block's place, or why it has none this reader draws. */
function freePlacement(read: TourBlockRead): TourBlock | string {
  const { block, knownView } = read;
  if (knownView) {
    return WORLD_VIEWS.has(block.view)
      ? block
      : `no step shows block "${block.id}", so it must stand in the world (pin, plane or placed), not in "${block.view}"`;
  }
  const floor = tourFloorView(block.kind, 'free');
  if (floor === null) {
    return `no step shows block "${block.id}", and this version of the app draws no ${block.kind} in the world`;
  }
  if (block.kind === 'model' && block.sizeM === undefined) {
    return `no step shows block "${block.id}", and a placed model needs a size`;
  }
  return { ...block, view: floor } as TourBlock;
}

/**
 * Settle each block's view against its station's story: `shown` holds the
 * ids its `show` steps name. A story block in a view this reader does not
 * know shows as `card`; a FREE block must stand in the world - in a strict
 * read anything else fails the file, in a lenient one a free block falls
 * back to its kind's world view or is skipped and reported.
 */
export function placeTourBlocks(
  read: readonly TourBlockRead[],
  shown: ReadonlySet<string>,
  options: Pick<TourBlocksReadOptions, 'fail' | 'lenient' | 'onDropped'>
): TourBlock[] {
  return read.flatMap((r): TourBlock[] => {
    if (shown.has(r.block.id)) return [r.block];
    const placed = freePlacement(r);
    if (typeof placed !== 'string') return [placed];
    if (options.lenient !== true) return options.fail(placed);
    options.onDropped?.({ kind: 'block', block: r.block.id, reason: placed });
    return [];
  });
}
