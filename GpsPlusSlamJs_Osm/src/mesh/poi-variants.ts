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
import { B_VARIANTS } from "./poi-variants-b.js";
import { G_VARIANTS } from "./poi-variants-g.js";
import { D_VARIANTS } from "./poi-variants-d.js";
import { P_VARIANTS } from "./poi-variants-p.js";
import { M_VARIANTS } from "./poi-variants-m.js";
import { L_VARIANTS } from "./poi-variants-l.js";
import { H_VARIANTS } from "./poi-variants-hybrid.js";

/**
 * The six prototype files, by the letters §4.3 of the round-6 plan assigned.
 *
 * SHORT CODES RATHER THAN FILENAMES, because they appear in every variant id,
 * in the gallery's labels and in the tests — and the filenames are long, contain
 * spaces and parentheses, and two of them differ only by a numeric suffix.
 * The mapping is written out once, here, and nowhere else.
 */
export type VariantSource = "D" | "G" | "P" | "L" | "B" | "M" | "H";

/** What each source letter refers to. Shown in the gallery beside a variant. */
export const VARIANT_SOURCES: Readonly<Record<VariantSource, string>> =
  Object.freeze({
    D: "poi-markers-diorama (1)",
    G: "gemini-code-1785634682505",
    P: "procedural-poi-marker-gallery(1)",
    L: "poi-markers-gallery (2)",
    B: "poi-markers-plinth-and-payload",
    M: "poi-markers.html",
    // NOT A FILE, unlike the other six. `H` is a model the owner asked to be
    // combined from two sources — so far only `leisure=park`, D's version with
    // P's bench.
    H: "hybrid — combined from two sources on request",
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
 * Kinds whose SHIPPED model is a ground marking rather than an object, with the
 * height of the object a marker actually depicts (DEC-V6).
 *
 * WHY THIS TABLE EXISTS, AND WHY IT MUST STAY SHORT. DEC-V5 scales every variant
 * to the shipped model's height, reasoning that the shipped models are the ones
 * with a plausibility contract behind them. **That holds only while the shipped
 * model is an object.** `amenity=parking` ships as a painted bay 0.12 m tall;
 * its height is not "how tall a parking marker is", and scaling a 3 m sign post
 * to 0.12 m shrank it by 25x. The owner saw it immediately — _"Faktor 30, 40
 * kleiner"_ — and two kinds could not be judged at all because of it.
 *
 * Every value below is a MEASURED CORRECTION rather than an invented constant:
 * `grave_yard` and `historic=yes` are the owner's own multipliers ("ein Drittel
 * so gross", "mindestens dreimal so gross") applied to the shipped height, and
 * the other two are the real height of the object their liked variants depict.
 *
 * **Four entries, and it should stay near four.** A table that grew to cover
 * every kind would be a second source of truth for how tall things are —
 * exactly what deriving `heightM` from the geometry was introduced to prevent.
 */
const MARKER_HEIGHT_M: Readonly<Record<string, number>> = Object.freeze({
  // A parking sign on its post, not the bay it stands beside.
  "amenity=parking": 2.5,
  // A poolside handrail, not the water surface.
  "leisure=swimming_pool": 1.0,
  // "die ist ein Drittel so gross" — 0.86 x 3.
  "amenity=grave_yard": 0.86 * 3,
  // "die sollte mindestens dreimal so gross sein" — 1.40 x 3.
  "historic=yes": 1.4 * 3,
});

/**
 * The height a variant of `kind` is scaled to — the shipped model's, unless the
 * shipped model is a ground marking (DEC-V6).
 *
 * Returns 0 for an unknown kind, which `scaledToHeight` treats as "leave it
 * alone" rather than dividing by it.
 */
export function markerHeightFor(kind: string): number {
  return MARKER_HEIGHT_M[kind] ?? POI_MODELS.get(kind)?.heightM ?? 0;
}

/**
 * **The owner's verdict on the gallery** — which version of each kind wins.
 *
 * THIS IS THE SPECIFICATION, not a record of one opinion. The whole point of
 * porting 51 variants was to replace a rule with a look, and this is the answer
 * that came back: 31 of the 34 contested kinds decided in one pass, spoken
 * aloud while reading the gallery left to right.
 *
 * `"shipped"` means the incumbent won, which Q-V1 anticipated and which happened
 * twice — `amenity=bench` and `historic=wayside_cross`.
 *
 * THREE KINDS ARE STILL UNDECIDED, and two of them for a reason that was our
 * fault rather than a hard choice:
 *
 * - `amenity=parking` and `leisure=swimming_pool` were **unjudgeable** because
 *   DEC-V6's scale defect crushed their variants. They need a second look once
 *   that is fixed.
 * - `amenity=pharmacy` was simply not mentioned.
 *
 * `note` carries a requested CHANGE to the winner rather than a reason for
 * choosing it — those are tracked as work, not as commentary.
 */
export const CHOSEN_VARIANTS: readonly {
  readonly kind: string;
  /** The winning source, or `"shipped"` when the incumbent won. */
  readonly winner: VariantSource | "shipped";
  readonly note?: string;
}[] = Object.freeze([
  { kind: "leisure=pitch", winner: "M" },
  { kind: "amenity=bench", winner: "shipped" },
  { kind: "amenity=place_of_worship", winner: "L" },
  {
    // Built as the `H` variant: D's ground with P's bench. The winner is that
    // combination rather than D itself, so it points at what was actually asked
    // for instead of at a model plus a note nobody would apply.
    kind: "leisure=park",
    winner: "H",
    note: "D's park with the bench from P — the only requested hybrid",
  },
  { kind: "tourism=information", winner: "D" },
  {
    kind: "leisure=playground",
    winner: "D",
    note: "the slide sits too high and must come down",
  },
  { kind: "amenity=waste_basket", winner: "G" },
  { kind: "amenity=fuel", winner: "D" },
  { kind: "amenity=bicycle_parking", winner: "M" },
  { kind: "amenity=cafe", winner: "L" },
  { kind: "amenity=fast_food", winner: "M" },
  { kind: "amenity=shelter", winner: "L" },
  { kind: "amenity=bank", winner: "D" },
  { kind: "amenity=recycling", winner: "D" },
  { kind: "amenity=post_box", winner: "B" },
  { kind: "historic=memorial", winner: "D" },
  { kind: "amenity=drinking_water", winner: "D" },
  { kind: "leisure=picnic_table", winner: "P" },
  { kind: "tourism=attraction", winner: "L" },
  { kind: "tourism=artwork", winner: "P" },
  { kind: "amenity=vending_machine", winner: "D" },
  { kind: "amenity=bar", winner: "D" },
  {
    kind: "amenity=hunting_stand",
    winner: "L",
    note: "the ladder is on the wrong side — it is not against the hut",
  },
  { kind: "tourism=viewpoint", winner: "L" },
  { kind: "amenity=waste_disposal", winner: "L" },
  {
    kind: "amenity=grave_yard",
    winner: "D",
    note: "a third of the size it should be, and the headstones float",
  },
  { kind: "historic=archaeological_site", winner: "M" },
  { kind: "historic=wayside_cross", winner: "shipped" },
  {
    kind: "historic=yes",
    winner: "B",
    note: "at least three times bigger",
  },
  { kind: "amenity=fountain", winner: "D" },
  { kind: "amenity=parking_entrance", winner: "L" },
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
 * The same mesh scaled UNIFORMLY so its height becomes `targetHeightM`
 * (DEC-V5).
 *
 * WHY ANY SCALING AT ALL. The `D` prototype is a diorama — every kind fits one
 * display envelope, tiers at 0.35–0.7 m, 0.8–1.2 m and 1.35–1.9 m "above the
 * plinth", whatever the thing really is. Its `place_of_worship` is ~1.9 m where
 * the shipped model is 12 m. DEC-R6-8 keeps real-world scale and §4 of the
 * variant plan compares at true size, so porting D's numbers verbatim would put
 * a 1.9 m church beside a 1.8 m human and call it a comparison.
 *
 * WHY UNIFORM, and why to the SHIPPED model's height. Uniform preserves every
 * proportion inside the model, which is precisely what the owner said they are
 * judging. Taking the target from the shipped model rather than inventing one
 * per kind means the variant is real-scale by construction — the shipped models
 * are the ones with a plausibility contract test behind them — and it isolates
 * SHAPE as the only difference between the two things standing side by side.
 *
 * **Normals are NOT touched.** A uniform scale turns no direction, so scaling
 * them would be a no-op at best and a denormalisation at worst — and a
 * denormalised normal shades wrong without changing any silhouette, which is
 * this round's recurring class of invisible defect.
 *
 * A mesh with no height is returned unchanged rather than divided by zero: a
 * ground marking is flat on purpose, and Infinity in a position removes the
 * object from the scene with nothing reported.
 */
/**
 * The same mesh lifted so its lowest point sits at `y = 0`.
 *
 * WHY THE PORTS NEED IT, and it was found by the contract test rather than by
 * reading. Several `D` models have parts that extend DOWN INTO the plinth —
 * `leisure=picnic_table`'s A-frames are 0.50 m tall centred 0.22 m above the
 * plinth top, so they reach 3 cm below it. That is invisible in the source,
 * where the plinth hides them. Strip the plinth and they hang below ground.
 *
 * Grounding rather than clamping: the model is correct, its datum is not, so
 * moving it is right and truncating it would silently shorten a leg.
 */
function groundedMesh(mesh: MeshData): MeshData {
  let lowest = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    lowest = Math.min(lowest, mesh.positions[i] as number);
  }
  if (!Number.isFinite(lowest) || Math.abs(lowest) < 1e-9) return mesh;
  const positions = new Float32Array(mesh.positions);
  for (let i = 1; i < positions.length; i += 3) {
    positions[i] = (positions[i] as number) - lowest;
  }
  return { ...mesh, positions };
}

export function scaledToHeight(
  mesh: MeshData,
  targetHeightM: number,
): MeshData {
  let peak = 0;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    peak = Math.max(peak, mesh.positions[i] as number);
  }
  if (!(peak > 0) || !(targetHeightM > 0)) return mesh;
  const factor = targetHeightM / peak;
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    positions[i] = (mesh.positions[i] as number) * factor;
  }
  return { ...mesh, positions };
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

  // THE `D` PORTS, scaled to the shipped model's height (DEC-V5). D is a
  // diorama — every kind fits one display envelope whatever its real size — so
  // porting its numbers verbatim would put a 1.9 m church beside a 1.8 m human.
  // Uniform scaling preserves every internal proportion, which is the thing
  // being judged.
  const fromDiorama = (
    kind: string,
    source: VariantSource,
    table: ReadonlyMap<string, () => MeshData>,
  ): PoiVariant => {
    const build = table.get(kind);
    const model = POI_MODELS.get(kind);
    if (build === undefined || model === undefined) {
      throw new Error(`no ${source} variant or no shipped model for "${kind}"`);
    }
    // GROUND FIRST, THEN SCALE. `scaledToHeight` scales about the origin and
    // assumes the base is already there; scaling an un-grounded mesh would
    // multiply its negative dip as well as its height.
    //
    // THE TARGET IS THE MARKER HEIGHT, NOT THE SHIPPED HEIGHT (DEC-V6). They
    // are the same for 30 of the 34 kinds; for the four whose shipped model is
    // a ground marking they are not, and using the shipped height there crushed
    // the variant by up to 25x.
    const mesh = scaledToHeight(groundedMesh(build()), markerHeightFor(kind));
    let heightM = 0;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      heightM = Math.max(heightM, mesh.positions[i] as number);
    }
    return { kind, source, colour: model.colour, heightM, mesh };
  };

  return [
    ...[...D_VARIANTS.keys()].map((k) => fromDiorama(k, "D", D_VARIANTS)),
    ...[...B_VARIANTS.keys()].map((k) => fromDiorama(k, "B", B_VARIANTS)),
    ...[...G_VARIANTS.keys()].map((k) => fromDiorama(k, "G", G_VARIANTS)),
    ...[...P_VARIANTS.keys()].map((k) => fromDiorama(k, "P", P_VARIANTS)),
    ...[...M_VARIANTS.keys()].map((k) => fromDiorama(k, "M", M_VARIANTS)),
    ...[...L_VARIANTS.keys()].map((k) => fromDiorama(k, "L", L_VARIANTS)),
    ...[...H_VARIANTS.keys()].map((k) => fromDiorama(k, "H", H_VARIANTS)),
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
