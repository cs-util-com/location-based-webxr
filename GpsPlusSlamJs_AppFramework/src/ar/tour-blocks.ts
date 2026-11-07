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

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import type { TourAsset, TourAssetKind } from './tour-assets.js';
import {
  assertUniqueTourIds,
  requireTourId,
  type TourFail,
} from './tour-fields.js';
import { parseTourLocalPose, type TourLocalPose } from './tour-items.js';
import { tourTimingEntryName } from './tour-timing.js';

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

/** The views a character speaks in in a story, besides
 *  `stage` and `card`: a speech bubble over his head (`bubble`);
 *  the bubble with his voice on a tap (`speak`); the bubble, and once his
 *  line has ended he beckons along the tour (`two-stations`); a portrait
 *  card at the foot of the screen (`portrait`); a paper stage that unfolds
 *  at the station (`popup`). He takes them as a step and standing free
 *  in a station (`TOUR_FREE_BLOCK_VIEWS`). */
export const TOUR_CHARACTER_VIEWS = [
  'bubble',
  'speak',
  'two-stations',
  'portrait',
  'popup',
] as const;

/** A character's minor-2 view. */
export type TourCharacterView = (typeof TOUR_CHARACTER_VIEWS)[number];

/** The views this reader draws, per kind. A view joins the format with its
 *  renderer; `card` (the block in the scene card) exists for every kind. */
export const TOUR_BLOCK_VIEWS = {
  shortText: ['pin', 'card'],
  longText: ['lectern', 'reading', 'card'],
  picture: ['plane', 'card'],
  video: ['card'],
  audio: ['card'],
  model: ['placed', 'ghost', 'hotspots', 'cutaway', 'toy', 'stage', 'card'],
  character: ['stage', ...TOUR_CHARACTER_VIEWS, 'card'],
} as const satisfies Record<TourBlockKind, readonly string[]>;

/**
 * The views a model stands in the world in: `placed` at its pose and size; `ghost`, the same shape as
 * glass whose feet fade into the ground; `hotspots`, its notes drawn on it
 * (its animation held at rest, so they stay on the surface); `cutaway`,
 * cut open by its sections; `toy`, at its pose and size until the visitor
 * resizes or moves it. Every one of them needs a size.
 */
export const TOUR_MODEL_WORLD_VIEWS = [
  'placed',
  'ghost',
  'hotspots',
  'cutaway',
  'toy',
] as const;

/** A model's world view. */
export type TourModelWorldView = (typeof TOUR_MODEL_WORLD_VIEWS)[number];

type ViewOf<K extends TourBlockKind> = (typeof TOUR_BLOCK_VIEWS)[K][number];

/** The views drawn in the world for as long as their block is present: a
 *  story block in one stands from the moment its story reaches it. `card`
 *  opens only when a step shows it, a character's views are the stage's,
 *  and a `stage` figure lives only while a story runs. Renderers ask this
 *  set, never a copy of it. */
export const TOUR_WORLD_VIEWS: ReadonlySet<string> = new Set([
  'pin',
  'lectern',
  'reading',
  'plane',
  ...TOUR_MODEL_WORLD_VIEWS,
]);

/**
 * The views a FREE block may hold, per kind. Every kind works directly in a
 * station; a view may belong to a story alone (`stage` always, `card` for a
 * kind with a look of its own in the world, which nothing would reach). A
 * video and a sound hold `card` until their world views join the format:
 * the file then names no look, and the viewer draws what it has for them.
 */
export const TOUR_FREE_BLOCK_VIEWS = {
  shortText: ['pin'],
  longText: ['lectern', 'reading'],
  picture: ['plane'],
  video: ['card'],
  audio: ['card'],
  model: TOUR_MODEL_WORLD_VIEWS,
  character: TOUR_CHARACTER_VIEWS,
} as const satisfies Record<TourBlockKind, readonly string[]>;

const MODEL_WORLD_VIEWS: ReadonlySet<string> = new Set(TOUR_MODEL_WORLD_VIEWS);

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

