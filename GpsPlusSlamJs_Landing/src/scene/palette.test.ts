import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from "three";
import { ALL_THEME_IDS } from "../theme";
import {
  applyPaletteToScene,
  getPalette,
  PALETTE_ROLES,
  type PaletteRole,
} from "./palette";

// Why this test matters: the dual palette is the "both themes with a toggle"
// product decision. A role missing from one theme would silently leave
// meshes in the other theme's colors after a toggle; a drifted accent would
// break the brand continuity with the page chrome (--accent: #ef4444).

describe("getPalette", () => {
  it("defines every role in every palette", () => {
    for (const theme of ALL_THEME_IDS) {
      const palette = getPalette(theme);
      for (const role of PALETTE_ROLES) {
        expect(palette.roles[role], `${theme}/${role}`).toBeDefined();
      }
    }
  });

  it("keeps the color CODING invariant across ALL palettes (round-2 D3, golden-hour retune)", () => {
    // GPS/QR = amber family, anchors = red family, so the copy highlights
    // and the story stay readable no matter which palette is cycled to.
    // The golden-hour restyle (2026-07-19) retuned DUSK's anchor red to a
    // deeper crimson that harmonizes with the copper/teal grade — a
    // deliberate per-theme exception; every other theme keeps the brand
    // #ef4444 (matching the page chrome's :root --accent).
    const expectedAccent: Record<string, number> = {
      light: 0xef4444,
      dark: 0xef4444,
      neon: 0xef4444,
      dusk: 0xe0483c,
      mono: 0xef4444,
      terminal: 0xef4444,
    };
    for (const theme of ALL_THEME_IDS) {
      const roles = getPalette(theme).roles;
      expect(roles.markerFused.color, `${theme}/fused`).toBe(
        expectedAccent[theme],
      );
      expect(roles.poi.color, `${theme}/poi`).toBe(expectedAccent[theme]);
      // Red family guard: any future retune must stay clearly red so the
      // anchor coding never drifts toward orange/pink.
      const red = roles.markerFused.color;
      const [rR, rG, rB] = [(red >> 16) & 0xff, (red >> 8) & 0xff, red & 0xff];
      expect(rR, `${theme}/fused R`).toBeGreaterThan(190);
      expect(rR - rG, `${theme}/fused R-G`).toBeGreaterThan(100);
      expect(rR - rB, `${theme}/fused R-B`).toBeGreaterThan(100);
      // Amber family: red and green channels high, blue low.
      const amber = roles.markerRaw.color;
      expect((amber >> 16) & 0xff, `${theme}/raw R`).toBeGreaterThan(150);
      expect(amber & 0xff, `${theme}/raw B`).toBeLessThan(100);
    }
  });

  it("defines the portal-interior gradient block in every palette (golden-hour portal)", () => {
    // The rebuilt portal's "other world" plane is vertex-colored, so it
    // cannot ride the role traversal — a theme missing the block would
    // keep the previous theme's world visible inside the frame.
    for (const theme of ALL_THEME_IDS) {
      const interior = getPalette(theme).portalInterior;
      expect(interior, theme).toBeDefined();
      expect(typeof interior.top, `${theme}/top`).toBe("number");
      expect(typeof interior.bottom, `${theme}/bottom`).toBe("number");
      expect(typeof interior.clouds, `${theme}/clouds`).toBe("number");
    }
  });

  it("keeps the dark theme's world objects readable against the background (round-4 V3)", () => {
    // Round-4 feedback: skyline city, statue and path were "dark gray on
    // near-black" — barely recognizable. Pin a WCAG-contrast floor per
    // flagged role over the dark background so a future palette tweak can
    // never silently sink the world into the night again. Floors sit one
    // visible step above the flagged (too dark) values.
    const wcagChannel = (byte: number): number => {
      const c = byte / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (hex: number): number =>
      0.2126 * wcagChannel((hex >> 16) & 0xff) +
      0.7152 * wcagChannel((hex >> 8) & 0xff) +
      0.0722 * wcagChannel(hex & 0xff);
    const dark = getPalette("dark");
    const background = luminance(dark.background);
    const contrast = (role: PaletteRole): number =>
      (luminance(dark.roles[role].color) + 0.05) / (background + 0.05);
    expect(contrast("skyline"), "skyline").toBeGreaterThanOrEqual(2.0);
    expect(contrast("path"), "path").toBeGreaterThanOrEqual(2.2);
    expect(contrast("statue"), "statue").toBeGreaterThanOrEqual(3.0);
    // Round-5 W4: the phone frame was near-black on near-black — it must
    // clearly stand out AND read as part of the blue (AR) family.
    expect(contrast("phone"), "phone").toBeGreaterThanOrEqual(2.5);
    const phone = dark.roles.phone.color;
    expect(
      (phone & 0xff) - ((phone >> 16) & 0xff),
      "phone blue-ness",
    ).toBeGreaterThan(40);
  });

  it("keeps the dusk theme's world objects readable against the background (golden-hour restyle)", () => {
    // Same lesson as the dark-theme floors (round-4 V3): the new deep
    // teal-green dusk background must never silently swallow the world.
    // Floors mirror the dark test, one step gentler for statue (it sits
    // in warm directional light at dusk rather than in shadow).
    const wcagChannel = (byte: number): number => {
      const c = byte / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (hex: number): number =>
      0.2126 * wcagChannel((hex >> 16) & 0xff) +
      0.7152 * wcagChannel((hex >> 8) & 0xff) +
      0.0722 * wcagChannel(hex & 0xff);
    const dusk = getPalette("dusk");
    const background = luminance(dusk.background);
    const contrast = (role: PaletteRole): number =>
      (luminance(dusk.roles[role].color) + 0.05) / (background + 0.05);
    expect(contrast("skyline"), "skyline").toBeGreaterThanOrEqual(2.0);
    expect(contrast("path"), "path").toBeGreaterThanOrEqual(2.2);
    expect(contrast("statue"), "statue").toBeGreaterThanOrEqual(2.5);
    expect(contrast("phone"), "phone").toBeGreaterThanOrEqual(2.5);
    const phone = dusk.roles.phone.color;
    expect(
      (phone & 0xff) - ((phone >> 16) & 0xff),
      "phone blue-ness",
    ).toBeGreaterThan(40);
  });

  it("pins the dusk teal-and-orange grade mechanically (golden-hour restyle)", () => {
    // The art direction in one test: lit/horizontal surfaces warm
    // (copper/orange), vegetation and the portal frame teal-green, and
    // the portal interior a warm-over-cool sunset gradient. A future
    // palette tweak that flips any of these flips the whole look.
    const r = (hex: number): number => (hex >> 16) & 0xff;
    const g = (hex: number): number => (hex >> 8) & 0xff;
    const b = (hex: number): number => hex & 0xff;
    const dusk = getPalette("dusk");
    for (const warm of ["ground", "grass", "hill", "path"] as const) {
      expect(r(dusk.roles[warm].color), `${warm} warm`).toBeGreaterThan(
        b(dusk.roles[warm].color),
      );
    }
    for (const teal of ["foliage", "portal"] as const) {
      expect(
        g(dusk.roles[teal].color),
        `${teal} teal-green`,
      ).toBeGreaterThanOrEqual(r(dusk.roles[teal].color));
    }
    // Interior gradient: bottom (horizon) clearly warmer than top (sky).
    const { top, bottom } = dusk.portalInterior;
    expect(r(bottom) - b(bottom)).toBeGreaterThan(r(top) - b(top));
  });

  it("gives the dark theme glowing accents (emissive) and the light theme matte clay", () => {
    // The plan's visual decision: dark = glowing anchors/traces, light =
    // matte clay. Emissive intensity is the mechanism.
    const dark = getPalette("dark").roles.markerFused;
    const light = getPalette("light").roles.markerFused;
    expect(dark.emissiveIntensity ?? 0).toBeGreaterThan(0);
    expect(light.emissiveIntensity ?? 0).toBe(0);
  });
});

describe("applyPaletteToScene", () => {
  function roleMesh(role: PaletteRole): Mesh {
    const mesh = new Mesh(new SphereGeometry(1), new MeshStandardMaterial());
    mesh.userData.paletteRole = role;
    return mesh;
  }

  it("recolors every role-tagged mesh in the subtree", () => {
    const root = new Group();
    const ground = roleMesh("ground");
    const nested = new Group();
    const marker = roleMesh("markerFused");
    nested.add(marker);
    root.add(ground, nested);

    applyPaletteToScene(root, getPalette("dark"));
    const darkGround = getPalette("dark").roles.ground.color;
    expect((ground.material as MeshStandardMaterial).color.getHex()).toBe(
      darkGround,
    );
    expect((marker.material as MeshStandardMaterial).color.getHex()).toBe(
      0xef4444,
    );

    // Toggling back fully restores the other palette (no sticky state).
    applyPaletteToScene(root, getPalette("light"));
    expect((ground.material as MeshStandardMaterial).color.getHex()).toBe(
      getPalette("light").roles.ground.color,
    );
  });

  it("ignores meshes without a role tag and unknown role strings", () => {
    const root = new Group();
    const plain = new Mesh(new SphereGeometry(1), new MeshStandardMaterial());
    plain.material.color.setHex(0x123456);
    const bogus = new Mesh(new SphereGeometry(1), new MeshStandardMaterial());
    bogus.userData.paletteRole = "not-a-real-role";
    bogus.material.color.setHex(0x654321);
    root.add(plain, bogus);

    applyPaletteToScene(root, getPalette("dark"));
    expect(plain.material.color.getHex()).toBe(0x123456);
    expect(bogus.material.color.getHex()).toBe(0x654321);
  });
});
