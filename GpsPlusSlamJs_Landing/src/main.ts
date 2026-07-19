/**
 * Landing-page bootstrap. Wires the DOM chapters to the 3D scroll story.
 *
 * Boot order matters: theme first (so the first rendered frame uses the
 * right palette), then capability detection (decides quality tier and
 * whether scroll-driven animation runs at all), then the 3D scene. Every
 * step degrades gracefully — the DOM copy must stand alone when WebGL or
 * motion is unavailable (see the plan doc's "Fallbacks" decision).
 */
import {
  applyCtaDeviceClaim,
  detectImmersiveArSupport,
  type XrSystemLike,
} from "./ar-support";
import { applyQrHandoff, shouldShowQrHandoff } from "./qr-handoff";
import {
  applyHeroSnippetDefault,
  shouldExpandHeroSnippet,
} from "./hero-snippet";
import {
  CHAPTER_DOTS_CONTAINER_ID,
  chapterDotsHtml,
  dotIndexFromClick,
  updateActiveDot,
} from "./chapter-dots";
import { CHAPTERS, sectionElementId } from "./chapters";
import { heroVeilOpacity } from "./hero-veil";
import { computeScrollState, type SectionMetrics } from "./scroll-story";
import { scrollColorStrength } from "./scroll-color";
import {
  createThemeController,
  resolveInitialTheme,
  SECRET_THEME_ID,
  type Theme,
} from "./theme";
import { createSecretUnlock } from "./secret-palette";
import { showEggToast } from "./egg-toast";
import { isGenuineClick } from "./scene/egg-picker";
import { printConsoleEgg } from "./console-egg";
import { BIRD_LINK } from "./scene/bird";
import { isPermissionlessDeviceOrientation } from "./scene/gyro-parallax";
import { decideQualityTier } from "./capability";
import {
  createSceneController,
  type SceneController,
} from "./scene/scene-controller";

function probeWebgl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function safeLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function collectSections(): HTMLElement[] {
  const sections: HTMLElement[] = [];
  for (const chapter of CHAPTERS) {
    const el = document.getElementById(sectionElementId(chapter.id));
    if (el) {
      sections.push(el);
    } else {
      // A missing section desynchronizes scroll mapping and story timeline;
      // fail loudly in the console but keep the rest of the page working.
      console.warn(
        `landing: missing chapter section #${sectionElementId(chapter.id)}`,
      );
    }
  }
  return sections;
}

/**
 * Section metrics in SCROLLER coordinates. `<main id="story">` is the
 * page's one and only scroller (the document never scrolls — that keeps
 * the mobile URL bar stationary and the scroll→progress mapping free of
 * URL-bar viewport-resize remaps).
 */
function measureSections(
  scroller: HTMLElement,
  sections: readonly HTMLElement[],
): SectionMetrics[] {
  const scrollerTop = scroller.getBoundingClientRect().top;
  return sections.map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top - scrollerTop + scroller.scrollTop,
      height: rect.height,
    };
  });
}

/**
 * Hero extras: the veil that hides the 3D world at the top (round-2 R4)
 * and the "jump to demos" fast smooth scroll (R17b). The jump targets
 * the CTA chapter's measured top (round-10 R10-2) — scrolling to
 * `scrollHeight` overshot into the FAQ once it existed below the demos.
 * Returns the per-scroll updater for the veil opacity.
 */
function wireHeroExtras(
  scroller: HTMLElement,
  demosTop: () => number | undefined,
  smoothScroll: boolean,
): () => void {
  const veil = document.getElementById("hero-veil");
  document.getElementById("jump-demos")?.addEventListener("click", (event) => {
    event.preventDefault();
    scroller.scrollTo({
      top: demosTop() ?? scroller.scrollHeight,
      behavior: smoothScroll ? "smooth" : "auto",
    });
  });
  return () => {
    if (veil) {
      // Keyed off the raw scroll offset (in viewport heights), NOT story
      // progress — the veil must be fully opaque exactly at the top.
      veil.style.opacity = String(
        heroVeilOpacity(
          scroller.scrollTop / Math.max(1, scroller.clientHeight),
        ),
      );
    }
  };
}

function markActiveChapter(
  sections: readonly HTMLElement[],
  activeIndex: number,
): void {
  sections.forEach((el, index) => {
    el.classList.toggle("active", index === activeIndex);
  });
}

/**
 * Easter-egg click glue (catalog §2): forward genuine clicks (no drag,
 * not on interactive elements or copy panels) to the scene's egg
 * plumbing as NDC, and surface egg feedback through the toast. Scroll
 * mode only — under reduced motion the eggs stay static (guardrail:
 * reduced motion = no new motion).
 */
