// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: a tour character's world views were built from
 * their prototype (`public/prototypes/station-blocks-7-character/`), and a
 * port can lose what made them work - the bubble hanging by its tail
 * beside his head, on the side toward the middle of the screen and never
 * off it; the name tag instead of the bubble far away; the beckon toward
 * the next station once he has spoken, named in the bubble's footer and
 * with no arrows drawn on the ground (those are the creator's own blocks);
 * the pop-up's scroll above its
 * stage - and still pass a test that asks only whether something drew.
 * These pin those positions and gaps on a phone, a phone held sideways
 * and a desktop, through the check page `character-views-check.html`
 * (the views without an AR session), seen from the prototype's own
 * viewpoint for its first station (4.8 m from him, eye 1.6 m).
 *
 * Restated here rather than read from the code under test: his place
 * (-3.2, -4.5), his height 1.85 m, the eye (-2.70, 0.27), the bubble
 * opening inside 9 m, the next station north of him (to the right of the
 * screen from the eye).
 *
 * Not pinned here: how the views look (a side-by-side check against the
 * prototype, by eye), the voice's timing, and the portrait card in the
 * walk card (`scene-view.test.ts` covers when it shows).
 */

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone sideways", width: 844, height: 390 },
  { name: "desktop", width: 1440, height: 900 },
];

const HIM = { x: -3.2, z: -4.5, heightM: 1.85 };
const EYE = { x: -2.6998, z: 0.2742 };
/** A point `m` metres from him along the line to the prototype's eye. */
function away(m) {
  const dx = EYE.x - HIM.x;
  const dz = EYE.z - HIM.z;
  const k = m / Math.hypot(dx, dz);
  return { x: HIM.x + dx * k, z: HIM.z + dz * k };
}

async function open(page, viewport) {
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto("/character-views-check.html?hook=1");
  await page.waitForFunction(() => window.__characterViewsCheck !== undefined);
  return errors;
}

/** Stand him in `view`, the visitor `distanceM` away looking at his
 *  head, and read the page's state. */
async function stand(page, view, distanceM, extra = {}) {
  const at = away(distanceM);
  return page.evaluate(
    async ([v, p, him, opts]) => {
      const check = window.__characterViewsCheck;
      check.setVoice(opts.voice ?? "idle");
      check.setBeckon(opts.beckon ?? null);
      check.lookAt(him.x, him.heightM * 0.82, him.z);
      check.standAt(p.x, p.z);
      await check.show({ view: v });
      check.settle();
      return check.state();
    },
    [view, at, HIM, extra],
  );
}

/** @param {{left:number,top:number,right:number,bottom:number}} r */
function inside(r, viewport, gutter = 0) {
  expect(r.left).toBeGreaterThanOrEqual(-gutter);
  expect(r.top).toBeGreaterThanOrEqual(-gutter);
  expect(r.right).toBeLessThanOrEqual(viewport.width + gutter);
  expect(r.bottom).toBeLessThanOrEqual(viewport.height + gutter);
}

// A software-rendered WebGL page per worker is slow.
test.describe.configure({ timeout: 90_000 });

test.afterEach(async ({ page }) => {
  await page
    .evaluate(() => window.__characterViewsCheck?.stop())
    .catch(() => undefined);
});

