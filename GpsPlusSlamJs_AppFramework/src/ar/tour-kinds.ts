/**
 * THE LIST OF KINDS: every kind of block a tour holds is one row of
 * {@link TOUR_KINDS}, and what the format knows about a kind is said there,
 * once: its views, the text rules, how its own fields are read, which
 * assets it names, and the minor that brought it. The public tables
 * (`TOUR_BLOCK_VIEWS`, `TOUR_BLOCK_TEXT_RULES`, ...) are derived from the
 * list in `tour-blocks.ts`, which keeps the envelope (id, kind, view, pose).
 *
 * A kind is added by one line in {@link TourBlockOfKind} and one row. The
 * row's absence is a compile error here, and the wider `TourBlockKind` is
 * one everywhere a kind has to say something.
 *
 * CLOSED: this is a static list in source code. Nothing in a tour declares
 * a kind or a field, because a tour is untrusted input.
 *
 * @see tour-kinds.ts.md
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import type { TourAssetKind } from './tour-assets.js';
import {
  assetRef,
  metres,
  optional,
  optionalAssetRef,
  optionalText,
  problem,
  required,
  requiredText,
  type TourBlockFields,
  type TourBlockReadContext,
  type TourTextRule,
} from './tour-block-read.js';
import { blockBodyAssets } from './tour-body-assets.js';
import { isTourId } from './tour-fields.js';
import { parseTourLocalPose, type TourLocalPose } from './tour-items.js';
import { tourTimingEntryName } from './tour-timing.js';

/** The views a character stands in, besides `card`: a speech bubble over
 *  his head (`bubble`); the bubble with his voice, which a tap plays
 *  (`speak`); the bubble, and once his line has ended he beckons along
 *  the tour (`two-stations`); a portrait card at the foot of the screen
 *  (`portrait`); a paper stage that unfolds at the station (`popup`). He
 *  takes them as a step and standing free in a station
 *  (`TOUR_FREE_BLOCK_VIEWS`). */
export const TOUR_CHARACTER_VIEWS = [
  'bubble',
  'speak',
  'two-stations',
  'portrait',
  'popup',
] as const;

/** A character's minor-2 view. */
export type TourCharacterView = (typeof TOUR_CHARACTER_VIEWS)[number];

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

const MODEL_WORLD_VIEWS: ReadonlySet<string> = new Set(TOUR_MODEL_WORLD_VIEWS);

/* Each kind's views. A view joins the format with its renderer; `card` (the
 * block in the scene card) exists for every kind. */
const SHORT_TEXT_VIEWS = ['pin', 'card'] as const;
const LONG_TEXT_VIEWS = ['lectern', 'reading', 'card'] as const;
/* A picture stands in the world as a bare `plane`, a print in a frame
 * with a plate (`framed`), or a cut-out on the ground (`cutout`); the
 * viewpoint views line it up with the place from one spot
 * ({@link TOUR_PICTURE_VIEWPOINT_VIEWS}). */
const PICTURE_VIEWS = [
  'plane',
  'framed',
  'cutout',
  'thenNow',
  'sharpen',
  'finder',
  'window',
  'viewer',
  'card',
] as const;
const VIDEO_VIEWS = ['card'] as const;
/* An audio item stands as a narration circle (`spot`: the voice plays on
 * a tap inside it) or an ambient zone (`zone`: it plays by itself within
 * its reach, louder toward the centre). */
const AUDIO_VIEWS = ['spot', 'zone', 'card'] as const;
const MODEL_VIEWS = [...TOUR_MODEL_WORLD_VIEWS, 'card'] as const;
const CHARACTER_VIEWS = [...TOUR_CHARACTER_VIEWS, 'card'] as const;

/* Each kind's capped texts. */
const SHORT_TEXT_RULES = { caption: required(40), description: optional(160) };
const LONG_TEXT_RULES = {
  title: required(80),
  body: required(32_000, 'utf16'),
};
const PICTURE_RULES = {
  title: optional(40),
  caption: optional(1200),
  alt: optional(300),
  credit: optional(200),
  // Text, not a number: "about 1880s", "1920-1925".
  year: optional(24),
};
const VIDEO_RULES = { title: optional(40), transcript: optional(32_000) };
const AUDIO_RULES = { title: optional(40), transcript: optional(32_000) };
const MODEL_RULES = { title: optional(80) };
const CHARACTER_RULES = { name: required(80), caption: optional(2000) };

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

