// Test fixture: a stage that forks a silent grandchild, records its pid,
// then prints nothing and never ends, like a wedged test worker.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const pidFile = process.argv[2];
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
if (pidFile) writeFileSync(pidFile, String(grandchild.pid));
setInterval(() => {}, 1000);