function wireEggClicks(scroller: HTMLElement, scene: SceneController): void {
  let downAt: { x: number; y: number } | null = null;
  scroller.addEventListener("pointerdown", (event) => {
    downAt = { x: event.clientX, y: event.clientY };
  });
  scroller.addEventListener("pointerup", (event) => {
    const start = downAt;
    downAt = null;
    if (
      !start ||
      !isGenuineClick(start, { x: event.clientX, y: event.clientY })
    ) {
      return;
    }
    // Interactive elements and copy panels keep their own semantics —
    // eggs only fire on clicks into the open 3D world.
    if (
      event.target instanceof Element &&
      event.target.closest(
        "a, button, details, summary, input, .copy, .hero-content",
      )
    ) {
      return;
    }
    const result = scene.clickAt({
      x: (event.clientX / window.innerWidth) * 2 - 1,
      y: -(event.clientY / window.innerHeight) * 2 + 1,
    });
    if (result?.egg === "geocache" && result.opened) {
      showEggToast("🎉 Cache found — GCLANDING, logged.");
    } else if (result?.egg === "bird") {
      // Hidden bird (№10): open the cs-util X profile in a new tab.
      window.open(BIRD_LINK, "_blank", "noopener");
    }
  });
}

function boot(): void {
  // Console easter egg (catalog №5): a wry line for devtools-openers
  // (the console.info call is encapsulated in console-egg.ts).
  printConsoleEgg();

  // Fire-and-forget (round-8 Z6): upgrade the CTA's device claim on
  // immersive-ar-capable devices; everyone else keeps the honest static
  // default already in the HTML.
  void detectImmersiveArSupport((navigator as { xr?: XrSystemLike }).xr).then(
    (supported) => {
      applyCtaDeviceClaim(document, supported);
      // Desktop→phone QR handoff (v2 B2): only when this device cannot
      // run immersive-ar AND looks desktop-class.
      applyQrHandoff(
        document,
        shouldShowQrHandoff({
          arSupported: supported,
          viewportWidth: window.innerWidth,
          hasFinePointer: window.matchMedia(
            "(hover: hover) and (pointer: fine)",
          ).matches,
        }),
        window.location.href,
      );
    },
  );

  // Hero snippet default (round-9 R9-5): collapsed in the static HTML,
  // expanded on desktop-class viewports.
  applyHeroSnippetDefault(
    document,
    shouldExpandHeroSnippet({
      width: window.innerWidth,
      height: window.innerHeight,
    }),
  );

  const scroller = document.getElementById("story");
  if (!scroller) {
    console.warn("landing: missing #story scroller; page stays static");
    document.body.classList.add("no-webgl");
    return;
  }
  const sections = collectSections();
  let metrics = measureSections(scroller, sections);

  const tier = decideQualityTier({
    webglSupported: probeWebgl(),
    prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    deviceMemoryGb: (navigator as { deviceMemory?: number }).deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
  });

  let scene: SceneController | null = null;
  const sceneRoot = document.getElementById("scene-root");
  if (tier.mode !== "static-dom" && sceneRoot) {
    scene = createSceneController({
      container: sceneRoot,
      tier,
      // The FOUC guard already stamped the resolved theme on <html>; the
      // theme controller below re-applies it right after construction.
      // resolveInitialTheme validates the attribute (garbage → dusk).
      initialTheme: resolveInitialTheme(
        document.documentElement.dataset.theme ?? null,
      ),
      onContextLost: () => {
        // GPU gave up mid-visit: degrade to the static DOM floor rather
        // than freezing the story on a dead canvas.
        document.body.classList.add("no-webgl");
      },
      onContextRestored: () => {
        document.body.classList.remove("no-webgl");
      },
    });
  }
  if (!scene) {
    document.body.classList.add("no-webgl");
  }

  const toggleButton = document.getElementById("theme-toggle");
  const applyTheme = (theme: Theme): void => {
    document.documentElement.dataset.theme = theme;
    scene?.applyTheme(theme);
    toggleButton?.setAttribute(
      "aria-label",
      `Color palette: ${theme} — click to switch`,
    );
  };
  const secretUnlock = createSecretUnlock({
    storage: safeLocalStorage(),
    now: () => performance.now(),
  });
  const themeController = createThemeController({
    storage: safeLocalStorage(),
    applyTheme,
    isSecretUnlocked: () => secretUnlock.isUnlocked(),
  });
  toggleButton?.addEventListener("click", () => {
    // Secret palette (catalog №4): rapid cycling unlocks `terminal` and
    // jumps straight to it; otherwise a normal cycle step.
    if (secretUnlock.registerCycle()) {
      themeController.set(SECRET_THEME_ID);
    } else {
      themeController.cycle();
    }
  });

  // Chapter dot rail (v3 F6): filled at boot, active dot follows the
  // scroll state machine, click = scroll to the chapter (same scroller
  // mechanism as jump-to-demos; instant under reduced motion).
  const dots = document.getElementById(CHAPTER_DOTS_CONTAINER_ID);
  if (dots) {
    dots.innerHTML = chapterDotsHtml(CHAPTERS);
    dots.addEventListener("click", (event) => {
      const index = dotIndexFromClick(event.target);
      if (index === null) {
        return;
      }
      const top = metrics[index]?.top;
      if (top !== undefined) {
        scroller.scrollTo({
          top,
          behavior: tier.mode === "scroll" ? "smooth" : "auto",
        });
      }
    });
  }

  const updateHeroExtras = wireHeroExtras(
    scroller,
    // Closure over the mutable metrics: resize re-measurements stay live.
    () => metrics[CHAPTERS.length - 1]?.top,
    tier.mode === "scroll",
  );
  // Scroll-linked copy color (round-14 R14-4): each chapter's copy panel
  // fades its color-coded words in as it rises toward the top. Off under
  // reduced motion (no new scroll-driven change) — the default
  // --hl-strength:1 keeps the words full-color there.
  const copyPanels: HTMLElement[] =
    tier.mode === "scroll"
      ? Array.from(document.querySelectorAll<HTMLElement>(".copy"))
      : [];
  const updateCopyColor = (): void => {
    const vh = scroller.clientHeight;
    for (const panel of copyPanels) {
      const top = panel.getBoundingClientRect().top;
      panel.style.setProperty(
        "--hl-strength",
        scrollColorStrength(top, vh).toFixed(3),
      );
    }
  };

  let lastChapterIndex = -1;
  const onScrollChanged = (): void => {
    const state = computeScrollState(
      scroller.scrollTop,
      scroller.clientHeight,
      metrics,
    );
    updateHeroExtras();
    updateCopyColor();
    if (state.chapterIndex !== lastChapterIndex) {
      lastChapterIndex = state.chapterIndex;
      markActiveChapter(sections, state.chapterIndex);
      if (dots) {
        updateActiveDot(dots, state.chapterIndex);
      }
      if (tier.mode === "reduced-motion") {
        // Static compositions instead of scroll scrubbing.
        scene?.showChapterEndState(state.chapterIndex);
      }
    }
    if (tier.mode === "scroll") {
      scene?.setTargetProgress(state.storyProgress);
    }
  };

  // Visibility gate for the continuous particle render (v3 F2): a
  // hidden tab must burn no GPU.
  const syncPageVisible = (): void => {
    scene?.setPageVisible(!document.hidden);
  };
  document.addEventListener("visibilitychange", syncPageVisible);
  // Round-9 R9-6: a bfcache restore (navigate away in the SAME tab, then
  // back) can deliver `pageshow` WITHOUT a visibilitychange-to-visible —
  // the flag then stays false and exactly the particles freeze while
  // scroll-driven re-renders still happen. Re-sync on pageshow so the
  // state self-heals.
  window.addEventListener("pageshow", syncPageVisible);
  // Boot-hidden (opened in a background tab): no visibilitychange ever
  // fires, so the controller's `pageVisible` default (true) would leave
  // the continuous particle loop rendering invisibly. Seed the flag from
  // the current state once, up front.
  syncPageVisible();

  let introRunning = false;
  if (scene && tier.mode === "scroll") {
    wireEggClicks(scroller, scene);
    // Gyro parallax egg (№8, E9): permissionless platforms only (iOS's
    // requestPermission prompt would break the fully-hidden rule).
    if (isPermissionlessDeviceOrientation(window)) {
      window.addEventListener("deviceorientation", (event) => {
        scene.setGyroOrientation({ beta: event.beta, gamma: event.gamma });
      });
    }
    if (scroller.scrollTop < 40) {
      scene.playIntro();
      introRunning = true;
    }
    scene.start();
  } else if (scene) {
    scene.start();
  }

  scroller.addEventListener(
    "scroll",
    () => {
      if (introRunning && scroller.scrollTop > 40) {
        scene?.skipIntro();
        introRunning = false;
      }
      onScrollChanged();
    },
    { passive: true },
  );
  // Debounced: a collapsing/expanding mobile browser bar fires a resize
  // burst mid-gesture; re-measuring sections during it would remap scroll
  // progress under the user's finger (round-2 R2). One settle-time pass
  // is enough — the canvas itself is 100lvh-sized and needs no mid-burst
  // resize either.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      metrics = measureSections(scroller, sections);
      if (sceneRoot) {
        scene?.handleResize(sceneRoot.clientWidth, sceneRoot.clientHeight);
      }
      onScrollChanged();
    }, 150);
  });

  onScrollChanged();
}

boot();
