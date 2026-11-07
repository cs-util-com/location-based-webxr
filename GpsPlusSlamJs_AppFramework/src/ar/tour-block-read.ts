/**
 * The toolkit a kind's reader is written with: the text rules and the one
 * count every cap uses, and the checks of one block's fields. A kind's row
 * (`tour-kinds.ts`) and the block envelope (`tour-blocks.ts`) both read
 * through it, so a rule has one wording and one strictness.
 *
 * STRICT or LENIENT by the context: {@link problem} is a rule a later minor
 * may relax (it skips the block in a file of a newer minor and fails a file
 * of this reader's own), while `ctx.fail` is a fault no revision can make
 * valid.
 *
 * @see tour-block-read.ts.md
 */

import { isFiniteNumber } from '../utils/json-guards.js';
import type { TourAssetKind } from './tour-assets.js';
import type { TourFail } from './tour-fields.js';

/** A block's raw fields, as the file holds them. */
export type TourBlockFields = Readonly<Record<string, unknown>>;

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

export const required = (max: number, unit: TourTextUnit = 'codePoints') =>
  ({ max, unit, required: true }) as const;
export const optional = (max: number) =>
  ({ max, unit: 'codePoints', required: false }) as const;

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

/** What a block takes from a declared character. */
export interface TourDeclaredCharacter {
  readonly name: string;
  readonly image: string;
}

/** Thrown inside one block's read when a lenient reader cannot show it;
 *  caught per block (`tour-blocks.ts`). */
export class TourSkippedBlock extends Error {}

/** One block's read: where it is, what the tour declares, how it fails. */
export interface TourBlockReadContext {
  readonly at: string;
  readonly id: string;
  readonly assets: ReadonlyMap<string, TourAssetKind>;
  readonly characters: ReadonlyMap<string, TourDeclaredCharacter>;
  readonly fail: TourFail;
  readonly lenient: boolean;
  readonly onDropped: ((drop: TourBlockDrop) => void) | undefined;
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

/** A rule a later minor may relax: skips the block for a lenient reader,
 *  fails the file for a strict one. */
export function problem(ctx: TourBlockReadContext, message: string): never {
  if (ctx.lenient) throw new TourSkippedBlock(message);
  return ctx.fail(message);
}

export function requiredText(
  v: TourBlockFields,
  field: string,
  rule: TourTextRule,
  ctx: TourBlockReadContext
): string {
  const checked = checkTourBlockText(rule, v[field]);
  if (checked.ok) return checked.value;
  return problem(ctx, `"${ctx.at}.${field}" ${checked.reason}`);
}

/** An optional text: absent when absent or blank; left out and reported
 *  (at this reader's own minor) when it breaks its rule. */
export function optionalText<F extends string>(
  v: TourBlockFields,
  field: F,
  rule: TourTextRule,
  ctx: TourBlockReadContext
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

export function assetRef(
  v: TourBlockFields,
  field: string,
  kind: TourAssetKind,
  ctx: TourBlockReadContext
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

export function optionalAssetRef<F extends string>(
  v: TourBlockFields,
  field: F,
  kind: TourAssetKind,
  ctx: TourBlockReadContext
): Partial<Record<F, string>> {
  if (v[field] === undefined) return {};
  return { [field]: assetRef(v, field, kind, ctx) } as Record<F, string>;
}

/** A size in metres within `[min, max]`. Not a positive finite number
 *  fails at every minor (no revision makes it a size); outside the bound
 *  is a rule a later minor may widen. */
export function metres(
  value: unknown,
  at: string,
  bounds: readonly [number, number],
  ctx: TourBlockReadContext
): number {
  const [min, max] = bounds;
  const message = `"${at}" must be a number of metres from ${String(min)} to ${String(max)}`;
  if (!isFiniteNumber(value) || value <= 0) return ctx.fail(message);
  if (value < min || value > max) return problem(ctx, message);
  return value;
}
