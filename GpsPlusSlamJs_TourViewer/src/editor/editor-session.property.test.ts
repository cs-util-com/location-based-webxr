import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { datedFileName, undatedFileName } from "./editor-session.js";

/**
 * Why these tests matter: the save dialog at a link's or the sample's open
 * suggests `datedFileName`. Two opens at different local seconds must
 * never suggest the same name (else Enter plus Replace writes the original over
 * the edited tour), and the name must keep what the creator recognises:
 * the original name, then the date, then the same `.zip` ending.
 */
describe("datedFileName", () => {
  // Whole seconds: the name carries no finer time. An invalid date is no
  // moment an open happens at.
  const second = fc
    .date({
      min: new Date(2000, 0, 1),
      max: new Date(2099, 11, 31),
      noInvalidDate: true,
    })
    .map((d) => new Date(Math.floor(d.getTime() / 1000) * 1000));
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
      d.getSeconds(),
    ].join();

  it("differs for any two different local seconds", () => {
    fc.assert(
      fc.property(name, second, second, (n, a, b) => {
        fc.pre(wall(a) !== wall(b));
        expect(datedFileName(n, a)).not.toBe(datedFileName(n, b));
      }),
    );
  });

  it("keeps the name before the date and the ending after it", () => {
    fc.assert(
      fc.property(name, second, (n, at) => {
        const dated = datedFileName(n, at);
        const end = /\.zip$/i.test(n) ? n.slice(-4) : "";
        const stem = n.slice(0, n.length - end.length);
        expect(dated).toMatch(/-\d{4}-\d{2}-\d{2}-\d{6}(\.zip)?$/i);
        expect(dated.startsWith(`${stem}-`)).toBe(true);
        expect(dated.endsWith(end)).toBe(true);
        expect(dated.length).toBe(n.length + 18);
      }),
    );
  });
});

/**
 * Why these tests matter: Done tells the creator to upload the saved file
 * under the hosted file's name, which a dated save does not carry. When the
 * tour was not opened from its link in this session (the dated save
 * reopened later, a draft restored after a reload), that name is the saved
 * one without its date - `undatedFileName`, the inverse of `datedFileName`.
 */
describe("undatedFileName", () => {
  const second = fc
    .date({
      min: new Date(2000, 0, 1),
      max: new Date(2099, 11, 31),
      noInvalidDate: true,
    })
    .map((d) => new Date(Math.floor(d.getTime() / 1000) * 1000));
  const name = fc
    .tuple(fc.string({ maxLength: 20 }), fc.constantFrom(".zip", ".ZIP", ""))
    .map(([stem, end]) => `${stem}${end}`);

  it("gives back the name a dated name was made from", () => {
    fc.assert(
      fc.property(name, second, (n, at) => {
        expect(undatedFileName(datedFileName(n, at))).toBe(n);
      }),
    );
  });

  it("leaves a name without the date unchanged", () => {
    fc.assert(
      fc.property(name, (n) => {
        fc.pre(!/-\d{4}-\d{2}-\d{2}-\d{6}(\.zip)?$/i.test(n));
        expect(undatedFileName(n)).toBe(n);
      }),
    );
  });
});
