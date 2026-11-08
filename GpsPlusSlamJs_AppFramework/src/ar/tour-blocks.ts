/**
 * A station's BLOCKS in `tour.json` version 5: one list of the things a
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
 * block in an unknown view falls back to its floor view: `card` for a
 * story block, a view its kind may stand free in for a free one
 * ({@link tourFloorView}). Structural faults (an id, a pose) fail at every
 * minor: no revision can make them valid.
 *
 * @see tour-blocks.ts.md
 */

import { isRecord } from '../utils/json-guards.js';
import type { TourAsset } from './tour-assets.js';
import {
  problem,
  TourSkippedBlock,
  type TourBlockDrop,
  type TourBlockFields,
  type TourBlockReadContext,
  type TourDeclaredCharacter,
} from './tour-block-read.js';
import {
  assertUniqueTourIds,
  requireTourId,
  type TourFail,
} from './tour-fields.js';
import { parseTourLocalPose } from './tour-items.js';
import {
  isTourBlockKind,
  TOUR_KINDS,
  tourBlockKinds,
  type TourBlock,
  type TourBlockKind,
} from './tour-kinds.js';

export {
  checkTourBlockText,
  tourTextCount,
  type TourBlockDrop,
  type TourBlockTextCheck,
  type TourTextRule,
  type TourTextUnit,
} from './tour-block-read.js';
export {
  TOUR_AUDIO_MAX_RADIUS_M,
  TOUR_AUDIO_MAX_REACH_M,
  TOUR_AUDIO_MIN_RADIUS_M,
  TOUR_AUDIO_MIN_REACH_M,
  TOUR_CHARACTER_VIEWS,
  TOUR_MODEL_ANIMATION_RULES,
  TOUR_MODEL_MAX_NOTES,
  TOUR_MODEL_MAX_SECTIONS,
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_DIRECTION_LENGTH,
  TOUR_MODEL_MIN_SIZE_M,
  TOUR_MODEL_NOTE_RULES,
  TOUR_MODEL_SECTION_RULES,
  TOUR_MODEL_SPACE_MAX,
  TOUR_MODEL_WORLD_VIEWS,
  TOUR_NARRATION_MAX_DURATION_MS,
  TOUR_NARRATION_RULES,
  TOUR_PICTURE_MAX_WIDTH_M,
  TOUR_PICTURE_MIN_WIDTH_M,
  type TourAudioBlock,
  type TourBlock,
  type TourBlockKind,
  type TourCharacterBlock,
  type TourCharacterView,
  type TourLongTextBlock,
  type TourModelAnimation,
  type TourModelBlock,
  type TourModelNote,
  type TourModelSection,
  type TourModelVector,
  type TourModelWorldView,
  type TourNarration,
  type TourPictureBlock,
  type TourShortTextBlock,
  type TourVideoBlock,
} from './tour-kinds.js';

type Fail = TourFail;

/** One field of every row, by kind, in the list's order. */
function perKind<F extends 'views' | 'freeViews' | 'text'>(field: F) {
  return Object.fromEntries(
    tourBlockKinds().map((kind) => [kind, TOUR_KINDS[kind][field]])
  ) as { readonly [K in TourBlockKind]: (typeof TOUR_KINDS)[K][F] };
}

/** The views this reader draws, per kind (the list's `views`). */
export const TOUR_BLOCK_VIEWS = perKind('views');

/** The views drawn in the world for as long as their block is present: a
 *  story block in one stands from the moment its story reaches it. `card`
 *  opens only when a step shows it, a character's views are the stage's,
 *  and a `stage` figure lives only while a story runs. Renderers ask this
 *  set, never a copy of it. */
export const TOUR_WORLD_VIEWS: ReadonlySet<string> = new Set(
  tourBlockKinds().flatMap((kind): readonly string[] => {
    return TOUR_KINDS[kind].worldViews;
  })
);

/** The views a FREE block may hold, per kind (the list's `freeViews`). */
export const TOUR_FREE_BLOCK_VIEWS = perKind('freeViews');

/** Every capped text of every kind (the list's `text`). */
export const TOUR_BLOCK_TEXT_RULES = perKind('text');

export type TourBlockView = TourBlock['view'];

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
  /** The tour's declared characters by id (`tour-characters.ts`), which a
   *  character block's `character` names; none when absent. */
  readonly characters?: ReadonlyMap<string, TourDeclaredCharacter>;
  readonly fail: Fail;
  readonly lenient?: boolean;
  readonly onDropped?: (drop: TourBlockDrop) => void;
}

/**
 * The view a free block falls back to when this reader does not know its
 * own: one of {@link TOUR_FREE_BLOCK_VIEWS}. A story block's floor is
 * `card`, which is also what its reader gives a block with no view at all.
 */
export function tourFloorView(kind: TourBlockKind): TourBlockView {
  return TOUR_KINDS[kind].floor;
}