for (const viewport of VIEWPORTS) {
  test.describe(`a character's views at ${viewport.width}x${viewport.height} (${viewport.name})`, () => {
    test("near, the bubble hangs by its tail beside his head, toward the middle, on the screen", async ({
      page,
    }) => {
      const errors = await open(page, viewport);
      const s = await stand(page, "bubble", 4.8);
      expect(s).not.toBeNull();
      const figure = s.parts.figure;
      const bubble = s.parts.bubble;
      expect(figure).not.toBeNull();
      expect(bubble).not.toBeNull();
      expect(s.parts.pip).toBeNull();
      expect(s.head).not.toBeNull();
      const figH = figure.bottom - figure.top;
      // He stands on the screen, a person's height at 4.8 m.
      inside(figure, viewport, 2);
      expect(figH).toBeGreaterThan(viewport.height * 0.25);
      // The bubble's foot is at his head's height (its tail tip hangs
      // beside the head at 0.86 of his height), not above or below it.
      expect(Math.abs(bubble.bottom - s.head.y)).toBeLessThan(figH * 0.12);
      // On the side toward the middle of the screen, the side its state
      // names, its body clear of his face.
      // (Asked only of a head clearly off the middle: near it the
      // prototype keeps the right side, so the bubble does not flip.)
      const headNdc = (2 * s.head.x) / viewport.width - 1;
      if (Math.abs(headNdc) > 0.15) {
        expect(s.side).toBe(headNdc < 0 ? "right" : "left");
      }
      const bubbleMid = (bubble.left + bubble.right) / 2;
      if (s.side === "right") expect(bubbleMid).toBeGreaterThan(s.head.x);
      else expect(bubbleMid).toBeLessThan(s.head.x);
      // Never off the screen (slid back when both sides overflow).
      inside(bubble, viewport, 2);
      // Big enough to read: at least a sixth of the short side tall.
      expect(bubble.bottom - bubble.top).toBeGreaterThan(
        Math.min(viewport.width, viewport.height) / 6,
      );
      expect(errors).toEqual([]);
    });

    test("far, the name tag stands over his head instead of the bubble", async ({
      page,
    }) => {
      const errors = await open(page, viewport);
      const s = await stand(page, "bubble", 20);
      expect(s.parts.bubble).toBeNull();
      const pip = s.parts.pip;
      expect(pip).not.toBeNull();
      expect(s.head).not.toBeNull();
      // Above his head's height, near him, on the screen.
      expect(pip.bottom).toBeLessThanOrEqual(s.head.y + 4);
      expect(pip.top).toBeGreaterThan(s.head.y - viewport.height * 0.3);
      inside(pip, viewport, 2);
      expect(errors).toEqual([]);
    });

    test("in two stations, once he has spoken, he beckons toward the next station with no arrow on the ground, still faces the visitor, and the bubble names it", async ({
      page,
    }) => {
      const errors = await open(page, viewport);
      const s = await stand(page, "two-stations", 4.8, {
        voice: "spoken",
        beckon: true,
      });
      expect(s.beckoning).toBe(true);
      expect(s.footer).toBe("Next: East road");
      // He beckons with the sheet's beckon frame, the arm toward the next
      // station: it lies to the north, on the screen's right from here.
      expect(s).toMatchObject({ frames: 4, frame: 3, mirrored: false });
      const toEye = Math.atan2(EYE.x - HIM.x, EYE.z - HIM.z);
      const off = Math.abs(
        Math.atan2(Math.sin(s.turn - toEye), Math.cos(s.turn - toEye)),
      );
      // He keeps facing the visitor (a turned flat cut-out reads squashed).
      expect(off).toBeLessThan(0.05);
      // No arrow is drawn: the beckon is his frame and the footer.
      expect(s).not.toHaveProperty("arrow");
      expect(s.parts).not.toHaveProperty("arrow");
      inside(s.parts.bubble, viewport, 2);
      // While he speaks there is no beckon.
      const speaking = await stand(page, "two-stations", 4.8, {
        voice: "speaking",
        beckon: true,
      });
      expect(speaking.beckoning).toBe(false);
      expect(speaking.footer).toBe("Speaking");
      // Seen from the west the next station lies on the screen's left:
      // the beckon is mirrored, the figure standing in the same place.
      const idle = await stand(page, "two-stations", 4.8, { voice: "idle" });
      const west = await page.evaluate(async (him) => {
        const check = window.__characterViewsCheck;
        check.setVoice("spoken");
        check.setBeckon(true);
        check.lookAt(him.x, him.heightM * 0.82, him.z);
        check.standAt(him.x, him.z - 4.8);
        await check.show({ view: "two-stations" });
        check.settle();
        return check.state();
      }, HIM);
      expect(west).toMatchObject({ beckoning: true, frame: 3, mirrored: true });
      const beckonedFrom = await stand(page, "two-stations", 4.8, {
        voice: "spoken",
        beckon: true,
      });
      // Every pose is a cell of one size: the beckon moves no part of him.
      // He breathes (his height 0.6 % up and down, a slight sway) between
      // the two reads, so the edges agree to 2 % of his height; a pose drawn
      // at another size or place would move them by far more.
      const tall = idle.parts.figure.bottom - idle.parts.figure.top;
      for (const k of ["left", "top", "right", "bottom"]) {
        expect(
          Math.abs(beckonedFrom.parts.figure[k] - idle.parts.figure[k]),
        ).toBeLessThan(0.02 * tall);
      }
      expect(errors).toEqual([]);
    });

    test("while he speaks his mouth moves and the bubble reads along word by word; the bubble view's mouth stays still", async ({
      page,
    }) => {
      const errors = await open(page, viewport);
      await stand(page, "speak", 4.8, { voice: "speaking" });
      // Sample his state every frame until every talking frame and the third
      // word have been seen (no clock: the wait ends on what is seen).
      await page.evaluate(() => {
        const check = window.__characterViewsCheck;
        const seen = { frames: [], words: [], done: false };
        window.__seenSpeaking = seen;
        const sample = () => {
          const st = check.state();
          if (!seen.frames.includes(st.frame)) seen.frames.push(st.frame);
          seen.words.push(st.activeWord);
          if (!seen.done) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.waitForFunction(() => {
        const seen = window.__seenSpeaking;
        return (
          [0, 1, 2].every((f) => seen.frames.includes(f)) &&
          Math.max(...seen.words) >= 2
        );
      });
      const seen = await page.evaluate(() => {
        window.__seenSpeaking.done = true;
        return window.__seenSpeaking;
      });
      expect(seen.frames).toEqual(expect.arrayContaining([0, 1, 2]));
      expect(seen.frames).not.toContain(3);
      // The read-along runs forward, one word after the other.
      for (let i = 1; i < seen.words.length; i++) {
        expect(seen.words[i]).toBeGreaterThanOrEqual(seen.words[i - 1]);
      }
      expect(Math.max(...seen.words)).toBeGreaterThanOrEqual(2);
      await stand(page, "bubble", 4.8, { voice: "speaking" });
      const still = await page.evaluate(async () => {
        const check = window.__characterViewsCheck;
        const frames = new Set();
        // Fifty frames (some 0.8 s or more): a speaking view flips his mouth
        // every 115 ms, so a mouth that moved here would be seen.
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          frames.add(check.state().frame);
        }
        return [...frames];
      });
      expect(still).toEqual([0]);
      expect(errors).toEqual([]);
    });

    test("in the pop-up the stage unfolds near him with the scroll above it, and no standing figure", async ({
      page,
    }) => {
      const errors = await open(page, viewport);
      const s = await stand(page, "popup", 4.8);
      expect(s.parts.figure).toBeNull();
      expect(s.unfold).toBe(1);
      const popup = s.parts.popup;
      const scroll = s.parts.scroll;
      expect(popup).not.toBeNull();
      expect(scroll).not.toBeNull();
      // The scroll hangs above the stage and its figure, centred over
      // the stage.
      expect(s.head).not.toBeNull();
      expect(scroll.bottom).toBeLessThan(s.head.y);
      expect(scroll.top).toBeGreaterThanOrEqual(popup.top - 2);
      const popMid = (popup.left + popup.right) / 2;
      const scrollMid = (scroll.left + scroll.right) / 2;
      expect(Math.abs(popMid - scrollMid)).toBeLessThan(
        (popup.right - popup.left) * 0.25,
      );
      // Its lower part, the end of his line, is on the screen everywhere;
      // the whole scroll only on an upright phone. From this viewpoint
      // (4.8 m, the short side seeing 40 degrees) the prototype too cuts
      // the scroll's top off on a sideways phone and a desktop.
      expect(scroll.bottom).toBeGreaterThan(viewport.height * 0.1);
      if (viewport.height > viewport.width) {
        expect(scroll.top).toBeGreaterThanOrEqual(-2);
      }
      // Far away it stays folded.
      const far = await stand(page, "popup", 20);
      expect(far.unfold).toBe(0);
      expect(far.parts.scroll).toBeNull();
      expect(errors).toEqual([]);
    });
  });
}
