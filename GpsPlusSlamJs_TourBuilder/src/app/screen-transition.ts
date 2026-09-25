/**
 * Cross-fades one composed screen into the next: adds the `.screen-exit`
 * class (see `app.css`, 140ms fade + slide left), waits for the CSS
 * animation to finish, removes the outgoing element, then calls
 * `mountIncoming` — which is expected to append the next screen and add
 * `.screen-enter` to it (220ms fade + slide in from the right).
 *
 * A 200ms fallback timer backs up the `animationend` listener: environments
 * with no animation engine (jsdom, as used by this project's own tests)
 * never fire that event, and this must not hang forever waiting for it. The
 * `done` guard means whichever fires first wins and the other is a no-op.
 *
 * Used for every hard-cut screen swap in the composed Authoring flow: gate →
 * tools, resume-prompt → tools, export → share.
 */
export function swapScreen(
  outgoing: HTMLElement,
  mountIncoming: () => void,
): void {
  let done = false;
  function finish(): void {
    if (done) return;
    done = true;
    clearTimeout(timer);
    outgoing.remove();
    mountIncoming();
  }
  const timer = setTimeout(finish, 200);
  outgoing.classList.add("screen-exit");
  outgoing.addEventListener("animationend", finish, { once: true });
}
