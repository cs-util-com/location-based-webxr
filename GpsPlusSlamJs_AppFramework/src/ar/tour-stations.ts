/**
 * The game content of `tour.json` version 2 (tour kit plan K1, §8 D7: the
 * full schema in one step): media ASSETS with their own ids, STATIONS with
 * an anchor and two radii, each station's STEPS (text, image, cut-out
 * character, audio, video, 3D model, a scene choice, a quiz), how a step
 * advances, and for answer-routed order the next station per answer.
 *
 * K1 defines and validates this; nothing renders it yet (stations and the
 * scene player are K4, quizzes at runtime K5). That is deliberate: the
 * format a creator's file is written in must be settled before the first
 * file exists, and a later reader can only be lenient about what an
 * earlier writer could not have produced.
 *
 * Defensive by the rule of `tour-manifest.ts`: hand-editable external data,
 * every field checked at the boundary, every cross-reference resolved here
 * (an asset of the right kind, a choice's target step, a route's target
 * station, a correct answer among the options), so a renderer never meets
 * a dangling id in the middle of a walk. Unknown fields are ignored, which
 * is the version policy of `tour-manifest.ts`. The caller's `fail` throws
 * its own validation error (the manifest's), so this module needs no error
 * class and no import of its parent (`check:cycles`).
 *
 * LENIENT for a NEWER MINOR (K1 milestone review R4): the closed lists here
 * - block kind, quiz type, advance mode, hint, an asset's media type - are
 * what a later additive minor extends. When the caller says the file is of
 * a newer minor (`lenient`), an unknown value degrades instead of failing
 * the tour: an asset of an unknown type is left out, a step whose block,
 * quiz type or asset this reader cannot show is skipped (a scene choice
 * left with fewer than two reachable options is skipped with it), an
 * unknown advance mode is "tap", an unknown hint the arrow. Everything a
 * renderer meets still resolves. At the reader's own minor or below the
 * same value is a broken file and fails.
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import { parseGeoPose } from './qr/geo-pose.js';
import { isWritableQrLevelId } from './qr/qr-level-archive.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';
import { tourMediaTypeOf } from './tour-media.js';

type Fail = (message: string) => never;

/** Thrown inside a step's parse when a lenient reader cannot show it; the
 *  step catches it and is left out (R4). Never escapes this module. */
class SkippedStep extends Error {}

/** An unknown value of a closed list: skips the step for a lenient reader,
 *  fails the file for a strict one. */
function unknownValue(ctx: BlockContext, message: string): never {
  if (ctx.lenient) throw new SkippedStep();
  return ctx.fail(message);
}

/** What an asset is, from its file's extension (the media allowlist). */
export type TourAssetKind = 'image' | 'model' | 'audio' | 'video';

/** One media file of the tour, named by its own id (§8 G5). */
export interface TourAsset {
  /** Short path-safe id; also the content file's stem. */
  readonly id: string;
  /** `content/<id>.<ext>`, the extension an allowlisted media type. */
  readonly path: string;
  /** Derived from the extension, never stored: one source of truth. */
  readonly kind: TourAssetKind;
  /** Pixel size, images only (an aspect-correct plane without decoding). */
  readonly width?: number;
  readonly height?: number;
}

export type TourOrder = 'fixed' | 'any' | 'branch';

/** Where a station is: a printed code's level id, a geo pose, or both.
 *  A code gives the 2-5 m "found you"; GPS alone only coarse activation. */
export interface TourStationAnchor {
  readonly code?: string;
  readonly geo?: QrGeoPose;
}

export type TourStepAdvance =
  { readonly mode: 'tap' } | { readonly mode: 'auto'; readonly afterS: number };

export interface TourChoiceOption {
  readonly id: string;
  readonly label: string;
  /** A step of the same station. */
  readonly goto: string;
}

export interface TourQuizOption {
  readonly id: string;
  readonly label: string;
}

/** Text and code answers are salted SHA-256 hex digests of the accepted
 *  answers after K5's normalisation (a deterrent only, plan K5); choice and
 *  number answers are in clear, since points stay on the phone. */
export type TourQuizAnswer =
  | {
      readonly type: 'single';
      readonly options: readonly TourQuizOption[];
      readonly correct: string;
    }
  | {
      readonly type: 'multiple';
      readonly options: readonly TourQuizOption[];
      readonly correct: readonly string[];
    }
  | {
      readonly type: 'text' | 'code';
      readonly salt: string;
      readonly sha256: readonly string[];
    }
  | {
      readonly type: 'number';
      readonly value: number;
      readonly tolerance: number;
      readonly unit?: string;
    };

