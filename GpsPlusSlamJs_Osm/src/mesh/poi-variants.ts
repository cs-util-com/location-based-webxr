/**
 * Alternative POI models, for comparing the versions the owner liked
 * (DEC-R6-30…33).
 *
 * WHY THIS EXISTS. The owner deployed the gallery, looked at the fifty shipped
 * models and reported _"I dont like most of them"_. Six downloaded prototypes
 * contain versions they DID like — 51 (kind, source) pairs across 34 kinds — and
 * thirteen of those kinds are liked in more than one file. So the choice of
 * model moves from a rule to a comparison: render every liked version side by
 * side, at true size, and pick by looking.
 *
 * WHAT IS COMPARED, AND WHAT IS NOT (DEC-R6-30). Variants keep each source's
 * SHAPE — its proportions, composition and detailing — and take the house
 * PALETTE. The owner's words are the specification: _"I dont care about lighting
 * or colors but the 3d models/shapes I liked look very different to the current
 * one and also to each other."_ Normalising colour is what stops it confounding
 * the comparison; normalising proportions too is what produced the models they
 * disliked.
 *
 * **This partly supersedes DEC-R6-15.** The primitive library and palette are
 * still the house style's. What is no longer done is re-proportioning a model to
 * match how the house file would have drawn it.
 *
 * WHY IN THE PACKAGE AND NOT THE DEMO (DEC-R6-31). `POI_MODELS` still holds
 * exactly one model per kind and `poiModelFor` keeps its signature, so the
 * runtime path and its draw-call bucketing are untouched — DEC-R6-18's objection
 * to F41 does not apply here. The reason these are in the package is the
 * CONTRACT TESTS: a variant is a candidate to become the shipped model, so it is
 * held to the same rules. This session found fifty models rendering inside out
 * for eighteen work items, invisible to every count-based assertion and to the
 * eye, which is why "it looks fine in the gallery" is not a standard a candidate
 * can be judged against.
 *
 * @see poi-variants.ts.md
 */

import type { MeshData } from "./mesh-data.js";
import { POI_MODELS } from "./poi-models.js";

/**
 * The six prototype files, by the letters §4.3 of the round-6 plan assigned.
 *
 * SHORT CODES RATHER THAN FILENAMES, because they appear in every variant id,
 * in the gallery's labels and in the tests — and the filenames are long, contain
 * spaces and parentheses, and two of them differ only by a numeric suffix.
 * The mapping is written out once, here, and nowhere else.
 */
export type VariantSource = "D" | "G" | "P" | "L" | "B" | "M";

/** What each source letter refers to. Shown in the gallery beside a variant. */
export const VARIANT_SOURCES: Readonly<Record<VariantSource, string>> =
  Object.freeze({
    D: "poi-markers-diorama (1)",
    G: "gemini-code-1785634682505",
    P: "procedural-poi-marker-gallery(1)",
    L: "poi-markers-gallery (2)",
    B: "poi-markers-plinth-and-payload",
    M: "poi-markers.html",
  });

/** One alternative model for a kind. */
export interface PoiVariant {
  /** `key=value`, matching `POI_MODELS`. */
  readonly kind: string;
  /** Which prototype this shape came from. */
  readonly source: VariantSource;
  /** Packed `0xrrggbb`, from the house palette (DEC-R6-30). */
  readonly colour: number;
  /** Derived from the built mesh, never declared. */
  readonly heightM: number;
  readonly mesh: MeshData;
}

/**
 * The owner's notes, transcribed — every (kind, source) pair they named.
 *
 * **THE ONE THING A LATER READER CANNOT RECONSTRUCT.** Once a model is ported,
 * nothing in the repo records which prototype it came from or how many of them
 * agreed on it. §4.3 of the round-6 plan wrote this out in prose for exactly
 * that reason; here it is executable, so a pair that is never built is visible
 * rather than quietly absent.
 *
 * 51 pairs, 34 distinct kinds, per source: D 18, G 5, P 4, L 13, B 7, M 4 —
 * all four totals asserted in `poi-variants.test.ts`.
 *
 * **Two typos in the original notes are normalised here** and recorded so nobody
 * greps for the wrong string: `drinking_walter` is `amenity=drinking_water`, and
 * `historing=yes` is `historic=yes`.
 */
