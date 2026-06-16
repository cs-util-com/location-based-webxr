import { expect } from "@playwright/test";

/**
 * e2e fakes for the QR-tracking demo.
 *
 * Playwright Chromium has no WebXR / camera / depth, so the application flow
 * (boot → per-frame detect + depth-size → store + glued debug objects) cannot
 * run against real hardware. The app exposes a DEV-only device seam
 * (`window.__qrDemoSeams`, guarded by `import.meta.env.DEV && !VITEST` so it is
 * statically stripped from production). This helper installs deterministic fakes
 * over that seam *before* page scripts run (`addInitScript`) and a small control
 * surface (`window.__qrDemoTest`) the specs drive from `page.evaluate`.
 *
 * The fake depth context maps the (fixed) corner screen points to a planar
 * square in world space, so every observation yields the SAME size (0.2 m) and
 * the running median converges to `estimated` with zero spread — deterministic.
 */

/** The fixed detection + frame geometry (a pixel square on a 512×512 frame). */
const FRAME_SIZE = 512;
const QR_TEXT = "https://demo/qr";
// 200 px square → 200/512 screen square; unproject scale 0.512 → 0.2 m side.
const UNPROJECT_SCALE = 0.512;

/**
 * Install the DEV seam fakes + test control surface. MUST be called BEFORE
 * `page.goto('/')`.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function installQrDemoFakes(page, { planar = true } = {}) {
  await page.addInitScript(
    ({ frameSize, qrText, unprojectScale, planar }) => {
      /** Mutable control surface the specs drive from `page.evaluate`. */
      const control = {
        /** Real THREE objects the debug view adds to the faked arWorldGroup. */
        worldGroupChildren: [],
        /** The frame callback stashed by the faked `startFrameSource`. */
        pump: null,
      };
      window.__qrDemoTest = control;

      const fakeGroup = {
        children: control.worldGroupChildren,
        add(child) {
          control.worldGroupChildren.push(child);
        },
        remove(child) {
          const i = control.worldGroupChildren.indexOf(child);
          if (i !== -1) control.worldGroupChildren.splice(i, 1);
        },
      };

      const detection = {
        corners: [
          { x: 150, y: 150 },
          { x: 350, y: 150 },
          { x: 350, y: 350 },
          { x: 150, y: 350 },
        ],
        text: qrText,
      };

      window.__qrDemoSeams = {
        checkSupport: () =>
          Promise.resolve({ webxr: true, depthSensing: true }),
        initAR: () => Promise.resolve(),
        endARSession: () => Promise.resolve(),
        getArWorldGroup: () => fakeGroup,
        createDetect: () => () => Promise.resolve(detection),
        getDepthContext: () => ({
          // Linear screen→world map; the square frame keeps the quad square.
          // When `planar` is false, the bottom-right corner (screenX,screenY
          // both > 0.5) is pushed out of the plane so `estimateQrSizeFromDepth`'s
          // planarity score drops below the accept threshold and the size never
          // leaves `unknown`. Under the STRICT depth→size→PnP gate that means the
          // pose is never solved (no lock, nothing glued) — the accepted §2.7
          // consequence of mirroring production's size gate.
          unprojector: {
            unproject: (dp) => [
              dp.screenX * unprojectScale,
              dp.screenY * unprojectScale,
              !planar && dp.screenX > 0.5 && dp.screenY > 0.5 ? -0.9 : -1,
            ],
          },
          depthAt: () => 1,
          cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
          // Column-major XRView projection → fx=fy=frameSize, cx=cy=frameSize/2.
          // Only used to derive intrinsics for the (faked) solver; its exact
          // value is irrelevant because the fake solvePose ignores it.
          projectionMatrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }),
        // Faked PnP solver: a fixed solution (QR centered 1 m in front), so the
        // locked path runs end-to-end without opencv.js. Bypasses the real
        // `solveQrPose` reprojection gate (covered by framework unit tests).
        loadSolvePose: () =>
          Promise.resolve(() => ({
            qrPoseWorld: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
            qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
            reprojectionErrorPx: 0.5,
          })),
        startFrameSource: (onImage) => {
          control.pump = onImage;
          return () => {
            control.pump = null;
          };
        },
      };

      // Stash the frame geometry for `feedFrames`.
      control.frameImage = {
        data: new Uint8ClampedArray(0),
        width: frameSize,
        height: frameSize,
      };
    },
    {
      frameSize: FRAME_SIZE,
      qrText: QR_TEXT,
      unprojectScale: UNPROJECT_SCALE,
      planar,
    },
  );
}

/**
 * Boot the app through the Start gesture and wait until the live HUD shows.
 * @param {import('@playwright/test').Page} page
 */
export async function bootQrDemo(page) {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("hud")).toBeVisible();
}

/**
 * Drive `n` frames through the stashed frame callback. Frames are spaced ~150 ms
 * apart in real time so each clears the controller's ~125 ms detection throttle
 * (and the async detect chain settles between pumps) — locks accumulate
 * deterministically while exercising the real throttle path, not bypassing it.
 * @param {import('@playwright/test').Page} page
 * @param {number} n
 */
export async function feedFrames(page, n) {
  await page.evaluate(async (count) => {
    const control = window.__qrDemoTest;
    if (!control.pump) throw new Error("frame source not started — boot first");
    for (let i = 0; i < count; i++) {
      control.pump(control.frameImage);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }, n);
}

export { QR_TEXT };