/** "a, b or c". */
function orList(words: readonly string[]): string {
  return `${words.slice(0, -1).join(', ')} or ${words.at(-1) ?? ''}`;
}

/** The block's view when this reader knows it; null for a lenient reader
 *  that does not (it falls back when placed). */
function viewOf(
  value: unknown,
  kind: TourBlockKind,
  ctx: TourBlockReadContext
): string | null {
  const views: readonly string[] = TOUR_KINDS[kind].views;
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
function blockIdOf(value: TourBlockFields, at: string, fail: Fail): string {
  return requireTourId(value.id, `${at}.id`, fail);
}

function readBlock(
  v: TourBlockFields,
  ctx: TourBlockReadContext
): TourBlockRead {
  const pose = parseTourLocalPose(v.pose, `${ctx.at}.pose`, ctx.fail);
  const created = createdAtOf(v.createdAtIso, ctx.at, ctx.fail);
  const { kind } = v;
  if (!isTourBlockKind(kind)) {
    return problem(ctx, `"${ctx.at}.kind" must be ${orList(tourBlockKinds())}`);
  }
  const view = viewOf(v.view, kind, ctx);
  const fields = TOUR_KINDS[kind].read(v, view, ctx);
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
 * A reader of single blocks under `options` (the assets indexed once): it
 * reads the block record `value` at `at` - each field checked, each media
 * reference resolved - or returns null when a lenient reader skips it,
 * reported as a `block` drop. Its view is settled by the caller, which
 * knows whether the block is free ({@link placeTourBlocks}). The id is
 * checked at every minor; uniqueness is the caller's.
 */
export function tourBlockReader(
  options: TourBlocksReadOptions
): (
  value: Readonly<Record<string, unknown>>,
  at: string
) => TourBlockRead | null {
  const assets = new Map(options.assets.map((a) => [a.id, a.kind] as const));
  const characters = options.characters ?? new Map();
  const lenient = options.lenient === true;
  return (v, at) => {
    const id = blockIdOf(v, at, options.fail);
    const ctx: TourBlockReadContext = {
      at,
      id,
      assets,
      characters,
      fail: options.fail,
      lenient,
      onDropped: options.onDropped,
    };
    try {
      return readBlock(v, ctx);
    } catch (err) {
      if (!(err instanceof TourSkippedBlock)) throw err;
      options.onDropped?.({ kind: 'block', block: id, reason: err.message });
      return null;
    }
  };
}

/**
 * Read a list of blocks (`value`, at `at`): each field checked, each media
 * reference resolved against `assets`, block ids unique. The views of free
 * blocks are settled by {@link placeTourBlocks}. A lenient reader skips (and reports) what it cannot show.
 */
export function readTourBlocks(
  value: unknown,
  at: string,
  options: TourBlocksReadOptions
): TourBlockRead[] {
  const fail: Fail = options.fail;
  if (!Array.isArray(value)) return fail(`"${at}" must be an array`);
  const readOne = tourBlockReader(options);
  const ids: string[] = [];
  const read = (value as unknown[]).flatMap((v, i): TourBlockRead[] => {
    const blockAt = `${at}[${String(i)}]`;
    if (!isRecord(v)) return fail(`"${blockAt}" must be an object`);
    ids.push(blockIdOf(v, blockAt, fail));
    const block = readOne(v, blockAt);
    return block === null ? [] : [block];
  });
  assertUniqueTourIds(ids, 'block', fail);
  return read;
}

/** The free block's place, or why it has none this reader draws. */
function freePlacement(read: TourBlockRead): TourBlock | string {
  const { block, knownView } = read;
  if (knownView) {
    const views: readonly string[] = TOUR_FREE_BLOCK_VIEWS[block.kind];
    return views.includes(block.view)
      ? block
      : `block "${block.id}" stands free in its station, so it must stand in the world (${views.join(', ')}), not in "${block.view}"`;
  }
  const floor = tourFloorView(block.kind);
  if (block.kind === 'model' && block.sizeM === undefined) {
    return `block "${block.id}" stands free in its station, and a placed model needs a size`;
  }
  return { ...block, view: floor } as TourBlock;
}

/**
 * Settle each FREE block's view: it must be one its kind may stand free
 * in - in a strict read anything else fails the file, in a lenient one it
 * is skipped and reported; an unknown view falls back to its kind's floor.
 */
export function placeTourBlocks(
  read: readonly TourBlockRead[],
  options: Pick<TourBlocksReadOptions, 'fail' | 'lenient' | 'onDropped'>
): TourBlock[] {
  return read.flatMap((r): TourBlock[] => {
    const placed = freePlacement(r);
    if (typeof placed !== 'string') return [placed];
    if (options.lenient !== true) return options.fail(placed);
    options.onDropped?.({ kind: 'block', block: r.block.id, reason: placed });
    return [];
  });
}
