import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

function readZipEntry(zipPath, entryName) {
  return execFileSync('unzip', ['-p', zipPath, entryName], {
    encoding: 'utf8',
  });
}

function listZipEntries(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
}

function loadTask1Replay(zipPath) {
  const session = JSON.parse(readZipEntry(zipPath, 'session.json'));
  const actions = listZipEntries(zipPath)
    .filter((entryName) => entryName.startsWith('actions/') && entryName.endsWith('.json'))
    .sort()
    .map((entryName) => JSON.parse(readZipEntry(zipPath, entryName)));

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
