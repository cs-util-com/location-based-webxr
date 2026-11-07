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
 * A chip (`PALETTE_KINDS`) narrows what the words found to one kind, and
 * `highlightParts` cuts a row's text around the words it was found by.
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

/** A kind a chip narrows the rows to. */
export type PaletteKind = PaletteAdd["kind"];

/** The chips, in their order: a kind that adds, then a new station. */
export const PALETTE_KINDS: readonly {
  readonly kind: PaletteKind;
  readonly label: string;
  readonly icon: ShellIcon;
}[] = [
  ...ADD_CHOICES.flatMap((c) =>
    c.addable && c.kind !== "picture"
      ? [{ kind: c.kind, label: c.label, icon: c.icon }]
      : [],
  ),
  { kind: "station", label: "Station", icon: "station" },
];

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
 * keep the tour's order. `kind` keeps that kind's rows alone.
 */
export function paletteRows(
  query: string,
  stations: readonly PaletteStation[],
  selectedStationId: string | null,
  kind: PaletteKind | null = null,
): PaletteRow[] {
  const defaultId = stations.some((s) => s.id === selectedStationId)
    ? selectedStationId
    : (stations[0]?.id ?? null);
  const words = wordsOf(query);
  const kindHit = (c: Candidate, w: string) =>
    c.kindWords.some((k) => k.startsWith(w));
  return candidates(stations, defaultId)
    .filter((c) => kind === null || c.row.add.kind === kind)
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

/** A piece of a row's text, `hit` where a word of the query stands. */
export interface HighlightPart {
  readonly text: string;
  readonly hit: boolean;
}

/** Shorter words are not marked: one letter stands all over a row. */
const LEAST_MARKED_LENGTH = 2;

/**
 * `text` (in NFC) cut around every place a word of `query` stands, blind
 * to case; words that overlap make one piece. Words of one letter mark
 * nothing. The pieces joined give the text back.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const shown = text.normalize("NFC");
  const spans = wordsOf(query)
    .filter((w) => [...w].length >= LEAST_MARKED_LENGTH)
    .flatMap((word) => {
      const pattern = word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      return [...shown.matchAll(new RegExp(pattern, "giu"))].map((m) => ({
        from: m.index,
        to: m.index + m[0].length,
      }));
    })
    .sort((a, b) => a.from - b.from);
  const parts: HighlightPart[] = [];
  let at = 0;
  const plain = (to: number) => {
    if (to > at) parts.push({ text: shown.slice(at, to), hit: false });
  };
  let merged: { from: number; to: number } | null = null;
  const flush = () => {
    if (merged === null) return;
    plain(merged.from);
    parts.push({ text: shown.slice(merged.from, merged.to), hit: true });
    at = merged.to;
  };
  for (const span of spans) {
    if (merged !== null && span.from <= merged.to) {
      merged.to = Math.max(merged.to, span.to);
    } else {
      flush();
      merged = { ...span };
    }
  }
  flush();
  plain(shown.length);
  return parts.length === 0 ? [{ text: shown, hit: false }] : parts;
}
