/**
 * The rules of the two-map city shadow, pure: which caster mode is in
 * effect, which mesh casts and receives in it, when the caster set counts
 * as changed, which quality tier is in effect for a user's choice on a
 * device class, and which maps render in a frame. No three.js; the
 * controller (`two-map-sun-shadow.ts`) and the flag writer
 * (`shadow-casting.ts`) apply them.
 *
 * @see two-map-shadow-rig.ts.md
 */

/** Who casts shadows: nobody, the AR shadow prototype, or the city. */
export type ShadowCastingMode = 'off' | 'ar' | 'city';

/** A quality tier in effect. */
export type ShadowTier = 'off' | 'low' | 'phone' | 'high';

/** What the user chose: a tier, or `auto` (the device class decides). */
export type ShadowChoice = 'auto' | ShadowTier;

/** The device classes a tier is chosen for. */
export type ShadowDeviceClass = 'desktop' | 'phone';

/** One tier's maps: one map (the sun's, over the whole city) or two. */
export interface ShadowTierSpec {
  readonly maps: 1 | 2;
  /** The sun's map edge, texels (the near map with two maps). */
  readonly nearSize: number;
  /** The far light's map edge, texels; absent with one map. */
  readonly farSize?: number;
}

/**
 * The tier table. `low` is one map on the sun over the whole city (no far
 * light, the two-map rewrite stays inert); `high` is a near and a far map
 * at 2048 (64 MiB). `phone` is a starting point until phone measurements
 * set it; callers may pass their own table.
 */
export const SHADOW_TIERS: Readonly<
  Record<Exclude<ShadowTier, 'off'>, ShadowTierSpec>
> = Object.freeze({
  low: Object.freeze({ maps: 1, nearSize: 1024 }),
  phone: Object.freeze({ maps: 2, nearSize: 1024, farSize: 1024 }),
  high: Object.freeze({ maps: 2, nearSize: 2048, farSize: 2048 }),
});

/** The tier `auto` resolves to, per device class. */
export const AUTO_SHADOW_TIER: Readonly<Record<ShadowDeviceClass, ShadowTier>> =
  Object.freeze({ desktop: 'high', phone: 'phone' });

const TIERS: readonly ShadowTier[] = ['off', 'low', 'phone', 'high'];

/**
 * The tier in effect: the choice itself, or for `auto` the device class's
 * tier (which may be `off`).
 *
 * @throws RangeError for an unknown choice, device class or table entry.
 */
export function effectiveShadowTier(
  choice: ShadowChoice,
  deviceClass: ShadowDeviceClass,
  autoTiers: Readonly<Record<ShadowDeviceClass, ShadowTier>> = AUTO_SHADOW_TIER
): ShadowTier {
  if (choice !== 'auto' && !TIERS.includes(choice)) {
    throw new RangeError(`unknown shadow choice: ${String(choice)}`);
  }
  if (deviceClass !== 'desktop' && deviceClass !== 'phone') {
    throw new RangeError(`unknown device class: ${String(deviceClass)}`);
  }
  const tier = choice === 'auto' ? autoTiers[deviceClass] : choice;
  if (!TIERS.includes(tier)) {
    throw new RangeError(`unknown shadow tier: ${String(tier)}`);
  }
  return tier;
}

/** The held inputs the caster mode is derived from; never a stored mode. */
export interface CastingInputs {
  /** What the AR shadow prototype (or a shadow check) last asked for. */
  readonly arCasting: boolean;
  /** The view is suspended (an AR session owns the GPU). */
  readonly suspended: boolean;
  /** The city shadow tier IN EFFECT (not the user's choice). */
  readonly cityTier: ShadowTier;
}

/**
 * The caster mode for the held inputs. Suspended: `ar` if AR casts, else
 * `off`. Otherwise `city` when the city tier is not `off`, else `ar` if AR
 * casts, else `off`. Deriving it on every change (instead of storing it)
 * is what keeps two writers from overwriting each other.
 */
export function castingMode(inputs: CastingInputs): ShadowCastingMode {
  if (inputs.suspended) return inputs.arCasting ? 'ar' : 'off';
  if (inputs.cityTier !== 'off') return 'city';
  return inputs.arCasting ? 'ar' : 'off';
}

/** A mesh's two shadow flags. */
export interface ShadowFlags {
  readonly cast: boolean;
  readonly receive: boolean;
}

/**
 * An app's layer table: per layer name and mode, the mesh's flags; meshes
 * of a layer the table does not list take `fallback`.
 */
export interface ShadowLayerRows {
  readonly rows: Readonly<
    Record<string, Readonly<Record<ShadowCastingMode, ShadowFlags>>>
  >;
  readonly fallback: Readonly<Record<ShadowCastingMode, ShadowFlags>>;
}

/** The flags of a mesh of `layer` (undefined: no layer) in `mode`. */
export function layerShadowFlags(
  table: ShadowLayerRows,
  mode: ShadowCastingMode,
  layer: string | undefined
): ShadowFlags {
  const row =
    layer !== undefined && Object.hasOwn(table.rows, layer)
      ? table.rows[layer]
      : undefined;
  return (row ?? table.fallback)[mode];
}

/**
 * The caster generation compared by the update rule: the build generation
 * plus the generation of every layer that CASTS in `mode`. A change of a
 * layer that does not cast (a thinned wood while trees cast no shadow)
 * leaves it unchanged, so it re-renders no map. Layer order does not
 * matter.
 *
 * @throws RangeError for a non-finite build generation or layer generation.
 */
export function casterGeneration(
  buildGeneration: number,
  layers: Readonly<Record<string, number>>,
  mode: ShadowCastingMode,
  table: ShadowLayerRows
): string {
  if (!Number.isFinite(buildGeneration)) {
    throw new RangeError(
      `the build generation must be finite, got ${buildGeneration}`
    );
  }
  const casting = Object.keys(layers)
    .filter((layer) => layerShadowFlags(table, mode, layer).cast)
    .sort()
    .map((layer) => {
      const generation = layers[layer]!;
      if (!Number.isFinite(generation)) {
        throw new RangeError(
          `the generation of ${layer} must be finite, got ${generation}`
        );
      }
      return `${layer}:${generation}`;
    });
  return [`build:${buildGeneration}`, ...casting].join('|');
}

/** Which maps render in this frame, and whether another frame is needed. */
export interface MapRenderPlan {
  readonly near: boolean;
  readonly far: boolean;
  /** A map was deferred: the caller must request one more frame. */
  readonly again: boolean;
}

/**
 * Which of the maps that WANT a render get one this frame. With `split`
 * on, a frame that would render both renders only the near map and asks
 * for one more frame, in which the far map (still wanting) renders: the
 * cost of a sun step spreads over two frames. `farDeferred` says the last
 * frame deferred the far map: then the far map goes first, so continuous
 * sun steps alternate the maps instead of starving the far one.
 */
export function planMapRenders(input: {
  readonly near: boolean;
  readonly far: boolean;
  readonly split: boolean;
  readonly farDeferred?: boolean;
}): MapRenderPlan {
  if (input.split && input.near && input.far) {
    return input.farDeferred === true
      ? { near: false, far: true, again: true }
      : { near: true, far: false, again: true };
  }
  return { near: input.near, far: input.far, again: false };
}
