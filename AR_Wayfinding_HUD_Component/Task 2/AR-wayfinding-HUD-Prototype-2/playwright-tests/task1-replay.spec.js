import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

// Reads the recording zip in-process via fflate. The previous implementation
// shelled out to the `unzip` CLI, which does not exist on Windows and made
// this spec *nix-only. The filter keeps the large image entries compressed —
// only the JSON payloads are inflated.
function loadTask1Replay(zipPath) {
  const zipBytes = new Uint8Array(readFileSync(zipPath));
  const entries = unzipSync(zipBytes, {
    filter: (file) =>
      file.name === 'session.json' ||
      (file.name.startsWith('actions/') && file.name.endsWith('.json')),
  });

  const session = JSON.parse(strFromU8(entries['session.json']));
  const actions = Object.keys(entries)
    .filter((entryName) => entryName.startsWith('actions/'))
    .sort()
    .map((entryName) => JSON.parse(strFromU8(entries[entryName])));

  return { session, actions };
}

function getReplayCameraFrames(actions) {
  return actions
    .filter((action) => action?.type === 'gpsData/recordGpsEvent')
    .map((action) => {
      const { odomPosition, odomRotation } = action.payload;

      return {
        position: odomPosition,
        quaternion: odomRotation,
      };
    });
}

const here = dirname(fileURLToPath(import.meta.url));
const task1ReplayPath = join(
  here,
  '../../../Task 1/2026-06-16_12-17-21utc.zip'
);

test.describe('Task 2 replay harness in Chrome', () => {
  test('replays Task 1 frames through the HUD in a real browser', async ({
    page,
  }) => {
    const consoleIssues = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleIssues.push(message.text());
      }
    });

    const { session, actions } = loadTask1Replay(task1ReplayPath);
    const frames = getReplayCameraFrames(actions);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeGreaterThanOrEqual(session.frameCount);

    await page.goto('/playwright-tests/replay-harness.html');
    await expect(page.locator('#hud-report')).toHaveText(/Waiting for replay/);
    await page.waitForFunction(() => window.task2ReplayHarness?.ready === true);

    const result = await page.evaluate(async (replayFrames) => {
      return window.task2ReplayHarness.run(replayFrames);
    }, frames);

    expect(result.frames).toBe(frames.length);
    expect(result.stateHistory[0]).toEqual(['hidden', 'circle', 'arrow']);
    expect(result.stateHistory.some((row) => row.includes('hidden'))).toBe(true);
    expect(result.stateHistory.some((row) => row.includes('circle'))).toBe(true);
    expect(result.stateHistory.some((row) => row.includes('arrow'))).toBe(true);
    expect(result.stateHistory.length).toBe(frames.length);
    expect(result.reportText).toContain(`frames: ${frames.length}`);
    expect(result.reportText).toContain('history:');
    expect(consoleIssues).toEqual([]);
  });
});