/** For `branch` order: the next station by answer. */
export interface TourQuizRoute {
  readonly byOption?: Readonly<Record<string, string>>;
  readonly correct?: string;
  readonly wrong?: string;
}

export type TourBlock =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'image';
      readonly asset: string;
      readonly caption?: string;
    }
  | {
      readonly kind: 'character';
      readonly name: string;
      /** A cut-out image asset. */
      readonly image: string;
      /** Captions always (audio needs a text version). */
      readonly caption: string;
      /** An optional voice clip (an audio asset). */
      readonly voice?: string;
    }
  | {
      readonly kind: 'audio' | 'video';
      readonly asset: string;
      readonly transcript: string;
    }
  | {
      readonly kind: 'model';
      readonly asset: string;
      readonly caption?: string;
    }
  | {
      readonly kind: 'choice';
      readonly prompt: string;
      readonly options: readonly TourChoiceOption[];
    }
  | {
      readonly kind: 'quiz';
      readonly question: string;
      readonly points: number;
      readonly answer: TourQuizAnswer;
      readonly route?: TourQuizRoute;
    };

export interface TourStep {
  readonly id: string;
  readonly block: TourBlock;
  readonly advance: TourStepAdvance;
}

export interface TourStation {
  readonly id: string;
  readonly title?: string;
  readonly anchor: TourStationAnchor;
  readonly activateRadiusM: number;
  readonly foundRadiusM: number;
  /** v1 hint mode (K-D6): the HUD's exact arrow plus distance. */
  readonly hint: 'arrow';
  readonly steps: readonly TourStep[];
  /** For `branch` order: the default next station. */
  readonly next?: string;
}

/** Ids of assets, stations, steps and options: short, one path segment. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** An asset's content path, capturing the extension. */
const ASSET_PATH = /^content\/[A-Za-z0-9_-]+\.([a-z0-9]{1,5})$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

function requireId(value: unknown, at: string, fail: Fail): string {
  if (!isId(value)) fail(`"${at}" must be a short path-safe id`);
  return value;
}

/** A non-blank string, or undefined. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function requireText(value: unknown, at: string, fail: Fail): string {
  const text = textOf(value);
  if (text === undefined) fail(`"${at}" must be a non-empty string`);
  return text;
}

function optionalText(value: unknown): { caption?: string } {
  const text = textOf(value);
  return text === undefined ? {} : { caption: text };
}

function requireArray(value: unknown, at: string, fail: Fail): unknown[] {
  if (!Array.isArray(value)) fail(`"${at}" must be an array`);
  return value;
}

function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0;
}

function assertUnique(
  ids: readonly string[],
  what: string,
  at: string,
  fail: Fail
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(`${at}duplicate ${what} id "${id}"`);
    seen.add(id);
  }
}

// --- assets -----------------------------------------------------------

function parseAssetSize(
  value: Record<string, unknown>,
  kind: TourAssetKind,
  at: string,
  fail: Fail
): { width?: number; height?: number } {
  const { width, height } = value;
  if (width === undefined && height === undefined) return {};
  if (kind !== 'image') fail(`"${at}.width"/"height" are only for an image`);
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    fail(`"${at}.width"/"height" must be positive integers`);
  }
  return { width, height };
}

/** An asset's path `content/<id>.<ext>` with its media type; `unknown-type`
 *  for a well-formed path of a type not on the allowlist; null otherwise. */
function assetMediaOf(
  value: unknown,
  id: string
):
  | { path: string; type: NonNullable<ReturnType<typeof tourMediaTypeOf>> }
  | 'unknown-type'
  | null {
  if (typeof value !== 'string') return null;
  const extension = ASSET_PATH.exec(value)?.[1];
  if (extension === undefined || value !== `content/${id}.${extension}`) {
    return null;
  }
  const type = tourMediaTypeOf(extension);
  return type === null ? 'unknown-type' : { path: value, type };
}

/** An asset, or null when a lenient reader does not know its media type
 *  (a well-formed `content/<id>.<ext>` of a type a newer app added). */
function parseAsset(
  value: unknown,
  at: string,
  fail: Fail,
  lenient: boolean
): TourAsset | null {
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  const id = requireId(value.id, `${at}.id`, fail);
  const media = assetMediaOf(value.path, id);
  if (media === 'unknown-type' && lenient) return null;
  if (media === null || media === 'unknown-type') {
    fail(
      `"${at}.path" must be content/${id}.<ext> (an allowlisted media type)`
    );
  }
  const { path, type } = media;
  return {
    id,
    path,
    kind: type.kind,
    ...parseAssetSize(value, type.kind, at, fail),
  };
}

