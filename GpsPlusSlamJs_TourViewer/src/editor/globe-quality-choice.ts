/**
 * The View menu's quality entry: which tier the 3D view on the globe opens
 * with, remembered per browser. Automatic names no tier, so the view takes
 * the device's default and may step down; a named tier is held as it is.
 * A tier is fixed for a view's life (the sea compiles it), so a change takes
 * effect at the next open.
 *
 * Pure and free of the globe's code: the page reads it on its first load.
 *
 * @see globe-quality-choice.ts.md
 */

export const GLOBE_QUALITY_CHOICE = Object.freeze({
  storageKey: "tour-editor.globe-quality",
  /** The order the menu entry cycles in. */
  choices: Object.freeze(["auto", "low", "medium", "high"] as const),
});

export type GlobeQualityChoice = (typeof GLOBE_QUALITY_CHOICE.choices)[number];

const WORDS: Readonly<Record<GlobeQualityChoice, string>> = Object.freeze({
  auto: "Automatic",
  low: "Low",
  medium: "Medium",
  high: "High",
});

const isChoice = (value: string | null): value is GlobeQualityChoice =>
  (GLOBE_QUALITY_CHOICE.choices as readonly (string | null)[]).includes(value);

/** The stored choice; automatic for anything else, or with no storage. */
export function readGlobeQualityChoice(
  storage: Pick<Storage, "getItem"> | null,
): GlobeQualityChoice {
  try {
    const value = storage?.getItem(GLOBE_QUALITY_CHOICE.storageKey) ?? null;
    return isChoice(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

/** Keeps the choice; false when the browser refused. */
export function writeGlobeQualityChoice(
  storage: Pick<Storage, "setItem"> | null,
  choice: GlobeQualityChoice,
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(GLOBE_QUALITY_CHOICE.storageKey, choice);
    return true;
  } catch {
    return false;
  }
}

/** The next choice in the entry's cycle. */
export function nextGlobeQualityChoice(
  choice: GlobeQualityChoice,
): GlobeQualityChoice {
  const { choices } = GLOBE_QUALITY_CHOICE;
  return choices[(choices.indexOf(choice) + 1) % choices.length] ?? "auto";
}

/** The menu entry's words. */
export function globeQualityChoiceLabel(choice: GlobeQualityChoice): string {
  return `Quality: ${WORDS[choice]}`;
}

/** The tier's name to open with: the link's, else the choice's, else none. */
export function qualityToOpenWith(
  link: string | null,
  choice: GlobeQualityChoice,
): string | null {
  return link ?? (choice === "auto" ? null : choice);
}
