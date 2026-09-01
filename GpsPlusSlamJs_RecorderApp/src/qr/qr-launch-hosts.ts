/**
 * The hosts whose printed QR codes are OURS.
 *
 * One list, two uses, deliberately: it gates every network request a scanned
 * code could trigger, and it gates minting. Splitting them would let a code be
 * anchored that the app would refuse to fetch, or the reverse.
 *
 * `localhost` is here for development. It costs nothing in production — a
 * printed code cannot name a visitor's own machine in a way that resolves to
 * anything but their own machine — and leaving it out would make every dev
 * build silently ignore its own test codes.
 */
export const QR_LAUNCH_HOSTS: readonly string[] = [
  'gps.csutil.com',
  'localhost',
];