/**
 * Validate the tour's media assets. An asset id must not repeat, and must
 * not be an object id: both name a content file by id
 * (`content/<id>.<ext>`), so a shared id could make two records claim one
 * file. `lenient` (a newer minor) leaves out an asset of an unknown media
 * type; a step that names it is then skipped.
 */
export function parseTourAssets(
  value: unknown,
  options: { objectIds: ReadonlySet<string>; fail: Fail; lenient?: boolean }
): TourAsset[] {
  const { fail } = options;
  const lenient = options.lenient === true;
  const assets = requireArray(value, 'assets', fail).flatMap((a, i) => {
    const asset = parseAsset(a, `assets[${String(i)}]`, fail, lenient);
    return asset === null ? [] : [asset];
  });
  assertUnique(
    assets.map((a) => a.id),
    'asset',
    '',
    fail
  );
  assets.forEach((asset, i) => {
    if (options.objectIds.has(asset.id)) {
      fail(`"assets[${String(i)}].id" "${asset.id}" is already an object id`);
    }
  });
  return assets;
}

// --- blocks -----------------------------------------------------------

interface BlockContext {
  readonly assets: ReadonlyMap<string, TourAsset>;
  readonly fail: Fail;
  /** A newer minor: what this reader cannot show is skipped (R4). */
  readonly lenient: boolean;
}

function requireAsset(
  value: unknown,
  kind: TourAssetKind,
  at: string,
  ctx: BlockContext
): string {
  const asset = typeof value === 'string' ? ctx.assets.get(value) : undefined;
  if (asset?.kind !== kind) {
    // A newer minor may name an asset this reader left out, or allow
    // another kind here: the step cannot be shown, so it is skipped.
    if (ctx.lenient) throw new SkippedStep();
    const article = kind === 'image' || kind === 'audio' ? 'an' : 'a';
    ctx.fail(`"${at}" must name ${article} ${kind} asset`);
  }
  return asset.id;
}

function parseCharacter(
  v: Record<string, unknown>,
  at: string,
  ctx: BlockContext
): TourBlock {
  const voice =
    v.voice === undefined
      ? {}
      : { voice: requireAsset(v.voice, 'audio', `${at}.voice`, ctx) };
  return {
    kind: 'character',
    name: requireText(v.name, `${at}.name`, ctx.fail),
    image: requireAsset(v.image, 'image', `${at}.image`, ctx),
    caption: requireText(v.caption, `${at}.caption`, ctx.fail),
    ...voice,
  };
}

function parseChoiceOption(
  value: unknown,
  at: string,
  fail: Fail
): TourChoiceOption {
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  return {
    id: requireId(value.id, `${at}.id`, fail),
    label: requireText(value.label, `${at}.label`, fail),
    goto: requireId(value.goto, `${at}.goto`, fail),
  };
}

function parseChoice(
  v: Record<string, unknown>,
  at: string,
  fail: Fail
): TourBlock {
  const options = requireArray(v.options, `${at}.options`, fail).map((o, i) =>
    parseChoiceOption(o, `${at}.options[${String(i)}]`, fail)
  );
  if (options.length < 2) {
    fail(`"${at}.options" must list at least 2 options`);
  }
  assertUnique(
    options.map((o) => o.id),
    'option',
    `${at}.options: `,
    fail
  );
  return {
    kind: 'choice',
    prompt: requireText(v.prompt, `${at}.prompt`, fail),
    options,
  };
}

/** The media blocks: one asset of the block's own kind each. */
function parseMedia(
  kind: 'image' | 'audio' | 'video' | 'model',
  v: Record<string, unknown>,
  at: string,
  ctx: BlockContext
): TourBlock {
  const asset = requireAsset(v.asset, kind, `${at}.asset`, ctx);
  if (kind === 'audio' || kind === 'video') {
    const transcript = requireText(v.transcript, `${at}.transcript`, ctx.fail);
    return { kind, asset, transcript };
  }
  return { kind, asset, ...optionalText(v.caption) };
}

