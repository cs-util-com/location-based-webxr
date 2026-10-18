/**
 * The phone's tour name field (tour editor plan 2026-10-17-1816, W2): the
 * tour's own name, apart from the poster's title. It shows the open tour's
 * title, and tells the Finish what the creator did with it - a name typed,
 * a name emptied (the title goes), or nothing (the tour keeps its own) -
 * so an emptied name never keeps the old title silently. A typed name is
 * kept across a reload of the page, as the poster text is (M4a review
 * #12), for as long as the tour's file still carries the title it was
 * typed over.
 *
 * @see tour-name-field.ts.md
 */

/** The field (structural, so the unit tests run in node). */
export interface TourNameInput {
  value: string;
  addEventListener(type: "input", handler: () => void): void;
}

/** The store slice a typed name is kept in (`localStorage`). */
export interface TourNameStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface TourNameField {
  /** A tour opened (its title, or null for none; `key` names the tour -
   *  its file's key - for a kept name) or closed (null): the field shows
   *  the name typed for it and not yet written, else its title. */
  present(title: string | null, key?: string | null): void;
  /** What the creator typed since the tour was presented ("" for an
   *  emptied name), or null when they typed nothing. */
  typed(): string | null;
}

const KEY_PREFIX = "tour-viewer.tour-name.";

interface Kept {
  readonly name: string;
  /** The tour's title when the name was typed (null: none). */
  readonly over: string | null;
}

function readKept(store: TourNameStore | undefined, key: string): Kept | null {
  try {
    const raw = store?.getItem(KEY_PREFIX + key) ?? null;
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { name, over } = value as Record<string, unknown>;
    return typeof name === "string" &&
      (typeof over === "string" || over === null)
      ? { name, over }
      : null;
  } catch {
    // Site data blocked, or a damaged value: nothing kept.
    return null;
  }
}

function forget(store: TourNameStore | undefined, key: string): void {
  try {
    store?.removeItem?.(KEY_PREFIX + key);
  } catch {
    // Site data blocked: nothing to forget.
  }
}

export function wireTourNameField(
  input: TourNameInput,
  store?: TourNameStore,
): TourNameField {
  let touched = false;
  /** The presented tour's key and title, for what is typed. */
  let presented: { key: string; title: string | null } | null = null;
  input.addEventListener("input", () => {
    touched = true;
    if (presented === null) return;
    const kept: Kept = { name: input.value, over: presented.title };
    try {
      store?.setItem(KEY_PREFIX + presented.key, JSON.stringify(kept));
    } catch {
      // Site data blocked: the name holds for this page only.
    }
  });
  return {
    present(title, key = null) {
      presented = key === null ? null : { key, title };
      const kept = key === null ? null : readKept(store, key);
      if (kept !== null && kept.over === title) {
        input.value = kept.name;
        touched = true;
        return;
      }
      // Spent once the file carries another title: a Finish wrote the
      // name, or the tour was renamed elsewhere since (the editor).
      if (kept !== null && key !== null) forget(store, key);
      input.value = title ?? "";
      touched = false;
    },
    typed: () => (touched ? input.value : null),
  };
}
