import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { datedFileName } from "./editor-session.js";

/**
 * Why these tests matter: the save dialog at a link's or the sample's open
 * suggests `datedFileName`. Two opens at different local minutes must
 * never suggest the same name (else Enter plus Replace writes the original over
 * the edited tour), and the name must keep what the creator recognises:
 * the original name, then the date, then the same `.zip` ending.
 */
describe("datedFileName", () => {
  const minute = fc
    .date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31) })
    .map((d) => new Date(Math.floor(d.getTime() / 60_000) * 60_000));
  const name = fc
    .tuple(fc.string({ maxLength: 20 }), fc.constantFrom(".zip", ".ZIP", ""))
    .map(([stem, end]) => `${stem}${end}`);

  // The local wall clock, which is what the name carries: in the hour a
  // daylight-saving change repeats, two instants share it.
  const wall = (d: Date) =>
    [
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
    ].join();

  it("differs for any two different local minutes", () => {
    fc.assert(
      fc.property(name, minute, minute, (n, a, b) => {
        fc.pre(wall(a) !== wall(b));
        expect(datedFileName(n, a)).not.toBe(datedFileName(n, b));
      }),
    );
  });

  it("keeps the name before the date and the ending after it", () => {
    fc.assert(
      fc.property(name, minute, (n, at) => {
        const dated = datedFileName(n, at);
        const end = /\.zip$/i.test(n) ? n.slice(-4) : "";
        const stem = n.slice(0, n.length - end.length);
        expect(dated).toMatch(/-\d{4}-\d{2}-\d{2}-\d{4}(\.zip)?$/i);
        expect(dated.startsWith(`${stem}-`)).toBe(true);
        expect(dated.endsWith(end)).toBe(true);
        expect(dated.length).toBe(n.length + 16);
      }),
    );
  });
});