function parseBlock(value: unknown, at: string, ctx: BlockContext): TourBlock {
  if (!isRecord(value)) ctx.fail(`"${at}" must be an object`);
  switch (value.kind) {
    case 'text':
      return {
        kind: 'text',
        text: requireText(value.text, `${at}.text`, ctx.fail),
      };
    case 'image':
    case 'audio':
    case 'video':
    case 'model':
      return parseMedia(value.kind, value, at, ctx);
    case 'character':
      return parseCharacter(value, at, ctx);
    case 'choice':
      return parseChoice(value, at, ctx.fail);
    case 'quiz':
      return parseQuiz(value, at, ctx);
    default:
      return unknownValue(
        ctx,
        `"${at}.kind" must be text, image, character, audio, video, model, choice or quiz`
      );
  }
}

// --- quizzes ----------------------------------------------------------

function parseQuizOptions(
  value: unknown,
  at: string,
  fail: Fail
): TourQuizOption[] {
  const options = requireArray(value, at, fail).map((o, i) => {
    const oat = `${at}[${String(i)}]`;
    if (!isRecord(o)) fail(`"${oat}" must be an object`);
    return {
      id: requireId(o.id, `${oat}.id`, fail),
      label: requireText(o.label, `${oat}.label`, fail),
    };
  });
  if (options.length < 2) fail(`"${at}" must list at least 2 options`);
  assertUnique(
    options.map((o) => o.id),
    'option',
    `${at}: `,
    fail
  );
  return options;
}

function parseChoiceAnswer(
  type: 'single' | 'multiple',
  v: Record<string, unknown>,
  at: string,
  fail: Fail
): TourQuizAnswer {
  const options = parseQuizOptions(v.options, `${at}.options`, fail);
  const ids = new Set(options.map((o) => o.id));
  if (type === 'single') {
    if (typeof v.correct !== 'string' || !ids.has(v.correct)) {
      fail(`"${at}.correct" must name one of its options`);
    }
    return { type, options, correct: v.correct };
  }
  const correct = Array.isArray(v.correct) ? v.correct : [];
  if (
    correct.length === 0 ||
    new Set(correct).size !== correct.length ||
    !correct.every((c) => typeof c === 'string' && ids.has(c))
  ) {
    fail(`"${at}.correct" must list at least one of its options, each once`);
  }
  return { type, options, correct: correct as string[] };
}

function parseHashedAnswer(
  type: 'text' | 'code',
  v: Record<string, unknown>,
  at: string,
  fail: Fail
): TourQuizAnswer {
  const salt = requireText(v.salt, `${at}.salt`, fail);
  const hashes = requireArray(v.sha256, `${at}.sha256`, fail);
  if (hashes.length === 0) fail(`"${at}.sha256" must list at least one hash`);
  hashes.forEach((h, i) => {
    if (typeof h !== 'string' || !SHA256_HEX.test(h)) {
      fail(`"${at}.sha256[${String(i)}]" must be lowercase SHA-256 hex`);
    }
  });
  return { type, salt, sha256: hashes as string[] };
}

function parseNumberAnswer(
  v: Record<string, unknown>,
  at: string,
  fail: Fail
): TourQuizAnswer {
  if (!isFiniteNumber(v.value)) fail(`"${at}.value" must be a finite number`);
  if (!isFiniteNumber(v.tolerance) || v.tolerance < 0) {
    fail(`"${at}.tolerance" must be a number >= 0`);
  }
  const unit = textOf(v.unit);
  return {
    type: 'number',
    value: v.value,
    tolerance: v.tolerance,
    ...(unit === undefined ? {} : { unit }),
  };
}

function parseAnswer(
  value: unknown,
  at: string,
  ctx: BlockContext
): TourQuizAnswer {
  const fail: Fail = ctx.fail;
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  switch (value.type) {
    case 'single':
    case 'multiple':
      return parseChoiceAnswer(value.type, value, at, fail);
    case 'text':
    case 'code':
      return parseHashedAnswer(value.type, value, at, fail);
    case 'number':
      return parseNumberAnswer(value, at, fail);
    default:
      return unknownValue(
        ctx,
        `"${at}.type" must be single, multiple, text, number or code`
      );
  }
}

function parseRoute(
  value: unknown,
  answer: TourQuizAnswer,
  at: string,
  fail: Fail
): TourQuizRoute {
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  const route: {
    byOption?: Record<string, string>;
    correct?: string;
    wrong?: string;
  } = {};
  for (const key of ['correct', 'wrong'] as const) {
    if (value[key] !== undefined)
      route[key] = requireId(value[key], `${at}.${key}`, fail);
  }
  if (value.byOption !== undefined) {
    route.byOption = parseByOption(
      value.byOption,
      answer,
      `${at}.byOption`,
      fail
    );
  }
  return route;
}

