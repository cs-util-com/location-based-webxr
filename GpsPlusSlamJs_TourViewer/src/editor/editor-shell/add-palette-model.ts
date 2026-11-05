/**
 * The Ctrl+K palette's rows, pure: what a typed query adds where. Each
 * row is a kind the editor can make from nothing (a short text, a long
 * text: `ADD_CHOICES`) in one station, or a new station; a query names
 * the kind and the place in one go ("long gate", "pin 2"), every word of
 * it found in the row's kind words (as a word's start) or in its place
 * (anywhere in it). An empty query lists what adds to the default place:
 * the selected station, else the first. The rows are ordered by how well
 * they match - a station named by its exact number first, then the
 * default place, then the kind's name over its other words - and the
 * first is what Enter adds. Both sides are folded to one Unicode form
 * (NFC) and lower case.
 *
 * @see add-palette-model.ts.md
 */
import type { ShellIcon } from "gps-plus-slam-editor-kit/chrome";

import { foldForSearch } from "../editor-model.js";
import { ADD_CHOICES, type AddKind } from "./tree-add-menu.js";

/** A station as the palette offers it. */
export interface PaletteStation {
  readonly id: string;
  /** Its number in the tour, from 1. */
  readonly number: number;
  readonly title: string;
}

/** What a row adds. */
export type PaletteAdd =
  | { readonly kind: AddKind; readonly stationId: string }
  | { readonly kind: "station" };

export interface PaletteRow {
  readonly add: PaletteAdd;
  /** The kind, in words ("Long text", "New station"). */
  readonly label: string;
  /** Where it goes, in words ("in 2 The old gate"). */
  readonly place: string;
  readonly icon: ShellIcon;
}

/** The most rows listed: a tour of many stations is narrowed by typing. */
export const PALETTE_MAX_ROWS = 40;

/** Where a new station goes: the tree's "+" (`tree-add`) puts it there. */
export const NEW_STATION_PLACE = "at the centre of the view";

const NEW_STATION_WORDS = "new station place stop";

interface Candidate {
  readonly row: PaletteRow;
  readonly atDefault: boolean;
  /** Its kind's words, lower case, the label's first. */
  readonly kindWords: readonly string[];
  readonly name: string;
  readonly placeText: string;
  /** Its station's number, as typed ("2"); null for a new station. */
  readonly number: string | null;
}

function wordsOf(text: string): string[] {
  return foldForSearch(text).split(/\s+/).filter(Boolean);
}

function candidates(
  stations: readonly PaletteStation[],
  defaultId: string | null,
): Candidate[] {
  const kinds = ADD_CHOICES.filter(
    (c): c is typeof c & { kind: AddKind } => c.addable && c.kind !== "picture",
  );
  const out: Candidate[] = [];
  for (const station of stations) {
    const place = `in ${String(station.number)} ${station.title}`;
    for (const choice of kinds) {
      out.push({
        row: {
          add: { kind: choice.kind, stationId: station.id },
          label: choice.label,
          place,
          icon: choice.icon,
        },
        atDefault: station.id === defaultId,
        kindWords: wordsOf(`${choice.label} ${choice.words}`),
        name: choice.label.toLowerCase(),
        placeText: foldForSearch(place),
        number: String(station.number),
      });
    }
  }
  out.push({
    row: {
      add: { kind: "station" },
      label: "New station",
      place: NEW_STATION_PLACE,
      icon: "station",
    },
    atDefault: true,
    kindWords: wordsOf(NEW_STATION_WORDS),
    name: "new station",
    placeText: NEW_STATION_PLACE,
    number: null,
  });
  return out;
}

/**
 * The rows for `query` over `stations` (in the tour's order), the
 * default place `selectedStationId` (null, or one not among them: the
 * first station). At most `PALETTE_MAX_ROWS`, best first; equal ones
 * keep the tour's order.
 */
export function paletteRows(
  query: string,
  stations: readonly PaletteStation[],
  selectedStationId: string | null,
): PaletteRow[] {
  const defaultId = stations.some((s) => s.id === selectedStationId)
    ? selectedStationId
    : (stations[0]?.id ?? null);
  const words = wordsOf(query);
  const kindHit = (c: Candidate, w: string) =>
    c.kindWords.some((k) => k.startsWith(w));
  return candidates(stations, defaultId)
    .filter((c) =>
      words.length === 0
        ? c.atDefault
        : words.every((w) => kindHit(c, w) || c.placeText.includes(w)),
    )
    .map((c, order) => {
      let score =
        (c.atDefault ? 10 : 0) - (c.row.add.kind === "station" ? 1 : 0);
      for (const w of words) {
        // A station's own number outranks the selection, whose number
        // may merely contain it ("1" in "in 11 ...").
        if (w === c.number) score += 20;
        if (kindHit(c, w)) score += 3;
        if (c.name.startsWith(w)) score += 3;
      }
      return { row: c.row, score, order };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, PALETTE_MAX_ROWS)
    .map((c) => c.row);
}