/** A model's notes: a note's title is required, its text
 *  optional; at most {@link TOUR_MODEL_MAX_NOTES} on one model. */
export const TOUR_MODEL_NOTE_RULES = {
  title: required(64),
  text: optional(1024),
} as const satisfies Record<string, TourTextRule>;
export const TOUR_MODEL_MAX_NOTES = 32;

/** A model's sections, the planes a cutaway cuts it by: 1 to
 *  {@link TOUR_MODEL_MAX_SECTIONS}, each named. */
export const TOUR_MODEL_SECTION_RULES = {
  name: required(40),
} as const satisfies Record<string, TourTextRule>;
export const TOUR_MODEL_MAX_SECTIONS = 4;

/** The name of a model's animation clip, as its file names it. */
export const TOUR_MODEL_ANIMATION_RULES = {
  name: required(128),
} as const satisfies Record<string, TourTextRule>;

/** How far from the model's origin a note or a section may sit, in the
 *  model file's own units: beyond any model, short of nonsense. */
export const TOUR_MODEL_SPACE_MAX = 10_000;

/** The shortest a note's or a section's `normal` may be. A policy floor,
 *  not a limit of the arithmetic (a shorter vector still normalises): a
 *  direction this short is a zero written with rounding noise, so it is
 *  refused as zero - failing a file of the reader's own minor, and
 *  leaving out just that note or section of a newer one. */
export const TOUR_MODEL_MIN_DIRECTION_LENGTH = 1e-9;

/** A narration's credit line: optional, left out alone when
 *  over its cap. */
export const TOUR_NARRATION_RULES = {
  voiceCredit: optional(200),
} as const satisfies Record<string, TourTextRule>;

/** The longest a narration may last (ms): four hours. */
export const TOUR_NARRATION_MAX_DURATION_MS = 14_400_000;

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

/**
 * A long text's narration: its voice, and optionally the
 * read-along track that says which words it speaks when.
 */
export interface TourNarration {
  /** An audio asset: the text read aloud. */
  readonly audio: string;
  /** The block's own timing entry, `timing/<blockId>.json`
   *  (`tour-timing.ts`); absent: a voice without a read-along. */
  readonly timing?: string;
  /** Who the voice is, shown beside the player
   *  ({@link TOUR_NARRATION_RULES}). */
  readonly voiceCredit?: string;
  /** Whether the voice is a synthetic one, as the player says. */
  readonly synthetic: boolean;
  /** The voice's length (ms), when the creator's tool knew it: a track
   *  timed beyond it is stale. */
  readonly durationMs?: number;
}