function parseByOption(
  value: unknown,
  answer: TourQuizAnswer,
  at: string,
  fail: Fail
): Record<string, string> {
  if (answer.type !== 'single' && answer.type !== 'multiple') {
    fail(`"${at}" is only for a choice quiz`);
  }
  if (!isRecord(value) || Array.isArray(value))
    fail(`"${at}" must be an object`);
  const ids = new Set(answer.options.map((o) => o.id));
  const out: Record<string, string> = {};
  for (const [option, station] of Object.entries(value)) {
    if (!ids.has(option)) {
      fail(`"${at}" names "${option}", which is not one of its options`);
    }
    out[option] = requireId(station, `${at}.${option}`, fail);
  }
  return out;
}

function parseQuiz(
  v: Record<string, unknown>,
  at: string,
  ctx: BlockContext
): TourBlock {
  const fail: Fail = ctx.fail;
  const { points } = v;
  if (!isFiniteNumber(points) || !Number.isInteger(points) || points < 0) {
    fail(`"${at}.points" must be an integer >= 0`);
  }
  const answer = parseAnswer(v.answer, `${at}.answer`, ctx);
  const route =
    v.route === undefined
      ? {}
      : { route: parseRoute(v.route, answer, `${at}.route`, fail) };
  return {
    kind: 'quiz',
    question: requireText(v.question, `${at}.question`, fail),
    points,
    answer,
    ...route,
  };
}

// --- steps and stations ------------------------------------------------

function parseAdvance(
  value: unknown,
  at: string,
  ctx: BlockContext
): TourStepAdvance {
  const fail: Fail = ctx.fail;
  if (value === undefined) return { mode: 'tap' };
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  if (value.mode === 'tap') return { mode: 'tap' };
  if (value.mode !== 'auto') {
    // A newer minor's mode: the visitor taps on, as with no rule at all.
    if (ctx.lenient) return { mode: 'tap' };
    fail(`"${at}.mode" must be "tap" or "auto"`);
  }
  if (!isFiniteNumber(value.afterS) || value.afterS <= 0) {
    fail(`"${at}.afterS" must be a number of seconds > 0`);
  }
  return { mode: 'auto', afterS: value.afterS };
}

/** A step, or null when a lenient reader cannot show its block. */
function parseStep(
  value: unknown,
  at: string,
  ctx: BlockContext
): TourStep | null {
  if (!isRecord(value)) ctx.fail(`"${at}" must be an object`);
  const id = requireId(value.id, `${at}.id`, ctx.fail);
  let block: TourBlock;
  try {
    block = parseBlock(value.block, `${at}.block`, ctx);
  } catch (err) {
    if (err instanceof SkippedStep) return null;
    throw err;
  }
  return {
    id,
    block,
    advance: parseAdvance(value.advance, `${at}.advance`, ctx),
  };
}

/**
 * After a lenient reader skipped steps: a scene choice keeps only the
 * options whose target step is still there, and a choice left with fewer
 * than two is skipped too - repeated, because skipping a choice can strand
 * another choice that jumped to it. Ends: every round removes something.
 */
function withoutStrandedChoices(steps: readonly TourStep[]): TourStep[] {
  let kept = [...steps];
  for (;;) {
    const ids = new Set(kept.map((s) => s.id));
    let changed = false;
    const next = kept.flatMap((step): TourStep[] => {
      if (step.block.kind !== 'choice') return [step];
      const options = step.block.options.filter((o) => ids.has(o.goto));
      if (options.length === step.block.options.length) return [step];
      changed = true;
      return options.length < 2
        ? []
        : [{ ...step, block: { ...step.block, options } }];
    });
    if (!changed) return next;
    kept = next;
  }
}

function parseAnchor(
  value: unknown,
  at: string,
  fail: Fail
): TourStationAnchor {
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  if (value.code === undefined && value.geo === undefined) {
    fail(`"${at}" needs a code, a geo pose, or both`);
  }
  if (value.code !== undefined && !isWritableQrLevelId(value.code)) {
    fail(`"${at}.code" must be a printed code's level id`);
  }
  return {
    ...(value.code === undefined ? {} : { code: value.code }),
    ...(value.geo === undefined
      ? {}
      : { geo: parseGeoPose(value.geo, { path: `${at}.geo`, fail }) }),
  };
}