/** A narration circle's radius (m), inclusive. The editor's default is
 *  larger than the floor: a smaller circle only holds where the position
 *  is steadier than GPS alone (the viewer's sweep, `narration-circle`). */
export const TOUR_AUDIO_MIN_RADIUS_M = 1;
export const TOUR_AUDIO_MAX_RADIUS_M = 50;

/** An ambient zone's reach and inner calm (m), inclusive. */
export const TOUR_AUDIO_MIN_REACH_M = 1;
export const TOUR_AUDIO_MAX_REACH_M = 200;

/** A picture's width in the world (m), inclusive. */
export const TOUR_PICTURE_MIN_WIDTH_M = 0.05;
export const TOUR_PICTURE_MAX_WIDTH_M = 50;

/** The views a picture stands in the world in (every view but `card`). */
export const TOUR_PICTURE_WORLD_VIEWS = [
  'plane',
  'framed',
  'cutout',
  'thenNow',
  'sharpen',
  'finder',
  'window',
  'viewer',
] as const satisfies readonly (typeof PICTURE_VIEWS)[number][];

/** A picture's world view. */
export type TourPictureWorldView = (typeof TOUR_PICTURE_WORLD_VIEWS)[number];

/** The views that show a picture lined up from one spot: each draws it
 *  from its `viewpoint`, and without one it is drawn as a `plane`. */
export const TOUR_PICTURE_VIEWPOINT_VIEWS = [
  'thenNow',
  'sharpen',
  'finder',
  'window',
  'viewer',
] as const satisfies readonly TourPictureWorldView[];

/** A viewpoint's lens: its horizontal field of view (degrees), inclusive. */
export const TOUR_PICTURE_MIN_HFOV_DEG = 10;
export const TOUR_PICTURE_MAX_HFOV_DEG = 120;

/** How far the subject stands from a viewpoint (m), inclusive: the depth
 *  its picture hangs at. */
export const TOUR_PICTURE_MIN_DISTANCE_M = 1;
export const TOUR_PICTURE_MAX_DISTANCE_M = 500;

interface TourBlockEnvelope<K extends string, V extends string> {
  /** Short path-safe id, unique among the tour's blocks (asset ids are a
   *  namespace of their own). */
  readonly id: string;
  readonly kind: K;
  readonly view: V;
  /** Where it stands in its station's frame; views that do not use it
   *  (`card`) ignore it. */
  readonly pose: TourLocalPose;
  /** When it was made, for the editor's ordering. */
  readonly createdAtIso?: string;
}

export interface TourShortTextBlock extends TourBlockEnvelope<
  'shortText',
  (typeof SHORT_TEXT_VIEWS)[number]
