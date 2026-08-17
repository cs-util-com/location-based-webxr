# The AR building shell bypasses tone mapping and the sRGB encode

**Filed:** 2026-08-17, from the PR #313 review pass
([report](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/location-based-webxr_pr_review_comments_handled.md)).
**Status:** open — needs the owner's eye, not a code decision.

## The verified fact

`ar-scene-environment.ts:207-208` sets

```ts
renderer.toneMapping = AR_TONE_MAPPING;
renderer.toneMappingExposure = ...;
```

and its sidecar describes that as *"matches the demo's ACES grading"*.

**three.js applies tone mapping and the linear→sRGB encode to a
`ShaderMaterial` only if the fragment source contains
`#include <tonemapping_fragment>` and `#include <colorspace_fragment>`.** It
*substitutes* those chunks into source that asks for them; it does not inject
them into source that does not.

Neither string appears in
[`ar-building-material.ts`](../src/ar-building-material.ts), nor anywhere in
`GpsPlusSlamJs_OsmDemo/src` — verified by grep, 2026-08-17. So the shell's
`gl_FragColor` is written **raw**.

This part is not in doubt and is now stated in the material's own docstring.

## The two consequences

- **The tint is darker and less saturated than authored.** It is built with
  `new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace)`, which converts the
  authored HSL *into* the Linear-sRGB working space. Writing that value straight
  out to an `outputColorSpace = SRGBColorSpace` target skips the encode back, so
  the rendered colour is not the HSL picked in the shader lab.
- **The shell is the only thing in the AR scene not passing through ACES at
  exposure**, so its brightness *relative to* everything else is not the
  relationship that was approved.

## Why this is a question and not a bug

The material was ported from *"the owner's chosen shader-lab variant
(2026-08-16)"*. **If the lab previewed it ungraded, then what the owner approved
IS the raw output, and adding the chunks would change the approved look** —
making the "fix" the regression.

That is not something to settle from a desk, and it compounds with the risk the
docstring already carries: additive blending over a bright daylit street may
wash the glow out anyway, and the variant was judged against a procedural
backdrop.

## Options

- **Option A — add the two chunk includes.** For: the shell then obeys the same
  grade as the rest of the scene and the authored HSL renders as authored.
  Against: changes an owner-approved look without the owner seeing it; ACES will
  also compress the highlights that make an additive shell read as light.
- **Option B — leave it, keep the docstring note (done).** For: preserves
  exactly what was approved; zero risk. Against: the scene is inconsistently
  graded, and the next person to touch either file has to re-derive this.
- **Option C — decide it on a device.** Put the two variants behind the existing
  AR debug controls and look at both over a real camera feed.

**Recommendation: C, folded into the next on-device AR session.** This is a
look-and-feel judgement with a real daylight confound; a desk decision either
way is a guess. Until then B holds, and the docstring makes the bypass explicit
so nobody "tidies" it in either direction by accident.

## Related

- [`ar-building-material.ts`](../src/ar-building-material.ts) and its sidecar
- `ar-scene-environment.ts` — where the tone mapping and exposure are set
