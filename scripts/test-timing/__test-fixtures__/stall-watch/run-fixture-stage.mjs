// Test fixture for stall-watch.integration.test.mjs: runs one fixture stage
// through the real runStage, as a gate would, and exits with its code. Run
// with CI set, so nothing is recorded into a timings file.
import { fileURLToPath } from 'node:url';

import { holdMachineSlotForProcess } from '../../machine-slot.mjs';
import { forwardSignalsToStages, runStage } from '../../run-stage.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const [stageName, pidFile = ''] = process.argv.slice(2);

/** @type {import('../../projects.mjs').ProjectConfig} */
const project = {
  name: 'stall-fixture',
  dir: here,
  chainNames: [],
  stages: [
    { name: 'silent', command: `node silent-stage.mjs "${pidFile}"`, counts: null },
    {
      name: 'stubborn',
      command: `node silent-stage.mjs "${pidFile}" stubborn`,
      counts: null,
    },
    { name: 'talker', command: 'node talker-stage.mjs', counts: null },
  ],
};

// As timed-stage.mjs does, in its order: the machine slot first (it registers
// its own SIGINT/SIGTERM handler, even with GATE_SLOT_DIR=off), then the
// forwarding, so a signal to this driver reaches the stage's own process
// group on POSIX.
await holdMachineSlotForProcess('stall fixture');
forwardSignalsToStages();

const { exitCode } = await runStage(project, stageName ?? 'silent', []);
console.log(`RESULT exit=${exitCode}`);
process.exit(exitCode);
