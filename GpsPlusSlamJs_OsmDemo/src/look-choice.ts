/**
 * The look the user chose: one colour scheme, or "by time of day", a blend
 * of the four sun looks that follows the sun (time-of-day colour blend
 * plan). One value in the store; `resolveLook` turns it into what a
 * build uses, on both sides of the build echo, so the page and the worker
 * can never disagree about it.
 *
 * WHY THE BLEND IS A BUILD OF ITS OWN. The city is baked in all four looks
 * at once (`CityOptions.looks`) and mixed by uniforms, so a sun step costs
 * a few uniform writes and never a rebuild; a fixed scheme keeps today's
 * build byte for byte.
 *
 * @see look-choice.ts.md
 */

import type { CityColourScheme } from "gps-plus-slam-osm";

import {
  COLOUR_SCHEME_NAMES,
  colourSchemeOf,
  DEFAULT_COLOUR_SCHEME,
  isColourSchemeName,
  type ColourSchemeName,
} from "./colour-schemes.js";

/** The choice that blends the sun looks. */
export const TIME_OF_DAY = "timeofday";

/** A scheme, or the time-of-day blend. */
export type LookChoice = ColourSchemeName | typeof TIME_OF_DAY;

/**
 * The looks the blend mixes, in weight order: day, golden hour, dusk, blue
 * hour. At most four (`MAX_CITY_LOOKS`, the mesh shader's `vec4`).
 */
export const TIME_OF_DAY_LOOKS: readonly ColourSchemeName[] = Object.freeze([
  "today",
  "golden",
  "dusk",
  "bluehour",
]);

/** The dropdown's label for the blend. */
const TIME_OF_DAY_LABEL = "By time of day";

/** The dropdown's label for a choice. */
export function lookLabel(choice: LookChoice): string {
  return choice === TIME_OF_DAY
    ? TIME_OF_DAY_LABEL
    : colourSchemeOf(choice).label;
}

/** Every choice in dropdown order: the schemes, then the blend. */
export const LOOK_CHOICES: readonly LookChoice[] = Object.freeze([
  ...COLOUR_SCHEME_NAMES,
  TIME_OF_DAY,
]);

/** Whether `value` is a scheme name or the blend. */
export function isLookChoice(value: unknown): value is LookChoice {
  return value === TIME_OF_DAY || isColourSchemeName(value);
}

/**
 * What a build uses for a choice: AR always builds the default scheme
 * (it draws no sky the looks belong to), the desktop builds the choice.
 * Pure, and used by the page's request and its echo check alike, so AR
 * plus the blend settles on the default instead of rebuilding forever.
 */
export function resolveLook(
  chosen: LookChoice,
  context: { readonly ar: boolean },
): LookChoice {
  return context.ar ? DEFAULT_COLOUR_SCHEME : chosen;
}

/**
 * A choice from a link (`?scheme=`): absent gives the default silently, an
 * unknown value the default with one warning (as `resolveColourScheme`).
 */
export function resolveLookChoice(
  value: string | null,
  // eslint-disable-next-line no-console -- the one report of a mistyped link
  warn: (message: string) => void = console.warn,
): LookChoice {
  if (value === null) return DEFAULT_COLOUR_SCHEME;
  if (isLookChoice(value)) return value;
  warn(
    `unknown colour scheme "${value}", using "${DEFAULT_COLOUR_SCHEME}" (known: ${LOOK_CHOICES.join(", ")})`,
  );
  return DEFAULT_COLOUR_SCHEME;
}

/** The `?scheme=` value for a choice: null (no parameter) for the default. */
export function lookLinkValue(choice: LookChoice): string | null {
  return choice === DEFAULT_COLOUR_SCHEME ? null : choice;
}

/**
 * The look weights from a link (`?lookWeights=a,b,c,d`, one per
 * {@link TIME_OF_DAY_LOOKS} entry), normalised to sum 1. Anything else (a
 * wrong count, a value that is not a finite number >= 0, a sum of 0) is
 * ignored with one warning: undefined, and the page keeps its own weights.
 */
export function parseLookWeights(
  value: string | null,
  // eslint-disable-next-line no-console -- the one report of a mistyped link
  warn: (message: string) => void = console.warn,
): readonly number[] | undefined {
  if (value === null) return undefined;
  const parts = value.split(",");
  const weights = parts.map((part) =>
    part.trim() === "" ? Number.NaN : Number(part),
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  if (
    weights.length !== TIME_OF_DAY_LOOKS.length ||
    !weights.every((w) => Number.isFinite(w) && w >= 0) ||
    !(sum > 0 && Number.isFinite(sum))
  ) {
    warn(
      `lookWeights "${value}" ignored: it needs ${TIME_OF_DAY_LOOKS.length} finite numbers >= 0 with a positive sum`,
    );
    return undefined;
  }
  return Object.freeze(weights.map((w) => w / sum));
}

/** What the worker builds for a choice: the colours, and the looks for the blend. */
export function lookBuildOf(choice: LookChoice): {
  readonly colours: CityColourScheme;
  readonly looks?: readonly CityColourScheme[];
} {
  if (choice !== TIME_OF_DAY) return { colours: colourSchemeOf(choice).city };
  const looks = TIME_OF_DAY_LOOKS.map((name) => colourSchemeOf(name).city);
  // The library requires `colours` to BE look 0 when both are given.
  return { colours: looks[0]!, looks };
}