export const LIKED_VARIANTS: readonly {
  readonly kind: string;
  readonly source: VariantSource;
}[] = Object.freeze([
  // D — poi-markers-diorama (1): 18
  { kind: "amenity=cafe", source: "D" },
  { kind: "amenity=fuel", source: "D" },
  { kind: "amenity=place_of_worship", source: "D" },
  { kind: "amenity=bench", source: "D" },
  { kind: "leisure=playground", source: "D" },
  { kind: "historic=memorial", source: "D" },
  { kind: "amenity=recycling", source: "D" },
  { kind: "amenity=bank", source: "D" },
  { kind: "tourism=information", source: "D" },
  { kind: "leisure=park", source: "D" },
  { kind: "amenity=shelter", source: "D" },
  { kind: "amenity=drinking_water", source: "D" },
  { kind: "leisure=picnic_table", source: "D" },
  { kind: "amenity=vending_machine", source: "D" },
  { kind: "amenity=bar", source: "D" },
  { kind: "amenity=grave_yard", source: "D" },
  { kind: "historic=wayside_cross", source: "D" },
  { kind: "amenity=fountain", source: "D" },
  // G — gemini-code-1785634682505: 5
  { kind: "amenity=waste_basket", source: "G" },
  { kind: "amenity=parking", source: "G" },
  { kind: "leisure=swimming_pool", source: "G" },
  { kind: "amenity=fast_food", source: "G" },
  { kind: "amenity=pharmacy", source: "G" },
  // P — procedural-poi-marker-gallery(1): 4
  { kind: "leisure=park", source: "P" },
  { kind: "amenity=cafe", source: "P" },
  { kind: "leisure=picnic_table", source: "P" },
  { kind: "tourism=artwork", source: "P" },
  // L — poi-markers-gallery (2): 13
  { kind: "amenity=place_of_worship", source: "L" },
  { kind: "amenity=bench", source: "L" },
  { kind: "leisure=park", source: "L" },
  { kind: "tourism=information", source: "L" },
  { kind: "amenity=fuel", source: "L" },
  { kind: "amenity=cafe", source: "L" },
  { kind: "amenity=shelter", source: "L" },
  { kind: "tourism=attraction", source: "L" },
  { kind: "amenity=hunting_stand", source: "L" },
  { kind: "tourism=viewpoint", source: "L" },
  { kind: "amenity=waste_disposal", source: "L" },
  { kind: "historic=wayside_cross", source: "L" },
  { kind: "amenity=parking_entrance", source: "L" },
  // B — poi-markers-plinth-and-payload: 7
  { kind: "amenity=parking", source: "B" },
  { kind: "amenity=fast_food", source: "B" },
  { kind: "amenity=post_box", source: "B" },
  { kind: "leisure=picnic_table", source: "B" },
  { kind: "amenity=hunting_stand", source: "B" },
  { kind: "historic=yes", source: "B" },
  { kind: "amenity=fountain", source: "B" },
  // M — poi-markers.html: 4
  { kind: "amenity=fast_food", source: "M" },
  { kind: "amenity=bicycle_parking", source: "M" },
  { kind: "leisure=pitch", source: "M" },
  { kind: "historic=archaeological_site", source: "M" },
]);

/**
 * The built variants, keyed by kind.
 *
 * EMPTY ENTRIES ARE NOT STORED: a kind with no liked alternative is simply
 * absent, and `poiVariantsFor` answers with an empty list. The gallery asks
 * about every kind it draws, so "none" has to be an ordinary answer.
 *
 * **Populated batch by batch, grouped by SOURCE FILE rather than by kind**,
 * because the cost of a port is dominated by learning one prototype's own
 * conventions — its plinth offsets, its centre-versus-base `y`, its cylinder
 * argument order — and that is paid once per file.
 */
export const POI_VARIANTS: ReadonlyMap<string, readonly PoiVariant[]> = new Map(
  buildVariants(),
);

/** The alternatives for a kind, or an empty list when it has none. */
export function poiVariantsFor(kind: string): readonly PoiVariant[] {
  return POI_VARIANTS.get(kind) ?? [];
}

/**
 * Groups the built variants by kind.
 *
 * The SHIPPED model is included as its own entry under the source it was built
 * from, so the gallery compares like with like — Q-V1 of the plan notes that a
 * singleton's liked version may still lose to what is already there, and that
 * cannot be judged if the incumbent is not in the row.
 */
function buildVariants(): [string, PoiVariant[]][] {
  const byKind = new Map<string, PoiVariant[]>();
  for (const variant of variants()) {
    const list = byKind.get(variant.kind) ?? [];
    list.push(variant);
    byKind.set(variant.kind, list);
  }
  return [...byKind];
}

/**
 * Every built variant, in source order.
 *
 * SEVEN ALREADY EXIST as shipped models: the round-6 §4 rebuild ported `bench`,
 * `wayside_cross`, `waste_basket`, `post_box`, `memorial`, `drinking_water` and
 * `information` from the house-style file before the owner's verdict arrived.
 * Rather than duplicate that geometry, those are re-exposed here as their `L`
 * variant — the shipped model IS the L port, and building it twice would be two
 * places for it to drift.
 */
function variants(): PoiVariant[] {
  const fromShipped = (kind: string, source: VariantSource): PoiVariant => {
    const model = POI_MODELS.get(kind);
    if (model === undefined) {
      throw new Error(`no shipped model for "${kind}" to expose as a variant`);
    }
    return {
      kind,
      source,
      colour: model.colour,
      heightM: model.heightM,
      mesh: model.mesh,
    };
  };

  return [
    // The §4 rebuild's seven, which were ported from the house-style file and
    // are therefore already the `L` variant of their kind.
    fromShipped("amenity=bench", "L"),
    fromShipped("historic=wayside_cross", "L"),
    fromShipped("tourism=information", "L"),
    // These three were ported from the house file under DEC-R6-28 even though
    // §4.3 lists them under another source, so `L` is the honest attribution —
    // and their liked source is still owed a variant of its own.
    fromShipped("amenity=waste_basket", "L"),
    fromShipped("amenity=post_box", "L"),
    fromShipped("historic=memorial", "L"),
    fromShipped("amenity=drinking_water", "L"),
  ];
}
