/**
 * The setup map sticker's size knob: the
 * page ships one sticker size; `?mapSize=s|m|l|xl` picks another, and the
 * parameter's presence shows a small select to switch between them, so
 * sizes can be compared on a device without a build. The sizes themselves
 * are CSS (`--sticker-*` on `.setup-stage` in index.html); this only
 * names one.
 *
 * Not app state: a developer's presentation knob, read from the URL once
 * and written back into it, read by no other view (root CLAUDE.md, "what
 * stays outside" the store).
 *
 * @see map-size.ts.md
 */

/** The sticker sizes, smallest first; index.html defines each. */
export const MAP_SIZES = ["s", "m", "l", "xl"] as const;
export type MapSize = (typeof MAP_SIZES)[number];

/** The page's size: what index.html's `--sticker` falls back to. */
export const DEFAULT_MAP_SIZE: MapSize = "l";

const PARAM = "mapSize";

function isMapSize(value: string | null): value is MapSize {
  return value !== null && (MAP_SIZES as readonly string[]).includes(value);
}

/** The size the URL asks for, and whether it asks at all (the knob). */
export function readMapSize(search: string): { size: MapSize; knob: boolean } {
  const params = new URLSearchParams(search);
  const value = params.get(PARAM);
  return {
    size: isMapSize(value) ? value : DEFAULT_MAP_SIZE,
    knob: params.has(PARAM),
  };
}

/** `search` with the size parameter set, every other one kept in place. */
export function withMapSize(search: string, size: MapSize): string {
  const params = new URLSearchParams(search);
  params.set(PARAM, size);
  return `?${params.toString()}`;
}

/** The select the knob reads; structural, so the tests run in node. */
export interface MapSizeSelect {
  readonly value: string;
  addEventListener(type: "change", listener: () => void): void;
}

/**
 * Applies the URL's size to the stage and, when the URL asks, mounts the
 * knob. Without the parameter it does nothing: the CSS default holds.
 */
export function wireMapSize(deps: {
  stage: { dataset: Record<string, string | undefined> };
  search: string;
  mountKnob: (sizes: readonly MapSize[], current: MapSize) => MapSizeSelect;
  replaceSearch: (search: string) => void;
}): void {
  const { size, knob } = readMapSize(deps.search);
  if (!knob) return;
  deps.stage.dataset.mapSize = size;
  const select = deps.mountKnob(MAP_SIZES, size);
  let search = deps.search;
  select.addEventListener("change", () => {
    const next = select.value;
    if (!isMapSize(next)) return;
    deps.stage.dataset.mapSize = next;
    search = withMapSize(search, next);
    deps.replaceSearch(search);
  });
}

/** The knob's DOM: a small labelled select fixed in the window's corner. */
export function mountMapSizeKnob(
  doc: Document,
  sizes: readonly MapSize[],
  current: MapSize,
): HTMLSelectElement {
  const label = doc.createElement("label");
  label.className = "map-size-knob";
  label.dataset.testid = "map-size-knob";
  label.append("Map size ");
  const select = doc.createElement("select");
  for (const size of sizes) {
    const option = doc.createElement("option");
    option.value = size;
    option.textContent = size.toUpperCase();
    select.append(option);
  }
  select.value = current;
  label.append(select);
  doc.body.append(label);
  return select;
}
