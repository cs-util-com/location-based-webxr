// @ts-check
import { expect, test } from "@playwright/test";

import {
  GLOBE_VIEW,
  answerHosts,
  noApproach,
  noClouds,
  openZip,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: a long text's narration is added in the
 * writer's Narration section, as the owner chose from the "in the
 * inspector" prototype (`public/prototypes/longtext-editor-1-in-the-
 * inspector/`). Only a browser runs the whole path: a real file input, the
 * browser's own reading of the voice's length, the timing file lined up
 * with the text, the tour's write, and the inspector following it. The
 * walk pins the promise the section makes: an edited word marks the
 * read-along stale, and lining the voice up again makes it read along
 * once more without touching the text. The layout test leaves the
 * prototype's section and the build's side by side at three desktop
 * sizes for the check by eye, and pins the rows' measures from the
 * prototype's CSS.
 */

test.describe.configure({ mode: "default" });

// The walks run on the globe, whose first frames on a software-WebGL
// runner are slow: measured 1.2 min (the import) and 2.0 min (the
// sizes) with CI=1 and one worker on 2026-11-03, so the budget is about
// twice the slower one.
const BUDGET_MS = 240_000;

const TOUR = "http://127.0.0.1:5197/ranges-ok/long-text-tour.zip";
const PROTOTYPE = "/prototypes/longtext-editor-1-in-the-inspector/index.html";
const VTT = [
  "WEBVTT",
  "",
  "00:00.000 --> 00:00.500",
  "The gate was built in 1400.",
  "",
  "00:00.500 --> 00:01.000",
  "It was rebuilt later.",
  "",
].join("\n");

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
];

/** One second of silence as a WAV file (8 kHz, mono, 16 bit). */
function silentWav() {
  const samples = 8000;
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(data, 40);
  return b;
}

/** @param {import("@playwright/test").Page} page */
async function essayNow(page) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  const gate = tour.stations.find((/** @type {any} */ s) => s.id === "gate");
  return gate.blocks.find((/** @type {any} */ b) => b.id === "gate-essay");
}

/** The session's read of the essay's narration (its timing text).
 * @param {import("@playwright/test").Page} page */
function narrationNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().narration("gate-essay"),
  );
}

/**
 * The editor with the long text tour open in the 3D view, its essay
 * selected and the Narration section open.
 * @param {import("@playwright/test").Page} page
 */
async function openNarration(page) {
  await page.context().addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  const zip = Buffer.from(await (await fetch(TOUR)).arrayBuffer());
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await noApproach(page);
  // Not about the clouds: without them the globe draws about 6 frames a
  // second here rather than 1.4, and a click waits about 1.8 s rather
  // than 9-10 s (`noClouds`). With them a CI runner ran this spec's
  // 5 s waits out: the inspector's width after "Wider", the imported
  // voice's file name.
  await noClouds(page);
  await page.goto(GLOBE_VIEW);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await openZip(page, zip, "long-text-tour.zip");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await page.locator('#tree-body .card[data-station="gate"] .pick').click();
  await page
    .locator('#tree-body .card[data-station="gate"] [data-select="gate-essay"]')
    .click();
  await expect(page.getByTestId("long-text-writer")).toBeVisible();
  await page.locator('[data-lw="narration"]').click();
  await expect(page.getByTestId("narration-section")).toBeVisible();
}

test("a voice and its timing are imported, a word is edited, and lining the voice up again keeps the read-along", async ({
  page,
}) => {
  test.setTimeout(BUDGET_MS);
  await openNarration(page);
  const head = page.locator('[data-lw="narration"] .sum');
  await expect(head).toHaveText("No voice yet");
  await expect(page.locator('[data-ln="timing-pick"]')).toBeDisabled();

  // The voice: its length read by the browser, the tour naming it.
  await page.getByTestId("narration-voice-file").setInputFiles({
    name: "gate-voice.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });
  await expect(page.locator(".ln-sec .ln-fn").first()).toHaveText(
    "gate-voice.wav",
  );
  await expect(head).toHaveText("Voice, no timing yet");
  const voiced = await essayNow(page);
  expect(voiced.narration.audio).toEqual(expect.any(String));
  expect(voiced.narration.durationMs).toBe(1000);

  // The timing: a subtitle file, lined up with the text as it is.
  await page.getByTestId("narration-timing-file").setInputFiles({
    name: "gate-voice.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(VTT),
  });
  await expect(page.getByTestId("narration-result")).toContainText(
    "Imported gate-voice.vtt",
  );
  await expect(head).toHaveText(/^Reads along/);
  expect((await essayNow(page)).narration.timing).toBe(
    "timing/gate-essay.json",
  );
  const imported = JSON.parse((await narrationNow(page)).timingText);
  expect(imported.segments).toHaveLength(2);
  await page.locator('[data-ln="last-ok"]').click();

  // A word edited: the read-along no longer fits, and says why.
  const area = page.getByTestId("long-text-writer");
  await area.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("r.");
  await expect(area).toHaveValue(
    "The gate was built in 1400.\n\nIt was rebuilt laterr.",
  );
  await expect
    .poll(async () => (await essayNow(page))?.body)
    .toBe("The gate was built in 1400.\n\nIt was rebuilt laterr.");
  const stale = page.getByTestId("narration-stale");
  await expect(stale).toContainText(
    "You edited the text after the voice was lined up",
  );
  await expect(head).toHaveText(/^Needs lining up/);

  // Lined up again: the text untouched, the read-along back, every
  // sentence still voiced.
  await page.locator('[data-ln="lineup"]').click();
  await expect(page.getByTestId("narration-result")).toContainText(
    "Lined up again",
  );
  await expect(page.getByTestId("narration-result")).toContainText(
    "2 of 2 sentences have their voice",
  );
  await expect(stale).toHaveCount(0);
  await expect(head).toHaveText(/^Reads along/);
  expect((await essayNow(page)).body).toBe(
    "The gate was built in 1400.\n\nIt was rebuilt laterr.",
  );
  const relined = JSON.parse((await narrationNow(page)).timingText);
  expect(relined.segments).toHaveLength(2);
  expect(relined.textHash).not.toBe(imported.textHash);
});

test("the Narration section sits in place at 1440x900, 1280x720 and 1024x768, beside the prototype", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(BUDGET_MS);
  await openNarration(page);
  const proto = await context.newPage();
  for (const size of SIZES) {
    const at = `at ${String(size.width)}x${String(size.height)}`;
    await page.setViewportSize(size);
    await expect
      .poll(
        async () =>
          (await page.locator("#shell-inspector").boundingBox())?.width ?? 0,
      )
      .toBe(size.width <= 1100 ? 340 : 360);
    const section = page.locator(".lw-nsec");
    await section.scrollIntoViewIfNeeded();
    // The prototype's measures: the disclosure 32 px high, the drop box
    // dashed and inside the body's 12 px side padding, its button under
    // the line.
    const headBox = await page.locator('[data-lw="narration"]').boundingBox();
    expect(headBox?.height, at).toBe(32);
    const body = await page.locator(".lw-nbody").boundingBox();
    const drop = await page.locator(".ln-drop").boundingBox();
    if (body === null || drop === null) throw new Error(`not shown ${at}`);
    expect(Math.round(drop.x - body.x), at).toBe(12);
    expect(Math.round(body.x + body.width - (drop.x + drop.width)), at).toBe(
      12,
    );
    const name = `${String(size.width)}x${String(size.height)}`;
    await section.screenshot({
      path: testInfo.outputPath(`build-narration-${name}.png`),
    });
    await page.screenshot({
      path: testInfo.outputPath(`build-${name}.png`),
    });
    await proto.setViewportSize(size);
    await proto.goto(PROTOTYPE);
    // The prototype opens on a narrated text with its section open: its
    // own debug bar takes the narration off, as the build's text is.
    await proto.getByRole("button", { name: "No narration" }).click();
    if (
      (await proto.locator("#narrHead").getAttribute("aria-expanded")) !==
      "true"
    ) {
      await proto.locator("#narrHead").click();
    }
    await proto.locator("#narrBody .drop").waitFor({ state: "visible" });
    await proto.locator("#nsec").screenshot({
      path: testInfo.outputPath(`prototype-narration-${name}.png`),
    });
    await proto.screenshot({
      path: testInfo.outputPath(`prototype-${name}.png`),
    });
  }
  await proto.close();
});
