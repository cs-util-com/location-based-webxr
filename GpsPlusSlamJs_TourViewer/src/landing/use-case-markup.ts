/**
 * The use-case section as markup: a heading, the first examples as a grid
 * of landscape phone screens, and the rest folded under "More ideas" in a
 * native `<details>`. Pure string work, so it renders and tests in node;
 * `use-cases.ts` is the only part that touches the DOM.
 *
 * @see use-case-markup.ts.md
 */
import { escapeHtml } from "gps-plus-slam-app-framework/utils/escape-html";

import type { UseCase } from "./use-case-data.js";
import {
  screenLayers,
  SCREEN_H,
  SCREEN_W,
  treatmentDefs,
  USE_CASE_TREATMENTS,
  type UseCaseTreatment,
} from "./use-case-draw.js";

/**
 * Examples shown before "More ideas". Swept 6 and 8: six fill whole rows at
 * the section's two and three columns; eight leave a last row of two at
 * three columns and add about 600 px on a phone before the fold.
 */
export const USE_CASES_SHOWN_FIRST = 6;

/**
 * The look the page ships. Route-light reads at a glance which part is the
 * tour (everything in the route's colours); the true-colour look stays as a
 * prototype page for comparison.
 */
export const SHIPPED_TREATMENT: UseCaseTreatment = "route-light";

export interface UseCasesMarkupOptions {
  readonly treatment?: UseCaseTreatment;
  readonly shownFirst?: number;
}

function item(u: UseCase, t: UseCaseTreatment): string {
  return (
    `<li class="uc-item" data-testid="use-case-${escapeHtml(u.id)}">` +
    `<div class="uc-phone">` +
    `<svg class="uc-screen" viewBox="0 0 ${SCREEN_W} ${SCREEN_H}" role="img" aria-label="${escapeHtml(u.alt)}" focusable="false">` +
    // The label speaks for the picture: its drawing (nested svgs, a
    // card's words) stays out of the accessibility tree.
    `<g aria-hidden="true">` +
    screenLayers(t, u.scene, u.overlay(t)) +
    `</g></svg></div>` +
    `<h3 class="uc-title">${escapeHtml(u.title)}</h3>` +
    `<p class="uc-sentence">${escapeHtml(u.sentence)}</p>` +
    `</li>`
  );
}

function assertOptions(
  cases: readonly UseCase[],
  t: UseCaseTreatment,
  shownFirst: number,
): void {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new RangeError("the use-case section needs at least one example");
  }
  if (!USE_CASE_TREATMENTS.includes(t)) {
    throw new RangeError(`unknown use-case look: ${String(t)}`);
  }
  if (!Number.isInteger(shownFirst) || shownFirst < 0) {
    throw new RangeError(
      `shownFirst must be a whole number >= 0: ${shownFirst}`,
    );
  }
}

/**
 * The whole section. Throws a RangeError for an empty list, an unknown look
 * or a `shownFirst` that is not a whole number from 0 up.
 */
export function renderUseCases(
  cases: readonly UseCase[],
  options: UseCasesMarkupOptions = {},
): string {
  const t = options.treatment ?? SHIPPED_TREATMENT;
  const shownFirst = options.shownFirst ?? USE_CASES_SHOWN_FIRST;
  assertOptions(cases, t, shownFirst);
  const shown = cases.slice(0, shownFirst);
  const folded = cases.slice(shownFirst);
  const grid = (list: readonly UseCase[]) =>
    `<ul class="uc-grid">${list.map((u) => item(u, t)).join("")}</ul>`;
  return (
    `<section class="uc" aria-labelledby="uc-heading" data-look="${t}">` +
    `<svg class="uc-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${treatmentDefs(t)}</defs></svg>` +
    `<h2 class="uc-heading" id="uc-heading">What people make with it</h2>` +
    `<p class="uc-sub">Each picture is a phone held up at the spot. The bright part is the tour; the rest is the real place. The makers and places are made up.</p>` +
    (shown.length > 0 ? grid(shown) : "") +
    (folded.length > 0
      ? `<details class="uc-more">` +
        `<summary class="uc-more-toggle"><span class="uc-more-closed">More ideas (${folded.length})</span><span class="uc-more-open">Fewer ideas</span></summary>` +
        grid(folded) +
        `</details>`
      : "") +
    `</section>`
  );
}