> {
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

export interface TourLongTextBlock extends TourBlockEnvelope<
  'longText',
  (typeof LONG_TEXT_VIEWS)[number]
> {
  readonly title: string;
  /** The text's source, counted in UTF-16 units. */
  readonly body: string;
  /** The text read aloud. */
  readonly narration?: TourNarration;
}

export interface TourPictureBlock extends TourBlockEnvelope<
  'picture',
  (typeof PICTURE_VIEWS)[number]
> {
  /** An image asset. */
  readonly image: string;
  readonly title?: string;
  readonly caption?: string;
  /** A plain description for a visitor who cannot see it. */
  readonly alt?: string;
  /** Who made it, or where it is from: a small line on a plate and in its
   *  sheet. */
  readonly credit?: string;
  /** When it was made, as text ("about 1880s"). */
  readonly year?: string;
  /** Its width in the world, in metres. */
  readonly widthM: number;
  /** A cut-out's small tag at its foot (its year and first words);
   *  absent: shown. Kept in every view, read by `cutout`. */
  readonly showTag?: boolean;
  /** Where to stand to see it lined up with the place; read by the
   *  viewpoint views ({@link TOUR_PICTURE_VIEWPOINT_VIEWS}), kept in
   *  every other so a view switch loses nothing. */
  readonly viewpoint?: TourPictureViewpoint;
}

/**
 * A picture's viewpoint: the spot a visitor stands on and the way the
 * camera that took it looked, in the station's frame (metres north, up and
 * east of the station's anchor, whatever folders hold the picture), so
 * moving the picture's own pose never moves where it lines up.
 */
export interface TourPictureViewpoint {
  /** The eye point, `[north, up, east]` (m). */
  readonly position: readonly [number, number, number];
  /** The camera's turn, a unit quaternion `[x, y, z, w]` in the same
   *  frame: it looks along its local -Z, up its local +Y. */
  readonly rotation: readonly [number, number, number, number];
  /** The lens's horizontal field of view (degrees). */
  readonly hfovDeg: number;
  /** How far the subject stands (m): the depth the picture hangs at. */
  readonly distanceM: number;
}

export interface TourVideoBlock extends TourBlockEnvelope<
  'video',
  (typeof VIDEO_VIEWS)[number]
> {
  /** A video asset. */
  readonly video: string;
  /** Its words, for a visitor who cannot hear it. */
  readonly transcript?: string;
  readonly title?: string;
  /** An image asset shown while the clip waits. */
  readonly poster?: string;
}

export interface TourAudioBlock extends TourBlockEnvelope<
  'audio',
  (typeof AUDIO_VIEWS)[number]
> {
  /** An audio asset. */
  readonly audio: string;
  readonly transcript?: string;
  readonly title?: string;
  /** A narration circle's radius (m): required in `spot`, kept in the
   *  other views so a view switch loses nothing. */
  readonly radiusM?: number;
  /** An ambient zone's reach (m): silent beyond it. Required in `zone`. */
  readonly maxM?: number;
  /** Within this distance (m) a zone plays at full volume; absent: only at
   *  its centre. Less than `maxM`. */
  readonly minM?: number;
  /** A zone's loudness at full, 0 to 1. Required in `zone`. */
  readonly volume?: number;
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

export interface TourModelBlock extends TourBlockEnvelope<
  'model',
  (typeof MODEL_VIEWS)[number]
> {
  /** A model asset. */
  readonly asset: string;
  /** The scaled model's largest side in metres: required in every world
   *  view. */
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

export interface TourCharacterBlock extends TourBlockEnvelope<
  'character',
  (typeof CHARACTER_VIEWS)[number]
> {
  /** As written; with a `character` reference, the declaration's. */
  readonly name: string;
  /** A cut-out image asset; with a `character` reference, the
   *  declaration's. */
  readonly image: string;
  /** The tour's declared character this is (`tour-characters.ts`). */
  readonly character?: string;
  /** What the character says, as text; optional. */
  readonly caption?: string;
  /** An optional voice clip (an audio asset). */
  readonly voice?: string;
}

/** A model's size by its view: required in every world view, optional in
 *  a card or a view this reader does not know. */
function modelSize(
  v: TourBlockFields,
  view: string | null,
  ctx: TourBlockReadContext
): { sizeM?: number } {
  if (v.sizeM === undefined) {
    if (view === null || !MODEL_WORLD_VIEWS.has(view)) return {};
    return problem(
      ctx,
      `"${ctx.at}.sizeM" is required for a model in the world (${view})`
    );
  }
  const bounds = [TOUR_MODEL_MIN_SIZE_M, TOUR_MODEL_MAX_SIZE_M] as const;
  return { sizeM: metres(v.sizeM, `${ctx.at}.sizeM`, bounds, ctx) };
}

/** One metres field of an audio item: required in the view `requiredIn`,
 *  checked when present in any other (a lenient reader's unknown view,
 *  null, asks for none). */
function audioMetres(
  v: TourBlockFields,
  field: 'radiusM' | 'maxM' | 'minM',
  requiredIn: string | null,
  view: string | null,
  bounds: readonly [number, number],
  ctx: TourBlockReadContext
): Partial<Record<string, number>> {
  const value = v[field];
  if (value === undefined) {
    if (requiredIn === null || view !== requiredIn) return {};
    return problem(
      ctx,
      `"${ctx.at}.${field}" is required for a sound in the ${requiredIn} view`
    );
  }
  return { [field]: metres(value, `${ctx.at}.${field}`, bounds, ctx) };
}

/** An audio item's world fields by its view: a narration circle's radius,
 *  an ambient zone's reach, inner calm and volume. */
function audioWorld(
  v: TourBlockFields,
  view: string | null,
  ctx: TourBlockReadContext
): Partial<Record<string, number>> {
  const reach = [TOUR_AUDIO_MIN_REACH_M, TOUR_AUDIO_MAX_REACH_M] as const;
  const radius = [TOUR_AUDIO_MIN_RADIUS_M, TOUR_AUDIO_MAX_RADIUS_M] as const;
  const fields = {
    ...audioMetres(v, 'radiusM', 'spot', view, radius, ctx),
    ...audioMetres(v, 'maxM', 'zone', view, reach, ctx),
    ...audioMetres(v, 'minM', null, view, reach, ctx),
  };
  const { minM, maxM } = fields;
  if (minM !== undefined && maxM !== undefined && minM >= maxM) {
    return problem(ctx, `"${ctx.at}.minM" must be less than its maxM`);
  }
  const volume = v.volume;
  if (volume === undefined) {
    if (view !== 'zone') return fields;
    return problem(
      ctx,
      `"${ctx.at}.volume" is required for a sound in the zone view`
    );
  }
  if (!isFiniteNumber(volume) || volume < 0 || volume > 1) {
    return problem(ctx, `"${ctx.at}.volume" must be a number from 0 to 1`);
  }
  return { ...fields, volume };
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
  ctx: TourBlockReadContext
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
  ctx: TourBlockReadContext
): readonly TourBlockFields[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return ctx.fail(`"${at}" must be an array`);
  if (value.length > max) {
    return problem(ctx, `"${at}" must hold at most ${String(max)} entries`);
  }
  if (value.length === 0) return undefined;
  return (value as unknown[]).map((entry, i): TourBlockFields => {
    if (!isRecord(entry)) {
      return ctx.fail(`"${at}[${String(i)}]" must be an object`);
    }
    return entry;
  });
}

/** One nested text field, checked by its rule; its messages name `at`. */
function nestedText(
  entry: TourBlockFields,
  field: string,
  rule: TourTextRule,
  at: string,
  ctx: TourBlockReadContext
): Partial<Record<string, string>> {
  const nested: TourBlockReadContext = { ...ctx, at };
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
  entry: TourBlockFields,
  field: string,
  at: string,
  ctx: TourBlockReadContext
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

function modelNotes(v: TourBlockFields, ctx: TourBlockReadContext) {
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

function modelSections(v: TourBlockFields, ctx: TourBlockReadContext) {
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

function modelAnimation(v: TourBlockFields, ctx: TourBlockReadContext) {
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
function characterFields(v: TourBlockFields, ctx: TourBlockReadContext) {
  const name = requiredText(v, 'name', CHARACTER_RULES.name, ctx);
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

/** A cut-out's tag switch: absent, or true or false. */
function pictureShowTag(v: TourBlockFields, ctx: TourBlockReadContext) {
  const value = v.showTag;
  if (value === undefined) return {};
  if (typeof value !== 'boolean') {
    return problem(ctx, `"${ctx.at}.showTag" must be true or false`);
  }
  return { showTag: value };
}

/** Thrown by {@link viewpointOf} to stop at its first fault. */
class ViewpointFault extends Error {}

/** A viewpoint record as the format reads it, or why it breaks a rule. */
function viewpointOf(
  value: unknown,
  at: string
): TourPictureViewpoint | string {
  if (!isRecord(value)) return `"${at}" must be an object`;
  const stop = (message: string): never => {
    throw new ViewpointFault(message);
  };
  try {
    const { position, rotation } = parseTourLocalPose(value, at, stop);
    const { hfovDeg, distanceM } = value;
    if (
      !isFiniteNumber(hfovDeg) ||
      hfovDeg < TOUR_PICTURE_MIN_HFOV_DEG ||
      hfovDeg > TOUR_PICTURE_MAX_HFOV_DEG
    ) {
      return `"${at}.hfovDeg" must be a number of degrees from ${String(TOUR_PICTURE_MIN_HFOV_DEG)} to ${String(TOUR_PICTURE_MAX_HFOV_DEG)}`;
    }
    if (
      !isFiniteNumber(distanceM) ||
      distanceM < TOUR_PICTURE_MIN_DISTANCE_M ||
      distanceM > TOUR_PICTURE_MAX_DISTANCE_M
    ) {
      return `"${at}.distanceM" must be a number of metres from ${String(TOUR_PICTURE_MIN_DISTANCE_M)} to ${String(TOUR_PICTURE_MAX_DISTANCE_M)}`;
    }
    return { position, rotation, hfovDeg, distanceM };
  } catch (error) {
    if (error instanceof ViewpointFault) return error.message;
    throw error;
  }
}

/** A picture's viewpoint, in any view. One breaking a rule fails a file of
 *  this reader's own minor; a newer one's drops just the viewpoint (the
 *  picture is then drawn as a plane), keeping the picture. */
function pictureViewpoint(v: TourBlockFields, ctx: TourBlockReadContext) {
  const value = v.viewpoint;
  if (value === undefined) return {};
  const viewpoint = viewpointOf(value, `${ctx.at}.viewpoint`);
  if (typeof viewpoint !== 'string') return { viewpoint };
  if (!ctx.lenient) return ctx.fail(viewpoint);
  ctx.onDropped?.({
    kind: 'field',
    block: ctx.id,
    field: 'viewpoint',
    reason: viewpoint,
  });
  return {};
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
function narrationFault(
  value: TourBlockFields,
  ctx: TourBlockReadContext
): string | null {
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
function narrationOf(v: TourBlockFields, ctx: TourBlockReadContext) {
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

/** An asset a block names: its id, what it must be, and whether the format
 *  requires the tour to carry it (a picture a long text's body names may be
 *  missing: the visitor reads its alt text). */
export interface TourAssetRef {
  readonly id: string;
  readonly kind: TourAssetKind;
  readonly required: boolean;
  /** The block's own field that names it: the field holding the id (a
   *  picture's `image`, a video's `poster`), the record holding it (a long
   *  text's `narration`), or the text naming it (a long text's `body`). */
  readonly field: string;
  /** The block stands without that field (a long text's narration, a
   *  video's poster, a character's voice): dropping the field drops the
   *  reference. A required reference that is not optional is the block's
   *  own file: the block is made of it. */
  readonly optional?: true;
}

/** The reference `id` makes in the field `field`, when it is an id at
 *  all: `refs` also runs over a draft's raw record, before its fields were
 *  checked. `standsWithout`: the block stands without the field
 *  ({@link TourAssetRef.optional}). */
function refTo(
  id: unknown,
  kind: TourAssetKind,
  field: string,
  standsWithout?: 'optional'
): TourAssetRef[] {
  if (!isTourId(id)) return [];
  return [
    standsWithout === undefined
      ? { id, kind, required: true, field }
      : { id, kind, required: true, field, optional: true },
  ];
}

/** One line per kind: what the list's rows are checked against. */
export interface TourBlockOfKind {
  shortText: TourShortTextBlock;
  longText: TourLongTextBlock;
  picture: TourPictureBlock;
  video: TourVideoBlock;
  audio: TourAudioBlock;
  model: TourModelBlock;
  character: TourCharacterBlock;
}

/** What a block is. */
export type TourBlockKind = keyof TourBlockOfKind;

export type TourBlock = TourBlockOfKind[TourBlockKind];

/** What the format knows about one kind. */
export interface TourKindRow<B extends { readonly view: string }> {
  /** The minor that brought this kind. A kind added after a release says
   *  so here, or an older viewer fails the whole tour instead of skipping
   *  the block ({@link tourBlockMinor}). */
  readonly sinceMinor: number;
  /** The views newer than the kind, by the minor that brought them. */
  readonly viewsSince?: { readonly [V in B['view']]?: number };
  /** The views this reader draws. */
  readonly views: readonly B['view'][];
  /** The views a FREE block may hold. Every kind works directly in a
   *  station; a view may belong to a story alone (`card` for a
   *  kind with a look of its own in the world, which nothing would reach). */
  readonly freeViews: readonly B['view'][];
  /** The views drawn in the world for as long as their block is present
   *  (`TOUR_WORLD_VIEWS`). */
  readonly worldViews: readonly B['view'][];
  /** What a free block falls back to when its own view is unknown here. */
  readonly floor: B['view'];
  /** Every capped text of the kind. */
  readonly text: Readonly<Record<string, TourTextRule>>;
  /** The kind's own fields, in the order a writer writes them; `view` is
   *  null when a lenient reader does not know it. Writes no envelope field. */
  read(
    v: TourBlockFields,
    view: string | null,
    ctx: TourBlockReadContext
  ): TourBlockFields;
  /** The assets a block names, shown or not: a wider list than what one
   *  view reads, so a write keeps what another view would read. Partial,
   *  because it also runs over a draft's unchecked record. */
  refs(block: Partial<B>): readonly TourAssetRef[];
}

/** THE list. Key order is the order of every derived table. */
export const TOUR_KINDS = {
  shortText: {
    sinceMinor: 0,
    views: SHORT_TEXT_VIEWS,
    freeViews: ['pin'],
    worldViews: ['pin'],
    floor: 'pin',
    text: SHORT_TEXT_RULES,
    read: (v, _view, ctx) => ({
      caption: requiredText(v, 'caption', SHORT_TEXT_RULES.caption, ctx),
      ...optionalText(v, 'description', SHORT_TEXT_RULES.description, ctx),
    }),
    refs: () => [],
  },
  longText: {
    sinceMinor: 0,
    views: LONG_TEXT_VIEWS,
    freeViews: ['lectern', 'reading'],
    worldViews: ['lectern', 'reading'],
    floor: 'reading',
    text: LONG_TEXT_RULES,
    read: (v, _view, ctx) => ({
      title: requiredText(v, 'title', LONG_TEXT_RULES.title, ctx),
      body: requiredText(v, 'body', LONG_TEXT_RULES.body, ctx),
      ...narrationOf(v, ctx),
    }),
    refs: (b) => {
      const body =
        typeof b.body === 'string'
          ? blockBodyAssets(b as { readonly body: string })
          : [];
      const narration: unknown = b.narration;
      return [
        ...body.map(
          (id) =>
            ({ id, kind: 'image', required: false, field: 'body' }) as const
        ),
        ...refTo(
          isRecord(narration) ? narration.audio : undefined,
          'audio',
          'narration',
          'optional'
        ),
      ];
    },
  },
  picture: {
    sinceMinor: 0,
    views: PICTURE_VIEWS,
    freeViews: TOUR_PICTURE_WORLD_VIEWS,
    worldViews: TOUR_PICTURE_WORLD_VIEWS,
    floor: 'plane',
    text: PICTURE_RULES,
    read: (v, _view, ctx) => ({
      image: assetRef(v, 'image', 'image', ctx),
      ...optionalText(v, 'title', PICTURE_RULES.title, ctx),
      ...optionalText(v, 'caption', PICTURE_RULES.caption, ctx),
      ...optionalText(v, 'alt', PICTURE_RULES.alt, ctx),
      ...optionalText(v, 'credit', PICTURE_RULES.credit, ctx),
      ...optionalText(v, 'year', PICTURE_RULES.year, ctx),
      widthM: metres(
        v.widthM,
        `${ctx.at}.widthM`,
        [TOUR_PICTURE_MIN_WIDTH_M, TOUR_PICTURE_MAX_WIDTH_M],
        ctx
      ),
      ...pictureShowTag(v, ctx),
      ...pictureViewpoint(v, ctx),
    }),
    refs: (b) => refTo(b.image, 'image', 'image'),
  },
  video: {
    sinceMinor: 0,
    views: VIDEO_VIEWS,
    // `card` until a world view joins the format: the file then names no
    // look, and the viewer draws what it has for it.
    freeViews: ['card'],
    worldViews: [],
    floor: 'card',
    text: VIDEO_RULES,
    read: (v, _view, ctx) => ({
      video: assetRef(v, 'video', 'video', ctx),
      ...optionalText(v, 'transcript', VIDEO_RULES.transcript, ctx),
      ...optionalText(v, 'title', VIDEO_RULES.title, ctx),
      ...optionalAssetRef(v, 'poster', 'image', ctx),
    }),
    refs: (b) => [
      ...refTo(b.video, 'video', 'video'),
      ...refTo(b.poster, 'image', 'poster', 'optional'),
    ],
  },
  audio: {
    sinceMinor: 0,
    views: AUDIO_VIEWS,
    // Free, it stands in the world; its card is a story's.
    freeViews: ['spot', 'zone'],
    worldViews: ['spot', 'zone'],
    floor: 'spot',
    text: AUDIO_RULES,
    read: (v, view, ctx) => ({
      audio: assetRef(v, 'audio', 'audio', ctx),
      ...optionalText(v, 'transcript', AUDIO_RULES.transcript, ctx),
      ...optionalText(v, 'title', AUDIO_RULES.title, ctx),
      ...audioWorld(v, view, ctx),
    }),
    refs: (b) => refTo(b.audio, 'audio', 'audio'),
  },
  model: {
    sinceMinor: 0,
    views: MODEL_VIEWS,
    freeViews: TOUR_MODEL_WORLD_VIEWS,
    worldViews: TOUR_MODEL_WORLD_VIEWS,
    floor: 'placed',
    text: MODEL_RULES,
    read: (v, view, ctx) => ({
      asset: assetRef(v, 'asset', 'model', ctx),
      ...modelSize(v, view, ctx),
      ...optionalText(v, 'title', MODEL_RULES.title, ctx),
      ...modelAnimation(v, ctx),
      ...modelNotes(v, ctx),
      ...modelSections(v, ctx),
    }),
    refs: (b) => refTo(b.asset, 'model', 'asset'),
  },
  character: {
    sinceMinor: 0,
    views: CHARACTER_VIEWS,
    freeViews: TOUR_CHARACTER_VIEWS,
    worldViews: [],
    // The view that stands him as a figure and keeps a tap on his voice.
    floor: 'speak',
    text: CHARACTER_RULES,
    read: (v, _view, ctx) => ({
      ...characterFields(v, ctx),
      ...optionalText(v, 'caption', CHARACTER_RULES.caption, ctx),
      ...optionalAssetRef(v, 'voice', 'audio', ctx),
    }),
    refs: (b) => [
      ...refTo(b.image, 'image', 'image'),
      ...refTo(b.voice, 'audio', 'voice', 'optional'),
    ],
  },
} as const satisfies {
  readonly [K in TourBlockKind]: TourKindRow<TourBlockOfKind[K]>;
};

/** What a walk over rows of any kind reads of them. */
type RowMinors = Pick<
  TourKindRow<{ readonly view: string }>,
  'sinceMinor' | 'viewsSince'
>;

/** Whether `value` is a kind this reader knows. */
export function isTourBlockKind(value: unknown): value is TourBlockKind {
  return typeof value === 'string' && Object.hasOwn(TOUR_KINDS, value);
}

/** The kinds, in the list's order. */
export function tourBlockKinds(): TourBlockKind[] {
  return Object.keys(TOUR_KINDS) as TourBlockKind[];
}

/** The assets `block` names ({@link TourKindRow.refs}); none for a value of
 *  no kind this reader knows. */
export function tourBlockRefs(block: {
  readonly kind?: unknown;
}): readonly TourAssetRef[] {
  const { kind } = block;
  if (!isTourBlockKind(kind)) return [];
  const row = TOUR_KINDS[kind] as Pick<
    TourKindRow<{ readonly view: string }>,
    'refs'
  >;
  return row.refs(block as { readonly view?: string });
}

/** The ids of the assets a tour keeps for `block`, each as often as it is
 *  named. `requiredOnly`: without what the format lets be missing. */
export function tourBlockAssetIds(
  block: { readonly kind?: unknown },
  requiredOnly = false
): readonly string[] {
  return tourBlockRefs(block)
    .filter((ref) => ref.required || !requiredOnly)
    .map((ref) => ref.id);
}

/** The newest minor any row of `kinds` knows: the minor a reader of this
 *  list is strict about. */
export function tourKindsMinor(
  kinds: Readonly<Record<string, RowMinors>> = TOUR_KINDS
): number {
  return Math.max(
    ...Object.values(kinds).flatMap((row) => [
      row.sinceMinor,
      ...Object.values<number | undefined>(row.viewsSince ?? {}).map(
        (minor) => minor ?? 0
      ),
    ])
  );
}

/** The lowest minor a reader needs to show `block`: a file holding a newer
 *  kind or view is written at that minor, so an older viewer skips the
 *  block instead of failing the tour. */
export function tourBlockMinor(
  block: { readonly kind: string; readonly view: string },
  kinds: Readonly<Record<string, RowMinors | undefined>> = TOUR_KINDS
): number {
  const row = kinds[block.kind];
  if (row === undefined) return 0;
  const views: Readonly<Record<string, number | undefined>> =
    row.viewsSince ?? {};
  return Math.max(row.sinceMinor, views[block.view] ?? 0);
}