export interface TourLongTextBlock extends TourBlockEnvelope<'longText'> {
  readonly title: string;
  /** The text's source, counted in UTF-16 units. */
  readonly body: string;
  /** The text read aloud. */
  readonly narration?: TourNarration;
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

/** A point or a direction in a model's own space: the model file's frame
 *  and units, before its size scales it. */
export type TourModelVector = readonly [number, number, number];

/** A note on a model: a point on its surface and the surface's outward
 *  direction there, both in the model's own space, so a note scales and
 *  turns with the model. */
export interface TourModelNote {
  readonly position: TourModelVector;
  /** Not zero; kept as written (a renderer normalises it). */
  readonly normal: TourModelVector;
  readonly title: string;
  readonly text?: string;
}

/** A plane a cutaway cuts the model by, in the model's own space: what
 *  lies on the side its `normal` points to is cut away. */
export interface TourModelSection {
  readonly name: string;
  readonly position: TourModelVector;
  /** Not zero; kept as written. */
  readonly normal: TourModelVector;
}

/** One of the model file's animation clips, by name, and whether it plays
 *  by itself. A name the file lacks plays nothing. */
export interface TourModelAnimation {
  readonly name: string;
  readonly autoplay: boolean;
}

export interface TourModelBlock extends TourBlockEnvelope<'model'> {
  /** A model asset. */
  readonly asset: string;
  /** The scaled model's largest side in metres: required in every world
   *  view, refused on the stage (mounted at its file's own size). */
  readonly sizeM?: number;
  readonly title?: string;
  /** Its clip. */
  readonly animation?: TourModelAnimation;
  /** Its notes, drawn in the `hotspots` view; 1 to
   *  {@link TOUR_MODEL_MAX_NOTES} (an empty list reads as absent). They
   *  live on the block, not in the file, so replacing the file keeps them. */
  readonly annotations?: readonly TourModelNote[];
  /** The planes a `cutaway` steps through, 1 to
   *  {@link TOUR_MODEL_MAX_SECTIONS}. Absent (an empty list reads so): one
   *  cut that turns to face the visitor. */
  readonly sections?: readonly TourModelSection[];
}

export interface TourCharacterBlock extends TourBlockEnvelope<'character'> {
  /** As written; with a `character` reference, the declaration's. */
  readonly name: string;
  /** A cut-out image asset; with a `character` reference, the
   *  declaration's. */
  readonly image: string;
  /** The tour's declared character this is (`tour-characters.ts`). */
  readonly character?: string;
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
  /** The tour's declared characters by id (`tour-characters.ts`), which a
   *  character block's `character` names; none when absent. */
  readonly characters?: ReadonlyMap<string, DeclaredCharacter>;
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
 * The view a free block falls back to when this reader does not know its
 * own: one of {@link TOUR_FREE_BLOCK_VIEWS}. A story block's floor is
 * `card`, which is also what its reader gives a block with no view at all.
 */
export function tourFloorView(kind: TourBlockKind): TourBlockView {
  return FREE_FLOOR[kind];
}

const FREE_FLOOR: Record<TourBlockKind, TourBlockView> = {
  shortText: 'pin',
  longText: 'reading',
  picture: 'plane',
  video: 'card',
  audio: 'card',
  model: 'placed',
  // The view that stands him as a figure and keeps a tap on his voice.
  character: 'speak',
};

/** What a block takes from a declared character. */
interface DeclaredCharacter {
  readonly name: string;
  readonly image: string;
}

/** Thrown inside one block's read when a lenient reader cannot show it;
 *  caught per block. Never escapes this module. */
class SkippedBlock extends Error {}

interface BlockContext {
  readonly at: string;
  readonly id: string;
  readonly assets: ReadonlyMap<string, TourAssetKind>;
  readonly characters: ReadonlyMap<string, DeclaredCharacter>;
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

/** A model's size by its view: required in every world view, refused on
 *  the stage, optional in a card or a view this reader does not know. */
function modelSize(
  v: Fields,
  view: string | null,
  ctx: BlockContext
): { sizeM?: number } {
  if (v.sizeM === undefined) {
    if (view === null || !MODEL_WORLD_VIEWS.has(view)) return {};
    return problem(
      ctx,
      `"${ctx.at}.sizeM" is required for a model in the world (${view})`
    );
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

/** Whether `value` is an array of exactly three finite numbers. */
function isFiniteTriple(value: unknown): value is TourModelVector {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    (value as unknown[]).every(isFiniteNumber)
  );
}

/** A point or a direction in a model's own space: three finite numbers
 *  (structural, at every minor; a direction also not shorter than
 *  {@link TOUR_MODEL_MIN_DIRECTION_LENGTH}), within
 *  {@link TOUR_MODEL_SPACE_MAX} (a rule a later minor may widen). */
function modelVector(
  value: unknown,
  at: string,
  direction: boolean,
  ctx: BlockContext
): TourModelVector {
  if (!isFiniteTriple(value)) {
    return ctx.fail(`"${at}" must be three finite numbers`);
  }
  const [x, y, z] = value;
  if (direction && Math.hypot(x, y, z) < TOUR_MODEL_MIN_DIRECTION_LENGTH) {
    return ctx.fail(`"${at}" is a direction, so it must not be zero`);
  }
  if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > TOUR_MODEL_SPACE_MAX) {
    return problem(
      ctx,
      `"${at}" must lie within ${String(TOUR_MODEL_SPACE_MAX)} of the model's origin`
    );
  }
  return [x, y, z];
}

/** A list of up to `max` objects at `at`: undefined when absent or empty;
 *  not an array, or an entry not an object, fails; too long is a rule a
 *  later minor may widen. */
function recordList(
  value: unknown,
  at: string,
  max: number,
  ctx: BlockContext
): readonly Fields[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return ctx.fail(`"${at}" must be an array`);
  if (value.length > max) {
    return problem(ctx, `"${at}" must hold at most ${String(max)} entries`);
  }
  if (value.length === 0) return undefined;
  return (value as unknown[]).map((entry, i): Fields => {
    if (!isRecord(entry)) {
      return ctx.fail(`"${at}[${String(i)}]" must be an object`);
    }
    return entry;
  });
}

/** One nested text field, checked by its rule; its messages name `at`. */
function nestedText(
  entry: Fields,
  field: string,
  rule: TourTextRule,
  at: string,
  ctx: BlockContext
): Partial<Record<string, string>> {
  const nested: BlockContext = { ...ctx, at };
  if (rule.required) {
    return { [field]: requiredText(entry, field, rule, nested) };
  }
  return optionalText(entry, field, rule, nested);
}

/** Whether a note or a section at `field[i]` is left out for its
 *  direction: three finite numbers shorter than
 *  {@link TOUR_MODEL_MIN_DIRECTION_LENGTH}, in a lenient read (a newer
 *  minor), said to `onDropped`. A strict read keeps it, for
 *  {@link modelVector} to refuse the file. */
function droppedForDirection(
  entry: Fields,
  field: string,
  at: string,
  ctx: BlockContext
): boolean {
  const normal = entry.normal;
  if (!ctx.lenient || !isFiniteTriple(normal)) return false;
  if (Math.hypot(...normal) >= TOUR_MODEL_MIN_DIRECTION_LENGTH) return false;
  ctx.onDropped?.({
    kind: 'field',
    block: ctx.id,
    field,
    reason: `"${at}.normal" is a direction, so it must not be zero`,
  });
  return true;
}

function modelNotes(v: Fields, ctx: BlockContext) {
  const at = `${ctx.at}.annotations`;
  const list = recordList(v.annotations, at, TOUR_MODEL_MAX_NOTES, ctx);
  if (list === undefined) return {};
  const annotations = list.flatMap((entry, i) => {
    const noteAt = `${at}[${String(i)}]`;
    const field = `annotations[${String(i)}]`;
    if (droppedForDirection(entry, field, noteAt, ctx)) return [];
    return {
      position: modelVector(entry.position, `${noteAt}.position`, false, ctx),
      normal: modelVector(entry.normal, `${noteAt}.normal`, true, ctx),
      ...nestedText(entry, 'title', TOUR_MODEL_NOTE_RULES.title, noteAt, ctx),
      ...nestedText(entry, 'text', TOUR_MODEL_NOTE_RULES.text, noteAt, ctx),
    } as TourModelNote;
  });
  return annotations.length === 0 ? {} : { annotations };
}

function modelSections(v: Fields, ctx: BlockContext) {
  const at = `${ctx.at}.sections`;
  const list = recordList(v.sections, at, TOUR_MODEL_MAX_SECTIONS, ctx);
  if (list === undefined) return {};
  const sections = list.flatMap((entry, i) => {
    const sectionAt = `${at}[${String(i)}]`;
    const field = `sections[${String(i)}]`;
    if (droppedForDirection(entry, field, sectionAt, ctx)) return [];
    return {
      ...nestedText(
        entry,
        'name',
        TOUR_MODEL_SECTION_RULES.name,
        sectionAt,
        ctx
      ),
      position: modelVector(
        entry.position,
        `${sectionAt}.position`,
        false,
        ctx
      ),
      normal: modelVector(entry.normal, `${sectionAt}.normal`, true, ctx),
    } as TourModelSection;
  });
  return sections.length === 0 ? {} : { sections };
}

function modelAnimation(v: Fields, ctx: BlockContext) {
  const value = v.animation;
  if (value === undefined) return {};
  const at = `${ctx.at}.animation`;
  if (!isRecord(value)) return ctx.fail(`"${at}" must be an object`);
  if (typeof value.autoplay !== 'boolean') {
    return problem(ctx, `"${at}.autoplay" must be true or false`);
  }
  const named = nestedText(
    value,
    'name',
    TOUR_MODEL_ANIMATION_RULES.name,
    at,
    ctx
  );
  const animation = {
    ...named,
    autoplay: value.autoplay,
  } as TourModelAnimation;
  return { animation };
}

/** A character block's name and image, from the declaration it names
 *  or as written. A name no declaration has fails a file of this
 *  reader's own minor; a newer one's drops just the reference. */
function characterFields(v: Fields, ctx: BlockContext) {
  const name = requiredText(v, 'name', rules.character.name, ctx);
  const image = assetRef(v, 'image', 'image', ctx);
  const ref = v.character;
  if (ref === undefined) return { name, image };
  const declared =
    typeof ref === 'string' ? ctx.characters.get(ref) : undefined;
  if (declared !== undefined) {
    return { name: declared.name, image: declared.image, character: ref };
  }
  const reason = `"${ctx.at}.character" must name a character of the tour`;
  if (!ctx.lenient) return ctx.fail(reason);
  ctx.onDropped?.({ kind: 'field', block: ctx.id, field: 'character', reason });
  return { name, image };
}

/** A narration's length: whole milliseconds, 1 to the cap. */
function isNarrationDuration(ms: unknown): boolean {
  return (
    typeof ms === 'number' &&
    Number.isSafeInteger(ms) &&
    ms >= 1 &&
    ms <= TOUR_NARRATION_MAX_DURATION_MS
  );
}

/** Why a narration's fields break their rules; null when they hold (the
 *  credit is checked on its own, by its text rule). */
function narrationFault(value: Fields, ctx: BlockContext): string | null {
  const at = `${ctx.at}.narration`;
  const { audio, timing, synthetic, durationMs } = value;
  if (typeof audio !== 'string' || ctx.assets.get(audio) !== 'audio') {
    return `"${at}.audio" must name an audio asset`;
  }
  const own = tourTimingEntryName(ctx.id);
  if (timing !== undefined && timing !== own) {
    return `"${at}.timing" must be the block's own timing entry, ${own}`;
  }
  if (synthetic !== undefined && typeof synthetic !== 'boolean') {
    return `"${at}.synthetic" must be true or false`;
  }
  if (durationMs !== undefined && !isNarrationDuration(durationMs)) {
    return `"${at}.durationMs" must be a whole number of milliseconds from 1 to ${String(TOUR_NARRATION_MAX_DURATION_MS)}`;
  }
  return null;
}

/** A long text's narration. Not an object fails at every
 *  minor; a field breaking its rule fails a file of this reader's own
 *  minor, and a newer one's drops just the narration, keeping the text.
 *  An over-long credit is left out alone. */
function narrationOf(v: Fields, ctx: BlockContext) {
  const value = v.narration;
  if (value === undefined) return {};
  const at = `${ctx.at}.narration`;
  if (!isRecord(value)) return ctx.fail(`"${at}" must be an object`);
  const reason = narrationFault(value, ctx);
  if (reason !== null) {
    if (!ctx.lenient) return ctx.fail(reason);
    ctx.onDropped?.({
      kind: 'field',
      block: ctx.id,
      field: 'narration',
      reason,
    });
    return {};
  }
  const { audio, timing, durationMs } = value as {
    audio: string;
    timing?: string;
    durationMs?: number;
  };
  const narration: TourNarration = {
    audio,
    ...(timing === undefined ? {} : { timing }),
    ...optionalText(value, 'voiceCredit', TOUR_NARRATION_RULES.voiceCredit, {
      ...ctx,
      at,
    }),
    synthetic: value.synthetic === true,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
  return { narration };
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
    ...narrationOf(v, ctx),
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
    ...modelAnimation(v, ctx),
    ...modelNotes(v, ctx),
    ...modelSections(v, ctx),
  }),
  character: (v, _view, ctx) => ({
    ...characterFields(v, ctx),
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
    const ctx: BlockContext = {
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
      if (!(err instanceof SkippedBlock)) throw err;
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
