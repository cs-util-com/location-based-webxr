// Test fixture: a slow stage that keeps talking, every 250 ms for 5 s,
// and then succeeds. A silence limit longer than its gaps must never fire.
let left = 20;
const timer = setInterval(() => {
  process.stdout.write('.');
  left -= 1;
  if (left === 0) {
    clearInterval(timer);
    process.stdout.write('\ndone\n');
  }
}, 250);