function parseRadii(
  v: Record<string, unknown>,
  at: string,
  fail: Fail
): { activateRadiusM: number; foundRadiusM: number } {
  const { activateRadiusM, foundRadiusM } = v;
  for (const [name, r] of [
    ['activateRadiusM', activateRadiusM],
    ['foundRadiusM', foundRadiusM],
  ] as const) {
    if (!isFiniteNumber(r) || r <= 0)
      fail(`"${at}.${name}" must be a number of metres > 0`);
  }
  const activate = activateRadiusM as number;
  const found = foundRadiusM as number;
  if (found > activate) {
    fail(`"${at}.foundRadiusM" must not exceed "activateRadiusM"`);
  }
  return { activateRadiusM: activate, foundRadiusM: found };
}

function parseStation(
  value: unknown,
  at: string,
  ctx: BlockContext
): TourStation {
  const fail: Fail = ctx.fail;
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  // A newer minor's hint mode falls back to the arrow (R4).
  if (value.hint !== undefined && value.hint !== 'arrow' && !ctx.lenient) {
    fail(`"${at}.hint" must be "arrow"`);
  }
  const steps = requireArray(value.steps, `${at}.steps`, fail);
  if (steps.length === 0) fail(`"${at}.steps" must be a non-empty array`);
  const parsed = steps.flatMap((s, i) => {
    const step = parseStep(s, `${at}.steps[${String(i)}]`, ctx);
    return step === null ? [] : [step];
  });
  const title = textOf(value.title);
  return {
    id: requireId(value.id, `${at}.id`, fail),
    ...(title === undefined ? {} : { title }),
    anchor: parseAnchor(value.anchor, `${at}.anchor`, fail),
    ...parseRadii(value, at, fail),
    hint: 'arrow',
    // Lenient: a station whose every step was skipped keeps no steps, so
    // finding it completes it; it stays, because routes may name it.
    steps: ctx.lenient ? withoutStrandedChoices(parsed) : parsed,
    ...(value.next === undefined
      ? {}
      : { next: requireId(value.next, `${at}.next`, fail) }),
  };
}

/** Every reference between steps and stations resolves. */
function checkReferences(stations: readonly TourStation[], fail: Fail): void {
  const stationIds = new Set(stations.map((s) => s.id));
  const requireStation = (id: string | undefined, at: string): void => {
    if (id !== undefined && !stationIds.has(id))
      fail(`"${at}" must name a station`);
  };
  stations.forEach((station, si) => {
    const at = `stations[${String(si)}]`;
    requireStation(station.next, `${at}.next`);
    assertUnique(
      station.steps.map((s) => s.id),
      'step',
      `${at}: `,
      fail
    );
    const stepIds = new Set(station.steps.map((s) => s.id));
    station.steps.forEach((step, i) => {
      checkStepReferences(
        step,
        `${at}.steps[${String(i)}].block`,
        stepIds,
        requireStation,
        fail
      );
    });
  });
}

function checkStepReferences(
  step: TourStep,
  at: string,
  stepIds: ReadonlySet<string>,
  requireStation: (id: string | undefined, at: string) => void,
  fail: Fail
): void {
  const block = step.block;
  if (block.kind === 'choice') {
    block.options.forEach((option, i) => {
      if (!stepIds.has(option.goto)) {
        fail(
          `"${at}.options[${String(i)}].goto" must name a step of this station`
        );
      }
    });
  }
  if (block.kind !== 'quiz' || block.route === undefined) return;
  requireStation(block.route.correct, `${at}.route.correct`);
  requireStation(block.route.wrong, `${at}.route.wrong`);
  for (const [option, station] of Object.entries(block.route.byOption ?? {})) {
    requireStation(station, `${at}.route.byOption.${option}`);
  }
}

/**
 * Validate the tour's stations against its (already validated) assets.
 * Station ids are unique; step ids are unique per station; every asset a
 * block names exists and is of the block's kind; every choice target, next
 * station and route target resolves. `lenient` (a newer minor) skips what
 * this reader cannot show instead of failing (see the module comment).
 */
export function parseTourStations(
  value: unknown,
  options: { assets: readonly TourAsset[]; fail: Fail; lenient?: boolean }
): TourStation[] {
  const { fail } = options;
  const ctx: BlockContext = {
    assets: new Map(options.assets.map((a) => [a.id, a])),
    fail,
    lenient: options.lenient === true,
  };
  const stations = requireArray(value, 'stations', fail).map((s, i) =>
    parseStation(s, `stations[${String(i)}]`, ctx)
  );
  assertUnique(
    stations.map((s) => s.id),
    'station',
    '',
    fail
  );
  checkReferences(stations, fail);
  return stations;
}
