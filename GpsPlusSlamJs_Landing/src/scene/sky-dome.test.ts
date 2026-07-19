/**
 * Why these tests matter: the sky dome (v3 F3) is the first thing that
 * turns the black void behind the world into a per-palette sky. It must
 * exist in every palette (role completeness), it must NOT be eaten by
 * the scene fog (a 150-unit dome behind a 90-unit fog would render as a
 * flat fog-colored shell), and each palette must toggle exactly its own
 * celestial accents (dark = moon + stars, dusk = sun + horizon band,
 * neon = star grid, light/mono = gradient only).
 */
import { describe, expect, it } from "vitest";
import { Color, type Mesh, type Points } from "three";
import { THEME_IDS } from "../theme";
import { getPalette } from "./palette";
import {
  SKY_NODE,
  applySkyPalette,
  buildSkyDome,
  domeGradientColorAt,
} from "./sky-dome";

describe("palette sky-role completeness", () => {
  it("every palette defines the full sky block", () => {
    for (const theme of THEME_IDS) {
      const sky = getPalette(theme).sky;
      expect(sky, theme).toBeDefined();
      expect(typeof sky.zenith, theme).toBe("number");
      expect(typeof sky.horizon, theme).toBe("number");
      expect(typeof sky.accentColor, theme).toBe("number");
      expect(["moon-stars", "sun", "star-grid", "none"]).toContain(sky.accents);
    }
  });
});

describe("buildSkyDome — structure", () => {
  it("contains the dome shell and every accent node, accents hidden initially", () => {
    const sky = buildSkyDome();
    expect(sky.name).toBe(SKY_NODE.root);
    for (const name of [
      SKY_NODE.shell,
      SKY_NODE.moon,
      SKY_NODE.stars,
      SKY_NODE.sun,
      SKY_NODE.horizonBand,
      SKY_NODE.starGrid,
      SKY_NODE.clouds,
    ]) {
      expect(sky.getObjectByName(name), name).toBeDefined();
    }
    for (const name of [
      SKY_NODE.moon,
      SKY_NODE.stars,
      SKY_NODE.sun,
      SKY_NODE.horizonBand,
      SKY_NODE.starGrid,
      SKY_NODE.clouds,
    ]) {
      expect(sky.getObjectByName(name)?.visible, name).toBe(false);
    }
  });

  it("keeps the dome (and accents) OUT of the scene fog so it stays visible behind it", () => {
    const sky = buildSkyDome();
    const foggedNodes: string[] = [];
    sky.traverse((obj) => {
      const material = (obj as Mesh).material as { fog?: boolean } | undefined;
      if (material && typeof material.fog === "boolean" && material.fog) {
        foggedNodes.push(obj.name);
      }
    });
    expect(foggedNodes).toEqual([]);
  });

  it("renders behind the world: depth writes off, negative render order", () => {
    const sky = buildSkyDome();
    const shell = sky.getObjectByName(SKY_NODE.shell) as Mesh;
    expect((shell.material as { depthWrite?: boolean }).depthWrite).toBe(false);
    expect(shell.renderOrder).toBeLessThan(0);
  });

  it("is deterministic: two builds produce identical star fields", () => {
    const starsA = (
      buildSkyDome().getObjectByName(SKY_NODE.stars) as Points
    ).geometry.getAttribute("position");
    const starsB = (
      buildSkyDome().getObjectByName(SKY_NODE.stars) as Points
    ).geometry.getAttribute("position");
    expect(starsA.array).toEqual(starsB.array);
  });

  it("is deterministic: two builds produce identical cloud banks (golden-hour restyle)", () => {
    // The dusk clouds are LCG-placed like the stars — a nondeterministic
    // bank would defeat the shoot-script screenshot review.
    const bank = (sky: ReturnType<typeof buildSkyDome>) =>
      sky
        .getObjectByName(SKY_NODE.clouds)!
        .children.map((c) =>
          [c.position.toArray(), c.scale.toArray(), c.rotation.y].flat(),
        );
    const a = bank(buildSkyDome());
    const b = bank(buildSkyDome());
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(a).toEqual(b);
  });
});

describe("applySkyPalette — per-palette accents and gradient", () => {
  const CASES = [
    ["dark", [SKY_NODE.moon, SKY_NODE.stars]],
    ["dusk", [SKY_NODE.sun, SKY_NODE.horizonBand, SKY_NODE.clouds]],
    ["neon", [SKY_NODE.starGrid]],
    ["light", []],
    ["mono", []],
  ] as const;

  it.each(CASES)("palette %s shows exactly its accents", (theme, visible) => {
    const sky = buildSkyDome();
    applySkyPalette(sky, getPalette(theme));
    const allAccents = [
      SKY_NODE.moon,
      SKY_NODE.stars,
      SKY_NODE.sun,
      SKY_NODE.horizonBand,
      SKY_NODE.starGrid,
      SKY_NODE.clouds,
    ];
    for (const name of allAccents) {
      expect(sky.getObjectByName(name)?.visible, `${theme}:${name}`).toBe(
        (visible as readonly string[]).includes(name),
      );
    }
  });

  it("tints the cloud bank with the palette's cloudColor (fallback: accentColor)", () => {
    // The peach clouds are the reference image's sky signature; a bank
    // stuck on the sun's accent color would read as orange smudges.
    const sky = buildSkyDome();
    const dusk = getPalette("dusk");
    applySkyPalette(sky, dusk);
    const clouds = sky.getObjectByName(SKY_NODE.clouds)!;
    for (const blob of clouds.children) {
      const material = (blob as Mesh).material as { color: Color };
      expect(material.color.getHex()).toBe(
        dusk.sky.cloudColor ?? dusk.sky.accentColor,
      );
    }
  });

  it("paints the dome as a vertex gradient from horizon (bottom) to zenith (top)", () => {
    const sky = buildSkyDome();
    const palette = getPalette("dusk");
    applySkyPalette(sky, palette);
    const shell = sky.getObjectByName(SKY_NODE.shell) as Mesh;
    const colors = shell.geometry.getAttribute("color");
    expect(colors).toBeDefined();
    // Sample the analytic gradient the vertices are painted with.
    const zenith = new Color(palette.sky.zenith);
    const horizon = new Color(palette.sky.horizon);
    const top = domeGradientColorAt(1, palette);
    const bottom = domeGradientColorAt(0, palette);
    expect(top.getHex()).toBe(zenith.getHex());
    expect(bottom.getHex()).toBe(horizon.getHex());
  });
});
