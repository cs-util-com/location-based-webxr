/**
 * The phone's tour name field (tour editor plan 2026-10-17-1816, W2): the
 * tour's own name, apart from the poster's title. It shows the open tour's
 * title, and tells the Finish what the creator did with it - a name typed,
 * a name emptied (the title goes), or nothing (the tour keeps its own) -
 * so an emptied name never keeps the old title silently.
 *
 * @see tour-name-field.ts.md
 */

/** The field (structural, so the unit tests run in node). */
export interface TourNameInput {
  value: string;
  addEventListener(type: "input", handler: () => void): void;
}

export interface TourNameField {
  /** A tour opened (its title, or null for none) or closed (null): the
   *  field shows it, untouched. */
  present(title: string | null): void;
  /** What the creator typed since the tour was presented ("" for an
   *  emptied name), or null when they typed nothing. */
  typed(): string | null;
}

export function wireTourNameField(input: TourNameInput): TourNameField {
  let touched = false;
  input.addEventListener("input", () => {
    touched = true;
  });
  return {
    present(title) {
      input.value = title ?? "";
      touched = false;
    },
    typed: () => (touched ? input.value : null),
  };
}
