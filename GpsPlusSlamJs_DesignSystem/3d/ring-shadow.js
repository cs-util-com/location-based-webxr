/**
 * THE RING SHADOW (round-2 plan 2026-09-26-2055, M2b): shadows over the whole
 * dense city without giving up the sharp central map.
 *
 * The sun keeps its central map (±220 m at 2048, 0.21 m texels). A second
 * DirectionalLight with NO intensity carries a coarse map over the whole ring
 * (±2450 m, 2.4 m texels), re-rendered only when the sun moves. The sun takes
 * its shadow from the central map inside that map's frustum and from the
 * ring map outside it, with a short fade across the central map's edge.
 *
 * Why not one map fitted to the ring: measured 2026-09-27, it covers the far
 * city exactly as well, but coarsens the central texels elevenfold (the
 * shadow's foot 0.3 m from a building loses a fifth of its darkening, and the
 * stand-in's metre-sized casters fall below one texel). Why not three's CSM:
 * it replaces the same chunks the page's haze chains onto (plan §3).
 *
 * HOW. `withRingShadow` rewrites three's `lights_fragment_begin` text. The
 * rewrite is inert unless TWO directional shadows exist, and then it assumes
 * shadow 0 is the sun and shadow 1 the ring: three orders shadow-casting
 * lights by scene traversal, so the ring light is added after the sun, under
 * the same parent. Were the order ever swapped, the sun would lose its
 * shadow entirely; the page's near shadow probes would then fail.
 *
 * @see ring-shadow.js.md
 */

/** The ring map's half width (m): the dense city stops at 2350 m. */
export const RING_HALF_WIDTH_M = 2450;
/** The ring map's size: 2.4 m texels (1024 read the same far, at 4.8 m). */
export const RING_MAP_SIZE = 2048;

/** three's shadow line inside the directional-light loop (r185). */
const THREE_SHADOW_BLOCK = `		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif`;

const MARKER = "RING SHADOW";

/**
 * The rewritten block. For the sun (index 0, with two shadows): the central
 * map's weight is 1 inside its frustum, fading to 0 over the outer tenth of
 * its square, and 0 outside its depth range. Depth matters: x and y are
 * LATERAL to the sun's ray, so at a low sun far ground along the sun's
 * azimuth projects inside the square (a first version read it "lit").
 * The ring light (index 1) carries no light and skips its own lookup.
 */
const RING_SHADOW_BLOCK = `		// ${MARKER} (DesignSystem 3d/ring-shadow.js)
		#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 0
		if ( directLight.visible && receiveShadow ) {
			vec3 nearCoord = vDirectionalShadowCoord[ 0 ].xyz;
			float nearEdge = max( abs( nearCoord.x - 0.5 ), abs( nearCoord.y - 0.5 ) ) * 2.0;
			float nearWeight = ( 1.0 - smoothstep( 0.85, 0.95, nearEdge ) ) * step( 0.0, nearCoord.z ) * step( nearCoord.z, 1.0 );
			DirectionalLightShadow nearShadow = directionalLightShadows[ 0 ];
			DirectionalLightShadow ringShadow = directionalLightShadows[ 1 ];
			float nearLit = nearWeight > 0.0 ? getShadow( directionalShadowMap[ 0 ], nearShadow.shadowMapSize, nearShadow.shadowIntensity, nearShadow.shadowBias, nearShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
			float ringLit = nearWeight < 1.0 ? getShadow( directionalShadowMap[ 1 ], ringShadow.shadowMapSize, nearShadow.shadowIntensity, ringShadow.shadowBias, ringShadow.shadowRadius, vDirectionalShadowCoord[ 1 ] ) : 1.0;
			directLight.color *= mix( ringLit, nearLit, nearWeight );
		}
		#elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 1
		#elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif`;

/**
 * three's `lights_fragment_begin` with the ring shadow. Idempotent; throws
 * when three's shadow line is not found, so a three upgrade that rewords it
 * fails loudly instead of leaving the far city unshadowed.
 */
export function withRingShadow(chunk) {
  if (chunk.includes(MARKER)) return chunk;
  if (!chunk.includes(THREE_SHADOW_BLOCK)) {
    throw new Error(
      "ring shadow: three's lights_fragment_begin no longer has the expected shadow line",
    );
  }
  return chunk.replace(THREE_SHADOW_BLOCK, RING_SHADOW_BLOCK);
}
