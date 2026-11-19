/**
 * The two-map sun shadow's shader side: a rewrite of three's
 * `lights_fragment_begin` that gives the sun (directional shadow 0) two
 * cached maps. A sharp NEAR map around the view and a coarse FAR map over
 * the whole city, carried by a second directional light of zero intensity
 * (shadow 1). The sun reads the near map inside the near map's frustum and
 * the far map outside it, with a fade across the near square's outer tenth
 * and across the end of its depth range.
 *
 * Why a chunk rewrite and not a material patch: it replaces no material's
 * `onBeforeCompile` (pages chain theirs for water, haze and cloud shadows),
 * and it is inert unless two directional shadows exist, so it is installed
 * once per page. Why not three's CSM: it assigns every material's hook and
 * re-renders every cascade every frame.
 *
 * Pure text: no three.js import, so it is testable against the real chunk
 * of whichever three the caller serves.
 *
 * @see two-map-shadow.ts.md
 */

import { FADE_START_DEPTH } from './shadow-fit.js';

/** Where the near map's depth fade ends (normalised depth, below 1). */
export const FADE_END_DEPTH = 0.995;

/** three's shadow line inside the directional-light loop (r185). */
const THREE_SHADOW_BLOCK = `		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif`;

const MARKER = 'TWO-MAP SHADOW';

/**
 * The rewritten block. For the sun (index 0, with two shadows) the near
 * map's weight is 1 inside its frustum, fading to 0 over the outer tenth of
 * its square and over the last part of its depth range. Depth matters: x
 * and y are LATERAL to the sun's ray, so at a low sun far ground along the
 * sun's azimuth projects inside the square, and along the azimuth the depth
 * end is the only seam. The far light (index 1) carries no light and skips
 * its own lookup; the sun's shadow intensity applies to both maps.
 */
const TWO_MAP_BLOCK = `		// ${MARKER} (gps-plus-slam-app-framework visualization/two-map-shadow)
		#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 0
		if ( directLight.visible && receiveShadow ) {
			vec3 nearCoord = vDirectionalShadowCoord[ 0 ].xyz;
			float nearEdge = max( abs( nearCoord.x - 0.5 ), abs( nearCoord.y - 0.5 ) ) * 2.0;
			float nearWeight = ( 1.0 - smoothstep( 0.85, 0.95, nearEdge ) ) * step( 0.0, nearCoord.z ) * ( 1.0 - smoothstep( ${FADE_START_DEPTH}, ${FADE_END_DEPTH}, nearCoord.z ) );
			DirectionalLightShadow nearShadow = directionalLightShadows[ 0 ];
			DirectionalLightShadow farShadow = directionalLightShadows[ 1 ];
			float nearLit = nearWeight > 0.0 ? getShadow( directionalShadowMap[ 0 ], nearShadow.shadowMapSize, nearShadow.shadowIntensity, nearShadow.shadowBias, nearShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
			float farLit = nearWeight < 1.0 ? getShadow( directionalShadowMap[ 1 ], farShadow.shadowMapSize, nearShadow.shadowIntensity, farShadow.shadowBias, farShadow.shadowRadius, vDirectionalShadowCoord[ 1 ] ) : 1.0;
			directLight.color *= mix( farLit, nearLit, nearWeight );
		}
		#elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 1
		#elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif`;

/**
 * three's `lights_fragment_begin` with the two-map shadow. Idempotent.
 *
 * @throws TypeError for a chunk that is not a string; Error when three's
 *   shadow line is not found, so a three upgrade that rewords it fails
 *   loudly instead of leaving the far city unshadowed.
 */
export function withTwoMapShadow(chunk: string): string {
  if (typeof chunk !== 'string') {
    throw new TypeError('the light chunk must be a string');
  }
  if (chunk.includes(MARKER)) return chunk;
  if (!chunk.includes(THREE_SHADOW_BLOCK)) {
    throw new Error(
      "two-map shadow: three's lights_fragment_begin no longer has the expected shadow line"
    );
  }
  return chunk.replace(THREE_SHADOW_BLOCK, TWO_MAP_BLOCK);
}
